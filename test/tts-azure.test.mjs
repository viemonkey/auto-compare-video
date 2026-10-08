// Azure AI Speech: KHÔNG gọi API thật — fetch giả kiểm tra request đúng đặc tả REST, xử lý lỗi, tính phí, chọn/chuyển engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAzureEngine, buildSsml, azureEndpoint, langOfVoice, AZURE_OUTPUT_FORMAT } from "../scripts/lib/tts/azure.mjs";
import { TtsHttpError, ttsErrorMessage } from "../scripts/lib/tts/messages.mjs";
import { withRetry } from "../scripts/lib/tts/retry.mjs";
import { planEngines, resolveVoice } from "../scripts/lib/tts/select.mjs";
import { runVoiceover } from "../scripts/lib/tts/voiceover.mjs";
import { createTtsCache } from "../scripts/lib/tts/cache.mjs";
import { listEngines, engineReadiness, getEngine, checkRenderability } from "../scripts/lib/capabilities.mjs";
import { calcTtsCost, TTS_PRICING } from "../config/pricing.mjs";
import { resolveLocale, listLocales } from "../scripts/lib/locales.mjs";

const ja = resolveLocale("ja-JP");
const noSleep = async () => {};
const okResponse = (body = "MP3DATA") => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(body), text: async () => "" });
const errResponse = (status, text = "") => ({ ok: false, status, arrayBuffer: async () => Buffer.alloc(0), text: async () => text });

test("azure SSML: ngôn ngữ lấy từ tên giọng, tốc độ +10%, ký tự đặc biệt được escape", () => {
  assert.equal(langOfVoice("ja-JP-KeitaNeural"), "ja-JP");
  const ssml = buildSsml({ text: `A & B <tag> "q" 'x'`, voice: "en-US-AndrewNeural", speed: 1.1 });
  assert.equal(ssml, `<speak version='1.0' xml:lang='en-US'><voice xml:lang='en-US' name='en-US-AndrewNeural'><prosody rate='+10%'>A &amp; B &lt;tag&gt; &quot;q&quot; &apos;x&apos;</prosody></voice></speak>`);
  assert.equal(azureEndpoint("japaneast"), "https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1");
});

test("azure: request đúng đặc tả REST (URL theo vùng, header khoá/Content-Type/OutputFormat/User-Agent, body SSML)", async () => {
  const calls = [];
  const engine = createAzureEngine({ key: "SECRET-KEY", region: "southeastasia", fetchImpl: async (url, init) => { calls.push({ url, init }); return okResponse("abc"); } });
  const out = await engine.synthesize({ text: "こんにちは。", voice: "ja-JP-KeitaNeural", speed: 1.1 });
  assert.equal(out.audio.toString(), "abc");
  assert.deepEqual(out.boundaries, []);
  assert.equal(engine.supportsBoundaries, false);
  const { url, init } = calls[0];
  assert.equal(url, "https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Ocp-Apim-Subscription-Key"], "SECRET-KEY");
  assert.equal(init.headers["Content-Type"], "application/ssml+xml");
  assert.equal(init.headers["X-Microsoft-OutputFormat"], AZURE_OUTPUT_FORMAT);
  assert.match(AZURE_OUTPUT_FORMAT, /mp3/);
  assert.ok(init.headers["User-Agent"]);
  assert.match(init.body, /^<speak version='1\.0' xml:lang='ja-JP'>.*こんにちは。.*<\/speak>$/);
});

test("azure: thiếu khoá/vùng hoặc vùng sai -> lỗi tiếng Việt ngay lúc tạo engine (không gọi mạng)", () => {
  assert.throws(() => createAzureEngine({ key: "", region: "eastus" }), /AZURE_SPEECH_KEY/);
  assert.throws(() => createAzureEngine({ key: "k", region: "" }), /AZURE_SPEECH_REGION/);
  assert.throws(() => createAzureEngine({ key: "k", region: "evil.com/x" }), /không hợp lệ/);
});

