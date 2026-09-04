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
//
// Ví dụ:
//   node scripts/generate-compare-content.mjs assets/left.jpg assets/right.jpg \
//     --out videos/kim-cuong-vs-ngoc-trai/content/compare-content.json
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  const opts = { out: null, topicHint: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      opts.out = argv[++i];
    } else if (a === "--topic-hint") {
      opts.topicHint = argv[++i];
    } else if (!a.startsWith("--")) {
      positional.push(a);
    } else {
      console.error(`Cờ không nhận diện được: ${a}`);
      process.exit(1);
    }
  }
  if (positional.length !== 2) {
    console.error(
      "Usage: node scripts/generate-compare-content.mjs <left-image> <right-image> [--out <path>] [--topic-hint <text>]",
    );
    process.exit(1);
  }
  opts.left = positional[0];
  opts.right = positional[1];
  opts.out = opts.out || path.join(process.cwd(), "compare-content.json");
  return opts;
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

// ============================================================
// Prompt construction — inject danh sách action id + use_case động từ actions.json,
// không hardcode, để tự đồng bộ khi actions.json đổi.
// ============================================================
function buildSystemPrompt(catalog) {
  const actionLines = catalog.actions
    .map((a) => {
      const propTag = a.prop === "jewelry" ? " [CHỈ DÙNG CHO CHỦ ĐỀ TRANG SỨC/ĐÁ QUÝ/KIM CƯƠNG]" : "";
      return `- "${a.id}"${propTag}: ${a.use_case}`;
    })
    .join("\n");

  return `Bạn là trợ lý sinh nội dung kịch bản cho một series video TikTok/Reels tiếng Việt
dạng "so sánh kiến thức" (2 khái niệm/vật thể hay bị nhầm lẫn, host chỉ tay giải thích).

NHIỆM VỤ: nhận 2 ảnh (trái, phải) người dùng cung cấp để so sánh, trả lời DUY NHẤT một
đối tượng JSON — không kèm lời dẫn, không giải thích, không bọc trong \`\`\`json hay bất kỳ
markdown/code fence nào. Chỉ JSON thuần.

JSON trả về LUÔN LUÔN có đủ 5 field sau — không được bỏ bớt field nào, kể cả khi rỗng:
{
  "error": "",
  "title": "1 câu hỏi mở đầu ngắn (tối đa ~15 từ), giọng tò mò/viral, tiếng Việt có dấu",
  "label_left": "tên gọi ngắn gọn (1-4 từ) của vật thể/khái niệm trong ảnh TRÁI",
  "label_right": "tên gọi ngắn gọn (1-4 từ) của vật thể/khái niệm trong ảnh PHẢI",
  "points": [
    {
      "text": "1 câu so sánh ngắn (tối đa ~20 từ), tiếng Việt có dấu — đây là LỜI THOẠI đọc lên",
      "side": "left | right | both",
      "tag": "nhãn NGẮN hiện trên màn hình, 1-3 từ, tối đa 18 ký tự",
      "sub": "dòng phụ dưới nhãn, tối đa 26 ký tự, để chuỗi rỗng \"\" nếu không cần",
      "suggested_action": "<id>"
    }
  ]
}

- NẾU so sánh được: "error" PHẢI là chuỗi rỗng "" — điền đầy đủ 4 field còn lại.
- NẾU 2 ảnh KHÔNG so sánh được một cách hợp lý (ví dụ: cùng một vật thể chụp 2 lần, ảnh mờ/
  không nhận diện được chủ thể, hoặc 2 chủ thể không có điểm chung nào để so sánh kiến thức):
  "error" là lý do ngắn gọn bằng tiếng Việt (không rỗng); "title"/"label_left"/"label_right"
  điền chuỗi rỗng "", "points" điền mảng rỗng [] — 4 field này bị bỏ qua khi "error" không rỗng,
  chỉ cần đúng KIỂU dữ liệu, không cần nội dung thật.
- KHÔNG BAO GIỜ để "title" (hay bất kỳ field text nào) chứa nhiều câu hỏi/khẩu hiệu lặp lại
  nối tiếp nhau — mỗi field chỉ 1 câu duy nhất, đúng độ dài tối đa đã nêu.

- Sinh 4 đến 8 phần tử "points" — mỗi câu là một luận điểm so sánh riêng biệt (định nghĩa,
  đặc điểm nổi bật, ví dụ thực tế, điểm khác biệt cốt lõi...), giọng nhanh/giáo dục nhẹ,
  không nghiêm túc quá, phù hợp video 30-40 giây.
- "text" là LỜI THOẠI (đọc lên, câu đầy đủ). "tag"/"sub" là CHỮ HIỆN TRÊN MÀN HÌNH — phải
  RẤT NGẮN, viết như tiêu đề kiểu TikTok, KHÔNG lặp lại nguyên câu "text", không có dấu chấm
  cuối. Ví dụ: text = "Kim cương cứng nhất hành tinh, đạt 10/10 trên thang Mohs."
  -> tag = "Rất cứng", sub = "10/10 thang Mohs".
- "side" cho biết luận điểm nói về ảnh nào: "left" (ảnh trái), "right" (ảnh phải), hoặc "both"
  (so sánh cả hai / kết luận chung). BỐ TRÍ TỐT NHẤT: xen kẽ left rồi right thành từng cặp
  liền nhau (left, right, left, right...) để 2 nhãn hiện đối xứng 2 bên như video mẫu.
  Chỉ dùng "both" cho luận điểm tổng kết, tối đa 2 lần.
- "suggested_action" của MỖI point BẮT BUỘC là một trong các id sau đây — TUYỆT ĐỐI không
  tự bịa id khác, không thêm hậu tố, không đổi chính tả:
${actionLines}
- Các action có đánh dấu "[CHỈ DÙNG CHO CHỦ ĐỀ TRANG SỨC/ĐÁ QUÝ/KIM CƯƠNG]" ở trên CHỈ được
  gợi ý khi chủ đề thật sự là trang sức/đá quý/kim cương/kim hoàn. Nếu chủ đề không liên
  quan, TUYỆT ĐỐI không dùng các id đó — chọn action trung tính khác phù hợp ngữ cảnh.
- Không thêm field nào ngoài schema trên. Không thêm text trước/sau JSON.`;
}

