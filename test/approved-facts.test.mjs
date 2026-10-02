// Tạo phiên bản thị trường: dữ kiện ĐÃ DUYỆT của bản gốc là sự thật cố định, Gemini không được nhận dạng lại ảnh / đổi đối tượng.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listLocales, needsGloss, getDefaultLocale } from "../scripts/lib/locales.mjs";
import { buildApprovedFacts, checkAgainstApprovedFacts, labelMeaningMatches } from "../scripts/lib/approved-facts.mjs";
import { buildComparePrompt } from "../scripts/lib/compare-prompt.mjs";
import { loadHashtagConfig } from "../scripts/lib/hashtags.mjs";

const target = listLocales().find((l) => needsGloss(l));
const g = (text, vi) => ({ text, vi });

// Bản gốc tiếng Việt: field phẳng (chính chữ là tiếng Việt).
const viRecord = {
  title: "Aquamarine hay Sapphire?",
  label_left: "Aquamarine",
  label_right: "Sapphire",
  materials: ["Aquamarine", "Sapphire"],
  points: [
    { text: "Aquamarine thuộc họ Beryl.", side: "left", tag: "Họ Beryl" },
    { text: "Sapphire thuộc họ Corundum.", side: "right", tag: "Corundum" },
    { text: "Sapphire cứng hơn hẳn.", side: "both", tag: "Độ cứng" },
  ],
};

test("buildApprovedFacts: bản gốc phẳng (vi) lấy chính chữ; bản gốc song ngữ lấy dòng vi; thiếu dữ kiện -> null", () => {
  const f = buildApprovedFacts(viRecord);
  assert.equal(f.left, "Aquamarine");
  assert.equal(f.right, "Sapphire");
  assert.deepEqual(f.materials, ["Aquamarine", "Sapphire"]);
  assert.deepEqual(f.points.map((p) => p.side), ["left", "right", "both"]);
  assert.equal(f.points[2].meaning, "Sapphire cứng hơn hẳn.");

  const ja = buildApprovedFacts({ label_left: g("アクアマリン", "Đá Aquamarine"), label_right: g("サファイア", "Sapphire"), points: [{ text: g("x", "Ý một"), side: "left" }] });
  assert.equal(ja.left, "Đá Aquamarine");
  assert.equal(ja.points[0].meaning, "Ý một");

  assert.equal(buildApprovedFacts({ label_left: "a", label_right: "b", points: [] }), null);
  assert.equal(buildApprovedFacts(null), null);
});

test("labelMeaningMatches: lỏng với dấu/hoa thường/từ phân loại, nhưng bắt được vật khác", () => {
  assert.equal(labelMeaningMatches("Aquamarine", "aquamarine"), true);
  assert.equal(labelMeaningMatches("Đá Aquamarine", "Aquamarine"), true);
  assert.equal(labelMeaningMatches("Thạch anh tím", "thach anh tim"), true);
  assert.equal(labelMeaningMatches("Kim cương xanh", "Aquamarine"), false, "lỗi nhận dạng đã gặp thực tế");
  assert.equal(labelMeaningMatches("", "Sapphire"), false);
});

test("buildComparePrompt có approvedFacts: nêu rõ đối tượng, đúng N ý theo thứ tự + bên, cấm nhận dạng lại; schema khoá số point", () => {
  const catalog = { actions: [], allIds: ["a"], jewelryIds: [], generalIds: ["a"] };
  const facts = buildApprovedFacts(viRecord);
  const { userPrompt, responseSchema } = buildComparePrompt({ catalog, hashtagCfg: loadHashtagConfig(target), locale: target, approvedFacts: facts });
  assert.match(userPrompt, /Ảnh TRÁI là: Aquamarine/);
  assert.match(userPrompt, /Ảnh PHẢI là: Sapphire/);
  assert.match(userPrompt, /ĐÚNG 3 phần tử/);
  assert.match(userPrompt, /1\. \[left\] Aquamarine thuộc họ Beryl\./);
  assert.ok(userPrompt.indexOf("3. [both]") > userPrompt.indexOf("2. [right]"));
  assert.match(userPrompt, /KHÔNG theo nhận dạng từ ảnh/);
  assert.equal(responseSchema.properties.points.minItems, 3);
  assert.equal(responseSchema.properties.points.maxItems, 3);

  const plain = buildComparePrompt({ catalog, hashtagCfg: loadHashtagConfig(target), locale: target });
  assert.ok(!plain.userPrompt.includes("DỮ KIỆN ĐÃ DUYỆT"));
  assert.equal(plain.responseSchema.properties.points.minItems, undefined);
  assert.equal(plain.responseSchema.properties.points.maxItems, 8);
});

