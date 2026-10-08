// Hệ thống thị trường (locale): mỗi thị trường = 1 file config/locales/<code>.json — thêm/bớt/sửa
// thị trường CHỈ bằng file JSON, không sửa code. File lỗi bị log rõ + tắt locale đó, KHÔNG crash.
//
// Thị trường mặc định = DEFAULT_LOCALE: process.env, rồi .env, rồi FALLBACK_LOCALE. (.env.example chỉ là tài liệu,
// KHÔNG phải nguồn cấu hình runtime nên không bao giờ được đọc ở đây.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeLogger } from "./fb-config.mjs";
import { loadFontRegistry, unknownFamilies } from "./fonts.mjs";
import { validatePronunciation } from "./tts/pronounce.mjs";

const log = makeLogger("locales");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const LOCALES_DIR = process.env.LOCALES_DIR || path.join(REPO_ROOT, "config", "locales");

// Giá trị cuối cùng khi DEFAULT_LOCALE không đặt / không hợp lệ — hằng DUY NHẤT của tên locale trong code.
export const FALLBACK_LOCALE = "vi-VN";

export const LIMIT_UNITS = ["grapheme", "word"];
// Cách chuẩn hoá hashtag: "ascii" (bỏ dấu, thường, chỉ a-z0-9 — vi, en) | "native" (giữ chữ bản địa: NFKC+NFC, bỏ khoảng
// trắng/ký tự đặc biệt — ja, th). Xem scripts/lib/hashtags.mjs normalizeTag.
export const HASHTAG_STYLES = ["ascii", "native"];

