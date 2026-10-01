// Phân loại lỗi + vòng retry cho lần gọi Gemini sinh kịch bản.
//   - RetryableError    : lỗi TỪ Gemini/mạng (429 theo phút, 5xx, timeout, fetch failed, response rỗng/không
//                         phải JSON/sai schema) — đáng thử lại. Có thể mang `retryAfterMs` (từ RetryInfo).
//   - DailyQuotaError   : 429 hết quota THEO NGÀY — retry vô ích; nơi gọi chuyển model dự phòng hoặc báo lỗi.
//   - NonRetryableError : lỗi Gemini nhưng retry vô ích (401/403/400, safety block, 2 ảnh không so sánh được).
//   - Mọi lỗi khác (ReferenceError, TypeError, SyntaxError...) = lỗi LẬP TRÌNH -> throw ngay, không retry.
//
// Mọi lỗi Gemini có `userMessage` (tiếng Việt, KHÔNG chứa JSON gốc) để hiện cho người dùng; chi tiết
// gốc chỉ được ghi vào log server (xem describeGeminiErrorForLog()).
export class RetryableError extends Error {
  constructor(message, { userMessage, retryAfterMs, info } = {}) {
    super(message);
    this.userMessage = userMessage || message;
    this.retryAfterMs = retryAfterMs ?? null;
    this.info = info || null;
  }
}
export class NonRetryableError extends Error {
  constructor(message, { userMessage, info } = {}) {
    super(message);
    this.userMessage = userMessage || message;
    this.info = info || null;
  }
}
export class DailyQuotaError extends NonRetryableError {}

export function isRetryableError(err) {
  return err instanceof RetryableError;
}

/** Cộng thêm vào thời gian chờ Gemini yêu cầu để chắc chắn đã qua cửa sổ giới hạn. */
export const RETRY_DELAY_PADDING_MS = 1500;
/** Không có retryDelay thì báo người dùng chờ chừng này giây (quota theo phút reset sau ~1 phút). */
export const DEFAULT_RATE_LIMIT_WAIT_S = 60;

const API_KEY_RE = /AIza[0-9A-Za-z_-]{20,}/g;
/** Che API key nếu lỡ lọt vào chuỗi (URL lỗi fetch, echo từ server...). */
export function redactKey(text, apiKey) {
  let s = String(text ?? "").replace(API_KEY_RE, "AIza****");
  if (apiKey && apiKey.length >= 8) s = s.split(apiKey).join("****");
  return s;
}

/** "10s" | "10.5s" | "1.5" -> ms; không hợp lệ -> null. */
export function parseRetryDelay(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 1000);
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d+(?:\.\d+)?)s?$/i);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

/**
 * Đọc body lỗi Gemini (JSON `{error:{code,status,message,details:[...]}}`) thành các trường có cấu trúc:
 * RetryInfo.retryDelay, QuotaFailure.violations[].quotaId/quotaMetric. Body không phải JSON -> chỉ có status.
 * quotaScope: "day" nếu quotaId/quotaMetric chứa "PerDay", "minute" nếu "PerMinute", ngược lại null.
 */
export function parseGeminiError(httpStatus, bodyText) {
  const info = {
    httpStatus,
    code: null,
    status: null,
    message: "",
    retryDelayMs: null,
    quotaId: null,
    quotaMetric: null,
    quotaScope: null,
  };
  let err = null;
  try {
    err = JSON.parse(bodyText)?.error ?? null;
  } catch {
    // body không phải JSON
  }
  if (!err || typeof err !== "object") {
    info.message = String(bodyText ?? "").slice(0, 300);
    return info;
  }
  info.code = err.code ?? null;
  info.status = err.status ?? null;
  info.message = String(err.message ?? "");

  const quotaIds = [];
  const quotaMetrics = [];
  for (const d of Array.isArray(err.details) ? err.details : []) {
    const type = String(d?.["@type"] ?? "");
    if (type.endsWith("google.rpc.RetryInfo")) {
      info.retryDelayMs = parseRetryDelay(d.retryDelay);
    } else if (type.endsWith("google.rpc.QuotaFailure")) {
      for (const v of Array.isArray(d.violations) ? d.violations : []) {
        if (v?.quotaId) quotaIds.push(String(v.quotaId));
        if (v?.quotaMetric) quotaMetrics.push(String(v.quotaMetric));
      }
    }
  }
  info.quotaId = quotaIds[0] ?? null;
  info.quotaMetric = quotaMetrics[0] ?? null;

  const haystack = [...quotaIds, ...quotaMetrics].join(" ");
  if (/PerDay/i.test(haystack)) info.quotaScope = "day";
  else if (/PerMinute/i.test(haystack)) info.quotaScope = "minute";
  else if (/per\s*day/i.test(info.message)) info.quotaScope = "day";
  return info;
}

/**
 * Chuyển 1 response HTTP lỗi của Gemini thành Error có phân loại + thông báo tiếng Việt.
 * @param {{httpStatus:number, bodyText:string, model:string}} p
 */
