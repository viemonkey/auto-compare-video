// Đọc/ghi các field hiển thị của nội dung kịch bản — DÙNG CHUNG cho server (import) và trình duyệt (<script type="module">).
// Một field hiển thị có 2 dạng, mọi nơi đọc đều phải qua các hàm này (không tự đọc `.text` rải rác):
//   - chuỗi phẳng (nội dung tiếng Việt / dữ liệu cũ):  "Thạch anh tím"
//   - song ngữ (thị trường khác):                       { text: "アメジスト", vi: "Thạch anh tím" }
// Trường hợp chuỗi phẳng KHÔNG có nghĩa tiếng Việt (viOf trả "").

/** Các field hiển thị cấp nội dung và cấp point. */
export const CONTENT_FIELDS = ["title", "label_left", "label_right"];
export const POINT_FIELDS = ["text", "tag", "sub"];

export const isBilingualField = (f) => f !== null && typeof f === "object" && !Array.isArray(f) && typeof f.text === "string";

/** Chữ hiển thị (ngôn ngữ đích) của 1 field — chuỗi phẳng hoặc {text, vi}. Không hợp lệ -> "". */
export function textOf(field) {
  if (typeof field === "string") return field;
  return isBilingualField(field) ? field.text : "";
}

/** Nghĩa tiếng Việt của 1 field song ngữ; chuỗi phẳng / thiếu -> "". */
export function viOf(field) {
  return isBilingualField(field) && typeof field.vi === "string" ? field.vi : "";
}

/** Có dòng nghĩa tiếng Việt không rỗng không. */
export const hasVi = (field) => viOf(field).trim() !== "";

/** Dựng field song ngữ. */
export const bilingual = (text, vi) => ({ text: String(text ?? ""), vi: String(vi ?? "") });

/**
 * Chuẩn hoá giá trị Gemini trả về cho 1 field: thị trường cần nghĩa tiếng Việt (`wantVi`) -> luôn {text, vi}
 * (chuỗi phẳng được bọc, vi = ""); thị trường mặc định -> luôn chuỗi phẳng (object bị lấy text).
 */
export function coerceField(value, wantVi) {
  const text = textOf(value);
  return wantVi ? { text, vi: viOf(value) } : text;
}

/**
 * Bản "phẳng" của nội dung: mọi field hiển thị thành chuỗi (text đích). Dùng cho code chỉ cần chữ (slug, caption,
 * scaffold, danh sách video). Không đổi object gốc.
 */
export function flattenContent(content) {
  if (!content || typeof content !== "object") return content;
  const out = { ...content };
  for (const k of CONTENT_FIELDS) if (k in out) out[k] = textOf(out[k]);
  if (Array.isArray(out.points)) {
    out.points = out.points.map((p) => {
      const q = { ...p };
      for (const k of POINT_FIELDS) if (k in q) q[k] = textOf(q[k]);
      return q;
    });
  }
  return out;
}
