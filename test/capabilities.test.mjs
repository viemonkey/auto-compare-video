import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateEngine, validateTheme, loadEngines, loadThemes, listEngines, listThemes,
  enginesForLanguage, themeSupportsScript, themeSupportsLanguage, engineReadiness, checkRenderability, getDefaultTheme, defaultVoiceFor,
} from "../scripts/lib/capabilities.mjs";
import { listLocales, defaultLocaleCode, getLocale } from "../scripts/lib/locales.mjs";
import { buildComparePrompt, buildResponseSchema, schemaMaxLength } from "../scripts/lib/compare-prompt.mjs";
import { loadHashtagConfig } from "../scripts/lib/hashtags.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "caps-"));

// Test kiểm tra CẤU TRÚC và QUY TẮC, không kiểm tra số lượng cụ thể của dữ liệu config.
const engineRaw = (over = {}) => ({ id: "e1", label: "E1", enabled: true, languages: ["xx"], modes: [{ id: "preset", label: "p" }], ...over });
const themeRaw = (over = {}) => ({ id: "t1", name: "T1", label: "T 1", enabled: true, scripts: ["Latn"], languages: ["xx"], ...over });

test("validateEngine / validateTheme: hợp lệ và các lỗi thiếu trường / sai kiểu", () => {
  assert.deepEqual(validateEngine(engineRaw()).problems, []);
  assert.deepEqual(validateTheme(themeRaw()).problems, []);
  const badEngines = [
    { languages: [] }, { languages: ["vietnamese"] }, { modes: [] }, { enabled: "1" }, { id: "Bad Id" }, { label: "" },
    { defaultVoices: { vi: "x" } }, { voices: { "vi-VN": [{ id: "a" }] } }, { requires: { env: "X" } }, { order: 1.5 },
  ];
  for (const over of badEngines) assert.equal(validateEngine(engineRaw(over)).engine, null, JSON.stringify(over));
  const badThemes = [{ scripts: [] }, { scripts: ["latn"] }, { languages: [] }, { languages: ["Vietnamese"] }, { name: "" }, { enabled: 1 }, { default: "yes" }];
  for (const over of badThemes) assert.equal(validateTheme(themeRaw(over)).theme, null, JSON.stringify(over));
  assert.equal(validateEngine(null).engine, null);
  assert.equal(validateTheme([]).theme, null);
});

