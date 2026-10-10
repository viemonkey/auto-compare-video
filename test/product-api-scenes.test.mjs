// API cảnh của chế độ "Giới thiệu sản phẩm": việc nền (202 + hỏi lại), upload ảnh cảnh (manual), prompt ghép sẵn, đổi pose, dùng ảnh gốc, duyệt, chi phí hiện trước.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { createProductApi } from "../server-product.mjs";
import { assembleScript } from "../scripts/lib/product/script.mjs";
import { tmpDir, makeRingPng, makeSolidPng } from "./helpers/product-fixtures.mjs";

const saved = {};
beforeEach(() => { for (const k of ["COST_LEDGER_PATH", "GEMINI_BILLING_ENABLED"]) saved[k] = process.env[k]; process.env.COST_LEDGER_PATH = path.join(tmpDir(), "l.jsonl"); delete process.env.GEMINI_BILLING_ENABLED; });
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const GOOD = {
  openers: [{ text: "Nhẫn này có gì lạ?", vi: "" }, { text: "Bạn thấy chưa?", vi: "" }, { text: "Ai cũng hỏi?", vi: "" }],
  lines: [{ beat: "specs", text: "Bạc 925, đá moissanite nhân tạo.", vi: "" }, { beat: "specs", text: "Vòng bánh răng xoay được.", vi: "" }, { beat: "wear", text: "Đeo lên tay rất nổi bật.", vi: "" }, { beat: "emotion", text: "Hợp để tặng người thương.", vi: "" }, { beat: "cta", text: "Nhắn tin để được tư vấn.", vi: "" }],
};
const analysis = { model: "m", kind: "ring", lock: {}, lockText: "A wide white metal ring with three rows of tiny round pave stones.", lockTextVi: "", images: [{ index: 0, bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, boxSource: "gemini", stoneBbox: null, view: "front", hasLogoOrText: false, note: "" }] };
const script = { openers: GOOD.openers, openerIndex: 0, lines: assembleScript(GOOD, 0), mismatches: [], warnings: [], model: "ms" };

async function withApp(sceneDeps, fn) {
  const dataDir = tmpDir();
  const hostRoot = tmpDir();
  fs.mkdirSync(path.join(hostRoot, "assets", "host-refs"), { recursive: true });
  const app = express();
  app.use(express.json());
  const api = createProductApi({ app, dataDir, hostRefsRoot: hostRoot, log: { warn() {} }, deps: { analyzeProduct: async () => analysis, writeScript: async () => script, scene: sceneDeps } });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base, api); } finally { server.close(); }
}
const post = (base, url, body) => fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
async function created(base, source) {
  const fd = new FormData();
  fd.append("images", new Blob([fs.readFileSync(makeRingPng(path.join(tmpDir(), "r.png")))], { type: "image/png" }), "r.png");
  const up = await (await fetch(`${base}/api/product/upload`, { method: "POST", body: fd })).json();
  return (await (await post(base, `/api/product/${up.id}/analyze`, { locale: "vi-VN", form: { type: "nhẫn", material: "bạc 925", mainStone: "moissanite", stoneOrigin: "lab" }, settings: { imageSource: source } })).json());
}
const waitIdle = async (base, id) => { for (let i = 0; i < 100; i++) { const p = await (await fetch(`${base}/api/product/${id}`)).json(); if (!p.busy && !p.scenes.some((s) => s.busy)) return p; await new Promise((r) => setTimeout(r, 30)); } throw new Error("không xong việc nền"); };
const PASS = { scores: { product: 9, face: 9, hands: 9, outfit: 9 }, reasons: { product: "ok" }, issues: {}, pass: true, failed: [], model: "m", notes: [] };
const png = () => fs.readFileSync(makeSolidPng(path.join(tmpDir(), "g.png"), { width: 720, height: 1280 }));

