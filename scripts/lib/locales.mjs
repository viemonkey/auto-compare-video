// Hệ thống thị trường (locale): mỗi thị trường = 1 file config/locales/<code>.json — thêm/bớt/sửa
// thị trường CHỈ bằng file JSON, không sửa code. File lỗi bị log rõ + tắt locale đó, KHÔNG crash.
//
// Thị trường mặc định = DEFAULT_LOCALE (process.env, rồi .env, rồi .env.example — cùng quy ước
// templates/auto-compare/generate-vo.mjs). Không đặt -> FALLBACK_LOCALE.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeLogger } from "./fb-config.mjs";

const log = makeLogger("locales");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const LOCALES_DIR = process.env.LOCALES_DIR || path.join(REPO_ROOT, "config", "locales");

// Giá trị cuối cùng khi DEFAULT_LOCALE không đặt / không hợp lệ — hằng DUY NHẤT của tên locale trong code.
export const FALLBACK_LOCALE = "vi-VN";

export const LIMIT_UNITS = ["grapheme", "word"];
// Các giới hạn độ dài bắt buộc (số nguyên dương) + readingRate (số dương, đơn vị/giây).
export const LIMIT_KEYS = ["title", "label", "point", "tag", "sub", "topicTag", "suggestedTag", "material", "hashtagTotal"];
const PROMPT_STRING_KEYS = ["language", "languageDetailed", "materialExamples", "topicGroupsHint", "suggestedTagStyle"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
const isNonEmptyStr = (v) => isStr(v) && v.trim() !== "";
const isPosInt = (v) => Number.isInteger(v) && v > 0;

/**
 * Kiểm tra 1 locale thô. Trả { locale, problems }: problems rỗng = hợp lệ.
 * @param {object} raw
 * @param {{repoRoot?: string}} [opts]
 */
export function validateLocale(raw, { repoRoot = REPO_ROOT } = {}) {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(msg); };

  if (!isObj(raw)) return { locale: null, problems: ["nội dung file phải là 1 object JSON"] };

  need(isStr(raw.code) && /^[a-z]{2,3}-[A-Z]{2}$/.test(raw.code), '"code" phải dạng "xx-XX" (vd "ja-JP")');
  need(
    isNonEmptyStr(raw.language) && (() => { try { return Intl.getCanonicalLocales(raw.language).length === 1; } catch { return false; } })(),
    '"language" phải là mã BCP-47 hợp lệ (vd "ja")',
  );
  need(isStr(raw.script) && /^[A-Z][a-z]{3}$/.test(raw.script), '"script" phải là mã ISO 15924 4 chữ (vd "Latn", "Jpan", "Thai")');
  need(isNonEmptyStr(raw.displayName), '"displayName" phải là chuỗi không rỗng');
  need(isNonEmptyStr(raw.flag), '"flag" phải là chuỗi không rỗng');
  need(typeof raw.enabled === "boolean", '"enabled" phải là boolean');
  need(isStr(raw.slugSuffix) && /^[a-z0-9]+(-[a-z0-9]+)*$|^$/.test(raw.slugSuffix), '"slugSuffix" phải là chuỗi a-z0-9 (có thể rỗng)');
  need(isStr(raw.styleGuide), '"styleGuide" phải là chuỗi (có thể rỗng với thị trường mặc định)');

  need(isObj(raw.glossary) && Object.values(raw.glossary).every(isNonEmptyStr) && Object.keys(raw.glossary).every((k) => k.trim()),
    '"glossary" phải là object { "<khái niệm tiếng Việt>": "<thuật ngữ đích>" }');

  const lim = raw.limits;
  if (!isObj(lim)) {
    problems.push('"limits" phải là object');
  } else {
    need(LIMIT_UNITS.includes(lim.unit), `"limits.unit" phải là ${LIMIT_UNITS.map((u) => `"${u}"`).join(" | ")}`);
    for (const k of LIMIT_KEYS) need(isPosInt(lim[k]), `"limits.${k}" phải là số nguyên dương`);
    need(typeof lim.readingRate === "number" && Number.isFinite(lim.readingRate) && lim.readingRate > 0, '"limits.readingRate" phải là số dương');
  }

  need(Array.isArray(raw.forbiddenPhrases) && raw.forbiddenPhrases.every(isNonEmptyStr), '"forbiddenPhrases" phải là mảng chuỗi không rỗng');
  need(isNonEmptyStr(raw.mixedGroup), '"mixedGroup" phải là chuỗi không rỗng (tên nhóm hashtag "kiến thức chung")');
  need(Array.isArray(raw.jewelryKeywords) && raw.jewelryKeywords.every(isNonEmptyStr), '"jewelryKeywords" phải là mảng chuỗi');

  const p = raw.prompt;
  if (!isObj(p)) {
    problems.push('"prompt" phải là object');
  } else {
    for (const k of PROMPT_STRING_KEYS) need(isNonEmptyStr(p[k]), `"prompt.${k}" phải là chuỗi không rỗng`);
    need(isPosInt(p.titleWords), '"prompt.titleWords" phải là số nguyên dương');
    need(isPosInt(p.pointWords), '"prompt.pointWords" phải là số nguyên dương');
    need(isObj(p.example) && ["text", "tag", "sub"].every((k) => isNonEmptyStr(p.example[k])), '"prompt.example" phải có text/tag/sub không rỗng');
  }

  if (!isNonEmptyStr(raw.hashtags)) {
    problems.push('"hashtags" phải là đường dẫn tới config/hashtags/<code>.json');
  } else {
    const abs = path.isAbsolute(raw.hashtags) ? raw.hashtags : path.join(repoRoot, raw.hashtags);
    if (!fs.existsSync(abs)) problems.push(`"hashtags" trỏ tới file không tồn tại: ${raw.hashtags}`);
  }

  if (problems.length) return { locale: null, problems };

  const hashtagsPath = path.isAbsolute(raw.hashtags) ? raw.hashtags : path.join(repoRoot, raw.hashtags);
  return { locale: Object.freeze({ ...raw, hashtagsPath }), problems };
}

