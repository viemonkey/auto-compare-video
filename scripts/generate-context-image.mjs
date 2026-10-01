// Auto Compare Video — Giai đoạn 1 (MVP): sinh ảnh minh hoạ ngữ cảnh bằng Gemini image
// generation, cho tối đa MAX_CONTEXT_IMAGES point/video được đánh dấu needs_context_image=true
// (mặc định 5 — xem enforceContextImageLimits) — giới hạn cứng đó áp dụng ở
// scripts/generate-compare-content.mjs, KHÔNG phải ở đây; module này chỉ biết sinh 1 ảnh cho
// 1 concept, gọi bao nhiêu lần là quyết định của caller.
//
// Đây là tính năng PHỤ — KHÔNG được phép làm hỏng cả video khi lỗi. Mọi lỗi (thiếu API key,
// network, timeout, safety block, response rỗng...) đều trả về null thay vì throw; caller
// (scripts/scaffold-compare-video.mjs) giữ nguyên ảnh sản phẩm gốc khi nhận null.
//
// 2026-09-18: thêm retry ngắn (MAX_ATTEMPTS, xem callImageGenOnce/generateContextImage bên
// dưới) sau khi phát hiện batch nhiều video liên tiếp trong 1 phiên có thể dồn dập chạm
// rate-limit free-tier của IMAGE_GEN_API_KEY — trước đây "chỉ gọi 1 lần/point" nghĩa là 1 lần
// 429 thoáng qua là mất ảnh vĩnh viễn cho point đó, im lặng (chỉ console.warn, không có log
// bền — xem server.mjs § log file). Chỉ lỗi TẠM THỜI (network/timeout/429/5xx/response thiếu
// ảnh) mới được retry; lỗi do thiếu key/sai key/bị safety block/400 thì dừng ngay (retry không
// đổi kết quả).
//
// Phạm vi CHƯA làm ở giai đoạn 1 (xem kiến trúc đã duyệt) — để giai đoạn sau:
//   - Cache ảnh đã sinh (tránh gọi API trùng concept).
//   - Đa provider (chỉ Gemini — tận dụng hạ tầng .env đã có).
//   - Watermark đánh dấu ảnh AI-generated.
//
// Usage (CLI, test tay 1 concept trước khi chạy cả pipeline):
//   node scripts/generate-context-image.mjs "diamond forming under extreme pressure" --out /tmp/test
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { calcImageCost } from "../config/pricing.mjs";
import { appendCostEntry } from "./lib/cost-ledger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Sinh ảnh có thể chậm hơn sinh text (Vision) — không retry ở giai đoạn 1, chỉ 1 lần gọi/point,
// nên timeout để rộng hơn REQUEST_TIMEOUT_MS của generate-compare-content.mjs (60s).
const REQUEST_TIMEOUT_MS = 60_000;