test("analyze nguồn pose: kế hoạch cảnh pose/cận/hero, không có gì chặn dựng; mỗi câu 1 cảnh; chi phí + billing trong snapshot", async () => {
  await withApp({}, async (base) => {
    const p = await created(base, "pose");
    assert.equal(p.scenes.length, p.script.lines.length);
    assert.deepEqual(p.scenes.map((s) => s.kind), ["pose", "macro", "pose", "pose", "macro", "hero"]);
    assert.deepEqual(p.blockers, []);
    assert.equal(p.billing.enabled, false);
    assert.equal(p.budget.maxVnd, 15000);
    assert.ok(p.scenes.every((s) => s.actions === null), "cảnh pose không có nút có phí");
  });
});

test("nguồn manual: prompt ghép sẵn + hướng dẫn đính kèm; tải ảnh -> việc nền kiểm -> cảnh chờ duyệt/đạt; ảnh quá nhỏ / không phải ảnh bị từ chối", async () => {
  await withApp({ checkSceneImage: async () => ({ ...PASS, pass: false, failed: ["hands"], scores: { ...PASS.scores, hands: 4 } }) }, async (base) => {
    const p = await created(base, "manual");
    const photo = p.scenes.find((s) => s.kind === "photo");
    assert.equal(photo.source, "manual");
    const guide = await (await fetch(`${base}/api/product/${p.id}/scenes/${photo.id}/prompt`)).json();
    assert.equal(guide.slot, "hold-close");
    assert.match(guide.prompt, new RegExp(analysis.lockText.slice(0, 30)));
    assert.match(guide.prompt, /85mm/);
    assert.ok(guide.attach.some((l) => /Ảnh sản phẩm/.test(l)));
    assert.ok(guide.attach.some((l) => /CHƯA có ảnh khuôn mặt/.test(l)), "thiếu ảnh host-refs thì nhắc");
    assert.match(guide.note, /Google AI Studio/);

    const fd = new FormData();
    fd.append("image", new Blob([png()], { type: "image/png" }), "ai.png");
    const res = await fetch(`${base}/api/product/${p.id}/scenes/${photo.id}/upload`, { method: "POST", body: fd });
    assert.equal(res.status, 202);
    const done = await waitIdle(base, p.id);
    const s = done.scenes.find((x) => x.id === photo.id);
    assert.equal(s.status, "needs-review");
    assert.ok(s.imageUrl.startsWith(`/api/product/${p.id}/file/scene-`));
    assert.equal((await fetch(`${base}${s.imageUrl}`)).status, 200);
    assert.ok(done.blockers.some((b) => b.scene === photo.id));
    const ok = await (await post(base, `/api/product/${p.id}/scenes/${photo.id}/approve`)).json();
    assert.ok(!ok.blockers.some((b) => b.scene === photo.id));

    const small = new FormData();
    small.append("image", new Blob([fs.readFileSync(makeSolidPng(path.join(tmpDir(), "s.png"), { size: 100 }))], { type: "image/png" }), "s.png");
    const r2 = await fetch(`${base}/api/product/${p.id}/scenes/${photo.id}/upload`, { method: "POST", body: small });
    assert.equal(r2.status, 400);
    assert.match((await r2.json()).error, /quá nhỏ/);
    const bad = new FormData();
    bad.append("image", new Blob(["nope"], { type: "image/png" }), "x.png");
    assert.equal((await fetch(`${base}/api/product/${p.id}/scenes/${photo.id}/upload`, { method: "POST", body: bad })).status, 400);
    assert.equal((await fetch(`${base}/api/product/${p.id}/scenes/zzz/prompt`)).status, 404);
  });
});

test("nguồn gemini khi chưa có billing: analyze hạ về pose; nút có phí bị khoá kèm lý do; tạo ảnh bị từ chối rõ ràng", async () => {
  await withApp({}, async (base) => {
    const p = await created(base, "gemini");
    assert.equal(p.settings.imageSource, "pose");
    assert.ok(p.settings.notes.some((n) => /billing/.test(n)));
    const r = await post(base, `/api/product/${p.id}/scenes/generate`);
    assert.equal(r.status, 400);
    const act = await post(base, `/api/product/${p.id}/scenes/s1/action`, { action: "regenerate" });
    assert.equal(act.status, 400);
  });
});

