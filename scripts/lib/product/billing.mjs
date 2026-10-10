// Gemini billing cho chế độ "Giới thiệu sản phẩm". Model tạo ảnh và Veo KHÔNG có gói miễn phí: tài khoản chưa bật thanh toán gọi vào là báo lỗi.
// Không có API nào hỏi thẳng "đã bật billing chưa", nên:
//   1. Người dùng đặt GEMINI_BILLING_ENABLED=1 trong .env sau khi bật thanh toán (docs/product-showcase.md) -> nguồn "Tự động" mới mở.
//   2. Dù cờ bật, nếu lời gọi thật báo lỗi billing/quota-0/model không còn -> đóng băng nguồn tự động ở tiến trình này và tự lùi về ảnh tư thế.
import { NonRetryableError, classifyGeminiHttpError, parseGeminiError } from "../gemini-retry.mjs";
import { billingFlag } from "./config.mjs";

/** Lời gọi có phí bị từ chối vì tài khoản chưa bật billing / hết hạn mức miễn phí = 0. Hệ quả: chuyển sang nguồn "pose", KHÔNG làm hỏng job. */
export class BillingRequiredError extends NonRetryableError {}
/** Model không tồn tại / đã ngừng (vd gemini-2.5-flash-image sau 2026-10-02). Cũng lùi về "pose" nhưng không đổ lỗi cho billing. */
export class ModelUnavailableError extends NonRetryableError {}

export const BILLING_MESSAGE_VI =
  "Tài khoản Gemini chưa bật thanh toán (billing) nên model tạo ảnh/video chưa dùng được. Đã tự chuyển sang ảnh tư thế có sẵn của HuyK — không mất phí. " +
  "Muốn dùng nguồn Tự động: bật thanh toán trên Google AI Studio rồi đặt GEMINI_BILLING_ENABLED=1 trong .env (xem docs/product-showcase.md).";

const BILLING_RE = /billing|free[\s_-]?tier|pre-?paid|payment|upgrade your plan|enable.*(api|billing)|credits? (depleted|exhausted)/i;
const LIMIT_ZERO_RE = /limit:\s*0\b/i;
const MODEL_GONE_RE = /(is not found|not supported for|no longer (available|supported)|deprecated|shut ?down|decommission)/i;

/**
 * Lỗi HTTP của API sinh ảnh/video -> Error có phân loại. Giống classifyGeminiHttpError nhưng nhận ra 3 trường hợp riêng của model có phí.
 * @param {{httpStatus:number, bodyText:string, model:string}} p
 */
export function classifyPaidApiError({ httpStatus, bodyText, model }) {
  const info = { ...parseGeminiError(httpStatus, bodyText), model };
  const text = `${info.message} ${info.quotaId || ""} ${info.quotaMetric || ""} ${info.status || ""}`;
  const quotaZero = LIMIT_ZERO_RE.test(`${text} ${bodyText}`) || /FreeTier/i.test(`${info.quotaId || ""} ${info.quotaMetric || ""}`);
  if ((httpStatus === 429 && quotaZero) || ((httpStatus === 403 || httpStatus === 400 || httpStatus === 429) && BILLING_RE.test(text))) {
    return new BillingRequiredError(`Gemini API HTTP ${httpStatus}: cần bật billing cho ${model} (${info.quotaId || info.status || "?"})`, { userMessage: BILLING_MESSAGE_VI, info });
  }
  if (httpStatus === 404 || (httpStatus === 400 && MODEL_GONE_RE.test(text))) {
    return new ModelUnavailableError(`Gemini API HTTP ${httpStatus}: model ${model} không dùng được (${info.message.slice(0, 120)})`, {
      userMessage: `Model "${model}" không còn dùng được (đã ngừng hoặc sai tên). Đã chuyển sang ảnh tư thế có sẵn — đổi IMAGE model trong .env (PRODUCT_IMAGE_MODEL) rồi thử lại.`,
      info,
    });
  }
  return classifyGeminiHttpError({ httpStatus, bodyText, model });
}

/** Trạng thái billing trong tiến trình: cờ .env + "đã bị từ chối khi gọi thật". */
export function createBillingState({ env = process.env } = {}) {
  let blocked = null; // { reason, at }
  return {
    isEnabled: () => billingFlag(env) && !blocked,
    block(reason) {
      blocked = { reason: String(reason || BILLING_MESSAGE_VI), at: new Date().toISOString() };
    },
    reset() {
      blocked = null;
    },
    /** Cho UI: có mở nguồn "Tự động" / clip AI không, và nếu không thì vì sao (tiếng Việt). */
    status() {
      if (!billingFlag(env)) {
        return { enabled: false, reason: "Tài khoản Gemini chưa bật billing — model tạo ảnh và video AI không có gói miễn phí. Bật thanh toán rồi đặt GEMINI_BILLING_ENABLED=1 trong .env (xem docs/product-showcase.md)." };
      }
      if (blocked) return { enabled: false, reason: blocked.reason, blockedAt: blocked.at };
      return { enabled: true, reason: "" };
    },
  };
}

export const billing = createBillingState();
