// Nền tảng chế độ "Giới thiệu sản phẩm": cấu hình, billing, ngân sách, ước tính, form, kho dự án, ảnh host, xử lý ảnh, API upload.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { loadProductConfig, maxCostVnd, imageSettings, clipSettings, billingFlag, kindFromText, labelsFor } from "../scripts/lib/product/config.mjs";
import { createBillingState, classifyPaidApiError, BillingRequiredError, ModelUnavailableError } from "../scripts/lib/product/billing.mjs";
import { createBudget, spentFromRows, fmtVnd } from "../scripts/lib/product/budget.mjs";
import { estimateProductCost } from "../scripts/lib/product/estimate.mjs";
import { normalizeForm, validateForm, specRows, productDisplayName } from "../scripts/lib/product/form.mjs";
import { createProductStore, PROJECT_ID_RE, pendingLedgerSlug } from "../scripts/lib/product/store.mjs";
import { inspectHostRefs } from "../scripts/lib/product/host-refs.mjs";
import { findContentBox, cutoutBackground, cropImage, probeImage, decodeRgba } from "../scripts/lib/product/images.mjs";
import { createProductApi } from "../server-product.mjs";
import { tmpDir, makeRingPng, makeSolidPng } from "./helpers/product-fixtures.mjs";

const config = loadProductConfig();

test("config: trần mặc định 15.000đ, PRODUCT_VIDEO_MAX_COST_VND ghi đè, giá trị sai thì dùng config", () => {
  assert.equal(maxCostVnd({}, config), 15000);
  assert.equal(maxCostVnd({ PRODUCT_VIDEO_MAX_COST_VND: "9000" }, config), 9000);
  assert.equal(maxCostVnd({ PRODUCT_VIDEO_MAX_COST_VND: "9,000" }, config), 9000);
  for (const bad of ["abc", "0", "-5", ""]) assert.equal(maxCostVnd({ PRODUCT_VIDEO_MAX_COST_VND: bad }, config), 15000);
});

test("config: model ảnh/clip + kích thước đọc từ config, .env ghi đè; mặc định KHÔNG phải model đã ngừng", () => {
  assert.equal(imageSettings({}, config).id, "gemini-3.1-flash-image");
  assert.notEqual(imageSettings({}, config).id, "gemini-2.5-flash-image");
  assert.equal(imageSettings({ PRODUCT_IMAGE_MODEL: "gemini-3-pro-image", PRODUCT_IMAGE_SIZE: "2K" }, config).size, "2K");
  assert.equal(imageSettings({ PRODUCT_IMAGE_BATCH: "1" }, config).batch, true);
  assert.equal(imageSettings({}, config).batch, false);
  assert.equal(clipSettings({}, config).id, "veo-3.1-lite-generate-preview");
  assert.equal(clipSettings({}, config).seconds, 4);
});

test("config: nhận loại món từ chữ; nhãn thông số theo thị trường có dự phòng vi-VN", () => {
  assert.equal(kindFromText("Nhẫn nữ", config), "ring");
  assert.equal(kindFromText("dây chuyền", config), "necklace");
  assert.equal(kindFromText("Bông tai", config), "earring");
  assert.equal(kindFromText("vòng tay", config), null);
  assert.equal(labelsFor("ja-JP", config).material, "素材");
  assert.equal(labelsFor("fr-FR", config).material, "Chất liệu");
});

test("billing: cờ .env + khoá khi gọi thật bị từ chối; lý do tiếng Việt", () => {
  const off = createBillingState({ env: {} });
  assert.equal(off.isEnabled(), false);
  assert.match(off.status().reason, /GEMINI_BILLING_ENABLED=1/);
  const on = createBillingState({ env: { GEMINI_BILLING_ENABLED: "1" } });
  assert.equal(on.isEnabled(), true);
  on.block("hết hạn mức");
  assert.equal(on.isEnabled(), false);
  assert.equal(on.status().reason, "hết hạn mức");
  on.reset();
  assert.equal(on.isEnabled(), true);
  assert.equal(billingFlag({ GEMINI_BILLING_ENABLED: "true" }, config), true);
});

