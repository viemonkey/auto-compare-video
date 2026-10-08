// Bảng giá tập trung cho các tác vụ gọi AI trong tool "Auto Compare Video".
//
// Đây là NGUỒN DUY NHẤT cho đơn giá dùng để tính chi phí ước tính mỗi lần gọi Gemini —
// scripts/lib/cost-ledger.mjs và mọi nơi ghi output/cost-ledger.jsonl đều import từ đây,
// KHÔNG hardcode số ở nơi khác.
//
// NGUỒN: https://ai.google.dev/gemini-api/docs/pricing — mục "Paid Tier, Standard" (không Batch/Flex/Priority).
// CẬP NHẬT GIÁ GẦN NHẤT: 2026-10-02 (đối chiếu trực tiếp trang trên).
//
// Lưu ý khi đối chiếu:
//   - "output" của model text đã GỒM token thinking → tính theo candidatesTokenCount + thoughtsTokenCount.
//   - Model ảnh: giá theo token output ảnh; $/ảnh dưới đây là mức Google công bố cho độ phân giải 1K (mặc định khi
//     request không đặt imageSize — xem generate-context-image.mjs). Đổi độ phân giải thì phải đổi perImage.
//   - Dòng 3.6/3.7/3.8 Flash có giá theo mốc thời gian (đến 31/12/2026 rồi tăng gấp đôi) — chưa dùng nên chưa đưa vào;
//     khi dùng thì thêm kèm `validUntil`.
//   - Model KHÔNG có trong bảng: calcXxxCost() trả 0 và cảnh báo; dòng sổ được UI Thống kê chi phí đánh dấu "chưa có giá"
//     (isPriced() bên dưới) thay vì hiện 0 như thật.
export const PRICING_SOURCE = {
  url: "https://ai.google.dev/gemini-api/docs/pricing",
  lastUpdated: "2026-10-02",
};

export const PRICING = {
  "gemini-3.5-flash": {
    task: "content-generation",
    unit: "USD / 1M token",
    inputPerMillion: 1.5,
    outputPerMillion: 9.0,
    lastUpdated: "2026-10-02",
    note: "Giá chính thức. (Bản trước 2026-10-02 ghi ước tính 0.30/2.50 — thấp hơn thật ~5 lần/3.6 lần.)",
  },
  "gemini-3.5-flash-lite": {
    task: "content-generation",
    unit: "USD / 1M token",
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
    lastUpdated: "2026-10-02",
    note: "Giá chính thức.",
  },
  "gemini-2.5-flash": {
    task: "content-generation",
    unit: "USD / 1M token",
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
    lastUpdated: "2026-10-02",
    note: "Giá chính thức.",
  },
  "gemini-2.5-flash-lite": {
    task: "content-generation",
    unit: "USD / 1M token",
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    lastUpdated: "2026-10-02",
    note: "Giá chính thức.",
  },
  "gemini-3.1-flash-image": {
    task: "context-image",
    unit: "USD / ảnh",
    perImage: 0.067,
    lastUpdated: "2026-10-02",
    note: "Output ảnh $60/1M token ≈ $0.067/ảnh 1K (512px $0.045, 2K $0.101, 4K $0.151); input $0.50/1M token chưa tính (prompt ngắn, không đáng kể).",
  },
  "gemini-3.1-flash-lite-image": {
    task: "context-image",
    unit: "USD / ảnh",
    perImage: 0.0336,
    lastUpdated: "2026-10-02",
    note: "Output ảnh $30/1M token ≈ $0.0336/ảnh 1K.",
  },
  "gemini-2.5-flash-image": {
    task: "context-image",
    unit: "USD / ảnh",
    perImage: 0.039,
    lastUpdated: "2026-10-02",
    note: "Giá chính thức $0.039/ảnh (model đã deprecated).",
  },
};

export const DEFAULT_USD_TO_VND = 26000;

/**
 * Tỷ giá USD→VND dùng để hiện số tiền ước tính ở Thống kê chi phí (đặt USD_TO_VND trong .env; không hợp lệ -> mặc định).
 * Là tỷ giá cố định do bạn đặt, KHÔNG phải tỷ giá thời gian thực.
 */