/**
 * Đọc mọi file *.json trong thư mục locales. File lỗi -> log + bỏ qua (KHÔNG throw).
 * Tên file phải khớp "code" bên trong; trùng code -> giữ file đầu, log file sau.
 * @returns {{locales: Map<string, object>, errors: Array<{file:string, problems:string[]}>}}
 */
export function loadLocales({ dir = LOCALES_DIR, repoRoot = REPO_ROOT, quiet = false } = {}) {
  const locales = new Map();
  const errors = [];
  const fail = (file, problems) => {
    errors.push({ file, problems });
    if (!quiet) log.error(`Locale "${file}" bị tắt: ${problems.join("; ")}`);
  };

  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch (e) {
    fail(dir, [`không đọc được thư mục locales: ${e.message}`]);
    return { locales, errors };
  }

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (e) {
      fail(file, [`JSON không hợp lệ: ${e.message}`]);
      continue;
    }
    const { locale, problems } = validateLocale(raw, { repoRoot });
    if (!locale) { fail(file, problems); continue; }
    if (path.basename(file, ".json") !== locale.code) {
      fail(file, [`tên file phải là "${locale.code}.json" (khớp "code")`]);
      continue;
    }
    if (locales.has(locale.code)) { fail(file, [`trùng code "${locale.code}"`]); continue; }
    locales.set(locale.code, locale);
  }
  return { locales, errors };
}

// ---------------------------------------------------------------------------------------------
// Registry dùng chung (cache theo mtime thư mục + các file con)
// ---------------------------------------------------------------------------------------------
let registry = null;
function dirStamp(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
      .map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`).join("|");
  } catch {
    return "";
  }
}
function getRegistry() {
  const stamp = dirStamp(LOCALES_DIR);
  if (!registry || registry.stamp !== stamp) {
    registry = { stamp, ...loadLocales() };
  }
  return registry;
}

/** Locale theo code (chỉ locale hợp lệ và đang bật); không có -> undefined. */
export function getLocale(code) {
  const l = getRegistry().locales.get(code);
  return l && l.enabled ? l : undefined;
}

/** Mọi locale hợp lệ + đang bật, sắp theo code. */
export function listLocales() {
  return [...getRegistry().locales.values()].filter((l) => l.enabled).sort((a, b) => a.code.localeCompare(b.code));
}

/** Lỗi validate của các file locale (để hiển thị/log lúc khởi động). */
export function localeErrors() {
  return getRegistry().errors;
}

function readEnvKey(key, env = process.env) {
  if (env[key] && String(env[key]).trim()) return String(env[key]).trim();
  for (const f of [".env", ".env.example"]) {
    try {
      const m = new RegExp(`^${key}=(.*)$`, "m").exec(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));
      if (m && m[1].trim()) return m[1].trim();
    } catch {
      // thử file kế tiếp
    }
  }
  return "";
}

/** Code thị trường mặc định: DEFAULT_LOCALE hợp lệ & đang bật, không thì FALLBACK_LOCALE. */
export function defaultLocaleCode(env = process.env) {
  const wanted = readEnvKey("DEFAULT_LOCALE", env);
  if (wanted && getLocale(wanted)) return wanted;
  if (wanted) log.warn(`DEFAULT_LOCALE="${wanted}" không phải locale hợp lệ/đang bật — dùng "${FALLBACK_LOCALE}".`);
  return FALLBACK_LOCALE;
}

/** Locale mặc định. Thiếu cả locale dự phòng -> throw (không có thị trường nào chạy được). */
export function getDefaultLocale(env = process.env) {
  const code = defaultLocaleCode(env);
  const l = getLocale(code);
  if (!l) {
    const detail = getRegistry().errors.map((e) => `${e.file}: ${e.problems.join("; ")}`).join(" | ");
    throw new Error(`Không có locale mặc định "${code}" (config/locales/${code}.json thiếu hoặc lỗi). ${detail}`);
  }
  return l;
}

/** Locale theo code; code rỗng/không có -> mặc định (dữ liệu cũ thiếu `locale` coi là mặc định). */
export function resolveLocale(code) {
  if (code === undefined || code === null || code === "") return getDefaultLocale();
  const l = getLocale(code);
  if (!l) throw new Error(`Locale "${code}" không tồn tại hoặc đang bị tắt (xem config/locales/).`);
  return l;
}
