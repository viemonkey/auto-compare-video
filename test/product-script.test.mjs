// Mốc 2: phân tích sản phẩm (mô tả khoá + khung bao) và kịch bản 5–6 câu — mock, không gọi Gemini thật.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { loadProductConfig } from "../scripts/lib/product/config.mjs";
import { analyzeProduct, reconcileBox, iou, analysisSchema } from "../scripts/lib/product/analyze.mjs";
import { writeScript, validateScriptRules, assembleScript, readingEstimate, formLinesForPrompt, scriptSchema } from "../scripts/lib/product/script.mjs";
import { normalizeForm } from "../scripts/lib/product/form.mjs";
import { getLocale } from "../scripts/lib/locales.mjs";
import { generateJson } from "../scripts/lib/gemini-client.mjs";
import { createProductApi } from "../server-product.mjs";
import { tmpDir, makeRingPng, textResponse } from "./helpers/product-fixtures.mjs";

const config = loadProductConfig();
const MIN_FRACTION = config.script.minTotalFraction;
config.script.minTotalFraction = 0; // kịch bản mẫu trong test ngắn; luật độ dài tối thiểu có test riêng bên dưới
const vi = getLocale("vi-VN");
const ja = getLocale("ja-JP");
const FORM = normalizeForm({ type: "nhẫn", material: "bạc 925", metalColor: "trắng", mainStone: "đá moissanite", stoneOrigin: "lab", feature: "vòng bánh răng xoay được" }, config);
const LOCK = { kind: "ring", lock: { metalColor: "bright white", stoneRows: 3 }, lockText: "A wide white-metal ring with three rows of small round pave stones and a gear-like band around the body of the ring." };
const GOOD = {
  openers: [{ text: "Nhẫn bạc này có gì mà ai cũng tò mò?", vi: "" }, { text: "Bạn đã thấy nhẫn xoay được chưa?", vi: "" }, { text: "Chiếc nhẫn nào vừa đẹp vừa độc lạ?", vi: "" }],
  lines: [
    { beat: "specs", text: "Làm từ bạc 925, đính đá moissanite nhân tạo.", vi: "" },
    { beat: "specs", text: "Điểm đặc biệt là vòng bánh răng xoay được.", vi: "" },
    { beat: "wear", text: "Đeo lên tay trông cá tính và nổi bật.", vi: "" },
    { beat: "emotion", text: "Hợp để tự thưởng hoặc tặng người thương.", vi: "" },
    { beat: "cta", text: "Nhắn tin để HuyK tư vấn nhé!", vi: "" },
  ],
  mismatches: [],
};
const asGen = (...results) => {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    const result = results[Math.min(calls.length - 1, results.length - 1)];
    return { result: typeof result === "function" ? result(args) : result, model: "mock-model" };
  };
  fn.calls = calls;
  return fn;
};

test("khung bao: ưu tiên khung Gemini; lệch hẳn khung đo bằng điểm ảnh hoặc không hợp lệ thì dùng khung đo; kẹp về 0–1", () => {
  const detected = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
  assert.deepEqual(reconcileBox({ x: 0.31, y: 0.3, w: 0.4, h: 0.4 }, detected), { box: { x: 0.31, y: 0.3, w: 0.4, h: 0.4 }, source: "gemini" });
  assert.equal(reconcileBox({ x: 0.0, y: 0.0, w: 0.1, h: 0.1 }, detected).source, "detected");
  assert.equal(reconcileBox({ x: 0.5, y: 0.5, w: 0, h: 0 }, detected).source, "detected");
  assert.equal(reconcileBox(null, null).source, "none");
  const clamped = reconcileBox({ x: 0.8, y: 0.8, w: 0.9, h: 0.9 }, null);
  assert.ok(clamped.box.x + clamped.box.w <= 1 && clamped.box.y + clamped.box.h <= 1);
  assert.ok(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 0.5, h: 1 }) === 0.5);
});

