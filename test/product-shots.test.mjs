// Mốc 4: cảnh phụ không tốn tiền — nhịp shot 1,5–2,5s, hình học khung bao, chớp sáng xác định, tách nền + cận đá + nửa người.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadProductConfig } from "../scripts/lib/product/config.mjs";
import { splitShots, coverLayout, boxToFrame, centerOf, sparklePoints, planShots, seededRandom, hashSeed } from "../scripts/lib/product/shots.mjs";
import { prepareSceneAssets, boxIntoCrop, macroZoom } from "../scripts/lib/product/scene-assets.mjs";
import { createProductStore } from "../scripts/lib/product/store.mjs";
import { probeImage } from "../scripts/lib/product/images.mjs";
import { planScenes } from "../scripts/lib/product/scenes.mjs";
import { tmpDir, makeRingPng, makeSolidPng } from "./helpers/product-fixtures.mjs";

const config = loadProductConfig();

test("chia shot: mỗi shot 1,5–2,5 giây khi cảnh đủ dài; tổng đúng bằng độ dài cảnh; khoảng khó chia (2,6s) giữ 1 shot dài thay vì 2 shot quá ngắn", () => {
  for (let d = 3; d <= 12; d += 0.1) {
    const shots = splitShots(d);
    const total = shots.reduce((a, s) => a + s.dur, 0);
    assert.ok(Math.abs(total - d) < 0.02, `tổng ${d}`);
    for (const s of shots) assert.ok(s.dur >= 1.45 && s.dur <= 2.55 || (shots.length === 1 && s.dur <= 3.0), `shot ${s.dur} của cảnh ${d.toFixed(1)}`);
    assert.equal(shots[0].start, 0);
  }
  assert.equal(splitShots(2.6).length, 1);
  assert.equal(splitShots(1.2).length, 1);
  assert.deepEqual(splitShots(4).map((s) => s.dur), [2, 2]);
  assert.equal(splitShots(5).length, 3, "5 giây -> 3 shot ~1,67s (gần 2 giây hơn 2 shot 2,5s)");
  assert.equal(splitShots(6).length, 3);
});

test("hình học: ảnh 9:16 phủ đúng khung 1080×1920; khung bao chuẩn hoá -> px khung video; ảnh ngang bị cắt hai bên", () => {
  assert.deepEqual(coverLayout(720, 1280, 1080, 1920), { scale: 1.5, w: 1080, h: 1920, x: 0, y: 0 });
  assert.deepEqual(boxToFrame({ x: 0.3, y: 0.4, w: 0.2, h: 0.1 }, 720, 1280), { x: 324, y: 768, w: 216, h: 192 });
  const wide = coverLayout(1600, 900, 1080, 1920);
  assert.ok(wide.w > 1080 && wide.x < 0 && wide.h === 1920);
  const c = centerOf({ x: 100, y: 200, w: 50, h: 40 });
  assert.deepEqual(c, { x: 125, y: 220 });
});

test("PRNG có hạt giống: cùng seed cùng dãy, khác seed khác dãy (render phải xác định, không Math.random)", () => {
  const a = Array.from({ length: 5 }, seededRandom(hashSeed("s1")));
  const b = Array.from({ length: 5 }, seededRandom(hashSeed("s1")));
  const c = Array.from({ length: 5 }, seededRandom(hashSeed("s2")));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.every((v) => v >= 0 && v < 1));
});

test("chớp sáng: nằm TRONG khung bao sản phẩm, xác định theo seed, cỡ/độ trễ hợp lý; không khung bao thì không có chớp", () => {
  const box = { x: 300, y: 900, w: 200, h: 120 };
  const pts = sparklePoints(box, 4, "s1:0", { shotDur: 2 });
  assert.equal(pts.length, 4);
  for (const p of pts) {
    assert.ok(p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h, JSON.stringify(p));
    assert.ok(p.delay >= 0 && p.delay <= 2 && p.size >= 20 && p.size <= 60 && p.peak > 0.5 && p.peak <= 1);
  }
  assert.deepEqual(pts, sparklePoints(box, 4, "s1:0", { shotDur: 2 }));
  assert.notDeepEqual(pts, sparklePoints(box, 4, "s1:1", { shotDur: 2 }));
  assert.equal(new Set(pts.map((p) => `${p.x},${p.y}`)).size, 4, "4 điểm khác nhau");
  assert.deepEqual(planShots({ start: 0, dur: 3, kind: "photo", seed: "x", box: null, config })[0].sparkles, []);
});

