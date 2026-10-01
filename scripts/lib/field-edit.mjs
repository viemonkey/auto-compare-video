// Sửa 1 dòng hiển thị ở Bước 2 bằng Gemini (chỉ gọi cho ĐÚNG trường đó):
//   - rewriteField : người dùng sửa ý bằng tiếng Việt -> Gemini viết lại bằng ngôn ngữ đích theo styleGuide/glossary/limits;
//                    `vi` trả về là nghĩa của câu MỚI do AI viết (không giữ nguyên câu người dùng nhập).
//   - translateField: người dùng sửa trực tiếp chữ đích -> chỉ dịch lại nghĩa tiếng Việt.
// Prompt nằm ở prompts/field-edit.md. Kết quả kèm cảnh báo theo dòng (không chặn).
import path from "node:path";
import { loadTemplateFile, renderTemplate } from "./template.mjs";
import { REPO_ROOT, glossaryEntries, glossLocale, needsGloss } from "./locales.mjs";
import { generateJson } from "./gemini-client.mjs";
import { RetryableError } from "./gemini-retry.mjs";
import { schemaMaxLength } from "./compare-prompt.mjs";
import { warningsForField } from "./compare-content.mjs";
import { LIMIT_KEY } from "../../public/shared/field-warnings.mjs";
import { textOf, viOf } from "../../public/shared/bilingual.mjs";

export const FIELD_EDIT_TEMPLATE_PATH = process.env.FIELD_EDIT_TEMPLATE_PATH || path.join(REPO_ROOT, "prompts", "field-edit.md");
export const FIELD_KINDS = Object.keys(LIMIT_KEY); // title | label_left | label_right | text | tag | sub

const MAX_IDEA_CHARS = 600; // chặn đầu vào quá dài (chi phí + prompt injection tràn lan)

/** Lỗi do đầu vào sai (HTTP 400) — khác lỗi Gemini. */
export class FieldEditError extends Error {}

function section(sections, name) {
  if (sections[name] === undefined) throw new Error(`prompts/field-edit.md thiếu phần "@@@ ${name}"`);
  return sections[name];
}

function assertKind(kind) {
  if (!FIELD_KINDS.includes(kind)) throw new FieldEditError(`Loại trường "${kind}" không hợp lệ.`);
}

function contextBlock(sections, context = {}, kind) {
  const line = (key, f) => {
    const text = textOf(f);
    if (!text.trim()) return null;
    return renderTemplate(section(sections, "fragment.ctx.line"), { name: section(sections, `fragment.ctx.${key}`), text, vi: viOf(f) });
  };
  const lines = [];
  // chính trường đang sửa không lặp lại trong ngữ cảnh
  for (const key of ["title", "label_left", "label_right"]) if (key !== kind) lines.push(line(key, context[key]));
  if (kind === "tag" || kind === "sub") lines.push(line("text", context.pointText));
  if (kind === "sub") lines.push(line("tag", context.pointTag));
  const out = lines.filter(Boolean).join("\n");
  return out || "(chưa có ngữ cảnh)";
}

function viMaxLength(locale, kind) {
  const base = schemaMaxLength(locale.limits, LIMIT_KEY[kind]);
  const viLim = glossLocale()?.limits;
  return Math.max(base, viLim ? schemaMaxLength(viLim, LIMIT_KEY[kind]) : base * 2);
}

const glossaryLines = (locale, sections, fragmentName) =>
  glossaryEntries(locale)
    .map(({ concept, term }) => renderTemplate(section(sections, fragmentName), { concept, term }))
    .join("\n");

/**
 * Viết lại 1 field theo ý mới (tiếng Việt).
 * @param {{locale:object, kind:string, idea:string, current?:{text:string,vi:string}, context?:object, slug?:string|null, signal?:AbortSignal}} a
 * @returns {Promise<{field:{text:string,vi:string}, warnings:object[], model:string}>}
 */
