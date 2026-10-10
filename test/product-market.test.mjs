// Mốc 7: phiên bản thị trường khác dùng lại toàn bộ ảnh/cảnh đã duyệt; chỉ viết lại kịch bản + (lúc dựng) đọc giọng; KHÔNG gọi API ảnh/clip.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { createProductApi } from "../server-product.mjs";
import { assembleScript, writeScript } from "../scripts/lib/product/script.mjs";
import { getLocale } from "../scripts/lib/locales.mjs";
import { loadProductConfig } from "../scripts/lib/product/config.mjs";
import { normalizeForm } from "../scripts/lib/product/form.mjs";
import { tmpDir, makeRingPng, makeSolidPng } from "./helpers/product-fixtures.mjs";

const config = loadProductConfig();
const MIN_FRACTION = config.script.minTotalFraction;
config.script.minTotalFraction = 0; // kịch bản mẫu trong test ngắn; luật độ dài tối thiểu có test riêng bên dưới
const saved = {};
beforeEach(() => { for (const k of ["COST_LEDGER_PATH", "GEMINI_BILLING_ENABLED"]) saved[k] = process.env[k]; process.env.COST_LEDGER_PATH = path.join(tmpDir(), "l.jsonl"); delete process.env.GEMINI_BILLING_ENABLED; });
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const GOOD = {
  openers: [{ text: "Nhẫn này có gì lạ?", vi: "" }, { text: "Bạn thấy chưa?", vi: "" }, { text: "Ai cũng hỏi?", vi: "" }],
  lines: [{ beat: "specs", text: "Bạc 925, đá moissanite nhân tạo.", vi: "" }, { beat: "specs", text: "Vòng bánh răng xoay được.", vi: "" }, { beat: "wear", text: "Đeo lên tay rất nổi bật.", vi: "" }, { beat: "emotion", text: "Hợp để tặng người thương.", vi: "" }, { beat: "cta", text: "Nhắn tin để được tư vấn.", vi: "" }],
};
const analysis = { model: "m", kind: "ring", lock: {}, lockText: "A wide white metal ring with three rows of tiny round pave stones.", lockTextVi: "", images: [{ index: 0, bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, boxSource: "gemini", stoneBbox: null, view: "front", hasLogoOrText: false, note: "" }] };
const viScript = { openers: GOOD.openers, openerIndex: 0, lines: assembleScript(GOOD, 0), mismatches: [], specValues: {}, warnings: [], model: "ms" };
const PASS = { scores: { product: 9, face: 9, hands: 9, outfit: 9 }, reasons: {}, issues: {}, pass: true, failed: [], model: "m", notes: [], productBox: { x: 0.3, y: 0.4, w: 0.3, h: 0.15 } };

async function withApp(extra, fn) {
  const dataDir = tmpDir();
  const app = express();
  app.use(express.json());
  const calls = { image: 0, script: [] };
  const api = createProductApi({
    app, dataDir, hostRefsRoot: tmpDir(), log: { warn() {} },
    deps: {
      analyzeProduct: async () => analysis,
      writeScript: async (o) => { calls.script.push(o); return extra.script ? extra.script(o) : viScript; },
      scene: { generateImage: async () => { calls.image++; throw new Error("KHÔNG được gọi API ảnh"); }, checkSceneImage: async () => PASS },
    },
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base, api, calls); } finally { server.close(); }
}
const post = (base, url, body) => fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
async function approvedManualProject(base, api) {
  const fd = new FormData();
  fd.append("images", new Blob([fs.readFileSync(makeRingPng(path.join(tmpDir(), "r.png")))], { type: "image/png" }), "r.png");
  const up = await (await fetch(`${base}/api/product/upload`, { method: "POST", body: fd })).json();
  const p = await (await post(base, `/api/product/${up.id}/analyze`, { locale: "vi-VN", form: { type: "nhẫn", material: "bạc 925", mainStone: "moissanite", stoneOrigin: "lab" }, settings: { imageSource: "manual", aiClip: false } })).json();
  const png = fs.readFileSync(makeSolidPng(path.join(tmpDir(), "g.png"), { width: 720, height: 1280 }));
  for (const sc of p.scenes.filter((s) => s.kind === "photo")) await api.sceneService.adoptUpload({ projectId: p.id, sceneId: sc.id, buffer: png, ext: ".png" });
  return (await (await fetch(`${base}/api/product/${p.id}`)).json());
}

