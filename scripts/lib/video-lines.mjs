// Các dòng thoại / chữ hiển thị của 1 video so sánh, theo thị trường. MỘT NGUỒN cho scaffold (dựng video) và kiểm tra vừa khung (Bước 2).
// Chữ cố định (câu mở đầu, câu chốt, thẻ kênh...) nằm trong config/locales/<code>.json → video.*, không hard-code ở code.
import { textOf } from "../../public/shared/bilingual.mjs";

/** Thay {label} / {left} / {right} trong mẫu câu. Thiếu biến -> để nguyên (validateLocale đã bắt buộc có biến cần thiết). */
export function fillTemplate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export const hookText = (locale, label) => fillTemplate(locale.video.hookLine, { label });
export const payoffText = (locale, left, right) => fillTemplate(locale.video.payoffLine, { left, right });
export const docTitleText = (locale, left, right) => fillTemplate(locale.video.docTitle, { left, right });

/**
 * Mọi câu sẽ hiện thành caption karaoke, theo thứ tự đọc: hook trái, hook phải, câu hỏi (title), từng point, câu chốt.
 * `field` = tên field nội dung chịu trách nhiệm nếu câu đó lỗi (hook/payoff do nhãn tạo ra -> lỗi gán cho nhãn).
 * @returns {Array<{id:string, field:string, text:string}>}
 */
export function spokenLines(content, locale) {
  const left = textOf(content.label_left);
  const right = textOf(content.label_right);
  const lines = [
    { id: "hook-left", field: "label_left", text: hookText(locale, left) },
    { id: "hook-right", field: "label_right", text: hookText(locale, right) },
    { id: "title", field: "title", text: textOf(content.title) },
  ];
  (content.points || []).forEach((p, i) => lines.push({ id: `point-${i}`, field: `points.${i}.text`, text: textOf(p.text) }));
  lines.push({ id: "payoff", field: "label_left", text: payoffText(locale, left, right) });
  return lines;
}