// ============================================================
// .env loader — giữ đúng convention của generate-compare-content.mjs (đọc .env ở repo root,
// fallback .env.example nếu .env chưa tồn tại).
// ============================================================
function loadEnv() {
  const envPath = fs.existsSync(path.join(REPO_ROOT, ".env"))
    ? path.join(REPO_ROOT, ".env")
    : path.join(REPO_ROOT, ".env.example");
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.trim().match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const ENV = loadEnv();
// Dùng chung GEMINI_API_KEY với generate-compare-content.mjs (trước đây tách riêng
// IMAGE_GEN_API_KEY để theo dõi chi phí riêng, nhưng thực tế luôn trỏ cùng 1 key/project nên
// gộp lại cho gọn — 2026-09-26). KHÔNG process.exit khi thiếu ở ĐÂY: đây là tính năng phụ tuỳ
// chọn, thiếu key chỉ nên tắt tính năng (trả null), không được chặn cả pipeline dựng video —
// việc chặn bắt buộc khi thiếu key đã do generate-compare-content.mjs đảm nhiệm.
const IMAGE_GEN_API_KEY = ENV.GEMINI_API_KEY;
// Mặc định đọc từ .env — xem .env.example cho model hiện hành + lịch ngừng hoạt động.
// 2026-09: đã verify request/response shape dưới đây (responseModalities, imageConfig.aspectRatio)
// giống hệt nhau giữa gemini-2.5-flash-image và gemini-3-pro-image-preview, nên đổi
// IMAGE_GEN_MODEL sang model kế nhiệm (vd gemini-3.1-flash-image) CHỈ cần sửa .env — trừ khi
// model đó đổi hẳn shape này (lỗi 400 thì xem lại generationConfig bên dưới trước).
const IMAGE_GEN_MODEL = ENV.IMAGE_GEN_MODEL || "gemini-2.5-flash-image";

// Panel .card-image dùng object-fit:cover trong khung 420x372 (xem templates/auto-compare/index.html)
// nên không cần ảnh đúng tỉ lệ pixel — chỉ cần bucket gần nhất trong tập aspect ratio cố định
// mà API image-gen hỗ trợ (1:1, 5:4, 4:3, 3:2, 21:9, 4:5, 3:4, 2:3, 9:16, 16:9...), phần dư 2
// cạnh do object-fit:cover tự crop, không lệch bố cục. 420:372 = 1.129 — khoảng cách tới từng
// bucket: |1.129-1.0|=0.129 (1:1) vs |1.129-1.25|=0.121 (5:4) vs |1.129-1.333|=0.204 (4:3) →
// "5:4" GẦN NHẤT, không phải "1:1" (2026-09: đã sửa từ 1:1 sau khi ảnh test ra gần vuông).
const IMAGE_ASPECT_RATIO = "5:4";

// Style cố định cho MỌI ảnh minh hoạ ngữ cảnh — khoá tông để khớp nền marble tối + ánh sáng
// studio ấm đang dùng cho card sản phẩm/avatar (xem DESIGN.md), tránh model tự chọn tông màu
// nóng/tương phản mạnh (vd cam/đỏ kiểu dung nham — lỗi thực tế gặp ở lần test đầu với concept
// "diamond forming deep underground"). Đặt style TRƯỚC concept trong prompt vì Gemini có xu
// hướng ưu tiên chỉ dẫn xuất hiện trước.
const STYLE_PREFIX =
  "Photorealistic editorial photo. Dark elegant tone, warm soft studio lighting, sophisticated " +
  "jewelry-brand aesthetic, subtle and refined, matching a dark marble background. Avoid bright " +
  "orange/red harsh colors. Shallow depth of field, high detail. No text, no watermark, no logo, " +
  "no caption, no human faces, no hands. Subject: ";

const EXT_BY_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

// 1 lần gọi ban đầu + tối đa 1 retry — ảnh minh hoạ ngữ cảnh là tính năng phụ, không đáng để
// user chờ thêm nhiều vòng retry như Gemini text (MAX_ATTEMPTS=3 ở generate-compare-content.mjs),
// nhưng 1 retry là đủ để sống sót qua 1 lần 429/503 thoáng qua giữa batch nhiều video liên tiếp.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Lỗi KHÔNG đáng retry: thiếu/sai key, bị safety block, request sai format — gọi lại cũng ra
// cùng kết quả, retry chỉ tốn thời gian.
class NonRetryableImageGenError extends Error {}

async function callImageGenOnce({ concept, outBase, label, slug, attempt }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_GEN_MODEL}:generateContent?key=${IMAGE_GEN_API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: STYLE_PREFIX + concept.trim() }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: IMAGE_ASPECT_RATIO },
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const reason =
      err.name === "AbortError" ? `timeout sau ${REQUEST_TIMEOUT_MS / 1000}s` : `network: ${err.message}`;
    // Chưa chạm tới server (network/timeout) — Google không tính phí, chỉ ghi sổ để theo dõi.
    appendCostEntry({ slug, task: "context-image", model: IMAGE_GEN_MODEL, status: "error", errorMessage: reason, attempt });
    throw new Error(`gọi API thất bại (${reason})`); // retryable
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // Mọi lỗi HTTP (429/400/401/403/5xx) đều không bị Google tính phí — cost_usd luôn 0.
    appendCostEntry({
      slug,
      task: "context-image",
      model: IMAGE_GEN_MODEL,
      status: "error",
      httpStatus: res.status,
      errorMessage: errText.slice(0, 500),
      attempt,
    });
    // 401/403 (key sai/thiếu quyền) và 400 (request sai format) — retry vô ích.
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      throw new NonRetryableImageGenError(`HTTP ${res.status} — ${errText.slice(0, 300)}`);
    }
    // 429 (rate limit) / 5xx (lỗi tạm thời phía server) — đáng retry.
    throw new Error(`HTTP ${res.status} — ${errText.slice(0, 300)}`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    appendCostEntry({
      slug,
      task: "context-image",
      model: IMAGE_GEN_MODEL,
      status: "error",
      httpStatus: res.status,
      errorMessage: "response không phải JSON hợp lệ",
      attempt,
    });
    throw new Error("response không phải JSON hợp lệ"); // retryable — có thể do response cụt giữa chừng
  }

  const blockReason = json?.promptFeedback?.blockReason;
  if (blockReason) {
    // Không sinh ra ảnh nào -> không tính phí (chưa xác nhận Google có bill phần input đã xử lý
    // hay không ở trường hợp này, coi là 0 cho an toàn — tránh phóng đại chi phí hiển thị).
    appendCostEntry({
      slug,
      task: "context-image",
      model: IMAGE_GEN_MODEL,
      status: "error",
      httpStatus: res.status,
      errorMessage: `bị safety block (${blockReason})`,
      attempt,
    });
    throw new NonRetryableImageGenError(`bị safety block (${blockReason})`);
  }

  const parts = json?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) {
    const finishReason = json?.candidates?.[0]?.finishReason || "unknown";
    appendCostEntry({
      slug,
      task: "context-image",
      model: IMAGE_GEN_MODEL,
      status: "error",
      httpStatus: res.status,
      errorMessage: `response không có ảnh (finishReason: ${finishReason})`,
      attempt,
    });
    throw new Error(`response không có ảnh (finishReason: ${finishReason})`); // retryable
  }

  // Ảnh đã sinh thành công — Google tính phí request này bất kể sau đây ghi file cục bộ có lỗi
  // hay không (lỗi ghi đĩa là vấn đề phía chúng ta, không liên quan tới billing của Google).
  appendCostEntry({
    slug,
    task: "context-image",
    model: IMAGE_GEN_MODEL,
    status: "success",
    httpStatus: res.status,
    imageCount: 1,
    costUsd: calcImageCost(IMAGE_GEN_MODEL, 1),
    attempt,
  });

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const ext = EXT_BY_MIME[mimeType] || ".png";
  const outPath = `${outBase}${ext}`;

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(imagePart.inlineData.data, "base64"));
  } catch (err) {
    // Lỗi ghi đĩa (quyền/dung lượng) sẽ lặp lại y hệt ở lần retry — không đáng thử lại.
    throw new NonRetryableImageGenError(`ghi file thất bại (${err.message})`);
  }

  return outPath;
}