test("phiên bản thị trường: dự án MỚI dùng lại ảnh sản phẩm + ảnh cảnh + pose đã duyệt; kịch bản viết lại đúng cấu trúc beat; KHÔNG gọi API ảnh; derivedFrom", async () => {
  const jaScript = { ...viScript, openers: [{ text: "このリングの秘密は？", vi: "Bí mật của chiếc nhẫn này là gì?" }, { text: "回る指輪を見た？", vi: "Bạn đã thấy nhẫn xoay chưa?" }, { text: "なぜ話題？", vi: "Vì sao được bàn tán?" }], lines: assembleScript({ openers: [{ text: "このリングの秘密は？", vi: "Bí mật?" }], lines: GOOD.lines.map((l) => ({ ...l, text: `JA ${l.text}`, vi: l.text })) }, 0), specValues: { material: "シルバー925", origin: "人工石" } };
  await withApp({ script: () => jaScript }, async (base, api, calls) => {
    const src = await approvedManualProject(base, api);
    assert.deepEqual(src.blockers, []);
    assert.deepEqual(src.scenes.filter((s) => s.kind === "photo").map((s) => s.source), ["manual", "manual"]);
    const res = await post(base, `/api/product/${src.id}/market-version`, { locale: "ja-JP" });
    const v = await res.json();
    assert.equal(res.status, 200, JSON.stringify(v));
    assert.notEqual(v.id, src.id);
    assert.equal(v.derivedFrom, src.id);
    assert.equal(v.locale, "ja-JP");
    assert.equal(calls.image, 0, "không gọi API ảnh");
    // kịch bản: gọi với cấu trúc cố định + kịch bản gốc làm nguồn ý
    const call = calls.script.at(-1);
    assert.deepEqual(call.fixedBeats, ["specs", "specs", "wear", "emotion", "cta"]);
    assert.equal(call.sourceScript.length, src.script.lines.length);
    assert.equal(call.locale.code, "ja-JP");
    assert.equal(call.analysis.lockText, analysis.lockText, "mô tả khoá dùng lại, không phân tích lại ảnh");
    // cảnh + ảnh giữ nguyên
    assert.deepEqual(v.scenes.map((s) => [s.id, s.kind, s.source, s.pose, s.image]), src.scenes.map((s) => [s.id, s.kind, s.source, s.pose, s.image]));
    assert.deepEqual(v.blockers, [], "ảnh đã duyệt -> dựng được ngay");
    for (const s of v.scenes.filter((x) => x.image)) assert.equal((await fetch(`${base}/api/product/${v.id}/file/${s.image}`)).status, 200, "ảnh cảnh được chép sang dự án mới");
    assert.equal((await fetch(`${base}/api/product/${v.id}/file/product-1.png`)).status, 200);
    assert.equal(v.script.lines.length, src.script.lines.length);
    assert.deepEqual(v.script.lines.map((l) => l.beat), src.script.lines.map((l) => l.beat));
    assert.equal(v.script.specValues.material, "シルバー925");
    assert.equal(v.script.lines[0].vi, "Bí mật?", "thị trường ngoài tiếng Việt có nghĩa tiếng Việt");
    assert.ok(v.settings.notes.some((n) => /không gọi lại API ảnh/.test(n)));
    // ledger của dự án mới không có dòng ảnh/clip
    const ledger = fs.existsSync(process.env.COST_LEDGER_PATH) ? fs.readFileSync(process.env.COST_LEDGER_PATH, "utf8") : "";
    assert.ok(!ledger.split("\n").filter(Boolean).map((l) => JSON.parse(l)).some((r) => r.slug === v.ledgerSlug && (r.task === "product-image" || r.task === "product-clip")));
    // dự án nguồn không đổi
    const again = await (await fetch(`${base}/api/product/${src.id}`)).json();
    assert.equal(again.locale, "vi-VN");
    assert.equal(again.script.lines[1].text, src.script.lines[1].text);
  });
});

