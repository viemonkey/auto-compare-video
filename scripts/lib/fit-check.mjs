// Kiểm tra / lập kế hoạch chữ vừa khung cho 1 video:
//   - nhãn 2 ảnh: cỡ chữ + xuống dòng (giảm cỡ theo bước tới ngưỡng tối thiểu trong config locale),
//   - caption karaoke: gom cụm theo độ rộng khung, cụm quá dài thì giảm cỡ riêng,
//   - ký tự font không hỗ trợ (ô vuông / tofu).
// Đo bằng Chrome thật + font thật (browser-fit.mjs); không có Chrome -> ước lượng theo số ký tự (measuredBy: "estimate").
import { textOf, flattenContent } from "../../public/shared/bilingual.mjs";
import { atomize, breakLines } from "../../public/shared/line-break.mjs";
import { alignBoundaries, chunkCaption } from "../../public/shared/caption-chunk.mjs";
import { overflowMessage, sizeSteps } from "../../public/shared/text-fit.mjs";
import { spokenLines } from "./video-lines.mjs";
import { uncoveredChars } from "./fonts.mjs";
import { findChrome, buildMeasurePage, runMeasurePage } from "./browser-fit.mjs";
import { listThemes, getDefaultTheme } from "./capabilities.mjs";

const HAS_LETTER = /[\p{L}\p{N}]/u;
const NON_LATIN_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

/** Token caption ƯỚC LƯỢNG từ câu chữ (khi chưa có word boundary thật của TTS): từ do Intl.Segmenter / khoảng trắng, dấu câu dính token. */
export function estimateTokens(text, locale) {
  const atoms = atomize(text, { language: locale.language, mode: locale.layout.lineBreak.mode }).map((a) => a.text).filter((t) => HAS_LETTER.test(t));
  return alignBoundaries(text, atoms).tokens;
}

function themeFor(themeId) {
  const themes = listThemes();
  return (themeId && themes.find((t) => t.id === themeId)) || getDefaultTheme(themes);
}

/**
 * Chạy đo/kế hoạch. `items`: [{id, frame:"label", text} | {id, frame:"caption", tokens}].
 * @returns {Promise<{measuredBy:"chrome"|"estimate", results:Record<string,object>}>}
 */
export async function fitItems(items, locale, { themeId, chrome, runner = runMeasurePage, forceEstimate = false } = {}) {
  const theme = themeFor(themeId);
  const frames = theme?.frames;
  const lb = locale.layout.lineBreak;
  const canMeasure = !forceEstimate && !!frames && !!(chrome ?? findChrome());
  if (canMeasure) {
    const job = {
      language: locale.language,
      fontChain: locale.fonts.display,
      video: { italic: locale.video.italic, uppercase: locale.video.uppercase },
      lineBreak: lb,
      labelBox: locale.layout.label,
      captionBox: locale.layout.caption,
      frames,
      items,
    };
    try {
      const results = await runner(buildMeasurePage(job), { chrome: chrome ?? findChrome() });
      return { measuredBy: "chrome", results };
    } catch (e) {
      // Chrome chạy lỗi: không chặn cả quy trình — rơi về ước lượng theo số ký tự và nói rõ ở measuredBy.
      console.warn(`[fit-check] đo bằng Chrome thất bại, dùng ước lượng: ${e.message}`);
    }
  }
  // Ước lượng (không có Chrome): độ rộng theo số ký tự trong config.
  const results = {};
  for (const it of items) {
    if (it.frame === "label") {
      const r = breakLines(it.text, { language: locale.language, mode: lb.mode, kinsoku: lb.kinsoku, balance: lb.balance, maxLines: locale.layout.label.maxLines, maxUnits: locale.layout.label.maxUnitsPerLine });
      results[it.id] = { ok: !r.overflow, fontPx: locale.layout.label.fontPx, shrunk: false, lines: r.lines, reason: r.reason };
    } else {
      const groups = chunkCaption(it.tokens, locale.layout.caption, { kinsoku: lb.kinsoku }).map((indices) => ({ indices, fontPx: locale.layout.caption.fontPx, ok: true }));
      results[it.id] = { ok: true, groups };
    }
  }
  return { measuredBy: "estimate", results };
}

/**
 * Kiểm tra nội dung kịch bản (Bước 2 / trước khi dựng).
 * @returns {Promise<{ok:boolean, measuredBy:string, issues:Array<{field:string, code:"overflow"|"tofu", message:string}>, label?:object}>}
 */