test("azure: lỗi HTTP -> TtsHttpError; 401/403 không thử lại, 429/5xx được thử lại; thông báo tiếng Việt", async () => {
  const mk = (res) => createAzureEngine({ key: "k", region: "eastus", fetchImpl: async () => res });
  await assert.rejects(() => mk(errResponse(401, "bad key")).synthesize({ text: "x", voice: "ja-JP-KeitaNeural", speed: 1 }), (e) => e instanceof TtsHttpError && e.status === 401 && /bad key/.test(e.message));
  let calls = 0;
  await assert.rejects(() => withRetry(async () => { calls++; return mk(errResponse(401)).synthesize({ text: "x", voice: "v-v-x", speed: 1 }); }, { maxRetries: 5, sleep: noSleep }));
  assert.equal(calls, 1, "401 không thử lại");
  calls = 0;
  let n = 0;
  const flaky = createAzureEngine({ key: "k", region: "eastus", fetchImpl: async () => (++n < 3 ? errResponse(429) : okResponse()) });
  const out = await withRetry(async () => { calls++; return flaky.synthesize({ text: "x", voice: "v-v-x", speed: 1 }); }, { maxRetries: 5, sleep: noSleep, random: () => 0 });
  assert.equal(calls, 3);
  assert.equal(out.audio.length, 7);
  assert.match(ttsErrorMessage("azure", new TtsHttpError(401)), /AZURE_SPEECH_KEY/);
  assert.match(ttsErrorMessage("azure", new TtsHttpError(429)), /hạn mức|giới hạn/);
});

