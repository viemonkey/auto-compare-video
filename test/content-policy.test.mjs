// Chính sách nội dung áp cho MỌI thị trường: dòng `vi` sát nghĩa tuyệt đối, ý nghĩa biểu tượng được phép nhưng cấm khẳng định công dụng,
// phân biệt độ cứng/độ dai; và dòng chi phí kiểm chứng không thành "video ma".
// Test kiểm tra CẤU TRÚC và QUY TẮC; danh sách cụm cấm bắt buộc là chính sách do người vận hành quy định.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listLocales, needsGloss, glossaryEntries } from "../scripts/lib/locales.mjs";
import { warningsForField } from "../scripts/lib/compare-content.mjs";
import { buildComparePrompt } from "../scripts/lib/compare-prompt.mjs";
import { loadHashtagConfig } from "../scripts/lib/hashtags.mjs";
import { loadTemplateFile } from "../scripts/lib/template.mjs";
import { FIELD_EDIT_TEMPLATE_PATH } from "../scripts/lib/field-edit.mjs";
import { bilingual } from "../public/shared/bilingual.mjs";

const all = listLocales();
const byLang = (lang) => all.find((l) => l.language === lang);
const catalog = { actions: [{ id: "explain-a", use_case: "x" }], allIds: ["explain-a"], jewelryIds: [], generalIds: ["explain-a"] };

// ---------------------------------------------------------------------------------------------
// vi sát nghĩa tuyệt đối — prompt có quy tắc + ví dụ đúng/sai
// ---------------------------------------------------------------------------------------------
test("prompt sinh nội dung (thị trường song ngữ): quy tắc sát nghĩa tuyệt đối + ví dụ ĐÚNG/SAI + tên riêng giữ nguyên", () => {
  for (const l of all.filter(needsGloss)) {
    const { systemPrompt } = buildComparePrompt({ catalog, hashtagCfg: loadHashtagConfig(l), locale: l });
    assert.match(systemPrompt, /SÁT NGHĨA\s+TUYỆT ĐỐI/, l.code);
    assert.match(systemPrompt, /KHÔNG thêm từ phân loại/, l.code);
    assert.match(systemPrompt, /Tên riêng[^\n]*giữ nguyên/, l.code);
    assert.ok(systemPrompt.includes('"コランダム" -> "Corundum"') && systemPrompt.includes('"コランダム" -> "Họ Corundum"'), `${l.code}: ví dụ đúng/sai`);
    assert.match(systemPrompt, /ĐÚNG:/);
    assert.match(systemPrompt, /SAI:/);
  }
});

test("prompt sửa dòng (field-edit.md): rewrite và translate đều có quy tắc sát nghĩa + ví dụ đúng/sai", () => {
  const sections = loadTemplateFile(FIELD_EDIT_TEMPLATE_PATH);
  for (const name of ["rewrite.system", "translate.system"]) {
    const t = sections[name];
    assert.match(t, /SÁT NGHĨA TUYỆT ĐỐI/, name);
    assert.match(t, /KHÔNG thêm ý, KHÔNG bớt ý/, name);
    assert.ok(t.includes('"コランダム" -> "Corundum"') && t.includes('"コランダム" -> "Họ Corundum"'), `${name}: ví dụ`);
    assert.match(t, /tên riêng/i, name);
  }
});

// ---------------------------------------------------------------------------------------------
// tâm linh / biểu tượng: cho phép "tượng trưng", cấm khẳng định công dụng
// ---------------------------------------------------------------------------------------------
const REQUIRED_FORBIDDEN = {
  vi: ["mang lại may mắn", "chữa bệnh", "thu hút tài lộc", "giúp giàu có"],
  th: ["โชคลาภ", "ปกป้อง", "รักษาโรค", "เสริมดวง"],
  ja: ["運気が上がる", "守ってくれる", "治る"],
  en: ["brings luck", "protects you", "heals"],
};

test("MỌI thị trường: styleGuide có quy tắc biểu tượng/tâm linh và forbiddenPhrases chứa các cụm công dụng bắt buộc", () => {
  for (const l of all) {
    assert.match(l.styleGuide, /Ý nghĩa biểu tượng\/tâm linh/, `${l.code}: styleGuide`);
    assert.match(l.styleGuide, /ĐƯỢC PHÉP/, l.code);
    assert.match(l.styleGuide, /TUYỆT ĐỐI KHÔNG khẳng định công dụng/, l.code);
    const required = REQUIRED_FORBIDDEN[l.language];
    assert.ok(required, `${l.code}: chưa khai báo cụm bắt buộc cho ngôn ngữ ${l.language}`);
    for (const phrase of required) assert.ok(l.forbiddenPhrases.includes(phrase), `${l.code}: thiếu cụm cấm "${phrase}"`);
    // cụm cấm đi vào prompt
    const { systemPrompt } = buildComparePrompt({ catalog, hashtagCfg: loadHashtagConfig(l), locale: l });
    for (const phrase of required) assert.ok(systemPrompt.includes(`"${phrase}"`), `${l.code}: prompt thiếu "${phrase}"`);
  }
});

