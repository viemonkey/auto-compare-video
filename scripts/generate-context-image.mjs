// Auto Compare Video — Giai đoạn 1 (MVP): sinh ảnh minh hoạ ngữ cảnh bằng Gemini image
// generation, cho tối đa 2 point/video được đánh dấu needs_context_image=true — giới hạn cứng
// đó áp dụng ở scripts/generate-compare-content.mjs (enforceContextImageLimits), KHÔNG phải ở
// đây; module này chỉ biết sinh 1 ảnh cho 1 concept, gọi bao nhiêu lần là quyết định của caller.
//
// Đây là tính năng PHỤ — KHÔNG được phép làm hỏng cả video khi lỗi. Mọi lỗi (thiếu API key,
// network, timeout, safety block, response rỗng...) đều trả về null thay vì throw; caller
// (scripts/scaffold-compare-video.mjs) giữ nguyên ảnh sản phẩm gốc khi nhận null.
//
// Phạm vi CHƯA làm ở giai đoạn 1 (xem kiến trúc đã duyệt) — để giai đoạn sau:
//   - Cache ảnh đã sinh (tránh gọi API trùng concept).
//   - Retry / backoff khi lỗi tạm thời (chỉ gọi 1 lần/point).
//   - Đa provider (chỉ Gemini — tận dụng hạ tầng .env đã có).
//   - Watermark đánh dấu ảnh AI-generated.
//
// Usage (CLI, test tay 1 concept trước khi chạy cả pipeline):
//   node scripts/generate-context-image.mjs "diamond forming under extreme pressure" --out /tmp/test
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
// Tách riêng khỏi GEMINI_API_KEY (dùng cho Vision ở generate-compare-content.mjs) để theo dõi
// chi phí sinh ảnh riêng — xem .env.example. KHÔNG process.exit khi thiếu: đây là tính năng
// phụ tuỳ chọn, thiếu key chỉ nên tắt tính năng (trả null), không được chặn cả pipeline dựng
// video như GEMINI_API_KEY (bắt buộc) đang làm.
const IMAGE_GEN_API_KEY = ENV.IMAGE_GEN_API_KEY;
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

/**
 * Sinh 1 ảnh minh hoạ ngữ cảnh từ mô tả ngắn (field image_concept của 1 point, tiếng Anh).
 * KHÔNG BAO GIỜ throw — mọi lỗi trả về null kèm 1 dòng console.warn để biết point nào bị rớt
 * ảnh, đúng yêu cầu "không chặn build video".
 *
 * @param {{ concept: string, outBase: string }} args
 *   concept: mô tả ngắn cảnh cần minh hoạ.
 *   outBase: đường dẫn output KHÔNG kèm đuôi file — đuôi do mimeType Gemini trả về quyết định.
 * @returns {Promise<string|null>} đường dẫn file đã ghi (kèm đuôi), hoặc null nếu lỗi/fallback.
 */
async function generateContextImage({ concept, outBase }) {
  const label = outBase ? path.basename(outBase) : "(?)";

  if (!concept || !concept.trim()) {
    console.warn(`⚠ [generate-context-image] "${label}": image_concept rỗng — bỏ qua, giữ ảnh gốc.`);
    return null;
  }
  if (!IMAGE_GEN_API_KEY) {
    console.warn(
      `⚠ [generate-context-image] "${label}": thiếu IMAGE_GEN_API_KEY trong .env — bỏ qua, giữ ảnh gốc.`,
    );
    return null;
  }

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
    console.warn(`⚠ [generate-context-image] "${label}": gọi API thất bại (${reason}) — giữ ảnh gốc.`);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn(
      `⚠ [generate-context-image] "${label}": HTTP ${res.status} — ${errText.slice(0, 300)} — giữ ảnh gốc.`,
    );
    return null;
  }

  let json;
  try {
    json = await res.json();
  } catch {
    console.warn(`⚠ [generate-context-image] "${label}": response không phải JSON hợp lệ — giữ ảnh gốc.`);
    return null;
  }

  const blockReason = json?.promptFeedback?.blockReason;
  if (blockReason) {
    console.warn(`⚠ [generate-context-image] "${label}": bị safety block (${blockReason}) — giữ ảnh gốc.`);
    return null;
  }

  const parts = json?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) {
    const finishReason = json?.candidates?.[0]?.finishReason || "unknown";
    console.warn(
      `⚠ [generate-context-image] "${label}": response không có ảnh (finishReason: ${finishReason}) — giữ ảnh gốc.`,
    );
    return null;
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const ext = EXT_BY_MIME[mimeType] || ".png";
  const outPath = `${outBase}${ext}`;

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(imagePart.inlineData.data, "base64"));
  } catch (err) {
    console.warn(`⚠ [generate-context-image] "${label}": ghi file thất bại (${err.message}) — giữ ảnh gốc.`);
    return null;
  }

  return outPath;
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
