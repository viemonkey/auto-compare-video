import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTemplateFile, renderTemplate } from "../scripts/lib/template.mjs";
import { validateLocale, loadLocales, getLocale, listLocales, getDefaultLocale, defaultLocaleCode, resolveLocale, LIMIT_KEYS } from "../scripts/lib/locales.mjs";
import { loadHashtagConfig, normalizeTag } from "../scripts/lib/hashtags.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realLocale = (code) => JSON.parse(fs.readFileSync(path.join(ROOT, "config", "locales", `${code}.json`), "utf8"));
const defaultRaw = () => realLocale(getDefaultLocale().code);

// ---------------------------------------------------------------------------------------------
// template engine
// ---------------------------------------------------------------------------------------------
test("template: biến, biến lồng a.b, số", () => {
  assert.equal(renderTemplate("x={{a}} y={{b.c}} n={{n}}", { a: "1", b: { c: "2" }, n: 3 }), "x=1 y=2 n=3");
});

test("template: placeholder thiếu -> throw, không để sót {{...}}", () => {
  assert.throws(() => renderTemplate("{{missing}}", {}), /missing/);
  assert.throws(() => renderTemplate("{{a.b}}", { a: {} }), /a\.b/);
});

test("template: khối # (có/không), ^ (rỗng), cùng dòng giữ nguyên chữ", () => {
  assert.equal(renderTemplate("A{{#x}} [{{x}}]{{/x}}B", { x: "v" }), "A [v]B");
  assert.equal(renderTemplate("A{{#x}} [{{x}}]{{/x}}B", { x: "" }), "AB");
  assert.equal(renderTemplate("{{^x}}trống{{/x}}", { x: [] }), "trống");
  assert.equal(renderTemplate("{{^x}}trống{{/x}}", { x: ["a"] }), "");
});

test("template: khối riêng dòng bỏ cả dòng thẻ (không để dòng trống thừa); placeholder trong khối rỗng không bị đánh giá", () => {
  const t = "a\n{{#g}}\nG: {{g}}\n{{/g}}\nb";
  assert.equal(renderTemplate(t, { g: "" }), "a\nb");
  assert.equal(renderTemplate(t, { g: "z" }), "a\nG: z\nb");
});

test("template: parseTemplateFile tách phần theo @@@, bỏ ghi chú đầu, chuẩn hoá CRLF", () => {
  const s = parseTemplateFile("ghi chú {{x}}\r\n@@@ system\r\n\r\nS1\r\nS2\r\n\r\n@@@ fragment.f\r\n  F\r\n");
  assert.deepEqual(Object.keys(s), ["system", "fragment.f"]);
  assert.equal(s.system, "S1\nS2");
  assert.equal(s["fragment.f"], "  F");
});

// ---------------------------------------------------------------------------------------------
// validate / load locale
// ---------------------------------------------------------------------------------------------
test("validateLocale: file locale thật của repo hợp lệ", () => {
  const { problems, locale } = validateLocale(defaultRaw());
  assert.deepEqual(problems, []);
  assert.ok(Object.isFrozen(locale));
  assert.ok(path.isAbsolute(locale.hashtagsPath));
});

test("validateLocale: thiếu trường / sai kiểu -> báo từng lỗi", () => {
  const base = defaultRaw();
  const cases = {
    code: (r) => { r.code = "vietnam"; },
    language: (r) => { r.language = "!!"; },
    script: (r) => { r.script = "latn"; },
    displayName: (r) => { delete r.displayName; },
    enabled: (r) => { r.enabled = "yes"; },
    slugSuffix: (r) => { r.slugSuffix = "Có Dấu"; },
    styleGuide: (r) => { r.styleGuide = 5; },
    glossary: (r) => { r.glossary = { "a": 1 }; },
    limits: (r) => { r.limits = []; },
    "limits.unit": (r) => { r.limits.unit = "byte"; },
    "limits.readingRate": (r) => { r.limits.readingRate = 0; },
    forbiddenPhrases: (r) => { r.forbiddenPhrases = "x"; },
    prompt: (r) => { delete r.prompt; },
    "prompt.example": (r) => { delete r.prompt.example.tag; },
    hashtags: (r) => { r.hashtags = "config/hashtags/khong-ton-tai.json"; },
    flagIcon: (r) => { r.flagIcon = "flags/khong-co-slash.svg"; },
    ...Object.fromEntries(LIMIT_KEYS.map((k) => [`limits.${k}`, (r) => { r.limits[k] = -1; }])),
  };
  for (const [field, mutate] of Object.entries(cases)) {
    const raw = structuredClone(base);
    mutate(raw);
    const { locale, problems } = validateLocale(raw);
    assert.equal(locale, null, field);
    assert.ok(problems.some((p) => p.includes(`"${field}`) || p.includes(field)), `${field}: ${problems.join(" | ")}`);
  }
  assert.equal(validateLocale(null).locale, null);
  assert.equal(validateLocale([]).locale, null);
});