test("kế hoạch shot: chồng khít thời gian cảnh, khung hình luân phiên, zoom tăng dần, chớp sáng trong khung bao, xác định", () => {
  const box = { x: 324, y: 768, w: 216, h: 192 };
  const shots = planShots({ start: 4.5, dur: 4, kind: "photo", seed: "s4", box, config });
  assert.equal(shots.length, 2);
  assert.equal(shots[0].at, 4.5);
  assert.ok(Math.abs(shots[1].at - (4.5 + shots[0].dur)) < 0.01);
  assert.deepEqual(shots.map((s) => s.framing), ["wide", "tight"]);
  for (const s of shots) {
    assert.ok(s.zoom[1] > s.zoom[0]);
    assert.equal(s.sparkles.length, config.video.sparklesPerShot);
    for (const p of s.sparkles) assert.ok(p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h);
  }
  assert.deepEqual(shots, planShots({ start: 4.5, dur: 4, kind: "photo", seed: "s4", box, config }));
});

test("khung bao -> hệ toạ độ PNG đã cắt; cận đá: zoom kẹp [min,max], không có khung đá thì dùng zoom mặc định", () => {
  const crop = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
  assert.deepEqual(boxIntoCrop({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, crop), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.equal(boxIntoCrop({ x: 0.0, y: 0.0, w: 0.1, h: 0.1 }, crop), null, "ngoài vùng cắt");
  assert.equal(boxIntoCrop(null, crop), null);
  const clipped = boxIntoCrop({ x: 0.2, y: 0.3, w: 0.3, h: 0.1 }, crop);
  assert.ok(clipped.x === 0 && clipped.w <= 1);
  const m = config.video.macro;
  assert.equal(macroZoom(null, 760, 1080, m), m.fallbackZoom);
  assert.equal(macroZoom({ x: 0, y: 0, w: 0.9, h: 0.9 }, 760, 1080, m), m.minZoom);
  assert.equal(macroZoom({ x: 0, y: 0, w: 0.05, h: 0.05 }, 760, 1080, m), m.maxZoom);
  const mid = macroZoom({ x: 0, y: 0, w: 0.3, h: 0.3 }, 760, 1080, m);
  assert.ok(mid > m.minZoom && mid < m.maxZoom);
});

test("chuẩn bị ảnh cảnh: tách nền sản phẩm (PNG trong suốt), khung viên đá quy về toạ độ PNG, ảnh cảnh AI chép sang + khung bao (mặc định nếu AI không trả)", async () => {
  const dir = tmpDir();
  const store = createProductStore({ dir: path.join(dir, "products") });
  const p = store.create({});
  makeRingPng(store.fileAbs(p.id, "product-1.png"));
  makeSolidPng(store.fileAbs(p.id, "scene-s1-v1.png"), { width: 720, height: 1280, color: "0x335577" });
  makeSolidPng(store.fileAbs(p.id, "scene-s4-v1.png"), { width: 720, height: 1280, color: "0x553377" });
  const lines = ["hook", "specs", "specs", "wear", "emotion", "cta"].map((beat, i) => ({ n: i + 1, beat }));
  Object.assign(p, {
    images: [{ id: "product-1", file: "product-1.png", width: 300, height: 300 }],
    analysis: { kind: "ring", images: [{ index: 0, bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, stoneBbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, view: "front" }] },
  });
  p.scenes = planScenes({ lines, imageSource: "gemini", kind: "ring", analysis: p.analysis, config });
  Object.assign(p.scenes[0], { image: "scene-s1-v1.png", productBox: { x: 0.35, y: 0.5, w: 0.3, h: 0.15 }, status: "ok" });
  Object.assign(p.scenes[3], { image: "scene-s4-v1.png", status: "ok" });
  store.write(p);
  const target = path.join(dir, "video");
  const out = await prepareSceneAssets({ project: store.read(p.id), store, targetDir: target, config });
  const prod = out.products[0];
  assert.ok(fs.existsSync(path.join(target, prod.cut)) && fs.existsSync(path.join(target, prod.original)));
  const dims = await probeImage(path.join(target, prod.cut));
  assert.deepEqual({ w: dims.width, h: dims.height }, { w: prod.cutW, h: prod.cutH });
  assert.ok(prod.cutW >= 600, "ảnh nhỏ được phóng to khi tách nền");
  assert.ok(prod.stoneBox && prod.stoneBox.x >= 0 && prod.stoneBox.x + prod.stoneBox.w <= 1.0001, JSON.stringify(prod.stoneBox));
  assert.equal(out.photos.s1.boxSource, "ai");
  assert.deepEqual(out.photos.s1.box, { x: 0.35, y: 0.5, w: 0.3, h: 0.15 });
  assert.equal(out.photos.s4.boxSource, "default");
  assert.deepEqual(out.photos.s4.box, config.scenes.slots["wear-hand"].defaultBox);
  assert.equal(out.photos.s1.w, 720);
  assert.ok(fs.existsSync(path.join(target, out.photos.s1.file)));
  // ảnh sản phẩm thứ 2 không tồn tại mà cảnh dùng -> lỗi rõ ràng
  const bad = store.read(p.id);
  bad.scenes[1].productImage = 1;
  await assert.rejects(() => prepareSceneAssets({ project: bad, store, targetDir: target, config }), /ảnh sản phẩm số 2/);
});
