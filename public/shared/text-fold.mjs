// Chuẩn hoá chữ để so khớp — dùng chung server + trình duyệt.

/** Bỏ dấu tiếng Việt (đ -> d), thường. */
export function stripDiacritics(str) {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, (m) => (m === "đ" ? "d" : "D"))
    .toLowerCase();
}

/**
 * NFKC + thường, để so khớp chữ ngoại ngữ (full-width, katakana nửa độ rộng...). Ngoại lệ: NFKC tách SARA AM tiếng Thái
 * (U+0E33) thành NIKHAHIT + SARA AA — ghép lại (tương tự tiếng Lào U+0EB3) để không lệch với chữ người dùng gõ.
 */
export function nfkcLower(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/\u0E4D\u0E32/g, "\u0E33")
    .replace(/\u0ECD\u0EB2/g, "\u0EB3")
    .toLowerCase();
}