test("loadEngines/loadThemes: file lỗi bị tắt kèm lý do, file tốt vẫn nạp, KHÔNG throw", () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "e1.json"), JSON.stringify(engineRaw()));
    fs.writeFileSync(path.join(dir, "broken.json"), "{ nope");
    fs.writeFileSync(path.join(dir, "e2.json"), JSON.stringify(engineRaw({ id: "e2", languages: [] })));
    fs.writeFileSync(path.join(dir, "other.json"), JSON.stringify(engineRaw({ id: "e3" }))); // tên file != id
    const { engines, errors } = loadEngines({ dir, quiet: true });
    assert.deepEqual([...engines.keys()], ["e1"]);
    assert.deepEqual(errors.map((e) => e.file).sort(), ["broken.json", "e2.json", "other.json"]);
    assert.ok(errors.every((e) => e.problems.length));
    const missing = loadThemes({ dir: path.join(dir, "khong-co"), quiet: true });
    assert.equal(missing.themes.size, 0);
    assert.equal(missing.errors.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("config thật: mọi engine/theme bật đều hợp lệ; engine khai báo languages, theme khai báo scripts", () => {
  assert.ok(listEngines().length >= 1);
  assert.ok(listThemes().length >= 1);
  for (const e of listEngines()) {
    assert.ok(e.languages.length > 0, e.id);
    for (const [loc, voice] of Object.entries(e.defaultVoices || {})) {
      // giọng mặc định phải thuộc ngôn ngữ engine hỗ trợ (và nằm trong danh sách giọng nếu có khai báo)
      assert.ok(e.languages.includes(loc.split("-")[0]), `${e.id}: defaultVoices.${loc} ngoài languages`);
      if (e.voices?.[loc]) assert.ok(e.voices[loc].some((v) => v.id === voice), `${e.id}: giọng mặc định ${voice} không có trong voices.${loc}`);
    }
  }
  for (const t of listThemes()) assert.ok(t.scripts.length > 0 && t.languages.length > 0, t.id);
  assert.ok(getDefaultTheme());
});

test("renderable = engine hỗ trợ ngôn ngữ VÀ theme hỗ trợ script VÀ theme hỗ trợ language (quy tắc, tính từ khai báo)", () => {
  const loc = { code: "xx-XX", language: "xx", script: "Zzzz", displayName: "XX" };
  const engines = [engineRaw({ id: "a", languages: ["xx"] }), engineRaw({ id: "b", languages: ["yy"] })];
  const themes = [
    themeRaw({ id: "t", scripts: ["Zzzz"], languages: ["xx"] }),
    themeRaw({ id: "u", scripts: ["Latn"], languages: ["xx"] }), // thiếu font
    themeRaw({ id: "w", scripts: ["Zzzz"], languages: ["yy"] }), // pipeline chưa kiểm chứng ngôn ngữ
  ];

  let r = checkRenderability(loc, { engines, themes, themeId: "t" });
  assert.equal(r.renderable, true);
  assert.deepEqual(r.engines, ["a"]);
  assert.deepEqual(r.blockers, []);

  r = checkRenderability(loc, { engines, themes, themeId: "u" });
  assert.equal(r.renderable, false);
  assert.deepEqual(r.blockers.map((b) => b.kind), ["theme"]);
  assert.match(r.blockers[0].message, /Zzzz/);

  r = checkRenderability(loc, { engines, themes, themeId: "w" });
  assert.equal(r.renderable, false);
  assert.deepEqual(r.blockers.map((b) => b.kind), ["pipeline"]);
  assert.equal(r.blockers[0].message, "Pipeline dựng video chưa hỗ trợ XX.");

  r = checkRenderability(loc, { engines: [engines[1]], themes, themeId: "t" });
  assert.deepEqual(r.blockers.map((b) => b.kind), ["tts"]);

  r = checkRenderability(loc, { engines: [], themes: [themeRaw({ scripts: ["Latn"], languages: ["yy"] })] }); // thiếu cả ba
  assert.deepEqual(r.blockers.map((b) => b.kind).sort(), ["pipeline", "theme", "tts"]);
  assert.equal(r.renderable, false);

  assert.equal(checkRenderability(loc, { engines, themes: [] }).renderable, false);
  assert.doesNotThrow(() => checkRenderability(loc, { engines, themes, themeId: "khong-co" }));
});

test("renderable không phụ thuộc cờ cứng: đổi khai báo engine/theme thì kết quả đổi theo", () => {
  const loc = { language: "xx", script: "Zzzz", displayName: "XX" };
  const eng = [engineRaw({ languages: ["xx"] })];
  assert.equal(checkRenderability(loc, { engines: eng, themes: [themeRaw({ scripts: ["Latn"], languages: ["xx"] })] }).renderable, false);
  assert.equal(checkRenderability(loc, { engines: eng, themes: [themeRaw({ scripts: ["Latn", "Zzzz"], languages: ["xx"] })] }).renderable, true);
  assert.equal(checkRenderability(loc, { engines: eng, themes: [themeRaw({ scripts: ["Latn", "Zzzz"], languages: ["yy"] })] }).renderable, false);
  assert.deepEqual(enginesForLanguage("xx", [engineRaw({ languages: ["xx", "yy"] })]).map((e) => e.id), ["e1"]);
  assert.equal(themeSupportsScript(themeRaw({ scripts: ["Latn"] }), "Jpan"), false);
});

test("locale thật: kết quả renderable của mọi locale khớp quy tắc (suy từ engine/theme thật)", () => {
  for (const l of listLocales()) {
    const r = checkRenderability(l);
    const expectTts = enginesForLanguage(l.language).length > 0;
    const theme = getDefaultTheme();
    const expectTheme = !!theme && themeSupportsScript(theme, l.script);
    const expectPipeline = !!theme && themeSupportsLanguage(theme, l.language);
    assert.equal(r.renderable, expectTts && expectTheme && expectPipeline, l.code);
    assert.equal(r.blockers.some((b) => b.kind === "pipeline"), !expectPipeline, l.code);
    assert.equal(r.blockers.some((b) => b.kind === "tts"), !expectTts, l.code);
    assert.equal(r.blockers.some((b) => b.kind === "theme"), !expectTheme, l.code);
  }
});

test("engineReadiness: thiếu biến môi trường / thư mục -> chưa sẵn sàng, kèm lý do; đủ -> sẵn sàng", () => {
  const dir = tmp();
  try {
    const eng = engineRaw({ requires: { env: ["X_KEY"], paths: ["thu-muc-cai-dat"], hint: "Cài đặt đi." } });
    let r = engineReadiness(eng, { env: {}, repoRoot: dir });
    assert.equal(r.ready, false);
    assert.match(r.reason, /X_KEY/);
    assert.match(r.reason, /thu-muc-cai-dat/);
    assert.match(r.reason, /Cài đặt đi\./);
    fs.mkdirSync(path.join(dir, "thu-muc-cai-dat"));
    r = engineReadiness(eng, { env: { X_KEY: "v" }, repoRoot: dir });
    assert.deepEqual(r, { ready: true, reason: "" });
    assert.deepEqual(engineReadiness(engineRaw(), { env: {}, repoRoot: dir }), { ready: true, reason: "" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("giọng mặc định đọc từ config của engine (không hard-code)", () => {
  assert.equal(defaultVoiceFor(engineRaw({ defaultVoices: { "xx-XX": "voice-1" } }), "xx-XX"), "voice-1");
  assert.equal(defaultVoiceFor(engineRaw(), "xx-XX"), undefined);
});

// ---------------------------------------------------------------------------------------------
// DEFAULT_LOCALE: process.env -> .env -> FALLBACK; KHÔNG đọc .env.example
// ---------------------------------------------------------------------------------------------
test("defaultLocaleCode: process.env > .env > fallback; .env.example không bao giờ được đọc", () => {
  const dir = tmp();
  try {
    const codes = listLocales().map((l) => l.code);
    const [a, b] = codes;
    const envFile = path.join(dir, ".env");
    assert.ok(codes.length >= 2);
    fs.writeFileSync(envFile, `FOO=1\nDEFAULT_LOCALE=${b}\n`);
    assert.equal(defaultLocaleCode({}, { envFile }), b, ".env được dùng");
    assert.equal(defaultLocaleCode({ DEFAULT_LOCALE: a }, { envFile }), a, "process.env thắng .env");
    assert.ok(getLocale(defaultLocaleCode({}, { envFile: path.join(dir, "khong-co.env") })), "không có .env -> fallback hợp lệ");
    fs.writeFileSync(envFile, "DEFAULT_LOCALE=xx-XX\n"); // locale lạ -> fallback, không throw
    assert.ok(getLocale(defaultLocaleCode({}, { envFile })));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const src = fs.readFileSync(path.join(ROOT, "scripts", "lib", "locales.mjs"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/\.env\.example/.test(code),"code locales.mjs (ngoài chú thích) không được tham chiếu .env.example");
});

// ---------------------------------------------------------------------------------------------
// Mọi locale thật: cấu trúc + prompt/schema theo locale
// ---------------------------------------------------------------------------------------------
const catalog = {
  actions: [{ id: "explain-a", use_case: "Đang giải thích" }, { id: "inspect-gem", prop: "jewelry", use_case: "Soi đá" }],
  allIds: ["explain-a", "inspect-gem"],
  jewelryIds: ["inspect-gem"],
  generalIds: ["explain-a"],
};

test("locale thật: slugSuffix không trùng nhau (trừ rỗng của locale mặc định), file hashtag cùng cấu trúc", () => {
  const locales = listLocales();
  const suffixes = locales.map((l) => l.slugSuffix).filter(Boolean);
  assert.equal(new Set(suffixes).size, suffixes.length, "slugSuffix trùng");
  assert.ok(locales.filter((l) => l.slugSuffix === "").length <= 1, "chỉ tối đa 1 locale có slugSuffix rỗng");
  for (const l of locales) {
    const raw = JSON.parse(fs.readFileSync(l.hashtagsPath, "utf8"));
    assert.ok(Array.isArray(raw.topic), `${l.code}: topic`);
    assert.ok(raw.materials && typeof raw.materials === "object", `${l.code}: materials`);
    assert.ok(Array.isArray(raw.blocked), `${l.code}: blocked`);
    for (const t of raw.topic) assert.ok(t.tag && t.group, `${l.code}: tag/group`);
    if (l.code !== getLocale(defaultLocaleCode()).code && l.language !== "vi") {
      // thị trường ngoài tiếng Việt: mỗi tag/vật liệu có nghĩa tiếng Việt cho tooltip
      for (const t of raw.topic) assert.ok(typeof t.vi === "string" && t.vi, `${l.code}: topic ${t.tag} thiếu "vi"`);
      for (const [name, m] of Object.entries(raw.materials)) assert.ok(typeof m.vi === "string" && m.vi, `${l.code}: material ${name} thiếu "vi"`);
    }
    assert.ok(raw.topic.some((t) => t.group === l.mixedGroup), `${l.code}: mixedGroup "${l.mixedGroup}" không có tag nào`);
  }
});

test("prompt theo locale: có styleGuide/glossary/forbidden đúng locale (khi có), độ dài theo đơn vị, không sót placeholder", () => {
  for (const l of listLocales()) {
    const hashtagCfg = loadHashtagConfig(l);
    const { systemPrompt, userPrompt, responseSchema } = buildComparePrompt({ catalog, hashtagCfg, locale: l, topicHint: "gợi ý", angleInstruction: "góc độ" });
    assert.ok(!systemPrompt.includes("{{") && !userPrompt.includes("{{"), `${l.code}: còn placeholder`);
    assert.ok(systemPrompt.includes(l.prompt.language), `${l.code}: ngôn ngữ`);
    assert.ok(systemPrompt.includes(l.prompt.example.text), `${l.code}: ví dụ`);
    if (l.styleGuide.trim()) {
      assert.ok(systemPrompt.includes(l.styleGuide.trim()), `${l.code}: styleGuide`);
      assert.match(systemPrompt, /ƯU TIÊN/, `${l.code}: styleGuide phải được nêu là ưu tiên khi mâu thuẫn`);
    } else {
      assert.ok(!/VĂN PHONG BẢN XỨ/.test(systemPrompt), `${l.code}: không có styleGuide thì không có khối văn phong`);
    }
    for (const [concept, term] of Object.entries(l.glossary)) {
      assert.ok(systemPrompt.includes(term) && systemPrompt.includes(concept), `${l.code}: glossary ${concept}`);
    }
    for (const p of l.forbiddenPhrases) assert.ok(systemPrompt.includes(`"${p}"`), `${l.code}: forbidden ${p}`);
    const unit = l.limits.unit === "word" ? "từ" : "ký tự";
    assert.ok(systemPrompt.includes(`tối đa ${l.limits.tag} ${unit}`), `${l.code}: độ dài tag theo ${l.limits.unit}`);
    assert.ok(systemPrompt.includes(`tối đa ${l.limits.sub} ${unit}`), `${l.code}: độ dài sub`);
    assert.ok(userPrompt.includes("gợi ý") && userPrompt.includes("góc độ"));
    // field hiển thị là chuỗi (thị trường tiếng Việt) hoặc { text, vi } (thị trường khác): maxLength của chữ đích theo limits
    const tagField = responseSchema.properties.points.items.properties.tag;
    assert.equal((tagField.properties ? tagField.properties.text : tagField).maxLength, schemaMaxLength(l.limits, "tag"));
  }
});

test("schema: unit 'word' đổi sang ký tự bằng charsPerWord; unit 'grapheme' giữ nguyên; hashtag luôn grapheme", () => {
  const word = { unit: "word", charsPerWord: 9, title: 14, label: 4, point: 20, tag: 3, sub: 5, topicTag: 24, suggestedTag: 24, material: 4, hashtagTotal: 25 };
  assert.equal(schemaMaxLength(word, "title"), 126);
  assert.equal(schemaMaxLength(word, "topicTag"), 24);
  assert.equal(schemaMaxLength({ ...word, unit: "grapheme" }, "title"), 14);
  const schema = buildResponseSchema(["a"], { topic: [] }, { limits: word });
  assert.equal((schema.properties.title.properties?.text ?? schema.properties.title).maxLength, 126);
  assert.equal(schema.properties.topicTags.items.maxLength, 24);
  assert.equal(schema.properties.materials.items.maxLength, 36);
  assert.equal(schema.properties.topicTags.items.maxLength, 24);
});
