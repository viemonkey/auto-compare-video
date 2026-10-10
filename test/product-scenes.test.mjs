// Mốc 3/3b/3c: nguồn ảnh "gemini" (kiểm -> sửa mặt -> sửa sản phẩm -> tạo lại), "manual" (tải ảnh + kiểm), "pose"; trần ngân sách, hạ cấp, lỗi billing, cache.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadProductConfig } from "../scripts/lib/product/config.mjs";
import { createProductStore } from "../scripts/lib/product/store.mjs";
import { createBillingState, BillingRequiredError, ModelUnavailableError } from "../scripts/lib/product/billing.mjs";
import { createSceneService, ImageDowngrade } from "../scripts/lib/product/scene-flow.mjs";
import { createSceneCache } from "../scripts/lib/product/scene-cache.mjs";
import { planScenes, buildBlockers, pickPose } from "../scripts/lib/product/scenes.mjs";
import { buildScenePrompt, buildEditPrompt, referenceLayout, kindsWithSceneTemplates, manualAttachGuide } from "../scripts/lib/product/scene-prompts.mjs";
import { checkSceneImage, evaluateScores, rankScores } from "../scripts/lib/product/scene-check.mjs";
import { appendCostEntry } from "../scripts/lib/cost-ledger.mjs";
import { calcImageCost } from "../config/pricing.mjs";
import { tmpDir, makeRingPng, makeSolidPng, textResponse } from "./helpers/product-fixtures.mjs";

const config = loadProductConfig();
const LOCK = "A wide white-metal ring with three rows of small round pave stones and a gear-like band.";
const savedEnv = {};
let dir;
let ledgerFile;

