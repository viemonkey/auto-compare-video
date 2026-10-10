// Mốc 6: nhịp thoại, cửa sổ cảnh, thẻ thông số (không bịa), từ khoá phụ đề, HTML cảnh + dữ liệu GSAP, cờ ai_generated.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadProductConfig } from "../scripts/lib/product/config.mjs";
import { computeProductTiming, sceneWindows, keywordsFromForm, chipsPerSpecLine, buildProductIndexHtml, buildScenes } from "../scripts/lib/product/compose-product.mjs";
import { usesAiImages } from "../scripts/lib/product/ai-flag.mjs";
import { planScenes } from "../scripts/lib/product/scenes.mjs";
import { normalizeForm } from "../scripts/lib/product/form.mjs";
import { normalizeSpecValues } from "../scripts/lib/product/script.mjs";
import { getLocale } from "../scripts/lib/locales.mjs";
import { cutoutBackground } from "../scripts/lib/product/images.mjs";
import { tmpDir, makeRingPng, makeSolidPng } from "./helpers/product-fixtures.mjs";

const config = loadProductConfig();
const vi = getLocale("vi-VN");
const FORM = normalizeForm({ type: "nhẫn", material: "bạc 925", metalColor: "trắng", mainStone: "đá moissanite", stoneOrigin: "lab", feature: "vòng bánh răng xoay được", price: "1.290.000đ" }, config);
const LINES = ["hook", "specs", "specs", "wear", "emotion", "cta"].map((beat, i) => ({ n: i + 1, beat, text: `Câu số ${i + 1} của video`, vi: "", id: `line-${i + 1}` }));
const DURS = Object.fromEntries(LINES.map((l, i) => [l.id, 2.4 + (i % 3) * 0.3]));

test("nhịp thoại: câu đầu sau startOffset, cách nhau gap, giữ outroHold; video nằm trong 15–20 giây với lời thoại bình thường", () => {
  const t = computeProductTiming(LINES, DURS, config);
  assert.equal(t.timing[0].start, config.video.startOffset);
  assert.ok(Math.abs(t.timing[1].start - (t.timing[0].start + DURS["line-1"] + config.video.gap)) < 0.002);
  const last = t.timing.at(-1);
  assert.ok(Math.abs(t.ROOT_DURATION - (last.start + last.dur + config.video.outroHold)) < 0.06);
  assert.ok(t.ROOT_DURATION >= 15 && t.ROOT_DURATION <= 20, `${t.ROOT_DURATION}`);
  assert.throws(() => computeProductTiming(LINES, {}, config), /Thiếu duration/);
});

test("cửa sổ cảnh: cảnh đầu từ 0, cảnh cuối tới hết video, các cảnh liền khít không chồng/hở; mỗi cảnh ứng với 1 câu", () => {
  const t = computeProductTiming(LINES, DURS, config);
  const w = sceneWindows(t.timing, t.ROOT_DURATION);
  assert.equal(w.length, LINES.length);
  assert.equal(w[0].at, 0);
  assert.equal(w.at(-1).end, t.ROOT_DURATION);
  for (let i = 1; i < w.length; i++) assert.equal(w[i].at, w[i - 1].end, `cảnh ${i} liền cảnh trước`);
  for (let i = 0; i < w.length; i++) assert.ok(w[i].at <= t.timing[i].start + 1e-9 && w[i].end > t.timing[i].start, "câu nói nằm trong cảnh của nó");
  assert.ok(w.every((x) => x.dur >= 1.5), "mỗi cảnh đủ dài để có shot");
});

test("từ khoá phụ đề: lấy từ form (đá, chất liệu, màu, số), bỏ từ đệm; chuẩn hoá không dấu câu", () => {
  const k = keywordsFromForm(FORM);
  for (const w of ["moissanite", "bạc", "925", "trắng", "bánh", "răng", "xoay"]) assert.ok(k.includes(w.normalize("NFKC")), w);
  assert.ok(!k.includes("đá"), "từ đệm bị bỏ");
  assert.ok(!k.includes("nhân"), "chỉ từ có trong form");
});

