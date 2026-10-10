// Clip AI cho cảnh mở đầu (tuỳ chọn): adapter dạng REGISTRY — thêm nhà cung cấp video khác bằng registerClipAdapter(id, adapter) không phải sửa luồng dựng.
// Adapter: { id, estimateUsd({model,seconds,resolution}) -> number|null, generate({image, prompt, model, seconds, resolution, aspectRatio, slug, subtask, locale, signal}) -> {buffer, mimeType, costUsd} }.
// Mặc định có "veo" (Veo 3.1 Lite image-to-video qua predictLongRunning). Lỗi / vượt trần / chưa billing -> nơi gọi tự lùi về hiệu ứng GSAP.
import { calcVideoCost } from "../../../config/pricing.mjs";
import { appendCostEntry } from "../cost-ledger.mjs";
import { RetryableError, NonRetryableError, redactKey } from "../gemini-retry.mjs";
import { classifyPaidApiError } from "./billing.mjs";
import { clipSettings } from "./config.mjs";

const API = "https://generativelanguage.googleapis.com/v1beta";
const apiKey = () => (process.env.GEMINI_API_KEY || "").trim();

const registry = new Map();
export const registerClipAdapter = (adapter) => { registry.set(adapter.id, adapter); return adapter; };
export const getClipAdapter = (id) => registry.get(id) || null;
export const listClipAdapters = () => [...registry.keys()];

/** Đường dẫn video trong response thao tác dài của Veo (Gemini API). */
export function videoUriOf(op) {
  const r = op?.response || {};
  return r.generateVideoResponse?.generatedSamples?.[0]?.video?.uri || r.generatedVideos?.[0]?.video?.uri || r.videos?.[0]?.uri || null;
}

export function createVeoAdapter({ fetchImpl, sleep, now, ledger } = {}) {
  return {
    id: "veo",
    estimateUsd: ({ model, seconds, resolution }) => calcVideoCost(model, seconds, resolution),
    async generate({ image, prompt, model, seconds, resolution, aspectRatio, slug, subtask, locale, signal, pollIntervalMs, timeoutMs }) {
      const f = fetchImpl || globalThis.fetch;
      const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
      const clock = now || Date.now;
      const log = ledger || appendCostEntry;
      const key = apiKey();
      if (!key) throw new NonRetryableError("Thiếu GEMINI_API_KEY.", { userMessage: "Server chưa cấu hình GEMINI_API_KEY." });
      const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
      const row = { slug, locale, task: "product-clip", subtask, model };
      const call = async (url, init) => {
        let res;
        try {
          res = await f(url, { ...init, headers, signal });
        } catch (e) {
          if (signal?.aborted) throw e;
          log({ ...row, status: "error", errorMessage: redactKey(e.message, key) });
          throw new RetryableError(`network: ${redactKey(e.message, key)}`, { userMessage: "Không kết nối được tới Gemini để tạo clip.", transient: true });
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          log({ ...row, status: "error", httpStatus: res.status, errorMessage: redactKey(text, key).slice(0, 400) });
          throw classifyPaidApiError({ httpStatus: res.status, bodyText: text, model });
        }
        return res;
      };
      const created = await (await call(`${API}/models/${model}:predictLongRunning`, {
        method: "POST",
        body: JSON.stringify({ instances: [{ prompt, image: { inlineData: { mimeType: image.mimeType, data: image.data } } }], parameters: { aspectRatio, resolution, durationSeconds: String(seconds) } }),
      })).json();
      if (!created?.name) throw new RetryableError("Veo không trả tên thao tác.");
      const started = clock();
      let op = created;
      while (op.done !== true) {
        if (clock() - started > timeoutMs) throw new RetryableError(`Veo quá hạn chờ (${Math.round(timeoutMs / 60000)} phút).`, { userMessage: "Tạo clip AI quá lâu — dùng hiệu ứng GSAP thay thế." });
        await wait(pollIntervalMs);
        op = await (await call(`${API}/${created.name}`, { method: "GET" })).json();
      }
      if (op.error) throw new RetryableError(`Veo lỗi: ${op.error.message || "không rõ"}`, { userMessage: "Veo không tạo được clip — dùng hiệu ứng GSAP thay thế." });
      const uri = videoUriOf(op);
      if (!uri) throw new RetryableError("Veo xong nhưng không có video (có thể bị bộ lọc an toàn chặn).", { userMessage: "Veo không trả video (có thể bị bộ lọc chặn) — dùng hiệu ứng GSAP thay thế." });
      const video = await call(uri, { method: "GET" });
      const buffer = Buffer.from(await video.arrayBuffer());
      const costUsd = calcVideoCost(model, seconds, resolution);
      log({ ...row, status: "success", costUsd: costUsd ?? 0 });
      return { buffer, mimeType: "video/mp4", costUsd: costUsd ?? 0 };
    },
  };
}

registerClipAdapter(createVeoAdapter());
export { clipSettings };
