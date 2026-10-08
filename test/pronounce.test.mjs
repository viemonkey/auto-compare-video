// Bảng phát âm cho TTS (MỐC 4): chỉ đổi chữ ĐỌC, không đổi chữ hiện trên video; vi-VN không đổi.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compilePronunciation, validatePronunciation, mapOffset, alignWords } from "../scripts/lib/tts/pronounce.mjs";
import { runVoiceover } from "../scripts/lib/tts/voiceover.mjs";
import { createTtsCache } from "../scripts/lib/tts/cache.mjs";
import { resolveLocale, validateLocale } from "../scripts/lib/locales.mjs";
import { calcTtsCost } from "../config/pricing.mjs";

const ja = resolveLocale("ja-JP");
const en = resolveLocale("en-US");
const th = resolveLocale("th-TH");
const vi = resolveLocale("vi-VN");
const say = (locale, text) => compilePronunciation(locale.tts?.pronunciation)(text).text;

test("vi-VN không có bảng phát âm: chữ đọc = chữ gốc, không đổi gì", () => {
  assert.equal(vi.tts, undefined);
  const p = compilePronunciation(vi.tts?.pronunciation);
  const text = "Kim cương nặng 1,5 ct, độ cứng Mohs 10, dày 2 mm.";
  assert.deepEqual(p(text), { text, spans: [] });
  assert.deepEqual(compilePronunciation([])("abc"), { text: "abc", spans: [] });
});

test("ja: ct / mm / Mohs / kim loại K / khoảng ~ được đọc bằng tiếng Nhật; chữ không liên quan giữ nguyên", () => {
  assert.equal(say(ja, "このダイヤは1.5ctで、厚さ2mmです。"), "このダイヤは1.5カラットで、厚さ2ミリです。");
  assert.equal(say(ja, "モース硬度はMohs 10です。"), "モース硬度はモース 10です。");
  assert.equal(say(ja, "18Kのリング、重さ3.2g。"), "18金のリング、重さ3.2グラム。");
  assert.equal(say(ja, "硬度は8~9です"), "硬度は8から9です");
  assert.equal(say(ja, "靭性が高い宝石"), "じんせいが高い宝石");
  assert.equal(say(ja, "GIAの鑑定書とUV検査"), "ジーアイエーの鑑定書とユーブイ検査");
  // wholeWord: "GIAS" や "ctx" のような語の一部は触らない
  assert.equal(say(ja, "GIASとctx"), "GIASとctx");
  assert.equal(say(ja, "ただの日本語です。"), "ただの日本語です。");
});

test("en: 1 ct (số ít) vs n cts (số nhiều), mm, Mohs, ký hiệu viết tắt đọc từng chữ cái", () => {
  assert.equal(say(en, "A 1ct stone and a 2.5 ct stone."), "A 1 carat stone and a 2.5 carats stone.");
  assert.equal(say(en, "It is 1 mm thick, not 12 mm."), "It is 1 millimeter thick, not 12 millimeters.");
  assert.equal(say(en, "Hardness 9.25 on the Mohs scale."), "Hardness 9.25 on the Moze scale.");
  assert.equal(say(en, "GIA certified, 18K gold."), "G I A certified, 18 karat gold.");
  assert.equal(say(en, "moissanite vs Moissanite"), "moy suh nite vs moy suh nite");
  assert.equal(say(en, "Ranges 8~9."), "Ranges 8 to 9.");
  assert.equal(say(en, "ct without a number stays"), "ct without a number stays");
});

test("th: đơn vị và tên viết bằng chữ Latin được đọc bằng tiếng Thái", () => {
  assert.equal(say(th, "เพชร 2 ct หนา 3 mm"), "เพชร 2 กะรัต หนา 3 มิลลิเมตร");
  assert.equal(say(th, "ค่า Mohs คือ 10"), "ค่า โมห์ส คือ 10");
  assert.equal(say(th, "Moissanite กับ Diamond"), "มอยส์ซาไนต์ กับ เพชร");
});