export async function rewriteField({ locale, kind, idea, current = {}, context = {}, slug = null, signal }) {
  assertKind(kind);
  if (!needsGloss(locale)) throw new FieldEditError("Thị trường tiếng Việt không có dòng nghĩa để viết lại.");
  const ideaText = String(idea ?? "").trim();
  if (!ideaText) throw new FieldEditError("Hãy nhập ý mới bằng tiếng Việt.");
  if (ideaText.length > MAX_IDEA_CHARS) throw new FieldEditError(`Ý mới quá dài (tối đa ${MAX_IDEA_CHARS} ký tự).`);

  const sections = loadTemplateFile(FIELD_EDIT_TEMPLATE_PATH);
  const lim = locale.limits;
  const systemPrompt = renderTemplate(section(sections, "rewrite.system"), {
    language: locale.prompt.language,
    styleGuide: locale.styleGuide.trim(),
    glossary: glossaryLines(locale, sections, "fragment.glossaryLine"),
    forbidden: locale.forbiddenPhrases.map((p) => `"${p}"`).join(", "),
    fieldRole: section(sections, `fragment.role.${kind}`),
    fieldLength: renderTemplate(section(sections, `fragment.unit.${lim.unit}`), { n: lim[LIMIT_KEY[kind]] }),
  });
  const userText = renderTemplate(section(sections, "rewrite.user"), {
    context: contextBlock(sections, context, kind),
    currentText: textOf(current) || "(trống)",
    currentVi: viOf(current) || "(trống)",
    idea: ideaText,
  });
  const schema = {
    type: "object",
    required: ["text", "vi"],
    properties: {
      text: { type: "string", maxLength: schemaMaxLength(lim, LIMIT_KEY[kind]) },
      vi: { type: "string", maxLength: viMaxLength(locale, kind) },
    },
  };
  const allowEmpty = kind === "sub";
  const { result, model } = await generateJson({
    systemPrompt,
    userText,
    schema,
    signal,
    ledger: { task: "content-generation", subtask: "field-rewrite", slug, locale: locale.code },
    validate: (o) => {
      const text = typeof o.text === "string" ? o.text.trim() : "";
      const vi = typeof o.vi === "string" ? o.vi.trim() : "";
      if (!text && !allowEmpty) throw new RetryableError('Gemini trả về field "text" rỗng.');
      if (text && !vi) throw new RetryableError('Gemini trả về field "vi" rỗng.');
      return { text, vi };
    },
  });
  return { field: result, warnings: warningsForField(kind, result, locale), model };
}

/**
 * Dịch lại nghĩa tiếng Việt cho chữ đích đã sửa tay.
 * @returns {Promise<{vi:string, warnings:object[], model:string|null}>}
 */
export async function translateField({ locale, kind, text, slug = null, signal }) {
  assertKind(kind);
  if (!needsGloss(locale)) throw new FieldEditError("Thị trường tiếng Việt không có dòng nghĩa để dịch.");
  const source = String(text ?? "").trim();
  if (!source) return { vi: "", warnings: [], model: null }; // trường rỗng (vd sub) — không gọi Gemini
  if (source.length > MAX_IDEA_CHARS * 2) throw new FieldEditError("Dòng chữ quá dài.");

  const sections = loadTemplateFile(FIELD_EDIT_TEMPLATE_PATH);
  const systemPrompt = renderTemplate(section(sections, "translate.system"), {
    language: locale.prompt.language,
    fieldRole: section(sections, `fragment.role.${kind}`),
    glossary: glossaryLines(locale, sections, "fragment.glossaryLineRev"),
  });
  const userText = renderTemplate(section(sections, "translate.user"), { text: source });
  const schema = { type: "object", required: ["vi"], properties: { vi: { type: "string", maxLength: viMaxLength(locale, kind) } } };
  const { result, model } = await generateJson({
    systemPrompt,
    userText,
    schema,
    signal,
    ledger: { task: "content-generation", subtask: "field-translate", slug, locale: locale.code },
    validate: (o) => {
      const vi = typeof o.vi === "string" ? o.vi.trim() : "";
      if (!vi) throw new RetryableError('Gemini trả về field "vi" rỗng.');
      return { vi };
    },
  });
  return { vi: result.vi, warnings: warningsForField(kind, { text: source, vi: result.vi }, locale), model };
}
