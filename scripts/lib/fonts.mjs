// Font cho video — MỘT NGUỒN: assets/fonts/fonts.json (registry) + file woff2 lưu local (giấy phép OFL, ghi ở assets/fonts/README.md).
// Mỗi thị trường khai báo chuỗi font trong config/locales/<code>.json → fonts.display / fonts.mono (tên family trong registry);
// font đầu có glyph thì thắng, thiếu glyph rơi xuống font kế tiếp rồi tới generic (sans-serif / monospace).
// KHÔNG tải CDN lúc render: scaffold copy đúng các file được dùng vào videos/<slug>/assets/fonts/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FONTS_DIR = process.env.FONTS_DIR || path.join(__dirname, "..", "..", "assets", "fonts");
/** Thư mục font trong từng project video (đường dẫn tương đối dùng trong CSS: assets/fonts/<file>). */
export const VIDEO_FONTS_SUBDIR = path.join("assets", "fonts");
/** Cảnh báo kích thước: file font > ngưỡng này thì phải subset (xem scripts/fonts/build_fonts.py). */
export const MAX_FONT_BYTES = 5 * 1024 * 1024;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";

/** Kiểm tra registry thô. Trả danh sách lỗi (rỗng = hợp lệ). `dir` để kiểm file tồn tại + dung lượng. */
export function validateRegistry(raw, dir = FONTS_DIR) {
  const problems = [];
  if (!isObj(raw) || !isObj(raw.families) || !Object.keys(raw.families).length) return ['"families" phải là object không rỗng'];
  for (const [family, def] of Object.entries(raw.families)) {
    if (!isObj(def) || !isNonEmptyStr(def.license) || !Array.isArray(def.faces) || !def.faces.length) {
      problems.push(`${family}: cần "license" và "faces" (mảng không rỗng)`);
      continue;
    }
    for (const face of def.faces) {
      if (!isNonEmptyStr(face.file) || !Number.isInteger(face.weight) || !["normal", "italic"].includes(face.style)) {
        problems.push(`${family}: face cần file/weight(số nguyên)/style(normal|italic)`);
        continue;
      }
      const abs = path.join(dir, face.file);
      if (!fs.existsSync(abs)) problems.push(`${family}: không thấy file ${face.file}`);
      else if (fs.statSync(abs).size > MAX_FONT_BYTES) problems.push(`${family}: ${face.file} > 5MB — phải subset`);
    }
  }
  return problems;
}

let cache = null;
/** Đọc registry (cache theo mtime). Lỗi -> throw (video không dựng được nếu thiếu font). */
export function loadFontRegistry(dir = FONTS_DIR) {
  const file = path.join(dir, "fonts.json");
  const mtime = fs.statSync(file).mtimeMs;
  if (cache && cache.file === file && cache.mtime === mtime) return cache.registry;
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = validateRegistry(raw, dir);
  if (problems.length) throw new Error(`assets/fonts/fonts.json lỗi: ${problems.join("; ")}`);
  const registry = { dir, families: raw.families };
  cache = { file, mtime, registry };
  return registry;
}

/** Tên family trong chuỗi `chain` chưa có trong registry (để validate config locale). */
export function unknownFamilies(chain, registry = loadFontRegistry()) {
  return chain.filter((f) => !Object.hasOwn(registry.families, f));
}

/** `font-family` CSS: "A", "B", generic. */
export function fontStack(chain, generic) {
  return [...chain.map((f) => `"${f}"`), generic].join(", ");
}

/** Các family (không trùng, giữ thứ tự) mà 1 thị trường dùng cho video. */
export function familiesOfLocale(locale) {
  return [...new Set([...locale.fonts.display, ...locale.fonts.mono])];
}

const urange = (face) => (face.unicodeRange ? `\n        unicode-range: ${face.unicodeRange};` : "");

/**
 * Khối @font-face cho các family — file nằm ở `<urlPrefix><file>` (mặc định assets/fonts/, tương đối với index.html).
 * font-display: block để khung chụp không bao giờ lộ chữ dự phòng khi font chưa nạp xong.
 */
export function fontFaceCss(families, { urlPrefix = "assets/fonts/", registry = loadFontRegistry() } = {}) {
  const out = [];
  for (const family of families) {
    for (const face of registry.families[family].faces) {
      out.push(
        `      @font-face {\n        font-family: "${family}";\n        font-style: ${face.style};\n        font-weight: ${face.weight};\n        font-display: block;\n` +
          `        src: url(${urlPrefix}${face.file}) format("woff2");${urange(face)}\n      }`,
      );
    }
  }
  return out.join("\n");
}

/** Mọi file (face + giấy phép + coverage) của các family — để copy vào project video. */
export function fontFilesFor(families, registry = loadFontRegistry()) {
  const files = new Set();
  for (const family of families) {
    for (const face of registry.families[family].faces) {
      files.add(face.file);
      const dir = path.dirname(face.file);
      const license = path.join(dir, "OFL.txt");
      if (fs.existsSync(path.join(registry.dir, license))) files.add(license.split(path.sep).join("/"));
    }
  }
  return [...files];
}

/** Copy font được dùng vào `<videoDir>/assets/fonts/` (giữ thư mục con). Trả danh sách file đã copy (tương đối). */
export function copyFontsToVideo(videoDir, families, registry = loadFontRegistry()) {
  const copied = [];
  for (const rel of fontFilesFor(families, registry)) {
    const dst = path.join(videoDir, VIDEO_FONTS_SUBDIR, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(registry.dir, rel), dst);
    copied.push(rel);
  }
  return copied;
}

/** Tập codepoint font thực sự vẽ được (glyph có trong file ∩ unicode-range khai báo) — đọc từ file *.coverage.json cạnh woff2. */
export function coverageSet(family, registry = loadFontRegistry()) {
  const runs = [];
  for (const face of registry.families[family].faces) {
    const f = path.join(registry.dir, face.file.replace(/\.woff2$/, ".coverage.json"));
    if (!fs.existsSync(f)) continue;
    runs.push(...JSON.parse(fs.readFileSync(f, "utf8")).ranges);
  }
  runs.sort((a, b) => a[0] - b[0]);
  return (cp) => {
    let lo = 0;
    let hi = runs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cp < runs[mid][0]) hi = mid - 1;
      else if (cp > runs[mid][1]) lo = mid + 1;
      else return true;
    }
    return false;
  };
}

// Ký tự điều khiển / khoảng trắng / dấu kết hợp không cần glyph riêng khi kiểm "ô vuông".
const IGNORABLE = /[\p{Cc}\p{Cf}\s]/u;

/**
 * Ký tự trong `text` mà KHÔNG font nào trong `chain` có glyph (sẽ hiện ô vuông / tofu). Trả mảng ký tự duy nhất.
 * Không có coverage cho cả chuỗi (font thiếu file *.coverage.json) -> coi như phủ hết (không đoán bừa).
 */
export function uncoveredChars(text, chain, registry = loadFontRegistry()) {
  const checks = chain.map((f) => coverageSet(f, registry));
  const bad = new Set();
  for (const ch of String(text ?? "")) {
    if (IGNORABLE.test(ch)) continue;
    const cp = ch.codePointAt(0);
    if (!checks.some((has) => has(cp))) bad.add(ch);
  }
  return [...bad];
}
