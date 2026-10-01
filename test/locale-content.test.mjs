// M2: nội dung theo thị trường — song ngữ { text, vi }, đếm độ dài bằng Intl.Segmenter, cảnh báo theo field,
// hashtag theo locale (giữ chữ bản địa), nhận diện chủ đề trang sức, và 1 lần gọi Gemini (mock) end-to-end.
// Test kiểm tra CẤU TRÚC và QUY TẮC, không kiểm tra số lượng cụ thể của dữ liệu config.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countGraphemes, countWords, measure, truncateGraphemes } from "../public/shared/text-length.mjs";
import { textOf, viOf, hasVi, coerceField, flattenContent, bilingual } from "../public/shared/bilingual.mjs";
import {
  normalizeTag, loadHashtagConfig, planHashtags, resolveSpecificTags, resolveTopicTags, cleanTag, hashtagMeaning, withMeanings,
} from "../scripts/lib/hashtags.mjs";
import { getLocale, listLocales, needsGloss } from "../scripts/lib/locales.mjs";
import {
  parseAndValidate, collectContentWarnings, warningsForField, isJewelryTopic, enforceJewelryGating,
} from "../scripts/lib/compare-content.mjs";
import { buildComparePrompt, buildResponseSchema } from "../scripts/lib/compare-prompt.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 1 locale đại diện cho mỗi quy tắc, chọn theo thuộc tính (không theo mã cứng): grapheme+native, word+ascii, mặc định.
const all = listLocales();
const vi = all.find((l) => !needsGloss(l));
const gloss = all.filter(needsGloss);
const byRule = (pred) => all.find(pred);
const nativeLocale = byRule((l) => l.hashtagStyle === "native" && l.script === "Jpan");
const thaiLocale = byRule((l) => l.hashtagStyle === "native" && l.script === "Thai");
const wordLocale = byRule((l) => l.limits.unit === "word");

const catalog = {
  actions: [{ id: "explain-a", use_case: "x" }, { id: "inspect-gem", prop: "jewelry", use_case: "y" }],
  allIds: ["explain-a", "inspect-gem"],
  jewelryIds: ["inspect-gem"],
  generalIds: ["explain-a"],
};

// ---------------------------------------------------------------------------------------------
// đếm độ dài
// ---------------------------------------------------------------------------------------------
test("đếm grapheme: tiếng Thái có dấu/nguyên âm kết hợp, tiếng Nhật, emoji ghép — KHÔNG phải string.length", () => {
  const thai = "น้ำ"; // phụ âm + thanh điệu + nguyên âm kết hợp
  assert.ok(thai.length > countGraphemes(thai), "length UTF-16 phải lớn hơn số grapheme");
  assert.equal(countGraphemes("ก็"), 1);
  assert.equal(countGraphemes("เพชร"), countGraphemes([...new Intl.Segmenter("th", { granularity: "grapheme" }).segment("เพชร")].map((s) => s.segment).join("")));
  assert.equal(countGraphemes("アメジスト"), 5);
  assert.equal(countGraphemes("ガーネット"), 5); // dakuten ghép (nếu NFD) vẫn là 1 grapheme
  assert.equal(countGraphemes("ガーネット".normalize("NFD")), 5);
  assert.equal(countGraphemes("👨‍👩‍👧"), 1);
  assert.equal(countGraphemes(""), 0);
  assert.equal(countGraphemes(null), 0);
});

test("đếm từ: tiếng Anh theo từ, dấu câu không tính, tiếng Nhật/Thái dùng từ điển Segmenter", () => {
  assert.equal(countWords("Diamond or moissanite? Most people can't tell."), 7);
  assert.equal(countWords("   "), 0);
  assert.equal(countWords("10 on the Mohs scale"), 5);
  assert.ok(countWords("ダイヤモンドは硬いです") >= 2);
  assert.equal(measure("a b c", "word"), 3);
  assert.equal(measure("a b c", "grapheme"), 5);
});

test("truncateGraphemes không cắt đôi cụm ký tự", () => {
  assert.equal(truncateGraphemes("น้ำน้ำน้ำ", 2), "น้ำน้ำ");
  assert.equal(truncateGraphemes("abc", 10), "abc");
  assert.equal(truncateGraphemes("👨‍👩‍👧x", 1), "👨‍👩‍👧");
});