test("thẻ thông số: chỉ field form có, KHÔNG có giá (giá ở cảnh kêu gọi), nhóm 1 = chất liệu/màu/đá/nguồn gốc, nhóm 2 = điểm nổi bật; dùng bản dịch spec_values cho thị trường khác", () => {
  const project = { form: FORM, script: { lines: LINES, specValues: {} } };
  const g = chipsPerSpecLine(project, { material: "Chất liệu", metalColor: "Màu kim loại", mainStone: "Đá chính", sideStones: "Đá phụ", origin: "Nguồn gốc đá", feature: "Điểm nổi bật", price: "Giá" }, config);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].map((c) => c.label), ["Chất liệu", "Màu kim loại", "Đá chính", "Nguồn gốc đá"]);
  assert.equal(g[0].find((c) => c.label === "Nguồn gốc đá").value, "Nhân tạo");
  assert.deepEqual(g[1].map((c) => c.label), ["Điểm nổi bật"]);
  assert.ok(!JSON.stringify(g).includes("1.290.000"), "giá không nằm ở thẻ thông số");
  const noFeature = chipsPerSpecLine({ form: { ...FORM, feature: "" }, script: { lines: LINES } }, { material: "M", mainStone: "S", metalColor: "C", origin: "O" }, config);
  assert.ok(noFeature[1].length > 0, "nhóm 2 rỗng -> nhắc lại vài thông số chính để cảnh không trống");
  const one = chipsPerSpecLine({ form: FORM, script: { lines: LINES.filter((l, i) => i !== 2) } }, { material: "M", mainStone: "S", metalColor: "C", origin: "O", feature: "F" }, config);
  assert.equal(one.length, 1, "chỉ 1 câu specs -> 1 nhóm đủ thông số");
  const ja = chipsPerSpecLine({ form: FORM, script: { lines: LINES, specValues: { material: "シルバー925", mainStone: "モアサナイト", origin: "人工石" } } }, { material: "素材", mainStone: "メインストーン", metalColor: "色", origin: "由来", feature: "特徴" }, config);
  assert.equal(ja[0][0].value, "シルバー925");
  assert.equal(ja[0].find((c) => c.label === "由来").value, "人工石");
});

test("spec_values: thị trường tiếng Việt = đúng form; thị trường khác = bản dịch; field form trống luôn rỗng (không thêm giá trị mới)", () => {
  assert.deepEqual(normalizeSpecValues({ material: "BẠC", feature: "bịa" }, normalizeForm({ type: "nhẫn", material: "bạc 925" }, config), false), { type: "nhẫn", material: "bạc 925", metalColor: "", mainStone: "", carat: "", cut: "", sideStones: "", feature: "", origin: "" });
  const ja = normalizeSpecValues({ material: "シルバー925", feature: "回転する歯車", origin: "人工石", cut: "" }, FORM, true);
  assert.equal(ja.material, "シルバー925");
  assert.equal(ja.feature, "回転する歯車");
  assert.equal(ja.cut, "", "form không có giác cắt thì không có");
  assert.equal(normalizeSpecValues({}, FORM, true).material, "bạc 925", "thiếu bản dịch -> rơi về chữ form");
});