// Ngôn ngữ của người vận hành tool (UI + dòng "nghĩa" để kiểm soát nội dung). Thị trường có language khác ngôn ngữ này
// thì Gemini viết thêm `vi` (nghĩa tiếng Việt sát nghĩa) cho mọi field hiển thị.
export const GLOSS_LANGUAGE = "vi";
// Các giới hạn độ dài bắt buộc (số nguyên dương) + readingRate (số dương, đơn vị/giây).
// `unit` áp dụng cho title/label/point/tag/sub/material; topicTag/suggestedTag/hashtagTotal (hashtag) LUÔN đếm theo grapheme.
// unit "word" cần thêm `charsPerWord` để đổi sang maxLength (ký tự) trong response schema của Gemini.
export const LIMIT_KEYS = ["title", "label", "point", "tag", "sub", "topicTag", "suggestedTag", "material", "hashtagTotal"];
const PROMPT_STRING_KEYS = ["language", "languageDetailed", "titleLength", "pointLength", "materialExamples", "topicGroupsHint", "suggestedTagStyle"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
const isNonEmptyStr = (v) => isStr(v) && v.trim() !== "";
const isPosInt = (v) => Number.isInteger(v) && v > 0;
// Mục glossary: chuỗi thuật ngữ, hoặc object { term, ambiguous?, contexts? } cho khái niệm mơ hồ (vd "vàng" vừa là kim loại vừa là màu).
const isGlossaryEntry = (v) =>
  isNonEmptyStr(v) ||
  (isObj(v) && isNonEmptyStr(v.term) && (v.ambiguous === undefined || typeof v.ambiguous === "boolean") &&
    (v.contexts === undefined || (Array.isArray(v.contexts) && v.contexts.length > 0 && v.contexts.every(isNonEmptyStr))));

/**
 * Glossary dạng phẳng: [{ concept, term, ambiguous, contexts }].
 * - ambiguous: true  -> khái niệm mơ hồ, KHÔNG bao giờ cảnh báo lệch thuật ngữ (vẫn đưa vào prompt);
 * - contexts: [...]  -> chỉ kiểm khi dòng nghĩa tiếng Việt chứa 1 trong các cụm ngữ cảnh này.
 */
export function glossaryEntries(locale) {
  return Object.entries(locale.glossary).map(([concept, v]) =>
    typeof v === "string"
      ? { concept, term: v, ambiguous: false, contexts: null }
      : { concept, term: v.term, ambiguous: v.ambiguous === true, contexts: v.contexts ?? null },
  );
}

// Các khối cấu hình dựng video của 1 thị trường: fonts (chuỗi font theo registry assets/fonts/fonts.json), video (chữ cố định
// trên màn hình + kiểu chữ), layout (ngắt dòng + giới hạn khung chữ). Xem docs/video-text-layout.md.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const VIDEO_STRING_KEYS = ["htmlLang", "eyebrow", "docTitle", "hookLine", "payoffLine", "payoffTag", "payoffSub"];
export const LINE_BREAK_MODES = ["space", "segmenter"];
function validateVideoBlocks(raw, repoRoot, need) {
  const f = raw.fonts;
  if (!isObj(f)) {
    need(false, '"fonts" phải là object { display: [family...], mono: [family...] }');
  } else {
    let registry = null;
    try { registry = loadFontRegistry(path.join(repoRoot, "assets", "fonts")); } catch (e) { need(false, `không đọc được registry font assets/fonts/fonts.json: ${e.message}`); }
    for (const k of ["display", "mono"]) {
      const chain = f[k];
      need(Array.isArray(chain) && chain.length > 0 && chain.every(isNonEmptyStr), `"fonts.${k}" phải là mảng tên font không rỗng`);
      if (registry && Array.isArray(chain) && chain.every(isNonEmptyStr)) {
        const unknown = unknownFamilies(chain, registry);
        need(!unknown.length, `"fonts.${k}" có font không có trong assets/fonts/fonts.json: ${unknown.join(", ")}`);
      }
    }
  }

  const v = raw.video;
  if (!isObj(v)) {
    need(false, '"video" phải là object (chữ cố định + kiểu chữ trên màn hình)');
  } else {
    for (const k of VIDEO_STRING_KEYS) need(isNonEmptyStr(v[k]), `"video.${k}" phải là chuỗi không rỗng`);
    need(isStr(v.hookLine) && v.hookLine.includes("{label}"), '"video.hookLine" phải chứa {label}');
    need(isStr(v.payoffLine) && v.payoffLine.includes("{left}") && v.payoffLine.includes("{right}"), '"video.payoffLine" phải chứa {left} và {right}');
    need(isStr(v.docTitle) && v.docTitle.includes("{left}") && v.docTitle.includes("{right}"), '"video.docTitle" phải chứa {left} và {right}');
    need(v.channel === undefined || (isNonEmptyStr(v.channel) && v.channel.length <= 40), '"video.channel" (tên kênh hiện ở góc video) nếu khai báo phải là chuỗi không rỗng, tối đa 40 ký tự; bỏ trống = dùng CHANNEL trong .env');
    need(typeof v.italic === "boolean" && typeof v.uppercase === "boolean", '"video.italic" và "video.uppercase" phải là boolean');
  }

  if (raw.tts !== undefined) {
    const t = raw.tts;
    need(isObj(t) && Array.isArray(t.priority) && t.priority.length > 0 && t.priority.every((id) => isNonEmptyStr(id) && /^[a-z0-9-]+$/.test(id)),
      '"tts.priority" phải là mảng id engine (vd ["azure","edge"]) theo thứ tự ưu tiên');
    if (isObj(t)) {
      need(isObj(t.voices) && Object.entries(t.voices).every(([k, v]) => /^[a-z0-9-]+$/.test(k) && isNonEmptyStr(v)), '"tts.voices" phải là object { "<id engine>": "<tên giọng>" }');
      need(t.speed === undefined || (isNum(t.speed) && t.speed >= 0.5 && t.speed <= 2), '"tts.speed" phải trong 0.5..2');
      for (const p of validatePronunciation(t.pronunciation)) need(false, p);
    }
  }

  const l = raw.layout;
  if (!isObj(l)) {
    need(false, '"layout" phải là object { lineBreak, label, caption }');
    return;
  }
  need(isObj(l.lineBreak) && LINE_BREAK_MODES.includes(l.lineBreak.mode) && typeof l.lineBreak.kinsoku === "boolean" && typeof l.lineBreak.balance === "boolean",
    `"layout.lineBreak" phải là { mode: ${LINE_BREAK_MODES.map((m) => `"${m}"`).join(" | ")}, kinsoku: boolean, balance: boolean }`);
  const fitBox = (name, box, extra) => {
    if (!isObj(box)) { need(false, `"layout.${name}" phải là object`); return; }
    for (const k of ["fontPx", "minFontPx", "stepPx", ...extra]) need(isPosInt(box[k]), `"layout.${name}.${k}" phải là số nguyên dương`);
    need(isPosInt(box.fontPx) && isPosInt(box.minFontPx) && box.minFontPx <= box.fontPx, `"layout.${name}.minFontPx" không được lớn hơn fontPx`);
  };
  fitBox("label", l.label, ["maxLines", "maxUnitsPerLine"]);
  fitBox("caption", l.caption, ["maxTokens", "hardMaxTokens", "maxUnits", "clauseMinTokens"]);
  const c = l.caption;
  if (isObj(c)) {
    need(isPosInt(c.hardMaxTokens) && isPosInt(c.maxTokens) && c.hardMaxTokens >= c.maxTokens, '"layout.caption.hardMaxTokens" phải >= maxTokens');
    need(isStr(c.clauseEnders) && c.clauseEnders.length > 0, '"layout.caption.clauseEnders" phải là chuỗi các dấu ngắt vế');
    need(isStr(c.joiner) && (c.joiner === "" || c.joiner === " "), '"layout.caption.joiner" phải là "" hoặc " "');
    need(isNum(c.wordGapPx) && c.wordGapPx >= 0, '"layout.caption.wordGapPx" phải là số >= 0');
    need(isNum(c.activeScale) && c.activeScale >= 1 && c.activeScale <= 1.5, '"layout.caption.activeScale" phải trong 1..1.5');
    if (c.weakStartPattern !== undefined) {
      let okPattern = isNonEmptyStr(c.weakStartPattern);
      if (okPattern) { try { new RegExp(c.weakStartPattern, "u"); } catch { okPattern = false; } }
      need(okPattern, '"layout.caption.weakStartPattern" phải là regex hợp lệ (cờ u)');
    }
  }
}

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
  need(isNonEmptyStr(raw.flag), '"flag" phải là chuỗi không rỗng (emoji, chỉ làm dự phòng khi không có flagIcon)');
  need(raw.flagIcon === undefined || (isNonEmptyStr(raw.flagIcon) && raw.flagIcon.startsWith("/") && raw.flagIcon.toLowerCase().endsWith(".svg")),
    '"flagIcon" phải là đường dẫn file .svg bắt đầu bằng "/" (vd "/flags/ja-JP.svg", file nằm trong public/)');
  need(typeof raw.enabled === "boolean", '"enabled" phải là boolean');
  need(isStr(raw.slugSuffix) && /^[a-z0-9]+(-[a-z0-9]+)*$|^$/.test(raw.slugSuffix), '"slugSuffix" phải là chuỗi a-z0-9 (có thể rỗng)');
  need(isNonEmptyStr(raw.styleSummary), '"styleSummary" phải là chuỗi không rỗng (mô tả văn phong 1 dòng hiện ở UI)');
  need(isStr(raw.styleGuide), '"styleGuide" phải là chuỗi (có thể rỗng với thị trường mặc định)');

  validateVideoBlocks(raw, repoRoot, need);

  need(isObj(raw.glossary) && Object.keys(raw.glossary).every((k) => k.trim()) && Object.values(raw.glossary).every(isGlossaryEntry),
    '"glossary" phải là object { "<khái niệm tiếng Việt>": "<thuật ngữ đích>" | { "term": "...", "ambiguous"?: true, "contexts"?: ["<cụm tiếng Việt>"] } }');

  const lim = raw.limits;
  if (!isObj(lim)) {
    problems.push('"limits" phải là object');
  } else {
    need(LIMIT_UNITS.includes(lim.unit), `"limits.unit" phải là ${LIMIT_UNITS.map((u) => `"${u}"`).join(" | ")}`);
    for (const k of LIMIT_KEYS) need(isPosInt(lim[k]), `"limits.${k}" phải là số nguyên dương`);
    if (lim.unit === "word") need(isPosInt(lim.charsPerWord), '"limits.charsPerWord" phải là số nguyên dương khi unit = "word"');
    need(typeof lim.readingRate === "number" && Number.isFinite(lim.readingRate) && lim.readingRate > 0, '"limits.readingRate" phải là số dương');
  }

  need(Array.isArray(raw.forbiddenPhrases) && raw.forbiddenPhrases.every(isNonEmptyStr), '"forbiddenPhrases" phải là mảng chuỗi không rỗng');
  need(HASHTAG_STYLES.includes(raw.hashtagStyle), `"hashtagStyle" phải là ${HASHTAG_STYLES.map((s) => `"${s}"`).join(" | ")}`);
  need(isNonEmptyStr(raw.mixedGroup), '"mixedGroup" phải là chuỗi không rỗng (tên nhóm hashtag "kiến thức chung")');
  need(Array.isArray(raw.jewelryKeywords) && raw.jewelryKeywords.every(isNonEmptyStr), '"jewelryKeywords" phải là mảng chuỗi');

  const p = raw.prompt;
  if (!isObj(p)) {
    problems.push('"prompt" phải là object');
  } else {
    for (const k of PROMPT_STRING_KEYS) need(isNonEmptyStr(p[k]), `"prompt.${k}" phải là chuỗi không rỗng`);
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
  // Thiếu file cờ KHÔNG tắt locale: bỏ flagIcon, UI rơi về emoji `flag`.
  let flagIcon = raw.flagIcon ?? null;
  if (flagIcon && !fs.existsSync(path.join(repoRoot, "public", flagIcon))) {
    log.warn(`Locale "${raw.code}": không thấy file cờ public${flagIcon} — dùng emoji.`);
    flagIcon = null;
  }
  return { locale: Object.freeze({ ...raw, flagIcon, hashtagsPath }), problems };
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
const STAMP_CHECK_MS = 1000; // đừng quét thư mục ở MỖI lần gọi (hàm này nằm trong đường nóng chuẩn hoá hashtag)
function getRegistry() {
  const now = Date.now();
  if (registry && now - registry.checkedAt < STAMP_CHECK_MS) return registry;
  const stamp = dirStamp(LOCALES_DIR);
  if (!registry || registry.stamp !== stamp) registry = { stamp, ...loadLocales() };
  registry.checkedAt = now;
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

const dotenvCache = new Map();
/** Đọc 1 file .env thành object (cache theo mtime — hàm này được gọi cho mỗi lần chuẩn hoá hashtag). */
function readDotEnv(file) {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = dotenvCache.get(file);
    if (hit && hit.mtime === mtime) return hit.values;
    const values = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) values[m[1]] = m[2].trim();
    }
    dotenvCache.set(file, { mtime, values });
    return values;
  } catch {
    return {};
  }
}

