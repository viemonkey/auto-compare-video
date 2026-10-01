// Bảng giá tập trung cho các tác vụ gọi AI trong tool "Auto Compare Video".
//
// Đây là NGUỒN DUY NHẤT cho đơn giá dùng để tính chi phí ước tính mỗi lần gọi Gemini —
// scripts/lib/cost-ledger.mjs và mọi nơi ghi output/cost-ledger.jsonl đều import từ đây,
// KHÔNG hardcode số ở nơi khác.
//
// ⚠ CẬP NHẬT GIÁ GẦN NHẤT: 2026-09-23.
// gemini-3.5-flash là model MỚI (xem GEMINI_MODEL trong .env.example) — tại thời điểm ghi
// bảng giá này, Google CHƯA công bố trang giá riêng cho model đó mà tool đang dùng, nên 2 đơn
// giá input/output bên dưới là ƯỚC TÍNH dựa theo mặt bằng giá của gemini-2.5-flash (model gần
// nhất có giá chính thức). Đơn giá gemini-2.5-flash-image lấy từ giá "Nano Banana" chính thức
// (1290 output token/ảnh * $30/1M token ≈ $0.039/ảnh).
//
// TRƯỚC KHI TIN SỐ LIỆU CHI PHÍ ĐỂ RA QUYẾT ĐỊNH TÀI CHÍNH — đối chiếu lại giá thật tại
// https://ai.google.dev/gemini-api/docs/pricing rồi sửa trực tiếp object PRICING bên dưới
// (nhớ cập nhật luôn `lastUpdated` của model đó).
export const PRICING = {
  "gemini-3.5-flash": {
    task: "content-generation",
    unit: "USD / 1M token",
    inputPerMillion: 0.30,
    outputPerMillion: 2.50,
    lastUpdated: "2026-09-23",
    note: "Ước tính theo mặt bằng giá gemini-2.5-flash — CẦN tự kiểm tra lại khi Google công bố giá chính thức cho gemini-3.5-flash.",
  },
  "gemini-2.5-flash-image": {
    task: "context-image",
    unit: "USD / ảnh",
    perImage: 0.039,
    lastUpdated: "2026-09-23",
    note: "1290 output token/ảnh * $30/1M token (giá Nano Banana chính thức tại thời điểm cập nhật).",
  },
};

// Fallback dùng khi gặp model không có trong PRICING (vd đổi GEMINI_MODEL/IMAGE_GEN_MODEL
// trong .env nhưng quên thêm giá mới vào đây) — trả cost 0 thay vì throw, kèm cảnh báo, để
// KHÔNG BAO GIỜ làm hỏng cả pipeline dựng video chỉ vì thiếu giá tham chiếu.
function warnMissingPrice(model) {
  console.warn(
    `⚠ [config/pricing.mjs] Không có đơn giá cho model "${model}" — cost-ledger sẽ ghi 0 USD cho lần gọi này. ` +
      `Thêm đơn giá vào PRICING trong config/pricing.mjs (kèm ngày cập nhật) để tính đúng chi phí.`,
  );
}

/**
 * Tính chi phí USD cho 1 lần gọi Gemini sinh kịch bản (text/vision), theo số token input/output.
 * @returns {number} chi phí USD (0 nếu model chưa có giá tham chiếu).
 */
export function calcContentCost(model, inputTokens, outputTokens) {
  const price = PRICING[model];
  if (!price || typeof price.inputPerMillion !== "number") {
    warnMissingPrice(model);
    return 0;
  }
  const inCost = ((inputTokens || 0) / 1_000_000) * price.inputPerMillion;
  const outCost = ((outputTokens || 0) / 1_000_000) * price.outputPerMillion;
  return inCost + outCost;
}

/**
 * Tính chi phí USD cho 1 lần gọi Gemini sinh ảnh minh hoạ ngữ cảnh, theo số ảnh sinh ra.
 * @returns {number} chi phí USD (0 nếu model chưa có giá tham chiếu).
 */
export function calcImageCost(model, imageCount) {
  const price = PRICING[model];
  if (!price || typeof price.perImage !== "number") {
    warnMissingPrice(model);
    return 0;
  }
  return (imageCount || 0) * price.perImage;
}