test("azure: audio rỗng và timeout đều là lỗi", async () => {
  await assert.rejects(() => createAzureEngine({ key: "k", region: "eastus", fetchImpl: async () => okResponse("") }).synthesize({ text: "x", voice: "v-v-x", speed: 1 }), /Empty audio/);
  const hang = (_u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  await assert.rejects(() => createAzureEngine({ key: "k", region: "eastus", fetchImpl: hang, timeoutMs: 20 }).synthesize({ text: "x", voice: "v-v-x", speed: 1 }), /timeout/);
});

test("giá Azure: bảng ghi nguồn + ngày; chi phí theo số ký tự; Edge = 0", () => {
  assert.match(TTS_PRICING.azure.source, /^https:\/\/azure\.microsoft\.com\//);
  assert.match(TTS_PRICING.azure.lastUpdated, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(TTS_PRICING.azure.usdPerMillionChars, 16);
  assert.ok(Math.abs(calcTtsCost("azure", 1_000_000) - 16) < 1e-9);
  assert.ok(Math.abs(calcTtsCost("azure", 250) - 0.004) < 1e-9);
  assert.equal(calcTtsCost("edge", 5_000_000), 0);
  assert.equal(calcTtsCost("khong-co", 100), 0);
  assert.equal(calcTtsCost("azure", 0), 0);
});

test("engine azure trong registry: sẵn sàng chỉ khi có CẢ KEY và REGION; giọng mặc định của locale nằm trong danh sách", () => {
  const azure = getEngine("azure");
  assert.ok(azure, "config/tts-engines/azure.json phải hợp lệ và bật");
  assert.equal(engineReadiness(azure, { env: {} }).ready, false);
  assert.equal(engineReadiness(azure, { env: { AZURE_SPEECH_KEY: "k" } }).ready, false);
  assert.match(engineReadiness(azure, { env: { AZURE_SPEECH_KEY: "k" } }).reason, /AZURE_SPEECH_REGION/);
  assert.equal(engineReadiness(azure, { env: { AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "eastus" } }).ready, true);
  for (const code of ["ja-JP", "en-US", "th-TH"]) {
    const l = resolveLocale(code);
    const voice = resolveVoice({ engine: azure, locale: l });
    assert.ok(azure.voices[code].some((v) => v.id === voice), `${code}: ${voice}`);
  }
});

test("chọn engine với config thật: không khoá -> edge; có khoá + ưu tiên azure -> azure trước, edge dự phòng", () => {
  const engines = listEngines();
  const noKey = planEngines({ locale: ja, engines, readiness: (e) => engineReadiness(e, { env: {} }) });
  assert.deepEqual(noKey.chain, ["edge"]);
  const key = { AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "eastus" };
  const withKey = planEngines({ locale: ja, engines, readiness: (e) => engineReadiness(e, { env: key }) });
  assert.deepEqual(withKey.chain, ["azure", "edge"]);
  // đổi thứ tự ưu tiên trong config (không sửa code) -> edge trước
  const edgeFirst = { ...ja, tts: { ...ja.tts, priority: ["edge", "azure"] } };
  assert.deepEqual(planEngines({ locale: edgeFirst, engines, readiness: (e) => engineReadiness(e, { env: key }) }).chain, ["edge", "azure"]);
  for (const l of listLocales().filter((x) => x.tts)) assert.ok(l.tts.priority.every((id) => engines.some((e) => e.id === id)), `${l.code}: tts.priority trỏ tới engine không tồn tại`);
});

test("vi-VN: thêm engine azure không làm đổi khả năng dựng / mặc định của vi-VN", () => {
  const vi = resolveLocale("vi-VN");
  assert.equal(vi.tts, undefined);
  assert.equal(checkRenderability(vi).renderable, true);
  assert.deepEqual(planEngines({ locale: vi, requested: "vieneu", engines: listEngines(), readiness: () => ({ ready: true, reason: "" }) }).chain, ["vieneu"]);
});

test("Edge lỗi liên tục + có khoá Azure -> runVoiceover tự chuyển sang Azure (fetch giả), ghi sổ có phí theo ký tự", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "azure-"));
  try {
    const edge = { id: "edge", async synthesize() { throw new Error("No audio was received"); } };
    const azure = createAzureEngine({ key: "k", region: "eastus", fetchImpl: async () => okResponse("AUDIOBYTES") });
    const ledger = [];
    const logs = [];
    const tools = {
      probeDuration: async (f) => (fs.readFileSync(f, "utf8").startsWith("TRIM:") ? Number(fs.readFileSync(f, "utf8").split(":")[2]) : 2.0),
      trimClip: async (_r, final, s, d) => fs.writeFileSync(final, `TRIM:${s}:${d}`),
      detectSpeech: async () => ({ start: 0.25, end: 1.6 }),
    };
    const lines = [{ id: "line-1", text: "これはテストです。" }, { id: "line-2", text: "二行目です。" }];
    const result = await runVoiceover({
      lines, locale: ja, chain: ["edge", "azure"], engines: { edge, azure }, voiceFor: () => "ja-JP-KeitaNeural", speed: 1.1,
      outDir: path.join(dir, "vo"), cache: createTtsCache(path.join(dir, "c")), tools, slug: "demo", log: (m) => logs.push(m),
      ledger: (e) => ledger.push(e), costOf: (id, n) => calcTtsCost(id, n), retry: { maxRetries: 2, sleep: noSleep, random: () => 0 },
    });
    assert.equal(result.engineId, "azure");
    assert.ok(logs.some((l) => /TỰ CHUYỂN sang "azure"/.test(l)));
    const ok = ledger.filter((e) => e.status === "success");
    assert.deepEqual(ok.map((e) => [e.engine, e.characters]), [["azure", 9], ["azure", 6]]);
    assert.ok(Math.abs(ok[0].costUsd - 9 * 0.000016) < 1e-12);
    assert.ok(ledger.some((e) => e.engine === "edge" && e.status === "error" && e.costUsd === 0));
    // trim theo khoảng có tiếng phát hiện được (0.25 - 0.08 .. min(raw 2.0, 1.6 + 0.14)), words ước lượng không rỗng
    const [, start, dur] = fs.readFileSync(path.join(dir, "vo", "line-1.mp3"), "utf8").split(":").map(Number);
    assert.ok(Math.abs(start - 0.17) < 1e-6 && Math.abs(dur - 1.57) < 1e-6, `${start} ${dur}`);
    const words = JSON.parse(fs.readFileSync(path.join(dir, "vo", "words.json"), "utf8"));
    assert.ok(words["line-1"].length >= 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
