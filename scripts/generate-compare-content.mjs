// Auto Compare Video — Bước 3: tiền xử lý Gemini Vision.
//
// Standalone Node CLI, chạy TRƯỚC khi dựng composition — giống mô hình
// videos/<slug>/scripts/generate-vo.mjs (gọi API bên ngoài, ghi kết quả tĩnh ra đĩa).
// Composition (index.html) không bao giờ gọi API trực tiếp: CLAUDE.md cấm network
// fetch / Math.random() / Date.now() trong composition vì render phải deterministic.
//
// Input : 2 ảnh người dùng muốn so sánh (file path hoặc data URI base64).
// Output: 1 file JSON tĩnh { title, label_left, label_right, points[] } để bước dựng
//         index.html (chưa làm ở phiên này) đọc vào.
//
// Usage:
//   node scripts/generate-compare-content.mjs <left-image> <right-image> [options]
//
// Options:
//   --out <path>          Đường dẫn file JSON output (mặc định ./compare-content.json)
//   --topic-hint <text>   Gợi ý ngữ cảnh thêm cho Gemini (tuỳ chọn, vd "đồ trang sức")
//   --slug <slug>         Gắn slug (thật hoặc TẠM/placeholder) vào dòng cost-ledger.jsonl ghi
//                         cho lần gọi Gemini này — xem scripts/lib/cost-ledger.mjs
//                         renameCostLedgerSlug() nếu cần đổi lại slug tạm thành slug thật sau đó.
//
// Ví dụ:
//   node scripts/generate-compare-content.mjs assets/left.jpg assets/right.jpg \
//     --out videos/kim-cuong-vs-ngoc-trai/content/compare-content.json
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONTENT_ANGLES } from "../config/content-angles.mjs";
import { calcContentCost } from "../config/pricing.mjs";
import { appendCostEntry } from "./lib/cost-ledger.mjs";
import { loadHashtagConfig, resolveTopicTags, cleanTag } from "./lib/hashtags.mjs";
import { buildComparePrompt } from "./lib/compare-prompt.mjs";
import {
  RetryableError,
  NonRetryableError,
  classifyGeminiHttpError,
  describeGeminiErrorForLog,
  redactKey,
  runWithModelFallback,
  withRetry,
} from "./lib/gemini-retry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const MAX_ATTEMPTS = 3; // 1 lần gọi đầu + tối đa 2 lần retry, theo đúng yêu cầu "retry tối đa 2 lần"
const RETRY_BASE_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 60_000; // vision + JSON schema có thể mất >30s ngay cả ở thinkingLevel "low"
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // soft cap — Gemini inlineData giới hạn ảnh ~20MB sau base64

// ============================================================
// .env loader — giữ đúng convention của generate-vo.mjs (đọc .env ở repo root,
// fallback .env.example nếu .env chưa tồn tại; không tạo .env riêng cho feature này).
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
const GEMINI_API_KEY = ENV.GEMINI_API_KEY;
const GEMINI_MODEL = ENV.GEMINI_MODEL || "gemini-3.5-flash";
// Model dự phòng khi model chính HẾT QUOTA THEO NGÀY (429 PerDay). Trống = không chuyển, báo lỗi ngay.
const GEMINI_FALLBACK_MODEL = (ENV.GEMINI_FALLBACK_MODEL || process.env.GEMINI_FALLBACK_MODEL || "").trim();

if (!GEMINI_API_KEY) {
  console.error(
    "Thiếu GEMINI_API_KEY trong .env (repo root).\n" +
      "Lấy API key tại https://aistudio.google.com/apikey rồi điền vào .env trước khi chạy script này.",
  );
  process.exit(1);
}

