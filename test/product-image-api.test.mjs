// Adapter gọi API ảnh Gemini (generateContent + Batch) với fetch giả: hình dạng request, chi phí vào sổ, lỗi billing/model/safety, thử lại, Batch.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateImage, buildImageRequest, extractImage } from "../scripts/lib/product/image-gen.mjs";
import { generateImagesBatch, batchState, inlinedResponsesOf } from "../scripts/lib/product/image-batch.mjs";
import { BillingRequiredError, ModelUnavailableError } from "../scripts/lib/product/billing.mjs";
import { createProductStore } from "../scripts/lib/product/store.mjs";
import { createBillingState } from "../scripts/lib/product/billing.mjs";
import { createSceneService } from "../scripts/lib/product/scene-flow.mjs";
import { createSceneCache } from "../scripts/lib/product/scene-cache.mjs";
import { planScenes } from "../scripts/lib/product/scenes.mjs";
import { loadProductConfig } from "../scripts/lib/product/config.mjs";
import { appendCostEntry } from "../scripts/lib/cost-ledger.mjs";
import { tmpDir, makeRingPng, makeSolidPng, imageResponse, errorResponse } from "./helpers/product-fixtures.mjs";

const config = loadProductConfig();
const saved = {};
let dir;
beforeEach(() => {
  dir = tmpDir("pi-");
  for (const k of ["GEMINI_API_KEY", "COST_LEDGER_PATH", "PRODUCT_IMAGE_BATCH", "GEMINI_BILLING_ENABLED"]) saved[k] = process.env[k];
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.COST_LEDGER_PATH = path.join(dir, "ledger.jsonl");
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
const rows = () => (fs.existsSync(process.env.COST_LEDGER_PATH) ? fs.readFileSync(process.env.COST_LEDGER_PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const B64 = Buffer.from("fake-png-bytes").toString("base64");
const base = { prompt: "p", references: [{ mimeType: "image/jpeg", data: "AAAA" }, { mimeType: "image/jpeg", data: "BBBB" }], slug: "_pending-x", subtask: "s1:generate", locale: "vi-VN", sleep: async () => {}, config, env: {} };

test("request ảnh: prompt trước, ảnh tham chiếu sau theo thứ tự; tỉ lệ 9:16 + kích thước từ config; khoá API đi bằng header (không nằm trên URL)", async () => {
  let seen;
  const out = await generateImage({ ...base, fetchImpl: async (url, init) => { seen = { url: String(url), init, body: JSON.parse(init.body) }; return imageResponse(B64); } });
  assert.match(seen.url, /models\/gemini-3\.1-flash-image:generateContent$/);
  assert.doesNotMatch(seen.url, /key=/);
  assert.equal(seen.init.headers["x-goog-api-key"], "test-key-not-real");
  const parts = seen.body.contents[0].parts;
  assert.equal(parts[0].text, "p");
  assert.deepEqual(parts.slice(1).map((p) => p.inlineData.data), ["AAAA", "BBBB"]);
  assert.deepEqual(seen.body.generationConfig.imageConfig, { aspectRatio: "9:16", imageSize: "1K" });
  assert.deepEqual(seen.body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  assert.equal(out.buffer.toString(), "fake-png-bytes");
  assert.equal(out.ext, ".png");
  assert.deepEqual(buildImageRequest({ prompt: "x", aspectRatio: "9:16" }).generationConfig.imageConfig, { aspectRatio: "9:16" });
});

test("sổ chi phí: ảnh thành công ghi giá niêm yết theo model/kích thước; model/kích thước đổi qua env thì giá đổi theo; lỗi ghi 0đ", async () => {
  await generateImage({ ...base, fetchImpl: async () => imageResponse(B64) });
  let r = rows().at(-1);
  assert.equal(r.task, "product-image");
  assert.equal(r.slug, "_pending-x");
  assert.equal(r.model, "gemini-3.1-flash-image");
  assert.equal(r.image_count, 1);
  assert.ok(Math.abs(r.cost_usd - 0.067) < 1e-9);
  await generateImage({ ...base, env: { PRODUCT_IMAGE_MODEL: "gemini-3-pro-image", PRODUCT_IMAGE_SIZE: "4K" }, fetchImpl: async () => imageResponse(B64) });
  r = rows().at(-1);
  assert.equal(r.model, "gemini-3-pro-image");
  assert.ok(Math.abs(r.cost_usd - 0.24) < 1e-9);
  await assert.rejects(() => generateImage({ ...base, fetchImpl: async () => errorResponse(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "Billing is not enabled" } }) }), BillingRequiredError);
  r = rows().at(-1);
  assert.equal(r.status, "error");
  assert.equal(r.cost_usd, 0);
  assert.equal(r.http_status, 403);
});

test("lỗi: billing/quota 0 -> BillingRequiredError; model đã ngừng -> ModelUnavailableError; safety -> không thử lại; 503 -> thử lại rồi thành công", async () => {
  const quota = { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric ... limit: 0" } };
  await assert.rejects(() => generateImage({ ...base, fetchImpl: async () => errorResponse(429, quota) }), (e) => e instanceof BillingRequiredError && /chưa bật thanh toán/.test(e.userMessage));
  await assert.rejects(() => generateImage({ ...base, fetchImpl: async () => errorResponse(404, { error: { code: 404, status: "NOT_FOUND", message: "models/gemini-2.5-flash-image is not found" } }) }), ModelUnavailableError);
  let n = 0;
  await assert.rejects(() => generateImage({ ...base, fetchImpl: async () => { n++; return { ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }), text: async () => "" }; } }), (e) => /bộ lọc an toàn/.test(e.userMessage));
  assert.equal(n, 1, "safety không thử lại");
  let m = 0;
  const out = await generateImage({ ...base, fetchImpl: async () => (++m === 1 ? errorResponse(503, { error: { code: 503, status: "UNAVAILABLE", message: "busy" } }) : imageResponse(B64)) });
  assert.equal(m, 2);
  assert.ok(out.buffer.length);
  assert.equal(rows().filter((r) => r.status === "error" && r.http_status === 503).length, 1, "lần lỗi tạm thời ghi 0đ");
  assert.throws(() => extractImage({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "no image" }] } }] }), /không có ảnh/);
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(() => generateImage({ ...base, fetchImpl: async () => imageResponse(B64) }), /GEMINI_API_KEY/);
});

