// Dựng prompt + response schema cho lần gọi Gemini sinh kịch bản (tách khỏi generate-compare-content.mjs
// để test được mà không cần GEMINI_API_KEY / mạng).
//
// CHỮ của prompt nằm hết trong prompts/compare-content.md; dữ liệu theo thị trường (văn phong, thuật ngữ,
// giới hạn độ dài, ví dụ) nằm trong config/locales/<code>.json. File này chỉ nạp template và điền giá trị.
import path from "node:path";
import { loadTemplateFile, renderTemplate } from "./template.mjs";
import { getDefaultLocale, REPO_ROOT } from "./locales.mjs";
import { MAX_CONTEXT_IMAGES } from "./compare-content.mjs";

export const PROMPT_TEMPLATE_PATH = process.env.PROMPT_TEMPLATE_PATH || path.join(REPO_ROOT, "prompts", "compare-content.md");

function section(sections, name) {
  if (sections[name] === undefined) throw new Error(`prompts/compare-content.md thiếu phần "@@@ ${name}"`);
  return sections[name];
}

// ============================================================
// Prompt construction — inject danh sách action id + use_case động từ actions.json,
// không hardcode, để tự đồng bộ khi actions.json đổi.
// ============================================================
export function buildSystemPrompt(catalog, hashtagCfg, locale = getDefaultLocale(), templateFile = PROMPT_TEMPLATE_PATH) {
  const sections = loadTemplateFile(templateFile);

  const actionLines = catalog.actions
    .map((a) => renderTemplate(section(sections, "fragment.actionLine"), { id: a.id, jewelryOnly: a.prop === "jewelry", useCase: a.use_case }))
    .join("\n");

  // Danh sách tag chủ đề KIỂM SOÁT (config/hashtags/<locale>.json) — Gemini chỉ được CHỌN, không tự tạo.
  const topicLines =
    hashtagCfg.topic.map((t) => renderTemplate(section(sections, "fragment.topicLine"), { tag: t.tag, group: t.group })).join("\n") ||
    section(sections, "fragment.topicEmpty");

  const glossaryLines = Object.entries(locale.glossary)
    .map(([concept, term]) => renderTemplate(section(sections, "fragment.glossaryLine"), { concept, term }))
    .join("\n");

  return renderTemplate(section(sections, "system"), {
    ...locale.prompt,
    limits: locale.limits,
    styleGuide: locale.styleGuide.trim(),
    glossary: glossaryLines,
    forbidden: locale.forbiddenPhrases.map((p) => `"${p}"`).join(", "),
    topicTags: topicLines,
    actionLines,
    maxContextImages: MAX_CONTEXT_IMAGES,
  });
}

export function buildUserPrompt(topicHint, angleInstruction, templateFile = PROMPT_TEMPLATE_PATH) {
  const sections = loadTemplateFile(templateFile);
  return renderTemplate(section(sections, "user"), { contextHint: topicHint || "", angle: angleInstruction || "" });
}

// ============================================================
// Gemini call
// ============================================================
export function buildResponseSchema(allIds, hashtagCfg, locale = getDefaultLocale()) {
  const limits = locale.limits;
  // Lowercase JSON Schema type strings — the REST generateContent body wants "object"/"string"/
  // "array", NOT the SDK's Type.OBJECT/Type.STRING enum constants (which serialize uppercase).
  // Sending uppercase here is accepted without an HTTP error but silently fails to constrain the
  // model — confirmed by testing: the model rambled instead of returning schema-shaped JSON.
  // maxLength/maxItems bound every open-ended field — without them the model (observed 3/3
  // times on gemini-3.6-flash, both thinkingLevel "low" and default) degenerates into a
  // repeating-phrase loop while generating "title" and never reaches the rest of the schema.
  // Độ dài từng field lấy từ limits của locale (config/locales/<code>.json).
  //
  // ALL 5 top-level fields are `required`. Gemini's responseSchema subset has no oneOf/anyOf,
  // so a schema that makes title/label_left/label_right/points optional (to allow an
  // error-only response) was silently exploited by the model: without `required`, it returned
  // valid-but-incomplete JSON containing only "title" and stopped (finishReason STOP) — this
  // was the actual root cause of every earlier failed test, confirmed via DEBUG_GEMINI logging.
  // Fix: every field is required; "error" is "" (empty string) in the success case, and when
  // non-empty the other 4 fields are meaningless placeholders (empty string / empty array) —
  // see parseAndValidate, which branches on `error` first and ignores the placeholders.
  const topicItems = { type: "string", maxLength: limits.topicTag };
  if (hashtagCfg.topic.length) topicItems.enum = hashtagCfg.topic.map((t) => t.tag);
  return {
    type: "object",
    required: ["error", "title", "label_left", "label_right", "materials", "topicTags", "suggestedTags", "points"],
    properties: {
      error: { type: "string", maxLength: 200 },
      title: { type: "string", maxLength: limits.title },
      label_left: { type: "string", maxLength: limits.label },
      label_right: { type: "string", maxLength: limits.label },
      materials: { type: "array", maxItems: 2, items: { type: "string", maxLength: limits.material } },
      // enum = whitelist config/hashtags/<locale>.json: Gemini không thể trả tag ngoài danh sách. Không có
      // minItems -> mảng rỗng hợp lệ (nội dung ngoài ngành trang sức: caption chỉ có tag cụ thể).
      topicTags: { type: "array", maxItems: 2, items: topicItems },
      suggestedTags: { type: "array", maxItems: 2, items: { type: "string", maxLength: limits.suggestedTag } },
      points: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          // Every field required, for the same reason the top-level ones are:
          // without `required` the model returns partial objects and stops.
          required: ["text", "side", "tag", "sub", "suggested_action", "needs_context_image", "image_concept"],
          properties: {
            text: { type: "string", maxLength: limits.point },
            side: { type: "string", enum: ["left", "right", "both"] },
            // maxLength is what keeps the on-screen tag from turning back into
            // a sentence — the label zone fits ~18 / ~26 characters per line.
            tag: { type: "string", maxLength: limits.tag },
            sub: { type: "string", maxLength: limits.sub },
            suggested_action: { type: "string", enum: allIds },
            // Giai đoạn 1 — ảnh minh hoạ ngữ cảnh (xem enforceContextImageLimits): model tự đề
            // xuất, code hậu kiểm/cắt bớt sau, không tin tưởng tuyệt đối vào việc model tự giác
            // giới hạn số lượng — cùng triết lý với enforceJewelryGating.
            needs_context_image: { type: "boolean" },
            image_concept: { type: "string", maxLength: 200 },
          },
        },
      },
    },
  };
}

/**
 * Dựng TOÀN BỘ input của 1 lần gọi Gemini — không đọc env/mạng (chỉ đọc file template + config locale),
 * dễ test. `locale` mặc định = thị trường mặc định (DEFAULT_LOCALE).
 * @returns {{systemPrompt:string, userPrompt:string, responseSchema:object}}
 */
export function buildComparePrompt({ catalog, hashtagCfg, topicHint, angleInstruction, locale = getDefaultLocale(), templateFile = PROMPT_TEMPLATE_PATH }) {
  return {
    systemPrompt: buildSystemPrompt(catalog, hashtagCfg, locale, templateFile),
    userPrompt: buildUserPrompt(topicHint, angleInstruction, templateFile),
    responseSchema: buildResponseSchema(catalog.allIds, hashtagCfg, locale),
  };
}