test("checkAgainstApprovedFacts: nhãn lệch -> cảnh báo ở đúng dòng; side bị ép về bản gốc; số point lệch -> cảnh báo", () => {
  const facts = buildApprovedFacts(viRecord);
  const content = {
    label_left: g("ブルーダイヤ", "Kim cương xanh"),
    label_right: g("サファイア", "Sapphire"),
    points: [{ side: "right" }, { side: "right" }, { side: "left" }],
  };
  const r = checkAgainstApprovedFacts(content, facts);
  assert.deepEqual(r.warnings.map((w) => w.path), ["label_left"]);
  assert.match(r.warnings[0].message, /Kim cương xanh.*Aquamarine/);
  assert.deepEqual(content.points.map((p) => p.side), ["left", "right", "both"]);
  assert.equal(r.corrections.length, 2);

  const short = checkAgainstApprovedFacts({ label_left: g("a", "Aquamarine"), label_right: g("b", "Sapphire"), points: [{ side: "left" }] }, facts);
  assert.deepEqual(short.warnings.map((w) => w.code), ["fact-points-count"]);
});

// ---------------------------------------------------------------------------------------------
// end-to-end với Gemini giả: bản phái sinh gửi đúng dữ kiện + lệch thì có cảnh báo
// ---------------------------------------------------------------------------------------------
test("runCompareContent (mock): dữ kiện bản gốc đi vào request; Gemini gọi sai vật -> factWarnings; gọi đúng -> sạch", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-"));
  process.env.COST_LEDGER_PATH = path.join(dir, "ledger.jsonl");
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.GEMINI_MODEL = "m-test";
  delete process.env.GEMINI_FALLBACK_MODEL;
  const realFetch = globalThis.fetch;
  try {
    const mod = await import("../scripts/generate-compare-content.mjs");
    const action = mod.loadActionCatalog().allIds[0];
    const pt = (text, vi, side) => ({ text: g(text, vi), side, tag: g("タグ", "Nhãn"), sub: g("", ""), suggested_action: action, needs_context_image: false, image_concept: "" });
    const response = (leftVi) => ({
      error: "",
      title: g("タイトル", "Tiêu đề"),
      label_left: g("ラベル", leftVi),
      label_right: g("サファイア", "Sapphire"),
      materials: ["アクアマリン", "サファイア"],
      topicTags: [],
      suggestedTags: [],
      // Gemini cố tình đảo bên của điểm 2 và 3
      points: [pt("一", "Aquamarine thuộc họ Beryl.", "left"), pt("二", "Sapphire thuộc họ Corundum.", "left"), pt("三", "Sapphire cứng hơn hẳn.", "right")],
    });
    const requests = [];
    let leftVi = "Kim cương xanh";
    globalThis.fetch = async (url, init) => {
      requests.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(response(leftVi)) }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }), text: async () => "" };
    };
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const facts = buildApprovedFacts(viRecord);

    const bad = await mod.runCompareContent({ left: pixel, right: pixel, locale: target.code, slug: "_pending-x", approvedFacts: facts });
    const userText = requests[0].contents[0].parts[0].text;
    assert.match(userText, /Ảnh TRÁI là: Aquamarine/, "dữ kiện đã duyệt được gửi lên Gemini");
    assert.equal(requests[0].generationConfig.responseSchema.properties.points.minItems, 3);
    assert.deepEqual(bad.factWarnings.map((w) => w.path), ["label_left"]);
    assert.ok(bad.warnings.some((w) => w.code === "fact-mismatch"));
    assert.deepEqual(bad.content.points.map((p) => p.side), ["left", "right", "both"], "side bị ép về đúng bản gốc");

    leftVi = "Aquamarine";
    const good = await mod.runCompareContent({ left: pixel, right: pixel, locale: target.code, slug: "_pending-y", approvedFacts: facts });
    assert.deepEqual(good.factWarnings, []);

    // không có dữ kiện (Bước 1 thường) -> hành vi cũ, không cảnh báo dữ kiện, không khoá số point
    const free = await mod.runCompareContent({ left: pixel, right: pixel, locale: target.code, slug: "_pending-z" });
    assert.deepEqual(free.factWarnings, []);
    assert.equal(requests.at(-1).generationConfig.responseSchema.properties.points.minItems, undefined);
    assert.ok(!requests.at(-1).contents[0].parts[0].text.includes("DỮ KIỆN ĐÃ DUYỆT"));
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.COST_LEDGER_PATH;
    delete process.env.GEMINI_MODEL;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("thị trường mặc định (vi) cũng không hỏng khi có approvedFacts (bản gốc ngoại ngữ -> phiên bản vi)", () => {
  const vi = getDefaultLocale();
  const catalog = { actions: [], allIds: ["a"], jewelryIds: [], generalIds: ["a"] };
  const facts = buildApprovedFacts({ label_left: g("アクアマリン", "Aquamarine"), label_right: g("サファイア", "Sapphire"), points: [{ text: g("x", "Ý một"), side: "left" }] });
  const { userPrompt } = buildComparePrompt({ catalog, hashtagCfg: loadHashtagConfig(vi), locale: vi, approvedFacts: facts });
  assert.match(userPrompt, /Ý một/);
});
