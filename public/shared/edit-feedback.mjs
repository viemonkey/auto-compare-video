// Phản hồi sau khi ✎ Viết lại / ↻ Dịch lại nghĩa ở Bước 2 — hàm thuần, dùng chung trình duyệt + test.
// Mục tiêu: người dùng không đọc được ngôn ngữ đích nên luôn phải THẤY (1) AI hiểu ý mình ra sao, (2) có gì thay đổi hay không,
// (3) lỗi là gì (tiếng Việt, ngay tại dòng) — không bao giờ im lặng.

/**
 * @param {{idea:string, beforeText:string, afterField:{text:string,vi:string}, languageName:string}} a
 * @returns {{unchanged:boolean, idea:string, meaning:string, notice:string}}
 *   idea = ý người dùng nhập; meaning = nghĩa tiếng Việt của câu MỚI do AI viết (để so lệch ý);
 *   notice = dòng thông báo khi chữ đích không đổi ("" nếu có đổi).
 */
export function rewriteFeedback({ idea, beforeText, afterField, languageName }) {
  const unchanged = String(afterField.text).trim() === String(beforeText).trim();
  return {
    unchanged,
    idea: String(idea).trim(),
    meaning: String(afterField.vi || "").trim(),
    notice: unchanged ? `Giữ nguyên — câu hiện tại đã thể hiện đúng ý theo văn phong ${languageName || "ngôn ngữ đích"}.` : "",
  };
}

/** Kết quả ↻ Dịch lại nghĩa: nghĩa mới có khác nghĩa đang hiện không. */
export function translateFeedback({ beforeVi, afterVi }) {
  const same = String(beforeVi || "").trim() === String(afterVi || "").trim();
  return { changed: !same, message: same ? "Nghĩa không đổi — dịch lại vẫn ra kết quả như cũ." : "Đã cập nhật nghĩa tiếng Việt." };
}

const VI_CHARS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

/** Lỗi gọi API -> thông báo tiếng Việt cho đúng dòng. Thông báo server (đã tiếng Việt) giữ nguyên; lỗi kỹ thuật tiếng Anh được thay. */
export function friendlyError(err) {
  const msg = String((err && err.message) || "").trim();
  if (err && err.name === "TypeError") return "Không kết nối được tới máy chủ — kiểm tra lại mạng/server rồi thử lại.";
  if (err && err.name === "AbortError") return "Yêu cầu đã bị huỷ.";
  if (msg && VI_CHARS.test(msg)) return msg;
  return "Không thực hiện được — thử lại sau ít phút.";
}
