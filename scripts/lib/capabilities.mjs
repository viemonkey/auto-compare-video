// Khả năng render của từng thị trường — MỘT NGUỒN SỰ THẬT, tính phía server từ khai báo:
//   - mỗi TTS engine (config/tts-engines/<id>.json) khai báo `languages` nó đọc được;
//   - mỗi theme video (config/themes/<id>.json) khai báo `scripts` (hệ chữ) font của nó hỗ trợ;
//   - locale KHÔNG liệt kê engine/theme, chỉ có `language` + `script`.
// Locale render được khi có >= 1 engine hỗ trợ ngôn ngữ VÀ theme hỗ trợ script (font) VÀ theme hỗ trợ language
// (`languages` = ngôn ngữ mà pipeline dựng video của theme đó đã được kiểm chứng). Không dùng cờ cứng.
// File lỗi -> log rõ + tắt mục đó, KHÔNG crash (giống config/locales).
import fs from "node:fs";
import path from "node:path";
import { makeLogger } from "./fb-config.mjs";
import { REPO_ROOT } from "./locales.mjs";

const log = makeLogger("capabilities");

export const TTS_ENGINES_DIR = process.env.TTS_ENGINES_DIR || path.join(REPO_ROOT, "config", "tts-engines");
export const THEMES_DIR = process.env.THEMES_DIR || path.join(REPO_ROOT, "config", "themes");

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";
const isStrArray = (v, { nonEmpty = false } = {}) => Array.isArray(v) && (!nonEmpty || v.length > 0) && v.every(isNonEmptyStr);
const isLangCode = (v) => isNonEmptyStr(v) && /^[a-z]{2,3}$/.test(v);
const isLocaleCode = (v) => typeof v === "string" && /^[a-z]{2,3}-[A-Z]{2}$/.test(v);

export function validateEngine(raw) {
  const problems = [];
  const need = (c, m) => { if (!c) problems.push(m); };
  if (!isObj(raw)) return { engine: null, problems: ["nội dung file phải là 1 object JSON"] };
  need(isNonEmptyStr(raw.id) && /^[a-z0-9-]+$/.test(raw.id), '"id" phải là chuỗi a-z0-9-');
  need(isNonEmptyStr(raw.label), '"label" phải là chuỗi không rỗng');
  need(typeof raw.enabled === "boolean", '"enabled" phải là boolean');
  need(raw.order === undefined || Number.isInteger(raw.order), '"order" phải là số nguyên (nhỏ hơn = đứng trước, engine đầu tiên là mặc định)');
  need(Array.isArray(raw.languages) && raw.languages.length > 0 && raw.languages.every(isLangCode), '"languages" phải là mảng mã ngôn ngữ (vd ["vi","ja"]), không rỗng');
  need(Array.isArray(raw.modes) && raw.modes.length > 0 && raw.modes.every((m) => isObj(m) && isNonEmptyStr(m.id) && isNonEmptyStr(m.label)),
    '"modes" phải là mảng {id,label}, không rỗng');
  if (raw.defaultVoices !== undefined) {
    need(isObj(raw.defaultVoices) && Object.entries(raw.defaultVoices).every(([k, v]) => isLocaleCode(k) && isNonEmptyStr(v)),
      '"defaultVoices" phải là object { "<mã locale>": "<voice>" }');
  }
  if (raw.voices !== undefined) {
    need(isObj(raw.voices) && Object.entries(raw.voices).every(([k, list]) => isLocaleCode(k) && Array.isArray(list) && list.every((v) => isObj(v) && isNonEmptyStr(v.id) && isNonEmptyStr(v.label))),
      '"voices" phải là object { "<mã locale>": [{id,label}] }');
  }
  if (raw.voiceFallback !== undefined) need(isObj(raw.voiceFallback) && isNonEmptyStr(raw.voiceFallback.id) && isNonEmptyStr(raw.voiceFallback.label), '"voiceFallback" phải là {id,label}');
  if (raw.voicesFile !== undefined) need(isNonEmptyStr(raw.voicesFile), '"voicesFile" phải là đường dẫn');
  if (raw.requires !== undefined) {
    need(isObj(raw.requires) && (raw.requires.env === undefined || isStrArray(raw.requires.env)) && (raw.requires.paths === undefined || isStrArray(raw.requires.paths)) &&
      (raw.requires.hint === undefined || isNonEmptyStr(raw.requires.hint)), '"requires" phải là { env?: string[], paths?: string[], hint?: string }');
  }
  return problems.length ? { engine: null, problems } : { engine: Object.freeze({ ...raw }), problems };
}

