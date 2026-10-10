// Clip AI cảnh mở đầu: adapter dạng registry (Veo mock), tạo clip 4 giây từ ảnh hold-close, chi phí vào sổ, tự lùi về GSAP khi lỗi / vượt trần / chưa billing; stage job; cờ queue.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createVeoAdapter, registerClipAdapter, getClipAdapter, listClipAdapters, videoUriOf } from "../scripts/lib/product/clip-adapters.mjs";
import { ensureOpeningClip, CLIP_FILE } from "../scripts/lib/product/clip-flow.mjs";
import { createProductStore } from "../scripts/lib/product/store.mjs";
import { createBillingState, BillingRequiredError } from "../scripts/lib/product/billing.mjs";
import { loadProductConfig } from "../scripts/lib/product/config.mjs";
import { appendCostEntry } from "../scripts/lib/cost-ledger.mjs";
import { BUILD_STAGES, PRODUCT_CLIP_STAGE, createBuildJob } from "../scripts/lib/build-jobs.mjs";
import { tmpDir, makeSolidPng, errorResponse } from "./helpers/product-fixtures.mjs";

const config = loadProductConfig();
const saved = {};
let dir;
beforeEach(() => {
  dir = tmpDir("clip-");
  for (const k of ["GEMINI_API_KEY", "COST_LEDGER_PATH", "PRODUCT_VIDEO_MAX_COST_VND", "SOCIAL_QUEUE_PATH"]) saved[k] = process.env[k];
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.COST_LEDGER_PATH = path.join(dir, "ledger.jsonl");
  delete process.env.PRODUCT_VIDEO_MAX_COST_VND;
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
const rows = () => (fs.existsSync(process.env.COST_LEDGER_PATH) ? fs.readFileSync(process.env.COST_LEDGER_PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const json = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => "" });
const op = (extra) => ({ name: "operations/op1", ...extra });
const doneOp = { name: "operations/op1", done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://files/video.mp4?alt=media" } }] } } };

test("Veo: tạo thao tác dài (ảnh + prompt + 9:16 + 720p + 4s) -> poll -> tải video bằng khoá API; giá = $0.20 (5.200đ); sổ ghi product-clip", async () => {
  const calls = [];
  let polls = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) });
    if (String(url).endsWith(":predictLongRunning")) return json(op({}));
    if (String(url).includes("operations/op1")) return json(++polls < 2 ? op({ done: false }) : doneOp);
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from("fake-mp4"), text: async () => "" };
  };
  const adapter = createVeoAdapter({ fetchImpl, sleep: async () => {}, now: () => 0 });
  const out = await adapter.generate({ image: { mimeType: "image/jpeg", data: "AAAA" }, prompt: "gentle motion", model: "veo-3.1-lite-generate-preview", seconds: 4, resolution: "720p", aspectRatio: "9:16", slug: "_pending-c", subtask: "hook-clip", locale: "vi-VN", pollIntervalMs: 1, timeoutMs: 1000 });
  assert.match(calls[0].url, /models\/veo-3\.1-lite-generate-preview:predictLongRunning$/);
  assert.equal(calls[0].headers["x-goog-api-key"], "test-key-not-real");
  assert.deepEqual(calls[0].body.instances[0].image.inlineData, { mimeType: "image/jpeg", data: "AAAA" });
  assert.equal(calls[0].body.instances[0].prompt, "gentle motion");
  assert.deepEqual(calls[0].body.parameters, { aspectRatio: "9:16", resolution: "720p", durationSeconds: "4" });
  assert.equal(polls, 2);
  assert.equal(calls.at(-1).url, "https://files/video.mp4?alt=media");
  assert.equal(out.buffer.toString(), "fake-mp4");
  assert.ok(Math.abs(out.costUsd - 0.2) < 1e-9);
  const r = rows().at(-1);
  assert.equal(r.task, "product-clip");
  assert.equal(r.slug, "_pending-c");
  assert.ok(Math.abs(r.cost_usd - 0.2) < 1e-9);
  assert.equal(videoUriOf(doneOp), "https://files/video.mp4?alt=media");
});

