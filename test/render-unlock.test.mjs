// Cả 4 thị trường dựng được video (MỐC 8): năng lực render tính từ khai báo, không cờ cứng.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRenderability, listThemes } from "../scripts/lib/capabilities.mjs";
import { listLocales } from "../scripts/lib/locales.mjs";
import { effectiveSlugSuffix, hasLocaleSuffix } from "../scripts/lib/market-slug.mjs";

test("vi-VN, en-US, ja-JP, th-TH đều renderable với theme mặc định, mỗi thị trường có ít nhất 1 engine giọng", () => {
  const locales = listLocales();
  assert.deepEqual(locales.map((l) => l.code).sort(), ["en-US", "ja-JP", "th-TH", "vi-VN"]);
  for (const l of locales) {
    const r = checkRenderability(l);
    assert.equal(r.renderable, true, `${l.code}: ${r.blockers.map((b) => b.message).join(" ")}`);
    assert.ok(r.engines.length >= 1, l.code);
    assert.ok(r.engines.includes("edge"), `${l.code}: Edge phải là engine khả dụng`);
  }
});

test("theme mặc định khai báo đủ hệ chữ Latn/Jpan/Thai và ngôn ngữ vi/en/ja/th; font của mọi locale thuộc hệ chữ đó", () => {
  const paper = listThemes().find((t) => t.default);
  for (const s of ["Latn", "Jpan", "Thai"]) assert.ok(paper.scripts.includes(s), s);
  for (const l of listLocales()) assert.ok(paper.scripts.includes(l.script) && paper.languages.includes(l.language), l.code);
});

test("slug bản ngoại ngữ phải có hậu tố thị trường; vi-VN không có", () => {
  const byCode = Object.fromEntries(listLocales().map((l) => [l.code, l]));
  assert.equal(effectiveSlugSuffix(byCode["ja-JP"], "vi-VN"), "ja");
  assert.equal(effectiveSlugSuffix(byCode["en-US"], "vi-VN"), "en");
  assert.equal(effectiveSlugSuffix(byCode["th-TH"], "vi-VN"), "th");
  assert.equal(effectiveSlugSuffix(byCode["vi-VN"], "vi-VN"), "");
  assert.equal(hasLocaleSuffix("aquamarine-vs-sapphire-ja", byCode["ja-JP"], "vi-VN"), true);
  assert.equal(hasLocaleSuffix("aquamarine-vs-sapphire", byCode["ja-JP"], "vi-VN"), false);
});