export function validateTheme(raw) {
  const problems = [];
  const need = (c, m) => { if (!c) problems.push(m); };
  if (!isObj(raw)) return { theme: null, problems: ["nội dung file phải là 1 object JSON"] };
  need(isNonEmptyStr(raw.id) && /^[a-z0-9-]+$/.test(raw.id), '"id" phải là chuỗi a-z0-9-');
  need(isNonEmptyStr(raw.name), '"name" phải là chuỗi không rỗng (tên ngắn hiện trong thông báo)');
  need(isNonEmptyStr(raw.label), '"label" phải là chuỗi không rỗng');
  need(typeof raw.enabled === "boolean", '"enabled" phải là boolean');
  need(raw.order === undefined || Number.isInteger(raw.order), '"order" phải là số nguyên (nhỏ hơn = đứng trước)');
  need(raw.default === undefined || typeof raw.default === "boolean", '"default" phải là boolean');
  need(Array.isArray(raw.scripts) && raw.scripts.length > 0 && raw.scripts.every((s) => typeof s === "string" && /^[A-Z][a-z]{3}$/.test(s)),
    '"scripts" phải là mảng mã ISO 15924 (vd ["Latn"]), không rỗng');
  need(Array.isArray(raw.languages) && raw.languages.length > 0 && raw.languages.every(isLangCode),
    '"languages" phải là mảng mã ngôn ngữ mà pipeline dựng video đã kiểm chứng (vd ["vi"]), không rỗng');
  if (raw.frames !== undefined) {
    const num = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
    const f = raw.frames;
    need(isObj(f) && isObj(f.label) && isObj(f.caption), '"frames" phải có label và caption (hình học khung chữ trong video)');
    if (isObj(f) && isObj(f.label)) need(num(f.label.widthPx) && num(f.label.lineHeight) && (f.label.maxHeightPx === undefined || num(f.label.maxHeightPx)), '"frames.label" cần widthPx, lineHeight (số dương), maxHeightPx tuỳ chọn');
    if (isObj(f) && isObj(f.caption)) need(num(f.caption.widthPx), '"frames.caption.widthPx" phải là số dương');
  }
  return problems.length ? { theme: null, problems } : { theme: Object.freeze({ ...raw }), problems };
}

/** Đọc mọi *.json trong `dir`, validate bằng `validate` (trả {item, problems}); lỗi -> log + bỏ qua. */
export function loadRegistry(dir, validate, kind, { quiet = false } = {}) {
  const items = new Map();
  const errors = [];
  const fail = (file, problems) => {
    errors.push({ file, problems });
    if (!quiet) log.error(`${kind} "${file}" bị tắt: ${problems.join("; ")}`);
  };
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch (e) {
    fail(dir, [`không đọc được thư mục: ${e.message}`]);
    return { items, errors };
  }
  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch (e) {
      fail(file, [`JSON không hợp lệ: ${e.message}`]);
      continue;
    }
    const { item, problems } = validate(raw);
    if (!item) { fail(file, problems); continue; }
    if (path.basename(file, ".json") !== item.id) { fail(file, [`tên file phải là "${item.id}.json" (khớp "id")`]); continue; }
    if (items.has(item.id)) { fail(file, [`trùng id "${item.id}"`]); continue; }
    items.set(item.id, item);
  }
  return { items, errors };
}

const loadEngines = (opts = {}) => {
  const r = loadRegistry(opts.dir || TTS_ENGINES_DIR, (raw) => { const v = validateEngine(raw); return { item: v.engine, problems: v.problems }; }, "TTS engine", opts);
  return { engines: r.items, errors: r.errors };
};
const loadThemes = (opts = {}) => {
  const r = loadRegistry(opts.dir || THEMES_DIR, (raw) => { const v = validateTheme(raw); return { item: v.theme, problems: v.problems }; }, "Theme", opts);
  return { themes: r.items, errors: r.errors };
};
export { loadEngines, loadThemes };

