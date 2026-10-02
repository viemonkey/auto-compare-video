// Slug: bỏ dấu + kebab-case, và quy tắc sinh slug gốc "<trái>-vs-<phải>" từ nội dung — DÙNG CHUNG server và trình duyệt (Bước 2 gợi ý slug).
// Slug chỉ gồm a-z0-9 và dấu gạch ngang: chữ Nhật/Thái không bao giờ xuất hiện trong slug (slugify trên chúng ra chuỗi rỗng).
import { stripDiacritics } from "./text-fold.mjs";
import { isBilingualField, textOf, viOf } from "./bilingual.mjs";

export function slugify(str) {
  return stripDiacritics(String(str ?? ""))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Chuỗi chỉ gồm chữ Latin / số / dấu câu / khoảng trắng và có ít nhất 1 chữ Latin (vd "Aquamarine", "Blue Sapphire", "Silver 925";
// KHÔNG nhận "シルバー925" — slugify sẽ ra "925", một slug hỏng).
const NON_LATIN = /[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\p{M}]/u;
export const isLatinName = (s) => typeof s === "string" && /\p{Script=Latin}/u.test(s) && !NON_LATIN.test(s);

/**
 * Slug gốc "<trái>-vs-<phải>". Mỗi bên thử lần lượt, bên nào ra rỗng thì cả slug là null (người dùng nhập tay — KHÔNG sinh slug rỗng/hỏng):
 *  - Bản NGOẠI NGỮ (có dòng nghĩa tiếng Việt): tên tiếng Anh/quốc tế trước — materials (nếu Latin) -> chữ label (nếu Latin) -> nghĩa tiếng Việt (vi).
 *    (Gemini hay giữ tên quốc tế ở materials/label, vd "Aquamarine"; nghĩa tiếng Việt chỉ là phương án cuối.)
 *  - Bản tiếng Việt / dữ liệu cũ (field phẳng): nghĩa/label -> chữ -> tên vật liệu, đúng như trước.
 * @param {{label_left?:any, label_right?:any, materials?:string[]}|null} content
 * @param {{foreign?:boolean}} [opts] foreign: mặc định tự nhận biết (có field song ngữ)
 */
export function baseSlugFromContent(content, { foreign } = {}) {
  const isForeign = foreign ?? (isBilingualField(content?.label_left) || isBilingualField(content?.label_right));
  const mats = Array.isArray(content?.materials) ? content.materials : [];
  const side = (field, material) => {
    const text = textOf(field);
    const vi = viOf(field);
    if (isForeign) {
      const mat = isLatinName(material) ? slugify(material) : "";
      const lab = isLatinName(text) ? slugify(text) : "";
      return mat || lab || slugify(vi);
    }
    return slugify(vi) || slugify(text) || slugify(String(material ?? ""));
  };
  const left = side(content?.label_left, mats[0]);
  const right = side(content?.label_right, mats[1]);
  return left && right ? `${left}-vs-${right}` : null;
}