function buildUserPrompt(topicHint) {
  const hint = topicHint ? `\n\nGợi ý ngữ cảnh thêm từ người dùng: ${topicHint}` : "";
  return `Ảnh 1 (bên trái) và ảnh 2 (bên phải) đính kèm là 2 chủ thể cần so sánh cho video.${hint}`;
}

// ============================================================
// Gemini call
// ============================================================
function buildResponseSchema(allIds) {
  // Lowercase JSON Schema type strings — the REST generateContent body wants "object"/"string"/
  // "array", NOT the SDK's Type.OBJECT/Type.STRING enum constants (which serialize uppercase).
  // Sending uppercase here is accepted without an HTTP error but silently fails to constrain the
  // model — confirmed by testing: the model rambled instead of returning schema-shaped JSON.
  // maxLength/maxItems bound every open-ended field — without them the model (observed 3/3
  // times on gemini-3.6-flash, both thinkingLevel "low" and default) degenerates into a
  // repeating-phrase loop while generating "title" and never reaches the rest of the schema.
  //
  // ALL 5 top-level fields are `required`. Gemini's responseSchema subset has no oneOf/anyOf,
  // so a schema that makes title/label_left/label_right/points optional (to allow an
  // error-only response) was silently exploited by the model: without `required`, it returned
  // valid-but-incomplete JSON containing only "title" and stopped (finishReason STOP) — this
  // was the actual root cause of every earlier failed test, confirmed via DEBUG_GEMINI logging.
  // Fix: every field is required; "error" is "" (empty string) in the success case, and when
  // non-empty the other 4 fields are meaningless placeholders (empty string / empty array) —
  // see parseAndValidate, which branches on `error` first and ignores the placeholders.
  return {
    type: "object",
    required: ["error", "title", "label_left", "label_right", "points"],
    properties: {
      error: { type: "string", maxLength: 200 },
      title: { type: "string", maxLength: 120 },
      label_left: { type: "string", maxLength: 40 },
      label_right: { type: "string", maxLength: 40 },
      points: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          // Every field required, for the same reason the top-level ones are:
          // without `required` the model returns partial objects and stops.
          required: ["text", "side", "tag", "sub", "suggested_action"],
          properties: {
            text: { type: "string", maxLength: 160 },
            side: { type: "string", enum: ["left", "right", "both"] },
            // maxLength is what keeps the on-screen tag from turning back into
            // a sentence — the label zone fits ~18 / ~26 characters per line.
            tag: { type: "string", maxLength: 18 },
            sub: { type: "string", maxLength: 26 },
            suggested_action: { type: "string", enum: allIds },
          },
        },
      },
    },
  };
}