// ============================================================
// CLI args
// ============================================================
function parseArgs(argv) {
  const positional = [];
  const opts = { out: null, topicHint: null, contentAngleId: null, customAngleText: null, slug: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      opts.out = argv[++i];
    } else if (a === "--topic-hint") {
      opts.topicHint = argv[++i];
    } else if (a === "--slug") {
      opts.slug = argv[++i];
    } else if (a === "--content-angle-id") {
      opts.contentAngleId = argv[++i];
    } else if (a === "--custom-angle-text") {
      opts.customAngleText = argv[++i];
    } else if (!a.startsWith("--")) {
      positional.push(a);
    } else {
      console.error(`Cờ không nhận diện được: ${a}`);
      process.exit(1);
    }
  }
  if (positional.length !== 2) {
    console.error(
      "Usage: node scripts/generate-compare-content.mjs <left-image> <right-image> [--out <path>] " +
        "[--topic-hint <text>] [--content-angle-id <id>] [--custom-angle-text <text>] [--slug <slug>]",
    );
    process.exit(1);
  }
  opts.left = positional[0];
  opts.right = positional[1];
  opts.out = opts.out || path.join(process.cwd(), "compare-content.json");
  return opts;
}

// ============================================================
// Content angle — góc độ nội dung chọn ở Bước 1, xem config/content-angles.mjs.
//
// "auto" (hoặc rỗng/không truyền) -> không thêm gì, giữ nguyên hành vi cũ (Gemini tự chọn).
// "custom" -> dùng nguyên văn customAngleText người dùng tự gõ (bắt buộc phải có nội dung).
// id khác -> tra CONTENT_ANGLES, dùng promptInstruction tương ứng.
// ============================================================
function resolveAngleInstruction(contentAngleId, customAngleText) {
  const id = (contentAngleId || "auto").trim();
  if (!id || id === "auto") return null;

  if (id === "custom") {
    const text = (customAngleText || "").trim();
    if (!text) {
      throw new Error('contentAngleId="custom" nhưng customAngleText rỗng — cần mô tả góc độ tự chọn.');
    }
    return text;
  }

  const angle = CONTENT_ANGLES.find((a) => a.id === id);
  if (!angle) {
    throw new Error(
      `contentAngleId "${id}" không khớp id nào trong config/content-angles.mjs (auto/custom/${CONTENT_ANGLES.map((a) => a.id).join("/")}).`,
    );
  }
  return angle.promptInstruction;
}

// ============================================================
// Image loading — chấp nhận file path HOẶC data URI base64 sẵn có
// ============================================================
const EXT_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function loadImage(input, label) {
  if (input.startsWith("data:")) {
    const m = input.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) throw new Error(`Ảnh ${label}: data URI không đúng định dạng (thiếu ";base64,").`);
    return { mimeType: m[1], data: m[2] };
  }

  const filePath = path.resolve(input);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ảnh ${label}: không tìm thấy file "${filePath}".`);
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Ảnh ${label}: "${filePath}" nặng ${(stat.size / 1024 / 1024).toFixed(1)}MB, ` +
        `vượt giới hạn mềm ${MAX_IMAGE_BYTES / 1024 / 1024}MB — nén/resize lại trước khi chạy.`,
    );
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = EXT_MIME[ext];
  if (!mimeType) {
    throw new Error(`Ảnh ${label}: đuôi file "${ext}" chưa hỗ trợ (chỉ jpg/jpeg/png/webp/gif).`);
  }
  const data = fs.readFileSync(filePath).toString("base64");
  return { mimeType, data };
}