// ---------------------------------------------------------------------------------------------
// hàm đọc field dùng chung
// ---------------------------------------------------------------------------------------------
test("bilingual: đọc được cả chuỗi phẳng lẫn { text, vi }; dữ liệu hỏng -> rỗng, không throw", () => {
  assert.equal(textOf("Kim cương"), "Kim cương");
  assert.equal(textOf({ text: "ダイヤ", vi: "Kim cương" }), "ダイヤ");
  assert.equal(viOf({ text: "ダイヤ", vi: "Kim cương" }), "Kim cương");
  assert.equal(viOf("Kim cương"), "");
  assert.equal(viOf({ text: "x" }), "");
  assert.equal(hasVi({ text: "x", vi: "  " }), false);
  for (const bad of [null, undefined, 5, [], {}, { text: 3 }]) assert.equal(textOf(bad), "");
  assert.deepEqual(coerceField("abc", true), { text: "abc", vi: "" });
  assert.deepEqual(coerceField({ text: "a", vi: "b" }, true), { text: "a", vi: "b" });
  assert.equal(coerceField({ text: "a", vi: "b" }, false), "a");
  assert.equal(coerceField("a", false), "a");
});

test("flattenContent: mọi field hiển thị thành chuỗi, không đổi object gốc", () => {
  const content = { title: bilingual("T", "t"), label_left: "L", label_right: bilingual("R", "r"), points: [{ text: bilingual("p", "q"), tag: "x", sub: bilingual("", ""), side: "left" }] };
  const flat = flattenContent(content);
  assert.equal(flat.title, "T");
  assert.equal(flat.label_left, "L");
  assert.equal(flat.points[0].text, "p");
  assert.equal(flat.points[0].sub, "");
  assert.equal(flat.points[0].side, "left");
  assert.equal(typeof content.title, "object");
});

// ---------------------------------------------------------------------------------------------
// hashtag theo locale
// ---------------------------------------------------------------------------------------------
test("hashtag 'native': giữ nguyên chữ bản địa (không bỏ dấu, không ép ASCII), bỏ khoảng trắng/ký tự đặc biệt", () => {
  assert.equal(normalizeTag("#宝石", nativeLocale), "#宝石");
  assert.equal(normalizeTag("宝石の 知識！", nativeLocale), "#宝石の知識");
  assert.equal(normalizeTag("#อัญมณี", thaiLocale), "#อัญมณี");
  assert.equal(normalizeTag("น้ำ ผึ้ง", thaiLocale), "#น้ำผึ้ง", "dấu kết hợp phải còn nguyên");
  assert.equal(normalizeTag("#Ruby 925", nativeLocale), "#ruby925");
  assert.equal(normalizeTag("#### !!", nativeLocale), null);
  assert.equal(normalizeTag("１２３", nativeLocale), null, "chỉ toàn số (kể cả full-width) bị loại");
});

test("hashtag: NFKC trước khi xử lý (full-width, katakana nửa độ rộng); NFC thống nhất", () => {
  assert.equal(normalizeTag("ﾀﾞｲﾔﾓﾝﾄﾞ", nativeLocale), "#ダイヤモンド");
  assert.equal(normalizeTag("Ｄiamond", vi), "#diamond");
  assert.equal(normalizeTag("Ｄiamond", wordLocale), "#diamond");
  assert.equal(normalizeTag("ガ", nativeLocale), normalizeTag("ガ".normalize("NFD"), nativeLocale));
});

test("hashtag 'ascii' (vi/en): bỏ dấu, thường, a-z0-9 — chữ Nhật/Thái bị loại như cũ", () => {
  assert.equal(normalizeTag("#Thạch Anh Tím", vi), "#thachanhtim");
  assert.equal(normalizeTag("Đá  Quý!!", vi), "#daquy");
  assert.equal(normalizeTag("#宝石", vi), null);
  assert.equal(normalizeTag("#Gem Stones!", wordLocale), "#gemstones");
});

test("hashtag: giới hạn độ dài tính theo GRAPHEME (không cắt đôi dấu kết hợp)", () => {
  const limit = thaiLocale.limits.hashtagTotal - 1;
  const tag = normalizeTag("น้ำ".repeat(limit), thaiLocale); // mỗi "น้ำ" = 1 grapheme nhưng nhiều code unit
  assert.equal(countGraphemes(tag.slice(1)), limit);
    const cut = normalizeTag("น้ำ".repeat(limit + 5), thaiLocale);
  assert.equal(countGraphemes(cut.slice(1)), limit);
  assert.equal(cut, tag);
});

