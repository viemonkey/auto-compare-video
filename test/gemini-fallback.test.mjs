// Fallback model qua generateJson (rewrite/translate) với fetch giả + kiểm tra tên model lúc khởi động.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateJson } from "../scripts/lib/gemini-client.mjs";
import { resolveGeminiModels, validateGeminiModels } from "../scripts/lib/gemini-models.mjs";

const okBody = (obj) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }),
  text: async () => "",
});
const errBody = (status) => ({ ok: false, status, text: async () => JSON.stringify({ error: { code: status, status: "UNAVAILABLE", message: "overloaded" } }), json: async () => ({}) });
const modelOf = (url) => /models\/([^:]+):/.exec(url)[1];

async function withEnv(env, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gf-"));
  const saved = {};
  const all = { GEMINI_API_KEY: "test-key-not-real", COST_LEDGER_PATH: path.join(dir, "l.jsonl"), ...env };
  for (const k of ["GEMINI_MODEL", "GEMINI_FALLBACK_MODEL", ...Object.keys(all)]) saved[k] = process.env[k];
  for (const k of ["GEMINI_MODEL", "GEMINI_FALLBACK_MODEL"]) delete process.env[k];
  Object.assign(process.env, all);
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    return await fn(dir);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
    for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const call = () => generateJson({ systemPrompt: "s", userText: "u", schema: { type: "object" }, ledger: { task: "content-generation", subtask: "field-rewrite" } });

test("generateJson: model chính 503 liên tục -> chạy lại bằng GEMINI_FALLBACK_MODEL, báo usedFallback", async () => {
  await withEnv({ GEMINI_MODEL: "m-main", GEMINI_FALLBACK_MODEL: "m-lite" }, async () => {
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(modelOf(url));
      return modelOf(url) === "m-main" ? errBody(503) : okBody({ x: 1 });
    };
    const out = await call();
    assert.deepEqual(out.result, { x: 1 });
    assert.equal(out.model, "m-lite");
    assert.equal(out.primaryModel, "m-main");
    assert.equal(out.usedFallback, true);
    assert.equal(urls.filter((m) => m === "m-main").length, 3, "model chính được retry đủ 3 lần trước khi chuyển");
    assert.equal(urls.filter((m) => m === "m-lite").length, 1);
  });
});

test("generateJson: model chính ổn -> không đụng fallback; usedFallback=false", async () => {
  await withEnv({ GEMINI_MODEL: "m-main", GEMINI_FALLBACK_MODEL: "m-lite" }, async () => {
    const urls = [];
    globalThis.fetch = async (url) => (urls.push(modelOf(url)), okBody({ x: 1 }));
    const out = await call();
    assert.deepEqual(urls, ["m-main"]);
    assert.equal(out.usedFallback, false);
  });
});

test("generateJson: cả 2 model đều 503 -> lỗi 'quá tải' tiếng Việt, đúng 6 lần gọi, không lặp", async () => {
  await withEnv({ GEMINI_MODEL: "m-main", GEMINI_FALLBACK_MODEL: "m-lite" }, async () => {
    let n = 0;
    globalThis.fetch = async () => (n++, errBody(503));
    await assert.rejects(call(), (e) => /quá tải/.test(e.userMessage));
    assert.equal(n, 6);
  });
});

test("resolveGeminiModels: mặc định, trim, fallback trùng chính = không có dự phòng", () => {
  assert.deepEqual(resolveGeminiModels({}), { primary: "gemini-3.5-flash", fallback: "" });
  assert.deepEqual(resolveGeminiModels({ GEMINI_MODEL: " a ", GEMINI_FALLBACK_MODEL: " b " }), { primary: "a", fallback: "b" });
  assert.deepEqual(resolveGeminiModels({ GEMINI_MODEL: "a", GEMINI_FALLBACK_MODEL: "a" }), { primary: "a", fallback: "" });
});

const listing = (names, next) => ({ ok: true, status: 200, json: async () => ({ models: names.map((n) => ({ name: `models/${n}` })), nextPageToken: next }) });
const logSink = () => {
  const warns = [];
  return { warns, log: { warn: (m) => warns.push(m), info: () => {} } };
};

test("validateGeminiModels: tên sai -> cảnh báo đúng biến; tên đúng (qua nhiều trang) -> không cảnh báo", async () => {
  const { warns, log } = logSink();
  const pages = [listing(["a"], "p2"), listing(["b"])];
  const r = await validateGeminiModels({ env: { GEMINI_API_KEY: "k", GEMINI_MODEL: "a", GEMINI_FALLBACK_MODEL: "b" }, fetchImpl: async () => pages.shift(), log });
  assert.equal(r.checked, true);
  assert.deepEqual(r.warnings, []);
  assert.equal(warns.length, 0);

  const s = logSink();
  const r2 = await validateGeminiModels({ env: { GEMINI_API_KEY: "k", GEMINI_MODEL: "a", GEMINI_FALLBACK_MODEL: "typo" }, fetchImpl: async () => listing(["a"]), log: s.log });
  assert.equal(r2.warnings.length, 1);
  assert.match(r2.warnings[0], /GEMINI_FALLBACK_MODEL="typo"/);
  assert.equal(s.warns.length, 1);
});

test("validateGeminiModels: không đặt fallback -> nhắc; list lỗi -> chỉ cảnh báo, không ném", async () => {
  const s = logSink();
  const r = await validateGeminiModels({ env: { GEMINI_API_KEY: "k", GEMINI_MODEL: "a" }, fetchImpl: async () => listing(["a"]), log: s.log });
  assert.match(r.warnings[0], /Chưa đặt GEMINI_FALLBACK_MODEL/);

  const s2 = logSink();
  const r2 = await validateGeminiModels({ env: { GEMINI_API_KEY: "k", GEMINI_MODEL: "a" }, fetchImpl: async () => ({ ok: false, status: 403 }), log: s2.log });
  assert.equal(r2.checked, false);
  assert.ok(r2.warnings.some((w) => /Không kiểm tra được/.test(w)));

  const none = await validateGeminiModels({ env: {}, fetchImpl: async () => { throw new Error("không được gọi"); }, log: s.log });
  assert.equal(none.checked, false);
});

test("generatedByOf / buildRecord: lưu model sinh nội dung (kèm cờ dự phòng) vào bản ghi để mở lại còn badge", async () => {
  const { generatedByOf, buildRecord } = await import("../server-market.mjs");
  assert.equal(generatedByOf(undefined), null);
  assert.deepEqual(generatedByOf({ model: "m-lite", primary_model: "m-main", used_fallback: true }), { model: "m-lite", primary: "m-main", isFallback: true });
  assert.deepEqual(generatedByOf({ model: "m-main", primary_model: "m-main", used_fallback: false }), { model: "m-main", primary: "m-main", isFallback: false });
  const rec = buildRecord({ content: { points: [], _meta: { model: "m-lite", primary_model: "m-main", used_fallback: true } }, locale: { code: "ja-JP" }, hashtagPlan: [], status: "draft" });
  assert.equal(rec._meta.generatedBy.isFallback, true);
  assert.equal(generatedByOf(rec._meta).model, "m-lite");
});
