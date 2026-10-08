// Chuẩn hoá CÁCH ĐỌC trước khi gửi TTS: bảng phát âm theo thị trường (config/locales/<code>.json → tts.pronunciation).
// CHỈ áp cho bản ĐỌC. Chữ hiện trên video (caption, nhãn) luôn là chữ gốc: timing karaoke được ánh xạ ngược từ chữ đã đổi về
// token của chữ gốc bằng vị trí ký tự (alignWords), nên "10ct" vẫn hiện "10ct" trên màn hình dù TTS đọc "10カラット".
//
// Mỗi luật:
//   { "match": "Mohs", "say": "モース", "wholeWord": true, "ignoreCase": false }          — chuỗi chữ nguyên văn
//   { "pattern": "(\\d+(?:\\.\\d+)?)\\s*ct", "flags": "iu", "say": "$1カラット" }          — regex (cờ g luôn được thêm; $1.. như String.replace)
// Luật xếp theo thứ tự ưu tiên; nhiều luật khớp chồng nhau thì luật bắt đầu SỚM hơn thắng, hoà thì luật đứng trước trong config.
import { estimateTokens } from "../../../public/shared/caption-chunk.mjs";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "cả từ" tính theo chữ LATIN: tiếng Nhật/Thái không có khoảng trắng nên "GIAの" vẫn là từ GIA (chữ Nhật/Thái kề bên không chặn khớp)
const WORD_CHAR = "A-Za-z0-9_";

/** Lỗi cấu hình bảng phát âm (mảng chuỗi tiếng Việt; rỗng = hợp lệ). Dùng ở validateLocale. */
export function validatePronunciation(rules) {
  const problems = [];
  if (rules === undefined) return problems;
  if (!Array.isArray(rules)) return ['"tts.pronunciation" phải là mảng luật'];
  rules.forEach((r, i) => {
    const at = `tts.pronunciation[${i}]`;
    if (r === null || typeof r !== "object" || Array.isArray(r)) return problems.push(`${at} phải là object`);
    const hasMatch = typeof r.match === "string" && r.match !== "";
    const hasPattern = typeof r.pattern === "string" && r.pattern !== "";
    if (hasMatch === hasPattern) problems.push(`${at} cần đúng một trong "match" (chữ nguyên văn) hoặc "pattern" (regex)`);
    if (typeof r.say !== "string") problems.push(`${at}.say phải là chuỗi (cách đọc; có thể rỗng để bỏ qua không đọc)`);
    if (hasPattern) {
      try {
        new RegExp(r.pattern, `${r.flags ?? ""}`.includes("u") ? r.flags : `${r.flags ?? ""}u`);
      } catch (e) {
        problems.push(`${at}.pattern/flags không hợp lệ: ${e.message}`);
      }
    }
  });
  return problems;
}

function compileRule(r) {
  let flags = String(r.flags ?? "");
  if (r.match !== undefined) {
    flags = r.ignoreCase ? "iu" : "u";
    const body = escapeRe(r.match);
    const source = r.wholeWord ? `(?<![${WORD_CHAR}])(?:${body})(?![${WORD_CHAR}])` : body;
    return { source, flags: `g${flags}`, say: r.say };
  }
  if (!flags.includes("u")) flags += "u";
  return { source: r.pattern, flags: `g${flags.replace(/g/g, "")}`, say: r.say };
}

/**
 * @param {Array|undefined} rules locale.tts.pronunciation
 * @returns {(text:string)=>{text:string, spans:Array<{os:number,oe:number,ss:number,se:number}>}}
 *   spans: các đoạn đã đổi — [os,oe) trong chữ gốc ↔ [ss,se) trong chữ đã đọc
 */
export function compilePronunciation(rules) {
  const compiled = (rules || []).map(compileRule);
  if (!compiled.length) return (text) => ({ text, spans: [] });
  const single = compiled.map((c) => new RegExp(c.source, c.flags.replace("g", "")));
  return (text) => {
    const src = String(text ?? "");
    const cands = [];
    compiled.forEach((c, ri) => {
      for (const m of src.matchAll(new RegExp(c.source, c.flags))) {
        if (!m[0]) continue;
        cands.push({ start: m.index, end: m.index + m[0].length, say: m[0].replace(single[ri], c.say), ri });
      }
    });
    cands.sort((a, b) => a.start - b.start || a.ri - b.ri || b.end - a.end);
    const picked = [];
    let last = 0;
    for (const c of cands) {
      if (c.start < last) continue; // chồng lên luật thắng trước đó
      picked.push(c);
      last = c.end;
    }
    let out = "";
    let pos = 0;
    const spans = [];
    for (const c of picked) {
      out += src.slice(pos, c.start);
      const ss = out.length;
      out += c.say;
      spans.push({ os: c.start, oe: c.end, ss, se: out.length });
      pos = c.end;
    }
    out += src.slice(pos);
    return { text: out, spans };
  };
}

