// Đo độ dài chữ hiển thị — KHÔNG dùng string.length (UTF-16): tiếng Thái có dấu/nguyên âm kết hợp, tiếng Nhật,
// emoji ghép... đều bị đếm sai. Dùng Intl.Segmenter (grapheme = ký tự người đọc thấy; word = từ).
// Dùng chung cho server (validate nội dung Gemini) và trình duyệt (cảnh báo theo dòng ở Bước 2).

const graphemeSeg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const wordSeg = new Intl.Segmenter(undefined, { granularity: "word" });

export function countGraphemes(str) {
  let n = 0;
  for (const _ of graphemeSeg.segment(String(str ?? ""))) n++;
  return n;
}

export function countWords(str) {
  let n = 0;
  for (const s of wordSeg.segment(String(str ?? ""))) if (s.isWordLike) n++;
  return n;
}

/** Đo theo đơn vị của locale: "grapheme" | "word". */
export function measure(str, unit) {
  return unit === "word" ? countWords(str) : countGraphemes(str);
}

/** Cắt còn tối đa `max` grapheme (không cắt đôi cụm ký tự). */
export function truncateGraphemes(str, max) {
  let out = "";
  let n = 0;
  for (const s of graphemeSeg.segment(String(str ?? ""))) {
    if (n++ >= max) break;
    out += s.segment;
  }
  return out;
}