test("bộ từ vựng hashtag của locale: whitelist chủ đề nạp được bằng chữ bản địa; tra vật liệu theo tên bản địa", () => {
  for (const l of gloss) {
    const cfg = loadHashtagConfig(l);
    assert.ok(cfg.topic.length > 0, `${l.code}: whitelist chủ đề không được rỗng sau chuẩn hoá`);
    assert.ok(cfg.materials.size > 0, `${l.code}: bảng vật liệu`);
    // mọi tag trong file phải sống sót qua chuẩn hoá của chính locale (không bị loại do ép ASCII)
    const raw = JSON.parse(fs.readFileSync(l.hashtagsPath, "utf8"));
    for (const t of raw.topic) assert.equal(normalizeTag(t.tag, l) !== null, true, `${l.code}: ${t.tag}`);
    // tooltip: mỗi tag có nghĩa tiếng Việt
    for (const t of cfg.topic) assert.ok(hashtagMeaning(t.tag, cfg), `${l.code}: ${t.tag} thiếu nghĩa`);
    const [firstName, firstVal] = Object.entries(raw.materials)[0];
    const looked = resolveSpecificTags({ materials: [firstName, firstName], label_left: "", label_right: "" }, cfg);
    assert.equal(looked.unmapped.length, 0, `${l.code}: ${firstName} phải tra được`);
    assert.equal(looked.tags[0], normalizeTag(firstVal.tags[0], l));
  }
});

test("plan hashtag cho nội dung song ngữ: đọc label {text, vi}; topicTags chỉ nhận tag trong whitelist của locale", () => {
  const l = nativeLocale;
  const cfg = loadHashtagConfig(l);
  const [name0, v0] = Object.entries(JSON.parse(fs.readFileSync(l.hashtagsPath, "utf8")).materials)[0];
  const topic0 = cfg.topic[0].tag;
  const content = {
    materials: [name0, name0],
    label_left: bilingual(name0, "x"), label_right: bilingual("未知の素材", "y"),
    topicTags: [topic0, "#ベトナム語タグ"],
  };
  const { plan, unmapped } = planHashtags(content, cfg);
  assert.equal(plan.find((e) => e.tier === "specific").tag, normalizeTag(v0.tags[0], l));
  assert.deepEqual(plan.filter((e) => e.tier === "topic").map((e) => e.tag), [topic0], "tag ngoài whitelist bị loại");
  assert.ok(Array.isArray(unmapped));
  assert.deepEqual(resolveTopicTags(["#ベトナム語タグ"], cfg), []);
  assert.equal(cleanTag("#宝石", cfg), normalizeTag("#宝石", l));
  const withVi = withMeanings(plan, cfg);
  assert.ok(withVi.every((e) => e.tag), "mỗi mục giữ nguyên tag");
  assert.ok(withVi.some((e) => e.vi), "có mục kèm nghĩa tiếng Việt");
  assert.deepEqual(plan.map((e) => e.vi), plan.map(() => undefined), "plan gốc không bị gắn vi");
});

// ---------------------------------------------------------------------------------------------
// prompt / schema song ngữ
// ---------------------------------------------------------------------------------------------
test("prompt + schema: thị trường cần nghĩa -> yêu cầu {text, vi} sát nghĩa; thị trường tiếng Việt -> không có", () => {
  for (const l of all) {
    const cfg = loadHashtagConfig(l);
    const { systemPrompt, responseSchema } = buildComparePrompt({ catalog, hashtagCfg: cfg, locale: l });
    const p = responseSchema.properties;
    if (needsGloss(l)) {
      assert.match(systemPrompt, /SÁT NGHĨA/);
      assert.match(systemPrompt, /KHÔNG thêm ý, KHÔNG bớt ý/);
      for (const f of [p.title, p.label_left, p.label_right, p.points.items.properties.text, p.points.items.properties.tag, p.points.items.properties.sub]) {
        assert.equal(f.type, "object");
        assert.deepEqual(f.required, ["text", "vi"]);
        assert.equal(f.properties.text.type, "string");
        assert.ok(f.properties.vi.maxLength >= f.properties.text.maxLength);
      }
      assert.equal(p.materials.items.type, "string", "materials vẫn là chuỗi");
      assert.equal(responseSchema.required.includes("title"), true);
    } else {
      assert.ok(!/SONG NGỮ/.test(systemPrompt));
      assert.equal(p.title.type, "string");
      assert.equal(p.points.items.properties.text.type, "string");
    }
  }
});

