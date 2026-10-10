// Kiểm ảnh cảnh có HuyK bằng Gemini Flash (vision) theo 4 tiêu chí: đúng sản phẩm / giống mặt / tay không lỗi / đúng trang phục.
// Trả điểm 0-10 + lý do tiếng Việt từng tiêu chí. Dùng cho cả ảnh Gemini tạo và ảnh người dùng tự tải (nguồn manual — kết quả chỉ để CẢNH BÁO).
import { generateJson } from "../gemini-client.mjs";
import { loadProductConfig } from "./config.mjs";
import { productPromptPath, renderSection } from "./prompts.mjs";
import { textModels } from "./estimate.mjs";
import { resolveGeminiModels } from "../gemini-models.mjs";
import { referenceLayout } from "./scene-prompts.mjs";
import { checkCacheKey, sha256 } from "./scene-cache.mjs";
import { slotLabelOf } from "./scenes.mjs";

// Gemini không nhận enum chứa chuỗi rỗng ("cannot be empty"): "none" = không lỗi (đổi về "" khi đọc kết quả).
export const ISSUE_CODES = ["none", "product-color", "product-rows", "product-stones", "product-detail", "product-hidden", "face-off", "hand-fingers", "hand-size", "outfit-wrong", "other"];
export const CRITERIA_LABEL_VI = { product: "Đúng sản phẩm", face: "Giống mặt HuyK", hands: "Tay không lỗi", outfit: "Đúng trang phục" };

const scoreSchema = { type: "integer", nullable: true };
export const checkSchema = {
  type: "object",
  required: ["product", "face", "hands", "outfit", "product_bbox"],
  properties: {
    ...Object.fromEntries(["product", "face", "hands", "outfit"].map((k) => [k, { type: "object", required: ["score", "reason", "issue"], properties: { score: scoreSchema, reason: { type: "string", maxLength: 220 }, issue: { type: "string", enum: ISSUE_CODES } } }])),
    // khung bao CHẶT quanh trang sức trong ảnh (0–1) — để đặt chớp sáng / ánh sáng chạy đúng chỗ sản phẩm; không thấy thì null
    product_bbox: { type: "object", nullable: true, required: ["x", "y", "w", "h"], properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } } },
  },
};

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v)));
/** Khung bao hợp lệ (chuẩn hoá 0–1, kẹp trong ảnh, đủ lớn) hoặc null. */
export function sanitizeProductBox(b) {
  if (!b || ![b.x, b.y, b.w, b.h].every((v) => Number.isFinite(Number(v)))) return null;
  const x = clamp01(b.x), y = clamp01(b.y);
  const w = Math.min(1 - x, clamp01(b.w)), h = Math.min(1 - y, clamp01(b.h));
  return w >= 0.02 && h >= 0.02 ? { x, y, w, h } : null;
}

/** Điểm đạt khi MỌI tiêu chí đo được ≥ ngưỡng (tiêu chí không đo được = null, không tính). */
export function evaluateScores(scores, passScore) {
  const failed = Object.entries(scores).filter(([, v]) => typeof v === "number" && v < passScore).map(([k]) => k);
  return { pass: failed.length === 0, failed };
}

/** Điểm xếp hạng để chọn "ảnh tốt nhất": số tiêu chí đạt trước, rồi tổng điểm. */
export function rankScores(check, passScore) {
  if (!check?.scores) return -1;
  const vals = Object.values(check.scores).filter((v) => typeof v === "number");
  return vals.filter((v) => v >= passScore).length * 1000 + vals.reduce((a, b) => a + b, 0);
}

/**
 * @param {{image:{mimeType:string,data:string}, slot:string, lockText:string, refs:{products:object[], faces:object[], outfit:object|null}, ledgerSlug:string, locale?:string,
 *   cache?:object, generate?:Function, config?:object, env?:object, signal?:AbortSignal, promptFile?:string}} o
 * @returns {Promise<{scores:object, reasons:object, issues:object, pass:boolean, failed:string[], model:string, fromCache:boolean, notes:string[]}>}
 */
export async function checkSceneImage({ image, slot, lockText, refs, ledgerSlug, locale = null, cache = null, generate = generateJson, config = loadProductConfig(), env = process.env, signal, promptFile = productPromptPath("product-scene-check.md") }) {
  const layout = referenceLayout({ products: refs.products.length, faces: refs.faces.length, outfit: !!refs.outfit, lead: 1 });
  const guide = [
    "Ảnh 1 = ẢNH CẦN KIỂM.",
    refs.products.length ? `Ảnh ${layout.productRange} = ảnh sản phẩm gốc (đối chiếu "đúng sản phẩm").` : "",
    refs.faces.length ? `Ảnh ${layout.faceRange} = ảnh khuôn mặt chuẩn của host HuyK (đối chiếu "giống mặt").` : "",
    refs.outfit ? `Ảnh ${layout.outfitRef} = ảnh trang phục chuẩn.` : "",
  ].filter(Boolean).join("\n");
  const vars = { sceneLabel: slotLabelOf(slot, config), lockText, outfitText: config.host.outfit.text, imageGuide: guide, hasFaceRefs: refs.faces.length > 0, hasOutfitRef: !!refs.outfit };
  const systemPrompt = renderSection(promptFile, "system", vars);
  const userText = renderSection(promptFile, "user", vars);
  const images = [image, ...refs.products, ...refs.faces, ...(refs.outfit ? [refs.outfit] : [])];
  const models = textModels(env, config);
  const key = cache ? checkCacheKey({ model: models.check, prompt: systemPrompt + userText, imageHashes: images.map((i) => sha256(i.data)) }) : null;
  const hit = key && cache.getCheck(key);
  if (hit) return { ...hit, fromCache: true };

  const primary = models.check;
  const fallback = [resolveGeminiModels(env).primary].find((m) => m && m !== primary) || "";
  const { result, model } = await generate({
    systemPrompt, userText, schema: checkSchema, images, signal,
    models: { primary, fallback }, timeoutMs: config.script.vision.timeoutMs, temperature: 0.1,
    ledger: { task: "content-generation", subtask: "product-check", slug: ledgerSlug, locale },
  });
  const scores = {};
  const reasons = {};
  const issues = {};
  const notes = [];
  for (const k of config.scenes.check.criteria) {
    const r = result[k] || {};
    const raw = typeof r.score === "number" ? Math.max(0, Math.min(10, Math.round(r.score))) : null;
    scores[k] = k === "face" && !refs.faces.length ? null : raw; // không có ảnh mặt chuẩn thì không đánh giá được "giống mặt"
    reasons[k] = String(r.reason || "");
    // mã lỗi chỉ có nghĩa khi tiêu chí đo được và chưa đạt
    issues[k] = r.issue && r.issue !== "none" && raw !== null && raw < config.scenes.check.passScore ? r.issue : "";
  }
  if (!refs.faces.length) {
    reasons.face = "Chưa có ảnh khuôn mặt chuẩn trong assets/host-refs/ nên chưa kiểm được độ giống mặt.";
    notes.push(reasons.face);
  }
  const { pass, failed } = evaluateScores(scores, config.scenes.check.passScore);
  const out = { scores, reasons, issues, pass, failed, model: model || primary, notes, productBox: sanitizeProductBox(result.product_bbox) };
  if (key) cache.putCheck(key, out);
  return { ...out, fromCache: false };
}