test("phân tích: gửi đủ ảnh, prompt KHÔNG chứa thông số form, lưu mô tả khoá + khung bao + model + chi phí gắn đúng slug", async () => {
  const dir = tmpDir();
  const a = makeRingPng(path.join(dir, "a.png"));
  const b = makeRingPng(path.join(dir, "b.png"), { box: [60, 60, 180, 180] });
  const gen = asGen({
    product_kind: "ring", metal_color: "bright white", item_style: "wide band", stone_rows: 3, stone_shape: "round", stone_size_relative: "tiny pave", setting_style: "pave", patterns_and_details: "gear motif", moving_parts: "",
    lock_text_en: "A wide bright white metal ring with three parallel rows of small round pave set stones and a gear shaped decorative band around the body of the ring with raised studs.",
    lock_text_vi: "Nhẫn bản to màu trắng sáng.",
    images: [
      { index: 0, bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, stone_bbox: { x: 0.35, y: 0.35, w: 0.1, h: 0.1 }, view: "front", has_logo_or_text: false, note: "" },
      { index: 1, bbox: { x: 0, y: 0, w: 0.05, h: 0.05 }, stone_bbox: null, view: "side", has_logo_or_text: true, note: "có chữ" },
    ],
  });
  const out = await analyzeProduct({ imageFiles: [a, b], ledgerSlug: "_pending-x", locale: "vi-VN", generate: gen, config, env: {} });
  const call = gen.calls[0];
  assert.equal(call.images.length, 2);
  assert.equal(call.images[0].mimeType, "image/jpeg");
  assert.ok(call.images[0].data.length > 100);
  assert.deepEqual(call.ledger, { task: "content-generation", subtask: "product-analysis", slug: "_pending-x", locale: "vi-VN" });
  assert.doesNotMatch(call.systemPrompt + call.userText, /bạc 925|moissanite|thông số form/i, "mô tả khoá chỉ do ảnh");
  assert.match(call.systemPrompt, /2 ảnh/);
  assert.equal(out.kind, "ring");
  assert.match(out.lockText, /three parallel rows/);
  assert.equal(out.images[0].boxSource, "gemini");
  assert.equal(out.images[1].boxSource, "detected", "khung Gemini lệch -> dùng khung đo");
  assert.ok(Math.abs(out.images[1].bbox.w - 0.6) < 0.05);
  assert.equal(out.images[1].hasLogoOrText, true);
  assert.equal(out.model, "mock-model");
  assert.equal(call.schema, analysisSchema);
});

test("phân tích: mô tả quá ngắn / thiếu khung bao bị yêu cầu làm lại (validate ném RetryableError)", async () => {
  const dir = tmpDir();
  const a = makeRingPng(path.join(dir, "a.png"));
  let validate;
  const gen = async (args) => { validate = args.validate; return { result: {}, model: "m" }; };
  await analyzeProduct({ imageFiles: [a], ledgerSlug: "s", generate: async (args) => { validate = args.validate; throw new Error("stop"); }, config, env: {} }).catch(() => {});
  assert.throws(() => validate({ lock_text_en: "too short", images: [{}] }), /quá ngắn/);
  assert.throws(() => validate({ lock_text_en: "word ".repeat(30), images: [] }), /Thiếu khung bao/);
  assert.ok(validate({ lock_text_en: "word ".repeat(30), images: [{}] }));
  void gen;
});

