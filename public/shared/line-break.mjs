// Ngắt dòng theo thị trường — module THUẦN (không DOM, không Node API) nên dùng chung được cho server và trình duyệt.
//   mode "space"     (vi, en): ngắt ở khoảng trắng.
//   mode "segmenter" (ja, th): ngắt theo từ bằng Intl.Segmenter (tiếng Thái/Nhật không có khoảng trắng giữa từ);
//                              kèm luật kinsoku (禁則処理) khi `kinsoku: true`:
//                              không bắt đầu dòng bằng 。、」）ー・ … và không kết thúc dòng bằng 「（ …
// Độ rộng 1 dòng: nếu có `measure(text)` (px, đo bằng font thật) + `maxWidth` thì theo px; không thì theo `maxUnits` (grapheme).
import { countGraphemes } from "./text-length.mjs";

/** Không được đứng ĐẦU dòng: dấu đóng, dấu câu, "ー", "・", kana nhỏ, dấu lặp, %... */
export const NO_START = new Set(
  [..."、。，．,.!?！？：；:;）)］]｝}」』】〕〉》〗〙〟”’%％°′″℃ー～〜・･…‥ゝゞヽヾ々〻ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ"],
);
/** Không được đứng CUỐI dòng: dấu mở. */
export const NO_END = new Set([..."「『（(［[｛{【〔〈《〖〘〝“‘"]);

const segmenters = new Map();
function wordSegmenter(language) {
  if (!segmenters.has(language)) segmenters.set(language, new Intl.Segmenter(language, { granularity: "word" }));
  return segmenters.get(language);
}
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemesOf = (s) => [...graphemeSegmenter.segment(s)].map((x) => x.segment);

const lastChar = (s) => [...s].at(-1);
const firstChar = (s) => [...s][0];

/**
 * Tách chuỗi thành "nguyên tử" không chia nhỏ được: { text, spaceBefore }.
 * spaceBefore = giữa nguyên tử này và nguyên tử trước có khoảng trắng gốc (dùng để ghép lại dòng).
 */
export function atomize(text, { language = "en", mode = "space" } = {}) {
  const src = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!src) return [];
  const atoms = [];
  let space = false;
  if (mode === "segmenter") {
    for (const seg of wordSegmenter(language).segment(src)) {
      if (/^\s+$/.test(seg.segment)) { space = true; continue; }
      atoms.push({ text: seg.segment, spaceBefore: space && atoms.length > 0 });
      space = false;
    }
  } else {
    for (const w of src.split(" ")) atoms.push({ text: w, spaceBefore: atoms.length > 0 });
  }
  return atoms;
}

/** Được phép ngắt dòng giữa hai nguyên tử không? (kinsoku) */
export function canBreak(prev, next, kinsoku) {
  if (!kinsoku) return true;
  if (NO_START.has(firstChar(next.text))) return false;
  if (NO_END.has(lastChar(prev.text))) return false;
  return true;
}

const join = (atoms, i, j) => {
  let out = "";
  for (let k = i; k <= j; k++) out += (k > i && atoms[k].spaceBefore ? " " : "") + atoms[k].text;
  return out;
};

/**
 * Nguyên tử dài hơn 1 dòng (vd chuỗi số/URL rất dài) -> chẻ theo grapheme thành các mảnh vừa 1 dòng; giữa các mảnh luôn ngắt được.
 * Trả atoms mới (mảnh sau có spaceBefore = false, forced = true).
 */
function splitOversize(atoms, fits) {
  const out = [];
  for (const a of atoms) {
    if (fits(a.text)) { out.push(a); continue; }
    let buf = "";
    let first = true;
    for (const g of graphemesOf(a.text)) {
      if (buf && !fits(buf + g)) {
        out.push({ text: buf, spaceBefore: first ? a.spaceBefore : false, forced: !first });
        first = false;
        buf = g;
      } else {
        buf += g;
      }
    }
    if (buf) out.push({ text: buf, spaceBefore: first ? a.spaceBefore : false, forced: !first });
  }
  return out;
}

// Ngắt được tại ranh giới i|i+1 (atoms[i] kết thúc dòng)? Mảnh chẻ cưỡng bức thì luôn được.
const breakOk = (atoms, i, kinsoku) => atoms[i + 1].forced || canBreak(atoms[i], atoms[i + 1], kinsoku);