const succeeded = (items) => ({ name: "batches/b1", done: true, metadata: { state: "JOB_STATE_SUCCEEDED" }, response: { inlinedResponses: { inlinedResponses: items } } });
const item = (key, b64 = B64) => ({ metadata: { key }, response: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: b64 } }] } }] } });

test("Batch API: tạo -> poll tới khi xong -> ảnh theo key; giá = nửa giá thường; sổ ghi từng ảnh; request đúng cấu trúc", async () => {
  const calls = [];
  // fetch GET trả lần lượt RUNNING rồi SUCCEEDED
  let polls = 0;
  const fi = async (url, init) => {
    if (init.method === "POST") { calls.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ name: "batches/b1", metadata: { state: "JOB_STATE_PENDING" } }), text: async () => "" }; }
    polls++;
    return { ok: true, status: 200, json: async () => (polls < 2 ? { name: "batches/b1", metadata: { state: "JOB_STATE_RUNNING" } } : succeeded([item("k1"), item("k2")])), text: async () => "" };
  };
  const out = await generateImagesBatch({ requests: [{ key: "k1", prompt: "a", references: [{ mimeType: "image/jpeg", data: "A" }] }, { key: "k2", prompt: "b", references: [] }], model: "gemini-3.1-flash-image", size: "1K", aspectRatio: "9:16", slug: "_pending-x", locale: "vi-VN", pollIntervalMs: 1, timeoutMs: 10_000, fetchImpl: fi, sleep: async () => {} });
  assert.match(calls[0].url, /models\/gemini-3\.1-flash-image:batchGenerateContent$/);
  const reqs = calls[0].body.batch.input_config.requests.requests;
  assert.deepEqual(reqs.map((r) => r.metadata.key), ["k1", "k2"]);
  assert.equal(reqs[0].request.contents[0].parts[1].inlineData.data, "A");
  assert.deepEqual(reqs[0].request.generationConfig.imageConfig, { aspectRatio: "9:16", imageSize: "1K" });
  assert.equal(polls, 2);
  assert.equal(out.get("k1").buffer.toString(), "fake-png-bytes");
  assert.ok(Math.abs(out.get("k1").costUsd - 0.034) < 1e-9, "Batch = $0.034/ảnh 1K");
  assert.equal(rows().filter((r) => r.task === "product-image" && r.status === "success").length, 2);
  assert.equal(batchState({ metadata: { state: "BATCH_STATE_RUNNING" } }), "RUNNING");
  assert.deepEqual(inlinedResponsesOf({ response: { inlinedResponses: [1] } }), [1]);
});