test("generateJson gửi ảnh dưới dạng inlineData + dùng model riêng (models) + timeout riêng", async () => {
  const real = globalThis.fetch;
  const savedKey = process.env.GEMINI_API_KEY;
  const savedLedger = process.env.COST_LEDGER_PATH;
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.COST_LEDGER_PATH = path.join(tmpDir(), "l.jsonl");
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), body: JSON.parse(init.body) }; return textResponse({ ok: 1 }); };
  try {
    const out = await generateJson({ systemPrompt: "s", userText: "u", schema: { type: "object" }, images: [{ mimeType: "image/jpeg", data: "AAAA" }, { mimeType: "image/png", data: "BBBB" }], models: { primary: "m-check", fallback: "" }, ledger: { task: "content-generation", subtask: "product-check", slug: "s1" } });
    assert.deepEqual(out.result, { ok: 1 });
    assert.match(seen.url, /models\/m-check:generateContent/);
    const parts = seen.body.contents[0].parts;
    assert.equal(parts[0].text, "u");
    assert.deepEqual(parts.slice(1).map((p) => p.inlineData.mimeType), ["image/jpeg", "image/png"]);
    const rows = fs.readFileSync(process.env.COST_LEDGER_PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows[0].slug, "s1");
    assert.equal(rows[0].subtask, "product-check");
  } finally {
    globalThis.fetch = real;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    if (savedLedger === undefined) delete process.env.COST_LEDGER_PATH; else process.env.COST_LEDGER_PATH = savedLedger;
  }
});

test("luật kịch bản: kịch bản mẫu đạt; số bịa / 'thiên nhiên' / thiếu nói rõ nhân tạo / tên đá không có trong form / cụm cấm đều bị bắt", () => {
  const ok = assembleScript(GOOD, 0);
  assert.deepEqual(validateScriptRules({ lines: ok }, { form: FORM, locale: vi, config }), []);
  const bad = (mutate) => {
    const copy = JSON.parse(JSON.stringify(GOOD));
    mutate(copy);
    return validateScriptRules({ lines: assembleScript(copy, 0) }, { form: FORM, locale: vi, config });
  };
  assert.ok(bad((g) => { g.lines[0].text = "Bạc 925 với viên đá 2 carat."; }).some((i) => /số "2"/.test(i)), "số carat không có trong form");
  assert.ok(bad((g) => { g.lines[0].text = "Bạc 925, đá moissanite thiên nhiên."; }).some((i) => /thiên nhiên/.test(i)));
  assert.ok(bad((g) => { g.lines[0].text = "Làm từ bạc 925, đính đá moissanite."; }).some((i) => /nói rõ/.test(i)), "form ghi nhân tạo mà không nói rõ");
  assert.ok(bad((g) => { g.lines[1].text = "Đá lấp lánh như kim cương thật."; }).some((i) => /kim cương/.test(i)));
  assert.ok(bad((g) => { g.lines[2].text = "Có ba hàng đá lấp lánh."; }).some((i) => /ba hàng/.test(i)));
  assert.ok(bad((g) => { g.lines[2].text = "Mang lại may mắn cho bạn."; }).some((i) => /cấm/.test(i)));
  assert.ok(bad((g) => { g.lines.pop(); g.lines.pop(); }).length > 0, "thiếu câu / thiếu CTA");
  assert.ok(bad((g) => { g.lines[0].text = "x".repeat(200); }).some((i) => /quá dài/.test(i)));
});

test("luật kịch bản: form chưa xác nhận nguồn gốc thì cấm 'thiên nhiên'; form 'thiên nhiên' thì được nói; số lấy từ form (925, giá) hợp lệ", () => {
  const none = normalizeForm({ type: "nhẫn", material: "bạc 925", mainStone: "moissanite" }, config);
  const withNatural = normalizeForm({ type: "nhẫn", material: "vàng 18K", mainStone: "kim cương", stoneOrigin: "natural", price: "12.500.000đ" }, config);
  const lines = (text) => assembleScript({ openers: [{ text: "Bạn thấy nhẫn này chưa?", vi: "" }], lines: [{ beat: "specs", text, vi: "" }, { beat: "wear", text: "Đeo lên rất sang.", vi: "" }, { beat: "emotion", text: "Hợp làm quà tặng.", vi: "" }, { beat: "cta", text: "Nhắn tin để được tư vấn.", vi: "" }] }, 0);
  assert.ok(validateScriptRules({ lines: lines("Đá moissanite thiên nhiên cực đẹp.") }, { form: none, locale: vi, config }).some((i) => /thiên nhiên/.test(i)));
  assert.deepEqual(validateScriptRules({ lines: lines("Bạc 925, đá moissanite sáng.") }, { form: none, locale: vi, config }), []);
  assert.deepEqual(validateScriptRules({ lines: lines("Vàng 18K, kim cương thiên nhiên, giá 12.500.000đ.") }, { form: withNatural, locale: vi, config }), []);
  assert.ok(validateScriptRules({ lines: lines("Vàng 18K, kim cương, giá 9.900.000đ.") }, { form: withNatural, locale: vi, config }).some((i) => /số "9900000"/.test(i)));
});

