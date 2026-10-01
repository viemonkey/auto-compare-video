// M3: sửa từng dòng ở Bước 2 — viết lại theo ý tiếng Việt / dịch lại nghĩa (mock Gemini), chống race, cảnh báo dùng chung.
// Test kiểm tra CẤU TRÚC và QUY TẮC, không kiểm tra số lượng cụ thể của dữ liệu config.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLatestRunner, STALE } from "../public/shared/latest-request.mjs";
import { warningsForField, readingSeconds, LIMIT_KEY } from "../public/shared/field-warnings.mjs";
import { bilingual } from "../public/shared/bilingual.mjs";
import { listLocales, needsGloss, glossaryEntries } from "../scripts/lib/locales.mjs";
import { rulesOf } from "../scripts/lib/compare-content.mjs";

const all = listLocales();
const gloss = all.filter(needsGloss);
const viLocale = all.find((l) => !needsGloss(l));
const ja = gloss.find((l) => l.limits.unit === "grapheme") ?? gloss[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// chống race
// ---------------------------------------------------------------------------------------------
test("createLatestRunner: yêu cầu mới huỷ yêu cầu cũ; kết quả cũ trả STALE, không ghi đè kết quả mới", async () => {
  const runner = createLatestRunner();
  const aborted = [];
  const slow = runner.run(async (signal, id) => {
    signal.addEventListener("abort", () => aborted.push(id));
    await sleep(60);
    return "cũ"; // về trễ — kể cả khi fn không tự dừng khi bị abort
  });
  await sleep(5);
  assert.equal(runner.pending, true);
  const fast = runner.run(async () => {
    await sleep(5);
    return "mới";
  });
  assert.equal(await fast, "mới");
  assert.equal(await slow, STALE);
  assert.deepEqual(aborted, [1], "yêu cầu 1 bị abort khi yêu cầu 2 bắt đầu");
  assert.equal(runner.pending, false);
});

test("createLatestRunner: lỗi của yêu cầu đã bị thay thế bị nuốt; lỗi của yêu cầu mới nhất vẫn ném", async () => {
  const runner = createLatestRunner();
  const first = runner.run(async (signal) => {
    await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  });
  const second = runner.run(async () => {
    throw new Error("lỗi thật");
  });
  assert.equal(await first, STALE);
  await assert.rejects(second, /lỗi thật/);
  assert.equal(runner.pending, false);
});

test("createLatestRunner: cancel() huỷ yêu cầu đang chờ và bỏ kết quả", async () => {
  const runner = createLatestRunner();
  let signalSeen;
  const p = runner.run(async (signal) => {
    signalSeen = signal;
    await sleep(30);
    return "x";
  });
  await sleep(5);
  runner.cancel();
  assert.equal(signalSeen.aborted, true);
  assert.equal(await p, STALE);
  assert.equal(runner.pending, false);
  assert.equal(await runner.run(async () => "sau"), "sau", "dùng lại được sau cancel");
});

test("createLatestRunner: 3 yêu cầu liên tiếp -> chỉ kết quả cuối được dùng", async () => {
  const runner = createLatestRunner();
  const results = await Promise.all([1, 2, 3].map((n) => runner.run(async () => { await sleep(10 * (4 - n)); return n; })));
  assert.deepEqual(results, [STALE, STALE, 3]);
});

// ---------------------------------------------------------------------------------------------
// cảnh báo dùng chung (trình duyệt dùng cùng module với server)
// ---------------------------------------------------------------------------------------------
test("warningsForField nhận luật dạng dữ liệu thuần (rulesOf) — cùng kết quả với phía server", async () => {
  const rules = JSON.parse(JSON.stringify(rulesOf(ja))); // đúng dạng trình duyệt nhận qua JSON
  const long = "あ".repeat(ja.limits.point + 3);
  const w = warningsForField("text", bilingual(long, "dài"), rules);
  assert.ok(w.some((x) => x.code === "too-long" && x.limit === ja.limits.point && x.used === ja.limits.point + 3));
  const { warningsForField: serverSide } = await import("../scripts/lib/compare-content.mjs");
  assert.deepEqual(serverSide("text", bilingual(long, "dài"), ja), w);
  for (const kind of Object.keys(LIMIT_KEY)) assert.ok(typeof rules.limits[LIMIT_KEY[kind]] === "number", kind);
});

test("thời gian đọc ước tính theo readingRate và đơn vị của thị trường", () => {
  for (const l of all) {
    const rules = rulesOf(l);
    const sentence = l.limits.unit === "word" ? "one two three four five" : "あ".repeat(10);
    const n = l.limits.unit === "word" ? 5 : 10;
    assert.ok(Math.abs(readingSeconds(sentence, rules) - n / l.limits.readingRate) < 1e-9, l.code);
  }
  assert.equal(readingSeconds("", rulesOf(all[0])), 0);
});

test("glossary: mục mơ hồ/ngữ cảnh đi qua JSON tới trình duyệt nguyên vẹn", () => {
  const entries = JSON.parse(JSON.stringify(rulesOf(ja))).glossary;
  assert.deepEqual(entries, glossaryEntries(ja));
});

// ---------------------------------------------------------------------------------------------
// viết lại / dịch lại bằng Gemini (mock)
// ---------------------------------------------------------------------------------------------
async function withMockGemini(handler, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fe-"));
  const ledger = path.join(dir, "ledger.jsonl");
  process.env.COST_LEDGER_PATH = ledger;
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.GEMINI_MODEL = "gemini-test-model";
  delete process.env.GEMINI_FALLBACK_MODEL;
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, signal: init.signal });
    return handler(body, calls.length, init);
  };
  const rows = () => (fs.existsSync(ledger) ? fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map((x) => JSON.parse(x)) : []);
  try {
    return await fn({ calls, rows });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.COST_LEDGER_PATH;
    delete process.env.GEMINI_MODEL;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const okResponse = (obj) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }),
  text: async () => "",
});

