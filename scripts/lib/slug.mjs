// Bỏ dấu + slug kebab-case. Nguồn duy nhất cho scaffold-compare-video.mjs và generate-compare-content.mjs.
// LƯU Ý: chỉ giữ [a-z0-9] nên chuỗi toàn chữ Nhật/Thái ra slug RỖNG — slug bản ngoại ngữ phải sinh từ
// nhãn tiếng Việt (xem M4), không bao giờ từ nhãn ngôn ngữ đích.
import { stripDiacritics } from "../../public/shared/text-fold.mjs";

export { stripDiacritics };

export function slugify(str) {
  return stripDiacritics(str)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