test("luật kịch bản thị trường ngoài tiếng Việt: kiểm thuật ngữ trên nghĩa tiếng Việt (vi), bắt buộc có nghĩa vi", () => {
  const mk = (viText) => assembleScript({ openers: [{ text: "このリングの秘密は？", vi: "Bí mật của chiếc nhẫn này là gì?" }], lines: [{ beat: "specs", text: "925シルバー、モアサナイト（人工石）。", vi: viText }, { beat: "wear", text: "着けると上品です。", vi: "Đeo lên rất thanh lịch." }, { beat: "emotion", text: "贈り物にも。", vi: "Cũng hợp làm quà." }, { beat: "cta", text: "メッセージで相談を。", vi: "Nhắn tin để được tư vấn." }] }, 0);
  const form = normalizeForm({ type: "nhẫn", material: "bạc 925", mainStone: "moissanite", stoneOrigin: "moissanite" }, config);
  assert.deepEqual(validateScriptRules({ lines: mk("Bạc 925, đá moissanite nhân tạo.") }, { form, locale: ja, config }), []);
  assert.ok(validateScriptRules({ lines: mk("Bạc 925, kim cương thiên nhiên.") }, { form, locale: ja, config }).length > 0);
  assert.ok(validateScriptRules({ lines: mk("") }, { form, locale: ja, config }).some((i) => /thiếu nghĩa tiếng Việt/.test(i)));
});