/** process.env trước, rồi .env; KHÔNG đọc .env.example. */
function readEnvKey(key, env, envFile) {
  if (env[key] && String(env[key]).trim()) return String(env[key]).trim();
  return readDotEnv(envFile)[key] || "";
}

/** Code thị trường mặc định: DEFAULT_LOCALE hợp lệ & đang bật, không thì FALLBACK_LOCALE. */
export function defaultLocaleCode(env = process.env, { envFile = path.join(REPO_ROOT, ".env") } = {}) {
  const wanted = readEnvKey("DEFAULT_LOCALE", env, envFile);
  if (wanted && getLocale(wanted)) return wanted;
  if (wanted && !warnedBadDefault.has(wanted)) {
    warnedBadDefault.add(wanted);
    log.warn(`DEFAULT_LOCALE="${wanted}" không phải locale hợp lệ/đang bật — dùng "${FALLBACK_LOCALE}".`);
  }
  return FALLBACK_LOCALE;
}
const warnedBadDefault = new Set();

/** Thị trường này có cần dòng nghĩa tiếng Việt (`vi`) bên cạnh chữ ngôn ngữ đích không. */
export const needsGloss = (locale) => locale.language !== GLOSS_LANGUAGE;

/** Locale dùng làm nguồn "nghĩa" (từ khoá kim hoàn, giới hạn độ dài của dòng vi): locale đầu tiên có language = GLOSS_LANGUAGE. */
export const glossLocale = () => listLocales().find((l) => l.language === GLOSS_LANGUAGE);

/** Locale mặc định. Thiếu cả locale dự phòng -> throw (không có thị trường nào chạy được). */
export function getDefaultLocale(env = process.env, opts) {
  const code = defaultLocaleCode(env, opts);
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
