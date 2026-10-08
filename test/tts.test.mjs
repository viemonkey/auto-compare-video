import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ttsCacheKey, createTtsCache } from "../scripts/lib/tts/cache.mjs";
import { withRetry } from "../scripts/lib/tts/retry.mjs";
import { TtsHttpError, ttsErrorMessage, isPermanent } from "../scripts/lib/tts/messages.mjs";
import { resolveVoice, resolveSpeed, planEngines, defaultEngineId, DEFAULT_SPEED } from "../scripts/lib/tts/select.mjs";
import { createEdgeEngine, speedToRate } from "../scripts/lib/tts/edge.mjs";
import { runVoiceover, estimateWordTimings, EngineFailure, TRIM_LEAD, TRIM_TRAIL } from "../scripts/lib/tts/voiceover.mjs";
import { parseSilenceDetect } from "../scripts/lib/tts/audio-tools.mjs";
import { appendCostEntry } from "../scripts/lib/cost-ledger.mjs";
import { listEngines, engineReadiness } from "../scripts/lib/capabilities.mjs";
import { resolveLocale } from "../scripts/lib/locales.mjs";
import { calcTtsCost, TTS_PRICING } from "../config/pricing.mjs";
import { computeTiming } from "../scripts/lib/compose.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ja = resolveLocale("ja-JP");
const vi = resolveLocale("vi-VN");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tts-test-"));
const noSleep = async () => {};

// ---------------------------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------------------------
test("cache: khoá khác nhau khi đổi engine / giọng / tốc độ / chữ, giống nhau khi giống hệt", () => {
  const base = { engine: "edge", voice: "ja-JP-KeitaNeural", speed: 1.1, text: "こんにちは。" };
  const k = ttsCacheKey(base);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(ttsCacheKey({ ...base }), k);
  for (const change of [{ engine: "azure" }, { voice: "ja-JP-NanamiNeural" }, { speed: 1.0 }, { text: "こんにちは！" }]) {
    assert.notEqual(ttsCacheKey({ ...base, ...change }), k, JSON.stringify(change));
  }
});

test("cache: ghi rồi đọc lại đúng audio + boundary; thiếu / hỏng -> null", () => {
  const dir = tmp();
  try {
    const cache = createTtsCache(dir);
    assert.equal(cache.get("abc"), null);
    cache.put("abc", { audio: Buffer.from("mp3-bytes"), boundaries: [{ text: "a", offset: 1, duration: 2 }] }, { engine: "edge" });
    const hit = cache.get("abc");
    assert.equal(hit.audio.toString(), "mp3-bytes");
    assert.deepEqual(hit.boundaries, [{ text: "a", offset: 1, duration: 2 }]);
    fs.writeFileSync(path.join(dir, "abc.json"), "{ không phải json");
    assert.equal(cache.get("abc"), null);
    fs.writeFileSync(path.join(dir, "empty.mp3"), "");
    fs.writeFileSync(path.join(dir, "empty.json"), JSON.stringify({ version: 1, boundaries: [] }));
    assert.equal(cache.get("empty"), null, "audio rỗng không được coi là cache hợp lệ");
    assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith(".tmp")), "không để lại file tạm");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// retry / backoff / thông báo lỗi
// ---------------------------------------------------------------------------------------------
test("retry: thất bại vài lần rồi thành công; thời gian chờ tăng dần có trần + jitter", async () => {
  const waits = [];
  let calls = 0;
  const result = await withRetry(
    async (attempt) => {
      calls++;
      if (attempt < 4) throw new Error("No audio was received");
      return "ok";
    },
    { maxRetries: 8, baseMs: 1000, maxMs: 2500, jitterMs: 100, sleep: async (ms) => waits.push(ms), random: () => 0.5 },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 4);
  assert.deepEqual(waits, [1050, 2050, 2550]); // 1000, 2000, min(3000, 2500) + jitter 50
});

test("retry: hết lượt thì ném lỗi gốc kèm attempts; lỗi cấu hình (401) thì không thử lại", async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw new Error("boom"); }, { maxRetries: 3, sleep: noSleep }),
    (e) => e.message === "boom" && e.attempts === 3,
  );
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(() => withRetry(async () => { calls++; throw new TtsHttpError(401, "denied"); }, { maxRetries: 8, sleep: noSleep }), TtsHttpError);
  assert.equal(calls, 1);
  assert.equal(isPermanent(new TtsHttpError(429)), false);
  assert.equal(isPermanent(new TtsHttpError(403)), true);
});