// Cache theo mtime các file con, kiểm tra tối đa 1 lần/giây.
const caches = new Map();
function cached(dir, loader) {
  const now = Date.now();
  let c = caches.get(dir);
  if (c && now - c.checkedAt < 1000) return c.value;
  let stamp = "";
  try {
    stamp = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`).join("|");
  } catch {
    // thư mục thiếu -> loader sẽ báo lỗi
  }
  if (!c || c.stamp !== stamp) c = { stamp, value: loader() };
  c.checkedAt = now;
  caches.set(dir, c);
  return c.value;
}

// Sắp theo `order` (mặc định 100) rồi theo id — engine/theme đầu tiên dùng được là lựa chọn mặc định trên UI.
const byOrder = (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id);
export const listEngines = () => [...cached(TTS_ENGINES_DIR, () => loadEngines()).engines.values()].filter((e) => e.enabled).sort(byOrder);
export const listThemes = () => [...cached(THEMES_DIR, () => loadThemes()).themes.values()].filter((t) => t.enabled).sort(byOrder);
export const getEngine = (id) => listEngines().find((e) => e.id === id);
export const capabilityErrors = () => [...cached(TTS_ENGINES_DIR, () => loadEngines()).errors, ...cached(THEMES_DIR, () => loadThemes()).errors];

/** Theme mặc định của UI: theme có `default: true`, không có thì theme đầu tiên. */
export function getDefaultTheme(themes = listThemes()) {
  return themes.find((t) => t.default) || themes[0];
}

export const enginesForLanguage = (language, engines = listEngines()) => engines.filter((e) => e.languages.includes(language));
export const themeSupportsScript = (theme, script) => theme.scripts.includes(script);
export const themeSupportsLanguage = (theme, language) => theme.languages.includes(language);

// ISO 15924 là dữ liệu cấu hình nội bộ. Thông báo cho người dùng phải dùng tên dễ hiểu;
// locale mới/chưa biết vẫn có câu dự phòng thay vì lộ mã kỹ thuật như "Jpan".
const SCRIPT_NAMES_VI = Object.freeze({
  Latn: "chữ La-tinh",
  Jpan: "chữ Nhật",
  Thai: "chữ Thái",
  Hans: "chữ Hán giản thể",
  Hant: "chữ Hán phồn thể",
  Kore: "chữ Hàn",
});
export const scriptNameVi = (script) => SCRIPT_NAMES_VI[script] || "hệ chữ của thị trường này";

/** Engine đã sẵn sàng chạy chưa (đủ biến môi trường / thư mục cài đặt)? Khai báo trong engine.requires. */
export function engineReadiness(engine, { env = process.env, repoRoot = REPO_ROOT } = {}) {
  const req = engine.requires || {};
  const missing = [];
  for (const k of req.env || []) if (!String(env[k] || "").trim()) missing.push(k);
  for (const p of req.paths || []) if (!fs.existsSync(path.join(repoRoot, p))) missing.push(p);
  if (!missing.length) return { ready: true, reason: "" };
  return { ready: false, reason: `Thiếu ${missing.join(", ")}.${req.hint ? ` ${req.hint}` : ""}` };
}

/** Giọng mặc định của engine cho 1 locale (từ config, không hard-code); không khai báo -> undefined. */
export const defaultVoiceFor = (engine, localeCode) => engine.defaultVoices?.[localeCode];

/**
 * Locale `locale` có render được với theme `themeId` (mặc định: theme mặc định) không?
 * @returns {{renderable:boolean, engines:string[], themeId:string|null, blockers:Array<{kind:"tts"|"theme"|"pipeline", message:string}>}}
 */
export function checkRenderability(locale, { themeId, engines = listEngines(), themes = listThemes() } = {}) {
  const blockers = [];
  const supporting = enginesForLanguage(locale.language, engines);
  if (!supporting.length) {
    blockers.push({ kind: "tts", message: `Chưa có giọng đọc (TTS) hỗ trợ ${locale.displayName} (${locale.language}).` });
  }
  const theme = (themeId && themes.find((t) => t.id === themeId)) || getDefaultTheme(themes);
  if (!theme) {
    blockers.push({ kind: "theme", message: "Không có giao diện video nào được cấu hình." });
  } else {
    if (!themeSupportsScript(theme, locale.script)) {
      blockers.push({ kind: "theme", message: `Giao diện "${theme.name}" chưa hỗ trợ ${scriptNameVi(locale.script)} của ${locale.displayName} (thiếu font).` });
    }
    if (!themeSupportsLanguage(theme, locale.language)) {
      blockers.push({ kind: "pipeline", message: `Pipeline dựng video chưa hỗ trợ ${locale.displayName}.` });
    }
  }
  return { renderable: blockers.length === 0, engines: supporting.map((e) => e.id), themeId: theme ? theme.id : null, blockers };
}
