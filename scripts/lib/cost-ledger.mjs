// Ghi sổ chi phí gọi AI — append-only JSONL, dùng chung bởi generate-compare-content.mjs
// (task "content-generation") và generate-context-image.mjs (task "context-image").
//
// Nguyên tắc: ghi 1 dòng cho MỌI lần gọi API thật sự chạm tới HTTP (kể cả lỗi 429/400/timeout),
// để không mất dấu vết khi debug sự cố — nhưng CHỈ tính cost_usd > 0 cho lần gọi mà Google thực
// sự tính tiền (status="success", tức HTTP trả về response hợp lệ). Lần lỗi ở tầng HTTP (network/
// timeout/4xx/5xx) không được Google tính phí request đó, nên status="error" luôn có cost_usd=0 —
// vẫn ghi lại để biết tần suất lỗi/retry, không phải để cộng dồn chi phí.
//
// KHÔNG throw khi ghi lỗi — chi phí là tính năng phụ theo dõi, không được phép làm hỏng pipeline
// dựng video chính (cùng triết lý với generateContextImage() ở generate-context-image.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "output");
// COST_LEDGER_PATH (env) chỉ để test không ghi vào sổ thật.
export const COST_LEDGER_PATH = process.env.COST_LEDGER_PATH || path.join(OUTPUT_DIR, "cost-ledger.jsonl");
// Đọc env cả lúc GHI (không chỉ lúc import) — test đặt COST_LEDGER_PATH sau khi module đã được import vẫn không ghi nhầm vào sổ thật.
const ledgerPath = () => process.env.COST_LEDGER_PATH || COST_LEDGER_PATH;

// Lần gọi kiểm chứng/thử nghiệm (slug tạm "_verify-…", "_hashtag-smoke-test…") KHÔNG phải video: ghi task "verification" (task gốc giữ ở
// `subtask`) để thống kê theo video bỏ qua, nhưng vẫn cộng vào tổng chi phí.
export const VERIFICATION_TASK = "verification";
export const isVerificationSlug = (slug) => typeof slug === "string" && /^_(verify|hashtag-smoke-test)/.test(slug);

/** Dòng sổ có thuộc 1 video thật không (có slug, không phải dòng kiểm chứng — kể cả dòng cũ chưa đổi task). */
export const countsAsVideo = (row) => !!row.slug && row.task !== VERIFICATION_TASK && !isVerificationSlug(row.slug);

/**
 * @param {object} entry
 * @param {string|null} entry.slug - videos/<slug>/ liên quan, hoặc null nếu chưa xác định
 *   (vd content-generation ở Bước 1 UI chạy trước khi slug được chọn ở Bước 2).
 * @param {"content-generation"|"context-image"|"tts"} entry.task
 * @param {string} entry.model
 * @param {"success"|"error"} entry.status
 * @param {number} [entry.inputTokens] - task content-generation
 * @param {number} [entry.outputTokens] - task content-generation
 * @param {number} [entry.imageCount] - task context-image
 * @param {number} entry.costUsd - 0 khi status="error"
 * @param {number} [entry.httpStatus]
 * @param {string} [entry.errorMessage] - chỉ khi status="error"
 * @param {number} [entry.attempt] - lần thử thứ mấy (retry)
 * @param {string} [entry.subtask] - tác vụ con (vd "field-rewrite" / "field-translate" ở Bước 2); task vẫn là content-generation để cột chi phí không đổi
 * @param {string} [entry.locale] - mã thị trường (vd "ja-JP") của lần sinh nội dung; dòng cũ không có -> null
 * @param {string} [entry.engine] - task "tts": engine giọng đọc ("edge" | "azure" ...)
 * @param {number} [entry.characters] - task "tts": số ký tự đã gửi đọc (Azure tính tiền theo ký tự; Edge chi phí 0)
 * @param {string} [entry.voice] - task "tts": tên giọng
 */
export function appendCostEntry(entry) {
  const row = {
    timestamp: new Date().toISOString(),
    slug: entry.slug || null,
    locale: entry.locale || null,
    subtask: isVerificationSlug(entry.slug) ? entry.subtask || entry.task || null : entry.subtask || null,
    task: isVerificationSlug(entry.slug) ? VERIFICATION_TASK : entry.task,
    model: entry.model,
    input_tokens: typeof entry.inputTokens === "number" ? entry.inputTokens : null,
    output_tokens: typeof entry.outputTokens === "number" ? entry.outputTokens : null,
    image_count: typeof entry.imageCount === "number" ? entry.imageCount : null,
    engine: entry.engine || null,
    characters: typeof entry.characters === "number" ? entry.characters : null,
    voice: entry.voice || null,
    cost_usd: entry.status === "success" ? entry.costUsd || 0 : 0,
    status: entry.status,
    http_status: typeof entry.httpStatus === "number" ? entry.httpStatus : null,
    error_message: entry.status === "error" ? entry.errorMessage || null : null,
    attempt: typeof entry.attempt === "number" ? entry.attempt : null,
  };

  try {
    const file = ledgerPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + "\n");
  } catch (e) {
    console.error(`⚠ [cost-ledger] Không ghi được ${ledgerPath()}: ${e.message}`);
  }
}

/**
 * Đổi slug của MỌI dòng đang mang oldSlug sang newSlug.
 *
 * Dùng khi 1 lần gọi Gemini (content-generation) được ghi sổ với slug TẠM/placeholder vì
 * slug thật của video chưa xác định lúc gọi API (vd Bước 1 UI: người dùng chưa thấy
 * label_left/label_right Gemini sinh ra nên chưa thể đặt/xác nhận tên slug) — ngay khi slug
 * thật được chốt (Bước 2 UI, hoặc genUniqueSlug() trong scaffold-compare-video.mjs), gọi hàm
 * này để dòng ledger vừa ghi phản ánh đúng slug thật, thay vì mãi mãi mồ côi với slug tạm.
 *
 * KHÔNG throw khi đọc/ghi lỗi — cùng triết lý với appendCostEntry (chi phí là tính năng phụ
 * theo dõi, không được phép làm hỏng pipeline dựng video chính).
 *
 * @param {string|null} oldSlug - slug tạm đã dùng lúc gọi appendCostEntry.
 * @param {string} newSlug - slug thật vừa được chốt.
 * @returns {number} số dòng đã đổi (0 nếu không có dòng nào khớp, hoặc đọc/ghi lỗi).
 */
export function renameCostLedgerSlug(oldSlug, newSlug) {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return 0;
  try {
    if (!fs.existsSync(ledgerPath())) return 0;
    const raw = fs.readFileSync(ledgerPath(), "utf8");
    let changed = 0;
    const nextLines = raw.split("\n").map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      let row;
      try {
        row = JSON.parse(trimmed);
      } catch {
        return line; // dòng hỏng (vd ghi dở khi crash) — giữ nguyên, không đoán bừa
      }
      if (row.slug !== oldSlug) return line;
      row.slug = newSlug;
      changed++;
      return JSON.stringify(row);
    });
    if (changed > 0) {
      fs.writeFileSync(ledgerPath(), nextLines.join("\n"));
    }
    return changed;
  } catch (e) {
    console.error(`⚠ [cost-ledger] Không đổi được slug "${oldSlug}" -> "${newSlug}": ${e.message}`);
    return 0;
  }
}