// ---------------------------------------------------------------------------------------------
// parse + cảnh báo
// ---------------------------------------------------------------------------------------------
const rawContent = (l, over = {}) => {
  const g = (text, v) => (needsGloss(l) ? { text, vi: v } : text);
  return {
    error: "", title: g("タイトルです", "Tiêu đề"), label_left: g("アメジスト", "Thạch anh tím"), label_right: g("シトリン", "Thạch anh vàng"),
    materials: ["アメジスト", "シトリン"], topicTags: [], suggestedTags: [],
    points: [{ text: g("硬さが違います", "Độ cứng khác nhau"), side: "left", tag: g("硬い", "Cứng"), sub: g("", ""), suggested_action: "explain-a", needs_context_image: false, image_concept: "" }],
    ...over,
  };
};

test("parseAndValidate (song ngữ): giữ {text, vi}; chuỗi phẳng được bọc vi=''; thiếu text -> RetryableError", () => {
  const l = nativeLocale;
  const ok = parseAndValidate(JSON.stringify(rawContent(l)), catalog, { locale: l });
  assert.equal(textOf(ok.title), "タイトルです");
  assert.equal(viOf(ok.title), "Tiêu đề");
  assert.deepEqual(ok.points[0].sub, { text: "", vi: "" });

  const flatModel = rawContent(l, { title: "タイトル", label_left: "A", label_right: "B" }); // model bỏ qua schema song ngữ
  flatModel.points[0].text = "本文";
  const coerced = parseAndValidate(JSON.stringify(flatModel), catalog, { locale: l });
  assert.deepEqual(coerced.title, { text: "タイトル", vi: "" });
  assert.deepEqual(coerced.points[0].text, { text: "本文", vi: "" });

  const noText = rawContent(l);
  noText.title = { text: " ", vi: "x" };
  assert.throws(() => parseAndValidate(JSON.stringify(noText), catalog, { locale: l }), (e) => e.name === "RetryableError" || /title/.test(e.message));
  const noSub = rawContent(l);
  delete noSub.points[0].sub;
  assert.throws(() => parseAndValidate(JSON.stringify(noSub), catalog, { locale: l }), /sub/);
});

test("parseAndValidate (thị trường tiếng Việt): vẫn ra chuỗi phẳng, kể cả khi model lỡ trả {text, vi}", () => {
  const out = parseAndValidate(JSON.stringify(rawContent(vi, { title: { text: "Tiêu đề", vi: "x" } })), catalog, { locale: vi });
  assert.equal(typeof out.title, "string");
  assert.equal(out.title, "Tiêu đề");
  assert.equal(typeof out.points[0].text, "string");
});

test("cảnh báo: thiếu vi / vượt giới hạn (grapheme) / cụm cấm — theo từng field, không chặn", () => {
  const l = nativeLocale;
  const long = "あ".repeat(l.limits.title + 1);
  const forbidden = l.forbiddenPhrases[0];
  const content = {
    title: bilingual(long, "dài"),
    label_left: { text: "短い", vi: "" },
    label_right: bilingual(`これは${forbidden}です`, "Đây là ..."),
    points: [{ text: bilingual("ok", "ok"), tag: bilingual("x", "x"), sub: bilingual("", "") }],
  };
  const w = collectContentWarnings(content, l);
  const has = (path, code) => w.some((x) => x.path === path && x.code === code);
  assert.ok(has("title", "too-long"), JSON.stringify(w));
  assert.ok(has("label_left", "missing-vi"));
  assert.ok(has("label_right", "forbidden-phrase"));
  assert.ok(!w.some((x) => x.path.endsWith(".sub")), "sub rỗng hợp lệ — không cảnh báo");
  assert.ok(w.every((x) => x.path && x.code && x.message));
  const over = w.find((x) => x.code === "too-long");
  assert.equal(over.used, l.limits.title + 1);
  assert.equal(over.limit, l.limits.title);
});