test("luật chồng nhau: luật bắt đầu sớm hơn thắng (\"1.5ct\" không bị luật \"ct\" khác xé đôi); spans đúng vị trí", () => {
  const p = compilePronunciation([
    { pattern: "(\\d+)\\s*ct", say: "$1 carats" },
    { match: "ct", say: "SAI" },
  ]);
  const r = p("a 10ct b ct");
  assert.equal(r.text, "a 10 carats b SAI");
  assert.deepEqual(r.spans, [{ os: 2, oe: 6, ss: 2, se: 11 }, { os: 9, oe: 11, ss: 14, se: 17 }]);
  assert.equal(mapOffset(r.spans, 0), 0);
  assert.equal(mapOffset(r.spans, 6), 11, "cuối đoạn đổi -> cuối đoạn mới");
  assert.equal(mapOffset(r.spans, 7), 12, "sau đoạn đổi: cộng độ lệch");
  assert.equal(mapOffset(r.spans, 4), 7, "giữa đoạn đổi: nội suy theo tỉ lệ");
});

test("validatePronunciation / validateLocale: luật sai bị từ chối bằng câu tiếng Việt", () => {
  assert.deepEqual(validatePronunciation(undefined), []);
  assert.deepEqual(validatePronunciation([{ match: "a", say: "b" }, { pattern: "(\\d+)", say: "$1" }]), []);
  assert.match(validatePronunciation({}).join("|"), /mảng luật/);
  assert.match(validatePronunciation([{ say: "x" }]).join("|"), /đúng một trong/);
  assert.match(validatePronunciation([{ match: "a", pattern: "b", say: "x" }]).join("|"), /đúng một trong/);
  assert.match(validatePronunciation([{ match: "a" }]).join("|"), /say phải là chuỗi/);
  assert.match(validatePronunciation([{ pattern: "([", say: "x" }]).join("|"), /không hợp lệ/);
  const raw = JSON.parse(fs.readFileSync(new URL("../config/locales/ja-JP.json", import.meta.url), "utf8"));
  assert.deepEqual(validateLocale(raw).problems, []);
  raw.tts.pronunciation.push({ pattern: "([", say: "x" });
  assert.match(validateLocale(raw).problems.join("|"), /tts\.pronunciation\[\d+\]/);
});

test("config thật: ja/en/th có bảng phát âm biên dịch được, vi-VN không", () => {
  for (const l of [ja, en, th]) {
    assert.ok(l.tts.pronunciation.length >= 8, l.code);
    assert.doesNotThrow(() => compilePronunciation(l.tts.pronunciation), l.code);
  }
});

// ---------------------------------------------------------------------------------------------
// Timing karaoke bám CHỮ GỐC dù TTS đọc chữ đã đổi
// ---------------------------------------------------------------------------------------------
test("alignWords: token là chữ GỐC ('1.5ct', 'Mohs'), thời gian lấy từ boundary của chữ ĐÃ ĐỌC", () => {
  const original = "Hardness 1.5ct Mohs scale";
  const p = compilePronunciation(en.tts.pronunciation)(original);
  assert.equal(p.text, "Hardness 1.5 carats Moze scale");
  const T = (sec) => Math.round(sec * 1e7);
  const boundaries = [
    { text: "Hardness", offset: T(0.1), duration: T(0.4) },
    { text: "1.5", offset: T(0.6), duration: T(0.3) },
    { text: "carats", offset: T(0.9), duration: T(0.4) },
    { text: "Moze", offset: T(1.4), duration: T(0.3) },
    { text: "scale", offset: T(1.8), duration: T(0.3) },
  ];
  const words = alignWords({ original, spoken: p.text, spans: p.spans, boundaries, language: "en", mode: "space" });
  assert.deepEqual(words.map((w) => w.t), ["Hardness", "1.5ct", "Mohs", "scale"]);
  assert.deepEqual(words.map((w) => w.s), [0.1, 0.6, 1.4, 1.8]);
  assert.ok(Math.abs(words[1].s + words[1].d - 1.3) < 1e-9, "token '1.5ct' kéo dài qua cả '1.5 carats'");
});

test("alignWords ja: nhiều token cùng rơi vào 1 boundary được chia đều; token không có boundary vẫn có thời gian tăng dần", () => {
  const original = "重さ2ctです。";
  const p = compilePronunciation(ja.tts.pronunciation)(original);
  assert.equal(p.text, "重さ2カラットです。");
  const T = (sec) => Math.round(sec * 1e7);
  const boundaries = [
    { text: "重さ", offset: T(0.1), duration: T(0.3) },
    { text: "2カラット", offset: T(0.5), duration: T(0.8) },
    { text: "です", offset: T(1.4), duration: T(0.3) },
  ];
  const words = alignWords({ original, spoken: p.text, spans: p.spans, boundaries, language: "ja", mode: "segmenter" });
  assert.equal(words.map((w) => w.t).join(""), original, "ghép các token = đúng chữ gốc trên video");
  for (let i = 1; i < words.length; i++) assert.ok(words[i].s >= words[i - 1].s, `${words[i - 1].t} -> ${words[i].t}`);
  assert.ok(words.every((w) => w.d > 0));
});