test("thông báo lỗi giọng đọc bằng tiếng Việt, nói rõ phải làm gì", () => {
  assert.match(ttsErrorMessage("azure", new TtsHttpError(401)), /AZURE_SPEECH_KEY.*AZURE_SPEECH_REGION/);
  assert.match(ttsErrorMessage("azure", new TtsHttpError(429)), /giới hạn|hạn mức/);
  assert.match(ttsErrorMessage("azure", new TtsHttpError(503)), /sự cố/);
  assert.match(ttsErrorMessage("edge", new Error("EdgeTTS synthesize timeout (20s)")), /không phản hồi kịp/);
  assert.match(ttsErrorMessage("edge", new Error("No audio was received")), /âm thanh rỗng/);
  assert.match(ttsErrorMessage("edge", new Error("getaddrinfo ENOTFOUND speech.platform.bing.com")), /kết nối mạng/);
  assert.match(ttsErrorMessage("edge", new Error("lạ")), /Edge TTS lỗi: lạ/);
});

// ---------------------------------------------------------------------------------------------
// chọn engine + giọng theo config
// ---------------------------------------------------------------------------------------------
const fakeEngines = [
  { id: "vieneu", languages: ["vi"], label: "VieNeu" },
  { id: "edge", languages: ["vi", "ja", "en", "th"], label: "Edge" },
  { id: "azure", languages: ["vi", "ja", "en", "th"], label: "Azure" },
  { id: "vbee", languages: ["vi"], label: "Vbee" },
];
const ready = (ids) => (e) => (ids.includes(e.id) ? { ready: true, reason: "" } : { ready: false, reason: `Thiếu khoá cho ${e.id}` });

test("giọng mặc định mỗi locale nằm trong config locale (nam, đổi được không sửa code); ghi đè thắng config", () => {
  const edge = listEngines().find((e) => e.id === "edge");
  assert.equal(resolveVoice({ engine: edge, locale: ja }), ja.tts.voices.edge);
  assert.equal(resolveVoice({ engine: edge, locale: resolveLocale("en-US") }), "en-US-AndrewNeural");
  assert.equal(resolveVoice({ engine: edge, locale: resolveLocale("th-TH") }), "th-TH-NiwatNeural");
  assert.equal(resolveVoice({ engine: edge, locale: ja, override: "ja-JP-NanamiNeural" }), "ja-JP-NanamiNeural");
  // vi-VN không khai báo tts -> rơi về defaultVoices của engine (hành vi cũ)
  assert.equal(resolveVoice({ engine: edge, locale: vi }), "vi-VN-NamMinhNeural");
  const custom = { ...ja, tts: { ...ja.tts, voices: { edge: "ja-JP-DaichiNeural" } } };
  assert.equal(resolveVoice({ engine: edge, locale: custom }), "ja-JP-DaichiNeural");
  assert.equal(resolveSpeed(ja), DEFAULT_SPEED);
  assert.equal(resolveSpeed({ tts: { speed: 1 } }), 1);
});

test("planEngines: không có khoá Azure -> edge; có khoá Azure và config ưu tiên azure -> azure trước, edge dự phòng", () => {
  const noKey = planEngines({ locale: ja, engines: fakeEngines, readiness: ready(["edge", "vieneu"]) });
  assert.deepEqual(noKey.chain, ["edge"]);
  assert.ok(noKey.notes.some((n) => /Azure/.test(n)));
  const withKey = planEngines({ locale: ja, engines: fakeEngines, readiness: ready(["edge", "azure"]) });
  assert.deepEqual(withKey.chain, ["azure", "edge"]);
  assert.equal(defaultEngineId({ locale: ja, engines: fakeEngines, readiness: ready(["edge", "azure"]) }), "azure");
  assert.equal(defaultEngineId({ locale: ja, engines: fakeEngines, readiness: ready(["edge"]) }), "edge");
  assert.equal(defaultEngineId({ locale: ja, engines: fakeEngines, readiness: ready([]) }), null);
});