test("billing: nhận ra lỗi billing / quota 0 / model đã ngừng; lỗi khác đi theo phân loại thường", () => {
  const quota0 = { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota. limit: 0", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateContentFreeTierRequestsPerDayPerProjectPerModel", quotaMetric: "x" }] }] } };
  const e1 = classifyPaidApiError({ httpStatus: 429, bodyText: JSON.stringify(quota0), model: "m" });
  assert.ok(e1 instanceof BillingRequiredError);
  assert.match(e1.userMessage, /chưa bật thanh toán/);
  const e2 = classifyPaidApiError({ httpStatus: 403, bodyText: JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "Billing must be enabled" } }), model: "m" });
  assert.ok(e2 instanceof BillingRequiredError);
  const e3 = classifyPaidApiError({ httpStatus: 404, bodyText: JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message: "models/gemini-2.5-flash-image is not found" } }), model: "gemini-2.5-flash-image" });
  assert.ok(e3 instanceof ModelUnavailableError);
  assert.match(e3.userMessage, /không còn dùng được/);
  const e4 = classifyPaidApiError({ httpStatus: 503, bodyText: "{}", model: "m" });
  assert.equal(e4.constructor.name, "RetryableError");
  const e5 = classifyPaidApiError({ httpStatus: 429, bodyText: JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "slow down" } }), model: "m" });
  assert.equal(e5.constructor.name, "RetryableError", "429 theo phút không phải billing");
});

test("ngân sách: cộng chi phí đã dùng theo slug, từ chối khi vượt trần hoặc chưa biết giá, giữ chỗ cho clip", () => {
  const rows = [
    { slug: "_pending-a", cost_usd: 0.1, task: "content-generation", subtask: "product-analysis" },
    { slug: "_pending-a", cost_usd: 0.134, task: "product-image" },
    { slug: "khac", cost_usd: 5, task: "tts" },
  ];
  const budget = createBudget({ slugs: () => ["_pending-a"], env: { USD_TO_VND: "25000" }, config, rowsReader: (slugs) => rows.filter((r) => slugs.includes(r.slug)) });
  assert.equal(budget.spentVnd(), Math.ceil(0.234 * 25000)); // 5850
  assert.equal(budget.check(0.2).ok, true); // 5850 + 5000 = 10850 <= 15000
  const over = budget.check(0.4); // 5850 + 10000 = 15850 > 15000
  assert.equal(over.ok, false);
  assert.equal(over.reason, "over-budget");
  assert.match(over.message, /Vượt trần/);
  assert.equal(budget.check(0.2, { reserveVnd: 5200 }).ok, false, "phần giữ chỗ cho clip làm lời gọi này vượt trần");
  const unpriced = budget.check(null);
  assert.equal(unpriced.ok, false);
  assert.equal(unpriced.reason, "unpriced");
  assert.equal(budget.remainingVnd(), 15000 - 5850);
  const sp = spentFromRows(rows);
  assert.ok(Math.abs(sp.byTask["content-generation:product-analysis"] - 0.1) < 1e-9);
  assert.equal(fmtVnd(15000).replace(/\D/g, ""), "15000");
});

test("ước tính chi phí: pose ~0đ ảnh; gemini+clip trong trần 15.000đ; trần nhỏ thì báo vượt", () => {
  const pose = estimateProductCost({ imageSource: "pose", env: {}, config });
  assert.equal(pose.items.find((i) => i.id === "images").vnd, 0);
  assert.ok(pose.expectedVnd < 3000);
  const manual = estimateProductCost({ imageSource: "manual", env: {}, config });
  assert.ok(manual.items.some((i) => i.id === "check"));
  const gem = estimateProductCost({ imageSource: "gemini", aiClip: true, env: {}, config });
  assert.ok(gem.items.some((i) => i.id === "clip" && i.vnd === 5200), "clip Veo Lite 4s 720p = $0.20 ≈ 5.200đ");
  assert.ok(gem.expectedVnd <= gem.ceilingVnd);
  assert.ok(gem.maxVnd <= gem.ceilingVnd);
  const tight = estimateProductCost({ imageSource: "gemini", aiClip: true, env: { PRODUCT_VIDEO_MAX_COST_VND: "5000" }, config });
  assert.equal(tight.overCeiling, true);
  assert.ok(tight.notes.length);
});