test("rewriteField: chỉ 1 lần gọi; prompt có ý mới + styleGuide/glossary/limits của thị trường; kết quả {text, vi} + cảnh báo; ledger ghi locale", async () => {
  const { rewriteField } = await import("../scripts/lib/field-edit.mjs");
  await withMockGemini(
    () => okResponse({ text: "新しい文章です", vi: "Đây là câu mới" }),
    async ({ calls, rows }) => {
      const out = await rewriteField({
        locale: ja, kind: "text", idea: "Nhấn mạnh độ cứng của kim cương",
        current: { text: "古い文", vi: "Câu cũ" },
        context: { title: { text: "タイトル", vi: "Tiêu đề" }, label_left: { text: "ダイヤ", vi: "Kim cương" } },
        slug: "_pending-abc",
      });
      assert.deepEqual(out.field, { text: "新しい文章です", vi: "Đây là câu mới" });
      assert.ok(Array.isArray(out.warnings));
      assert.equal(calls.length, 1, "chỉ gọi cho đúng 1 dòng");
      const system = calls[0].body.systemInstruction.parts[0].text;
      const user = calls[0].body.contents[0].parts[0].text;
      assert.ok(system.includes(ja.prompt.language));
      assert.ok(system.includes(ja.styleGuide.trim()), "styleGuide");
      for (const { term } of glossaryEntries(ja)) assert.ok(system.includes(term), `glossary ${term}`);
      for (const p of ja.forbiddenPhrases) assert.ok(system.includes(p), `forbidden ${p}`);
      assert.ok(system.includes(`tối đa ${ja.limits.point} ký tự`), "giới hạn theo limits.point");
      assert.match(system, /SÁT NGHĨA/);
      assert.match(system, /CHÍNH câu "text" bạn vừa viết/, "vi là nghĩa của câu MỚI do AI viết");
      assert.ok(user.includes("Nhấn mạnh độ cứng của kim cương"), "ý mới của người dùng");
      assert.ok(user.includes("タイトル") && user.includes("ダイヤ"), "ngữ cảnh các dòng khác");
      assert.ok(user.split("Nội dung hiện tại")[0].includes("Câu hỏi mở đầu: タイトル (nghĩa: Tiêu đề)"), "ngữ cảnh có tiêu đề kèm nghĩa");
      const schema = calls[0].body.generationConfig.responseSchema;
      assert.equal(schema.properties.text.maxLength, ja.limits.point);
      assert.deepEqual(schema.required, ["text", "vi"]);
      assert.equal(calls[0].body.contents[0].parts.length, 1, "không gửi ảnh");
      const [row] = rows();
      assert.equal(row.locale, ja.code);
      assert.equal(row.task, "content-generation");
      assert.equal(row.subtask, "field-rewrite");
      assert.equal(row.slug, "_pending-abc");
    },
  );
});

test("rewriteField: kết quả vi phạm giới hạn/cụm cấm vẫn trả về kèm cảnh báo (không chặn); text rỗng -> retry", async () => {
  const { rewriteField } = await import("../scripts/lib/field-edit.mjs");
  const bad = "あ".repeat(ja.limits.tag + 2) + ja.forbiddenPhrases[0];
  await withMockGemini(
    () => okResponse({ text: bad, vi: "x" }),
    async () => {
      const out = await rewriteField({ locale: ja, kind: "tag", idea: "ý" });
      assert.equal(out.field.text, bad);
      const codes = out.warnings.map((w) => w.code);
      assert.ok(codes.includes("too-long") && codes.includes("forbidden-phrase"), codes.join());
    },
  );
  let n = 0;
  await withMockGemini(
    () => (++n === 1 ? okResponse({ text: "", vi: "" }) : okResponse({ text: "OK", vi: "Được" })),
    async ({ calls }) => {
      const out = await rewriteField({ locale: ja, kind: "label_left", idea: "ý" });
      assert.equal(out.field.text, "OK");
      assert.equal(calls.length, 2, "text rỗng bị coi là lỗi có thể retry");
    },
  );
});