export function usdToVnd(env = process.env) {
  const raw = String(env.USD_TO_VND ?? "").trim();
  if (!raw) return DEFAULT_USD_TO_VND;
  const n = Number(raw.replace(/[_,]/g, ""));
  if (Number.isFinite(n) && n > 0) return n;
  console.warn(`⚠ [config/pricing.mjs] USD_TO_VND="${raw}" không hợp lệ — dùng mặc định ${DEFAULT_USD_TO_VND}.`);
  return DEFAULT_USD_TO_VND;
}

/** Model có đơn giá cho loại tác vụ này chưa? kind: "content-generation" (theo token) | "context-image" (theo ảnh). */
export function isPriced(model, kind = "content-generation") {
  const price = PRICING[model];
  if (!price) return false;
  return kind === "context-image" ? typeof price.perImage === "number" : typeof price.inputPerMillion === "number";
}

// Fallback dùng khi gặp model không có trong PRICING (vd đổi GEMINI_MODEL/IMAGE_GEN_MODEL
// trong .env nhưng quên thêm giá mới vào đây) — trả cost 0 thay vì throw, kèm cảnh báo, để
// KHÔNG BAO GIỜ làm hỏng cả pipeline dựng video chỉ vì thiếu giá tham chiếu.
const warned = new Set();
function warnMissingPrice(model) {
  if (warned.has(model)) return; // mỗi model chỉ cảnh báo 1 lần / tiến trình, tránh spam log
  warned.add(model);
  console.warn(
    `⚠ [config/pricing.mjs] Không có đơn giá cho model "${model}" — cost-ledger sẽ ghi 0 USD cho lần gọi này ` +
      `(UI Thống kê chi phí sẽ đánh dấu "chưa có giá"). ` +
      `Thêm đơn giá vào PRICING trong config/pricing.mjs (kèm ngày cập nhật) rồi chạy "node scripts/reprice-cost-ledger.mjs" để tính lại.`,
  );
}

/**
 * Tính chi phí USD cho 1 lần gọi Gemini sinh kịch bản (text/vision), theo số token input/output (output gồm cả thinking).
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

// ---------------------------------------------------------------------------------------------
// Giọng đọc (TTS): tính theo SỐ KÝ TỰ gửi đi đọc. Engine miễn phí ghi 0 USD nhưng vẫn có dòng trong sổ (task "tts") để thống kê.
// ---------------------------------------------------------------------------------------------
export const TTS_PRICING = {
  azure: {
    unit: "USD / 1M ký tự",
    usdPerMillionChars: 16,
    freeCharsPerMonth: 500_000,
    source: "https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/ — mục Text to speech › Neural (pay-as-you-go, giọng Neural tiêu chuẩn; HD/Custom giá khác)",
    lastUpdated: "2026-10-08",
    note: "$16 / 1 triệu ký tự + miễn phí 0,5 triệu ký tự/tháng (bậc F0). LƯU Ý: trang giá chính thức tải giá bằng JS nên không đọc tự động được ngày 2026-10-08; con số lấy từ nguồn thứ cấp trùng khớp với bảng giá công khai nhiều năm — đối chiếu lại trên trang chính thức trước khi dùng để quyết toán. Chi phí ghi sổ tính THEO SỐ KÝ TỰ gửi đi, chưa trừ phần miễn phí hằng tháng.",
  },
  edge: {
    unit: "USD / 1M ký tự",
    usdPerMillionChars: 0,
    lastUpdated: "2026-10-08",
    note: "Edge TTS (Read Aloud của Microsoft Edge) miễn phí, không chính thức — không có SLA.",
  },
};

/** Chi phí USD đọc `characters` ký tự bằng engine `engine` (0 nếu engine miễn phí hoặc chưa có trong bảng). */
export function calcTtsCost(engine, characters) {
  const price = TTS_PRICING[engine];
  if (!price) return 0;
  return ((characters || 0) / 1_000_000) * price.usdPerMillionChars;
}