test("form: chuẩn hoá, bắt buộc loại món + chất liệu, nguồn gốc đá chỉ nhận giá trị hợp lệ, thẻ thông số không bịa field trống", () => {
  const form = normalizeForm({ type: "  nhẫn ", material: "bạc 925", metalColor: "trắng", mainStone: "moissanite", carat: "", cut: "", sideStones: "", price: "", feature: "vòng xoay", stoneOrigin: "lab", extra: "bỏ" }, config);
  assert.equal(form.type, "nhẫn");
  assert.equal(form.stoneOrigin, "lab");
  assert.equal("extra" in form, false);
  assert.deepEqual(validateForm(form), []);
  assert.equal(validateForm(normalizeForm({}, config)).length, 2);
  assert.equal(normalizeForm({ stoneOrigin: "hack" }, config).stoneOrigin, "");
  const rows = specRows(form, labelsFor("vi-VN", config), config);
  assert.deepEqual(rows.map((r) => r.key), ["material", "metalColor", "mainStone", "origin", "feature"]);
  assert.equal(rows.find((r) => r.key === "origin").value, "Nhân tạo");
  assert.equal(productDisplayName(form), "nhẫn bạc 925 moissanite");
});

test("kho dự án: tạo/đọc/ghi nguyên tử, mã hợp lệ, tên file an toàn, khoá theo dự án chạy tuần tự", async () => {
  const dir = tmpDir();
  const store = createProductStore({ dir });
  const p = store.create({ form: { type: "nhẫn" } });
  assert.match(p.id, PROJECT_ID_RE);
  assert.equal(p.ledgerSlug, pendingLedgerSlug(p.id));
  assert.equal(store.read(p.id).form.type, "nhẫn");
  assert.equal(store.read("p-khongco-1234"), null);
  assert.throws(() => store.projectDir("../etc"), /không hợp lệ/);
  assert.throws(() => store.fileAbs(p.id, "../x.png"), /không hợp lệ/);
  store.saveBuffer(p.id, "a.png", Buffer.from("x"));
  assert.ok(fs.existsSync(path.join(dir, p.id, "a.png")));
  assert.equal(store.list().length, 1);
  const order = [];
  await Promise.all([
    store.withLock(p.id, async () => { order.push("a1"); await new Promise((r) => setTimeout(r, 30)); order.push("a2"); }),
    store.withLock(p.id, async () => { order.push("b1"); order.push("b2"); }),
  ]);
  assert.deepEqual(order, ["a1", "a2", "b1", "b2"]);
  store.remove(p.id);
  assert.equal(store.read(p.id), null);
});

test("ảnh host: thiếu ảnh face / ảnh nhỏ chỉ CẢNH BÁO tiếng Việt kèm hướng dẫn (không ném lỗi)", async () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, "assets", "host-refs"), { recursive: true });
  let r = await inspectHostRefs({ config, root });
  assert.equal(r.ready, false);
  assert.match(r.warnings[0], /0\/3 ảnh khuôn mặt/);
  assert.match(r.warnings[0], /face-front\.jpg/);
  makeSolidPng(path.join(root, "assets", "host-refs", "face-front.jpg"), { size: 500 });
  makeSolidPng(path.join(root, "assets", "host-refs", "face-left.jpg"), { size: 1100 });
  makeSolidPng(path.join(root, "assets", "host-refs", "face-right.jpg"), { size: 1100 });
  r = await inspectHostRefs({ config, root });
  assert.equal(r.ready, false);
  assert.ok(r.warnings.some((w) => /face-front\.jpg nhỏ \(500×500px/.test(w)));
  makeSolidPng(path.join(root, "assets", "host-refs", "face-front.jpg"), { size: 1100 });
  r = await inspectHostRefs({ config, root });
  assert.equal(r.ready, true);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.outfit.text, "áo phông đen, tạp dề da nâu");
  assert.equal(r.outfit.file, null);
});