test("Veo: quá hạn / lỗi thao tác / không có video (bộ lọc) / billing -> lỗi phân loại tiếng Việt", async () => {
  const base = { image: { mimeType: "image/jpeg", data: "A" }, prompt: "p", model: "veo-3.1-lite-generate-preview", seconds: 4, resolution: "720p", aspectRatio: "9:16", slug: "s", pollIntervalMs: 1, timeoutMs: 100 };
  let t = 0;
  const pending = async (url) => json(String(url).endsWith(":predictLongRunning") ? op({}) : op({ done: false }));
  await assert.rejects(() => createVeoAdapter({ fetchImpl: pending, sleep: async () => {}, now: () => (t += 60) }).generate(base), (e) => /quá lâu/.test(e.userMessage));
  const failed = async (url) => json(String(url).endsWith(":predictLongRunning") ? op({}) : op({ done: true, error: { message: "boom" } }));
  await assert.rejects(() => createVeoAdapter({ fetchImpl: failed, sleep: async () => {}, now: () => 0 }).generate(base), /Veo lỗi: boom/);
  const empty = async (url) => json(String(url).endsWith(":predictLongRunning") ? op({}) : op({ done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1 } } }));
  await assert.rejects(() => createVeoAdapter({ fetchImpl: empty, sleep: async () => {}, now: () => 0 }).generate(base), (e) => /bộ lọc/.test(e.userMessage));
  const billing = async () => errorResponse(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "Billing is required" } });
  await assert.rejects(() => createVeoAdapter({ fetchImpl: billing, sleep: async () => {}, now: () => 0 }).generate(base), BillingRequiredError);
  assert.ok(rows().some((r) => r.task === "product-clip" && r.status === "error" && r.cost_usd === 0));
});

test("registry: có sẵn 'veo'; thêm adapter mới không phải sửa luồng dựng", () => {
  assert.ok(listClipAdapters().includes("veo"));
  const custom = registerClipAdapter({ id: "demo", estimateUsd: () => 0.01, generate: async () => ({ buffer: Buffer.from("x"), costUsd: 0.01 }) });
  assert.equal(getClipAdapter("demo"), custom);
  assert.equal(getClipAdapter("khong-co"), null);
});

function projectEnv({ aiClip = true, hook = true, billingOn = true } = {}) {
  const store = createProductStore({ dir: path.join(dir, "products") });
  const p = store.create({});
  makeSolidPng(store.fileAbs(p.id, "scene-s1-v1.png"), { width: 720, height: 1280 });
  Object.assign(p, { locale: "vi-VN", analysis: { kind: "ring" }, settings: { aiClip, imageSource: "gemini" }, scenes: hook ? [{ id: "s1", kind: "photo", slot: "hold-close", image: "scene-s1-v1.png", source: "gemini" }] : [{ id: "s1", kind: "pose", pose: "thinking" }] });
  store.write(p);
  return { store, id: p.id, billing: createBillingState({ env: billingOn ? { GEMINI_BILLING_ENABLED: "1" } : {} }) };
}
const useAdapter = (impl) => registerClipAdapter({ id: "veo", estimateUsd: ({ model, seconds, resolution }) => (model === "veo-3.1-lite-generate-preview" && seconds === 4 && resolution === "720p" ? 0.2 : null), generate: impl });

test("tạo clip: thành công -> lưu clip-hook.mp4, chi phí 5.200đ, status ok; đã có clip thì không gọi lại", async () => {
  const { store, id, billing } = projectEnv();
  let n = 0;
  useAdapter(async (o) => { n++; assert.equal(o.seconds, 4); assert.match(o.prompt, /Do NOT change the jewelry/); assert.equal(o.image.mimeType, "image/jpeg"); appendCostEntry({ slug: o.slug, task: "product-clip", model: o.model, status: "success", costUsd: 0.2 }); return { buffer: Buffer.from("mp4"), costUsd: 0.2 }; });
  const p = await ensureOpeningClip({ projectId: id, store, billing, config, env: {} });
  assert.equal(p.clip.status, "ok");
  assert.equal(p.clip.file, CLIP_FILE);
  assert.equal(p.clip.costVnd, 5200);
  assert.equal(fs.readFileSync(store.fileAbs(id, CLIP_FILE), "utf8"), "mp4");
  await ensureOpeningClip({ projectId: id, store, billing, config, env: {} });
  assert.equal(n, 1);
});