test("planEngines: engine người dùng chọn thắng thứ tự config nếu dùng được; engine không hỗ trợ ngôn ngữ bị bỏ qua", () => {
  const r = planEngines({ locale: ja, requested: "edge", engines: fakeEngines, readiness: ready(["edge", "azure"]) });
  assert.deepEqual(r.chain, ["edge", "azure"]);
  const unsupported = planEngines({ locale: ja, requested: "vieneu", engines: fakeEngines, readiness: ready(["edge", "vieneu"]) });
  assert.deepEqual(unsupported.chain, ["edge"]);
  assert.ok(unsupported.notes.some((n) => /vieneu/.test(n)));
});

test("planEngines vi-VN: giữ hành vi cũ — đúng engine được chọn, không tự chuyển", () => {
  assert.deepEqual(planEngines({ locale: vi, requested: "vieneu", engines: fakeEngines, readiness: ready(["edge", "azure", "vieneu"]) }).chain, ["vieneu"]);
  assert.deepEqual(planEngines({ locale: vi, requested: "edge", engines: fakeEngines, readiness: ready(["edge", "azure"]) }).chain, ["edge"]);
});

test("config engine thật: edge hỗ trợ vi/ja/en/th; mọi locale có giọng mặc định hợp lệ cho edge", () => {
  const edge = listEngines().find((e) => e.id === "edge");
  assert.deepEqual([...edge.languages].sort(), ["en", "ja", "th", "vi"]);
  for (const code of ["ja-JP", "en-US", "th-TH"]) {
    const l = resolveLocale(code);
    const voice = resolveVoice({ engine: edge, locale: l });
    assert.ok(voice.startsWith(`${l.language}-`), `${code}: ${voice}`);
    assert.ok(edge.voices[code].some((v) => v.id === voice), `${code}: giọng ${voice} phải nằm trong danh sách giọng của engine`);
  }
  assert.equal(engineReadiness(edge, { env: {} }).ready, true);
});

// ---------------------------------------------------------------------------------------------
// engine Edge (class EdgeTTS giả)
// ---------------------------------------------------------------------------------------------
test("edge: speed 1.1 -> +10%; trả audio + boundary đúng định dạng", async () => {
  assert.equal(speedToRate(1.1), "+10%");
  assert.equal(speedToRate(0.9), "-10%");
  const seen = [];
  class FakeEdge {
    constructor(text, voice, opts) { seen.push({ text, voice, opts }); }
    async synthesize() { return { audio: new Blob([Buffer.from("mp3")]), subtitle: [{ text: "こんにちは", offset: 1_000_000, duration: 5_000_000 }] }; }
  }
  const out = await createEdgeEngine({ EdgeTTS: FakeEdge }).synthesize({ text: "こんにちは。", voice: "ja-JP-KeitaNeural", speed: 1.1 });
  assert.deepEqual(seen[0], { text: "こんにちは。", voice: "ja-JP-KeitaNeural", opts: { rate: "+10%" } });
  assert.equal(out.audio.toString(), "mp3");
  assert.deepEqual(out.boundaries, [{ text: "こんにちは", offset: 1_000_000, duration: 5_000_000 }]);
});

test("edge: audio rỗng và quá thời gian đều báo lỗi", async () => {
  class Empty { async synthesize() { return { audio: new Blob([]), subtitle: [] }; } }
  await assert.rejects(() => createEdgeEngine({ EdgeTTS: Empty }).synthesize({ text: "x", voice: "v", speed: 1 }), /Empty audio/);
  class Hang { synthesize() { return new Promise(() => {}); } }
  await assert.rejects(() => createEdgeEngine({ EdgeTTS: Hang, timeoutMs: 20 }).synthesize({ text: "x", voice: "v", speed: 1 }), /timeout/);
});

// ---------------------------------------------------------------------------------------------
// voiceover: cache, retry, chuyển engine, timing, sổ chi phí
// ---------------------------------------------------------------------------------------------
// audio giả: "mp3" = chuỗi; thời lượng file thô = 0.05s/ký tự + 0.9s đệm; clip đã cắt = đúng độ dài yêu cầu
function makeTools(log = []) {
  return {
    async probeDuration(file) {
      const s = fs.readFileSync(file, "utf8");
      if (s.startsWith("TRIM:")) return parseFloat(s.split(":")[2]);
      return s.length * 0.05 + 0.9;
    },
    async trimClip(raw, final, start, dur) {
      log.push({ raw: path.basename(raw), start, dur });
      fs.writeFileSync(final, `TRIM:${start}:${dur}`);
    },
    async detectSpeech(file) {
      const s = fs.readFileSync(file, "utf8");
      return { start: 0.2, end: s.length * 0.05 + 0.2 };
    },
  };
}

