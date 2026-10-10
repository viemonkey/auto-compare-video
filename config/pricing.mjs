// Bảng giá tập trung cho các tác vụ gọi AI trong tool "Auto Compare Video".
//
// Đây là NGUỒN DUY NHẤT cho đơn giá dùng để tính chi phí ước tính mỗi lần gọi Gemini —
// scripts/lib/cost-ledger.mjs và mọi nơi ghi output/cost-ledger.jsonl đều import từ đây,
// KHÔNG hardcode số ở nơi khác.
//
// NGUỒN: https://ai.google.dev/gemini-api/docs/pricing — mục "Paid Tier, Standard" (không Batch/Flex/Priority).
// CẬP NHẬT GIÁ GẦN NHẤT: 2026-10-10 (đối chiếu trực tiếp trang trên; từng model có ngày riêng ở `lastUpdated`).
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
  lastUpdated: "2026-10-10",
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
    perImageBySize: { "512": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151 },
    batchPerImageBySize: { "512": 0.022, "1K": 0.034, "2K": 0.05, "4K": 0.076 },
    lastUpdated: "2026-10-10",
    note: "Output ảnh $60/1M token ≈ $0.067/ảnh 1K (512px $0.045, 2K $0.101, 4K $0.151); Batch $30/1M token (1K $0.034). Không có gói miễn phí. Input $0.50/1M token chưa tính (prompt ngắn + ảnh tham chiếu, không đáng kể so với ảnh output).",
  },
  "gemini-3-pro-image": {
    task: "context-image",
    unit: "USD / ảnh",
    perImage: 0.134,
    perImageBySize: { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
    batchPerImageBySize: { "1K": 0.067, "2K": 0.067, "4K": 0.12 },
    lastUpdated: "2026-10-10",
    note: "Nano Banana Pro. $0.134/ảnh 1K-2K, $0.24/ảnh 4K; Batch $0.067 / $0.12. Không có gói miễn phí. Đắt gấp 2 lần 3.1 Flash Image — chỉ nên bật khi 3.1 Flash giữ mặt kém.",
  },
  "gemini-3.1-flash-lite-image": {
    task: "context-image",
    unit: "USD / ảnh",
    perImage: 0.0336,
    perImageBySize: { "1K": 0.0336 },
    lastUpdated: "2026-10-02",
    note: "Output ảnh $30/1M token ≈ $0.0336/ảnh 1K.",
  },
  "gemini-2.5-flash-image": {
    task: "context-image",
    unit: "USD / ảnh",
    perImage: 0.039,
    perImageBySize: { "1K": 0.039 },
    batchPerImageBySize: { "1K": 0.0195 },
    lastUpdated: "2026-10-10",
    note: "Giá chính thức $0.039/ảnh (Batch $0.0195). Trang giá Google ghi \"Deprecated and will be shut down on October 2, 2026\" — ĐÃ QUA hạn khi kiểm ngày 2026-10-10 nên KHÔNG dùng làm mặc định cho chế độ Giới thiệu sản phẩm (mặc định là gemini-3.1-flash-image).",
  },
};

// ---------------------------------------------------------------------------------------------
// Video AI (Veo) — chế độ "Giới thiệu sản phẩm", cảnh mở đầu tuỳ chọn. Tính theo GIÂY video (có âm thanh).
// Nguồn: https://ai.google.dev/gemini-api/docs/pricing (đối chiếu 2026-10-10). Model nào cũng KHÔNG có gói miễn phí.
// ---------------------------------------------------------------------------------------------
export const VIDEO_PRICING = {
  "veo-3.1-lite-generate-preview": {
    unit: "USD / giây video",
    perSecond: { "720p": 0.05, "1080p": 0.08 },
    lastUpdated: "2026-10-10",
    note: "Veo 3.1 Lite (preview). 720p $0.05/giây, 1080p $0.08/giây; không hỗ trợ 4K. Clip 4 giây 720p = $0.20.",
  },
  "veo-3.1-fast-generate-preview": {
    unit: "USD / giây video",
    perSecond: { "720p": 0.1, "1080p": 0.12, "4k": 0.3 },
    lastUpdated: "2026-10-10",
    note: "Veo 3.1 Fast (preview).",
  },
  "veo-3.1-generate-preview": {
    unit: "USD / giây video",
    perSecond: { "720p": 0.4, "1080p": 0.4, "4k": 0.6 },
    lastUpdated: "2026-10-10",
    note: "Veo 3.1 Standard (preview).",
  },
};

export const isVideoPriced = (model, resolution = "720p") => typeof VIDEO_PRICING[model]?.perSecond?.[resolution] === "number";

/** Chi phí USD của 1 clip video. Model/độ phân giải chưa có giá -> null (KHÔNG đoán: ngân sách sẽ từ chối gọi). */
export function calcVideoCost(model, seconds, resolution = "720p") {
  const unit = VIDEO_PRICING[model]?.perSecond?.[resolution];
  return typeof unit === "number" ? (seconds || 0) * unit : null;
}

// Khả năng từng model ảnh/video dùng cho "Giới thiệu sản phẩm" (đối chiếu trang tài liệu chính thức VÀ danh sách model của API thật
// ngày 2026-10-10 — ListModels trả đủ các ID dưới đây). Chỉ để hiển thị/ghi chú; code gọi API KHÔNG suy luận từ bảng này.
export const MODEL_FACTS = {
  checkedAt: "2026-10-10",
  sources: [
    "https://ai.google.dev/gemini-api/docs/pricing",
    "https://ai.google.dev/gemini-api/docs/image-generation",
    "https://ai.google.dev/gemini-api/docs/models",
    "https://ai.google.dev/gemini-api/docs/veo",
  ],
  "gemini-2.5-flash-image": { status: "deprecated — ngừng 2026-10-02", freeTier: false, editing: true, aspect916: true, maxReferenceImages: null },
  "gemini-3.1-flash-image": { status: "stable (Nano Banana 2)", freeTier: false, editing: true, aspect916: true, maxReferenceImages: 14, sizes: ["512", "1K", "2K", "4K"] },
  "gemini-3.1-flash-lite-image": { status: "stable (Nano Banana 2 Lite)", freeTier: false, editing: true, aspect916: true, maxReferenceImages: 14, sizes: ["1K"] },
  "gemini-3-pro-image": { status: "stable (Nano Banana Pro)", freeTier: false, editing: true, aspect916: true, maxReferenceImages: 14, sizes: ["1K", "2K", "4K"] },
  "veo-3.1-lite-generate-preview": { status: "preview", freeTier: false, imageToVideo: true, aspect916: true, durations: [4, 6, 8], resolutions: ["720p", "1080p"], longRunning: true, note: "1080p chỉ cho clip 8 giây; video lưu trên máy chủ 2 ngày; có SynthID." },
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
  if (kind === "video") return false; // model video nằm ở VIDEO_PRICING (xem isVideoPriced)
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
export function calcImageCost(model, imageCount, { size = "", batch = false } = {}) {
  const price = PRICING[model];
  if (!price || typeof price.perImage !== "number") {
    warnMissingPrice(model);
    return 0;
  }
  const table = batch ? price.batchPerImageBySize : price.perImageBySize;
  // Không đặt kích thước (hoặc model không có bảng theo kích thước) -> giá 1K như trước đây. Kích thước không có trong bảng -> giá cao nhất của bảng (ước thừa, không ước thiếu).
  const unit = size && table ? (table[size] ?? Math.max(...Object.values(table))) : batch && table ? (table["1K"] ?? price.perImage) : price.perImage;
  return (imageCount || 0) * unit;
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
