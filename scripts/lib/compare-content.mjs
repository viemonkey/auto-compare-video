// Parse/validate/hậu kiểm nội dung Gemini trả về — tách khỏi generate-compare-content.mjs (module đó
// cần GEMINI_API_KEY + gọi mạng nên không import được trong test). Hàm thuần, không đọc env/mạng.
//
// Field hiển thị có 2 dạng (xem public/shared/bilingual.mjs): chuỗi phẳng (thị trường mặc định / dữ liệu cũ) hoặc
// { text, vi } (thị trường khác — `vi` là nghĩa tiếng Việt sát nghĩa để người vận hành kiểm soát).
import { RetryableError, NonRetryableError } from "./gemini-retry.mjs";
import { resolveTopicTags, cleanTag, loadHashtagConfig, resolveMaterialGroups } from "./hashtags.mjs";
import { stripDiacritics } from "./slug.mjs";
import { getDefaultLocale, glossLocale, glossaryEntries, needsGloss } from "./locales.mjs";
import { CONTENT_FIELDS, POINT_FIELDS, isBilingualField, textOf, viOf, coerceField } from "../../public/shared/bilingual.mjs";
import { warningsForField as fieldWarnings } from "../../public/shared/field-warnings.mjs";
import { nfkcLower } from "../../public/shared/text-fold.mjs";

// Giai đoạn 1 — giới hạn cứng bằng CODE, không tin vào việc model tự giác tuân theo hướng dẫn
// prompt (giống enforceJewelryGating): tối đa MAX_CONTEXT_IMAGES point/video được sinh
// ảnh minh hoạ ngữ cảnh (kiểm soát chi phí gọi API ảnh — 2026-09-18 nâng 2 -> 5 theo yêu cầu
// tăng mật độ ảnh minh hoạ, đi kèm sửa prompt để Gemini mạnh dạn đánh true hơn), point
// "side":"both" luôn bị loại (không rõ swap card bên nào), và 2 point KẾ NHAU cùng bên
// trái/phải không được cùng lúc minh hoạ (setCardImage swap-vào ở point sau và
// swap-lại-ảnh-gốc ở point trước có thể rơi trùng thời điểm trên cùng 1 card — xem
// scaffold-compare-video.mjs § buildTimelineBeatsJs).
export const MAX_CONTEXT_IMAGES = 5;


/**
 * Chủ đề có phải trang sức/đá quý/kim loại quý không — hậu kiểm bằng code, KHÔNG dựa vào việc Gemini "tự giác".
 * - Thị trường tiếng Việt: từ khoá của locale (đã bỏ dấu) trên title/label/gợi ý — như trước.
 * - Thị trường khác: KHÔNG dùng từ khoá tiếng Việt trên chữ ngoại ngữ. Dùng (1) dòng `vi` của title/label + gợi ý
 *   ngữ cảnh (tiếng Việt) với từ khoá của locale tiếng Việt, (2) từ khoá của chính locale đó trên chữ đích, (3) nhóm của
 *   materials/label tra được trong bảng hashtag của locale (bảng chỉ chứa vật liệu trang sức).
 */
export function isJewelryTopic(content, topicHint, locale = getDefaultLocale(), { hashtagCfg } = {}) {
  const parts = [textOf(content.title), textOf(content.label_left), textOf(content.label_right)];
  if (!needsGloss(locale)) {
    return locale.jewelryKeywords.some((kw) => stripDiacritics([...parts, topicHint || ""].join(" ")).includes(kw));
  }
  const gloss = glossLocale();
  const viHaystack = stripDiacritics([viOf(content.title), viOf(content.label_left), viOf(content.label_right), topicHint || ""].join(" "));
  if (gloss && gloss.jewelryKeywords.some((kw) => viHaystack.includes(kw))) return true;
  const own = nfkcLower(parts.join(" "));
  if (locale.jewelryKeywords.some((kw) => own.includes(nfkcLower(kw)))) return true;
  const cfg = hashtagCfg || loadHashtagConfig(locale);
  return resolveMaterialGroups(content, cfg).length > 0;
}

