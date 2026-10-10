// Mốc 2 — kịch bản 5–6 câu: Mở đầu (câu hỏi gây tò mò) → Thông số → Lúc đeo → Cảm xúc → Kêu gọi; mỗi câu gắn 1 cảnh. Sinh 3 câu mở đầu để người dùng chọn.
// Quy tắc cứng (kiểm bằng code, vi phạm thì yêu cầu viết lại kèm lý do): số liệu chỉ lấy từ form; không nói "thiên nhiên" nếu form chưa xác nhận;
// đá nhân tạo/moissanite phải nói rõ; tên đá/kim loại chỉ được nhắc khi form có; cụm từ cấm của thị trường.
import { generateJson } from "../gemini-client.mjs";
import { RetryableError } from "../gemini-retry.mjs";
import { stripDiacritics } from "../slug.mjs";
import { glossaryEntries, needsGloss } from "../locales.mjs";
import { loadProductConfig, labelsFor } from "./config.mjs";
import { productPromptPath, renderSection } from "./prompts.mjs";
import { textModels } from "./estimate.mjs";
import { specRows } from "./form.mjs";

const norm = (s) => stripDiacritics(String(s || "")).toLowerCase();
const digitsOf = (s) => (String(s || "").match(/\d[\d.,]*/g) || []).map((d) => d.replace(/[.,]/g, "").replace(/^0+(?=\d)/, ""));
const wordRe = (term) => new RegExp(`(^|[^\\p{L}\\p{N}])${norm(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");

export function scriptSchema({ locale, config = loadProductConfig() }) {
  const max = Math.max(config.script.maxCharsPerLine * 2, 160);
  const line = { type: "object", required: ["text", "vi"], properties: { text: { type: "string", maxLength: max }, vi: { type: "string", maxLength: max * 2 } } };
  const body = { type: "object", required: ["beat", "text", "vi"], properties: { beat: { type: "string", enum: ["specs", "wear", "emotion", "cta"] }, text: line.properties.text, vi: line.properties.vi } };
  void locale;
  return {
    type: "object",
    required: ["openers", "lines", "mismatches"],
    properties: {
      openers: { type: "array", items: line },
      lines: { type: "array", items: body },
      mismatches: { type: "array", items: { type: "object", required: ["field", "form_value", "observed", "message_vi"], properties: { field: { type: "string", maxLength: 40 }, form_value: { type: "string", maxLength: 120 }, observed: { type: "string", maxLength: 160 }, message_vi: { type: "string", maxLength: 300 } } } },
    },
  };
}

/** Các dòng form đưa vào prompt (chỉ field có giá trị), tiếng Việt. */
export function formLinesForPrompt(form, config = loadProductConfig()) {
  const labels = labelsFor("vi-VN", config);
  const rows = [
    ["Loại món", form.type], ["Chất liệu", form.material], ["Màu kim loại", form.metalColor], ["Đá chính", form.mainStone], ["Trọng lượng (carat)", form.carat],
    ["Giác cắt", form.cut], ["Đá phụ", form.sideStones], ["Điểm nổi bật", form.feature], ["Giá", form.price],
  ].filter(([, v]) => v);
  if (form.stoneOrigin) rows.push(["Nguồn gốc đá", config.stoneOrigins[form.stoneOrigin].label]);
  void labels;
  return rows.map(([k, v]) => `- ${k}: ${v}`).join("\n");
}

const originFragment = (form) => (form.stoneOrigin === "natural" ? "natural" : form.stoneOrigin === "lab" ? "lab" : form.stoneOrigin === "moissanite" ? "moissanite" : "none");

/**
 * Kiểm 1 kịch bản đã gộp. Trả danh sách lỗi (tiếng Việt, dùng làm phản hồi cho lần viết lại) — rỗng = đạt.
 * @param {{lines:Array<{beat:string,text:string,vi:string}>}} script lines gồm cả câu mở đầu
 */
export function validateScriptRules({ lines }, { form, locale, config = loadProductConfig() }) {
  const issues = [];
  const cfg = config.script;
  const formBlob = norm(Object.values(form).filter((v) => typeof v === "string").join(" | "));
  const formNumbers = new Set(digitsOf(Object.values(form).join(" ")));
  const gloss = needsGloss(locale);
  const naturalWords = config.stoneOrigins.natural.keywords.map(norm);
  const originWords = [...(config.stoneOrigins[form.stoneOrigin]?.keywords || [])].map(norm);

  if (lines.length < cfg.minLines || lines.length > cfg.maxLines) issues.push(`Cần ${cfg.minLines}–${cfg.maxLines} câu cả video (đang có ${lines.length}).`);
  lines.forEach((l, i) => {
    const tag = `Câu ${i + 1}`;
    if (!String(l.text || "").trim()) return issues.push(`${tag} rỗng.`);
    if (l.text.length > cfg.maxCharsPerLine * 1.4) issues.push(`${tag} quá dài (${l.text.length} ký tự, tối đa ~${cfg.maxCharsPerLine}).`);
    for (const n of digitsOf(l.text)) if (!formNumbers.has(n)) issues.push(`${tag} có số "${n}" không có trong form — số liệu chỉ được lấy từ form.`);
    const checkable = norm(gloss ? l.vi : l.text); // thuật ngữ vi/en kiểm trên chữ tiếng Việt (bản gốc nếu là vi)
    const checkTexts = gloss ? [checkable, norm(l.text)] : [checkable];
    if (form.stoneOrigin !== "natural" && checkTexts.some((t) => naturalWords.some((w) => wordRe(w).test(t)))) issues.push(`${tag} nói đá "thiên nhiên/tự nhiên" nhưng form chưa xác nhận.`);
    for (const term of cfg.claimTerms) if (wordRe(term).test(checkable) && !formBlob.includes(norm(term))) issues.push(`${tag} nhắc "${term}" nhưng form không có — chỉ gọi tên đúng như form.`);
    for (const w of cfg.numberWords) {
      const re = new RegExp(`(^|[^\\p{L}])${norm(w)}\\s+(${cfg.countUnits.map(norm).join("|")})(?![\\p{L}])`, "u");
      const hit = re.exec(checkable);
      if (hit && !formBlob.includes(`${norm(w)} ${hit[2]}`)) issues.push(`${tag} nêu số lượng "${String(gloss ? l.vi : l.text).slice(hit.index, hit.index + hit[0].length).trim()}" không có trong form.`);
    }
    for (const bad of locale.forbiddenPhrases || []) if (String(l.text).toLowerCase().includes(String(bad).toLowerCase())) issues.push(`${tag} dùng cụm bị cấm "${bad}".`);
    if (gloss && !String(l.vi || "").trim()) issues.push(`${tag} thiếu nghĩa tiếng Việt ("vi").`);
  });
  if (form.stoneOrigin === "lab" || form.stoneOrigin === "moissanite") {
    const specs = lines.filter((l) => l.beat === "specs");
    const said = specs.some((l) => [norm(l.text), norm(l.vi)].some((t) => originWords.some((w) => t.includes(w)) || (form.stoneOrigin === "lab" && /nhan tao|lab/.test(t))));
    if (!said) issues.push(`Form ghi đá ${config.stoneOrigins[form.stoneOrigin].label.toLowerCase()} nên phải nói rõ điều đó trong ít nhất 1 câu thông số.`);
  }
  const rate = locale.limits?.readingRate || cfg.readingCharsPerSecond;
  const total = lines.reduce((a, l) => a + [...String(l.text || "")].length, 0);
  const maxTotal = Math.round(cfg.targetSeconds[1] * rate * (cfg.totalCharsTolerance || 1));
  if (total > maxTotal) issues.push(`Tổng độ dài ${total} ký tự quá dài (tối đa ~${maxTotal} để video không vượt ${cfg.targetSeconds[1]} giây) — rút gọn các câu.`);
  const hasCta = lines.at(-1)?.beat === "cta";
  if (!hasCta) issues.push('Câu cuối phải là câu kêu gọi (beat "cta").');
  return issues;
}

/** Thời lượng đọc ước tính (giây) + cảnh báo nếu ngoài 15–20 giây (chỉ cảnh báo). */
export function readingEstimate(lines, locale, config = loadProductConfig()) {
  const rate = locale.limits?.readingRate || config.script.readingCharsPerSecond;
  const chars = lines.reduce((a, l) => a + [...String(l.text || "")].length, 0);
  const seconds = chars / rate;
  const [lo, hi] = config.script.targetSeconds;
  const warnings = [];
  if (seconds < lo - 3) warnings.push(`Kịch bản ngắn (~${seconds.toFixed(0)} giây đọc) — video có thể dưới ${lo} giây.`);
  if (seconds > hi + 3) warnings.push(`Kịch bản dài (~${seconds.toFixed(0)} giây đọc) — video có thể vượt ${hi} giây.`);
  return { seconds, warnings };
}

/** Gộp câu mở đầu đã chọn + các câu còn lại thành danh sách dòng thoại có beat/số thứ tự. */
export function assembleScript({ openers, lines }, openerIndex = 0) {
  const opener = openers[Math.min(Math.max(0, openerIndex), openers.length - 1)];
  const all = [{ beat: "hook", text: opener.text, vi: opener.vi }, ...lines.map((l) => ({ beat: l.beat, text: l.text, vi: l.vi }))];
  return all.map((l, i) => ({ n: i + 1, beat: l.beat, text: String(l.text).trim(), vi: String(l.vi || "").trim() }));
}

/**
 * @returns {Promise<{openers:Array<{text,vi}>, openerIndex:number, lines:Array, mismatches:Array, warnings:string[], model:string}>}
 */
export async function writeScript({ form, analysis, locale, ledgerSlug, signal, generate = generateJson, config = loadProductConfig(), env = process.env, promptFile = productPromptPath("product-script.md") }) {
  const cfg = config.script;
  const gloss = needsGloss(locale);
  const glossary = glossaryEntries(locale).map(({ concept, term }) => `- ${concept} -> ${term}`).join("\n");
  const vars = {
    language: locale.prompt.language,
    languageDetailed: locale.prompt.languageDetailed || locale.prompt.language,
    styleGuide: String(locale.styleGuide || "").trim(),
    glossary,
    forbidden: (locale.forbiddenPhrases || []).map((p) => `"${p}"`).join(", "),
    productKind: analysis.kind === "other" ? form.type : analysis.kind,
    lockJson: JSON.stringify({ kind: analysis.kind, ...analysis.lock, description: analysis.lockText }, null, 2),
    formLines: formLinesForPrompt(form, config),
    originRule: renderSection(promptFile, `fragment.origin.${originFragment(form)}`, {}),
    priceRule: form.price ? renderSection(promptFile, "fragment.price.given", { price: form.price }) : renderSection(promptFile, "fragment.price.none", {}),
    glossRule: renderSection(promptFile, gloss ? "fragment.gloss.need" : "fragment.gloss.none", { language: locale.prompt.language }),
    maxChars: cfg.maxCharsPerLine,
    maxTotalChars: Math.round(cfg.targetSeconds[1] * (locale.limits?.readingRate || cfg.readingCharsPerSecond)),
    targetSeconds: cfg.targetSeconds.join("–"),
    minLines: cfg.minLines,
    maxLines: cfg.maxLines,
    bodyMin: cfg.minLines - 1,
    bodyMax: cfg.maxLines - 1,
    openerCount: cfg.openerChoices,
    mismatchFields: cfg.mismatchFields.join("; "),
  };
  const systemPrompt = renderSection(promptFile, "system", vars);
  const baseUser = renderSection(promptFile, "user", vars);
  const model = textModels(env, config).script;
  const schema = scriptSchema({ locale, config });

  let feedback = "";
  let lastIssues = [];
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    const { result, model: usedModel } = await generate({
      systemPrompt,
      userText: feedback ? `${baseUser}\n\nLẦN VIẾT TRƯỚC BỊ LOẠI vì các lỗi sau — hãy sửa hết:\n${feedback}` : baseUser,
      schema,
      models: { primary: model, fallback: process.env.GEMINI_FALLBACK_MODEL || "" },
      ledger: { task: "content-generation", subtask: "product-script", slug: ledgerSlug, locale: locale.code },
      signal,
      validate: (o) => {
        if (!Array.isArray(o.openers) || o.openers.length < 1 || !Array.isArray(o.lines) || o.lines.length < 1) throw new RetryableError("Kịch bản thiếu openers/lines.");
        return o;
      },
    });
    const openers = result.openers.slice(0, cfg.openerChoices).map((o) => ({ text: String(o.text).trim(), vi: gloss ? String(o.vi || "").trim() : "" }));
    const lines = assembleScript({ openers, lines: result.lines.map((l) => ({ ...l, vi: gloss ? l.vi : "" })) }, 0);
    // mọi phương án mở đầu đều phải đạt luật (người dùng có thể chọn bất kỳ phương án nào)
    lastIssues = [];
    openers.forEach((_, oi) => {
      const issues = validateScriptRules({ lines: assembleScript({ openers, lines: result.lines.map((l) => ({ ...l, vi: gloss ? l.vi : "" })) }, oi) }, { form, locale, config });
      for (const it of issues) if (!lastIssues.includes(it)) lastIssues.push(oi === 0 ? it : `${it} (phương án mở đầu ${oi + 1})`);
    });
    if (!lastIssues.length) {
      const { warnings } = readingEstimate(lines, locale, config);
      return { openers, openerIndex: 0, lines, mismatches: normalizeMismatches(result.mismatches), warnings, model: usedModel || model, attempts: attempt };
    }
    feedback = lastIssues.map((i) => `- ${i}`).join("\n");
  }
  const err = new Error(`Gemini viết kịch bản chưa đạt luật sau ${cfg.maxAttempts} lần: ${lastIssues.join(" ")}`);
  err.userMessage = `Gemini chưa viết được kịch bản đúng luật (số liệu chỉ lấy từ form...). Lý do: ${lastIssues.slice(0, 3).join(" ")} Hãy thử lại hoặc bổ sung thông số vào form.`;
  throw err;
}

function normalizeMismatches(list) {
  return (Array.isArray(list) ? list : []).map((m) => ({ field: String(m.field || ""), formValue: String(m.form_value || ""), observed: String(m.observed || ""), message: String(m.message_vi || "") })).filter((m) => m.message);
}

export { specRows };