test("rewriteField: 'sub' được phép rỗng; đầu vào sai -> FieldEditError, KHÔNG gọi Gemini", async () => {
  const { rewriteField, translateField, FieldEditError } = await import("../scripts/lib/field-edit.mjs");
  await withMockGemini(
    () => okResponse({ text: "", vi: "" }),
    async ({ calls }) => {
      const out = await rewriteField({ locale: ja, kind: "sub", idea: "bỏ dòng phụ" });
      assert.deepEqual(out.field, { text: "", vi: "" });
      const before = calls.length;
      await assert.rejects(rewriteField({ locale: ja, kind: "nope", idea: "x" }), FieldEditError);
      await assert.rejects(rewriteField({ locale: ja, kind: "text", idea: "   " }), FieldEditError);
      await assert.rejects(rewriteField({ locale: ja, kind: "text", idea: "x".repeat(5000) }), FieldEditError);
      await assert.rejects(rewriteField({ locale: viLocale, kind: "text", idea: "x" }), FieldEditError, "thị trường tiếng Việt không có dòng nghĩa");
      await assert.rejects(translateField({ locale: viLocale, kind: "text", text: "x" }), FieldEditError);
      assert.equal(calls.length, before, "không có lần gọi Gemini nào cho đầu vào sai");
    },
  );
});

test("translateField: chỉ dịch nghĩa cho dòng đó; dòng rỗng không gọi Gemini; cảnh báo glossary dựa trên nghĩa mới", async () => {
  const { translateField } = await import("../scripts/lib/field-edit.mjs");
  const term = glossaryEntries(ja).find((e) => e.concept === "kim cương").term;
  await withMockGemini(
    () => okResponse({ vi: "Kim cương rất cứng" }),
    async ({ calls, rows }) => {
      const out = await translateField({ locale: ja, kind: "text", text: "宝石は硬いです", slug: "_pending-z" });
      assert.equal(out.vi, "Kim cương rất cứng");
      assert.ok(out.warnings.some((w) => w.code === "glossary-term" && w.term === term), "chữ không dùng thuật ngữ chuẩn của 'kim cương'");
      assert.equal(calls.length, 1);
      const system = calls[0].body.systemInstruction.parts[0].text;
      assert.match(system, /SÁT NGHĨA/);
      assert.ok(system.includes(term), "glossary chữ đích -> khái niệm");
      assert.equal(calls[0].body.contents[0].parts[0].text, "宝石は硬いです");
      assert.equal(rows()[0].subtask, "field-translate");

      const empty = await translateField({ locale: ja, kind: "sub", text: "  " });
      assert.deepEqual(empty, { vi: "", warnings: [], model: null });
      assert.equal(calls.length, 1, "dòng rỗng không tốn lần gọi");
    },
  );
});

test("gọi Gemini: 503 -> retry rồi thành công; client huỷ (AbortSignal) -> dừng ngay, không retry, không ghi lỗi", async () => {
  const { translateField } = await import("../scripts/lib/field-edit.mjs");
  const { AbortedError } = await import("../scripts/lib/gemini-client.mjs");
  let n = 0;
  await withMockGemini(
    () => (++n === 1 ? { ok: false, status: 503, text: async () => '{"error":{"code":503,"status":"UNAVAILABLE"}}', json: async () => ({}) } : okResponse({ vi: "ok" })),
    async ({ calls, rows }) => {
      const out = await translateField({ locale: ja, kind: "title", text: "テスト" });
      assert.equal(out.vi, "ok");
      assert.equal(calls.length, 2);
      assert.deepEqual(rows().map((r) => r.status), ["error", "success"]);
    },
  );
  const controller = new AbortController();
  await withMockGemini(
    (_body, _n, init) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    async ({ calls, rows }) => {
      const p = translateField({ locale: ja, kind: "title", text: "テスト", signal: controller.signal });
      await sleep(10);
      controller.abort();
      await assert.rejects(p, (e) => e instanceof AbortedError);
      assert.equal(calls.length, 1, "bị huỷ thì không retry");
      assert.equal(rows().length, 0, "huỷ không phải lỗi Gemini — không ghi sổ lỗi");
    },
  );
});
