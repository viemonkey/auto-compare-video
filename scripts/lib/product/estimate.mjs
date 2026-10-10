// Ước tính chi phí 1 video giới thiệu sản phẩm (hiện ở Bước 1) từ cấu hình hiện tại: nguồn ảnh, có clip AI không, số ảnh.
import { loadProductConfig, maxCostVnd } from "./config.mjs";
import { textCallUsd, imageCallUsd, clipCallUsd, usdToVndRounded } from "./budget.mjs";
import { resolveGeminiModels } from "../gemini-models.mjs";

/** Tên model chữ/vision dùng cho từng việc (config rỗng -> GEMINI_MODEL). */
export function textModels(env = process.env, config = loadProductConfig()) {
  const { primary } = resolveGeminiModels(env);
  const pick = (m) => String(m?.envId ? env[m.envId] || "" : "").trim() || m?.id || primary;
  return { analysis: pick(config.models.analysis) || primary, script: pick(config.models.script) || primary, check: pick(config.models.check) || primary };
}

/**
 * @param {{imageSource:"pose"|"manual"|"gemini", aiClip?:boolean, env?:object, config?:object}} o
 * @returns {{items:Array<{id:string,label:string,usd:number|null,vnd:number|null,note?:string}>, expectedVnd:number, maxVnd:number, ceilingVnd:number, overCeiling:boolean, notes:string[]}}
 */
export function estimateProductCost({ imageSource = "pose", aiClip = false, env = process.env, config = loadProductConfig() } = {}) {
  const models = textModels(env, config);
  const ceiling = maxCostVnd(env, config);
  const scenes = config.scenes.aiScenes.length;
  const items = [];
  const add = (id, label, usd, note) => items.push({ id, label, usd, vnd: usd === null ? null : usdToVndRounded(usd, env), ...(note ? { note } : {}) });

  add("analysis", "Phân tích sản phẩm (nhìn ảnh)", textCallUsd(models.analysis, "analysis", config));
  add("script", "Viết kịch bản + 3 câu mở đầu", textCallUsd(models.script, "script", config));

  let worstExtraUsd = 0;
  if (imageSource === "manual") {
    add("check", `Kiểm ${scenes} ảnh tự tải (Gemini Flash)`, scenes * textCallUsd(models.check, "check", config), "Chạy được ở gói miễn phí — số tiền là giá niêm yết, thực tế có thể 0đ.");
  } else if (imageSource === "gemini") {
    const imageUsd = imageCallUsd(env, config);
    const checkUsd = textCallUsd(models.check, "check", config);
    const calls = config.estimate.imagesPerScene + config.estimate.editsPerScene;
    add("images", `Tạo/sửa ảnh AI (${scenes} cảnh × ${calls} lần)`, scenes * calls * imageUsd);
    add("check", `Kiểm ${scenes * (1 + config.estimate.editsPerScene)} lượt ảnh`, scenes * (1 + config.estimate.editsPerScene) * checkUsd);
    worstExtraUsd += scenes * Math.max(0, config.scenes.maxAttempts.totalImageCalls - calls) * (imageUsd + checkUsd);
  }
  if (aiClip) add("clip", `Clip AI ${config.models.clip.seconds} giây cảnh mở đầu`, clipCallUsd(env, config));
  if (imageSource === "pose" && !aiClip) add("images", "Ảnh tư thế HuyK có sẵn + ảnh sản phẩm của bạn", 0, "Không gọi API ảnh.");

  const sum = (list) => list.reduce((a, i) => a + (i.vnd ?? 0), 0);
  const expectedVnd = sum(items);
  const maxVnd = Math.min(ceiling, expectedVnd + usdToVndRounded(worstExtraUsd, env));
  const notes = [];
  if (items.some((i) => i.usd === null)) notes.push("Có hạng mục chưa có đơn giá trong config/pricing.mjs — hạng mục đó sẽ không được gọi.");
  if (expectedVnd > ceiling) notes.push("Ước tính vượt trần: tool sẽ bỏ clip AI hoặc dùng ảnh tư thế để không vượt.");
  return { items, expectedVnd, maxVnd, ceilingVnd: ceiling, overCeiling: expectedVnd > ceiling, notes };
}
