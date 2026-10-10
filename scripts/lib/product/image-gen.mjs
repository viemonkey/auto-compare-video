// Gọi API sinh/sửa ảnh Gemini (generateContent, có ảnh tham chiếu) — CÓ PHÍ, không có gói miễn phí. Mọi lỗi billing/model đi qua classifyPaidApiError.
// Mỗi lời gọi thành công ghi 1 dòng cost-ledger (task "product-image"); lỗi ghi dòng 0đ. Tiêm fetchImpl/ledger/sleep nên test không cần mạng.
import { calcImageCost } from "../../../config/pricing.mjs";
import { appendCostEntry } from "../cost-ledger.mjs";
import { RetryableError, NonRetryableError, withRetry, redactKey } from "../gemini-retry.mjs";
import { classifyPaidApiError } from "./billing.mjs";
import { imageSettings, loadProductConfig } from "./config.mjs";

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const apiKey = () => (process.env.GEMINI_API_KEY || "").trim();

export const EXT_BY_MIME = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

export function buildImageRequest({ prompt, references = [], aspectRatio, size }) {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }, ...references.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.data } }))] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio, ...(size ? { imageSize: size } : {}) } },
  };
}

/** Lấy ảnh đầu tiên trong response; không có ảnh -> lỗi phân loại (safety = không thử lại). */
export function extractImage(json) {
  const block = json?.promptFeedback?.blockReason;
  if (block) throw new NonRetryableError(`Gemini từ chối tạo ảnh (blockReason: ${block}).`, { userMessage: "Gemini từ chối tạo ảnh này vì bộ lọc an toàn. Hãy chỉnh yêu cầu hoặc dùng ảnh tư thế có sẵn." });
  const cand = json?.candidates?.[0];
  const part = (cand?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) {
    const reason = cand?.finishReason || "unknown";
    if (/SAFETY|PROHIBITED|BLOCK/i.test(reason)) throw new NonRetryableError(`Không có ảnh (finishReason: ${reason}).`, { userMessage: "Gemini không tạo ảnh vì bộ lọc an toàn. Hãy chỉnh yêu cầu hoặc dùng ảnh tư thế có sẵn." });
    throw new RetryableError(`Response không có ảnh (finishReason: ${reason}).`, { transient: false });
  }
  return { mimeType: part.inlineData.mimeType || "image/png", base64: part.inlineData.data };
}

/**
 * @param {{model?:string, size?:string, aspectRatio?:string, prompt:string, references?:Array<{mimeType,data}>, slug:string, subtask:string, locale?:string,
 *   signal?:AbortSignal, fetchImpl?:Function, ledger?:Function, sleep?:Function, config?:object, env?:object, timeoutMs?:number}} o
 * @returns {Promise<{buffer:Buffer, mimeType:string, ext:string, costUsd:number, model:string}>}
 */
export async function generateImage(o) {
  const config = o.config || loadProductConfig();
  const settings = imageSettings(o.env || process.env, config);
  const model = o.model || settings.id;
  const size = o.size || settings.size;
  const aspectRatio = o.aspectRatio || settings.aspectRatio;
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  const ledger = o.ledger || appendCostEntry;
  const key = apiKey();
  if (!key) throw new NonRetryableError("Thiếu GEMINI_API_KEY.", { userMessage: "Server chưa cấu hình GEMINI_API_KEY." });
  const timeoutMs = o.timeoutMs || config.scenes.imageTimeoutMs;
  const body = JSON.stringify(buildImageRequest({ prompt: o.prompt, references: o.references, aspectRatio, size }));
  const row = { slug: o.slug, locale: o.locale, task: "product-image", subtask: o.subtask, model };

  return withRetry(
    async (attempt) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
      let res;
      try {
        res = await fetchImpl(`${API}/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal });
      } catch (err) {
        if (o.signal?.aborted) throw err;
        const reason = redactKey(err.name === "TimeoutError" || err.name === "AbortError" ? `timeout sau ${timeoutMs / 1000}s` : `network: ${err.message}`, key);
        ledger({ ...row, status: "error", errorMessage: reason, attempt });
        throw new RetryableError(reason, { userMessage: "Không kết nối được tới Gemini để tạo ảnh, thử lại sau.", transient: true });
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        ledger({ ...row, status: "error", httpStatus: res.status, errorMessage: redactKey(text, key).slice(0, 400), attempt });
        throw classifyPaidApiError({ httpStatus: res.status, bodyText: text, model });
      }
      const json = await res.json().catch(() => { throw new RetryableError("Response không phải JSON hợp lệ."); });
      let image;
      try {
        image = extractImage(json);
      } catch (err) {
        ledger({ ...row, status: "error", httpStatus: res.status, errorMessage: err.message, attempt });
        throw err;
      }
      const costUsd = calcImageCost(model, 1, { size, batch: false });
      ledger({ ...row, status: "success", httpStatus: res.status, imageCount: 1, costUsd, attempt });
      return { buffer: Buffer.from(image.base64, "base64"), mimeType: image.mimeType, ext: EXT_BY_MIME[image.mimeType] || ".png", costUsd, model };
    },
    { maxAttempts: config.scenes.imageMaxAttempts, baseDelayMs: 1500, label: "Tạo ảnh Gemini", sleepFn: o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))), onRetryableError: () => {} },
  );
}