async function fixture({ source = "pose", withClip = false, price = true } = {}) {
  const target = tmpDir("pc-");
  fs.mkdirSync(path.join(target, "assets", "images"), { recursive: true });
  const src = makeRingPng(path.join(target, "src.png"), { size: 300 });
  const cut = await cutoutBackground(src, path.join(target, "assets", "images", "product-1-cut.png"), { scale: 3 });
  const products = { 0: { index: 0, original: "assets/images/product-1.png", cut: "assets/images/product-1-cut.png", cutW: cut.width, cutH: cut.height, box: cut.box, stoneBox: { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }, origW: 300, origH: 300, sourcePx: 120 } };
  const photos = {};
  const lines = LINES;
  const scenes = planScenes({ lines, imageSource: source, kind: "ring", analysis: { images: [{ view: "front" }] }, config });
  if (source !== "pose") {
    for (const s of scenes.filter((x) => x.kind === "photo")) {
      makeSolidPng(path.join(target, "assets", "images", `scene-${s.id}.png`), { width: 720, height: 1280 });
      Object.assign(s, { image: `scene-${s.id}-v1.png`, status: "ok", source });
      photos[s.id] = { file: `assets/images/scene-${s.id}.png`, w: 720, h: 1280, box: { x: 0.3, y: 0.45, w: 0.4, h: 0.2 }, boxSource: "ai" };
    }
  }
  const project = { id: "p-aaaaaa-bbbb", displayName: "nhẫn bạc 925", form: price ? FORM : { ...FORM, price: "" }, script: { lines, specValues: {} }, scenes, settings: { imageSource: source } };
  const timing = computeProductTiming(lines, DURS, config);
  const words = Object.fromEntries(lines.map((l) => [l.id, ["Câu", "số", String(l.n), "của", "video"].map((t, i) => ({ t, s: i * 0.4, d: 0.4 }))]));
  const phrases = Object.fromEntries(lines.map((l) => [l.n, [[3, 0], [2, 0]]]));
  const out = await buildProductIndexHtml({ target, project, locale: vi, lines, timing, words, textPlan: { phrases }, assets: { products, photos }, clip: withClip ? { file: "assets/video/clip-hook.mp4", seconds: 4 } : null, audio: { file: "assets/audio/mix.mp3" }, config });
  return { target, html: fs.readFileSync(path.join(target, "index.html"), "utf8"), out, scenes, timing };
}
const dataOf = (html) => JSON.parse(/const DATA = (\{.*?\});\n/s.exec(html)[1]);

