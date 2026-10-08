// Vừa khung chữ: chọn cỡ chữ lớn nhất (giảm theo bước đến ngưỡng tối thiểu) sao cho chữ nằm gọn khung đã đo bằng FONT THẬT.
// Module THUẦN — việc đo (px) được truyền vào dưới dạng callback nên chạy giống nhau trong trình duyệt đo (scripts/lib/browser-fit.mjs)
// và trong test (đo giả). Tham số theo thị trường: config/locales/<code>.json → layout; hình học khung: config/themes/<id>.json → frames.
import { breakLines } from "./line-break.mjs";
import { chunkCaption } from "./caption-chunk.mjs";

/** Dãy cỡ chữ thử: fontPx, fontPx-step, ... luôn kết thúc đúng ở minFontPx. */
export function sizeSteps({ fontPx, minFontPx, stepPx }) {
  const out = [];
  for (let px = fontPx; px > minFontPx; px -= stepPx) out.push(px);
  out.push(minFontPx);
  return out;
}

/**
 * Nhãn (tiêu đề cố định trên mỗi ảnh): nhiều dòng, độ rộng khung + số dòng + chiều cao khung.
 * @param {string} text
 * @param {object} o
 * @param {object} o.box       locale.layout.label  { fontPx, minFontPx, stepPx, maxLines, maxUnitsPerLine }
 * @param {object} o.frame     theme.frames.label   { widthPx, lineHeight, maxHeightPx? }
 * @param {object} o.lineBreak locale.layout.lineBreak { mode, kinsoku, balance }
 * @param {string} o.language
 * @param {(px:number)=>((line:string)=>number)} o.measureAt  trả hàm đo độ rộng px của 1 dòng ở cỡ chữ px
 * @returns {{ok:boolean, fontPx:number, shrunk:boolean, lines:string[], reason:string}}
 */
export function fitLabel(text, { box, frame, lineBreak, language, measureAt }) {
  let last = null;
  for (const px of sizeSteps(box)) {
    const r = breakLines(text, { language, mode: lineBreak.mode, kinsoku: lineBreak.kinsoku, balance: lineBreak.balance, maxLines: box.maxLines, measure: measureAt(px), maxWidth: frame.widthPx });
    const tall = frame.maxHeightPx && r.lines.length * px * (frame.lineHeight || 1) > frame.maxHeightPx;
    last = { r, px, tall };
    if (!r.overflow && !tall) return { ok: true, fontPx: px, shrunk: px < box.fontPx, lines: r.lines, reason: "" };
  }
  const reason = last.r.overflow ? last.r.reason : "too-tall";
  return { ok: false, fontPx: last.px, shrunk: last.px < box.fontPx, lines: last.r.lines, reason };
}

/**
 * Caption: gom token thành cụm 1 dòng. Cụm đo ở cỡ gốc; cụm nào (thường chỉ gồm 1 token rất dài) vẫn tràn thì giảm cỡ riêng cho cụm đó.
 * @param {string[]} tokens
 * @param {object} o
 * @param {object} o.box       locale.layout.caption
 * @param {object} o.frame     theme.frames.caption { widthPx }
 * @param {boolean} o.kinsoku
 * @param {(px:number)=>((group:string[])=>number)} o.measureAt  độ rộng px của 1 cụm token ở cỡ chữ px (gồm khoảng cách giữa chữ + viền)
 * @returns {{ok:boolean, groups:Array<{indices:number[], fontPx:number, ok:boolean}>}}
 */
export function fitCaption(tokens, { box, frame, kinsoku, measureAt }) {
  const atBase = measureAt(box.fontPx);
  const idxGroups = chunkCaption(tokens, box, { kinsoku, fits: (g) => atBase(g) <= frame.widthPx });
  const groups = idxGroups.map((indices) => {
    const toks = indices.map((i) => tokens[i]);
    let chosen = null;
    for (const px of sizeSteps(box)) {
      if (measureAt(px)(toks) <= frame.widthPx) { chosen = px; break; }
    }
    return { indices, fontPx: chosen ?? box.minFontPx, ok: chosen !== null };
  });
  return { ok: groups.every((g) => g.ok), groups };
}

/**
 * Cỡ chữ thực tế của nhóm cụm: chỉ ghi đè (trả số) khi khác cỡ gốc, còn lại null để template dùng cỡ mặc định.
 */
export const overrideFontPx = (group, box) => (group.fontPx === box.fontPx ? null : group.fontPx);

/** Câu báo lỗi tiếng Việt (dễ hiểu cho người dùng cuối) cho 1 khung không vừa. */
export function overflowMessage(frame) {
  return frame === "label"
    ? "Tiêu đề quá dài, không vừa khung dù đã thu nhỏ chữ hết cỡ. Hãy rút gọn."
    : "Câu quá dài hoặc có đoạn chữ không xuống dòng được, tràn khung phụ đề. Hãy rút gọn.";
}