class NonRetryableError extends Error {}

async function callGeminiOnce({ left, right, topicHint, catalog }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: buildSystemPrompt(catalog) }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: buildUserPrompt(topicHint) },
          { inlineData: { mimeType: left.mimeType, data: left.data } },
          { inlineData: { mimeType: right.mimeType, data: right.data } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(catalog.allIds),
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
    if (err.name === "AbortError") {
      throw new Error(`Gemini request timeout sau ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(`Gemini request thất bại (network): ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // 401/403: sai/thiếu API key hoặc không có quyền — retry không giúp ích gì.
    if (res.status === 401 || res.status === 403) {
      throw new NonRetryableError(
        `Gemini API từ chối truy cập (HTTP ${res.status}) — kiểm tra lại GEMINI_API_KEY. Chi tiết: ${errText}`,
      );
    }
    // 400: request sai format (vd ảnh hỏng, schema sai) — cũng không đổi kết quả khi retry.
    if (res.status === 400) {
      throw new NonRetryableError(`Gemini API báo request không hợp lệ (HTTP 400): ${errText}`);
    }
    // 429 / 5xx: rate limit hoặc lỗi tạm thời phía server — đáng để retry.
    throw new Error(`Gemini API lỗi HTTP ${res.status}: ${errText}`);
  }

  const json = await res.json();
  if (process.env.DEBUG_GEMINI) {
    console.warn(
      "[debug] finishReason=" + json?.candidates?.[0]?.finishReason +
      " usageMetadata=" + JSON.stringify(json?.usageMetadata),
    );
  }
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const blockReason = json?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new NonRetryableError(`Gemini từ chối xử lý ảnh (blockReason: ${blockReason}).`);
    }
    throw new Error("Gemini response không có nội dung text (candidates[0].content.parts[0].text rỗng).");
  }
  return text;
}