function fakeEngine(id, { fail = 0, failAll = false, boundaries = true } = {}) {
  const calls = [];
  let failures = 0;
  return {
    id,
    calls,
    async synthesize({ text, voice, speed }) {
      calls.push({ text, voice, speed });
      if (failAll || failures < fail) {
        failures++;
        throw new Error("No audio was received");
      }
      const b = boundaries
        ? [...text.replace(/[。、！？.,!?]/g, "").matchAll(/[\p{L}\p{N}]+/gu)].map((m, i) => ({ text: m[0], offset: (2_000_000 + i * 3_000_000), duration: 2_500_000 }))
        : [];
      return { audio: Buffer.from(`AUDIO:${text}`), boundaries: b };
    },
  };
}

const LINES = [
  { id: "line-1", text: "これはダイヤモンドです。" },
  { id: "line-2", text: "これはルビーです。" },
  { id: "line-3", text: "硬度はちがいます。" },
];

async function run(over = {}) {
  const dir = tmp();
  const ledger = [];
  const logs = [];
  const base = {
    lines: LINES, locale: ja, chain: ["edge"], engines: { edge: fakeEngine("edge") }, voiceFor: () => "ja-JP-KeitaNeural", speed: 1.1,
    outDir: path.join(dir, "vo"), cache: createTtsCache(path.join(dir, "cache")), tools: makeTools(), ledger: (e) => ledger.push(e),
    costOf: (id, n) => calcTtsCost(id, n), slug: "demo-ja", log: (m) => logs.push(m), retry: { sleep: noSleep, random: () => 0 },
  };
  const opts = { ...base, ...over };
  try {
    const result = await runVoiceover(opts);
    return { result, ledger, logs, dir, opts };
  } catch (error) {
    return { error, ledger, logs, dir, opts };
  }
}