export function classifyGeminiHttpError({ httpStatus, bodyText, model }) {
  const info = { ...parseGeminiError(httpStatus, bodyText), model };
  const raw = `Gemini API lỗi HTTP ${httpStatus}`;

  if (httpStatus === 429) {
    if (info.quotaScope === "day") {
      return new DailyQuotaError(`${raw}: hết quota theo ngày (${info.quotaId || info.quotaMetric || "?"})`, {
        userMessage: `Đã hết lượt gọi Gemini trong ngày của model ${model}. Thử lại vào ngày mai hoặc đổi model/nâng gói.`,
        info,
      });
    }
    const waitS = Math.ceil((info.retryDelayMs ?? DEFAULT_RATE_LIMIT_WAIT_S * 1000) / 1000);
    return new RetryableError(`${raw}: rate limit`, {
      userMessage: `Gemini đang giới hạn tốc độ, vui lòng thử lại sau ${waitS} giây.`,
      retryAfterMs: info.retryDelayMs,
      info,
    });
  }
  if (httpStatus === 503) {
    return new RetryableError(`${raw}: quá tải`, {
      userMessage: "Gemini đang quá tải, vui lòng thử lại sau vài phút.",
      info,
    });
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return new NonRetryableError(`${raw}: từ chối truy cập`, {
      userMessage: `Gemini từ chối truy cập (HTTP ${httpStatus}) — kiểm tra lại GEMINI_API_KEY.`,
      info,
    });
  }
  if (httpStatus === 400) {
    return new NonRetryableError(`${raw}: request không hợp lệ`, {
      userMessage: "Gemini báo request không hợp lệ (HTTP 400) — xem log server để biết chi tiết.",
      info,
    });
  }
  // 500/502/504... — lỗi tạm thời phía Gemini
  return new RetryableError(raw, {
    userMessage: `Gemini đang gặp lỗi tạm thời (HTTP ${httpStatus}), vui lòng thử lại sau vài phút.`,
    info,
  });
}

/** 1 dòng log server (không xuống dòng): model, mã lỗi, quotaId, retryDelay + body gốc rút gọn. Che API key. */
export function describeGeminiErrorForLog(err, { bodyText, apiKey } = {}) {
  const i = err?.info;
  if (!i) return redactKey(err?.message ?? String(err), apiKey);
  const parts = [
    `model=${i.model ?? "?"}`,
    `http=${i.httpStatus ?? "?"}`,
    `status=${i.status ?? "-"}`,
    `quotaId=${i.quotaId ?? "-"}`,
    `quotaMetric=${i.quotaMetric ?? "-"}`,
    `scope=${i.quotaScope ?? "-"}`,
    `retryDelay=${i.retryDelayMs != null ? `${i.retryDelayMs / 1000}s` : "-"}`,
  ];
  let line = parts.join(" ");
  if (bodyText) line += ` raw=${JSON.stringify(String(bodyText).slice(0, 800))}`;
  return redactKey(line, apiKey);
}

/**
 * Chạy `run(model)` với model chính; nếu model chính HẾT QUOTA NGÀY (DailyQuotaError) và có model dự
 * phòng khác thì chạy lại 1 lần với model dự phòng, không có thì ném lỗi ngay (userMessage tiếng Việt).
 * Mọi lỗi khác (kể cả lỗi lập trình) đi thẳng ra ngoài.
 * @param {{primaryModel:string, fallbackModel?:string, run:(model:string)=>Promise<T>, log?:(msg:string)=>void}} p
 */
export async function runWithModelFallback({ primaryModel, fallbackModel, run, log = () => {} }) {
  try {
    return await run(primaryModel);
  } catch (err) {
    if (!(err instanceof DailyQuotaError) || !fallbackModel || fallbackModel === primaryModel) throw err;
    log(`model ${primaryModel} hết quota theo ngày — chuyển sang model dự phòng ${fallbackModel}.`);
    return run(fallbackModel);
  }
}

/**
 * Thông báo lỗi cho UI từ stdout/stderr của generate-compare-content.mjs: dòng "THẤT BẠI: ..." cuối cùng
 * (đã là tiếng Việt, không kèm JSON gốc). Không có dòng đó (lỗi không lường trước) thì rơi về vài dòng cuối.
 */
export function extractFailureMessage(out) {
  const text = String(out ?? "");
  const failLine = text.split("\n").reverse().find((l) => l.startsWith("THẤT BẠI:"));
  if (failLine) return failLine.slice("THẤT BẠI:".length).trim();
  return text.trim().split("\n").slice(-6).join("\n") || "Gemini thất bại.";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Thời gian chờ trước lần thử kế tiếp: theo retryDelay Gemini (+ padding) nếu có, không thì backoff cố định. */
export function retryWaitMs(err, attempt, baseDelayMs) {
  return err?.retryAfterMs != null ? err.retryAfterMs + RETRY_DELAY_PADDING_MS : baseDelayMs * attempt;
}

/**
 * @param {(attempt:number) => Promise<T>} fn
 * @param {{maxAttempts:number, baseDelayMs:number, label?:string, sleepFn?:(ms:number)=>Promise<void>,
 *          onRetryableError?:(err:Error, attempt:number, waitMs:number)=>void}} opts
 */
export async function withRetry(fn, { maxAttempts, baseDelayMs, label = "call", sleepFn = sleep, onRetryableError }) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!isRetryableError(err)) throw err; // NonRetryable/DailyQuota + lỗi lập trình: dừng ngay
      lastErr = err;
      const wait = attempt < maxAttempts ? retryWaitMs(err, attempt, baseDelayMs) : 0;
      if (onRetryableError) onRetryableError(err, attempt, wait);
      else console.warn(`[attempt ${attempt}/${maxAttempts}] ${err.message}`);
      if (attempt < maxAttempts) await sleepFn(wait);
    }
  }
  // Giữ userMessage của lỗi cuối để người dùng thấy thông báo tiếng Việt, không phải JSON.
  throw new RetryableError(`${label} thất bại sau ${maxAttempts} lần thử. Lỗi cuối cùng: ${lastErr.message}`, {
    userMessage: lastErr.userMessage,
    info: lastErr.info,
  });
}
