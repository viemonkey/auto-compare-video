// Bảng giá: model có giá/thiếu giá, tính lại sổ chi phí.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRICING, PRICING_SOURCE, isPriced, calcContentCost, calcImageCost } from "../config/pricing.mjs";
import { repricedCost, repriceLedgerText } from "../scripts/reprice-cost-ledger.mjs";

test("mọi model trong bảng có ngày cập nhật, ghi nguồn URL ở PRICING_SOURCE", () => {
  assert.match(PRICING_SOURCE.url, /^https:\/\/ai\.google\.dev\//);
  assert.match(PRICING_SOURCE.lastUpdated, /^\d{4}-\d{2}-\d{2}$/);
  for (const [model, p] of Object.entries(PRICING)) {
    assert.match(p.lastUpdated, /^\d{4}-\d{2}-\d{2}$/, model);
    assert.ok(typeof p.perImage === "number" || (typeof p.inputPerMillion === "number" && typeof p.outputPerMillion === "number"), model);
  }
});

test("gemini-3.5-flash-lite có giá; model lạ thì isPriced=false và cost 0", () => {
  assert.equal(isPriced("gemini-3.5-flash-lite"), true);
  assert.ok(Math.abs(calcContentCost("gemini-3.5-flash-lite", 1_000_000, 1_000_000) - 2.8) < 1e-9);
  assert.equal(isPriced("gemini-9-future"), false);
  assert.equal(calcContentCost("gemini-9-future", 1000, 1000), 0);
  assert.equal(isPriced("gemini-3.1-flash-image", "context-image"), true);
  assert.equal(isPriced("gemini-3.1-flash-image", "content-generation"), false);
  assert.ok(calcImageCost("gemini-3.1-flash-image", 2) > 0);
});

test("reprice: chỉ sửa dòng thành công đang 0 USD có token; không đụng lỗi / dòng hỏng / dòng đã có giá (trừ --all)", () => {
  const rows = [
    { model: "gemini-3.5-flash-lite", task: "content-generation", status: "success", input_tokens: 1_000_000, output_tokens: 0, cost_usd: 0 },
    { model: "gemini-3.5-flash-lite", task: "content-generation", status: "error", cost_usd: 0 },
    { model: "gemini-9-future", task: "content-generation", status: "success", input_tokens: 5, output_tokens: 5, cost_usd: 0 },
    { model: "gemini-3.5-flash", task: "content-generation", status: "success", input_tokens: 1_000_000, output_tokens: 0, cost_usd: 0.3 },
    { model: "gemini-3.5-flash-lite", task: "content-generation", status: "success", input_tokens: null, output_tokens: null, cost_usd: 0 },
  ];
  const raw = rows.map((r) => JSON.stringify(r)).join("\n") + "\nnot json\n";
  const r1 = repriceLedgerText(raw);
  assert.equal(r1.changed, 1);
  assert.ok(Math.abs(JSON.parse(r1.lines[0]).cost_usd - 0.3) < 1e-9);
  assert.equal(r1.lines[5], "not json");
  assert.equal(r1.lines[3], JSON.stringify(rows[3]));
  const r2 = repriceLedgerText(raw, { all: true });
  assert.equal(r2.changed, 2);
  assert.ok(Math.abs(JSON.parse(r2.lines[3]).cost_usd - 1.5) < 1e-9);
  assert.equal(repricedCost(rows[1]), null);
});