test("voiceover: đọc đủ mọi dòng, cắt lặng theo boundary, ghi durations/words, sổ chi phí engine=edge cost 0", async () => {
  const toolLog = [];
  const { result, ledger, dir } = await run({ tools: makeTools(toolLog) });
  try {
    assert.equal(result.engineId, "edge");
    assert.deepEqual(Object.keys(result.durations), ["line-1", "line-2", "line-3"]);
    // cắt: lead = offset đầu (0.2s) - 0.08, đuôi = boundary cuối + 0.14
    const first = toolLog[0];
    assert.ok(Math.abs(first.start - (0.2 - TRIM_LEAD)) < 1e-9);
    // thời lượng ghi ra = thời lượng clip đã cắt (làm tròn 3 số lẻ)
    for (const l of LINES) assert.ok(Math.abs(result.durations[l.id] - Number(fs.readFileSync(path.join(dir, "vo", `${l.id}.mp3`), "utf8").split(":")[2])) < 0.0006);
    const durationsFile = JSON.parse(fs.readFileSync(path.join(dir, "vo", "durations.json"), "utf8"));
    assert.deepEqual(durationsFile, result.durations);
    const words = JSON.parse(fs.readFileSync(path.join(dir, "vo", "words.json"), "utf8"));
    assert.ok(words["line-1"].length >= 1);
    for (const w of words["line-1"]) assert.ok(w.s >= 0 && w.d > 0);
    // sổ chi phí: 1 dòng/ lần đọc thật, engine=edge, 0 USD, đúng số ký tự
    assert.equal(ledger.length, 3);
    for (const [i, e] of ledger.entries()) {
      assert.equal(e.task, "tts");
      assert.equal(e.engine, "edge");
      assert.equal(e.costUsd, 0);
      assert.equal(e.status, "success");
      assert.equal(e.characters, [...LINES[i].text].length);
      assert.equal(e.voice, "ja-JP-KeitaNeural");
      assert.equal(e.locale, "ja-JP");
      assert.equal(e.slug, "demo-ja");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("voiceover: dựng lại -> dùng cache, không gọi engine, không ghi sổ; sửa 1 dòng -> chỉ đọc lại đúng dòng đó", async () => {
  const engine = fakeEngine("edge");
  const first = await run({ engines: { edge: engine } });
  try {
    assert.equal(engine.calls.length, 3);
    const again = await run({ engines: { edge: engine }, cache: first.opts.cache, outDir: first.opts.outDir });
    assert.equal(engine.calls.length, 3, "không gọi lại engine");
    assert.equal(again.ledger.length, 0, "không ghi sổ cho dòng lấy từ cache");
    assert.equal(again.result.stats.cached, 3);
    assert.deepEqual(again.result.durations, first.result.durations);
    const edited = [LINES[0], { id: "line-2", text: "これはサファイアです。" }, LINES[2]];
    const third = await run({ engines: { edge: engine }, cache: first.opts.cache, outDir: first.opts.outDir, lines: edited });
    assert.equal(engine.calls.length, 4);
    assert.equal(engine.calls[3].text, "これはサファイアです。");
    assert.deepEqual([third.result.stats.synthesized, third.result.stats.cached], [1, 2]);
    // đổi giọng -> khoá khác -> đọc lại
    await run({ engines: { edge: engine }, cache: first.opts.cache, outDir: first.opts.outDir, voiceFor: () => "ja-JP-NanamiNeural" });
    assert.equal(engine.calls.length, 7);
  } finally {
    fs.rmSync(first.dir, { recursive: true, force: true });
  }
});

test("voiceover: lỗi tạm thời được thử lại (thông báo tiếng Việt trong log) rồi thành công", async () => {
  const engine = fakeEngine("edge", { fail: 2 });
  const { result, logs, dir } = await run({ engines: { edge: engine } });
  try {
    assert.equal(result.engineId, "edge");
    assert.equal(engine.calls.length, 3 + 2);
    assert.ok(logs.some((l) => /Thử lại 1\/8.*âm thanh rỗng/.test(l)), logs.join("\n"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("voiceover: edge lỗi liên tục + có azure -> TỰ CHUYỂN sang azure, đọc lại toàn bộ bằng azure, ghi log + sổ (lỗi edge, thành công azure có phí)", async () => {
  const edge = fakeEngine("edge", { failAll: true });
  const azure = fakeEngine("azure", { boundaries: false });
  const { result, ledger, logs, dir } = await run({
    chain: ["edge", "azure"],
    engines: { edge, azure },
    voiceFor: (id) => (id === "edge" ? "ja-JP-KeitaNeural" : "ja-JP-KeitaNeural"),
    costOf: (id, n) => (id === "azure" ? n * 0.000016 : 0),
    retry: { sleep: noSleep, random: () => 0, maxRetries: 3 },
  });
  try {
    assert.equal(result.engineId, "azure");
    assert.deepEqual(result.switchedFrom, ["edge"]);
    assert.equal(edge.calls.length, 3, "edge thử 3 lần rồi bỏ");
    assert.equal(azure.calls.length, 3, "azure đọc đủ cả 3 dòng");
    assert.ok(logs.some((l) => /TỰ CHUYỂN sang "azure"/.test(l)), logs.join("\n"));
    assert.equal(ledger[0].engine, "edge");
    assert.equal(ledger[0].status, "error");
    assert.match(ledger[0].errorMessage, /No audio/);
    const okRows = ledger.filter((e) => e.status === "success");
    assert.equal(okRows.length, 3);
    assert.ok(okRows.every((e) => e.engine === "azure" && e.costUsd > 0));
    // azure không có boundary -> words ước lượng, tổng khớp thời lượng clip
    const words = JSON.parse(fs.readFileSync(path.join(dir, "vo", "words.json"), "utf8"));
    for (const l of LINES) {
      const w = words[l.id];
      const end = w.at(-1).s + w.at(-1).d;
      assert.ok(end <= result.durations[l.id] + 0.01, `${l.id}: ${end} > ${result.durations[l.id]}`);
      assert.ok(w.every((x, i) => i === 0 || x.s >= w[i - 1].s));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("voiceover: engine cuối cùng cũng lỗi -> ném lỗi tiếng Việt (không nuốt lỗi)", async () => {
  const { error, ledger, dir } = await run({ engines: { edge: fakeEngine("edge", { failAll: true }) }, retry: { sleep: noSleep, random: () => 0, maxRetries: 2 } });
  try {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Edge TTS trả về âm thanh rỗng/);
    assert.equal(ledger.at(-1).status, "error");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("voiceover: thiếu giọng -> báo rõ nơi cần khai báo; lỗi cấu hình không bị chuyển engine nhầm", async () => {
  const { error, dir } = await run({ voiceFor: () => undefined });
  try {
    assert.match(error.message, /config\/locales\/ja-JP\.json/);
    assert.ok(!(error instanceof EngineFailure));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("timeline: thời lượng audio (sau cắt) đi thẳng vào computeTiming giống luồng vi-VN (gap phẳng, start nối tiếp)", async () => {
  const { result, dir } = await run();
  try {
    const lines = LINES.map((l, i) => ({ ...l, n: i + 1 }));
    const { timing, ROOT_DURATION } = computeTiming(lines, result.durations);
    assert.equal(timing[0].start, 0.55);
    for (let i = 1; i < timing.length; i++) {
      assert.ok(Math.abs(timing[i].start - (timing[i - 1].start + timing[i - 1].dur + 0.14)) < 0.002);
    }
    assert.ok(ROOT_DURATION > timing.at(-1).start + timing.at(-1).dur);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("estimateWordTimings: chia theo độ dài token, liên tục, kết thúc đúng mốc", () => {
  const w = estimateWordTimings(["ab", "cdef", "g"], 0.1, 1.5);
  assert.equal(w.length, 3);
  assert.equal(w[0].s, 0.1);
  assert.ok(w[1].d > w[0].d && w[0].d > w[2].d);
  const end = w.at(-1).s + w.at(-1).d;
  assert.ok(Math.abs(end - 1.5) < 0.01);
  for (let i = 1; i < w.length; i++) assert.ok(Math.abs(w[i].s - (w[i - 1].s + w[i - 1].d)) < 0.002);
});

test("parseSilenceDetect: lặng đầu + lặng cuối", () => {
  const log = "silence_start: 0\nsilence_end: 0.31 | silence_duration: 0.31\nsilence_start: 2.5\n";
  assert.deepEqual(parseSilenceDetect(log, 3.4), { start: 0.31, end: 2.5 });
  assert.deepEqual(parseSilenceDetect("", 3.4), { start: 0, end: 3.4 });
  assert.deepEqual(parseSilenceDetect("silence_start: 1.0\nsilence_end: 1.2 | silence_duration: 0.2\n", 3.4), { start: 0, end: 3.4 });
});

// ---------------------------------------------------------------------------------------------
// cost-ledger
// ---------------------------------------------------------------------------------------------
test("cost-ledger: dòng tts mang engine, số ký tự, giọng; không bị coi là 'chưa có giá'", () => {
  const dir = tmp();
  const prev = process.env.COST_LEDGER_PATH;
  process.env.COST_LEDGER_PATH = path.join(dir, "ledger.jsonl");
  try {
    appendCostEntry({ slug: "demo-ja", locale: "ja-JP", task: "tts", engine: "edge", voice: "ja-JP-KeitaNeural", characters: 12, model: null, status: "success", costUsd: 0 });
    const row = JSON.parse(fs.readFileSync(process.env.COST_LEDGER_PATH, "utf8").trim());
    assert.deepEqual(
      { task: row.task, engine: row.engine, characters: row.characters, voice: row.voice, cost_usd: row.cost_usd, model: row.model, locale: row.locale },
      { task: "tts", engine: "edge", characters: 12, voice: "ja-JP-KeitaNeural", cost_usd: 0, model: null, locale: "ja-JP" },
    );
    assert.equal(TTS_PRICING.edge.usdPerMillionChars, 0);
  } finally {
    if (prev === undefined) delete process.env.COST_LEDGER_PATH;
    else process.env.COST_LEDGER_PATH = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("template generate-vo.mjs: khối LINES vẫn thay được bằng regex của scaffold; không còn CDN/bí mật", () => {
  const src = fs.readFileSync(path.join(ROOT, "templates", "auto-compare", "generate-vo.mjs"), "utf8");
  assert.equal([...src.matchAll(/const LINES = \[[\s\S]*?\n\];/g)].length, 1);
  assert.match(src, /VIDEO_LOCALE/);
  assert.match(src, /mainPipeline/);
});