test("viết kịch bản: lần 1 bịa số -> lần 2 kèm phản hồi lỗi -> đạt; ghi slug sổ + 3 câu mở đầu + beat đúng thứ tự", async () => {
  const analysis = { kind: "ring", lock: LOCK.lock, lockText: LOCK.lockText };
  const badOnce = JSON.parse(JSON.stringify(GOOD));
  badOnce.lines[0].text = "Bạc 925 đính đá moissanite nhân tạo 2 carat.";
  const gen = asGen(badOnce, GOOD);
  const out = await writeScript({ form: FORM, analysis, locale: vi, ledgerSlug: "_pending-y", generate: gen, config, env: {} });
  assert.equal(gen.calls.length, 2);
  assert.match(gen.calls[1].userText, /LẦN VIẾT TRƯỚC BỊ LOẠI/);
  assert.match(gen.calls[1].userText, /số "2"/);
  assert.equal(out.attempts, 2);
  assert.equal(out.openers.length, 3);
  assert.deepEqual(out.lines.map((l) => l.beat), ["hook", "specs", "specs", "wear", "emotion", "cta"]);
  assert.deepEqual(out.lines.map((l) => l.n), [1, 2, 3, 4, 5, 6]);
  assert.equal(gen.calls[0].ledger.slug, "_pending-y");
  assert.equal(gen.calls[0].ledger.subtask, "product-script");
  // prompt: mô tả khoá + dòng form + luật nguồn gốc "nhân tạo" + trần ký tự đều nằm trong prompt
  assert.match(gen.calls[0].userText, /three rows of small round pave/);
  assert.match(gen.calls[0].userText, /Chất liệu: bạc 925/);
  assert.match(gen.calls[0].systemPrompt, /NHÂN TẠO \(lab-grown\)/);
  assert.match(gen.calls[0].systemPrompt, /Form không có giá: KHÔNG nhắc giá/);
  assert.match(gen.calls[0].systemPrompt, /tối đa 58 ký tự/);
  assert.doesNotMatch(gen.calls[0].systemPrompt + gen.calls[0].userText, /\{\{|undefined/);
});

test("viết kịch bản: không đạt sau số lần cho phép -> lỗi tiếng Việt có lý do; mọi phương án mở đầu đều phải đạt luật", async () => {
  const analysis = { kind: "ring", lock: LOCK.lock, lockText: LOCK.lockText };
  const bad = JSON.parse(JSON.stringify(GOOD));
  bad.lines[2].text = "Có 5 viên đá.";
  const gen = asGen(bad);
  await assert.rejects(() => writeScript({ form: FORM, analysis, locale: vi, ledgerSlug: "s", generate: gen, config, env: {} }), (e) => /đúng luật/.test(e.userMessage) && /số "5"/.test(e.userMessage));
  assert.equal(gen.calls.length, config.script.maxAttempts);
  const badOpener = JSON.parse(JSON.stringify(GOOD));
  badOpener.openers[2].text = "Nhẫn kim cương thiên nhiên này giá bao nhiêu?";
  const gen2 = asGen(badOpener, GOOD);
  const out = await writeScript({ form: FORM, analysis, locale: vi, ledgerSlug: "s", generate: gen2, config, env: {} });
  assert.equal(out.attempts, 2, "phương án mở đầu thứ 3 vi phạm -> phải viết lại");
});

test("kịch bản: ước tính thời lượng đọc cảnh báo ngoài 15–20 giây; form lines chỉ gồm field có giá trị; schema đủ beat", () => {
  const long = Array.from({ length: 6 }, (_, i) => ({ n: i + 1, beat: "specs", text: "x".repeat(70), vi: "" }));
  assert.ok(readingEstimate(long, vi, config).warnings.some((w) => /dài/.test(w)));
  const short = [{ n: 1, beat: "hook", text: "abc", vi: "" }];
  assert.ok(readingEstimate(short, vi, config).warnings.some((w) => /ngắn/.test(w)));
  assert.equal(formLinesForPrompt(FORM, config).split("\n").length, 6);
  assert.ok(!/carat|Giá/i.test(formLinesForPrompt(FORM, config)));
  assert.deepEqual(scriptSchema({ locale: vi, config }).properties.lines.items.properties.beat.enum, ["specs", "wear", "emotion", "cta"]);
});

async function withApp(deps, fn) {
  const dataDir = tmpDir();
  const app = express();
  app.use(express.json());
  const api = createProductApi({ app, dataDir, hostRefsRoot: tmpDir(), log: { warn() {} }, deps });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, api);
  } finally {
    server.close();
  }
}
const upload = async (base) => {
  const png = makeRingPng(path.join(tmpDir(), "r.png"));
  const fd = new FormData();
  fd.append("images", new Blob([fs.readFileSync(png)], { type: "image/png" }), "r.png");
  return (await fetch(`${base}/api/product/upload`, { method: "POST", body: fd })).json();
};
const post = (base, url, body, method = "POST") => fetch(`${base}${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("API analyze: lưu phân tích + kịch bản; Tự động bị hạ về pose khi chưa có billing; loại món lạ -> pose; clip AI tắt kèm ghi chú", async () => {
  const fakeAnalysis = { model: "m", kind: "ring", lock: LOCK.lock, lockText: LOCK.lockText, lockTextVi: "", images: [{ index: 0, bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, boxSource: "gemini", stoneBbox: null, view: "front", hasLogoOrText: false, note: "" }] };
  const fakeScript = { openers: GOOD.openers, openerIndex: 0, lines: assembleScript(GOOD, 0), mismatches: [{ field: "metalColor", formValue: "vàng", observed: "trắng", message: "Form ghi vàng nhưng ảnh là kim loại trắng." }], warnings: [], model: "ms" };
  await withApp({ analyzeProduct: async () => fakeAnalysis, writeScript: async () => fakeScript }, async (base) => {
    const project = await upload(base);
    const res = await post(base, `/api/product/${project.id}/analyze`, { locale: "vi-VN", form: { type: "nhẫn", material: "bạc 925", stoneOrigin: "lab" }, settings: { imageSource: "gemini", aiClip: true, tts: { engine: "edge", voice: "x" } } });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.equal(out.status, "scripted");
    assert.equal(out.settings.imageSource, "pose", "chưa bật billing -> pose");
    assert.equal(out.settings.aiClip, false);
    assert.ok(out.settings.notes.some((n) => /billing/.test(n)));
    assert.equal(out.script.lines.length, 6);
    assert.equal(out.script.mismatches[0].field, "metalColor");
    assert.equal(out.analysis.images[0].bbox.w, 0.4);
    assert.equal(out.displayName, "nhẫn bạc 925");
    assert.ok(!/\/tmp\/|\/var\/folders\//.test(JSON.stringify(out)), "không lộ đường dẫn tuyệt đối");

    const r2 = await (await post(base, `/api/product/${project.id}/analyze`, { locale: "vi-VN", form: { type: "vòng tay", material: "bạc" }, settings: { imageSource: "manual" } })).json();
    assert.equal(r2.settings.imageSource, "pose");
    assert.ok(r2.settings.notes.some((n) => /Chưa có mẫu cảnh AI/.test(n)));
    const r3 = await post(base, `/api/product/${project.id}/analyze`, { locale: "vi-VN", form: { type: "nhẫn" } });
    assert.equal(r3.status, 400);
    const r4 = await post(base, `/api/product/${project.id}/analyze`, { locale: "xx-XX", form: { type: "nhẫn", material: "bạc" } });
    assert.equal(r4.status, 400);
  });
});

test("API analyze: lỗi Gemini trả thông báo tiếng Việt (userMessage), không lộ chi tiết; PUT script đổi câu mở đầu, sửa câu và báo luật", async () => {
  await withApp({ analyzeProduct: async () => { const e = new Error("raw 500"); e.userMessage = "Gemini đang quá tải."; throw e; }, writeScript: async () => { throw new Error("x"); } }, async (base) => {
    const project = await upload(base);
    const res = await post(base, `/api/product/${project.id}/analyze`, { locale: "vi-VN", form: { type: "nhẫn", material: "bạc 925" } });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "Gemini đang quá tải.");
  });
  const fakeAnalysis = { model: "m", kind: "ring", lock: LOCK.lock, lockText: LOCK.lockText, lockTextVi: "", images: [] };
  const fakeScript = { openers: GOOD.openers, openerIndex: 0, lines: assembleScript(GOOD, 0), mismatches: [], warnings: [], model: "ms" };
  await withApp({ analyzeProduct: async () => fakeAnalysis, writeScript: async () => fakeScript }, async (base) => {
    const project = await upload(base);
    await post(base, `/api/product/${project.id}/analyze`, { locale: "vi-VN", form: { type: "nhẫn", material: "bạc 925", mainStone: "đá moissanite", stoneOrigin: "lab" } });
    const changed = await (await post(base, `/api/product/${project.id}/script`, { openerIndex: 1, lines: [{}, { text: "Đá 3 carat siêu sáng." }] }, "PUT")).json();
    assert.equal(changed.script.openerIndex, 1);
    assert.equal(changed.script.lines[0].text, GOOD.openers[1].text, "câu 1 = phương án mở đầu đã chọn");
    assert.equal(changed.script.lines[1].text, "Đá 3 carat siêu sáng.");
    assert.ok(changed.script.rulesIssues.some((i) => /số "3"/.test(i)), "người dùng được sửa nhưng bị cảnh báo");
    const noScript = await (await fetch(`${base}/api/product/p-khongco-1234/budget`)).status;
    assert.equal(noScript, 404);
  });
});

test("độ dài: kịch bản quá ngắn (video dưới 15 giây) bị yêu cầu viết lại; đủ dài thì đạt; prompt nêu cả tối thiểu lẫn tối đa; số viết bằng chữ số", async () => {
  config.script.minTotalFraction = MIN_FRACTION;
  try {
    const tiny = JSON.parse(JSON.stringify(GOOD));
    tiny.lines = tiny.lines.map((l) => ({ ...l, text: "Rất đẹp." }));
    const short = validateScriptRules({ lines: assembleScript(tiny, 0) }, { form: FORM, locale: vi, config });
    assert.ok(short.some((i) => /quá ngắn/.test(i)), short.join(" | "));
    const long = JSON.parse(JSON.stringify(GOOD));
    long.lines = long.lines.map((l) => ({ ...l, text: `${l.text} Rất đẹp.` }));
    assert.deepEqual(validateScriptRules({ lines: assembleScript(long, 0) }, { form: FORM, locale: vi, config }).filter((i) => /quá (ngắn|dài)/.test(i)), []);
    const gen = asGen(tiny, long);
    const out = await writeScript({ form: FORM, analysis: { kind: "ring", lock: LOCK.lock, lockText: LOCK.lockText }, locale: vi, ledgerSlug: "s", generate: gen, config, env: {} });
    assert.equal(out.attempts, 2);
    assert.match(gen.calls[0].systemPrompt, /tối thiểu \d+ và tối đa \d+ ký tự/);
    assert.match(gen.calls[0].systemPrompt, /CHỮ SỐ/);
    assert.match(gen.calls[1].userText, /quá ngắn/);
  } finally {
    config.script.minTotalFraction = 0;
  }
});

test("thị trường ngoài tiếng Việt: spec_values còn chữ tiếng Việt (chưa dịch) bị yêu cầu viết lại; đã dịch thì đạt", async () => {
  const { untranslatedSpecValues } = await import("../scripts/lib/product/script.mjs");
  const form = normalizeForm({ type: "nhẫn", material: "bạc 925", mainStone: "đá moissanite", stoneOrigin: "lab", feature: "vòng bánh răng xoay được" }, config);
  assert.deepEqual(untranslatedSpecValues({ type: "リング", material: "シルバー925", mainStone: "モアサナイト", feature: "回る歯車", origin: "人工石" }, form), []);
  assert.deepEqual(untranslatedSpecValues({ type: "リング", material: "bạc 925", mainStone: "", feature: "回る歯車", origin: "Nhân tạo" }, form).sort(), ["mainStone", "material", "origin"]);
  const ja = getLocale("ja-JP");
  const jaLines = (t) => ({ openers: [{ text: "このリングの秘密は？", vi: "Bí mật?" }, { text: "回る指輪を見た？", vi: "Thấy chưa?" }, { text: "なぜ話題？", vi: "Vì sao?" }], lines: ["specs", "wear", "emotion", "cta"].map((beat) => ({ beat, text: t, vi: "Nhẫn bạc 925 nhân tạo moissanite" })), mismatches: [] });
  const bad = { ...jaLines("シルバー925の指輪です。モアサナイト（人工石）を使っています。"), spec_values: { type: "nhẫn", material: "bạc 925", metalColor: "", mainStone: "đá moissanite", carat: "", cut: "", sideStones: "", feature: "vòng bánh răng xoay được", origin: "Nhân tạo" } };
  const good = { ...bad, spec_values: { type: "リング", material: "シルバー925", metalColor: "", mainStone: "モアサナイト", carat: "", cut: "", sideStones: "", feature: "回る歯車", origin: "人工石" } };
  const gen = asGen(bad, good);
  const loose = { ...config, script: { ...config.script, minTotalFraction: 0, claimTerms: [] } };
  const out = await writeScript({ form, analysis: { kind: "ring", lock: {}, lockText: LOCK.lockText }, locale: ja, ledgerSlug: "s", generate: gen, config: loose, env: {} });
  assert.equal(out.attempts, 2);
  assert.match(gen.calls[1].userText, /spec_values chưa dịch/);
  assert.equal(out.specValues.material, "シルバー925");
  assert.match(gen.calls[0].systemPrompt, /spec_values/);
});
