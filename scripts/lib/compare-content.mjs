// Parse/validate/hậu kiểm nội dung Gemini trả về — tách khỏi generate-compare-content.mjs (module đó
// cần GEMINI_API_KEY + gọi mạng nên không import được trong test). Hàm thuần, không đọc env/mạng.
import { RetryableError, NonRetryableError } from "./gemini-retry.mjs";
import { resolveTopicTags, cleanTag, loadHashtagConfig } from "./hashtags.mjs";
import { stripDiacritics } from "./slug.mjs";
import { getDefaultLocale } from "./locales.mjs";

// Giai đoạn 1 — giới hạn cứng bằng CODE, không tin vào việc model tự giác tuân theo hướng dẫn
// prompt (giống enforceJewelryGating): tối đa MAX_CONTEXT_IMAGES point/video được sinh
// ảnh minh hoạ ngữ cảnh (kiểm soát chi phí gọi API ảnh — 2026-09-18 nâng 2 -> 5 theo yêu cầu
// tăng mật độ ảnh minh hoạ, đi kèm sửa prompt để Gemini mạnh dạn đánh true hơn), point
// "side":"both" luôn bị loại (không rõ swap card bên nào), và 2 point KẾ NHAU cùng bên
// trái/phải không được cùng lúc minh hoạ (setCardImage swap-vào ở point sau và
// swap-lại-ảnh-gốc ở point trước có thể rơi trùng thời điểm trên cùng 1 card — xem
// scaffold-compare-video.mjs § buildTimelineBeatsJs).
export const MAX_CONTEXT_IMAGES = 5;

// Hậu kiểm chủ đề trang sức bằng từ khoá của locale (đã bỏ dấu) — KHÔNG dựa 100% vào việc Gemini
// "tự giác" tuân theo prompt, vì đây là ràng buộc cứng (yêu cầu của người dùng), không phải gợi ý.
export function isJewelryTopic({ title, label_left, label_right }, topicHint, locale = getDefaultLocale()) {
  const haystack = stripDiacritics([title, label_left, label_right, topicHint || ""].join(" "));
  return locale.jewelryKeywords.some((kw) => haystack.includes(kw));
}

export function parseAndValidate(rawText, catalog, { hashtagCfg = loadHashtagConfig() } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new RetryableError(`Gemini trả về không phải JSON hợp lệ: ${rawText.slice(0, 200)}`);
  }

  // Gemini tự báo 2 ảnh không so sánh được — đây là kết quả hợp lệ về mặt xử lý, không
  // phải lỗi transient, nên KHÔNG retry — dừng ngay với lý do rõ ràng.
  if (parsed.error) {
    throw new NonRetryableError(`Gemini báo 2 ảnh không so sánh được: ${parsed.error}`);
  }

  const missing = ["title", "label_left", "label_right", "points"].filter((k) => !(k in parsed));
  if (missing.length) {
    throw new RetryableError(
      `Response thiếu field bắt buộc: ${missing.join(", ")}. Raw: ${rawText.slice(0, 300)}`,
    );
  }
  if (typeof parsed.title !== "string" || !parsed.title.trim()) {
    throw new RetryableError("Field 'title' rỗng hoặc không phải string.");
  }
  if (typeof parsed.label_left !== "string" || !parsed.label_left.trim()) {
    throw new RetryableError("Field 'label_left' rỗng hoặc không phải string.");
  }
  if (typeof parsed.label_right !== "string" || !parsed.label_right.trim()) {
    throw new RetryableError("Field 'label_right' rỗng hoặc không phải string.");
  }
  if (!Array.isArray(parsed.points) || parsed.points.length === 0) {
    throw new RetryableError("Field 'points' phải là mảng có ít nhất 1 phần tử.");
  }
  for (const [i, p] of parsed.points.entries()) {
    if (!["left", "right", "both"].includes(p.side)) {
      throw new RetryableError(`points[${i}].side = "${p.side}" phải là "left" | "right" | "both".`);
    }
    if (typeof p.tag !== "string" || !p.tag.trim()) {
      throw new RetryableError(`points[${i}].tag rỗng hoặc không phải string.`);
    }
    if (typeof p.sub !== "string") {
      throw new RetryableError(`points[${i}].sub phải là string (dùng "" nếu không cần dòng phụ).`);
    }
    if (typeof p.text !== "string" || !p.text.trim()) {
      throw new RetryableError(`points[${i}].text rỗng hoặc không phải string.`);
    }
    if (typeof p.suggested_action !== "string" || !catalog.allIds.includes(p.suggested_action)) {
      throw new RetryableError(
        `points[${i}].suggested_action = "${p.suggested_action}" không khớp id nào trong actions.json.`,
      );
    }
    if (typeof p.needs_context_image !== "boolean") {
      throw new RetryableError(`points[${i}].needs_context_image phải là boolean.`);
    }
    if (typeof p.image_concept !== "string") {
      throw new RetryableError(`points[${i}].image_concept phải là string (dùng "" nếu needs_context_image=false).`);
    }
  }

  normalizeHashtagFields(parsed, hashtagCfg);
  return parsed;
}

