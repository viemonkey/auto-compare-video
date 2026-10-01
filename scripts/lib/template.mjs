// Engine template tối giản cho prompt Gemini (xem prompts/compare-content.md để biết cú pháp).
// Cố ý nhỏ và nghiêm: placeholder không có giá trị -> THROW (không bao giờ gửi "{{x}}" lên Gemini).
import fs from "node:fs";

/** Tách file template thành các phần theo dòng `@@@ <tên>`. Phần trước `@@@` đầu tiên là ghi chú. */
export function parseTemplateFile(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const sections = {};
  let name = null;
  let buf = [];
  const flush = () => {
    if (name === null) return;
    // phần chính: bỏ dòng trống đầu/cuối; fragment: chỉ bỏ dòng trống cuối (khoảng trắng đầu có nghĩa)
    let body = buf.join("\n");
    body = name.startsWith("fragment.") ? body.replace(/\n+$/, "") : body.replace(/^\n+|\n+$/g, "");
    sections[name] = body;
  };
  for (const line of lines) {
    const m = /^@@@\s+(\S+)\s*$/.exec(line);
    if (m) {
      flush();
      name = m[1];
      buf = [];
    } else if (name !== null) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

const cache = new Map();
/** Nạp + parse file template (cache theo mtime). Thiếu file/phần -> throw rõ ràng. */
export function loadTemplateFile(file) {
  const mtime = fs.statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.sections;
  const sections = parseTemplateFile(fs.readFileSync(file, "utf8"));
  cache.set(file, { mtime, sections });
  return sections;
}

function lookup(vars, dotted) {
  let cur = vars;
  for (const part of dotted.split(".")) {
    if (cur === null || cur === undefined || !Object.prototype.hasOwnProperty.call(Object(cur), part)) {
      throw new Error(`Template: thiếu giá trị cho placeholder "{{${dotted}}}"`);
    }
    cur = cur[part];
  }
  return cur;
}

const isEmpty = (v) =>
  v === undefined || v === null || v === false || v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

const stringify = (v) => (typeof v === "string" ? v : String(v));

/**
 * Điền biến vào template.
 * - `{{a.b}}`            giá trị (số/chuỗi)
 * - `{{#x}}..{{/x}}`     in khi x không rỗng;  `{{^x}}..{{/x}}` in khi x rỗng
 *   (thẻ mở/đóng nằm riêng 1 dòng -> bỏ nguyên dòng thẻ)
 */
export function renderTemplate(template, vars) {
  let out = String(template);
  // khối "riêng dòng" trước, rồi khối cùng dòng; lặp để xử lý khối lồng nhau
  const standalone = /^[ \t]*\{\{([#^])([\w.]+)\}\}[ \t]*\n([\s\S]*?)^[ \t]*\{\{\/\2\}\}[ \t]*(?:\n|$)/m;
  const inline = /\{\{([#^])([\w.]+)\}\}([\s\S]*?)\{\{\/\2\}\}/;
  const section = (m, kind, name, inner) => {
    const empty = isEmpty(lookup(vars, name));
    return (kind === "#" ? !empty : empty) ? inner : "";
  };
  for (let guard = 0; guard < 1000; guard++) {
    if (standalone.test(out)) out = out.replace(standalone, section);
    else if (inline.test(out)) out = out.replace(inline, section);
    else break;
  }
  return out.replace(/\{\{([\w.]+)\}\}/g, (_m, name) => {
    const v = lookup(vars, name);
    if (v !== null && typeof v === "object") throw new Error(`Template: "{{${name}}}" là object/mảng, cần chuỗi hoặc số`);
    return stringify(v ?? "");
  });
}