test("xử lý ảnh: khung bao vật thể, tách nền (lỗ giữa nhẫn trong suốt, thân giữ nguyên), cắt theo khung bao", async () => {
  const dir = tmpDir();
  const src = makeRingPng(path.join(dir, "ring.png"));
  const box = await findContentBox(src);
  assert.ok(Math.abs(box.x - 0.3) < 0.03 && Math.abs(box.y - 0.3) < 0.03, JSON.stringify(box));
  assert.ok(Math.abs(box.w - 0.4) < 0.04 && Math.abs(box.h - 0.4) < 0.04, JSON.stringify(box));
  const out = path.join(dir, "cut.png");
  const cut = await cutoutBackground(src, out, { scale: 2 });
  assert.ok(cut.width > 0 && cut.height > 0);
  const img = await decodeRgba(out, { maxDim: 4000 });
  const alphaAt = (fx, fy) => img.data[((Math.floor(fy * img.height) * img.width) + Math.floor(fx * img.width)) * 4 + 3];
  assert.ok(alphaAt(0.5, 0.5) < 40, "lỗ giữa phải trong suốt");
  assert.ok(alphaAt(0.12, 0.5) > 200, "thân vật thể giữ nguyên");
  const crop = await cropImage(src, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, path.join(dir, "crop.png"), { outWidth: 240 });
  assert.equal((await probeImage(crop.file)).width, 240);
  await assert.rejects(() => cutoutBackground(makeSolidPng(path.join(dir, "flat.png"), { size: 100, color: "0xf2f2f2" }), path.join(dir, "x.png")), /Không tách được/);
});

async function withApp(fn) {
  const dataDir = tmpDir();
  const app = express();
  createProductApi({ app, dataDir, hostRefsRoot: tmpDir(), log: { warn() {} } });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, dataDir);
  } finally {
    server.close();
  }
}

test("API: /config báo billing + nguồn ảnh (Tự động bị khoá kèm lý do khi chưa bật billing); /estimate", async () => {
  await withApp(async (base) => {
    const cfg = await (await fetch(`${base}/api/product/config`)).json();
    assert.equal(cfg.maxCostVnd, 15000);
    const gem = cfg.imageSources.find((s) => s.id === "gemini");
    assert.equal(gem.enabled, process.env.GEMINI_BILLING_ENABLED === "1");
    if (!gem.enabled) assert.match(gem.note, /billing/);
    assert.equal(cfg.imageSources.find((s) => s.id === "pose").enabled, true);
    assert.equal(cfg.defaultImageSource, "pose");
    assert.deepEqual(cfg.stoneOrigins.map((o) => o.id), ["natural", "lab", "moissanite"]);
    const est = await (await fetch(`${base}/api/product/estimate?source=manual&clip=0`)).json();
    assert.ok(est.expectedVnd > 0 && est.ceilingVnd === 15000);
  });
});

test("API: upload 1–3 ảnh tạo dự án + cảnh báo ảnh nhỏ/sản phẩm chiếm ít khung; từ chối file không phải ảnh; không lộ đường dẫn tuyệt đối", async () => {
  await withApp(async (base, dataDir) => {
    const dir = tmpDir();
    const png = makeRingPng(path.join(dir, "ring.png"), { size: 300, box: [120, 120, 60, 60], withHole: false });
    const fd = new FormData();
    fd.append("images", new Blob([fs.readFileSync(png)], { type: "image/png" }), "nhan.png");
    const res = await fetch(`${base}/api/product/upload`, { method: "POST", body: fd });
    const project = await res.json();
    assert.equal(res.status, 200);
    assert.match(project.id, PROJECT_ID_RE);
    assert.equal(project.images.length, 1);
    assert.equal(project.images[0].width, 300);
    assert.ok(project.images[0].warnings.some((w) => /Ảnh nhỏ/.test(w)));
    assert.ok(project.images[0].warnings.some((w) => /chỉ chiếm khoảng/.test(w)));
    assert.ok(project.images[0].url.startsWith(`/api/product/${project.id}/file/`));
    assert.ok(!JSON.stringify(project).includes(dataDir));
    assert.ok(fs.existsSync(path.join(dataDir, "products", project.id, "project.json")));
    const img = await fetch(`${base}${project.images[0].url}`);
    assert.equal(img.status, 200);
    assert.equal((await fetch(`${base}/api/product/${project.id}/file/..%2Fproject.json`)).status, 400);
    assert.equal((await fetch(`${base}/api/product/p-khongco-1234`)).status, 404);

    const bad = new FormData();
    bad.append("images", new Blob(["x"], { type: "text/plain" }), "a.txt");
    const r2 = await fetch(`${base}/api/product/upload`, { method: "POST", body: bad });
    assert.equal(r2.status, 400);
    assert.match((await r2.json()).error, /Chỉ nhận ảnh/);
    const r3 = await fetch(`${base}/api/product/upload`, { method: "POST", body: new FormData() });
    assert.equal(r3.status, 400);
  });
});