test("Batch API: quá hạn -> gọi huỷ + lỗi tiếng Việt; trạng thái FAILED -> lỗi; 1 ảnh lỗi trong batch -> ghi sổ lỗi, ảnh khác vẫn dùng; lỗi billing phân loại", async () => {
  let cancelled = false;
  let t = 0;
  const pending = async (url, init) => {
    if (String(url).endsWith(":cancel")) { cancelled = true; return { ok: true, status: 200, json: async () => ({}), text: async () => "" }; }
    return { ok: true, status: 200, json: async () => ({ name: "batches/b1", metadata: { state: "JOB_STATE_PENDING" } }), text: async () => "" };
  };
  await assert.rejects(() => generateImagesBatch({ requests: [{ key: "k", prompt: "a", references: [] }], model: "gemini-3.1-flash-image", size: "1K", aspectRatio: "9:16", slug: "s", pollIntervalMs: 1, timeoutMs: 100, fetchImpl: pending, sleep: async () => {}, now: () => (t += 60) }), /quá hạn/);
  assert.equal(cancelled, true);
  const failed = async () => ({ ok: true, status: 200, json: async () => ({ name: "batches/b1", done: true, metadata: { state: "JOB_STATE_FAILED" } }), text: async () => "" });
  await assert.rejects(() => generateImagesBatch({ requests: [{ key: "k", prompt: "a", references: [] }], model: "gemini-3.1-flash-image", size: "1K", aspectRatio: "9:16", slug: "s", pollIntervalMs: 1, timeoutMs: 1000, fetchImpl: failed, sleep: async () => {} }), /FAILED/);
  const mixed = async () => ({ ok: true, status: 200, json: async () => succeeded([item("k1"), { metadata: { key: "k2" }, error: { message: "bad" } }]), text: async () => "" });
  const out = await generateImagesBatch({ requests: [{ key: "k1", prompt: "a", references: [] }, { key: "k2", prompt: "b", references: [] }], model: "gemini-3.1-flash-image", size: "1K", aspectRatio: "9:16", slug: "s", pollIntervalMs: 1, timeoutMs: 1000, fetchImpl: mixed, sleep: async () => {} });
  assert.ok(out.get("k1").buffer);
  assert.equal(out.get("k2").error, "bad");
  assert.ok(rows().some((r) => r.status === "error" && /bad/.test(r.error_message)));
  await assert.rejects(() => generateImagesBatch({ requests: [], model: "m", size: "1K", aspectRatio: "9:16", slug: "s", pollIntervalMs: 1, timeoutMs: 10, fetchImpl: async () => errorResponse(403, { error: { code: 403, message: "billing required" } }), sleep: async () => {} }), BillingRequiredError);
});

test("Batch trong luồng cảnh: bật PRODUCT_IMAGE_BATCH -> lượt tạo ĐẦU của mọi cảnh đi 1 batch (giá nửa), ghi cache; luồng thường trúng cache rồi kiểm; batch lỗi thì tự tạo ảnh thường", async () => {
  process.env.PRODUCT_IMAGE_BATCH = "1";
  const store = createProductStore({ dir: path.join(dir, "products") });
  const root = path.join(dir, "root");
  fs.mkdirSync(path.join(root, "assets", "host-refs"), { recursive: true });
  for (let i = 0; i < 3; i++) makeSolidPng(path.join(root, "assets", "host-refs", `face-${i}.jpg`), { size: 1100 });
  const mk = () => {
    const p = store.create({});
    makeRingPng(store.fileAbs(p.id, "product-1.png"));
    const lines = ["hook", "specs", "specs", "wear", "emotion", "cta"].map((beat, i) => ({ n: i + 1, beat, text: "x", vi: "" }));
    Object.assign(p, { locale: "vi-VN", images: [{ id: "product-1", file: "product-1.png" }], analysis: { kind: "ring", lockText: "A ring.", images: [] }, settings: { imageSource: "gemini" }, script: { lines } });
    p.scenes = planScenes({ lines, imageSource: "gemini", kind: "ring", analysis: p.analysis, config });
    store.write(p);
    return p;
  };
  const png = fs.readFileSync(makeSolidPng(path.join(dir, "g.png"), { width: 720, height: 1280 }));
  const PASS = { scores: { product: 9, face: 9, hands: 9, outfit: 9 }, reasons: {}, issues: {}, pass: true, failed: [], model: "m", notes: [] };
  const run = async (batchImpl) => {
    const calls = { single: 0, batch: 0 };
    const service = createSceneService({
      store, billing: createBillingState({ env: { GEMINI_BILLING_ENABLED: "1" } }), config, cache: createSceneCache(path.join(dir, `c${Math.random()}`)), env: process.env, hostRefsRoot: root, log: { warn() {} },
      deps: {
        generateImage: async (o) => { calls.single++; appendCostEntry({ slug: o.slug, task: "product-image", model: "gemini-3.1-flash-image", status: "success", imageCount: 1, costUsd: 0.067 }); return { buffer: png, mimeType: "image/png", ext: ".png", costUsd: 0.067, model: "gemini-3.1-flash-image" }; },
        generateImagesBatch: async (o) => { calls.batch++; return batchImpl(o); },
        checkSceneImage: async () => PASS,
      },
    });
    const p = mk();
    const out = await service.generateAllScenes({ projectId: p.id });
    return { out, calls };
  };
  const ok = await run(async (o) => { assert.equal(o.requests.length, 2); return new Map(o.requests.map((r) => [r.key, { buffer: png, mimeType: "image/png", ext: ".png", costUsd: 0.034 }])); });
  assert.deepEqual(ok.calls, { single: 0, batch: 1 }, "cả 2 cảnh lấy ảnh từ batch (qua cache), không gọi lẻ");
  assert.ok(ok.out.scenes.filter((s) => s.kind === "photo").every((s) => s.status === "ok" && s.image));
  const bad = await run(async () => { throw new Error("batch hỏng"); });
  assert.deepEqual(bad.calls, { single: 2, batch: 1 }, "batch lỗi -> tự tạo ảnh thường");
  assert.ok(bad.out.scenes.filter((s) => s.kind === "photo").every((s) => s.status === "ok"));
});