// ============================================================
// actions.json — nguồn duy nhất cho danh sách suggested_action hợp lệ
// ============================================================
function loadActionCatalog() {
  const catalogPath = path.join(REPO_ROOT, "assets", "actions", "actions.json");
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Không tìm thấy ${catalogPath} — chạy sau khi assets/actions/actions.json đã tồn tại.`);
  }
  const json = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  // frame.frame_class "full" is the flag for "pose usable by the auto-compare
  // pipeline". The 2026-08 pose set is a uniform square crop placed by one fixed
  // transform (see templates/auto-compare/index.html), so every real pose id
  // carries it; the "*-alt" backup variants deliberately omit it to stay out.
  const all = json.actions || [];
  const actions = all.filter((a) => a.frame && a.frame.frame_class === "full");
  if (actions.length === 0) {
    throw new Error(
      "Không action nào có frame.frame_class === \"full\" trong actions.json.",
    );
  }
  const allIds = actions.map((a) => a.id);
  const jewelryIds = actions.filter((a) => a.prop === "jewelry").map((a) => a.id);
  const generalIds = allIds.filter((id) => !jewelryIds.includes(id));
  return { actions, allIds, jewelryIds, generalIds, excludedIds: all.map((a) => a.id).filter((id) => !allIds.includes(id)) };
}

// Vài từ khoá trang sức/đá quý (đã bỏ dấu) để hậu kiểm chủ đề — KHÔNG dựa 100% vào
// việc Gemini "tự giác" tuân theo prompt, vì đây là ràng buộc cứng (yêu cầu của người
// dùng), không phải gợi ý — nên luôn hậu kiểm bằng code sau khi có response.
const JEWELRY_KEYWORDS = [
  "kim cuong", "kim hoan", "trang suc", "da quy", "ngoc", "nhan", "vang", "bac",
  "diamond", "gem", "gemstone", "jewelry", "jewellery", "ring",
];

function stripDiacritics(str) {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, (m) => (m === "đ" ? "d" : "D"))
    .toLowerCase();
}

function isJewelryTopic({ title, label_left, label_right }, topicHint) {
  const haystack = stripDiacritics(
    [title, label_left, label_right, topicHint || ""].join(" "),
  );
  return JEWELRY_KEYWORDS.some((kw) => haystack.includes(kw));
}

async function callGeminiOnce({ left, right, topicHint, angleInstruction, catalog, slug, attempt, model = GEMINI_MODEL }) {
  const hashtagCfg = loadHashtagConfig();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const { systemPrompt, userPrompt, responseSchema } = buildComparePrompt({ catalog, hashtagCfg, topicHint, angleInstruction });
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: userPrompt },
          { inlineData: { mimeType: left.mimeType, data: left.data } },
          { inlineData: { mimeType: right.mimeType, data: right.data } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema,
      // thinkingLevel intentionally left at the model default ("medium") — tried "low" to cut
      // latency, but it made the model degenerate into a repeating-token loop on the first
      // string field instead of finishing the schema (reproduced 3/3 times). Trade the extra
      // latency for a response that actually completes.
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
    const isTimeout = err.name === "AbortError";
    const reason = redactKey(
      isTimeout ? `Gemini request timeout sau ${REQUEST_TIMEOUT_MS / 1000}s` : `Gemini request thất bại (network): ${err.message}`,
      GEMINI_API_KEY,
    );
    // Request chưa từng chạm tới server Gemini (timeout/network) — Google không tính phí, vẫn
    // ghi lại để biết tần suất lỗi mạng/timeout.
    appendCostEntry({ slug, task: "content-generation", model, status: "error", errorMessage: reason, attempt });
    console.warn(`[gemini-error] model=${model} ${reason}`);
    throw new RetryableError(reason, {
      userMessage: isTimeout
        ? "Gemini không phản hồi kịp (timeout), vui lòng thử lại sau."
        : "Không kết nối được tới Gemini, vui lòng kiểm tra mạng rồi thử lại.",
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // Mọi lỗi HTTP (429/400/401/403/5xx...) đều KHÔNG bị Google tính phí request đó — chỉ ghi
    // sổ để theo dõi tần suất lỗi/retry, cost_usd luôn 0 (ép trong appendCostEntry).
    appendCostEntry({
      slug,
      task: "content-generation",
      model,
      status: "error",
      httpStatus: res.status,
      errorMessage: redactKey(errText, GEMINI_API_KEY).slice(0, 500),
      attempt,
    });
    // Phân loại (429 theo phút/theo ngày, 503, 401/403, 400, 5xx) + thông báo tiếng Việt cho người
    // dùng — JSON gốc CHỈ ghi vào log server (dòng [gemini-error]), không nằm trong err.userMessage.
    const classified = classifyGeminiHttpError({ httpStatus: res.status, bodyText: errText, model });
    console.warn(`[gemini-error] ${describeGeminiErrorForLog(classified, { bodyText: errText, apiKey: GEMINI_API_KEY })}`);
    throw classified;
  }

  // Body 200 không parse được = lỗi phía Gemini/mạng (đứt giữa chừng) -> đáng retry.
  const json = await res.json().catch((e) => {
    throw new RetryableError(`Gemini response không phải JSON hợp lệ: ${e.message}`);
  });
  if (process.env.DEBUG_GEMINI) {
    console.warn(
      "[debug] finishReason=" + json?.candidates?.[0]?.finishReason +
      " usageMetadata=" + JSON.stringify(json?.usageMetadata),
    );
  }

  // HTTP 200 từ đây trở xuống LUÔN được coi là lần gọi ĐÃ TÍNH PHÍ (Google bill theo response
  // hợp lệ trả về, không quan tâm ứng dụng có dùng được nội dung hay không) — kể cả khi bị
  // safety block hoặc thiếu text, nên ghi cost_usd > 0 TRƯỚC khi ném lỗi ở các nhánh dưới.
  const usage = json?.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
  appendCostEntry({
    slug,
    task: "content-generation",
    model,
    status: "success",
    httpStatus: res.status,
    inputTokens,
    outputTokens,
    costUsd: calcContentCost(model, inputTokens, outputTokens),
    attempt,
  });

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const blockReason = json?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new NonRetryableError(`Gemini từ chối xử lý ảnh (blockReason: ${blockReason}).`);
    }
    throw new RetryableError("Gemini response không có nội dung text (candidates[0].content.parts[0].text rỗng).");
  }
  return text;
}

function parseAndValidate(rawText, catalog) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new RetryableError(`Gemini trả về không phải JSON hợp lệ: ${rawText.slice(0, 200)}`);
  }

  // Gemini tự báo 2 ảnh không so sánh được — đây là kết quả hợp lệ về mặt xử lý, không
  // phải lỗi transient, nên KHÔNG retry — dừng ngay với lý do rõ ràng.
  if (parsed.error) {
    throw new NonRetryableError(`Gemini báo 2 ảnh không so sánh được: ${parsed.error}`);
  }

  const missing = ["title", "label_left", "label_right", "points"].filter((k) => !(k in parsed));
  if (missing.length) {
    throw new RetryableError(
      `Response thiếu field bắt buộc: ${missing.join(", ")}. Raw: ${rawText.slice(0, 300)}`,
    );
  }
  if (typeof parsed.title !== "string" || !parsed.title.trim()) {
    throw new RetryableError("Field 'title' rỗng hoặc không phải string.");
  }
  if (typeof parsed.label_left !== "string" || !parsed.label_left.trim()) {
    throw new RetryableError("Field 'label_left' rỗng hoặc không phải string.");
  }
  if (typeof parsed.label_right !== "string" || !parsed.label_right.trim()) {
    throw new RetryableError("Field 'label_right' rỗng hoặc không phải string.");
  }
  if (!Array.isArray(parsed.points) || parsed.points.length === 0) {
    throw new RetryableError("Field 'points' phải là mảng có ít nhất 1 phần tử.");
  }
  for (const [i, p] of parsed.points.entries()) {
    if (!["left", "right", "both"].includes(p.side)) {
      throw new RetryableError(`points[${i}].side = "${p.side}" phải là "left" | "right" | "both".`);
    }
    if (typeof p.tag !== "string" || !p.tag.trim()) {
      throw new RetryableError(`points[${i}].tag rỗng hoặc không phải string.`);
    }
    if (typeof p.sub !== "string") {
      throw new RetryableError(`points[${i}].sub phải là string (dùng "" nếu không cần dòng phụ).`);
    }
    if (typeof p.text !== "string" || !p.text.trim()) {
      throw new RetryableError(`points[${i}].text rỗng hoặc không phải string.`);
    }
    if (typeof p.suggested_action !== "string" || !catalog.allIds.includes(p.suggested_action)) {
      throw new RetryableError(
        `points[${i}].suggested_action = "${p.suggested_action}" không khớp id nào trong actions.json.`,
      );
    }
    if (typeof p.needs_context_image !== "boolean") {
      throw new RetryableError(`points[${i}].needs_context_image phải là boolean.`);
    }
    if (typeof p.image_concept !== "string") {
      throw new RetryableError(`points[${i}].image_concept phải là string (dùng "" nếu needs_context_image=false).`);
    }
  }

  normalizeHashtagFields(parsed);
  return parsed;
}

// Field hashtag KHÔNG bắt buộc hợp lệ (khác 4 field lõi): thiếu/sai kiểu -> [] thay vì retry/lỗi, vì
// caption vẫn có fallback theo label (xem scripts/lib/hashtags.mjs). topicTags hậu kiểm bằng code
// theo whitelist dù schema đã có enum — không tin tuyệt đối vào model (cùng triết lý enforceJewelryGating).
function normalizeHashtagFields(parsed) {
  const cfg = loadHashtagConfig();
  parsed.materials = (Array.isArray(parsed.materials) ? parsed.materials : [])
    .filter((m) => typeof m === "string" && m.trim())
    .map((m) => m.trim())
    .slice(0, 2);
  parsed.topicTags = resolveTopicTags(parsed.topicTags, cfg);
  const suggested = [];
  for (const raw of Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags : []) {
    const t = typeof raw === "string" ? cleanTag(raw, cfg) : null;
    if (t && !suggested.includes(t)) suggested.push(t);
  }
  parsed.suggestedTags = suggested.slice(0, 2);
}

// Hậu kiểm bằng code, KHÔNG chỉ dựa vào prompt: nếu topic không phải trang sức mà Gemini
// vẫn lỡ gợi ý 1 action có prop:jewelry, hạ cấp về action trung tính tương đương ý nghĩa.
const JEWELRY_FALLBACK = {
  "inspect-gem": "thinking", // đang xem xét/kiểm tra -> vẫn giữ tinh thần "đang quan sát"
  "present-ring": "explain-a", // đang giới thiệu/trình bày -> giữ tinh thần "đang giải thích"
  "show-item": "explain-a",
};

function enforceJewelryGating(content, catalog, topicHint) {
  const jewelryOk = isJewelryTopic(content, topicHint);
  const corrections = [];
  if (jewelryOk) return { content, corrections };

  for (const p of content.points) {
    if (catalog.jewelryIds.includes(p.suggested_action)) {
      const original = p.suggested_action;
      const fallback = JEWELRY_FALLBACK[original] || catalog.generalIds[0];
      p.suggested_action = fallback;
      corrections.push({ point: p.text, from: original, to: fallback, reason: "topic không phải trang sức/đá quý" });
    }
  }
  return { content, corrections };
}

// Giai đoạn 1 — giới hạn cứng bằng CODE, không tin vào việc model tự giác tuân theo hướng dẫn
// prompt (giống enforceJewelryGating ở trên): tối đa MAX_CONTEXT_IMAGES point/video được sinh
// ảnh minh hoạ ngữ cảnh (kiểm soát chi phí gọi API ảnh — 2026-09-18 nâng 2 -> 5 theo yêu cầu
// tăng mật độ ảnh minh hoạ, đi kèm sửa prompt để Gemini mạnh dạn đánh true hơn), point
// "side":"both" luôn bị loại (không rõ swap card bên nào), và 2 point KẾ NHAU cùng bên
// trái/phải không được cùng lúc minh hoạ (setCardImage swap-vào ở point sau và
// swap-lại-ảnh-gốc ở point trước có thể rơi trùng thời điểm trên cùng 1 card — xem
// scaffold-compare-video.mjs § buildTimelineBeatsJs).
const MAX_CONTEXT_IMAGES = 5;

function enforceContextImageLimits(content) {
  const corrections = [];
  let kept = 0;
  let lastKeptIndex = -1;
  let lastKeptSide = null;

  content.points.forEach((p, idx) => {
    if (typeof p.needs_context_image !== "boolean") p.needs_context_image = false;
    if (typeof p.image_concept !== "string") p.image_concept = "";
    if (!p.needs_context_image) return;

    if (p.side === "both") {
      corrections.push({ point: p.text, reason: `side="both" không nhận ảnh minh hoạ ngữ cảnh (không rõ swap card bên nào)` });
      p.needs_context_image = false;
      p.image_concept = "";
      return;
    }
    if (kept >= MAX_CONTEXT_IMAGES) {
      corrections.push({ point: p.text, reason: `vượt giới hạn ${MAX_CONTEXT_IMAGES} ảnh minh hoạ/video — giữ ảnh sản phẩm gốc` });
      p.needs_context_image = false;
      p.image_concept = "";
      return;
    }
    if (idx === lastKeptIndex + 1 && p.side === lastKeptSide) {
      corrections.push({ point: p.text, reason: `liền kề point minh hoạ trước, cùng bên "${p.side}" — bỏ qua tránh xung đột swap ảnh` });
      p.needs_context_image = false;
      p.image_concept = "";
      return;
    }

    kept++;
    lastKeptIndex = idx;
    lastKeptSide = p.side;
  });

  return { content, corrections };
}

// Chỉ retry lỗi từ Gemini/mạng (RetryableError — xem scripts/lib/gemini-retry.mjs); lỗi lập trình
// (ReferenceError/TypeError/...) và NonRetryableError throw ngay, không đốt thêm lần gọi tính phí.
//
// 429: đợi đúng RetryInfo.retryDelay (+ padding) thay vì backoff cố định. Hết quota THEO NGÀY thì không
// retry: chuyển sang GEMINI_FALLBACK_MODEL nếu có, không có thì báo lỗi ngay. Trả { content, model }
// với model = model THỰC SỰ sinh ra nội dung.
async function generateWithRetry(args) {
  return runWithModelFallback({
    primaryModel: GEMINI_MODEL,
    fallbackModel: GEMINI_FALLBACK_MODEL,
    run: async (model) => ({
      model,
      content: await withRetry(
        async (attempt) => parseAndValidate(await callGeminiOnce({ ...args, attempt, model }), args.catalog),
        {
          maxAttempts: MAX_ATTEMPTS,
          baseDelayMs: RETRY_BASE_DELAY_MS,
          label: "Gemini call",
          onRetryableError: (err, attempt, waitMs) =>
            console.warn(
              `[attempt ${attempt}/${MAX_ATTEMPTS}] ${redactKey(err.message, GEMINI_API_KEY)}` +
                (attempt < MAX_ATTEMPTS ? ` — thử lại sau ${(waitMs / 1000).toFixed(1)}s` : ""),
            ),
        },
      ),
    }),
    log: (msg) => console.warn(`[gemini] ${msg}`),
  });
}

// ============================================================
// Reusable pipeline — imported directly by scripts/scaffold-compare-video.mjs so it doesn't
// have to shell out to this file as a subprocess (single env load, single catalog load,
// real error objects instead of parsed stdout). The CLI `main()` below is a thin wrapper
// around this same function — no behavior duplication between the two entry points.
// ============================================================
async function runCompareContent({ left, right, topicHint, contentAngleId, customAngleText, slug = null } = {}) {
  const catalog = loadActionCatalog();
  const leftImg = loadImage(left, "trái");
  const rightImg = loadImage(right, "phải");
  const angleInstruction = resolveAngleInstruction(contentAngleId, customAngleText);

  const { content, model: usedModel } = await generateWithRetry({ left: leftImg, right: rightImg, topicHint, angleInstruction, catalog, slug });

  // Log chẩn đoán: Gemini tự đánh dấu bao nhiêu point cần ảnh minh hoạ NGAY SAU khi nhận
  // response, TRƯỚC mọi hậu kiểm (jewelry gate / cap MAX_CONTEXT_IMAGES ảnh / liền-kề-cùng-bên) — để phân biệt
  // "Gemini không đánh dấu point nào" (đúng thiết kế, tuỳ chủ đề — vd chủ đề không có bối cảnh
  // gì đáng minh hoạ thêm ngoài 2 sản phẩm) với "có lỗi khiến ảnh bị cắt/không sinh" (xem log
  // enforceContextImageLimits ngay dưới, và log generateContextImages ở scaffold-compare-video.mjs).
  const rawFlagged = content.points.filter((p) => p.needs_context_image);
  console.log(
    `[generate-compare-content] Gemini đánh dấu needs_context_image=true cho ${rawFlagged.length}/${content.points.length} point:`,
  );
  if (rawFlagged.length === 0) {
    console.log("  (không có point nào — Gemini cho rằng chủ đề này không cần ảnh minh hoạ ngữ cảnh riêng)");
  } else {
    for (const p of rawFlagged) {
      console.log(`  - [${p.side}] "${p.text}" -> image_concept: "${p.image_concept}"`);
    }
  }

  const { corrections } = enforceJewelryGating(content, catalog, topicHint);
  const { corrections: contextImageCorrections } = enforceContextImageLimits(content);

  const keptFlagged = content.points.filter((p) => p.needs_context_image);
  console.log(
    `[generate-compare-content] Sau enforceContextImageLimits: còn lại ${keptFlagged.length} point sẽ được gọi sinh ảnh` +
      (contextImageCorrections.length ? ` (đã cắt ${contextImageCorrections.length} — xem lý do ở log corrections trên).` : "."),
  );

  return {
    content,
    corrections,
    contextImageCorrections,
    model: usedModel,
    source_images: {
      left: left.startsWith("data:") ? "<inline base64>" : path.resolve(left),
      right: right.startsWith("data:") ? "<inline base64>" : path.resolve(right),
    },
  };
}

// ============================================================
// Main (CLI entry point only)
// ============================================================
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log(`Gemini model: ${GEMINI_MODEL}`);
  console.log(`Left image:  ${opts.left}`);
  console.log(`Right image: ${opts.right}`);

  const { content, corrections, contextImageCorrections, model, source_images } = await runCompareContent({
    left: opts.left,
    right: opts.right,
    topicHint: opts.topicHint,
    contentAngleId: opts.contentAngleId,
    customAngleText: opts.customAngleText,
    slug: opts.slug,
  });

  if (corrections.length) {
    console.warn(`Đã hạ cấp ${corrections.length} suggested_action vì topic không phải trang sức/đá quý:`);
    for (const c of corrections) {
      console.warn(`  - "${c.point}": ${c.from} -> ${c.to}`);
    }
  }
  if (contextImageCorrections.length) {
    console.warn(`Đã bỏ needs_context_image cho ${contextImageCorrections.length} point:`);
    for (const c of contextImageCorrections) {
      console.warn(`  - "${c.point}": ${c.reason}`);
    }
  }

  const output = {
    ...content,
    _meta: {
      generated_at: new Date().toISOString(),
      model,
      source_images,
      corrections,
      contextImageCorrections,
      content_angle_id: opts.contentAngleId || "auto",
      custom_angle_text: opts.contentAngleId === "custom" ? opts.customAngleText || "" : "",
    },
  };

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(output, null, 2));
  console.log(`\nOK — đã ghi nội dung ra ${opts.out}`);
  console.log(`  title: ${output.title}`);
  console.log(`  label_left: ${output.label_left} | label_right: ${output.label_right}`);
  console.log(`  points: ${output.points.length}`);
}

// Chỉ chạy main() khi file này được gọi trực tiếp làm CLI (node generate-compare-content.mjs
// ...) — khi được import làm module (từ scaffold-compare-video.mjs), chỉ runCompareContent()
// được dùng, không tự kích hoạt CLI parsing/exit.
// pathToFileURL (not manual string concat) — Windows paths ("C:\...") need the drive letter
// + backslashes converted correctly (file:///C:/... with 3 slashes), which naive
// `file://${path}` string-building gets wrong and silently breaks CLI-vs-import detection.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    // Không bao giờ ghi file output khi lỗi — composition không được đọc data rỗng/undefined.
    // userMessage (tiếng Việt, không có JSON gốc) nếu là lỗi Gemini; chi tiết kỹ thuật nằm ở các dòng
    // [gemini-error] phía trên trong log. Server chỉ trích dòng "THẤT BẠI:" này ra UI.
    if (err.userMessage && err.userMessage !== err.message) console.error(`[gemini-error] ${redactKey(err.message, GEMINI_API_KEY)}`);
    console.error(`\nTHẤT BẠI: ${redactKey(err.userMessage || err.message, GEMINI_API_KEY)}`);
    // process.exitCode (không phải process.exit()) — thoát êm, tránh crash libuv trên Windows
    // khi vừa có AbortController timeout/abort đang dọn dẹp dở (đã gặp thực tế khi test).
    process.exitCode = 1;
  });
}

export { runCompareContent, loadActionCatalog, enforceContextImageLimits, resolveAngleInstruction, GEMINI_MODEL };