test("index.html (nguồn pose): đủ cảnh pose/cận/hero, thẻ thông số đúng cảnh, CTA có giá, host pose + sản phẩm, âm thanh 1 file có id, không còn placeholder", async () => {
  const { html, out } = await fixture({ source: "pose" });
  assert.doesNotMatch(html, /__[A-Z_]+__|\/\*(DATA_OBJECT|CAPTIONS_OBJECT|PHRASES_OBJECT|VO_OBJECT|KEYWORDS_ARRAY)\*\/|<!--(CLIP_TAG|SCENES_HTML|AUDIO_TAG)-->/);
  assert.match(html, /data-composition-id="main"/);
  assert.match(html, /window\.__timelines\["main"\] = tl/);
  assert.match(html, /<audio id="mix" src="assets\/audio\/mix\.mp3" data-start="0" data-duration="[\d.]+" data-track-index="20">/);
  assert.equal((html.match(/class="sc sc-/g) || []).length, 6);
  assert.deepEqual(out.scenes.map((s) => s.kind), ["pose", "macro", "pose", "pose", "macro", "hero"]);
  for (const id of ["thinking", "point-up-left", "explain-a"]) void id;
  assert.equal((html.match(/class="host"/g) || []).length, 3);
  assert.match(html, /assets\/actions\/[a-z-]+\.svg/);
  assert.match(html, /id="chip-2-0"/, "câu thông số 1 có thẻ");
  assert.match(html, /Chất liệu/);
  assert.match(html, /bạc 925/);
  assert.match(html, /Nhân tạo/);
  assert.match(html, /id="cta-6"/);
  assert.match(html, /1\.290\.000đ/, "giá chỉ ở cảnh kêu gọi");
  assert.equal((html.match(/1\.290\.000đ/g) || []).length, 1);
  assert.match(html, /Nhắn tin để được tư vấn/);
  const data = dataOf(html);
  assert.equal(data.scenes.length, 6);
  for (const sc of data.scenes) {
    assert.ok(sc.shots.length >= 1);
    for (const shot of sc.shots) assert.ok(shot.dur > 0 && shot.dur <= 3.01, `shot ${shot.dur}`);
    const total = sc.shots.reduce((a, s) => a + s.dur, 0);
    assert.ok(Math.abs(total - (sc.end - sc.at)) < 0.05, "shot phủ kín cảnh");
  }
  assert.ok(data.scenes.every((s) => s.shots.every((sh) => sh.sparkles.length === config.video.sparklesPerShot)), "mọi cảnh có chớp sáng trong vùng sản phẩm");
  assert.ok(html.includes('"moissanite"') && html.includes('"925"'), "từ khoá nổi bật nhúng vào");
});

test("index.html (nguồn gemini/manual): cảnh ảnh toàn khung + nửa người cắt từ ảnh; chớp sáng trong khung bao tính ra px; clip AI thay ảnh cảnh mở đầu (không img, không chớp)", async () => {
  const noClip = await fixture({ source: "gemini" });
  assert.deepEqual(noClip.out.scenes.map((s) => s.kind), ["photo", "macro", "hero", "photo", "half", "hero"]);
  assert.equal((noClip.html.match(/class="full"/g) || []).length, 3, "2 ảnh cảnh + 1 nửa người");
  assert.doesNotMatch(noClip.html, /<video/);
  const d = dataOf(noClip.html);
  const photoShots = d.scenes[0].shots;
  const box = { x: 0.3 * 1080, y: 0.45 * 1920, w: 0.4 * 1080, h: 0.2 * 1920 };
  for (const sh of photoShots) for (const p of sh.sparkles) assert.ok(p.x >= box.x - 1 && p.x <= box.x + box.w + 1 && p.y >= box.y - 1 && p.y <= box.y + box.h + 1, "chớp nằm trong khung bao sản phẩm");
  assert.deepEqual(d.scenes[0].origin, { x: 540, y: 1056 }, "zoom hướng về giữa sản phẩm");
  const withClip = await fixture({ source: "gemini", withClip: true });
  assert.match(withClip.html, /<video id="ai-clip" class="clip" src="assets\/video\/clip-hook\.mp4" muted playsinline data-start="0" data-duration="[\d.]+" data-track-index="2">/);
  const dc = dataOf(withClip.html);
  assert.equal(dc.scenes[0].clipHook, true);
  assert.equal(dc.scenes[0].shots.every((s) => s.sparkles.length === 0), true);
  assert.equal((withClip.html.match(/class="full"/g) || []).length, 2, "cảnh mở đầu không còn ảnh tĩnh (video chiếm chỗ)");
});

test("CTA không có giá: không dựng ô giá; cảnh cận đá zoom bị kẹp theo độ phân giải ảnh nhỏ", async () => {
  const f = await fixture({ source: "pose", price: false });
  assert.doesNotMatch(f.html, /class="p"/);
  const m = dataOf(f.html).scenes.find((s) => s.kind === "macro");
  const maxZoom = Math.max(...m.shots.map((s) => s.zoom[1]));
  assert.ok(maxZoom < config.video.macro.maxZoom * config.video.kenBurns.zoom * 1.2);
  const g = await buildScenes({ project: { id: "p-xxxxxx-yyyy", form: FORM, script: { lines: LINES, specValues: {} }, scenes: f.scenes }, lines: LINES, timing: f.timing.timing, rootDuration: f.timing.ROOT_DURATION, assets: { products: {}, photos: {} }, locale: vi, clip: null, targetDir: f.target, config }).catch((e) => e);
  assert.match(String(g.message), /thiếu ảnh sản phẩm đã tách nền/);
});

test("cờ ai_generated: ảnh gemini/manual hoặc clip AI -> true; pose/cắt/sản phẩm gốc -> false", () => {
  const photo = (source, image = "x.png") => ({ id: "s1", kind: "photo", source, image });
  assert.equal(usesAiImages({ scenes: [photo("gemini")] }), true);
  assert.equal(usesAiImages({ scenes: [photo("manual")] }), true);
  assert.equal(usesAiImages({ scenes: [{ id: "s1", kind: "pose", source: "pose" }, { id: "s2", kind: "macro", source: "crop" }, { id: "s3", kind: "hero", source: "product" }] }), false);
  assert.equal(usesAiImages({ scenes: [{ id: "s1", kind: "pose" }], clip: { status: "ok" } }), true);
  assert.equal(usesAiImages({ scenes: [{ id: "s1", kind: "pose" }], clip: { status: "fallback" } }), false);
  assert.equal(usesAiImages({ scenes: [photo("gemini", null)] }), false, "chưa có ảnh thì không tính");
  assert.equal(usesAiImages({ scenes: [{ id: "s1", kind: "photo", source: "gemini", image: "a.png" }, { id: "s2", kind: "half", from: "s1" }] }), true);
  assert.equal(usesAiImages({ scenes: [{ id: "s1", kind: "hero", source: "product" }, { id: "s2", kind: "half", from: "s1" }] }), false);
});