test("clip: lỗi adapter / vượt trần / chưa billing / không có ảnh hold-close / tắt -> lùi về GSAP (status fallback|off), KHÔNG ném lỗi, không gọi API khi không được phép", async () => {
  let n = 0;
  useAdapter(async () => { n++; throw Object.assign(new Error("boom"), { userMessage: "Veo không tạo được clip — dùng hiệu ứng GSAP thay thế." }); });
  const a = projectEnv();
  const r1 = await ensureOpeningClip({ projectId: a.id, store: a.store, billing: a.billing, config, env: {} });
  assert.equal(r1.clip.status, "fallback");
  assert.match(r1.clip.note, /GSAP/);
  assert.equal(n, 1);
  const off = projectEnv({ billingOn: false });
  const r2 = await ensureOpeningClip({ projectId: off.id, store: off.store, billing: off.billing, config, env: {} });
  assert.equal(r2.clip.status, "fallback");
  assert.match(r2.clip.note, /billing/);
  assert.equal(n, 1, "chưa billing -> không gọi");
  process.env.PRODUCT_VIDEO_MAX_COST_VND = "3000"; // 5.200đ của clip > 3.000đ
  const tight = projectEnv();
  const r3 = await ensureOpeningClip({ projectId: tight.id, store: tight.store, billing: tight.billing, config, env: process.env });
  assert.equal(r3.clip.status, "fallback");
  assert.match(r3.clip.note, /Vượt trần/);
  assert.equal(n, 1, "vượt trần -> không gọi");
  delete process.env.PRODUCT_VIDEO_MAX_COST_VND;
  const nohook = projectEnv({ hook: false });
  assert.match((await ensureOpeningClip({ projectId: nohook.id, store: nohook.store, billing: nohook.billing, config, env: {} })).clip.note, /hold|cầm sản phẩm/i);
  const disabled = projectEnv({ aiClip: false });
  assert.equal((await ensureOpeningClip({ projectId: disabled.id, store: disabled.store, billing: disabled.billing, config, env: {} })).clip.status, "off");
  assert.equal(n, 1);
  useAdapter(async () => { throw new BillingRequiredError("b", { userMessage: "chưa bật thanh toán" }); });
  const b = projectEnv();
  const r4 = await ensureOpeningClip({ projectId: b.id, store: b.store, billing: b.billing, config, env: {} });
  assert.equal(r4.clip.status, "fallback");
  assert.equal(b.billing.isEnabled(), false, "lỗi billing đóng băng nguồn tự động");
});

test("job dựng sản phẩm: có khâu clip đứng đầu khi bật clip; job so sánh giữ nguyên 5 khâu; cờ aiGenerated vào hàng đợi đăng", () => {
  const withClip = createBuildJob({ slug: "x", request: { kind: "product" }, stages: [PRODUCT_CLIP_STAGE, ...BUILD_STAGES] });
  assert.deepEqual(withClip.stages.map((s) => s.id), ["clip", "voice", "timing", "scene", "render", "check"]);
  assert.deepEqual(createBuildJob({ slug: "y", request: {} }).stages.map((s) => s.id), ["voice", "timing", "scene", "render", "check"]);
});

test("hàng đợi đăng: video có ảnh/clip AI mang cờ aiGenerated (bước đăng bật nhãn nội dung AI); video thường không có cờ", async () => {
  const queueDir = tmpDir("sq-");
  process.env.SOCIAL_QUEUE_PATH = path.join(queueDir, "q.json");
  const Q = await import(`../scripts/lib/social-queue.mjs?ai=${Math.random()}`);
  const a = Q.enqueueVideo({ slug: "co-ai", videoPath: "/x/a.mp4", caption: "c", hashtags: [], locale: "vi-VN", aiGenerated: true });
  const b = Q.enqueueVideo({ slug: "khong-ai", videoPath: "/x/b.mp4", caption: "c", hashtags: [], locale: "vi-VN", aiGenerated: false });
  assert.equal(a.aiGenerated, true);
  assert.equal("aiGenerated" in b, false);
  assert.equal(Q.loadQueue().queue.find((j) => j.slug === "co-ai").aiGenerated, true);
});