export function parseAndValidate(rawText, catalog, { locale = getDefaultLocale(), hashtagCfg = loadHashtagConfig(locale) } = {}) {
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
  // Field hiển thị: chuỗi phẳng hoặc { text, vi } — chỉ `text` là bắt buộc ở bước này (thiếu `vi` chỉ là cảnh báo).
  if (!textOf(parsed.title).trim()) {
    throw new RetryableError("Field 'title' rỗng hoặc không phải string.");
  }
  if (!textOf(parsed.label_left).trim()) {
    throw new RetryableError("Field 'label_left' rỗng hoặc không phải string.");
  }
  if (!textOf(parsed.label_right).trim()) {
    throw new RetryableError("Field 'label_right' rỗng hoặc không phải string.");
  }
  if (!Array.isArray(parsed.points) || parsed.points.length === 0) {
    throw new RetryableError("Field 'points' phải là mảng có ít nhất 1 phần tử.");
  }
  for (const [i, p] of parsed.points.entries()) {
    if (!["left", "right", "both"].includes(p.side)) {
      throw new RetryableError(`points[${i}].side = "${p.side}" phải là "left" | "right" | "both".`);
    }
    if (!textOf(p.tag).trim()) {
      throw new RetryableError(`points[${i}].tag rỗng hoặc không phải string.`);
    }
    if (typeof p.sub !== "string" && !isBilingualField(p.sub)) {
      throw new RetryableError(`points[${i}].sub phải là string (dùng "" nếu không cần dòng phụ).`);
    }
    if (!textOf(p.text).trim()) {
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

  // Dạng cuối cùng của field hiển thị theo thị trường: cần nghĩa -> luôn {text, vi}; mặc định -> chuỗi phẳng.
  const wantVi = needsGloss(locale);
  for (const k of CONTENT_FIELDS) parsed[k] = coerceField(parsed[k], wantVi);
  for (const p of parsed.points) for (const k of POINT_FIELDS) p[k] = coerceField(p[k], wantVi);

  normalizeHashtagFields(parsed, hashtagCfg);
  return parsed;
}

// ---------------------------------------------------------------------------------------------
// Cảnh báo theo từng field (KHÔNG chặn, KHÔNG retry) — luật nằm ở public/shared/field-warnings.mjs (dùng chung với trình duyệt).
// ---------------------------------------------------------------------------------------------
/** Luật kiểm tra của 1 locale, dạng dữ liệu thuần (cũng là nội dung GET /api/locale-rules cho trình duyệt). */
export function rulesOf(locale) {
  return { limits: locale.limits, forbiddenPhrases: locale.forbiddenPhrases, glossary: glossaryEntries(locale), needsGloss: needsGloss(locale) };
}

/** Cảnh báo cho 1 field hiển thị. `kind` ∈ title|label_left|label_right|text|tag|sub. */
export function warningsForField(kind, field, locale) {
  return fieldWarnings(kind, field, rulesOf(locale));
}

/**
 * Cảnh báo cho cả nội dung: [{ path: "title" | "label_left" | "points[2].text" ..., code, message, ... }]. Rỗng = sạch.
 */
export function collectContentWarnings(content, locale = getDefaultLocale()) {
  const out = [];
  const push = (path, kind, field) => {
    for (const w of warningsForField(kind, field, locale)) out.push({ path, ...w });
  };
  for (const k of CONTENT_FIELDS) push(k, k, content[k]);
  (content.points || []).forEach((p, i) => {
    for (const k of POINT_FIELDS) push(`points[${i}].${k}`, k, p[k]);
  });
  return out;
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

export function enforceJewelryGating(content, catalog, topicHint, locale = getDefaultLocale(), opts = {}) {
  const jewelryOk = isJewelryTopic(content, topicHint, locale, opts);
  const corrections = [];
  if (jewelryOk) return { content, corrections };

  for (const p of content.points) {
    if (catalog.jewelryIds.includes(p.suggested_action)) {
      const original = p.suggested_action;
      const fallback = JEWELRY_FALLBACK[original] || catalog.generalIds[0];
      p.suggested_action = fallback;
      corrections.push({ point: textOf(p.text), from: original, to: fallback, reason: "topic không phải trang sức/đá quý" });
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
      corrections.push({ point: textOf(p.text), reason: `side="both" không nhận ảnh minh hoạ ngữ cảnh (không rõ swap card bên nào)` });
      p.needs_context_image = false;
      p.image_concept = "";
      return;
    }
    if (kept >= MAX_CONTEXT_IMAGES) {
      corrections.push({ point: textOf(p.text), reason: `vượt giới hạn ${MAX_CONTEXT_IMAGES} ảnh minh hoạ/video — giữ ảnh sản phẩm gốc` });
      p.needs_context_image = false;
      p.image_concept = "";
      return;
    }
    if (idx === lastKeptIndex + 1 && p.side === lastKeptSide) {
      corrections.push({ point: textOf(p.text), reason: `liền kề point minh hoạ trước, cùng bên "${p.side}" — bỏ qua tránh xung đột swap ảnh` });
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