function parseAndValidate(rawText, catalog) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini trả về không phải JSON hợp lệ: ${rawText.slice(0, 200)}`);
  }

  // Gemini tự báo 2 ảnh không so sánh được — đây là kết quả hợp lệ về mặt xử lý, không
  // phải lỗi transient, nên KHÔNG retry — dừng ngay với lý do rõ ràng.
  if (parsed.error) {
    throw new NonRetryableError(`Gemini báo 2 ảnh không so sánh được: ${parsed.error}`);
  }

  const missing = ["title", "label_left", "label_right", "points"].filter((k) => !(k in parsed));
  if (missing.length) {
    throw new Error(
      `Response thiếu field bắt buộc: ${missing.join(", ")}. Raw: ${rawText.slice(0, 300)}`,
    );
  }
  if (typeof parsed.title !== "string" || !parsed.title.trim()) {
    throw new Error("Field 'title' rỗng hoặc không phải string.");
  }
  if (typeof parsed.label_left !== "string" || !parsed.label_left.trim()) {
    throw new Error("Field 'label_left' rỗng hoặc không phải string.");
  }
  if (typeof parsed.label_right !== "string" || !parsed.label_right.trim()) {
    throw new Error("Field 'label_right' rỗng hoặc không phải string.");
  }
  if (!Array.isArray(parsed.points) || parsed.points.length === 0) {
    throw new Error("Field 'points' phải là mảng có ít nhất 1 phần tử.");
  }
  for (const [i, p] of parsed.points.entries()) {
    if (!["left", "right", "both"].includes(p.side)) {
      throw new Error(`points[${i}].side = "${p.side}" phải là "left" | "right" | "both".`);
    }
    if (typeof p.tag !== "string" || !p.tag.trim()) {
      throw new Error(`points[${i}].tag rỗng hoặc không phải string.`);
    }
    if (typeof p.sub !== "string") {
      throw new Error(`points[${i}].sub phải là string (dùng "" nếu không cần dòng phụ).`);
    }
    if (typeof p.text !== "string" || !p.text.trim()) {
      throw new Error(`points[${i}].text rỗng hoặc không phải string.`);
    }
    if (typeof p.suggested_action !== "string" || !catalog.allIds.includes(p.suggested_action)) {
      throw new Error(
        `points[${i}].suggested_action = "${p.suggested_action}" không khớp id nào trong actions.json.`,
      );
    }
  }

  return parsed;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(args) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const rawText = await callGeminiOnce(args);
      return parseAndValidate(rawText, args.catalog);
    } catch (err) {
      if (err instanceof NonRetryableError) {
        // Lỗi không đáng retry (key sai, ảnh không so sánh được, request hỏng) — dừng ngay.
        throw err;
      }
      lastErr = err;
      console.warn(`[attempt ${attempt}/${MAX_ATTEMPTS}] ${err.message}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  throw new Error(`Gemini call thất bại sau ${MAX_ATTEMPTS} lần thử. Lỗi cuối cùng: ${lastErr.message}`);
}

// ============================================================
// Reusable pipeline — imported directly by scripts/scaffold-compare-video.mjs so it doesn't
// have to shell out to this file as a subprocess (single env load, single catalog load,
// real error objects instead of parsed stdout). The CLI `main()` below is a thin wrapper
// around this same function — no behavior duplication between the two entry points.
// ============================================================
async function runCompareContent({ left, right, topicHint } = {}) {
  const catalog = loadActionCatalog();
  const leftImg = loadImage(left, "trái");
  const rightImg = loadImage(right, "phải");

  const content = await generateWithRetry({ left: leftImg, right: rightImg, topicHint, catalog });
  const { corrections } = enforceJewelryGating(content, catalog, topicHint);

  return {
    content,
    corrections,
    model: GEMINI_MODEL,
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

  const { content, corrections, model, source_images } = await runCompareContent({
    left: opts.left,
    right: opts.right,
    topicHint: opts.topicHint,
  });

  if (corrections.length) {
    console.warn(`Đã hạ cấp ${corrections.length} suggested_action vì topic không phải trang sức/đá quý:`);
    for (const c of corrections) {
      console.warn(`  - "${c.point}": ${c.from} -> ${c.to}`);
    }
  }

  const output = {
    ...content,
    _meta: { generated_at: new Date().toISOString(), model, source_images, corrections },
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
    console.error(`\nTHẤT BẠI: ${err.message}`);
    // process.exitCode (không phải process.exit()) — thoát êm, tránh crash libuv trên Windows
    // khi vừa có AbortController timeout/abort đang dọn dẹp dở (đã gặp thực tế khi test).
    process.exitCode = 1;
  });
}

export { runCompareContent, loadActionCatalog, GEMINI_MODEL };
