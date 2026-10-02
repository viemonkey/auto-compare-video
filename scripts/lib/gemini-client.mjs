// Gọi Gemini dạng văn bản → JSON (không ảnh) cho các tác vụ nhỏ: viết lại / dịch nghĩa 1 dòng ở Bước 2.
// Dùng lại cơ chế retry/fallback hiện có (gemini-retry.mjs) và sổ chi phí (cost-ledger.mjs). Khác generate-compare-content.mjs:
// nhận AbortSignal (người dùng gửi yêu cầu mới / đóng trang -> huỷ request cũ).
//
// Model/key: GEMINI_API_KEY, GEMINI_MODEL, GEMINI_FALLBACK_MODEL từ process.env (server nạp .env lúc khởi động).
import { calcContentCost } from "../../config/pricing.mjs";
import { appendCostEntry } from "./cost-ledger.mjs";
import { resolveGeminiModels } from "./gemini-models.mjs";
import {
  RetryableError,
  NonRetryableError,
  classifyGeminiHttpError,
  describeGeminiErrorForLog,
  redactKey,
  runWithModelFallback,
  withRetry,
} from "./gemini-retry.mjs";

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 45_000;

const apiKey = () => (process.env.GEMINI_API_KEY || "").trim();

/** Lỗi do người dùng huỷ (signal.abort) — KHÔNG retry, KHÔNG ghi nhận như lỗi Gemini. */
export class AbortedError extends Error {
  constructor() {
    super("Yêu cầu đã bị huỷ.");
    this.name = "AbortedError";
  }
}

async function callOnce({ systemPrompt, userText, schema, model, signal, attempt, ledger }) {
  const key = apiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: { temperature: 0.4, responseMimeType: "application/json", responseSchema: schema },
  };
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: combined });
  } catch (err) {
    if (signal?.aborted) throw new AbortedError();
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    const reason = redactKey(isTimeout ? `Gemini request timeout sau ${REQUEST_TIMEOUT_MS / 1000}s` : `Gemini request thất bại (network): ${err.message}`, key);
    appendCostEntry({ ...ledger, model, status: "error", errorMessage: reason, attempt });
    throw new RetryableError(reason, {
      userMessage: isTimeout ? "Gemini không phản hồi kịp (timeout), vui lòng thử lại." : "Không kết nối được tới Gemini, vui lòng kiểm tra mạng rồi thử lại.",
      transient: true,
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    appendCostEntry({ ...ledger, model, status: "error", httpStatus: res.status, errorMessage: redactKey(errText, key).slice(0, 500), attempt });
    const classified = classifyGeminiHttpError({ httpStatus: res.status, bodyText: errText, model });
    console.warn(`[gemini-error] ${describeGeminiErrorForLog(classified, { bodyText: errText, apiKey: key })}`);
    throw classified;
  }

  const json = await res.json().catch((e) => {
    throw new RetryableError(`Gemini response không phải JSON hợp lệ: ${e.message}`);
  });
  // HTTP 200 luôn được tính phí (kể cả khi nội dung dùng không được) — ghi sổ TRƯỚC khi kiểm nội dung.
  const usage = json?.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
  appendCostEntry({ ...ledger, model, status: "success", httpStatus: res.status, inputTokens, outputTokens, costUsd: calcContentCost(model, inputTokens, outputTokens), attempt });

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const blockReason = json?.promptFeedback?.blockReason;
    if (blockReason) throw new NonRetryableError(`Gemini từ chối xử lý nội dung (blockReason: ${blockReason}).`);
    throw new RetryableError("Gemini response không có nội dung text.");
  }
  return text;
}

/**
 * Gọi Gemini lấy 1 object JSON theo `schema`. `validate(parsed)` (tuỳ chọn) ném RetryableError khi kết quả sai hình dạng.
 * @param {{systemPrompt:string, userText:string, schema:object, validate?:(o:object)=>object, signal?:AbortSignal,
 *   ledger:{task:string, subtask?:string, slug?:string|null, locale?:string}}} args
 * @returns {Promise<{result:object, model:string}>}
 */
export async function generateJson({ systemPrompt, userText, schema, validate = (o) => o, signal, ledger }) {
  if (!apiKey()) throw new NonRetryableError("Thiếu GEMINI_API_KEY trong .env (repo root).", { userMessage: "Server chưa cấu hình GEMINI_API_KEY." });
  const { primary, fallback } = resolveGeminiModels();
  return runWithModelFallback({
    primaryModel: primary,
    fallbackModel: fallback,
    log: (msg) => console.warn(`[gemini] ${msg}`),
    run: async (model) => ({
      model,
      primaryModel: primary,
      usedFallback: model !== primary,
      result: await withRetry(
        async (attempt) => {
          const text = await callOnce({ systemPrompt, userText, schema, model, signal, attempt, ledger });
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new RetryableError(`Gemini trả về không phải JSON hợp lệ: ${text.slice(0, 200)}`);
          }
          return validate(parsed);
        },
        {
          maxAttempts: MAX_ATTEMPTS,
          baseDelayMs: RETRY_BASE_DELAY_MS,
          label: "Gemini call",
          // huỷ giữa các lần thử cũng phải dừng ngay
          sleepFn: (ms) =>
            new Promise((resolve, reject) => {
              const t = setTimeout(resolve, ms);
              signal?.addEventListener("abort", () => { clearTimeout(t); reject(new AbortedError()); }, { once: true });
            }),
          onRetryableError: (err, attempt, waitMs) =>
            console.warn(`[attempt ${attempt}/${MAX_ATTEMPTS}] ${redactKey(err.message, apiKey())}${attempt < MAX_ATTEMPTS ? ` — thử lại sau ${(waitMs / 1000).toFixed(1)}s` : ""}`),
        },
      ),
    }),
  });
}