// Field hashtag KHÔNG bắt buộc hợp lệ (khác 4 field lõi): thiếu/sai kiểu -> [] thay vì retry/lỗi, vì
// caption vẫn có fallback theo label (xem scripts/lib/hashtags.mjs). topicTags hậu kiểm bằng code
// theo whitelist dù schema đã có enum — không tin tuyệt đối vào model (cùng triết lý enforceJewelryGating).
export function normalizeHashtagFields(parsed, cfg) {
  parsed.materials = (Array.isArray(parsed.materials) ? parsed.materials : [])
    .filter((m) => typeof m === "string" && m.trim())
    .map((m) => m.trim())
    .slice(0, 2);
  parsed.topicTags = resolveTopicTags(parsed.topicTags, cfg);
  const suggested = [];
  for (const raw of Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags : []) {
    const t = typeof raw === "string" ? cleanTag(raw, cfg) : null;
    if (t && !suggested.includes(t)) suggested.push(t);
  }
  parsed.suggestedTags = suggested.slice(0, 2);
}

// Hậu kiểm bằng code, KHÔNG chỉ dựa vào prompt: nếu topic không phải trang sức mà Gemini
// vẫn lỡ gợi ý 1 action có prop:jewelry, hạ cấp về action trung tính tương đương ý nghĩa.
export const JEWELRY_FALLBACK = {
  "inspect-gem": "thinking", // đang xem xét/kiểm tra -> vẫn giữ tinh thần "đang quan sát"
  "present-ring": "explain-a", // đang giới thiệu/trình bày -> giữ tinh thần "đang giải thích"
  "show-item": "explain-a",
};

export function enforceJewelryGating(content, catalog, topicHint, locale = getDefaultLocale()) {
  const jewelryOk = isJewelryTopic(content, topicHint, locale);
  const corrections = [];
  if (jewelryOk) return { content, corrections };

  for (const p of content.points) {
    if (catalog.jewelryIds.includes(p.suggested_action)) {
      const original = p.suggested_action;
      const fallback = JEWELRY_FALLBACK[original] || catalog.generalIds[0];
      p.suggested_action = fallback;
      corrections.push({ point: p.text, from: original, to: fallback, reason: "topic không phải trang sức/đá quý" });
    }
  }
  return { content, corrections };
}

export function enforceContextImageLimits(content) {
  const corrections = [];
  let kept = 0;
  let lastKeptIndex = -1;
  let lastKeptSide = null;

  content.points.forEach((p, idx) => {
    if (typeof p.needs_context_image !== "boolean") p.needs_context_image = false;
    if (typeof p.image_concept !== "string") p.image_concept = "";
    if (!p.needs_context_image) return;

    if (p.side === "both") {
      corrections.push({ point: p.text, reason: `side="both" không nhận ảnh minh hoạ ngữ cảnh (không rõ swap card bên nào)` });
      p.needs_context_image = false;
      p.image_concept = "";
      return;
    }
    if (kept >= MAX_CONTEXT_IMAGES) {
      corrections.push({ point: p.text, reason: `vượt giới hạn ${MAX_CONTEXT_IMAGES} ảnh minh hoạ/video — giữ ảnh sản phẩm gốc` });
      p.needs_context_image = false;
      p.image_concept = "";
      return;
    }
    if (idx === lastKeptIndex + 1 && p.side === lastKeptSide) {
      corrections.push({ point: p.text, reason: `liền kề point minh hoạ trước, cùng bên "${p.side}" — bỏ qua tránh xung đột swap ảnh` });
      p.needs_context_image = false;
      p.image_concept = "";
      return;
    }

    kept++;
    lastKeptIndex = idx;
    lastKeptSide = p.side;
  });

  return { content, corrections };
}
