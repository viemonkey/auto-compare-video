// Ghép prompt tạo ảnh cảnh có HuyK: mẫu cảnh (prompts/product-scenes/<cảnh>.<loại món>.md) + mô tả khoá sản phẩm (do Gemini vision viết)
// + câu khoá khuôn mặt / trang phục + câu cấm. Dùng CHUNG cho nguồn "gemini" (gửi API) và "manual" (người dùng dán vào Google AI Studio).
import fs from "node:fs";
import path from "node:path";
import { loadProductConfig, repoPath } from "./config.mjs";
import { renderSection } from "./prompts.mjs";

export const sceneDir = (config = loadProductConfig()) => (process.env.PRODUCT_SCENE_PROMPT_DIR ? process.env.PRODUCT_SCENE_PROMPT_DIR : repoPath(config.scenes.promptDir));
export const sceneTemplateFile = (slot, kind, config = loadProductConfig()) => path.join(sceneDir(config), `${slot}.${kind}.md`);
export const commonFile = (config = loadProductConfig()) => path.join(sceneDir(config), "common.md");

/** Loại món nào có đủ mẫu cho cả 2 cảnh AI. */
export function kindsWithSceneTemplates(config = loadProductConfig()) {
  return Object.keys(config.productKinds).filter((kind) => config.scenes.aiScenes.every((slot) => fs.existsSync(sceneTemplateFile(slot, kind, config))));
}

const range = (from, count) => (count <= 0 ? "" : count === 1 ? String(from) : `${from}–${from + count - 1}`);

/**
 * Bố cục ảnh tham chiếu theo THỨ TỰ gửi cho model: [ảnh sản phẩm...][ảnh khuôn mặt...][ảnh trang phục].
 * @param {{products:number, faces:number, outfit:boolean, lead?:number}} o  lead = số ảnh đứng trước (vd 1 khi sửa ảnh: ảnh đang sửa là ảnh số 1)
 */
export function referenceLayout({ products, faces, outfit, lead = 0 }) {
  const productStart = lead + 1;
  const faceStart = productStart + products;
  const outfitIndex = faceStart + faces;
  return {
    productRange: range(productStart, products) || "(không có)",
    faceRange: range(faceStart, faces) || "(không có)",
    outfitRef: outfit ? String(outfitIndex) : "",
    count: lead + products + faces + (outfit ? 1 : 0),
  };
}

function baseVars({ lockText, kind, layout, config, host, slot, extra = {} }) {
  return {
    productKind: kind,
    lockText,
    outfitText: host.outfit.text,
    faceRange: layout.faceRange,
    productRange: layout.productRange,
    outfitRef: layout.outfitRef,
    productShare: config.scenes.slots[slot]?.productShare || "one quarter of the frame width",
    userRequest: "",
    ...extra,
  };
}

/**
 * Prompt tạo ảnh MỚI cho 1 cảnh AI.
 * @param {{slot:"hold-close"|"wear-hand", kind:"ring"|"necklace"|"earring", lockText:string, layout:object, config?:object}} o
 */
export function buildScenePrompt({ slot, kind, lockText, layout, config = loadProductConfig() }) {
  const file = sceneTemplateFile(slot, kind, config);
  if (!fs.existsSync(file)) throw new Error(`Chưa có mẫu cảnh ${path.relative(repoPath(), file)} cho loại món này.`);
  const vars = baseVars({ lockText, kind, layout, config, host: config.host, slot });
  const parts = [renderSection(file, "scene", vars), renderSection(commonFile(config), "photo", vars), renderSection(commonFile(config), "product", vars)];
  if (layout.faceRange !== "(không có)") parts.push(renderSection(commonFile(config), "face", vars));
  parts.push(renderSection(commonFile(config), "outfit", vars), renderSection(commonFile(config), "forbid", vars));
  return parts.join("\n\n");
}

/** Prompt SỬA ảnh có sẵn ("fix-face" | "fix-product" | "edit"): ảnh đang sửa là ảnh tham chiếu số 1. */
export function buildEditPrompt({ action, kind, slot, lockText, layout, userRequest = "", config = loadProductConfig() }) {
  const section = action === "fix-face" ? "fix-face" : action === "fix-product" ? "fix-product" : "edit";
  const vars = baseVars({ lockText, kind, layout, config, host: config.host, slot, extra: { userRequest: String(userRequest || "").trim().slice(0, 500) } });
  return renderSection(commonFile(config), section, vars);
}

/**
 * Hướng dẫn đính kèm khi dán prompt vào Google AI Studio (nguồn "manual"): ảnh nào, thứ tự nào — khớp với số thứ tự trong prompt.
 */
export function manualAttachGuide({ productCount, faceCount, outfitImage, config = loadProductConfig() }) {
  const layout = referenceLayout({ products: productCount, faces: faceCount, outfit: outfitImage });
  const lines = [`Ảnh sản phẩm của bạn (${productCount} ảnh) — đính kèm ĐẦU TIÊN (ảnh số ${layout.productRange}).`];
  if (faceCount) lines.push(`Ảnh khuôn mặt HuyK trong assets/host-refs/ (face-*.jpg, ${faceCount} ảnh) — đính kèm tiếp theo (ảnh số ${layout.faceRange}). Chỉ để giữ khuôn mặt, kiểu tóc.`);
  else lines.push(`CHƯA có ảnh khuôn mặt trong assets/host-refs/ — hãy thêm 3–4 ảnh face-*.jpg rồi dán lại prompt để mặt giống HuyK.`);
  lines.push(outfitImage ? `Ảnh trang phục (assets/host-refs/outfit.jpg) — đính kèm cuối cùng (ảnh số ${layout.outfitRef}).` : `Trang phục theo chữ: ${config.host.outfit.text}.`);
  return lines;
}