function greedy(atoms, fits, kinsoku) {
  atoms = atoms; // splice tại chỗ: mảng được sửa, người gọi dùng lại cùng mảng
  const lines = [];
  let i = 0;
  while (i < atoms.length) {
    let j = i;
    while (j + 1 < atoms.length && fits(join(atoms, i, j + 1))) j++;
    if (j + 1 < atoms.length && !breakOk(atoms, j, kinsoku)) {
      // 追い出し: lùi điểm ngắt về chỗ hợp lệ gần nhất trong dòng
      let k = j - 1;
      while (k >= i && !breakOk(atoms, k, kinsoku)) k--;
      if (k >= i) {
        j = k;
      } else if (graphemesOf(atoms[j].text).length > 1) {
        // Nguyên tử cuối dài > 1 ký tự và không có chỗ lùi: đẩy ký tự cuối của nó xuống dòng sau (vd "あいうえお|。" -> "あいうえ|お。")
        const gs = graphemesOf(atoms[j].text);
        atoms.splice(j, 1, { text: gs.slice(0, -1).join(""), spaceBefore: atoms[j].spaceBefore, forced: atoms[j].forced }, { text: gs.at(-1), spaceBefore: false, forced: true });
      } else {
        // 追い込み: không còn gì để đẩy -> kéo dài dòng tới điểm ngắt hợp lệ kế tiếp
        while (j + 1 < atoms.length && !breakOk(atoms, j, kinsoku)) j++;
      }
    }
    lines.push([i, j]);
    i = j + 1;
  }
  return lines;
}

// Cân bằng: với số dòng đã định, chọn các điểm ngắt làm dòng dài nhất ngắn nhất (tránh dòng cuối chỉ 1-2 chữ).
function balanced(atoms, fits, kinsoku, lineCount, size) {
  const n = atoms.length;
  const INF = Infinity;
  const cost = (i, j) => (fits(join(atoms, i, j)) ? size(join(atoms, i, j)) : INF);
  // best[k][j] = chi phí nhỏ nhất để xếp atoms[0..j-1] vào k dòng; prev để dựng lại
  const best = Array.from({ length: lineCount + 1 }, () => new Array(n + 1).fill(INF));
  const prev = Array.from({ length: lineCount + 1 }, () => new Array(n + 1).fill(-1));
  best[0][0] = 0;
  for (let k = 1; k <= lineCount; k++) {
    for (let j = 1; j <= n; j++) {
      for (let i = k - 1; i < j; i++) {
        if (best[k - 1][i] === INF) continue;
        if (i > 0 && !breakOk(atoms, i - 1, kinsoku)) continue;
        const c = cost(i, j - 1);
        if (c === INF) continue;
        const v = Math.max(best[k - 1][i], c);
        if (v < best[k][j]) { best[k][j] = v; prev[k][j] = i; }
      }
    }
  }
  if (best[lineCount][n] === INF) return null;
  const lines = [];
  let j = n;
  for (let k = lineCount; k >= 1; k--) {
    const i = prev[k][j];
    lines.unshift([i, j - 1]);
    j = i;
  }
  return lines;
}

/**
 * Chia `text` thành các dòng.
 * @param {string} text
 * @param {object} o
 * @param {string} [o.language]   mã ngôn ngữ BCP-47 ("ja", "th", "en", "vi")
 * @param {"space"|"segmenter"} [o.mode]
 * @param {boolean} [o.kinsoku]
 * @param {boolean} [o.balance]   cân bằng độ dài các dòng (khi cần > 1 dòng)
 * @param {number} [o.maxLines]   số dòng tối đa (vượt -> overflow = true, vẫn trả đủ dòng để hiển thị cảnh báo)
 * @param {number} [o.maxUnits]   độ rộng tối đa 1 dòng, tính bằng grapheme (dùng khi không có measure)
 * @param {(line:string)=>number} [o.measure]  đo độ rộng px của 1 dòng bằng font thật
 * @param {number} [o.maxWidth]   độ rộng tối đa px (đi kèm measure)
 * @returns {{lines:string[], overflow:boolean, reason:""|"too-many-lines"|"line-too-wide"}}
 */
export function breakLines(text, o = {}) {
  const { language = "en", mode = "space", kinsoku = false, balance = false, maxLines = Infinity, maxUnits = Infinity, measure, maxWidth } = o;
  const usePx = typeof measure === "function" && Number.isFinite(maxWidth);
  const fits = usePx ? (s) => measure(s) <= maxWidth : (s) => countGraphemes(s) <= maxUnits;
  const size = usePx ? measure : countGraphemes;

  let atoms = atomize(text, { language, mode });
  if (!atoms.length) return { lines: [], overflow: false, reason: "" };
  atoms = splitOversize(atoms, fits);

  let ranges = greedy(atoms, fits, kinsoku);
  if (balance && ranges.length > 1) {
    const b = balanced(atoms, fits, kinsoku, ranges.length, size);
    if (b) ranges = b;
  }
  const lines = ranges.map(([i, j]) => join(atoms, i, j));
  // 追い込み có thể làm 1 dòng vượt độ rộng — vẫn phải báo
  if (lines.some((l) => !fits(l))) return { lines, overflow: true, reason: "line-too-wide" };
  if (lines.length > maxLines) return { lines, overflow: true, reason: "too-many-lines" };
  return { lines, overflow: false, reason: "" };
}
