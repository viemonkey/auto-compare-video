// Trích nguyên văn mã nguồn 1 hàm/const top-level từ file .mjs không import được trong test
// (vd scaffold-compare-video.mjs tự chạy main(), generate-compare-content.mjs process.exit khi thiếu
// GEMINI_API_KEY). Chỉ dùng cho golden test của refactor M0 — sau khi hàm được tách ra module
// riêng thì test import trực tiếp.
import fs from "node:fs";

// Duyệt từ `from`, bỏ qua chuỗi/comment; gọi onChar(c, i, depth) với depth sau khi xử lý ngoặc.
// Dừng khi onChar trả về số (vị trí kết thúc).
function scan(src, from, onChar) {
  let depth = 0;
  let inStr = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    const end = onChar(c, i, depth);
    if (typeof end === "number") return end;
  }
  throw new Error("Không khớp ngoặc");
}

export function extractSource(file, name) {
  const src = fs.readFileSync(file, "utf8");
  const re = new RegExp(`^(?:async\\s+)?(?:function\\s+${name}\\b|const\\s+${name}\\b)`, "m");
  const m = re.exec(src);
  if (!m) throw new Error(`Không thấy "${name}" trong ${file}`);
  const isConst = src.startsWith("const", m.index);
  let end;
  if (isConst) {
    end = scan(src, m.index, (c, i, depth) => (c === ";" && depth === 0 ? i + 1 : undefined));
  } else {
    // bỏ qua tham số (có thể chứa destructuring {}), rồi khớp thân hàm
    let paramsClosed = false;
    let bodyOpened = false;
    end = scan(src, m.index, (c, i, depth) => {
      if (!paramsClosed) { if (c === ")" && depth === 0) paramsClosed = true; return undefined; }
      if (!bodyOpened) { if (c === "{") bodyOpened = true; return undefined; }
      return c === "}" && depth === 0 ? i + 1 : undefined;
    });
  }
  return src.slice(m.index, end);
}

/** Dựng các hàm đã trích thành 1 object; `deps` = các tên bên ngoài hàm cần (import/hằng). */
export function loadExtracted(file, names, deps = {}) {
  const body = names.map((n) => extractSource(file, n)).join("\n");
  const depNames = Object.keys(deps);
  const factory = new Function(...depNames, `${body}\nreturn { ${names.join(", ")} };`);
  return factory(...depNames.map((k) => deps[k]));
}