/** Vị trí trong chữ gốc -> vị trí tương ứng trong chữ đã đọc (trong đoạn bị đổi: nội suy theo tỉ lệ). */
export function mapOffset(spans, pos) {
  let delta = 0;
  for (const s of spans) {
    if (pos < s.os) break;
    if (pos < s.oe) return s.ss + Math.round(((pos - s.os) / (s.oe - s.os)) * (s.se - s.ss));
    delta = s.se - s.oe;
  }
  return pos + delta;
}

/**
 * Timing karaoke cho CHỮ GỐC từ word boundary của chữ ĐÃ ĐỌC.
 * @param {object} o
 * @param {string} o.original chữ hiện trên video @param {string} o.spoken chữ đã gửi TTS @param {Array} o.spans từ compilePronunciation
 * @param {Array<{text:string, offset:number, duration:number}>} o.boundaries đơn vị 100ns, theo chữ đã đọc
 * @param {string} o.language @param {"space"|"segmenter"} o.mode
 * @returns {Array<{t:string, s:number, d:number}>} giây, tính từ đầu clip CHƯA cắt (người gọi trừ trimStart)
 */
export function alignWords({ original, spoken, spans, boundaries, language, mode }) {
  const tokens = estimateTokens(original, { language, mode });
  // vị trí token trong chữ gốc
  const tokPos = [];
  let p = 0;
  for (const t of tokens) {
    const at = original.indexOf(t, p);
    const os = at === -1 ? p : at;
    tokPos.push({ os, oe: at === -1 ? p : at + t.length });
    p = tokPos.at(-1).oe;
  }
  // vị trí boundary trong chữ đã đọc
  const bPos = [];
  let q = 0;
  for (const b of boundaries) {
    const at = spoken.indexOf(b.text, q);
    if (at === -1) { bPos.push(null); continue; }
    bPos.push({ ss: at, se: at + b.text.length });
    q = at + b.text.length;
  }
  const secs = (b) => ({ s: b.offset / 1e7, e: (b.offset + b.duration) / 1e7 });
  const raw = tokens.map((t, i) => {
    const ss = mapOffset(spans, tokPos[i].os);
    const se = Math.max(ss + 1, mapOffset(spans, tokPos[i].oe));
    let s = Infinity;
    let e = -Infinity;
    boundaries.forEach((b, k) => {
      const bp = bPos[k];
      if (!bp || bp.ss >= se || bp.se <= ss) return;
      const t2 = secs(b);
      s = Math.min(s, t2.s);
      e = Math.max(e, t2.e);
    });
    return { t, s: Number.isFinite(s) ? s : null, e: Number.isFinite(e) ? e : null };
  });
  // token không có boundary (dấu câu/khoảng trống): nối liền sau token trước
  let prevEnd = boundaries.length ? secs(boundaries[0]).s : 0;
  for (const r of raw) {
    if (r.s === null) { r.s = prevEnd; r.e = prevEnd + 0.05; }
    prevEnd = Math.max(prevEnd, r.e);
  }
  // nhiều token dùng chung 1 boundary (vd "10" + "ct" -> "10カラット"): chia đều khoảng đó
  for (let i = 0; i < raw.length;) {
    let j = i + 1;
    while (j < raw.length && raw[j].s === raw[i].s && raw[j].e === raw[i].e) j++;
    if (j - i > 1) {
      const step = (raw[i].e - raw[i].s) / (j - i);
      for (let k = i; k < j; k++) { const s0 = raw[i].s + step * (k - i); raw[k].s = s0; raw[k].e = s0 + step; }
    }
    i = j;
  }
  return raw.map((r) => ({ t: r.t, s: r.s, d: Math.max(0.02, r.e - r.s) }));
}
