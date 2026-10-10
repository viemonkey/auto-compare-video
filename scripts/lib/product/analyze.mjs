// Mốc 2 — Gemini Flash NHÌN ẢNH sản phẩm, tự viết "mô tả khoá sản phẩm" (màu kim loại, kiểu món, số hàng đá, hình dạng/kích thước đá, cách đính, hoa văn)
// + toạ độ khung bao. Mô tả này sẽ được dán nguyên văn vào prompt tạo ảnh/clip: nếu để chữ trong prompt mâu thuẫn với ảnh thì model làm theo chữ và ra sai hàng.
// Form KHÔNG đi vào bước này (xem prompts/product-analysis.md); đối chiếu form làm ở bước kịch bản.
import { generateJson } from "../gemini-client.mjs";
import { RetryableError } from "../gemini-retry.mjs";
import { loadProductConfig } from "./config.mjs";
import { productPromptPath, renderSection } from "./prompts.mjs";
import { toJpegBase64, findContentBox } from "./images.mjs";
import { textModels } from "./estimate.mjs";

export const PRODUCT_KINDS = ["ring", "necklace", "earring", "bracelet", "other"];
const VIEWS = ["front", "side", "top", "detail", "other"];

const bboxSchema = (nullable) => ({
  type: "object",
  nullable,
  required: ["x", "y", "w", "h"],
  properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
});

export const analysisSchema = {
  type: "object",
  required: ["product_kind", "metal_color", "item_style", "stone_rows", "stone_shape", "stone_size_relative", "setting_style", "patterns_and_details", "moving_parts", "lock_text_en", "lock_text_vi", "images"],
  properties: {
    product_kind: { type: "string", enum: PRODUCT_KINDS },
    metal_color: { type: "string", maxLength: 80 },
    item_style: { type: "string", maxLength: 160 },
    stone_rows: { type: "integer", nullable: true },
    stone_shape: { type: "string", maxLength: 80 },
    stone_size_relative: { type: "string", maxLength: 160 },
    setting_style: { type: "string", maxLength: 160 },
    patterns_and_details: { type: "string", maxLength: 240 },
    moving_parts: { type: "string", maxLength: 160 },
    lock_text_en: { type: "string", maxLength: 900 },
    lock_text_vi: { type: "string", maxLength: 700 },
    images: {
      type: "array",
      items: {
        type: "object",
        required: ["index", "bbox", "stone_bbox", "view", "has_logo_or_text", "note"],
        properties: { index: { type: "integer" }, bbox: bboxSchema(false), stone_bbox: bboxSchema(true), view: { type: "string", enum: VIEWS }, has_logo_or_text: { type: "boolean" }, note: { type: "string", maxLength: 200 } },
      },
    },
  },
};

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v)));
function sanitizeBox(b) {
  if (!b || ![b.x, b.y, b.w, b.h].every((v) => Number.isFinite(Number(v)))) return null;
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  const w = Math.min(1 - x, clamp01(b.w));
  const h = Math.min(1 - y, clamp01(b.h));
  return w >= 0.02 && h >= 0.02 ? { x, y, w, h } : null;
}
export function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Khung bao cuối cùng của 1 ảnh: ưu tiên khung Gemini trả; nếu hợp lệ nhưng lệch hẳn khung đo bằng điểm ảnh (IoU < ngưỡng) hoặc không hợp lệ thì dùng khung đo được.
 * @returns {{box:{x,y,w,h}|null, source:"gemini"|"detected"|"none"}}
 */
export function reconcileBox(geminiBox, detectedBox, minIou = 0.3) {
  const g = sanitizeBox(geminiBox);
  if (g && detectedBox) return iou(g, detectedBox) >= minIou ? { box: g, source: "gemini" } : { box: detectedBox, source: "detected" };
  if (g) return { box: g, source: "gemini" };
  if (detectedBox) return { box: detectedBox, source: "detected" };
  return { box: null, source: "none" };
}

/**
 * @param {{project:object, imageFiles:string[], ledgerSlug:string, locale?:string, signal?:AbortSignal, generate?:Function, config?:object, env?:object}} o
 * @returns {Promise<object>} analysis đã chuẩn hoá (lock + images[bbox, stoneBox, boxSource]) — ghi nguyên vào project.analysis
 */
export async function analyzeProduct({ imageFiles, ledgerSlug, locale = null, signal, generate = generateJson, config = loadProductConfig(), env = process.env, promptFile = productPromptPath("product-analysis.md") }) {
  if (!imageFiles.length) throw new Error("Chưa có ảnh sản phẩm để phân tích.");
  const { maxPx, timeoutMs } = config.script.vision;
  const images = [];
  for (const f of imageFiles) images.push(await toJpegBase64(f, { maxPx }));
  const detected = [];
  for (const f of imageFiles) detected.push(await findContentBox(f).catch(() => null));

  const systemPrompt = renderSection(promptFile, "system", { imageCount: images.length });
  const userText = renderSection(promptFile, "user", { imageCount: images.length, imageList: images.map((_, i) => `- Ảnh ${i + 1} (index ${i})`).join("\n") });
  const model = textModels(env, config).analysis;
  const { result, model: usedModel } = await generate({
    systemPrompt,
    userText,
    schema: analysisSchema,
    images,
    timeoutMs,
    models: { primary: model, fallback: process.env.GEMINI_FALLBACK_MODEL || "" },
    ledger: { task: "content-generation", subtask: "product-analysis", slug: ledgerSlug, locale },
    signal,
    validate: (o) => {
      const words = String(o.lock_text_en || "").trim().split(/\s+/).filter(Boolean).length;
      if (words < 20) throw new RetryableError("Mô tả khoá sản phẩm quá ngắn (cần đoạn mô tả đầy đủ).");
      if (!Array.isArray(o.images) || o.images.length < images.length) throw new RetryableError("Thiếu khung bao cho một số ảnh.");
      return o;
    },
  });

  const perImage = images.map((_, i) => {
    const r = result.images.find((x) => x.index === i) || result.images[i] || {};
    const { box, source } = reconcileBox(r.bbox, detected[i]);
    return { index: i, bbox: box, boxSource: source, stoneBbox: sanitizeBox(r.stone_bbox), view: VIEWS.includes(r.view) ? r.view : "other", hasLogoOrText: !!r.has_logo_or_text, note: String(r.note || "") };
  });
  return {
    model: usedModel || model,
    kind: PRODUCT_KINDS.includes(result.product_kind) ? result.product_kind : "other",
    lock: {
      metalColor: result.metal_color, itemStyle: result.item_style, stoneRows: result.stone_rows ?? null, stoneShape: result.stone_shape,
      stoneSizeRelative: result.stone_size_relative, settingStyle: result.setting_style, patternsAndDetails: result.patterns_and_details, movingParts: result.moving_parts,
    },
    lockText: String(result.lock_text_en).trim(),
    lockTextVi: String(result.lock_text_vi || "").trim(),
    images: perImage,
  };
}