export async function checkContentFit(content, locale, opts = {}) {
  const issues = [];
  const left = textOf(content.label_left);
  const right = textOf(content.label_right);
  const lines = spokenLines(content, locale);

  // 1) ký tự font không vẽ được — kiểm trên MỌI chữ sẽ hiện
  const seen = new Set();
  const tofuCheck = (field, text) => {
    // Chỉ chặn ký tự của hệ chữ KHÔNG phải Latin (kanji/kana/Thái...): đó mới là chỗ ra ô vuông thật. Ký hiệu/dấu Latin-Common
    // (≈ ° → …) thiếu trong font thì trình duyệt tự lấy font hệ thống, như vi-VN vẫn chạy từ trước tới giờ.
    const bad = uncoveredChars(text, locale.fonts.display).filter((c) => NON_LATIN_SCRIPT.test(c));
    if (bad.length && !seen.has(`${field}:${bad.join("")}`)) {
      seen.add(`${field}:${bad.join("")}`);
      issues.push({ field, code: "tofu", message: `Font của video không có ký tự: ${bad.map((c) => `「${c}」`).join(" ")} — sẽ hiện thành ô vuông. Hãy thay bằng ký tự khác.` });
    }
  };
  tofuCheck("label_left", left);
  tofuCheck("label_right", right);
  for (const l of lines) tofuCheck(l.field, l.text);

  // 2) vừa khung
  const items = [
    { id: "label_left", frame: "label", text: left },
    { id: "label_right", frame: "label", text: right },
    ...lines.map((l) => ({ id: l.id, frame: "caption", tokens: estimateTokens(l.text, locale) })),
  ].filter((it) => (it.frame === "label" ? it.text.trim() : it.tokens.length));
  const { measuredBy, results } = await fitItems(items, locale, opts);

  const flagged = new Set();
  const flag = (field, frame) => {
    if (flagged.has(`${field}:${frame}`)) return;
    flagged.add(`${field}:${frame}`);
    issues.push({ field, code: "overflow", message: overflowMessage(frame) });
  };
  for (const id of ["label_left", "label_right"]) if (results[id] && !results[id].ok) flag(id, "label");
  for (const l of lines) if (results[l.id] && !results[l.id].ok) flag(l.field, "caption");

  const label = {};
  for (const [id, key] of [["label_left", "left"], ["label_right", "right"]]) if (results[id]) label[key] = results[id];
  return { ok: issues.length === 0, measuredBy, issues, label };
}

/** Tên field nội dung → cách gọi trong giao diện (tiếng Việt). */
export function fieldLabel(field) {
  if (field === "title") return "Tiêu đề (câu hỏi)";
  if (field === "label_left") return "Tên bên trái";
  if (field === "label_right") return "Tên bên phải";
  const m = /^points\.(\d+)\.text$/.exec(field);
  return m ? `Điểm so sánh ${Number(m[1]) + 1}` : field;
}

/** Thông báo tiếng Việt gộp các lỗi vừa khung (dùng khi chặn dựng). */
export function describeIssues(issues) {
  return issues.map((i) => `• ${fieldLabel(i.field)}: ${i.message}`).join("\n");
}

/** Cỡ chữ nhãn chung cho cả 2 bên (nhỏ nhất của hai) + dòng đã xuống của từng bên. */
export function labelPlan(left, right, locale) {
  const fonts = [left, right].filter(Boolean).map((r) => r.fontPx);
  const fontPx = fonts.length ? Math.min(...fonts) : locale.layout.label.fontPx;
  return { fontPx, left: left?.lines ?? [], right: right?.lines ?? [] };
}

export { sizeSteps };

/**
 * Kế hoạch chữ cho 1 video đã có token caption thật (từ word boundary của TTS): cỡ + dòng của nhãn, cụm caption.
 * @param {object} o
 * @param {string} o.left @param {string} o.right  nhãn 2 ảnh
 * @param {Array<{n:number, tokens:string[]}>} o.lines  mỗi dòng thoại + token hiển thị
 * @returns {Promise<{ok:boolean, measuredBy:string, label:{fontPx:number,left:string[],right:string[]}, phrases:Record<number,Array<[number,number]>>, issues:Array<{where:string,message:string}>}>}
 */
export async function planVideoText({ left, right, lines }, locale, opts = {}) {
  const items = [
    { id: "label_left", frame: "label", text: left },
    { id: "label_right", frame: "label", text: right },
    ...lines.map((l) => ({ id: `line-${l.n}`, frame: "caption", tokens: l.tokens })),
  ];
  const { measuredBy, results } = await fitItems(items, locale, opts);
  const issues = [];
  for (const id of ["label_left", "label_right"]) {
    if (!results[id].ok) issues.push({ where: id === "label_left" ? "nhãn trái" : "nhãn phải", message: overflowMessage("label") });
  }
  const phrases = {};
  for (const l of lines) {
    const r = results[`line-${l.n}`];
    if (!r.ok) issues.push({ where: `dòng thoại ${l.n} “${l.tokens.join(" ").slice(0, 40)}”`, message: overflowMessage("caption") });
    phrases[l.n] = r.groups.map((g) => [g.indices.length, g.fontPx === locale.layout.caption.fontPx ? 0 : g.fontPx]);
  }
  return {
    ok: issues.length === 0,
    measuredBy,
    label: labelPlan(results.label_left, results.label_right, locale),
    phrases,
    issues,
  };
}

/** Nội dung có chữ không vừa khung / font thiếu ký tự -> không được dựng. `userMessage` là câu tiếng Việt liệt kê từng chỗ. */
export class FitBlockedError extends Error {
  constructor(issues) {
    super("Chữ không vừa khung video");
    this.name = "FitBlockedError";
    this.issues = issues;
    this.userMessage = `Chữ không vừa khung video, hãy sửa rồi dựng lại:\n${describeIssues(issues)}`;
  }
}

/** Cổng chặn dựng: ném FitBlockedError nếu còn lỗi; ngược lại trả kết quả kiểm tra. */
export async function assertFitsForBuild(content, locale, opts = {}) {
  const result = await checkContentFit(flattenContent(content), locale, opts);
  if (!result.ok) throw new FitBlockedError(result.issues);
  return result;
}
