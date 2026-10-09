// Gợi ý cách sửa bằng tiếng Việt cho lỗi của từng khâu dựng video. Dùng chung server (gắn vào job lúc lỗi)
// và trình duyệt (job cũ chưa có gợi ý vẫn hiện được), nên chỉ chứa logic thuần, không đụng Node/DOM.

const MEDIA_TOOLS = "Máy thiếu ffmpeg/ffprobe đi kèm. Chạy `npm install` trong thư mục dự án rồi khởi động lại server, sau đó bấm “Thử lại”.";

const BY_CODE = {
  MEDIA_TOOLS_MISSING: MEDIA_TOOLS,
  INTERRUPTED: "Server đã dừng hoặc khởi động lại giữa chừng. Các khâu đã xong được giữ nguyên — bấm “Thử lại” để chạy tiếp từ khâu này.",
  ENOENT: "Không tìm thấy chương trình cần chạy (có thể thiếu cài đặt). Chạy `npm install` rồi bấm “Thử lại”.",
  EACCES: "Không đủ quyền chạy chương trình hoặc ghi file. Kiểm tra quyền thư mục dự án rồi bấm “Thử lại”.",
  EPERM: "Hệ điều hành chặn thao tác với file (thường do antivirus hoặc file đang mở). Đóng chương trình đang giữ file rồi bấm “Thử lại”.",
  ENOSPC: "Ổ đĩa đầy. Giải phóng dung lượng rồi bấm “Thử lại”.",
};

const BY_STAGE = {
  voice: "Giọng đọc chưa sinh xong — thường do mất mạng hoặc dịch vụ đọc (Edge/Vbee/VieNeu) tạm lỗi. Kiểm tra kết nối rồi bấm “Thử lại”; kịch bản và ảnh đã dựng được giữ nguyên, không gọi lại Gemini.",
  timing: "Không tính được nhịp từ file giọng đọc. Bấm “Thử lại”; nếu vẫn lỗi, chọn “Dựng lại từ đầu” để sinh lại giọng.",
  scene: "Không ghép được cảnh. Nếu log nhắc chữ không vừa khung, quay lại Bước 2 để rút gọn câu đó rồi dựng lại.",
  render: "Render MP4 bị gián đoạn (hết RAM, bị đóng giữa chừng hoặc Chrome lỗi). Đóng bớt ứng dụng nặng rồi bấm “Thử lại”.",
  check: "Video đã render nhưng kiểm tra chất lượng báo lỗi. Mở “Log kỹ thuật” để xem dòng lỗi, sửa kịch bản ở Bước 2 nếu cần.",
};

const FALLBACK = "Bấm “Thử lại” để chạy tiếp từ khâu này. Nếu lỗi lặp lại, mở “Log kỹ thuật” hoặc chọn “Dựng lại từ đầu”.";

/** Gợi ý cho 1 khâu lỗi: ưu tiên mã lỗi cụ thể, rồi tới khâu, cuối cùng là gợi ý chung. */
export function buildErrorHint(stageId, error) {
  const code = String(error?.code || "").toUpperCase();
  if (BY_CODE[code]) return BY_CODE[code];
  const text = `${error?.message || ""} ${error?.technical || ""}`;
  if (/ffprobe|ffmpeg/i.test(text) && /ENOENT|not found|không tìm thấy/i.test(text)) return MEDIA_TOOLS;
  return BY_STAGE[stageId] || FALLBACK;
}