test("cảnh báo: câu khẳng định công dụng bị bắt; câu 'tượng trưng/được xem là' thì không", () => {
  const cases = {
    th: { bad: "อความารีนสื่อถึงความสงบและการปกป้องจากท้องทะเล", good: "อความารีนถือเป็นสัญลักษณ์ของความสงบ" },
    ja: { bad: "このお守りは運気が上がる石です", good: "アクアマリンは平穏を象徴するとされています。" },
    en: { bad: "This stone brings luck and protects you.", good: "Aquamarine is said to symbolize calm." },
    vi: { bad: "Viên đá này mang lại may mắn cho bạn", good: "Aquamarine được xem là biểu tượng của sự bình yên" },
  };
  for (const [lang, { bad, good }] of Object.entries(cases)) {
    const l = byLang(lang);
    const isBad = (txt) => warningsForField("text", needsGloss(l) ? bilingual(txt, "x") : txt, l).some((w) => w.code === "forbidden-phrase");
    assert.equal(isBad(bad), true, `${lang}: câu cấm phải bị bắt`);
    assert.equal(isBad(good), false, `${lang}: câu biểu tượng hợp lệ không bị bắt`);
  }
});

// ---------------------------------------------------------------------------------------------
// độ cứng (hardness) vs độ dai (toughness)
// ---------------------------------------------------------------------------------------------
test("MỌI thị trường: styleGuide phân biệt độ cứng (thang Mohs) và độ dai", () => {
  for (const l of all) {
    assert.match(l.styleGuide, /Phân biệt/, l.code);
    assert.match(l.styleGuide, /thang Mohs|モース|โมห์ส/, `${l.code}: nhắc thang Mohs`);
  }
  const en = byLang("en").styleGuide;
  assert.match(en, /"hard"\/"hardness"/);
  assert.match(en, /KHÔNG dùng "tough"\/"toughness" cho thang Mohs/);
  assert.match(byLang("ja").styleGuide, /硬度/);
  assert.match(byLang("ja").styleGuide, /靭性/);
  assert.match(byLang("th").styleGuide, /ความแข็ง/);
  assert.match(byLang("th").styleGuide, /ความเหนียว/);
});

test("glossary: có cặp độ cứng / độ dai cho thị trường song ngữ; en cảnh báo khi nói 'tough' về thang Mohs", () => {
  for (const l of all.filter(needsGloss)) {
    const g = glossaryEntries(l);
    assert.ok(g.some((e) => e.concept === "độ cứng"), `${l.code}: glossary thiếu 'độ cứng'`);
    assert.ok(g.some((e) => e.concept === "độ dai"), `${l.code}: glossary thiếu 'độ dai'`);
  }
  const en = byLang("en");
  const warn = (text, vi) => warningsForField("text", bilingual(text, vi), en).some((w) => w.code === "glossary-term");
  assert.equal(warn("Sapphire is incredibly tough, scoring a nine on the Mohs scale.", "Sapphire có độ cứng 9 trên thang Mohs"), true);
  assert.equal(warn("Sapphire scores a nine on the Mohs hardness scale.", "Sapphire có độ cứng 9 trên thang Mohs"), false);
  assert.equal(warn("Sapphire is very hard, scoring a nine on the Mohs scale.", "Sapphire rất cứng, đạt 9 trên thang Mohs"), false);
});

// ---------------------------------------------------------------------------------------------
// chi phí kiểm chứng
// ---------------------------------------------------------------------------------------------
test("cost ledger: slug kiểm chứng -> task 'verification' (task gốc ở subtask); slug thường giữ nguyên", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  process.env.COST_LEDGER_PATH = path.join(dir, "l.jsonl");
  try {
    const { appendCostEntry, isVerificationSlug, countsAsVideo, VERIFICATION_TASK } = await import("../scripts/lib/cost-ledger.mjs");
    appendCostEntry({ slug: "_verify-m3-ja-JP", task: "content-generation", model: "m", status: "success", costUsd: 0.004 });
    appendCostEntry({ slug: "_hashtag-smoke-test", task: "context-image", model: "m", status: "success", costUsd: 0.04 });
    appendCostEntry({ slug: "video-that", task: "content-generation", model: "m", status: "success", costUsd: 0.01 });
    appendCostEntry({ slug: "_pending-abc", task: "content-generation", subtask: "field-rewrite", model: "m", status: "success", costUsd: 0.001 });
    const rows = fs.readFileSync(process.env.COST_LEDGER_PATH, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((r) => r.task), [VERIFICATION_TASK, VERIFICATION_TASK, "content-generation", "content-generation"]);
    assert.equal(rows[0].subtask, "content-generation");
    assert.equal(rows[1].subtask, "context-image");
    assert.equal(rows[0].cost_usd, 0.004, "chi phí vẫn được ghi (tính vào tổng)");
    assert.equal(rows[3].subtask, "field-rewrite");
    assert.equal(isVerificationSlug("_verify-x"), true);
    assert.equal(isVerificationSlug("_pending-x"), false);
    assert.equal(countsAsVideo(rows[0]), false);
    assert.equal(countsAsVideo(rows[2]), true);
    assert.equal(countsAsVideo({ slug: "_verify-old", task: "content-generation" }), false, "dòng cũ chưa đổi task vẫn bị loại theo slug");
    assert.equal(countsAsVideo({ slug: null, task: "content-generation" }), false);
  } finally {
    delete process.env.COST_LEDGER_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