test("flagIcon: locale thật có file cờ trong public/; thiếu file chỉ bỏ flagIcon (dùng emoji), không tắt locale", () => {
  const raw = defaultRaw();
  const real = validateLocale(raw);
  assert.ok(real.locale.flagIcon, "locale mặc định khai báo flagIcon");
  assert.ok(fs.existsSync(path.join(ROOT, "public", real.locale.flagIcon)));
  assert.ok(raw.flag, "emoji dự phòng vẫn còn");
  const missing = validateLocale({ ...raw, flagIcon: "/flags/khong-ton-tai.svg" });
  assert.deepEqual(missing.problems, []);
  assert.equal(missing.locale.flagIcon, null);
});

test("loadLocales: locale lỗi bị tắt + báo lỗi, locale tốt vẫn nạp, KHÔNG throw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "locales-"));
  try {
    const good = defaultRaw();
    fs.writeFileSync(path.join(dir, `${good.code}.json`), JSON.stringify(good));
    fs.writeFileSync(path.join(dir, "broken.json"), "{ không phải json");
    fs.writeFileSync(path.join(dir, "xx-XX.json"), JSON.stringify({ ...good, code: "xx-XX", limits: { unit: "word" } }));
    fs.writeFileSync(path.join(dir, "yy-YY.json"), JSON.stringify({ ...good, code: "zz-ZZ" })); // tên file != code
    fs.writeFileSync(path.join(dir, "ghi-chu.txt"), "bỏ qua");
    const { locales, errors } = loadLocales({ dir, quiet: true });
    assert.deepEqual([...locales.keys()], [good.code]);
    assert.deepEqual(errors.map((e) => e.file).sort(), ["broken.json", "xx-XX.json", "yy-YY.json"]);
    assert.ok(errors.every((e) => e.problems.length > 0));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const missing = loadLocales({ dir: path.join(os.tmpdir(), "khong-ton-tai-locales"), quiet: true });
  assert.equal(missing.locales.size, 0);
  assert.equal(missing.errors.length, 1);
});

test("registry: mọi locale enabled trong config/locales hợp lệ & tìm được; locale mặc định tồn tại", () => {
  const all = listLocales();
  assert.ok(all.length >= 1);
  for (const l of all) assert.equal(getLocale(l.code), l);
  const def = getDefaultLocale();
  assert.equal(def.code, defaultLocaleCode());
  assert.equal(resolveLocale(undefined), def); // dữ liệu cũ thiếu locale -> mặc định
  assert.equal(resolveLocale(""), def);
  assert.throws(() => resolveLocale("xx-XX"), /xx-XX/);
});

test("defaultLocaleCode: DEFAULT_LOCALE hợp lệ được dùng; sai -> rơi về locale hợp lệ (không throw)", () => {
  const code = getDefaultLocale().code;
  assert.equal(defaultLocaleCode({ DEFAULT_LOCALE: code }), code);
  assert.ok(getLocale(defaultLocaleCode({ DEFAULT_LOCALE: "xx-XX" })));
});

// ---------------------------------------------------------------------------------------------
// hashtag theo locale + tương thích config cũ
// ---------------------------------------------------------------------------------------------
test("loadHashtagConfig: lấy đúng file của locale; giới hạn tag lấy từ locale.limits", () => {
  const def = getDefaultLocale();
  const cfg = loadHashtagConfig(def);
  assert.equal(cfg.locale.code, def.code);
  assert.equal(cfg.mixedGroup, def.mixedGroup);
  const short = { ...def, limits: { ...def.limits, hashtagTotal: 6 } };
  assert.equal(normalizeTag("a".repeat(30), short), "#aaaaa");
});

test("loadHashtagConfig: thiếu file của locale mặc định -> dùng config/hashtags.json cũ nếu có (tương thích)", () => {
  const def = getDefaultLocale();
  const legacy = path.join(ROOT, "config", "hashtags.json");
  const hadLegacy = fs.existsSync(legacy);
  const fakeLocale = { ...def, hashtags: "config/hashtags/khong-co.json", hashtagsPath: path.join(ROOT, "config", "hashtags", "khong-co.json") };
  if (hadLegacy) return; // môi trường còn file cũ thật — không đụng
  fs.copyFileSync(def.hashtagsPath, legacy);
  try {
    const cfg = loadHashtagConfig(fakeLocale);
    assert.ok(cfg.topic.length > 0);
  } finally {
    fs.rmSync(legacy, { force: true });
  }
});
