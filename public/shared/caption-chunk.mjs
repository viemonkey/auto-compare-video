// Caption karaoke: (1) gắn dấu câu vào token do TTS trả về, (2) gom token thành các cụm hiện từng lần trên 1 dòng.
// Module THUẦN, dùng chung server/trình duyệt. Tham số theo thị trường: config/locales/<code>.json → layout.caption.
import { countGraphemes } from "./text-length.mjs";
import { NO_START, NO_END } from "./line-break.mjs";

const OPENERS = new Set([...NO_END]);
const isSpace = (c) => /\s/.test(c);

/**
 * Căn các "từ" do TTS trả về (word boundary — đã bỏ dấu câu và khoảng trắng) với câu gốc để mỗi token mang theo dấu câu
 * dính liền nó: "biệt" + ":" -> "biệt:", "ます" + "。" -> "ます。", "「" + "硬い" -> "「硬い".
 * Dấu câu đứng riêng giữa hai khoảng trắng (vd " — ") bị bỏ, đúng như cách caption tiếng Việt vẫn làm.
 * Từ TTS không tìm thấy trong câu gốc -> giữ nguyên chữ TTS (và đếm vào `misses`).
 * @param {string} source câu gốc đã đọc
 * @param {string[]} spoken text của từng word boundary, đúng thứ tự
 * @returns {{tokens:string[], misses:number}}
 */
export function alignBoundaries(source, spoken) {
  const src = String(source ?? "");
  const tokens = [];
  let pos = 0;
  let misses = 0;
  const fold = (s) => s.normalize("NFKC").toLowerCase();
  const srcFold = [...src].map((ch) => fold(ch));
  // vị trí (theo index ký tự code point) -> index UTF-16 để dùng slice
  const cps = [...src];

  const find = (word, from) => {
    const exact = src.indexOf(word, from);
    if (exact !== -1) return { at: exact, len: word.length };
    // khác biệt chuẩn hoá (chữ rộng/hẹp, hoa/thường): so theo từng ký tự đã fold
    const w = [...word].map((ch) => fold(ch)).join("");
    let utf16 = 0;
    for (let i = 0; i < cps.length; i++) {
      const start = utf16;
      if (start >= from) {
        let acc = "";
        let len = 0;
        for (let k = i; k < cps.length && acc.length < w.length; k++) { acc += srcFold[k]; len += cps[k].length; }
        if (acc === w) return { at: start, len };
      }
      utf16 += cps[i].length;
    }
    return null;
  };

  spoken.forEach((word) => {
    const hit = find(word, pos);
    if (!hit) { misses++; tokens.push({ prefix: "", core: word, suffix: "" }); return; }
    const gap = src.slice(pos, hit.at);
    const prev = tokens.at(-1);
    if (gap) {
      const chars = [...gap];
      const firstSpace = chars.findIndex(isSpace);
      const lastSpace = chars.length - 1 - [...chars].reverse().findIndex(isSpace);
      let lead = "";
      let trail = "";
      if (firstSpace === -1) {
        // không có khoảng trắng (ja/th): dấu mở đi theo token sau, còn lại dính token trước
        let k = 0;
        while (k < chars.length && !OPENERS.has(chars[k])) k++;
        lead = chars.slice(0, k).join("");
        trail = chars.slice(k).join("");
      } else {
        lead = chars.slice(0, firstSpace).join("");
        trail = chars.slice(lastSpace + 1).join("");
      }
      if (prev) prev.suffix += lead;
      else trail = lead + trail; // đầu câu: không có token trước -> dính vào token này
      tokens.push({ prefix: trail, core: src.slice(hit.at, hit.at + hit.len), suffix: "" });
    } else {
      tokens.push({ prefix: "", core: src.slice(hit.at, hit.at + hit.len), suffix: "" });
    }
    pos = hit.at + hit.len;
  });
  // phần đuôi sau token cuối (vd "。", "!") dính token cuối; khoảng trắng bỏ
  const tail = src.slice(pos).trim();
  if (tail && tokens.length) {
    const lastRealSpace = [...tail].findIndex(isSpace);
    const piece = lastRealSpace === -1 ? tail : tail.slice(0, lastRealSpace);
    tokens.at(-1).suffix += piece;
  }
  return { tokens: tokens.map((t) => t.prefix + t.core + t.suffix), misses };
}

/**
 * Gom token thành cụm hiện trên 1 dòng caption.
 * Luật (khớp thuật toán vi-VN cũ khi dùng tham số vi): ngắt sau token kết vế (clauseEnders) nếu cụm đã >= clauseMinTokens;
 * hoặc khi đủ maxUnits; hoặc tới hardMaxTokens; hoặc tới maxTokens mà token kế KHÔNG kết vế (để không bỏ lẻ 1 token đuôi).
 * @param {string[]} tokens
 * @param {object} p layout.caption của locale (maxTokens, hardMaxTokens, maxUnits, clauseMinTokens, clauseEnders, joiner, weakStartPattern?)
 * @param {{fits?:(group:string[])=>boolean, kinsoku?:boolean}} [o] kinsoku: luật cấm đầu/cuối dòng (ja); fits: cụm có vừa độ rộng khung (đo bằng font thật) không — bắt buộc nếu muốn đảm bảo không tràn
 * @returns {number[][]} nhóm chỉ số token
 */
export function chunkCaption(tokens, p, { fits, kinsoku = false } = {}) {
  const isClause = (s) => s.length > 0 && p.clauseEnders.includes(lastOf(s));
  const joinerUnits = p.joiner ? 1 : 0;
  const weak = p.weakStartPattern ? new RegExp(p.weakStartPattern, "u") : null;
  const unitsOf = (s) => countGraphemes(s) + joinerUnits;
  const groups = [];
  let cur = [];
  let units = 0;
  const flush = () => { if (cur.length) groups.push(cur); cur = []; units = 0; };

  for (let i = 0; i < tokens.length; i++) {
    // Cụm đang có token rồi mà thêm token này làm tràn khung -> đóng cụm trước (token này mở cụm mới)
    if (fits && cur.length && !fits([...cur, i].map((k) => tokens[k]))) flush();
    cur.push(i);
    units += unitsOf(tokens[i]);
    const clause = isClause(tokens[i]);
    const next = tokens[i + 1];
    const nextClause = next !== undefined && isClause(next);
    let cut =
      (clause && cur.length >= p.clauseMinTokens) ||
      units >= p.maxUnits ||
      cur.length >= p.hardMaxTokens ||
      (cur.length >= p.maxTokens && !nextClause);
    // Không bắt đầu cụm mới bằng token "yếu" (vd trợ từ hiragana ngắn) — giữ chúng với token trước, trừ khi đã tới trần cứng
    if (cut && weak && next !== undefined && weak.test(next) && !clause && cur.length < p.hardMaxTokens && units < p.maxUnits * 1.5) cut = false;
    // Không kết thúc cụm bằng dấu mở / không bắt đầu cụm bằng dấu đóng (kinsoku)
    if (kinsoku && cut && next !== undefined && (NO_START.has(firstOf(next)) || NO_END.has(lastOf(tokens[i])))) cut = false;
    if (cut) flush();
  }
  flush();
  return groups;
}

const firstOf = (s) => [...s][0];
const lastOf = (s) => [...s].at(-1);
