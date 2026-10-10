// Batch API cho ảnh (PRODUCT_IMAGE_BATCH=1): gửi nhiều yêu cầu 1 lần, chờ lâu hơn (tới 24 giờ), giá ~50%. MẶC ĐỊNH TẮT.
// Chỉ dùng cho lượt tạo ảnh ĐẦU của các cảnh (kết quả được ghi vào cache theo khoá chuẩn, sau đó luồng bình thường kiểm/sửa tiếp bằng lời gọi thường).
// REST: POST models/{model}:batchGenerateContent -> thao tác; GET {name} tới khi xong; ảnh nằm ở response.inlinedResponses.
import { calcImageCost } from "../../../config/pricing.mjs";
import { appendCostEntry } from "../cost-ledger.mjs";
import { classifyPaidApiError } from "./billing.mjs";
import { buildImageRequest, extractImage, EXT_BY_MIME } from "./image-gen.mjs";
import { RetryableError, NonRetryableError, redactKey } from "../gemini-retry.mjs";

const API = "https://generativelanguage.googleapis.com/v1beta";
const apiKey = () => (process.env.GEMINI_API_KEY || "").trim();
const DONE_STATES = ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"];

export const batchState = (op) => String(op?.metadata?.state || op?.state || "").replace(/^(JOB|BATCH)_STATE_/, "");
export const inlinedResponsesOf = (op) => {
  const r = op?.response?.inlinedResponses ?? op?.dest?.inlinedResponses ?? [];
  return Array.isArray(r) ? r : r.inlinedResponses || [];
};

/**
 * @param {{requests:Array<{key:string, prompt:string, references:object[]}>, model:string, size:string, aspectRatio:string, slug:string, locale?:string, subtask?:string,
 *   pollIntervalMs:number, timeoutMs:number, fetchImpl?:Function, sleep?:Function, now?:()=>number, ledger?:Function, signal?:AbortSignal}} o
 * @returns {Promise<Map<string,{buffer:Buffer,mimeType:string,ext:string,costUsd:number}|{error:string}>>} theo key; ném lỗi billing/model như generateImage; hết giờ -> huỷ batch + ném RetryableError
 */
export async function generateImagesBatch(o) {
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now || Date.now;
  const ledger = o.ledger || appendCostEntry;
  const key = apiKey();
  if (!key) throw new NonRetryableError("Thiếu GEMINI_API_KEY.", { userMessage: "Server chưa cấu hình GEMINI_API_KEY." });
  const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
  const call = async (url, init) => {
    const res = await fetchImpl(url, { ...init, headers, signal: o.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw classifyPaidApiError({ httpStatus: res.status, bodyText: redactKey(text, key), model: o.model });
    }
    return res.json();
  };

  const created = await call(`${API}/models/${o.model}:batchGenerateContent`, {
    method: "POST",
    body: JSON.stringify({
      batch: {
        display_name: `product-${o.slug}`.slice(0, 120),
        input_config: { requests: { requests: o.requests.map((r) => ({ request: buildImageRequest({ prompt: r.prompt, references: r.references, aspectRatio: o.aspectRatio, size: o.size }), metadata: { key: r.key } })) } },
      },
    }),
  });
  const name = created?.name;
  if (!name) throw new RetryableError("Batch API không trả tên thao tác.");

  const started = now();
  let op = created;
  while (!DONE_STATES.includes(batchState(op)) && op?.done !== true) {
    if (now() - started > o.timeoutMs) {
      await call(`${API}/${name}:cancel`, { method: "POST", body: "{}" }).catch(() => {});
      throw new RetryableError(`Batch ${name} quá hạn chờ (${Math.round(o.timeoutMs / 60000)} phút) — đã huỷ.`, { userMessage: "Batch ảnh chạy quá lâu nên đã huỷ — chuyển sang tạo ảnh thường." });
    }
    await sleep(o.pollIntervalMs);
    op = await call(`${API}/${name}`, { method: "GET" });
  }
  const state = batchState(op);
  if (state && state !== "SUCCEEDED") throw new RetryableError(`Batch ${name} kết thúc ở trạng thái ${state}.`, { userMessage: "Batch ảnh không thành công — chuyển sang tạo ảnh thường." });

  const out = new Map();
  const unit = calcImageCost(o.model, 1, { size: o.size, batch: true });
  for (const item of inlinedResponsesOf(op)) {
    const k = item?.metadata?.key;
    if (!k) continue;
    try {
      if (item.error) throw new Error(item.error.message || "lỗi");
      const image = extractImage(item.response);
      out.set(k, { buffer: Buffer.from(image.base64, "base64"), mimeType: image.mimeType, ext: EXT_BY_MIME[image.mimeType] || ".png", costUsd: unit });
      ledger({ slug: o.slug, locale: o.locale, task: "product-image", subtask: `${o.subtask || "batch"}:${k}`, model: o.model, status: "success", imageCount: 1, costUsd: unit });
    } catch (e) {
      out.set(k, { error: e.userMessage || e.message });
      ledger({ slug: o.slug, locale: o.locale, task: "product-image", subtask: `${o.subtask || "batch"}:${k}`, model: o.model, status: "error", errorMessage: String(e.message).slice(0, 300) });
    }
  }
  return out;
}
