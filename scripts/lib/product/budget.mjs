// Trần chi phí 1 video: PRODUCT_VIDEO_MAX_COST_VND (mặc định 15.000đ). Trước MỖI lời gọi API có phí: ước tính + cộng với phần đã dùng
// của video (đọc từ cost-ledger theo slug) — vượt trần thì KHÔNG gọi, nơi gọi chuyển sang phương án rẻ hơn.
import fs from "node:fs";
import { COST_LEDGER_PATH } from "../cost-ledger.mjs";
import { calcContentCost, calcImageCost, calcVideoCost, usdToVnd } from "../../../config/pricing.mjs";
import { loadProductConfig, maxCostVnd, imageSettings, clipSettings } from "./config.mjs";

const ledgerFile = () => process.env.COST_LEDGER_PATH || COST_LEDGER_PATH;

/** Các dòng sổ chi phí khớp 1 trong các slug (slug tạm của Bước 1/2 + slug thật sau khi dựng). */
export function readLedgerRows(slugs, file = ledgerFile()) {
  const wanted = new Set(slugs.filter(Boolean));
  if (!wanted.size || !fs.existsSync(file)) return [];
  const rows = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (wanted.has(row.slug)) rows.push(row);
    } catch {
      // dòng hỏng — bỏ qua, như thống kê chi phí
    }
  }
  return rows;
}

export const usdToVndRounded = (usd, env = process.env) => Math.max(0, Math.ceil(usd * usdToVnd(env) - 1e-9));

/** Tổng chi phí đã dùng (USD) + tách theo task, từ sổ. */
export function spentFromRows(rows) {
  const byTask = {};
  let usd = 0;
  for (const r of rows) {
    const c = typeof r.cost_usd === "number" ? r.cost_usd : 0;
    usd += c;
    const key = r.subtask && r.task === "content-generation" ? `${r.task}:${r.subtask}` : r.task || "unknown";
    byTask[key] = (byTask[key] || 0) + c;
  }
  return { usd, byTask };
}

/**
 * Ngân sách của 1 video.
 * @param {{slugs:()=>string[], env?:object, config?:object, rowsReader?:Function}} o
 *   slugs: hàm trả các slug sổ của video (đổi theo thời điểm: slug tạm -> slug thật)
 */
export function createBudget({ slugs, env = process.env, config = loadProductConfig(), rowsReader = readLedgerRows }) {
  const maxVnd = () => maxCostVnd(env, config);
  const spent = () => spentFromRows(rowsReader(slugs()));
  const spentVnd = () => usdToVndRounded(spent().usd, env);
  return {
    maxVnd,
    spent,
    spentVnd,
    remainingVnd: (reserveVnd = 0) => Math.max(0, maxVnd() - spentVnd() - reserveVnd),
    /**
     * Có được gọi 1 lần tốn `estimateUsd` không? `reserveVnd` = phần giữ chỗ cho hạng mục khác (vd clip AI) mà lời gọi này không được ăn vào.
     * estimateUsd = null (không biết giá) -> TỪ CHỐI: không gọi API có phí khi chưa biết giá.
     */
    check(estimateUsd, { reserveVnd = 0 } = {}) {
      const used = spentVnd();
      if (estimateUsd === null || estimateUsd === undefined || !Number.isFinite(estimateUsd)) {
        return { ok: false, reason: "unpriced", spentVnd: used, estimateVnd: null, maxVnd: maxVnd(), message: "Chưa có đơn giá cho lời gọi này nên không gọi (config/pricing.mjs)." };
      }
      const estimateVnd = usdToVndRounded(estimateUsd, env);
      const after = used + estimateVnd + reserveVnd;
      const ok = after <= maxVnd();
      return {
        ok,
        reason: ok ? null : "over-budget",
        spentVnd: used,
        estimateVnd,
        reserveVnd,
        maxVnd: maxVnd(),
        message: ok ? "" : `Vượt trần ${fmtVnd(maxVnd())}: đã dùng ${fmtVnd(used)}, lời gọi này ~${fmtVnd(estimateVnd)}${reserveVnd ? `, giữ chỗ ${fmtVnd(reserveVnd)}` : ""}.`,
      };
    },
  };
}

export const fmtVnd = (n) => `${Math.round(n).toLocaleString("vi-VN")}đ`;

// ---- ước tính từng loại lời gọi (USD) — nguồn giá: config/pricing.mjs, số token/ảnh: config.estimate ----
export function textCallUsd(model, kind, config = loadProductConfig()) {
  const e = config.estimate[kind];
  return calcContentCost(model, e.inputTokens, e.outputTokens);
}
export function imageCallUsd(env = process.env, config = loadProductConfig()) {
  const s = imageSettings(env, config);
  return calcImageCost(s.id, 1, { size: s.size, batch: s.batch });
}
export function clipCallUsd(env = process.env, config = loadProductConfig()) {
  const s = clipSettings(env, config);
  return calcVideoCost(s.id, s.seconds, s.resolution);
}