// ---------------------------------------------------------------------------------------------
// runVoiceover: gửi chữ đọc cho engine, cache/tính phí theo chữ đọc, words.json theo chữ gốc
// ---------------------------------------------------------------------------------------------
test("runVoiceover: engine nhận chữ ĐỌC; words.json + chữ trên video giữ chữ GỐC; cache/ký tự tính theo chữ đọc; dòng không đổi thì y như cũ", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pron-"));
  try {
    const sent = [];
    const T = (sec) => Math.round(sec * 1e7);
    const engine = {
      id: "edge",
      async synthesize({ text }) {
        sent.push(text);
        const parts = [...text.matchAll(/[\p{L}\p{N}.]+/gu)].map((m) => m[0]);
        return { audio: Buffer.from(`A:${text}`), boundaries: parts.map((w, i) => ({ text: w, offset: T(0.2 + i * 0.5), duration: T(0.4) })) };
      },
    };
    const tools = {
      probeDuration: async (f) => { const s = fs.readFileSync(f, "utf8"); return s.startsWith("TRIM:") ? Number(s.split(":")[2]) : 5; },
      trimClip: async (_r, final, st, d) => fs.writeFileSync(final, `TRIM:${st}:${d}`),
      detectSpeech: async () => null,
    };
    const ledger = [];
    const lines = [{ id: "line-1", text: "Mohs 10, 2ct stone" }, { id: "line-2", text: "Plain sentence here" }];
    const opts = {
      lines, locale: en, chain: ["edge"], engines: { edge: engine }, voiceFor: () => "en-US-AndrewNeural", speed: 1.1,
      outDir: path.join(dir, "vo"), cache: createTtsCache(path.join(dir, "c")), tools, slug: "demo", log: () => {},
      ledger: (e) => ledger.push(e), costOf: calcTtsCost, retry: { sleep: async () => {} },
      pronounce: compilePronunciation(en.tts.pronunciation),
    };
    const r = await runVoiceover(opts);
    assert.deepEqual(sent, ["Moze 10, 2 carats stone", "Plain sentence here"]);
    assert.deepEqual(ledger.map((e) => e.characters), [[..."Moze 10, 2 carats stone"].length, [..."Plain sentence here"].length]);
    const l1 = r.words["line-1"].map((w) => w.t);
    assert.deepEqual(l1, ["Mohs", "10,", "2ct", "stone"], "chữ hiện trên video = chữ gốc");
    assert.deepEqual(r.words["line-2"].map((w) => w.t), ["Plain", "sentence", "here"]);
    // dòng không đổi: không đọc lại khi chạy lần 2 (cache theo chữ đọc); dòng đổi cũng dùng cache
    await runVoiceover({ ...opts });
    assert.equal(sent.length, 2);
    // đổi bảng phát âm -> chữ đọc đổi -> khoá cache đổi -> đọc lại đúng dòng bị ảnh hưởng
    await runVoiceover({ ...opts, pronounce: compilePronunciation([{ match: "Mohs", say: "Moez", wholeWord: true }]) });
    assert.deepEqual(sent.slice(2), ["Moez 10, 2ct stone"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runVoiceover mặc định (không truyền pronounce) = hành vi cũ, kể cả với chữ có 'ct'", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pron-"));
  try {
    const sent = [];
    const engine = { id: "edge", async synthesize({ text }) { sent.push(text); return { audio: Buffer.from("x"), boundaries: [{ text: "2ct", offset: 1e6, duration: 1e6 }] }; } };
    const tools = { probeDuration: async () => 2, trimClip: async (_r, f) => fs.writeFileSync(f, "t"), detectSpeech: async () => null };
    const r = await runVoiceover({
      lines: [{ id: "line-1", text: "2ct" }], locale: vi, chain: ["edge"], engines: { edge: engine }, voiceFor: () => "v", speed: 1.1,
      outDir: path.join(dir, "vo"), cache: createTtsCache(path.join(dir, "c")), tools, log: () => {}, retry: { sleep: async () => {} },
    });
    assert.deepEqual(sent, ["2ct"]);
    assert.deepEqual(r.words["line-1"].map((w) => w.t), ["2ct"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