test("cảnh báo độ dài theo ĐƠN VỊ của locale: 'word' đếm từ, 'grapheme' đếm ký tự", () => {
  const l = wordLocale;
  const nWords = l.limits.point + 1;
  const sentence = Array.from({ length: nWords }, () => "go").join(" ");
  assert.ok(sentence.length > nWords);
  const w = warningsForField("text", bilingual(sentence, "đi"), l);
  assert.ok(w.some((x) => x.code === "too-long" && x.used === nWords), JSON.stringify(w));
  const within = Array.from({ length: l.limits.point }, () => "supercalifragilistic").join(" ");
  assert.ok(!warningsForField("text", bilingual(within, "x"), l).some((x) => x.code === "too-long"), "20 từ dài vẫn trong giới hạn từ");
});

test("cảnh báo glossary: dòng nghĩa nhắc khái niệm mà chữ đích không dùng thuật ngữ chuẩn", () => {
  const l = nativeLocale;
  const [concept, term] = Object.entries(l.glossary).find(([c]) => c === "kim cương");
  const bad = warningsForField("text", bilingual("宝石は硬いです", `${concept} rất cứng`), l);
  assert.ok(bad.some((x) => x.code === "glossary-term" && x.term === term), JSON.stringify(bad));
  const good = warningsForField("text", bilingual(`${term}は硬いです`, `${concept} rất cứng`), l);
  assert.ok(!good.some((x) => x.code === "glossary-term"));
  // khái niệm dài khớp trước: "thạch anh tím" không bị tính thêm là "thạch anh"
  const amethyst = l.glossary["thạch anh tím"];
  const w = warningsForField("text", bilingual(`${amethyst}です`, "thạch anh tím"), l);
  assert.ok(!w.some((x) => x.code === "glossary-term"), JSON.stringify(w));
});

test("cảnh báo: thị trường tiếng Việt không đòi 'vi'; cụm cấm / độ dài vẫn kiểm", () => {
  assert.ok(!warningsForField("title", "Tiêu đề", vi).some((x) => x.code === "missing-vi"));
  assert.ok(warningsForField("title", "a".repeat(vi.limits.title + 1), vi).some((x) => x.code === "too-long"));
});

// ---------------------------------------------------------------------------------------------
// nhận diện chủ đề trang sức theo locale
// ---------------------------------------------------------------------------------------------
test("jewelry gating: thị trường khác KHÔNG dựa từ khoá tiếng Việt trên chữ ngoại ngữ — dùng dòng vi, từ khoá locale, hoặc materials", () => {
  const l = nativeLocale;
  const cfg = loadHashtagConfig(l);
  const mk = (over) => ({ title: bilingual("へー", ""), label_left: bilingual("犬", ""), label_right: bilingual("猫", ""), materials: [], ...over });
  assert.equal(isJewelryTopic(mk({}), "", l, { hashtagCfg: cfg }), false, "không trang sức");
  // (1) dòng vi của label nhắc kim cương (từ khoá của locale tiếng Việt)
  assert.equal(isJewelryTopic(mk({ label_left: bilingual("犬", "Kim cương") }), "", l, { hashtagCfg: cfg }), true);
  // (1') gợi ý ngữ cảnh tiếng Việt của người dùng
  assert.equal(isJewelryTopic(mk({}), "đồ trang sức kim hoàn", l, { hashtagCfg: cfg }), true);
  // (2) từ khoá của chính locale trên chữ đích
  const kw = l.jewelryKeywords.find((k) => k.length > 1);
  assert.equal(isJewelryTopic(mk({ title: bilingual(`これは${kw}です`, "") }), "", l, { hashtagCfg: cfg }), true);
  // (3) materials tra được trong bảng hashtag của locale
  const matName = Object.keys(JSON.parse(fs.readFileSync(l.hashtagsPath, "utf8")).materials)[0];
  assert.equal(isJewelryTopic(mk({ materials: [matName, matName], label_left: bilingual(matName, "") }), "", l, { hashtagCfg: cfg }), true);
  // từ khoá tiếng Việt bỏ dấu KHÔNG được khớp trên chữ ngoại ngữ ("nhan" trong chữ Latin lạ)
  assert.equal(isJewelryTopic(mk({ title: bilingual("nhan vang", "") }), "", l, { hashtagCfg: cfg }), false);
});

