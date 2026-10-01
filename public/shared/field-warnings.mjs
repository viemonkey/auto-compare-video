// Cảnh báo theo từng dòng hiển thị (KHÔNG chặn): độ dài theo limits của thị trường, cụm cấm, thiếu nghĩa tiếng Việt,
// thuật ngữ lệch glossary + thời gian đọc ước tính. DÙNG CHUNG server (kiểm nội dung Gemini trả về, kiểm kết quả viết lại)
// và trình duyệt (cảnh báo tức thì khi người dùng gõ) — một nguồn sự thật cho luật.
//
// `rules` (dựng từ 1 locale, xem rulesOf ở scripts/lib/compare-content.mjs và GET /api/locale-rules):
//   { limits: {unit, title, label, point, tag, sub, readingRate, ...}, forbiddenPhrases: string[],
//     glossary: [{ concept, term, ambiguous, contexts }], needsGloss: boolean }
import { measure } from "./text-length.mjs";
import { textOf, viOf } from "./bilingual.mjs";
import { stripDiacritics, nfkcLower } from "./text-fold.mjs";

export const LIMIT_KEY = { title: "title", label_left: "label", label_right: "label", text: "point", tag: "tag", sub: "sub" };
const UNIT_NAME = { grapheme: "ký tự", word: "từ" };

// Nhắc tới khái niệm glossary trong dòng nghĩa tiếng Việt nhưng chữ đích không dùng thuật ngữ chuẩn. Khớp khái niệm DÀI
// trước và gạch khỏi chuỗi (vd "thạch anh tím" trước "thạch anh") để khái niệm con không bị khớp lại.
// Khái niệm mơ hồ (`ambiguous`) không bao giờ bị cảnh báo; khái niệm có `contexts` chỉ bị kiểm khi nghĩa chứa 1 cụm ngữ cảnh.
function glossaryWarnings(text, vi, entries) {
  const out = [];
  const viFolded = ` ${stripDiacritics(vi)} `;
  let rest = viFolded;
  const normText = nfkcLower(text);
  for (const { concept, term, ambiguous, contexts } of [...entries].sort((a, b) => b.concept.length - a.concept.length)) {
    const key = stripDiacritics(concept);
    if (!key || !rest.includes(key)) continue;
    rest = rest.split(key).join(" ");
    if (ambiguous) continue;
    if (contexts && !contexts.some((c) => viFolded.includes(stripDiacritics(c)))) continue;
    // thuật ngữ có thể ghi kèm chú thích: "金（ゴールド）" -> chấp nhận cả "金" lẫn "ゴールド"
    const variants = [term, ...term.split(/[()（）]/).map((s) => s.trim()).filter(Boolean)].map(nfkcLower);
    if (!variants.some((v) => normText.includes(v))) out.push({ code: "glossary-term", concept, term });
  }
  return out;
}

/** Cảnh báo cho 1 field hiển thị. `kind` ∈ title|label_left|label_right|text|tag|sub. */
export function warningsForField(kind, field, rules) {
  const text = textOf(field);
  const warnings = [];
  const add = (code, message, extra = {}) => warnings.push({ code, message, ...extra });
  if (!text.trim()) return warnings; // field rỗng hợp lệ (vd sub) — không có gì để kiểm

  const limit = rules.limits[LIMIT_KEY[kind]];
  const used = measure(text, rules.limits.unit);
  if (used > limit) add("too-long", `Vượt giới hạn ${limit} ${UNIT_NAME[rules.limits.unit]} (đang ${used}).`, { limit, used });

  const normText = nfkcLower(text);
  for (const phrase of rules.forbiddenPhrases) {
    if (normText.includes(nfkcLower(phrase))) add("forbidden-phrase", `Chứa cụm bị cấm của thị trường: "${phrase}".`, { phrase });
  }

  if (rules.needsGloss) {
    const vi = viOf(field).trim();
    if (!vi) {
      add("missing-vi", "Thiếu dòng nghĩa tiếng Việt.");
    } else {
      for (const g of glossaryWarnings(text, vi, rules.glossary)) {
        add("glossary-term", `Nghĩa nhắc "${g.concept}" nhưng chữ không dùng thuật ngữ chuẩn "${g.term}".`, g);
      }
    }
  }
  return warnings;
}

/** Thời gian đọc ước tính (giây) của 1 câu theo readingRate (đơn vị/giây) của thị trường. */
export function readingSeconds(text, rules) {
  const n = measure(text, rules.limits.unit);
  return n / rules.limits.readingRate;
}