test("phiên bản thị trường: từ chối cùng thị trường / thị trường lạ / cảnh nguồn chưa duyệt; lỗi Gemini không để lại dự án rác", async () => {
  await withApp({}, async (base, api) => {
    const src = await approvedManualProject(base, api);
    assert.equal((await post(base, `/api/product/${src.id}/market-version`, { locale: "vi-VN" })).status, 400);
    assert.equal((await post(base, `/api/product/${src.id}/market-version`, { locale: "xx-XX" })).status, 400);
    const fd = new FormData();
    fd.append("images", new Blob([fs.readFileSync(makeRingPng(path.join(tmpDir(), "r2.png")))], { type: "image/png" }), "r.png");
    const up = await (await fetch(`${base}/api/product/upload`, { method: "POST", body: fd })).json();
    const pending = await (await post(base, `/api/product/${up.id}/analyze`, { locale: "vi-VN", form: { type: "nhẫn", material: "bạc" }, settings: { imageSource: "manual" } })).json();
    assert.ok(pending.blockers.length > 0);
    const r = await post(base, `/api/product/${pending.id}/market-version`, { locale: "en-US" });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /chưa duyệt/);
  });
  const boom = Object.assign(new Error("x"), { userMessage: "Gemini đang quá tải." });
  await withApp({ script: (o) => { if (o.fixedBeats) throw boom; return viScript; } }, async (base, api) => {
    const src = await approvedManualProject(base, api);
    const before = api.store.list().length;
    const r = await post(base, `/api/product/${src.id}/market-version`, { locale: "en-US" });
    assert.equal(r.status, 502);
    assert.equal(api.store.list().length, before, "không để lại dự án nửa vời");
  });
});

test("viết kịch bản với cấu trúc cố định: đúng số câu + beat, kịch bản gốc đi vào prompt; lệch cấu trúc bị yêu cầu viết lại", async () => {
  const analysis2 = { kind: "ring", lock: {}, lockText: "A ring." };
  const form = normalizeForm({ type: "nhẫn", material: "bạc 925", mainStone: "moissanite", stoneOrigin: "moissanite" }, config);
  const en = getLocale("en-US");
  const ok = { openers: [{ text: "What makes this ring special?", vi: "Điều gì làm nhẫn này đặc biệt?" }, { text: "Ever seen a ring like this?", vi: "Bạn từng thấy nhẫn thế này?" }, { text: "Why is everyone asking?", vi: "Vì sao ai cũng hỏi?" }], lines: ["specs", "wear", "emotion", "cta"].map((beat, i) => ({ beat, text: i === 0 ? "925 silver with a lab-made moissanite." : ["Looks great on the hand.", "A thoughtful gift.", "Message us today!"][i - 1], vi: i === 0 ? "Bạc 925 với đá moissanite nhân tạo." : ["Đeo lên tay rất đẹp.", "Món quà ý nghĩa.", "Nhắn tin ngay hôm nay!"][i - 1] })), mismatches: [], spec_values: { material: "925 silver", origin: "Moissanite", type: "ring" } };
  const calls = [];
  const gen = async (args) => { calls.push(args); return { result: calls.length === 1 ? { ...ok, lines: [...ok.lines.slice(0, 3)] } : ok, model: "m" }; };
  const out = await writeScript({ form, analysis: analysis2, locale: en, ledgerSlug: "s", generate: gen, config, env: {}, fixedBeats: ["specs", "wear", "emotion", "cta"], sourceScript: [{ beat: "hook", text: "Nhẫn này có gì lạ?" }, { beat: "specs", text: "Bạc 925, đá moissanite nhân tạo." }] });
  assert.equal(calls.length, 2, "lần 1 thiếu câu -> viết lại");
  assert.match(calls[0].userText, /KỊCH BẢN GỐC ĐÃ DUYỆT/);
  assert.match(calls[0].userText, /1\. \[hook\] Nhẫn này có gì lạ\?/);
  assert.match(calls[0].systemPrompt, /CẤU TRÚC CỐ ĐỊNH/);
  assert.match(calls[0].systemPrompt, /specs, wear, emotion, cta/);
  assert.match(calls[1].userText, /Phải đúng 4 câu/);
  assert.deepEqual(out.lines.map((l) => l.beat), ["hook", "specs", "wear", "emotion", "cta"]);
  assert.equal(out.specValues.material, "925 silver");
  assert.equal(out.specValues.carat, "", "form không có carat -> không có");
  const free = await writeScript({ form, analysis: analysis2, locale: getLocale("vi-VN"), ledgerSlug: "s", generate: async (a) => ({ result: { ...ok, openers: GOOD.openers, lines: GOOD.lines.map((l) => ({ ...l, text: l.text.replace("Bạc 925, đá moissanite nhân tạo.", "Bạc 925, đá moissanite nhân tạo.") })), spec_values: {} }, model: "m" }), config, env: {} });
  assert.doesNotMatch(free.lines.map((l) => l.text).join(""), /KỊCH BẢN GỐC/);
});