test("jewelry gating: mọi thị trường có từ khoá riêng để nhận ra chủ đề trang sức trên chữ đích", () => {
  for (const l of gloss) {
    assert.ok(l.jewelryKeywords.length > 0, `${l.code}: jewelryKeywords rỗng sẽ làm sai gating`);
    const cfg = loadHashtagConfig(l);
    const content = { title: bilingual(`${l.jewelryKeywords[0]}`, ""), label_left: bilingual("x", ""), label_right: bilingual("y", ""), materials: [] };
    assert.equal(isJewelryTopic(content, "", l, { hashtagCfg: cfg }), true, l.code);
  }
});

test("jewelry gating hạ cấp pose trang sức khi chủ đề không phải trang sức (thị trường song ngữ)", () => {
  const l = nativeLocale;
  const content = {
    title: bilingual("犬と猫", "Chó và mèo"), label_left: bilingual("犬", "Chó"), label_right: bilingual("猫", "Mèo"), materials: [],
    points: [{ text: bilingual("a", "a"), suggested_action: "inspect-gem" }, { text: bilingual("b", "b"), suggested_action: "explain-a" }],
  };
  const { corrections } = enforceJewelryGating(content, catalog, "", l, { hashtagCfg: loadHashtagConfig(l) });
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].point, "a", "correction ghi chữ, không phải object");
  assert.equal(content.points[0].suggested_action, "thinking");
});

// ---------------------------------------------------------------------------------------------
// 1 lần gọi Gemini (mock) end-to-end
// ---------------------------------------------------------------------------------------------
test("runCompareContent (mock Gemini): prompt/schema theo locale, nội dung song ngữ + cảnh báo, ledger ghi locale", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2-"));
  const ledger = path.join(dir, "ledger.jsonl");
  process.env.COST_LEDGER_PATH = ledger;
  process.env.GEMINI_API_KEY = "test-key-not-real";
  const realFetch = globalThis.fetch;
  const calls = [];
  const l = nativeLocale;
  try {
    const mod = await import("../scripts/generate-compare-content.mjs");
    const realCatalog = mod.loadActionCatalog(); // actions.json thật: dùng id có thật (schema/validate kiểm id)
    const jewelryAction = realCatalog.jewelryIds[0] || realCatalog.allIds[0];
    const g = (text, v) => ({ text, vi: v });
    const response = rawContent(l, {
      label_left: g("アメジスト", "Thạch anh tím"),
      points: [
        { text: g(`${l.forbiddenPhrases[0]}の石です`, "Đá này"), side: "left", tag: g("硬い", "Cứng"), sub: g("", ""), suggested_action: jewelryAction, needs_context_image: false, image_concept: "" },
      ],
    });
    globalThis.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(response) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }), text: async () => "" };
    };
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const result = await mod.runCompareContent({ left: pixel, right: pixel, topicHint: "đá quý", locale: l.code, slug: "_pending-test" });

    assert.equal(calls.length, 1);
    const { systemInstruction, generationConfig } = calls[0].body;
    const system = systemInstruction.parts[0].text;
    assert.ok(system.includes(l.styleGuide.trim()), "styleGuide của locale có trong prompt");
    assert.ok(system.includes(Object.values(l.glossary)[0]), "glossary của locale có trong prompt");
    assert.equal(generationConfig.responseSchema.properties.title.type, "object", "schema song ngữ");

    assert.equal(result.content.locale, l.code);
    assert.equal(viOf(result.content.title), "Tiêu đề");
    assert.ok(result.warnings.some((w) => w.code === "forbidden-phrase" && w.path === "points[0].text"), JSON.stringify(result.warnings));
    assert.ok(result.content.points.every((p) => typeof p.text === "object"));
    // topic không phải trang sức? title/label có "アメジスト" (materials trong bảng) -> không hạ cấp pose
    assert.equal(result.content.points[0].suggested_action, jewelryAction);

    const rows = fs.readFileSync(ledger, "utf8").trim().split("\n").map((x) => JSON.parse(x));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].locale, l.code);
    assert.equal(rows[0].task, "content-generation");
    assert.equal(rows[0].status, "success");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.COST_LEDGER_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildResponseSchema: maxLength của text theo giới hạn locale; vi không ngắn hơn text", () => {
  for (const l of gloss) {
    const schema = buildResponseSchema(["a"], { topic: [] }, l);
    const t = schema.properties.title.properties;
    assert.ok(t.text.maxLength > 0);
    assert.ok(t.vi.maxLength >= t.text.maxLength);
  }
  assert.ok(fs.existsSync(path.join(ROOT, "prompts", "compare-content.md")));
  assert.ok(getLocale(all[0].code));
});
