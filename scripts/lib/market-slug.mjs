// Slug theo thị trường: slug bản ngoại ngữ = slug gốc + slugSuffix (vd thach-anh-tim-vs-thach-anh-vang-ja). Thị trường mặc định giữ
// slug như cũ. Slug gốc của bản ngoại ngữ sinh từ nghĩa tiếng Việt (`vi`) của label — KHÔNG từ chữ đích (chữ Nhật/Thái ra slug rỗng
// vì slugify chỉ giữ a-z0-9).
import { slugify } from "./slug.mjs";
import { getDefaultLocale } from "./locales.mjs";
import { textOf, viOf } from "../../public/shared/bilingual.mjs";

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Hậu tố slug thực tế: "" cho thị trường mặc định; còn lại slugSuffix trong file locale (rỗng -> mã ngôn ngữ, để không đụng slug mặc định). */
export function effectiveSlugSuffix(locale, defaultCode = getDefaultLocale().code) {
  if (locale.code === defaultCode) return "";
  return locale.slugSuffix || locale.language;
}

export function slugForLocale(baseSlug, locale, defaultCode) {
  const suffix = effectiveSlugSuffix(locale, defaultCode);
  return suffix ? `${baseSlug}-${suffix}` : baseSlug;
}

/** Slug đã có đúng hậu tố của thị trường (và còn phần gốc) chưa. Thị trường mặc định: luôn đúng. */
export function hasLocaleSuffix(slug, locale, defaultCode) {
  const suffix = effectiveSlugSuffix(locale, defaultCode);
  return !suffix || (slug.endsWith(`-${suffix}`) && slug.length > suffix.length + 1);
}

/** Bỏ hậu tố của thị trường (nếu có) để lấy slug gốc. */
export function stripLocaleSuffix(slug, locale, defaultCode) {
  const suffix = effectiveSlugSuffix(locale, defaultCode);
  return suffix && hasLocaleSuffix(slug, locale, defaultCode) ? slug.slice(0, -(suffix.length + 1)) : slug;
}

/**
 * Slug gốc "<trái>-vs-<phải>" từ nội dung. Mỗi bên thử lần lượt: nghĩa tiếng Việt (vi) -> chữ đích -> tên vật liệu; bên nào ra rỗng
 * (toàn chữ Nhật/Thái...) thì cả slug là null — người dùng phải nhập tay, KHÔNG sinh slug rỗng/hỏng.
 */
export function baseSlugFromContent(content) {
  const side = (field, material) => slugify(viOf(field)) || slugify(textOf(field)) || slugify(String(material ?? ""));
  const mats = Array.isArray(content?.materials) ? content.materials : [];
  const left = side(content?.label_left, mats[0]);
  const right = side(content?.label_right, mats[1]);
  return left && right ? `${left}-vs-${right}` : null;
}

/**
 * Slug cuối cùng chưa bị chiếm: thêm số thứ tự TRƯỚC hậu tố thị trường (x-2-ja, không phải x-ja-2) để hậu tố luôn nằm cuối.
 * @param {(slug:string)=>boolean} taken
 */
export function uniqueSlugForLocale(baseSlug, locale, taken, defaultCode) {
  let n = 1;
  for (;;) {
    const base = n === 1 ? baseSlug : `${baseSlug}-${n}`;
    const slug = slugForLocale(base, locale, defaultCode);
    if (!taken(slug)) return slug;
    n++;
  }
}
