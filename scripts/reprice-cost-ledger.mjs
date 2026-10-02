// Tính lại cost_usd trong output/cost-ledger.jsonl theo bảng giá hiện tại (config/pricing.mjs), dựa trên token/ảnh ĐÃ LƯU.
//
//   node scripts/reprice-cost-ledger.mjs             Chỉ sửa dòng THÀNH CÔNG đang ghi 0 USD do thiếu giá (nay đã có giá)
//   node scripts/reprice-cost-ledger.mjs --all        Tính lại MỌI dòng thành công theo giá hiện tại (kể cả dòng đã có giá cũ/ước tính)
//   node scripts/reprice-cost-ledger.mjs --dry-run    Chỉ báo, không ghi
//
// Luôn sao lưu sổ sang output/cost-ledger.jsonl.bak-<thời điểm> trước khi ghi. Dòng lỗi (status="error") luôn 0 USD — không đụng.
// Dòng không có token/ảnh đã lưu thì không tính lại được — giữ nguyên.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { calcContentCost, calcImageCost, isPriced } from "../config/pricing.mjs";
import { COST_LEDGER_PATH } from "./lib/cost-ledger.mjs";

const kindOf = (row) => (row.task === "context-image" || row.subtask === "context-image" ? "context-image" : "content-generation");

/**
 * @param {object} row 1 dòng sổ
 * @returns {number|null} chi phí mới, hoặc null nếu không tính lại được (lỗi / thiếu giá / thiếu dữ liệu đã lưu)
 */
export function repricedCost(row) {
  if (row.status !== "success" || !row.model) return null;
  const kind = kindOf(row);
  if (!isPriced(row.model, kind)) return null;
  if (kind === "context-image") return typeof row.image_count === "number" ? calcImageCost(row.model, row.image_count) : calcImageCost(row.model, 1);
  if (typeof row.input_tokens !== "number" || typeof row.output_tokens !== "number") return null;
  return calcContentCost(row.model, row.input_tokens, row.output_tokens);
}

/** @returns {{lines:string[], changed:number, deltaUsd:number}} `lines` giữ nguyên dòng hỏng/trống. */
export function repriceLedgerText(raw, { all = false } = {}) {
  let changed = 0;
  let deltaUsd = 0;
  const lines = raw.split("\n").map((line) => {
    if (!line.trim()) return line;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      return line;
    }
    const next = repricedCost(row);
    const old = typeof row.cost_usd === "number" ? row.cost_usd : 0;
    if (next === null || (!all && old !== 0)) return line;
    if (Math.abs(next - old) < 1e-12) return line;
    changed++;
    deltaUsd += next - old;
    return JSON.stringify({ ...row, cost_usd: next });
  });
  return { lines, changed, deltaUsd };
}

function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const dry = args.includes("--dry-run");
  if (!fs.existsSync(COST_LEDGER_PATH)) {
    console.log(`Chưa có sổ chi phí (${COST_LEDGER_PATH}) — không có gì để tính lại.`);
    return;
  }
  const raw = fs.readFileSync(COST_LEDGER_PATH, "utf8");
  const { lines, changed, deltaUsd } = repriceLedgerText(raw, { all });
  console.log(`${changed} dòng ${dry ? "sẽ được" : "đã"} tính lại${all ? " (--all)" : ""}; chênh lệch tổng: ${deltaUsd >= 0 ? "+" : ""}$${deltaUsd.toFixed(4)}.`);
  if (dry || changed === 0) return;
  const backup = `${COST_LEDGER_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(COST_LEDGER_PATH, backup);
  fs.writeFileSync(COST_LEDGER_PATH, lines.join("\n"));
  console.log(`Đã sao lưu sổ cũ: ${path.relative(process.cwd(), backup)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