beforeEach(() => {
  dir = tmpDir("ps-");
  ledgerFile = path.join(dir, "ledger.jsonl");
  for (const k of ["COST_LEDGER_PATH", "GEMINI_BILLING_ENABLED", "PRODUCT_VIDEO_MAX_COST_VND"]) savedEnv[k] = process.env[k];
  process.env.COST_LEDGER_PATH = ledgerFile;
  delete process.env.PRODUCT_VIDEO_MAX_COST_VND;
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const PASS = { scores: { product: 9, face: 9, hands: 8, outfit: 9 }, reasons: { product: "ok", face: "ok", hands: "ok", outfit: "ok" }, issues: {}, pass: true, failed: [], model: "m-check", notes: [] };
const failing = (...keys) => ({ ...PASS, scores: { ...PASS.scores, ...Object.fromEntries(keys.map((k) => [k, 3])) }, reasons: { ...PASS.reasons, ...Object.fromEntries(keys.map((k) => [k, `lỗi ${k}`])) }, pass: false, failed: keys });

function makeEnv({ source = "gemini", aiClip = false, billingOn = true, checks = [], gen, hostFaces = 3, lines = 6 } = {}) {
  const store = createProductStore({ dir: path.join(dir, "products") });
  const hostRoot = path.join(dir, "root");
  fs.mkdirSync(path.join(hostRoot, "assets", "host-refs"), { recursive: true });
  for (let i = 0; i < hostFaces; i++) makeSolidPng(path.join(hostRoot, "assets", "host-refs", `face-${i}.jpg`), { size: 1100, color: "0x996655" });
  const project = store.create({});
  makeRingPng(store.fileAbs(project.id, "product-1.png"));
  const beats = ["hook", "specs", "specs", "wear", "emotion", "cta"].slice(0, lines === 5 ? 5 : 6);
  const ls = (lines === 5 ? ["hook", "specs", "wear", "emotion", "cta"] : beats).map((beat, i) => ({ n: i + 1, beat, text: `Câu ${i + 1}`, vi: "" }));
  Object.assign(project, {
    locale: "vi-VN", form: { type: "nhẫn", material: "bạc 925", stoneOrigin: "lab" }, images: [{ id: "product-1", file: "product-1.png", width: 300, height: 300, warnings: [] }],
    analysis: { kind: "ring", lockText: LOCK, lock: {}, images: [{ index: 0, bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, stoneBbox: null, view: "front" }] },
    settings: { imageSource: source, aiClip }, script: { lines: ls },
  });
  project.scenes = planScenes({ lines: ls, imageSource: source, kind: "ring", analysis: project.analysis, config });
  store.write(project);
  const calls = { generate: [], check: [] };
  const png = fs.readFileSync(makeSolidPng(path.join(dir, `img-${Math.random().toString(36).slice(2, 6)}.png`), { width: 720, height: 1280, color: "0x335577" }));
  const model = "gemini-3.1-flash-image";
  const generateImage = gen || (async (o) => {
    calls.generate.push({ subtask: o.subtask, prompt: o.prompt, refs: o.references.length });
    const costUsd = calcImageCost(model, 1, { size: "1K" });
    appendCostEntry({ slug: o.slug, locale: o.locale, task: "product-image", subtask: o.subtask, model, status: "success", imageCount: 1, costUsd });
    return { buffer: png, mimeType: "image/png", ext: ".png", costUsd, model };
  });
  const queue = [...checks];
  const checkSceneImage = async (o) => { calls.check.push({ slot: o.slot, refs: { products: o.refs.products.length, faces: o.refs.faces.length } }); return queue.length ? queue.shift() : PASS; };
  const billing = createBillingState({ env: billingOn ? { GEMINI_BILLING_ENABLED: "1" } : {} });
  const cache = createSceneCache(path.join(dir, `cache-${Math.random().toString(36).slice(2, 8)}`));
  const ledgerRows = [];
  const service = createSceneService({ store, billing, config, cache, deps: { generateImage, checkSceneImage }, env: process.env, hostRefsRoot: hostRoot, ledger: (r) => { ledgerRows.push(r); appendCostEntry(r); }, log: { warn() {} } });
  return { store, project, service, calls, billing, ledgerRows, cache, png };
}
const photoScenes = (p) => p.scenes.filter((s) => s.kind === "photo");
const spentRows = () => fs.readFileSync(ledgerFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("kế hoạch cảnh: nguồn pose = pose/cận/pose/pose/cận/hero; nguồn AI = ảnh/cận/hero/ảnh/nửa người/hero; 5 câu vẫn đủ cảnh; mỗi câu 1 cảnh", () => {
  const six = ["hook", "specs", "specs", "wear", "emotion", "cta"].map((beat, i) => ({ n: i + 1, beat }));
  const pose = planScenes({ lines: six, imageSource: "pose", kind: "ring", config });
  assert.deepEqual(pose.map((s) => s.kind), ["pose", "macro", "pose", "pose", "macro", "hero"]);
  assert.ok(pose.every((s) => s.source !== "gemini" && s.status === "ok" && s.approved));
  assert.deepEqual(pose.filter((s) => s.kind === "pose").map((s) => s.pose).filter((p, i, a) => i === 0 || p !== a[i - 1]).length, 3, "pose liền nhau không trùng");
  const ai = planScenes({ lines: six, imageSource: "gemini", kind: "ring", config });
  assert.deepEqual(ai.map((s) => s.kind), ["photo", "macro", "hero", "photo", "half", "hero"]);
  assert.deepEqual(ai.filter((s) => s.kind === "photo").map((s) => s.slot), ["hold-close", "wear-hand"]);
  assert.equal(ai.find((s) => s.kind === "half").from, "s4", "nửa người cắt từ ảnh 'đeo lên người'");
  assert.equal(ai.length, six.length);
  const five = ["hook", "specs", "wear", "emotion", "cta"].map((beat, i) => ({ n: i + 1, beat }));
  assert.deepEqual(planScenes({ lines: five, imageSource: "gemini", kind: "ring", config }).map((s) => s.kind), ["photo", "macro", "photo", "half", "hero"]);
  assert.equal(pose.at(-1).kind, "hero", "cảnh cuối luôn là sản phẩm thật");
  assert.equal(pickPose("hook", ["thinking"], config) !== "thinking", true);
  assert.deepEqual(buildBlockers(ai).map((b) => b.scene), ["s1", "s4"], "ảnh AI chưa có thì chặn dựng");
});

test("prompt cảnh: có mô tả khoá nguyên văn + ngôn ngữ nhiếp ảnh + tỉ lệ + câu khoá sản phẩm + chỉ lấy khuôn mặt + trang phục + câu cấm; mẫu riêng từng loại món", () => {
  const layout = referenceLayout({ products: 1, faces: 3, outfit: true });
  assert.deepEqual(layout, { productRange: "1", faceRange: "2–4", outfitRef: "5", count: 5 });
  for (const slot of ["hold-close", "wear-hand"]) {
    const p = buildScenePrompt({ slot, kind: "ring", lockText: LOCK, layout, config });
    assert.ok(p.includes(LOCK), "mô tả khoá nằm nguyên văn trong prompt");
    for (const re of [/85mm/, /f\/2/, /40 cm/, /softbox/, /rim light/, /one quarter of the frame width/, /Do NOT change the metal color/, /Do NOT change the number of stone rows/, /Do NOT add, remove or restyle/, /ONLY for his face and hairstyle/, /do NOT take their clothes/, /reference images 2–4/, /áo phông đen, tạp dề da nâu/, /reference image 5/, /No text/]) assert.match(p, re, String(re));
    assert.doesNotMatch(p, /\{\{|undefined/);
  }
  const hold = buildScenePrompt({ slot: "hold-close", kind: "ring", lockText: LOCK, layout, config });
  assert.match(hold, /thumb and index finger/);
  assert.match(hold, /chin level/);
  assert.match(hold, /slightly soft/, "mặt mờ nhẹ");
  const wear = buildScenePrompt({ slot: "wear-hand", kind: "ring", lockText: LOCK, layout, config });
  assert.match(wear, /ring finger/);
  assert.match(wear, /face height/);
  assert.match(buildScenePrompt({ slot: "wear-hand", kind: "necklace", lockText: LOCK, layout, config }), /around his neck/);
  assert.match(buildScenePrompt({ slot: "wear-hand", kind: "earring", lockText: LOCK, layout, config }), /ear lobe/);
  assert.deepEqual(kindsWithSceneTemplates(config), ["ring", "necklace", "earring"]);
  assert.throws(() => buildScenePrompt({ slot: "hold-close", kind: "bracelet", lockText: LOCK, layout, config }), /Chưa có mẫu cảnh/);
  assert.doesNotMatch(buildScenePrompt({ slot: "hold-close", kind: "ring", lockText: LOCK, layout: referenceLayout({ products: 1, faces: 0, outfit: false }), config }), /reference images/, "không có ảnh mặt thì không có câu khoá mặt");
});

test("prompt sửa ảnh: 'giữ nguyên mọi thứ, chỉ sửa khuôn mặt' / 'chỉ sửa sản phẩm cho giống hệt ảnh gốc' / yêu cầu tự do (không đụng mặt + sản phẩm)", () => {
  const face = buildEditPrompt({ action: "fix-face", kind: "ring", slot: "hold-close", lockText: LOCK, layout: referenceLayout({ products: 0, faces: 3, outfit: false, lead: 1 }), config });
  assert.match(face, /KEEP EVERYTHING in the first image/);
  assert.match(face, /ONLY fix the face/);
  assert.match(face, /reference images 2–4/);
  const prod = buildEditPrompt({ action: "fix-product", kind: "ring", slot: "hold-close", lockText: LOCK, layout: referenceLayout({ products: 1, faces: 0, outfit: false, lead: 1 }), config });
  assert.match(prod, /ONLY fix the jewelry/);
  assert.match(prod, /IDENTICAL to the product in reference 2/);
  assert.ok(prod.includes(LOCK));
  const free = buildEditPrompt({ action: "edit", kind: "ring", slot: "hold-close", lockText: LOCK, layout: referenceLayout({ products: 0, faces: 0, outfit: false, lead: 1 }), userRequest: "nền sáng hơn một chút", config });
  assert.match(free, /nền sáng hơn một chút/);
  assert.match(free, /Never change the jewelry or the face/);
});

test("kiểm ảnh: chấm 4 tiêu chí, ngưỡng đạt từ config; thiếu ảnh mặt chuẩn -> face=null + cảnh báo; cache theo hash; chọn ảnh tốt nhất theo hạng", async () => {
  const mk = (over = {}) => ({ product: { score: 9, reason: "đúng", issue: "" }, face: { score: 8, reason: "giống", issue: "" }, hands: { score: 8, reason: "ổn", issue: "" }, outfit: { score: 9, reason: "đúng", issue: "" }, ...over });
  let calls = 0;
  const gen = async (args) => { calls++; return { result: mk(args.__over), model: "m-flash" }; };
  const img = { mimeType: "image/jpeg", data: "AAAA" };
  const refs = { products: [{ mimeType: "image/jpeg", data: "P" }], faces: [{ mimeType: "image/jpeg", data: "F1" }], outfit: null };
  const cache = createSceneCache(path.join(dir, "ck"));
  const r1 = await checkSceneImage({ image: img, slot: "hold-close", lockText: LOCK, refs, ledgerSlug: "s", cache, generate: gen, config, env: {} });
  assert.equal(r1.pass, true);
  assert.deepEqual(r1.scores, { product: 9, face: 8, hands: 8, outfit: 9 });
  await checkSceneImage({ image: img, slot: "hold-close", lockText: LOCK, refs, ledgerSlug: "s", cache, generate: gen, config, env: {} });
  assert.equal(calls, 1, "cùng ảnh + cùng đối chiếu -> dùng cache, không gọi lại");
  const noFace = await checkSceneImage({ image: img, slot: "hold-close", lockText: LOCK, refs: { ...refs, faces: [] }, ledgerSlug: "s", generate: gen, config, env: {} });
  assert.equal(noFace.scores.face, null);
  assert.match(noFace.reasons.face, /Chưa có ảnh khuôn mặt chuẩn/);
  assert.equal(noFace.pass, true, "không đo được mặt thì không tính vào đạt/trượt");
  const bad = await checkSceneImage({ image: img, slot: "wear-hand", lockText: LOCK, refs, ledgerSlug: "s", generate: async () => ({ result: mk({ product: { score: 3, reason: "Nhẫn có 2 hàng đá, ảnh gốc 3 hàng", issue: "product-rows" } }), model: "m" }), config, env: {} });
  assert.equal(bad.pass, false);
  assert.deepEqual(bad.failed, ["product"]);
  assert.match(bad.reasons.product, /2 hàng/);
  assert.deepEqual(evaluateScores({ a: 7, b: 6, c: null }, 7), { pass: false, failed: ["b"] });
  assert.ok(rankScores(PASS, 7) > rankScores(failing("product"), 7));
  assert.equal(rankScores(null, 7), -1);
});

test("gemini: tạo ảnh -> kiểm đạt ngay -> cảnh 'ok', ghi sổ chi phí đúng slug, 4 tiêu chí + ảnh tham chiếu (sản phẩm + 3 mặt) được gửi", async () => {
  const env = makeEnv();
  const out = await env.service.generateScene({ projectId: env.project.id, sceneId: "s1" });
  const s = out.scenes.find((x) => x.id === "s1");
  assert.equal(s.status, "ok");
  assert.equal(s.approved, true);
  assert.equal(s.source, "gemini");
  assert.ok(fs.existsSync(env.store.fileAbs(env.project.id, s.image)));
  assert.equal(env.calls.generate.length, 1);
  assert.equal(env.calls.generate[0].refs, 4, "1 ảnh sản phẩm + 3 ảnh mặt");
  assert.deepEqual(env.calls.check[0].refs, { products: 1, faces: 3 });
  assert.match(env.calls.generate[0].prompt, /one quarter of the frame width/);
  assert.equal(s.attempts.length, 1);
  assert.equal(s.attempts[0].action, "generate");
  const rows = spentRows().filter((r) => r.task === "product-image");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slug, env.project.ledgerSlug);
});

test("gemini: mặt lệch -> SỬA MẶT trên chính ảnh (không tạo lại) -> đạt; sản phẩm sai -> sửa sản phẩm -> vẫn sai -> tạo lại -> đạt", async () => {
  const faceFix = makeEnv({ checks: [failing("face"), PASS] });
  const out = await faceFix.service.generateScene({ projectId: faceFix.project.id, sceneId: "s1" });
  assert.deepEqual(faceFix.calls.generate.map((c) => c.subtask), ["s1:generate", "s1:fix-face"]);
  assert.equal(faceFix.calls.generate[1].refs, 4, "ảnh đang sửa + 3 ảnh mặt");
  assert.match(faceFix.calls.generate[1].prompt, /ONLY fix the face/);
  assert.equal(out.scenes[0].status, "ok");
  assert.deepEqual(out.scenes[0].attempts.map((a) => a.action), ["generate", "fix-face"]);

  const prodFix = makeEnv({ checks: [failing("product"), failing("product"), PASS] });
  const out2 = await prodFix.service.generateScene({ projectId: prodFix.project.id, sceneId: "s1" });
  assert.deepEqual(prodFix.calls.generate.map((c) => c.subtask), ["s1:generate", "s1:fix-product", "s1:generate"], "sửa sản phẩm vẫn sai -> tạo lại");
  assert.match(prodFix.calls.generate[1].prompt, /ONLY fix the jewelry/);
  assert.equal(out2.scenes[0].status, "ok");
});

test("gemini: hết lượt thử vẫn không đạt -> giữ ảnh ĐIỂM CAO NHẤT, đánh dấu cần duyệt (đỏ), không vượt tổng số lần gọi ảnh theo config", async () => {
  const worse = { ...failing("product", "hands"), scores: { product: 2, face: 9, hands: 2, outfit: 9 } };
  const better = { ...failing("hands"), scores: { product: 9, face: 9, hands: 5, outfit: 9 } };
  const env = makeEnv({ checks: [worse, better, worse, worse, worse, worse] });
  const out = await env.service.generateScene({ projectId: env.project.id, sceneId: "s1" });
  const s = out.scenes[0];
  assert.equal(s.status, "needs-review");
  assert.equal(s.approved, false);
  assert.ok(env.calls.generate.length <= config.scenes.maxAttempts.totalImageCalls);
  assert.match(s.note, /điểm cao nhất/);
  const bestAttempt = s.attempts.reduce((a, b) => (rankScores({ scores: b.check.scores }, 7) > rankScores({ scores: a.check.scores }, 7) ? b : a));
  assert.equal(s.image, bestAttempt.file, "ảnh được giữ = ảnh điểm cao nhất");
  assert.deepEqual(buildBlockers(out.scenes).map((b) => b.scene).includes("s1"), true, "chưa duyệt thì chưa dựng được");
  const approved = await env.service.approve(env.project.id, "s1");
  assert.equal(approved.scenes[0].approved, true);
  assert.equal(buildBlockers(approved.scenes).some((b) => b.scene === "s1"), false);
});

test("ngân sách: trước MỖI lời gọi ước tính + cộng chi phí đã dùng; vượt trần thì không gọi, hạ cấp (giữ ảnh tốt nhất hoặc pose)", async () => {
  // trần chỉ đủ 1 ảnh (1 ảnh = $0.067 ≈ 1.742đ): lần tạo thứ 2 (sửa mặt) bị từ chối -> giữ ảnh đã có, đánh dấu duyệt
  process.env.PRODUCT_VIDEO_MAX_COST_VND = "2500";
  const env = makeEnv({ checks: [failing("face")] });
  const out = await env.service.generateScene({ projectId: env.project.id, sceneId: "s1" });
  assert.equal(env.calls.generate.length, 1, "lời gọi thứ 2 bị chặn bởi trần");
  assert.equal(out.scenes[0].status, "needs-review");
  assert.match(out.scenes[0].note, /Vượt trần/);
  assert.ok(out.scenes[0].image);
  // trần quá thấp cho cả ảnh đầu: không gọi API nào, cảnh lùi về pose
  process.env.PRODUCT_VIDEO_MAX_COST_VND = "500";
  const env2 = makeEnv();
  const out2 = await env2.service.generateScene({ projectId: env2.project.id, sceneId: "s1" });
  assert.equal(env2.calls.generate.length, 0);
  assert.equal(out2.scenes[0].kind, "pose");
  assert.equal(out2.scenes[0].source, "pose");
  assert.match(out2.scenes[0].note, /Vượt trần/);
});

test("ngân sách: bật clip AI thì GIỮ CHỖ 5.200đ trước — ảnh không được ăn vào phần của clip", async () => {
  process.env.PRODUCT_VIDEO_MAX_COST_VND = "6000"; // 6.000 - 5.200 giữ chỗ = 800 < 1 ảnh (1.742đ)
  const env = makeEnv({ aiClip: true });
  const out = await env.service.generateScene({ projectId: env.project.id, sceneId: "s1" });
  assert.equal(env.calls.generate.length, 0);
  assert.equal(out.scenes[0].kind, "pose");
  process.env.PRODUCT_VIDEO_MAX_COST_VND = "9000";
  const env2 = makeEnv({ aiClip: true });
  await env2.service.generateScene({ projectId: env2.project.id, sceneId: "s1" });
  assert.equal(env2.calls.generate.length, 1, "9.000 - 5.200 = 3.800 đủ cho 2 ảnh");
});

test("lỗi billing khi gọi thật -> báo tiếng Việt, tự chuyển sang pose, đóng băng nguồn tự động, cảnh sau không gọi thêm; job không hỏng", async () => {
  let n = 0;
  const gen = async () => { n++; throw new BillingRequiredError("billing", { userMessage: "Tài khoản Gemini chưa bật thanh toán (billing) nên..." }); };
  const env = makeEnv({ gen });
  const out = await env.service.generateAllScenes({ projectId: env.project.id });
  assert.equal(n, 1, "cảnh đầu bị từ chối; cảnh sau không gọi nữa");
  const photos = out.scenes.filter((s) => s.slot);
  assert.equal(photos.length, 0, "cả 2 cảnh đã chuyển thành pose");
  assert.ok(out.scenes.filter((s) => s.kind === "pose").length >= 2);
  assert.match(out.scenes.find((s) => s.id === "s1").note, /chưa bật thanh toán/);
  assert.equal(env.billing.isEnabled(), false);
  assert.match(env.billing.status().reason, /chưa bật thanh toán/);
  assert.equal(buildBlockers(out.scenes).length, 0, "không còn gì chặn dựng");
  // model đã ngừng cũng lùi về pose nhưng không đổ lỗi billing
  const env3 = makeEnv({ gen: async () => { throw new ModelUnavailableError("gone", { userMessage: "Model \"x\" không còn dùng được." }); } });
  const out3 = await env3.service.generateScene({ projectId: env3.project.id, sceneId: "s1" });
  assert.equal(out3.scenes[0].kind, "pose");
  assert.equal(env3.billing.isEnabled(), true);
});

test("chưa bật billing: nguồn gemini không gọi API, lùi pose + lý do; vẫn dùng được ảnh đã cache từ trước", async () => {
  const env = makeEnv({ billingOn: false });
  const out = await env.service.generateScene({ projectId: env.project.id, sceneId: "s1" });
  assert.equal(env.calls.generate.length, 0);
  assert.equal(out.scenes[0].kind, "pose");
  assert.match(out.scenes[0].note, /billing/);
});

test("cache theo hash đầu vào: cùng prompt + cùng ảnh tham chiếu -> không gọi lại API (cả khi billing đã tắt); đổi 1 byte ảnh sản phẩm -> gọi lại", async () => {
  const env = makeEnv();
  await env.service.generateScene({ projectId: env.project.id, sceneId: "s1" });
  assert.equal(env.calls.generate.length, 1);
  // dựng lại cảnh trong CÙNG dự án: cùng đầu vào
  await env.service.update(env.project.id, (p) => { Object.assign(p.scenes[0], { image: null, status: "pending", attempts: [] }); });
  env.billing.block("giả lập hết billing");
  const again = await env.service.generateScene({ projectId: env.project.id, sceneId: "s1" });
  assert.equal(env.calls.generate.length, 1, "lấy từ cache, không gọi API");
  assert.equal(again.scenes[0].status, "ok");
  assert.equal(again.scenes[0].attempts[0].cached, true);
  assert.equal(again.scenes[0].attempts[0].cost, 0);
  assert.ok(spentRows().some((r) => r.task === "product-scene" && /^cache:/.test(r.subtask) && r.cost_usd === 0), "lần dùng cache ghi sổ 0đ");
  // đổi ảnh sản phẩm -> khoá cache khác
  env.billing.reset();
  makeRingPng(env.store.fileAbs(env.project.id, "product-1.png"), { box: [60, 60, 100, 100] });
  await env.service.update(env.project.id, (p) => { Object.assign(p.scenes[0], { image: null, status: "pending", attempts: [] }); });
  await env.service.generateScene({ projectId: env.project.id, sceneId: "s1" });
  assert.equal(env.calls.generate.length, 2);
});

test("hành động có phí trên 1 cảnh: tạo lại / sửa mặt / sửa sản phẩm / yêu cầu tự do — chi phí vào sổ, bị chặn khi vượt trần, 'edit' bắt buộc có yêu cầu", async () => {
  const env = makeEnv();
  await env.service.generateScene({ projectId: env.project.id, sceneId: "s1" });
  const before = env.calls.generate.length;
  await env.service.runAction({ projectId: env.project.id, sceneId: "s1", action: "fix-face" });
  await env.service.runAction({ projectId: env.project.id, sceneId: "s1", action: "fix-product" });
  await env.service.runAction({ projectId: env.project.id, sceneId: "s1", action: "regenerate" });
  const edit = await env.service.runAction({ projectId: env.project.id, sceneId: "s1", action: "edit", userRequest: "nền tối hơn" });
  assert.deepEqual(env.calls.generate.slice(before).map((c) => c.subtask), ["s1:fix-face", "s1:fix-product", "s1:regenerate", "s1:edit"]);
  assert.match(env.calls.generate.at(-1).prompt, /nền tối hơn/);
  assert.equal(edit.scenes[0].attempts.at(-1).userRequest, "nền tối hơn");
  await assert.rejects(() => env.service.runAction({ projectId: env.project.id, sceneId: "s1", action: "edit", userRequest: " " }), /nhập yêu cầu/);
  await assert.rejects(() => env.service.runAction({ projectId: env.project.id, sceneId: "s2", action: "regenerate" }), /Chỉ cảnh có ảnh/);
  await assert.rejects(() => env.service.runAction({ projectId: env.project.id, sceneId: "s1", action: "drop" }), /không hợp lệ/);
  // hết ngân sách: bấm sửa -> không gọi, giữ ảnh, báo lý do
  process.env.PRODUCT_VIDEO_MAX_COST_VND = "1000";
  const n = env.calls.generate.length;
  const blocked = await env.service.runAction({ projectId: env.project.id, sceneId: "s1", action: "fix-face" });
  assert.equal(env.calls.generate.length, n);
  assert.match(blocked.scenes[0].note, /Vượt trần/);
  assert.ok(blocked.scenes[0].image);
});

test("manual: tải ảnh -> kiểm 4 tiêu chí (miễn phí, không gọi API ảnh); kết quả chỉ để cảnh báo, người dùng vẫn duyệt được; ghi sổ 0đ", async () => {
  const env = makeEnv({ source: "manual", checks: [failing("face", "hands")] });
  assert.equal(env.project.scenes.find((s) => s.id === "s1").source, "manual");
  const out = await env.service.adoptUpload({ projectId: env.project.id, sceneId: "s1", buffer: env.png, ext: ".png" });
  const s = out.scenes[0];
  assert.equal(env.calls.generate.length, 0, "manual không gọi API ảnh");
  assert.equal(env.calls.check.length, 1);
  assert.equal(s.source, "manual");
  assert.equal(s.status, "needs-review");
  assert.match(s.note, /chỉ để cảnh báo/);
  assert.deepEqual(s.check.failed.sort(), ["face", "hands"]);
  assert.equal(buildBlockers(out.scenes).some((b) => b.scene === "s1"), true);
  const approved = await env.service.approve(env.project.id, "s1");
  assert.equal(buildBlockers(approved.scenes).some((b) => b.scene === "s1"), false);
  assert.ok(spentRows().some((r) => r.task === "product-scene" && /^manual-upload:s1/.test(r.subtask) && r.cost_usd === 0));
  // ảnh tải lên đạt kiểm -> tự duyệt
  const env2 = makeEnv({ source: "manual" });
  const ok = await env2.service.adoptUpload({ projectId: env2.project.id, sceneId: "s1", buffer: env2.png, ext: ".png" });
  assert.equal(ok.scenes[0].status, "ok");
  assert.equal(ok.scenes[0].approved, true);
});

test("manual: tải ảnh lên cảnh đang là pose -> chuyển thành cảnh ảnh; 'dùng ảnh sản phẩm gốc' và 'đổi pose' đưa cảnh về nguồn miễn phí", async () => {
  const env = makeEnv({ source: "pose" });
  assert.equal(env.project.scenes[0].kind, "pose");
  const up = await env.service.adoptUpload({ projectId: env.project.id, sceneId: "s1", buffer: env.png, ext: ".png" });
  assert.equal(up.scenes[0].kind, "photo");
  assert.equal(up.scenes[0].slot, "hold-close");
  const orig = await env.service.useOriginal(env.project.id, "s1");
  assert.equal(orig.scenes[0].kind, "hero");
  assert.equal(orig.scenes[0].source, "product");
  const posed = await env.service.changePose(env.project.id, "s1", "shocked-a");
  assert.equal(posed.scenes[0].kind, "pose");
  assert.equal(posed.scenes[0].pose, "shocked-a");
  await assert.rejects(() => env.service.changePose(env.project.id, "s1", "khong-co"), /không có trong cấu hình/);
  const rows = spentRows().filter((r) => r.task === "product-scene");
  assert.ok(rows.length >= 3 && rows.every((r) => r.cost_usd === 0), "mọi quyết định miễn phí ghi sổ 0đ");
});

test("hướng dẫn nguồn manual: thứ tự đính kèm khớp số thứ tự trong prompt; thiếu ảnh mặt thì nhắc bổ sung", () => {
  const g = manualAttachGuide({ productCount: 2, faceCount: 3, outfitImage: true, config });
  assert.match(g[0], /ảnh số 1–2/);
  assert.match(g[1], /ảnh số 3–5/);
  assert.match(g[2], /ảnh số 6/);
  const none = manualAttachGuide({ productCount: 1, faceCount: 0, outfitImage: false, config });
  assert.match(none[1], /CHƯA có ảnh khuôn mặt/);
  assert.match(none[2], /áo phông đen, tạp dề da nâu/);
});

test("ImageDowngrade mang lý do (billing / budget / model)", () => {
  const d = new ImageDowngrade("budget", "Vượt trần");
  assert.equal(d.reason, "budget");
  assert.equal(d.message, "Vượt trần");
  void textResponse;
});

test("schema gửi Gemini không có enum rỗng / enum trống (Gemini trả 400 'cannot be empty' — lỗi thật gặp khi chạy thật)", async () => {
  const { checkSchema, ISSUE_CODES } = await import("../scripts/lib/product/scene-check.mjs");
  const { analysisSchema } = await import("../scripts/lib/product/analyze.mjs");
  const { scriptSchema } = await import("../scripts/lib/product/script.mjs");
  const { getLocale } = await import("../scripts/lib/locales.mjs");
  const bad = [];
  const walk = (node, where) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.enum) && (!node.enum.length || node.enum.some((v) => v === "" || v === null))) bad.push(where);
    for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`);
  };
  walk(checkSchema, "check");
  walk(analysisSchema, "analysis");
  walk(scriptSchema({ locale: getLocale("vi-VN"), config }), "script");
  assert.deepEqual(bad, []);
  assert.ok(ISSUE_CODES.includes("none") && !ISSUE_CODES.includes(""));
});