test("nguồn gemini (billing bật): tạo ảnh chạy nền (202), snapshot hiện chi phí từng nút + trần; tạo lại/sửa mặt/sửa sản phẩm/yêu cầu tự do qua API", async () => {
  process.env.GEMINI_BILLING_ENABLED = "1";
  const calls = [];
  await withApp({
    generateImage: async (o) => { calls.push(o.subtask); await new Promise((r) => setTimeout(r, 20)); return { buffer: png(), mimeType: "image/png", ext: ".png", costUsd: 0.067, model: "gemini-3.1-flash-image" }; },
    checkSceneImage: async () => PASS,
  }, async (base) => {
    const p = await created(base, "gemini");
    assert.equal(p.settings.imageSource, "gemini");
    const photos = p.scenes.filter((s) => s.kind === "photo");
    assert.equal(photos.length, 2);
    assert.equal(photos[0].actions.costVnd, 1742);
    assert.equal(photos[0].actions.allowed, true);
    const started = await post(base, `/api/product/${p.id}/scenes/generate`);
    assert.equal(started.status, 202);
    assert.equal((await post(base, `/api/product/${p.id}/scenes/generate`)).status, 409, "đang chạy nền thì không chạy chồng");
    const done = await waitIdle(base, p.id);
    assert.deepEqual(done.scenes.filter((s) => s.kind === "photo").map((s) => s.status), ["ok", "ok"]);
    assert.deepEqual(calls, ["s1:generate", "s4:generate"]);
    assert.equal(done.blockers.length, 0);
    for (const action of ["fix-face", "fix-product", "regenerate"]) {
      assert.equal((await post(base, `/api/product/${p.id}/scenes/s1/action`, { action })).status, 202);
      await waitIdle(base, p.id);
    }
    assert.equal((await post(base, `/api/product/${p.id}/scenes/s1/action`, { action: "edit" })).status, 400, "yêu cầu sửa trống");
    assert.equal((await post(base, `/api/product/${p.id}/scenes/s1/action`, { action: "edit", userRequest: "nền sáng hơn" })).status, 202);
    const fin = await waitIdle(base, p.id);
    assert.deepEqual(calls.slice(2), ["s1:fix-face", "s1:fix-product", "s1:regenerate", "s1:edit"]);
    assert.ok(fin.budget.spentVnd >= 0 && fin.budget.maxVnd === 15000);
    assert.equal((await post(base, `/api/product/${p.id}/scenes/s2/action`, { action: "regenerate" })).status, 400, "cảnh cận đá không có nút có phí");
    // đổi pose / dùng ảnh gốc
    const posed = await (await post(base, `/api/product/${p.id}/scenes/s1/pose`, { pose: "shocked-a" })).json();
    assert.equal(posed.scenes[0].kind, "pose");
    assert.equal((await post(base, `/api/product/${p.id}/scenes/s1/pose`, { pose: "khong-co" })).status, 400);
    const orig = await (await post(base, `/api/product/${p.id}/scenes/s4/use-original`)).json();
    assert.equal(orig.scenes.find((s) => s.id === "s4").kind, "hero");
  });
});

test("vượt trần: nút có phí khoá kèm lý do trong snapshot", async () => {
  process.env.GEMINI_BILLING_ENABLED = "1";
  process.env.PRODUCT_VIDEO_MAX_COST_VND = "1000";
  try {
    await withApp({}, async (base) => {
      const p = await created(base, "gemini");
      const photo = p.scenes.find((s) => s.kind === "photo");
      assert.equal(photo.actions.allowed, false);
      assert.match(photo.actions.reason, /Vượt trần/);
    });
  } finally {
    delete process.env.PRODUCT_VIDEO_MAX_COST_VND;
  }
});
