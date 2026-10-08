// Thông báo lỗi giọng đọc bằng tiếng Việt (người dùng không đọc được stack trace của dịch vụ).
const ENGINE_NAME = { edge: "Edge TTS", azure: "Azure AI Speech", vbee: "Vbee", vieneu: "VieNeu-TTS" };

/** Lỗi có mã HTTP (Azure) → Error gắn `status` để phân loại retry / thông báo. */
export class TtsHttpError extends Error {
  constructor(status, message) {
    super(message || `HTTP ${status}`);
    this.name = "TtsHttpError";
    this.status = status;
  }
}

/** Lỗi do cấu hình/khoá — thử lại vô ích. */
export const isPermanent = (err) => err instanceof TtsHttpError && [400, 401, 403, 404].includes(err.status);

/** Câu tiếng Việt mô tả lỗi của engine `engineId`. */
export function ttsErrorMessage(engineId, err) {
  const name = ENGINE_NAME[engineId] || engineId;
  const raw = String(err?.message || err || "");
  if (err instanceof TtsHttpError) {
    if (err.status === 401 || err.status === 403) return `${name} từ chối khoá truy cập (HTTP ${err.status}) — kiểm tra AZURE_SPEECH_KEY và AZURE_SPEECH_REGION trong .env.`;
    if (err.status === 400) return `${name} không nhận yêu cầu (HTTP 400) — giọng đọc hoặc nội dung không hợp lệ. Kiểm tra tên giọng trong config.`;
    if (err.status === 404) return `${name} không tìm thấy dịch vụ (HTTP 404) — kiểm tra AZURE_SPEECH_REGION.`;
    if (err.status === 429) return `${name} đang giới hạn tốc độ hoặc hết hạn mức (HTTP 429) — đợi một lúc rồi thử lại.`;
    if (err.status >= 500) return `${name} đang gặp sự cố phía máy chủ (HTTP ${err.status}) — thử lại sau.`;
  }
  if (/timeout|timed out|quá thời gian/i.test(raw)) return `${name} không phản hồi kịp (quá thời gian chờ) — kiểm tra mạng rồi thử lại.`;
  if (/no audio was received|empty audio|âm thanh rỗng/i.test(raw)) return `${name} trả về âm thanh rỗng (lỗi tạm thời của dịch vụ) — thử lại sau ít phút.`;
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|socket/i.test(raw)) return `Không kết nối được tới ${name} — kiểm tra kết nối mạng.`;
  return `${name} lỗi: ${raw.slice(0, 200) || "không rõ nguyên nhân"}.`;
}