/**
 * Sinh 1 ảnh minh hoạ ngữ cảnh từ mô tả ngắn (field image_concept của 1 point, tiếng Anh).
 * KHÔNG BAO GIỜ throw — mọi lỗi trả về null kèm 1 dòng console.warn để biết point nào bị rớt
 * ảnh, đúng yêu cầu "không chặn build video". Retry tối đa 1 lần cho lỗi tạm thời (xem
 * callImageGenOnce/NonRetryableImageGenError).
 *
 * @param {{ concept: string, outBase: string }} args
 *   concept: mô tả ngắn cảnh cần minh hoạ.
 *   outBase: đường dẫn output KHÔNG kèm đuôi file — đuôi do mimeType Gemini trả về quyết định.
 * @returns {Promise<string|null>} đường dẫn file đã ghi (kèm đuôi), hoặc null nếu lỗi/fallback.
 */
async function generateContextImage({ concept, outBase, slug = null }) {
  const label = outBase ? path.basename(outBase) : "(?)";

  if (!concept || !concept.trim()) {
    console.warn(`⚠ [generate-context-image] "${label}": image_concept rỗng — bỏ qua, giữ ảnh gốc.`);
    return null;
  }
  if (!IMAGE_GEN_API_KEY) {
    console.warn(
      `⚠ [generate-context-image] "${label}": thiếu GEMINI_API_KEY trong .env — bỏ qua, giữ ảnh gốc.`,
    );
    return null;
  }

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callImageGenOnce({ concept, outBase, label, slug, attempt });
    } catch (err) {
      lastErr = err;
      if (err instanceof NonRetryableImageGenError) break;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `⚠ [generate-context-image] "${label}": lần ${attempt}/${MAX_ATTEMPTS} thất bại (${err.message}) — thử lại...`,
        );
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  console.warn(`⚠ [generate-context-image] "${label}": ${lastErr.message} — giữ ảnh gốc.`);
  return null;
}

// ============================================================
// CLI (test tay 1 concept, KHÔNG dùng trong pipeline scaffold — đó gọi hàm bằng import,
// giống cách scaffold-compare-video.mjs import runCompareContent)
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outBase =
    outIdx >= 0 ? args[outIdx + 1].replace(/\.[a-z0-9]+$/i, "") : path.join(process.cwd(), "context-image-test");
  const concept = args.filter((a, i) => a !== "--out" && args[i - 1] !== "--out").join(" ");

  if (!concept) {
    console.error('Usage: node scripts/generate-context-image.mjs "<concept text>" [--out <path-không-đuôi>]');
    process.exitCode = 1;
    return;
  }

  console.log(`Model: ${IMAGE_GEN_MODEL}`);
  console.log(`Concept: ${concept}`);
  const result = await generateContextImage({ concept, outBase });
  if (result) {
    console.log(`OK — đã ghi ${result}`);
  } else {
    console.log("THẤT BẠI — xem cảnh báo ở trên (đây là fallback đúng thiết kế, không phải crash).");
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}

export { generateContextImage };
