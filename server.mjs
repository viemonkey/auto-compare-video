// Web UI cho pipeline "Auto Compare Video".
//
// Dựng lại 2026-08-30 sau khi bản gốc bị xoá khỏi đĩa (untracked, không có
// trong git / local history / Trash). Hợp đồng API được suy ra từ `public/app.js`
// và đối chiếu với response thật của process cũ (PID 11060) lúc nó còn sống, nên
// khớp đúng những gì client đang gọi:
//
//   GET  /api/actions          -> { actions: [...] }            (assets/actions/actions.json)
//   POST /api/upload           -> { leftPath, rightPath }       (multipart: leftImage, rightImage)
//   POST /api/generate-content -> { content }                   (Gemini)
//   POST /api/create-video     -> SSE: {message} ... {type:"success", slug, previewUrl, renderUrl}
//   GET  /api/videos           -> [{ slug, name, hasIndex, hasBrief, renderFile, previewUrl }]
//
// KHÁC BẢN CŨ — 2 điểm, cả hai đều sửa lỗi đã gặp thật:
//
// 1. `generate-compare-content.mjs` được chạy bằng SUBPROCESS, không `import`.
//    Bản cũ import ở top level nên Node cache module trong memory: sau khi schema
//    Gemini được thêm field side/tag/sub, server vẫn gọi bản cũ cho tới khi restart,
//    và build fail ở `points[0].side = undefined`. Spawn mỗi lần thì sửa script là
//    có hiệu lực ngay, không cần restart.
// 2. Có bước RENDER. Bản cũ dừng sau `check`, nên `videos/<slug>/renders/` luôn
//    rỗng và nút "Xem Trước" mở index.html (composition) thay vì MP4.
//    Tắt bằng `{ render: false }` trong body hoặc env AUTO_RENDER=0.

import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CONTENT_ANGLES } from "./config/content-angles.mjs";
import { COST_LEDGER_PATH, renameCostLedgerSlug, countsAsVideo } from "./scripts/lib/cost-ledger.mjs";
import { getConfiguredPages, inspectConfiguredPages } from "./scripts/lib/facebook-pages.mjs";
import { graphVersion, isAutoPostEnabled, makeLogger, redactSecrets } from "./scripts/lib/fb-config.mjs";
import { classifyError } from "./scripts/lib/fb-errors.mjs";
import { npmCommand } from "./scripts/lib/npm-cmd.mjs";
import { extractFailureMessage as geminiFailureMessage } from "./scripts/lib/gemini-retry.mjs";
import { publishVideo, checkReelStatus } from "./scripts/lib/facebook-post.mjs";
import {
  loadQueue,
  tryEnqueueVideo,
  selectJobAndPage,
  jobLocale,
  recordPost,
  recordFailure,
  disablePage,
  recordVerifying,
  finalizeVerifiedPost,
  failJobTerminal,
  verifyingJobs,
  verifyTimeoutMs,
  rateLimitBackoffMinutes,
  publicQueueState,
  listDisabledPages,
} from "./scripts/lib/social-queue.mjs";
import {
  loadHashtagConfig,
  planHashtags,
  resolveMaterialGroups,
  alignTopicTags,
  sanitizePlan,
  finalizeHashtags,
  buildCaption,
  cleanTag,
  maxHashtags,
  recordHashtagSuggestions,
  withMeanings,
} from "./scripts/lib/hashtags.mjs";
import { textOf } from "./public/shared/bilingual.mjs";
import { rulesOf } from "./scripts/lib/compare-content.mjs";
import { createMarketApi, buildRecord, generatedByOf, resolveSocialPost as resolveSocialPostIn } from "./server-market.mjs";
import { validateGeminiModels } from "./scripts/lib/gemini-models.mjs";
import { effectiveSlugSuffix, hasLocaleSuffix, stripLocaleSuffix, uniqueSlugForLocale } from "./scripts/lib/market-slug.mjs";
import { copySourceImages, readRecord, writeRecord } from "./scripts/lib/content-store.mjs";
import { rewriteField, translateField, FieldEditError } from "./scripts/lib/field-edit.mjs";
import { AbortedError } from "./scripts/lib/gemini-client.mjs";
import { checkFfmpeg, extractPoseTimeline, setReelThumbnail } from "./scripts/lib/reel-thumbnail.mjs";
import { getLocale, listLocales, localeErrors, getDefaultLocale } from "./scripts/lib/locales.mjs";
import {
  listEngines,
  listThemes,
  getEngine,
  getDefaultTheme,
  enginesForLanguage,
  themeSupportsScript,
  themeSupportsLanguage,
  engineReadiness,
  defaultVoiceFor,
  checkRenderability,
  capabilityErrors,
} from "./scripts/lib/capabilities.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env ở gốc repo KHÔNG được tự nạp trước dòng này — server chạy bằng `node server.mjs` trơn
// (npm start/ui), không qua dotenv hay `--env-file`. Phát hiện khi debug tính năng đăng
// Facebook: FB_PAGE_*/GEMINI_API_KEY chỉ có tác dụng nếu đã export ra biến môi trường HỆ THỐNG
// từ trước — sửa .env rồi lưu KHÔNG có tác dụng gì nếu thiếu dòng này. process.loadEnvFile()
// (Node 20.6+) không ghi đè biến đã có sẵn trong process.env thật, nên biến môi trường hệ thống
// (nếu ai đó set kiểu đó) vẫn được ưu tiên như trước.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch (e) {
  if (e.code !== "ENOENT") console.error(`⚠ Không đọc được .env: ${e.message}`);
}

const PORT = Number(process.env.PORT) || 3002;

const PUBLIC_DIR = path.join(__dirname, "public");
const ASSETS_DIR = path.join(__dirname, "assets");
const VIDEOS_DIR = path.join(__dirname, "videos");
const SCRIPTS_DIR = path.join(__dirname, "scripts");
const UPLOAD_DIR = path.join(ASSETS_DIR, "uploads");
const TEMP_DIR = path.join(ASSETS_DIR, "temp");
// kho thành phẩm — xem archiveAndCleanup()
const OUTPUT_DIR = path.join(__dirname, "output");
// 2026-09-18: trước đây log chỉ chảy qua SSE tới trình duyệt rồi mất khi đóng tab — không
// chẩn đoán lại được sự cố (vd 1 batch nhiều video liên tiếp needs_context_image không ra ảnh
// nào, không có cách nào xem lại vì sao). Giờ mọi dòng log của /api/generate-content và
// /api/create-video đều ghi thêm ra đây, xem writeRunLog().
const LOG_DIR = path.join(OUTPUT_DIR, "logs");
// content JSON gốc từ Gemini (kèm needs_context_image/image_concept từng point) +  BRIEF.md
// sau khi scaffold xong — archiveAndCleanup() xoá sạch videos/<slug>/ sau khi render thành
// công nên đây là bản sao DUY NHẤT còn sống sót của 2 thứ đó, xem persistContentRecord().
const CONTENT_ARCHIVE_DIR = path.join(OUTPUT_DIR, "content");
// data/social-queue.json — hàng đợi đăng Facebook + lịch sử đăng từng page, xem
// scripts/lib/social-queue.mjs. Riêng ngoài output/ vì đây là trạng thái vận hành đang chạy
// (không phải thành phẩm/log), cần sống sót qua restart server.
const DATA_DIR = path.join(__dirname, "data");

for (const d of [UPLOAD_DIR, TEMP_DIR, OUTPUT_DIR, LOG_DIR, CONTENT_ARCHIVE_DIR, DATA_DIR]) fs.mkdirSync(d, { recursive: true });

function writeRunLog(name, text) {
  try {
    fs.writeFileSync(path.join(LOG_DIR, name), text);
  } catch (e) {
    console.error(`⚠ Không ghi được log ${name}: ${e.message}`);
  }
}

const app = express();
app.use(express.json({ limit: "5mb" }));

// ------------------------------------------------------------------
// Static
// ------------------------------------------------------------------
app.use(express.static(PUBLIC_DIR));
// app.js dựng thumbnail pose bằng `/assets/actions/<file>.svg`
app.use("/assets", express.static(ASSETS_DIR));
// previewUrl + renderFile trỏ vào đây
app.use("/videos", express.static(VIDEOS_DIR));
// MP4 thành phẩm sau khi dọn project
app.use("/output", express.static(OUTPUT_DIR));

// ------------------------------------------------------------------
// Upload
// ------------------------------------------------------------------
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // giữ nguyên quy ước tên của bản cũ: <epoch>-<6 ký tự>.<ext>
    const rand = Math.random().toString(36).slice(2, 8);
    cb(null, `${Date.now()}-${rand}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ok = IMAGE_EXT.has(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error(`Chỉ nhận ảnh ${[...IMAGE_EXT].join(", ")} — nhận được "${file.originalname}".`), ok);
  },
}).fields([
  { name: "leftImage", maxCount: 1 },
  { name: "rightImage", maxCount: 1 },
]);

app.post("/api/upload", (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const left = req.files?.leftImage?.[0];
    const right = req.files?.rightImage?.[0];
    if (!left || !right) {
      return res.status(400).json({ error: "Cần đủ cả 2 file: leftImage và rightImage." });
    }
    // scaffold nhận đường dẫn tuyệt đối trên đĩa, không phải URL
    res.json({ leftPath: left.path, rightPath: right.path });
  });
});

// Single audio file upload for Voice Cloning (3-5s reference clip)
const refAudioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const rand = Math.random().toString(36).slice(2, 8);
    cb(null, `ref-voice-${Date.now()}-${rand}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const uploadRefAudio = multer({
  storage: refAudioStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
}).single("refAudio");

app.post("/api/upload-ref-audio", (req, res) => {
  uploadRefAudio(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "Không tìm thấy file audio." });
    res.json({ refPath: req.file.path, filename: req.file.filename });
  });
});

// Danh sách giọng của 1 engine cho 1 thị trường — nguồn: file giọng của engine (vd VieNeu) hoặc `voices` khai báo trong
// config/tts-engines/<id>.json; giọng mặc định / giọng dự phòng cũng khai báo ở đó (không hard-code trong code).
function resolveEngineVoices(engine, localeCode) {
  const fallback = engine.voiceFallback ? [{ id: engine.voiceFallback.id, label: engine.voiceFallback.label }] : [];
  const fallbackId = engine.voiceFallback?.id ?? null;
  if (engine.voicesFile) {
    const file = path.join(__dirname, engine.voicesFile);
    if (!fs.existsSync(file)) return { voices: fallback, defaultVoice: fallbackId };
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const presets = data.presets || {};
      const voices = Object.keys(presets).map((name) => {
        const info = presets[name];
        const desc = info.description ? ` (${info.description})` : "";
        return { id: name, label: `${name}${desc}` };
      });
      return { voices, defaultVoice: data.default_voice || defaultVoiceFor(engine, localeCode) || fallbackId };
    } catch {
      return { voices: fallback, defaultVoice: fallbackId };
    }
  }
  const voices = engine.voices?.[localeCode] || [];
  return { voices, defaultVoice: defaultVoiceFor(engine, localeCode) || voices[0]?.id || fallbackId };
}

// Tương thích client cũ: giọng VieNeu cho thị trường mặc định.
app.get("/api/vieneu-voices", (_req, res) => {
  const engine = getEngine("vieneu");
  if (!engine) return res.json({ voices: [], defaultVoice: null });
  res.json(resolveEngineVoices(engine, getDefaultLocale().code));
});

// Mô tả 1 locale cho UI + khả năng render (tính từ khai báo engine/theme, không có cờ cứng).
function describeLocale(l, themeId) {
  const r = checkRenderability(l, { themeId });
  return {
    code: l.code,
    language: l.language,
    script: l.script,
    displayName: l.displayName,
    flag: l.flag,
    flagIcon: l.flagIcon,
    slugSuffix: effectiveSlugSuffix(l), // "" cho thị trường mặc định; còn lại hậu tố slug thực tế
    styleSummary: l.styleSummary,
    renderable: r.renderable,
    blockers: r.blockers,
    engines: r.engines,
    themeId: r.themeId,
  };
}

app.get("/api/locales", (req, res) => {
  const themeId = String(req.query.theme || "").trim() || undefined;
  res.json({
    defaultLocale: getDefaultLocale().code,
    // thị trường mặc định đứng đầu, còn lại theo mã
    locales: listLocales()
      .sort((a, b) => (a.code === getDefaultLocale().code ? -1 : b.code === getDefaultLocale().code ? 1 : 0))
      .map((l) => describeLocale(l, themeId)),
  });
});

// Luật kiểm tra từng dòng của 1 thị trường (giới hạn, cụm cấm, glossary, tốc độ đọc) — trình duyệt dùng CÙNG module cảnh báo
// (public/shared/field-warnings.mjs) với server nên chỉ cần dữ liệu luật, không cài lại logic.
app.get("/api/locale-rules", (req, res) => {
  const locale = localeFromCode(req.query.locale);
  if (!locale) return res.status(400).json({ error: "Thị trường không tồn tại hoặc đang bị tắt." });
  res.json({ code: locale.code, displayName: locale.displayName, languageName: locale.prompt.language, ...rulesOf(locale) });
});

// Sửa 1 dòng bằng Gemini — chỉ gọi cho ĐÚNG trường đó (Bước 2). Huỷ khi client đóng kết nối / gửi yêu cầu mới (AbortController
// phía trình duyệt -> kết nối đóng -> huỷ request Gemini đang chờ).
function fieldEditHandler(run) {
  return async (req, res) => {
    const locale = localeFromCode(req.body?.locale);
    if (!locale) return res.status(400).json({ error: "Thị trường không tồn tại hoặc đang bị tắt." });
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const slug = typeof req.body?.pendingSlug === "string" && req.body.pendingSlug.startsWith("_pending-") ? req.body.pendingSlug : null;
      const out = await run({ locale, body: req.body || {}, slug, signal: controller.signal });
      res.json({ ...out, requestId: req.body?.requestId ?? null });
    } catch (e) {
      if (e instanceof AbortedError || controller.signal.aborted) return; // client đã bỏ
      if (e instanceof FieldEditError) return res.status(400).json({ error: e.message });
      console.warn(`[field-edit] ${redactSecrets(e.message)}`);
      res.status(500).json({ error: e.userMessage || "Gemini xử lý thất bại, vui lòng thử lại." });
    }
  };
}

app.post(
  "/api/rewrite-field",
  fieldEditHandler(({ locale, body, slug, signal }) =>
    rewriteField({ locale, kind: body.kind, idea: body.idea, current: body.current, context: body.context, slug, signal }),
  ),
);
app.post(
  "/api/translate-field",
  fieldEditHandler(({ locale, body, slug, signal }) => translateField({ locale, kind: body.kind, text: body.text, slug, signal })),
);

// Engine TTS cho 1 thị trường: supported = engine khai báo ngôn ngữ của locale; ready = đủ cấu hình để chạy.
app.get("/api/tts-engines", (req, res) => {
  const locale = getLocale(String(req.query.locale || getDefaultLocale().code));
  if (!locale) return res.status(400).json({ error: "Thị trường không tồn tại hoặc đang bị tắt." });
  const supportedIds = new Set(enginesForLanguage(locale.language).map((e) => e.id));
  const engines = listEngines().map((e) => {
    const { ready, reason } = engineReadiness(e);
    const { voices, defaultVoice } = resolveEngineVoices(e, locale.code);
    return {
      id: e.id,
      label: e.label,
      languages: e.languages,
      supported: supportedIds.has(e.id),
      ready,
      notReadyReason: reason,
      modes: e.modes,
      voices,
      defaultVoice,
    };
  });
  res.json({
    locale: locale.code,
    engines,
    message: supportedIds.size ? "" : `Chưa có giọng đọc (TTS) nào hỗ trợ ${locale.displayName} (${locale.language}).`,
  });
});

// Giao diện video: supported = theme khai báo hệ chữ (script) của locale.
app.get("/api/themes", (req, res) => {
  const locale = getLocale(String(req.query.locale || getDefaultLocale().code));
  if (!locale) return res.status(400).json({ error: "Thị trường không tồn tại hoặc đang bị tắt." });
  const themes = listThemes().map((t) => {
    const reasons = [];
    if (!themeSupportsScript(t, locale.script)) reasons.push(`chưa hỗ trợ chữ ${locale.script} (thiếu font)`);
    if (!themeSupportsLanguage(t, locale.language)) reasons.push(`pipeline dựng video chưa hỗ trợ ${locale.displayName}`);
    return { id: t.id, name: t.name, label: t.label, scripts: t.scripts, languages: t.languages, supported: reasons.length === 0, reason: reasons.join("; ") };
  });
  res.json({ locale: locale.code, defaultTheme: getDefaultTheme()?.id ?? null, themes });
});

app.get("/api/content-angles", (_req, res) => {
  res.json({ angles: CONTENT_ANGLES });
});

// ------------------------------------------------------------------
// Helper: chạy 1 script node, gom stdout+stderr
// ------------------------------------------------------------------
function runNode(args, { onLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: __dirname });
    let out = "";
    let tail = "";

    const feed = (buf) => {
      const text = buf.toString();
      out += text;
      if (!onLine) return;
      tail += text;
      const lines = tail.split("\n");
      tail = lines.pop() ?? "";
      for (const l of lines) onLine(l);
    };

    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", (e) => resolve({ code: -1, out: `${out}\n${e.message}` }));
    child.on("close", (code) => {
      if (tail && onLine) onLine(tail);
      resolve({ code, out });
    });
  });
}

// ------------------------------------------------------------------
// Gemini content
// ------------------------------------------------------------------
function assertInsideUploads(p, label) {
  const abs = path.resolve(String(p || ""));
  if (!abs.startsWith(UPLOAD_DIR + path.sep)) {
    throw new Error(`${label} phải là file đã upload qua /api/upload.`);
  }
  if (!fs.existsSync(abs)) throw new Error(`${label} không còn tồn tại: ${abs}`);
  return abs;
}

// Thị trường từ mã client gửi: rỗng -> mặc định; mã không tồn tại/bị tắt -> null (gọi hàm tự trả 400).
function localeFromCode(code) {
  const c = String(code || "").trim();
  return c ? getLocale(c) : getDefaultLocale();
}

// Sinh nội dung bằng Gemini (script generate-compare-content.mjs chạy như tiến trình con). Dùng chung cho /api/generate-content (Bước 1) và
// /api/market-versions (tạo phiên bản cho thị trường khác từ ảnh đã lưu). Trả { ok:true, content, locale, pendingSlug, ... } hoặc { ok:false, status, error }.
async function runGenerateContent({ leftPath, rightPath, hint = "", localeCode = "", contentAngleId = "", customAngleText = "" }) {
  // slug thật của video chưa xác định ở Bước 1 (người dùng chỉ đặt/sửa slug ở Bước 2, sau khi
  // thấy label_left/label_right Gemini vừa sinh ra) — dùng slug TẠM để dòng content-generation
  // ghi vào cost-ledger.jsonl không bị "slug": null. Client giữ pendingSlug này và gửi lại ở
  // /api/create-video, nơi nó được đổi thành slug thật (xem renameCostLedgerSlug bên dưới).
  const pendingSlug = `_pending-${crypto.randomUUID()}`;
  const outPath = path.join(TEMP_DIR, `content-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`);
  const args = [path.join(SCRIPTS_DIR, "generate-compare-content.mjs"), leftPath, rightPath, "--out", outPath, "--slug", pendingSlug];
  const cleanHint = String(hint || "").trim();
  if (cleanHint) args.push("--topic-hint", cleanHint);

  // Thị trường mục tiêu. Không gửi -> thị trường mặc định; mã không tồn tại/bị tắt -> lỗi 400.
  const code = String(localeCode || "").trim();
  if (code) {
    if (!getLocale(code)) return { ok: false, status: 400, error: `Thị trường "${code}" không tồn tại hoặc đang bị tắt.` };
    args.push("--locale", code);
  }

  const angleId = String(contentAngleId || "").trim();
  if (angleId) args.push("--content-angle-id", angleId);
  if (angleId === "custom") {
    const customText = String(customAngleText || "").trim();
    if (!customText) return { ok: false, status: 400, error: 'contentAngleId="custom" nhưng thiếu customAngleText.' };
    args.push("--custom-angle-text", customText);
  }

  const { code: exitCode, out } = await runNode(args);
  // Log NGAY cả khi thành công — đây là nơi duy nhất còn lại dòng chẩn đoán "Gemini đánh dấu
  // needs_context_image=true cho X/N point" (xem generate-compare-content.mjs), một khi client
  // rời trang thì output/logs/ là chỗ duy nhất còn xem lại được.
  writeRunLog(`generate-content-${Date.now()}.log`, `ARGS: ${args.join(" ")}\n\n${out}`);
  // Chi tiết kỹ thuật lỗi Gemini (model, mã lỗi, quotaId, retryDelay, body gốc) chỉ ra log server —
  // UI chỉ nhận thông báo tiếng Việt ở dòng "THẤT BẠI:" (xem geminiFailureMessage()).
  for (const l of out.split("\n")) if (l.startsWith("[gemini-error]")) console.warn(l);

  if (exitCode !== 0 || !fs.existsSync(outPath)) return { ok: false, status: 500, error: geminiFailureMessage(out) };

  try {
    const content = JSON.parse(fs.readFileSync(outPath, "utf8"));
    // client giữ nội dung trong state và POST lại ở /api/create-video, nên file tạm này không cần sống tiếp
    fs.rmSync(outPath, { force: true });
    return { ok: true, content, pendingSlug };
  } catch (e) {
    return { ok: false, status: 500, error: `Không đọc được kết quả Gemini: ${e.message}` };
  }
}

app.post("/api/generate-content", async (req, res) => {
  let leftPath, rightPath;
  try {
    leftPath = assertInsideUploads(req.body?.leftPath, "leftPath");
    rightPath = assertInsideUploads(req.body?.rightPath, "rightPath");
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const gen = await runGenerateContent({
    leftPath,
    rightPath,
    hint: req.body?.topicHint,
    localeCode: req.body?.locale,
    contentAngleId: req.body?.contentAngleId,
    customAngleText: req.body?.customAngleText,
  });
  if (!gen.ok) return res.status(gen.status).json({ error: gen.error });

  const { content, pendingSlug } = gen;
  // Hashtag dự kiến cho Studio Bước 2 (chip có thể xoá/thêm) — cùng logic với lúc đăng, theo bộ từ vựng của thị trường
  // (kèm nghĩa tiếng Việt cho tooltip). `warnings` = cảnh báo theo từng field (không chặn).
  const locale = localeFromCode(content.locale) || getDefaultLocale();
  const cfg = loadHashtagConfig(locale);
  const { plan } = planHashtags(content, cfg);
  res.json({
    content,
    pendingSlug,
    locale: locale.code,
    hashtags: withMeanings(plan, cfg),
    hashtagMax: maxHashtags(),
    warnings: content._meta?.warnings || [],
    generatedBy: generatedByOf(content._meta), // { model, primary, isFallback } — UI Bước 2 hiện badge model (+ "(dự phòng)")
  });
});

// Lưu nháp / mở lại bản ghi / tạo phiên bản cho thị trường khác — xem server-market.mjs.
const marketApi = createMarketApi({
  app,
  dirs: { UPLOAD_DIR, CONTENT_ARCHIVE_DIR, VIDEOS_DIR, OUTPUT_DIR },
  assertInsideUploads,
  runGenerateContent,
  localeFromCode,
});

// Chuẩn hoá 1 hashtag người dùng gõ tay ở Studio (bỏ dấu, thường, <=25 ký tự, lọc blocked) — để UI
// dùng ĐÚNG luật của server thay vì tự cài lại. tier="topic" nếu tag nằm trong whitelist chủ đề.
app.post("/api/normalize-hashtag", (req, res) => {
  const locale = localeFromCode(req.body?.locale);
  if (!locale) return res.status(400).json({ error: "Thị trường không tồn tại hoặc đang bị tắt." });
  const cfg = loadHashtagConfig(locale);
  const tag = cleanTag(req.body?.tag, cfg);
  if (!tag) {
    return res.status(422).json({ error: "Hashtag không hợp lệ hoặc nằm trong danh sách cấm." });
  }
  const [withVi] = withMeanings([{ tag }], cfg);
  res.json({ tag, tier: cfg.groupOf.has(tag) ? "topic" : "specific", vi: withVi.vi || "" });
});

// Tính lại plan hashtag theo label HIỆN TẠI (sau khi người dùng sửa label ở Bước 2). Bỏ `materials`
// cũ của Gemini để label mới quyết định tag cụ thể. topicTags được căn lại theo NHÓM của vật liệu mới:
// cùng nhóm thì giữ, khác nhóm thì thay bằng 1 tag ngẫu nhiên trong nhóm đúng. Trả kèm topicTags mới
// để client dùng cho lần tính lại sau.
app.post("/api/plan-hashtags", (req, res) => {
  const b = req.body || {};
  const locale = localeFromCode(b.locale);
  if (!locale) return res.status(400).json({ error: "Thị trường không tồn tại hoặc đang bị tắt." });
  const cfg = loadHashtagConfig(locale);
  const labels = { label_left: b.label_left, label_right: b.label_right };
  const topicTags = alignTopicTags(b.topicTags, resolveMaterialGroups(labels, cfg), cfg);
  const { plan } = planHashtags({ ...labels, topicTags }, cfg);
  res.json({ hashtags: withMeanings(plan, cfg), topicTags });
});

// ------------------------------------------------------------------
// Create video (SSE)
// ------------------------------------------------------------------
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// videos/<slug>/ trùng tên -> thêm hậu tố số thứ tự thay vì báo lỗi dừng lại (vd nhiều video
// khác góc độ nội dung, cùng 1 cặp ảnh, dễ trùng slug gốc).
function ensureUniqueSlug(baseSlug) {
  let slug = baseSlug;
  let n = 2;
  while (fs.existsSync(path.join(VIDEOS_DIR, slug))) {
    slug = `${baseSlug}-${n}`;
    n++;
  }
  return slug;
}

app.post("/api/create-video", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  // runLog tích luỹ MỌI dòng say() của cả request này — ghi ra output/logs/ ở finally, bất kể
  // thành công hay lỗi, để xem lại được sau khi tab trình duyệt đã đóng (xem writeRunLog()).
  const runLog = [];
  const say = (message) => {
    runLog.push(message);
    send({ message });
  };

  const fail = (message) => {
    say(`✖ ${message}`);
    send({ type: "error", error: message });
    res.end();
  };

  let contentPath = null;
  let slugForLog = null;
  try {
    const { content, slug: rawSlug, topicHint, ttsProvider, vieneuVoice, vieneuRefPath, pendingSlug } = req.body || {};
    const leftPath = assertInsideUploads(req.body?.leftPath, "leftPath");
    const rightPath = assertInsideUploads(req.body?.rightPath, "rightPath");

    if (!rawSlug || !SLUG_RE.test(rawSlug)) {
      return fail(`slug "${rawSlug}" không hợp lệ — chỉ a-z, 0-9 và dấu gạch ngang (không dấu tiếng Việt).`);
    }
    if (!content || !Array.isArray(content.points) || content.points.length === 0) {
      return fail("Thiếu nội dung kịch bản (content.points rỗng).");
    }

    // Thị trường của nội dung: content.locale (do bước sinh nội dung ghi) hoặc locale client gửi; không có -> mặc định.
    // Thị trường chưa đủ điều kiện dựng (thiếu giọng đọc / giao diện chưa hỗ trợ chữ / pipeline chưa hỗ trợ ngôn ngữ) bị chặn
    // Ở ĐÂY (server) dù UI đã khoá nút — không tin client.
    const locale = localeFromCode(content.locale || req.body?.locale);
    if (!locale) return fail("Thị trường của nội dung không tồn tại hoặc đang bị tắt.");
    if (content.locale && req.body?.locale && content.locale !== req.body.locale) {
      return fail(`Nội dung thuộc thị trường "${content.locale}" nhưng yêu cầu dựng cho "${req.body.locale}".`);
    }
    const renderability = checkRenderability(locale);
    if (!renderability.renderable) {
      return fail(`Thị trường ${locale.displayName} chưa dựng được video: ${renderability.blockers.map((b) => b.message).join(" ")}`);
    }
    // Slug bản ngoại ngữ = slug gốc + hậu tố thị trường (thị trường mặc định giữ slug như cũ).
    const slugSuffix = effectiveSlugSuffix(locale);
    if (!hasLocaleSuffix(rawSlug, locale)) {
      return fail(`Slug của thị trường ${locale.displayName} phải kết thúc bằng "-${slugSuffix}" (vd "ten-goc-${slugSuffix}").`);
    }

    // Nhiều góc độ nội dung khác nhau cho CÙNG 1 cặp ảnh dễ ra trùng slug gốc (vd cùng
    // buildSlug() nhưng người dùng gõ tay giống nhau) — tự thêm hậu tố -2, -3... thay vì
    // chặn đứng, để không phải quay lại sửa tay mỗi lần thử góc độ khác. Thị trường khác: số thứ tự chèn TRƯỚC hậu tố thị trường.
    const slug = slugSuffix
      ? uniqueSlugForLocale(stripLocaleSuffix(rawSlug, locale), locale, (s) => fs.existsSync(path.join(VIDEOS_DIR, s)))
      : ensureUniqueSlug(rawSlug);
    slugForLog = slug;
    if (slug !== rawSlug) {
      say(`ℹ slug "${rawSlug}" đã tồn tại — dùng "${slug}" thay thế.`);
    }
    // Chốt lại slug tạm dùng lúc gọi Gemini ở Bước 1 (/api/generate-content) thành slug thật
    // vừa xác định — để dòng content-generation trong cost-ledger.jsonl không còn mồ côi
    // "slug" tạm (xem renameCostLedgerSlug trong scripts/lib/cost-ledger.mjs).
    if (pendingSlug) {
      const renamed = renameCostLedgerSlug(pendingSlug, slug);
      if (renamed > 0) {
        say(`ℹ Đã gắn ${renamed} dòng chi phí Gemini (Bước 1) vào slug "${slug}".`);
      }
    }
    // Hashtag: plan Studio gửi lên (đã cho người dùng sửa) — luôn làm sạch lại phía server. Không có
    // (client cũ/API gọi trực tiếp) thì tự dựng từ content, video thiếu dữ liệu mới rơi về label.
    const hashtagCfg = loadHashtagConfig(locale);
    const planned = planHashtags(content, hashtagCfg);
    const hashtagPlan = sanitizePlan(req.body?.hashtags, hashtagCfg) ?? planned.plan;
    // Gợi ý (vật liệu chưa có trong bảng + suggestedTags) chỉ ghi ra file cho người duyệt, KHÔNG đăng.
    recordHashtagSuggestions({ slug, unmapped: planned.unmapped, suggestedTags: content.suggestedTags }, hashtagCfg);

    say("▶ Đang khởi động quy trình dựng video...");

    contentPath = path.join(TEMP_DIR, `content-${Date.now()}.json`);
    fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));
    // Bản sao BỀN của content JSON gốc (needs_context_image/image_concept từng point) — TEMP_DIR
    // chỉ tồn tại trong request này (xoá ở finally), còn videos/<slug>/ có thể bị
    // archiveAndCleanup() xoá sạch sau khi render xong. Đây mới là bản duy nhất còn sống lâu dài.
    // Bản ghi mang thị trường (locale), trạng thái "built" và bản sao ảnh nguồn + gợi ý + góc độ để sau này "tạo phiên bản cho thị trường khác".
    {
      const previous = readRecord(CONTENT_ARCHIVE_DIR, slug);
      let source = previous?._meta?.source || null;
      try {
        source = {
          ...copySourceImages(CONTENT_ARCHIVE_DIR, slug, leftPath, rightPath),
          topicHint: String(topicHint || ""),
          contentAngleId: String(req.body?.contentAngleId || "auto"),
          customAngleText: String(req.body?.customAngleText || ""),
        };
      } catch (e) {
        say(`⚠ Không lưu được bản sao ảnh nguồn (${e.message}) — sẽ không tạo được phiên bản thị trường khác từ video này.`);
      }
      writeRecord(CONTENT_ARCHIVE_DIR, slug, buildRecord({ content, locale, hashtagPlan, status: "built", source, derivedFrom: previous?._meta?.derivedFrom || null }));
    }

    const args = [
      path.join(SCRIPTS_DIR, "scaffold-compare-video.mjs"),
      leftPath,
      rightPath,
      "--content",
      contentPath,
      "--slug",
      slug,
    ];
    const hint = String(topicHint || "").trim();
    if (hint) args.push("--topic-hint", hint);

    if (ttsProvider) {
      // engine phải là 1 engine khai báo trong config/tts-engines/ (UI sinh danh sách từ đó)
      if (!getEngine(ttsProvider)) return fail(`Engine giọng đọc "${ttsProvider}" không tồn tại hoặc đang bị tắt (config/tts-engines/).`);
      args.push("--tts-provider", ttsProvider);
    }
    if (ttsProvider === "edge" && req.body?.ttsVoice) {
      const v = String(req.body.ttsVoice).trim();
      if (!/^[A-Za-z0-9-]+$/.test(v)) return fail("Giọng Edge TTS không hợp lệ.");
      args.push("--edge-voice", v);
    }
    if (ttsProvider === "vieneu") {
      if (vieneuRefPath) {
        const refAbs = assertInsideUploads(vieneuRefPath, "vieneuRefPath");
        args.push("--vieneu-voice", refAbs);
      } else if (vieneuVoice) {
        args.push("--vieneu-voice", vieneuVoice);
      }
    }

    say(`▶ Lệnh: node ${args.join(" ")}`);
    const scaffold = await runNode(args, { onLine: (l) => say(l) });
    if (scaffold.code !== 0) {
      return fail(`Quy trình dựng video thất bại với mã lỗi ${scaffold.code}`);
    }

    const target = path.join(VIDEOS_DIR, slug);
    let renderUrl = null;
    // Đọc TRƯỚC khi archiveAndCleanup() có thể xoá videos/<slug>/ — dùng làm caption fallback
    // khi chưa có output/content/<slug>.compare-content.json (xem resolveSocialPost()).
    const videoDisplayName = readMetaName(slug) || slug;

    // Sao lưu BRIEF.md TRƯỚC khi archiveAndCleanup() có thể xoá sạch videos/<slug>/ ở dưới —
    // đây là bản ghi NGƯỜI ĐỌC ĐƯỢC duy nhất còn lại của việc ảnh minh hoạ ngữ cảnh nào đã
    // sinh/bị cắt cho video này (mục "Ảnh minh hoạ ngữ cảnh" — xem writeBrief() trong
    // scaffold-compare-video.mjs), bổ sung cho compare-content.json thô đã lưu ở trên.
    const briefSrc = path.join(target, "BRIEF.md");
    if (fs.existsSync(briefSrc)) {
      try {
        fs.copyFileSync(briefSrc, path.join(CONTENT_ARCHIVE_DIR, `${slug}.BRIEF.md`));
      } catch (e) {
        say(`⚠ Không sao lưu được BRIEF.md: ${e.message}`);
      }
    }

    try {
      const indexHtml = fs.readFileSync(path.join(target, "index.html"), "utf8");
      const poseTimeline = extractPoseTimeline(indexHtml);
      if (poseTimeline) {
        fs.writeFileSync(path.join(CONTENT_ARCHIVE_DIR, `${slug}.pose-timeline.json`), JSON.stringify(poseTimeline, null, 2));
      }
    } catch (e) {
      say(`⚠ Không lưu được timeline pose (ảnh bìa Reel sẽ chọn frame ngẫu nhiên): ${e.message}`);
    }

    const wantRender = req.body?.render !== false && process.env.AUTO_RENDER !== "0";
    const keepProject = req.body?.keepProject === true || process.env.KEEP_PROJECT === "1";
    if (wantRender) {
      say("");
      say("▶ Đang render MP4 (bước này lâu, khoảng 1-3 phút)...");
      const render = await new Promise((resolve) => {
        const npmRender = npmCommand("npm", ["run", "render"]);
        const child = spawn(npmRender.command, npmRender.args, { cwd: target });
        let tail = "";
        const feed = (buf) => {
          tail += buf.toString();
          const lines = tail.split("\n");
          tail = lines.pop() ?? "";
          // log render rất ồn (mỗi frame 1 dòng) — chỉ đẩy dòng có ý nghĩa
          for (const l of lines) {
            if (/error|fail|✖|✔|◇|◆|Render|render|\.mp4/i.test(l) && !l.startsWith("[")) say(l);
          }
        };
        child.stdout.on("data", feed);
        child.stderr.on("data", feed);
        child.on("error", () => resolve(-1));
        child.on("close", (code) => resolve(code));
      });

      const file = latestRender(slug);
      if (render !== 0 || !file) {
        // project vẫn dùng được, chỉ thiếu MP4 — báo chứ không huỷ cả run.
        // Cũng KHÔNG dọn ở nhánh này: dọn khi chưa có MP4 là mất trắng.
        say(`⚠ Render không thành công (mã ${render}). Project đã dựng xong, render lại bằng:`);
        say(`   cd videos/${slug} && npm run render`);
      } else {
        renderUrl = file;
        say(`✔ MP4: ${file}`);
        if (keepProject) {
          say(`  (KEEP_PROJECT — giữ nguyên videos/${slug}/)`);
        } else {
          renderUrl = archiveAndCleanup(slug, file, say);
        }
      }
    }

    // Vào hàng đợi đăng Facebook (xem processSocialQueueTick() ở dưới) — chỉ khi thật sự có MP4
    // thành phẩm. Tắt bằng FB_AUTO_POST=0. Không throw: đăng bài là tính năng phụ, lỗi ở đây
    // không được phép làm hỏng response /api/create-video.
    if (renderUrl && isAutoPostEnabled()) {
      try {
        const absoluteVideoPath = path.join(__dirname, renderUrl.replace(/^\//, ""));
        if (!fs.existsSync(absoluteVideoPath)) {
          say(`⚠ Không thêm vào hàng đợi đăng Facebook: file không tồn tại: ${absoluteVideoPath}`);
        } else {
          const { title: caption, hashtags } = resolveSocialPost(slug, videoDisplayName, hashtagPlan, locale.code);
          const queued = tryEnqueueVideo(
            { slug, videoPath: absoluteVideoPath, caption, hashtags, locale: locale.code },
            { pages: getConfiguredPages(), defaultCode: getDefaultLocale().code },
          );
          if (queued.status === "enqueued") {
            say(`ℹ Đã thêm vào hàng đợi đăng Facebook (chỉ đăng lên page thị trường ${locale.code}, luân phiên, cách nhau 30-60 phút).`);
          } else if (queued.status === "no-page-for-locale") {
            say(`⚠ ${queued.reason}`);
            fbLog.warn(queued.reason);
          } else {
            say("ℹ Slug này đã đăng / đang chờ đăng — không thêm trùng vào hàng đợi.");
          }
        }
      } catch (e) {
        say(`⚠ Không thêm được vào hàng đợi đăng Facebook: ${e.message}`);
      }
    }

    // previewUrl ưu tiên MP4: index.html chỉ là composition (timeline paused),
    // mở thẳng nó thì người dùng tưởng video hỏng.
    const projectKept = fs.existsSync(path.join(target, "index.html"));
    send({
      type: "success",
      slug,
      previewUrl: renderUrl || `/videos/${slug}/index.html`,
      renderUrl,
      // null khi project đã bị dọn — đừng đưa link tới file không còn tồn tại
      compositionUrl: projectKept ? `/videos/${slug}/index.html` : null,
    });
    res.end();
  } catch (e) {
    fail(e.message);
  } finally {
    if (contentPath) fs.rmSync(contentPath, { force: true });
    // Ghi log bất kể thành công hay lỗi — trước đây toàn bộ output này chỉ có ở SSE, mất khi
    // đóng tab. Dùng slugForLog (gán ngay khi slug xác định) vì `slug` có thể chưa tồn tại
    // nếu request fail sớm (vd slug không hợp lệ) — khi đó rơi về mốc thời gian.
    const name = slugForLog ? `${slugForLog}-${Date.now()}.log` : `create-video-failed-${Date.now()}.log`;
    writeRunLog(name, runLog.join("\n"));
  }
});

// ------------------------------------------------------------------
// Danh sách video
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Chính sách lưu trữ: CHỈ GIỮ MP4 (theo yêu cầu của chủ repo 2026-08-30)
//
// Render xong -> chuyển MP4 sang output/ rồi xoá sạch videos/<slug>/.
// Tiết kiệm ~8.4MB/video (node_modules 7MB + assets/actions 1MB + source
// 0.37MB), đổi lại video KHÔNG render lại / sửa lại được nữa — Gemini không
// tái lập được cùng một kịch bản, nên sửa một chữ cũng phải làm video mới.
// Đặt KEEP_PROJECT=1 (hoặc {"keepProject": true}) khi cần giữ source để sửa.
//
// MP4 đi ra output/ chứ không nằm lại videos/<slug>/renders/, vì scaffold từ
// chối dựng khi videos/<slug>/ đã tồn tại — giữ lại thư mục rỗng là khoá luôn
// slug đó vĩnh viễn.
// ------------------------------------------------------------------
function archiveAndCleanup(slug, renderWebPath, say) {
  const src = path.join(__dirname, renderWebPath.replace(/^\//, ""));
  const dest = path.join(OUTPUT_DIR, `${slug}${path.extname(src)}`);

  let moved = false;
  try {
    const size = fs.statSync(src).size;
    if (size < 100 * 1024) throw new Error(`MP4 chỉ ${size} byte — nghi ngờ render lỗi`);

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.renameSync(src, dest); // cùng volume nên rename là đủ, không cần copy
    moved = true;
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== size) {
      throw new Error("MP4 không đến nơi nguyên vẹn");
    }

    // chỉ xoá SAU khi đã xác nhận MP4 nằm an toàn ở output/
    // maxRetries/retryDelay: ngay sau khi child render (Chrome headless) vừa
    // thoát, Windows/AV đôi khi còn giữ handle trên vài file trong node_modules
    // hoặc renders/ trong vài trăm ms -> rmSync bắn EPERM dù thư mục hợp lệ để
    // xoá. Node tự lùi tuyến tính và thử lại thay vì bỏ cuộc ngay lần đầu.
    fs.rmSync(path.join(VIDEOS_DIR, slug), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 300,
    });
    say(`✔ Đã lưu: /output/${path.basename(dest)}  (${(size / 1048576).toFixed(1)} MB)`);
    say(`  Đã xoá videos/${slug}/ — chỉ giữ MP4. Muốn giữ source: KEEP_PROJECT=1`);
    return `/output/${path.basename(dest)}`;
  } catch (e) {
    say(`⚠ Không dọn được (${e.message}) — giữ nguyên videos/${slug}/ cho an toàn.`);
    // MP4 đã rename sang output/ thì đường dẫn renders/ cũ không còn tồn tại
    return moved && fs.existsSync(dest) ? `/output/${path.basename(dest)}` : renderWebPath;
  }
}

function readMetaName(slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(VIDEOS_DIR, slug, "meta.json"), "utf8")).name || null;
  } catch {
    return null;
  }
}

function latestRender(slug) {
  const dir = path.join(VIDEOS_DIR, slug, "renders");
  if (!fs.existsSync(dir)) return null;
  const mp4s = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return mp4s.length ? `/videos/${slug}/renders/${mp4s[0].f}` : null;
}

// Caption đăng Facebook: "title" (câu hook Gemini sinh ở Bước 1) + plan hashtag, từ bản lưu bền
// output/content/<slug>.compare-content.json — xem CONTENT_ARCHIVE_DIR ở đầu file. `livePlan` là plan
// vừa chốt ở /api/create-video (ưu tiên hơn bản lưu). Video cũ dựng trước khi tính năng này tồn tại
// (không có file content / không có materials, topicTags) rơi về tên hiển thị/slug + hashtag theo label.
function resolveSocialPost(slug, fallbackName, livePlan = null, localeCode = null) {
  return resolveSocialPostIn({ dir: CONTENT_ARCHIVE_DIR, slug, fallbackName, livePlan, localeCode });
}

// Gộp trạng thái đăng Facebook (data/social-queue.json) theo slug, cho GET /api/videos.
function socialStatusBySlug() {
  const { queue, posts } = loadQueue();
  const map = new Map();
  for (const p of posts) {
    // mới nhất thắng nếu 1 slug lỡ có nhiều lần đăng (không nên xảy ra, nhưng không giả định)
    map.set(p.slug, {
      status: "posted",
      pageName: p.pageName,
      postedAt: p.postedAt,
      postType: p.postType || "video",
      fallbackReason: p.fallbackReason || null,
    });
  }
  for (const j of queue) {
    if (map.has(j.slug)) continue;
    if (j.status === "verifying") {
      map.set(j.slug, { status: "verifying", pageName: j.verifyPageName, fbVideoId: j.fbVideoId, verifyStartedAt: j.verifyStartedAt });
    } else if (j.status === "failed") {
      map.set(j.slug, { status: "failed", lastError: redactSecrets(j.lastError || "") });
    } else {
      map.set(j.slug, { status: "pending" });
    }
  }
  return map;
}

app.get("/api/videos", (_req, res) => {
  const out = [];

  // 1. project còn source (video tham chiếu, hoặc dựng với KEEP_PROJECT=1)
  if (fs.existsSync(VIDEOS_DIR)) {
    for (const d of fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      const slug = d.name;
      out.push({
        slug,
        // bản cũ lấy name từ meta.json (nên thien-thach-vs-sao-bang hiện là
        // "comparison-video" — tên mặc định của hyperframes init), fallback slug
        name: readMetaName(slug) || slug,
        hasIndex: fs.existsSync(path.join(VIDEOS_DIR, slug, "index.html")),
        hasBrief: fs.existsSync(path.join(VIDEOS_DIR, slug, "BRIEF.md")),
        renderFile: latestRender(slug),
        previewUrl: `/videos/${slug}/index.html`,
        location: `videos/${slug}/`,
      });
    }
  }

  // 2. MP4 đã lưu trữ, project đã bị dọn — không còn index.html để xem trước,
  //    nên previewUrl trỏ thẳng vào video
  if (fs.existsSync(OUTPUT_DIR)) {
    const known = new Set(out.map((v) => v.slug));
    for (const f of fs.readdirSync(OUTPUT_DIR)) {
      if (!f.endsWith(".mp4")) continue;
      const slug = f.replace(/\.mp4$/, "");
      if (known.has(slug)) continue;
      out.push({
        slug,
        name: slug,
        hasIndex: false,
        hasBrief: false,
        renderFile: `/output/${f}`,
        previewUrl: `/output/${f}`,
        location: "output/",
      });
    }
  }

  // 2b. Thị trường + trạng thái của từng bản ghi (bản ghi cũ thiếu locale = thị trường mặc định) và các bản NHÁP chưa dựng.
  for (const v of out) {
    Object.assign(v, marketApi.recordInfo(v.slug));
    v.canMakeVersion = marketApi.canMakeVersion(v.slug);
  }
  const listed = new Set(out.map((v) => v.slug));
  for (const d of marketApi.listDrafts()) if (!listed.has(d.slug)) out.push(d);

  // 3. Trạng thái đăng Facebook (data/social-queue.json) — gắn thêm, không thay đổi field cũ.
  const social = socialStatusBySlug();
  for (const v of out) {
    const s = social.get(v.slug);
    if (s) v.social = s;
  }

  out.sort((a, b) => a.slug.localeCompare(b.slug));
  res.json(out);
});

app.get("/api/social-queue", (_req, res) => {
  res.json(publicQueueState());
});

// ------------------------------------------------------------------
// Catalog pose
// ------------------------------------------------------------------
app.get("/api/actions", (_req, res) => {
  const p = path.join(ASSETS_DIR, "actions", "actions.json");
  if (!fs.existsSync(p)) return res.status(500).json({ error: `Không tìm thấy ${p}` });
  try {
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    // Chỉ trả pose có frame.frame_class "full" = pose dùng được trong pipeline
    // (bộ ảnh 2026-08). Biến thể "*-alt" cố tình bỏ cờ này nên không hiện trong picker.
    const all = json.actions || [];
    const usable = all.filter((a) => a.frame?.frame_class === "full");
    res.json({ actions: usable.length ? usable : all });
  } catch (e) {
    res.status(500).json({ error: `actions.json hỏng: ${e.message}` });
  }
});

// ------------------------------------------------------------------
// Thống kê chi phí AI — đọc output/cost-ledger.jsonl (xem scripts/lib/cost-ledger.mjs),
// tổng hợp theo ngày/tác vụ/video cho tab "Thống kê chi phí" ở public/app.js.
//
// XOÁ DỮ LIỆU MẪU: scripts/seed-fake-cost-data.mjs sinh vài dòng giả lập để test giao diện
// trước khi có credit Gemini thật — xoá bằng cách chạy lại chính script đó với cờ --clear
// (xem README hoặc phần comment đầu file đó), KHÔNG xoá tay từng dòng trong file .jsonl.
// ------------------------------------------------------------------
// Trả { rows } khi đọc/parse OK (kể cả file chưa tồn tại -> rows: [], đó là trạng thái
// "chưa có dữ liệu" hợp lệ, KHÔNG phải lỗi). Trả { error } riêng khi tự bản thân việc ĐỌC FILE
// thất bại (quyền truy cập, đĩa lỗi...) — route handler cần phân biệt 2 trường hợp này để trả
// đúng 200 (rỗng) hay 500 (lỗi thật) cho client, tránh giao diện hiểu nhầm "lỗi" thành "rỗng".
function readCostLedger() {
  if (!fs.existsSync(COST_LEDGER_PATH)) return { rows: [] };
  let raw;
  try {
    raw = fs.readFileSync(COST_LEDGER_PATH, "utf8");
  } catch (e) {
    return { error: `Không đọc được ${COST_LEDGER_PATH}: ${e.message}` };
  }
  const rows = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // dòng hỏng (vd ghi dở khi crash) — bỏ qua, không chặn cả thống kê.
    }
  }
  return { rows };
}

app.get("/api/cost-stats", (_req, res) => {
  const { rows, error } = readCostLedger();
  if (error) return res.status(500).json({ error });

  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const sevenDaysAgoMs = now - 7 * DAY_MS;

  let totalAllTime = 0;
  let totalToday = 0;
  let totalLast7Days = 0;
  // Không giới hạn 30 ngày ở đây nữa — trả TOÀN BỘ lịch sử theo ngày, để client tự cắt theo bộ
  // lọc khoảng ngày (7/30/tất cả) chọn trong UI mà không cần gọi lại API mỗi lần đổi bộ lọc.
  const byDayMap = new Map();
  const byTaskMap = new Map();
  const byLocaleMap = new Map();
  const videoMap = new Map();
  // Thị trường của 1 dòng sổ: cột `locale` (dòng mới) -> thị trường của bản ghi theo slug -> mặc định (dòng/dữ liệu cũ thiếu locale).
  const slugLocaleCache = new Map();
  const localeOfSlug = (slug) => {
    if (!slug) return getDefaultLocale().code;
    if (!slugLocaleCache.has(slug)) slugLocaleCache.set(slug, marketApi.recordInfo(slug).locale);
    return slugLocaleCache.get(slug);
  };

  for (const row of rows) {
    const rowLocale = row.locale && getLocale(row.locale) ? row.locale : localeOfSlug(row.slug);
    const cost = typeof row.cost_usd === "number" ? row.cost_usd : 0;
    const task = row.task || "unknown";
    const timestamp = typeof row.timestamp === "string" ? row.timestamp : null;
    const ts = timestamp ? Date.parse(timestamp) : NaN;
    const dateStr = timestamp ? timestamp.slice(0, 10) : null;

    totalAllTime += cost;
    if (dateStr === todayStr) totalToday += cost;
    if (!Number.isNaN(ts) && ts >= sevenDaysAgoMs) totalLast7Days += cost;
    if (dateStr) {
      byDayMap.set(dateStr, (byDayMap.get(dateStr) || 0) + cost);
    }
    byTaskMap.set(task, (byTaskMap.get(task) || 0) + cost);
    byLocaleMap.set(rowLocale, (byLocaleMap.get(rowLocale) || 0) + cost);

    // Dòng kiểm chứng (task "verification") vẫn nằm trong tổng/theo ngày/theo task ở trên nhưng KHÔNG phải video:
    // bỏ khỏi thống kê theo video để không hiện thành "video ma".
    if (countsAsVideo(row)) {
      if (!videoMap.has(row.slug)) {
        videoMap.set(row.slug, {
          slug: row.slug,
          locale: rowLocale,
          createdAt: timestamp,
          totalCost: 0,
          byTask: {},
          callCount: 0,
          errorCount: 0,
          imagesGenerated: 0,
          _lastTimestamp: timestamp,
        });
      }
      const v = videoMap.get(row.slug);
      v.totalCost += cost;
      v.byTask[task] = (v.byTask[task] || 0) + cost;
      v.callCount += 1;
      if (row.status === "error") v.errorCount += 1;
      // Đếm ẢNH THẬT ĐÃ SINH RA (context-image, status success) — khác với đếm số LẦN GỌI, vì
      // 1 lần gọi thành công luôn ra đúng 1 ảnh ở tính năng này (xem generate-context-image.mjs),
      // nhưng dùng image_count thay vì cộng cứng 1 để không sai nếu sau này 1 lần gọi ra >1 ảnh.
      if (task === "context-image" && row.status === "success") {
        v.imagesGenerated += typeof row.image_count === "number" ? row.image_count : 1;
      }
      if (timestamp && (!v.createdAt || timestamp < v.createdAt)) v.createdAt = timestamp;
      if (timestamp && (!v._lastTimestamp || timestamp > v._lastTimestamp)) v._lastTimestamp = timestamp;
    }
  }

  const byDay = [...byDayMap.entries()]
    .map(([date, cost]) => ({ date, cost }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byTask = Object.fromEntries(byTaskMap);
  const byLocale = Object.fromEntries(byLocaleMap);
  // badge cờ cho từng video (cờ + tên lấy từ file locale)
  const localeBadge = (code) => {
    const l = getLocale(code);
    return l ? { flag: l.flag, flagIcon: l.flagIcon, displayName: l.displayName } : { flag: "", flagIcon: null, displayName: code };
  };

  // mới nhất lên đầu — dựa theo lần gọi API gần nhất ghi nhận cho video đó.
  const videos = [...videoMap.values()]
    .sort((a, b) => String(b._lastTimestamp).localeCompare(String(a._lastTimestamp)))
    .map(({ _lastTimestamp, ...v }) => ({ ...v, ...localeBadge(v.locale) }));

  res.json({
    generatedAt: new Date(now).toISOString(),
    totalAllTime,
    totalToday,
    totalLast7Days,
    byDay,
    byTask,
    byLocale,
    locales: Object.keys(byLocale).map((code) => ({ code, ...localeBadge(code) })),
    videos,
  });
});

// ------------------------------------------------------------------
// Đăng Facebook luân phiên — đăng MỖI VIDEO lên ĐÚNG 1 page (không nhân bản lên cả 4), page
// được chọn NGẪU NHIÊN trong số các page đã "nghỉ" đủ 30-60 phút kể từ lần đăng gần nhất của
// CHÍNH page đó (xem pickEligiblePage() trong scripts/lib/social-queue.mjs). Mỗi tick chỉ đăng
// TỐI ĐA 1 video (job cũ nhất trong hàng đợi) để không dồn dập khi có nhiều page cùng rảnh.
//
// Tắt bằng FB_AUTO_POST=0 hoặc để trống .env (getConfiguredPages() trả mảng rỗng thì tick
// không làm gì). KHÔNG throw ra ngoài setInterval — 1 lần đăng lỗi không được phép làm crash
// server hay chặn các video khác trong hàng đợi ở tick sau.
// ------------------------------------------------------------------
const FB_POST_MIN_GAP_MINUTES = Number(process.env.FB_POST_MIN_GAP_MINUTES) || 30;
const FB_POST_MAX_GAP_MINUTES = Number(process.env.FB_POST_MAX_GAP_MINUTES) || 60;
const SOCIAL_TICK_MS = 60_000;
const SHUTDOWN_GRACE_MS = 60_000;
const fbLog = makeLogger("facebook");

// Khoá trong-process: 1 lần đăng có thể lâu hơn SOCIAL_TICK_MS, tick sau không được chạy chồng
// (cả 2 cùng thấy job còn "pending" -> đăng trùng).
let socialTickInFlight = false;
let currentTick = null;
let shuttingDown = false;

// Ảnh bìa Reel — lỗi chỉ log cảnh báo, không fail job. Kết quả (thời điểm frame) lưu vào posts[].
async function applyReelThumbnail(job, page, videoId) {
  const tlog = makeLogger("thumbnail");
  const r = await setReelThumbnail({
    videoId,
    page,
    videoPath: job.videoPath,
    poseTimelinePath: path.join(CONTENT_ARCHIVE_DIR, `${job.slug}.pose-timeline.json`),
  });
  if (r.ok) {
    tlog.info(`Đã đặt ảnh bìa "${job.slug}" tại ${r.timeSec}s (${r.source}${r.pose ? `, pose ${r.pose}` : ""}).`);
  } else {
    tlog.warn(`Không đặt được ảnh bìa "${job.slug}": ${r.error}`);
  }
  return r;
}

// Kiểm tra các job đang "verifying" (Reel đã tồn tại trên Facebook, video_id thật, nhưng chưa
// thấy publishing_phase xong) — mỗi tick gọi lại đúng 1 GET nhẹ/job, KHÔNG đăng lại từ đầu.
// Chốt "posted" khi complete, "failed" khi Facebook báo lỗi HOẶC quá verifyTimeoutMs().
async function checkVerifyingJobsTick(pages) {
  const { queue } = loadQueue();
  for (const job of verifyingJobs(queue)) {
    if (shuttingDown) return;
    const page = pages.find((p) => p.id === job.verifyPageId);
    if (!page) {
      fbLog.warn(`Job "${job.slug}" đang verifying nhưng page "${job.verifyPageName || job.verifyPageId}" không còn trong .env — bỏ qua tick này.`);
      continue;
    }
    try {
      const result = await checkReelStatus(job.fbVideoId, page);
      if (result.state === "complete") {
        const thumbnail = await applyReelThumbnail(job, page, job.fbVideoId);
        finalizeVerifiedPost(job.id, job.fbVideoId, { thumbnail });
        fbLog.info(`Reel "${job.slug}" (video_id=${job.fbVideoId}) publish xong trên "${page.name}".`);
      } else if (result.state === "error") {
        failJobTerminal(job.id, result.reason);
        fbLog.error(`Reel "${job.slug}" (video_id=${job.fbVideoId}) bị Facebook từ chối: ${result.reason}`);
      } else {
        const startedMs = Date.parse(job.verifyStartedAt);
        if (!Number.isNaN(startedMs) && Date.now() - startedMs > verifyTimeoutMs()) {
          failJobTerminal(job.id, `Hết ~${verifyTimeoutMs() / 60_000} phút xác minh mà Facebook chưa báo xong (video_id=${job.fbVideoId}) — kiểm tra thủ công trên Page.`);
          fbLog.error(`Reel "${job.slug}" hết hạn xác minh (video_id=${job.fbVideoId}, page "${page.name}").`);
        }
      }
    } catch (e) {
      if (e.permanent) {
        // Token lỗi khi CHỈ ĐANG KIỂM TRA: tắt page cho job MỚI, job đang verifying GIỮ NGUYÊN.
        disablePage(page, e.message);
        fbLog.error(`Page "${page.name}" lỗi token vĩnh viễn khi kiểm tra Reel "${job.slug}" — đã tắt page (không huỷ job). (${e.message})`);
      } else {
        fbLog.warn(`Không kiểm tra được trạng thái Reel "${job.slug}" (video_id=${job.fbVideoId})${e.rateLimited ? " [rate limit]" : ""}: ${e.message} — thử lại tick sau.`);
      }
    }
  }
}

// Thử đăng job "pending" tiếp theo (nếu có page nào rảnh) — xem publishVideo() trong
// facebook-post.mjs cho ý nghĩa outcome "complete"/"verifying"/"error".
async function tryPostNextPendingJobTick(pages) {
  if (shuttingDown) return;
  const { queue, pageHistory, disabledPages } = loadQueue();
  const defaultCode = getDefaultLocale().code;
  // Mỗi job chỉ ghép với page CÙNG thị trường (dữ liệu queue cũ thiếu locale = mặc định). Job mà thị trường không có page nào
  // được cấu hình thì đánh dấu lỗi rõ ràng, không chặn job phía sau.
  const { job, page, orphaned } = selectJobAndPage(queue, pages, pageHistory, FB_POST_MIN_GAP_MINUTES, FB_POST_MAX_GAP_MINUTES, disabledPages, defaultCode);
  for (const o of orphaned) {
    const reason = `Không có page nào cấu hình thị trường ${jobLocale(o, defaultCode)} (FB_PAGE_n_LOCALE) — không đăng để tránh đăng nhầm thị trường.`;
    failJobTerminal(o.id, reason);
    fbLog.error(`Job "${o.slug}" failed (không retry): ${reason}`);
  }
  if (!job || !page) return;

  if (!fs.existsSync(job.videoPath)) {
    failJobTerminal(job.id, `File không còn tồn tại: ${job.videoPath}`);
    fbLog.error(`Job "${job.slug}" failed (không retry): file không còn tồn tại: ${job.videoPath}`);
    return;
  }

  try {
    // onSubmitted: ngay khi finish đã tới Facebook (đã có video_id) -> lưu "verifying". Nếu server
    // tắt/crash sau điểm này, job không bị đăng lại. Trước điểm này job còn "pending" (chưa có gì
    // được publish) nên thử lại là an toàn.
    // Caption dựng MỖI LẦN đăng: tag chủ đề đổi ngẫu nhiên trong cùng nhóm để các page không trùng
    // caption. Job không có plan hashtag (job cũ) đăng đúng `caption` như trước.
    const caption = job.hashtags?.length
      ? buildCaption(job.caption, finalizeHashtags(job.hashtags, loadHashtagConfig(localeFromCode(job.locale) || getDefaultLocale())))
      : job.caption;
    const result = await publishVideo(page, job.videoPath, caption, {
      onSubmitted: (videoId) => recordVerifying(job.id, page, videoId, { postType: "reel", caption }),
    });

    if (result.outcome === "verifying") {
      recordVerifying(job.id, page, result.id, { postType: result.postType, caption });
      fbLog.info(`"${job.slug}" đã tạo Reel (video_id=${result.id}) trên "${page.name}" — Facebook còn xử lý, tự kiểm tra tiếp ở các tick sau (tối đa ~${verifyTimeoutMs() / 60_000} phút).`);
    } else if (result.outcome === "error") {
      // Reel ĐÃ TỒN TẠI nhưng bị từ chối ngay — KHÔNG retry (sẽ tạo Reel MỚI trùng).
      failJobTerminal(job.id, result.reason);
      fbLog.error(`Reel "${job.slug}" (video_id=${result.id}) bị Facebook từ chối ngay sau khi tạo: ${result.reason}`);
    } else {
      const thumbnail = result.postType === "reel" ? await applyReelThumbnail(job, page, result.id) : null;
      recordPost(job.id, page, result.id, { postType: result.postType, fallbackReason: result.fallbackReason, thumbnail, caption });
      const fallbackNote = result.fallbackReason ? ` (fallback từ reel: ${result.fallbackReason})` : "";
      fbLog.info(`Đã đăng "${job.slug}" lên page "${page.name}" dạng ${result.postType}${fallbackNote} (post id ${result.id}).`);
    }
  } catch (e) {
    // Chỉ throw từ ĐÂY (start/upload/finish rõ ràng lỗi, hoặc postVideoToPage) mới vào nhánh retry
    // — nghĩa là CHƯA có Reel nào được tạo, thử lại an toàn.
    const kind = classifyError(e);
    if (kind === "permanent") {
      // Lỗi VỀ PAGE (token) — tắt page, job giữ "pending" để tick sau thử page khác.
      disablePage(page, e.message);
      fbLog.error(`Page "${page.name}" lỗi token vĩnh viễn — đã TẮT page này (sửa FB_PAGE_*_ACCESS_TOKEN trong .env rồi restart để bật lại). Job "${job.slug}" giữ nguyên hàng đợi, sẽ thử page khác. (${e.message})`);
    } else if (kind === "rate_limit") {
      recordFailure(job.id, e);
      fbLog.warn(`Facebook giới hạn tốc độ (rate limit) khi đăng "${job.slug}" lên "${page.name}" — hoãn job ${rateLimitBackoffMinutes()} phút, không tính vào số lần thử. (${e.message})`);
    } else {
      recordFailure(job.id, e);
      fbLog.error(`Đăng "${job.slug}" lên "${page.name}" thất bại: ${e.message}`);
    }
  }
}

async function processSocialQueueTick() {
  if (!isAutoPostEnabled() || shuttingDown) return;
  if (socialTickInFlight) return; // tick trước chưa xong — bỏ qua, không đăng chồng
  const pages = getConfiguredPages();
  if (!pages.length) return;

  socialTickInFlight = true;
  try {
    await checkVerifyingJobsTick(pages);
    await tryPostNextPendingJobTick(pages);
  } finally {
    socialTickInFlight = false;
  }
}

// ------------------------------------------------------------------
// Trạng thái vận hành Facebook cho UI (modal "Danh sách video đã dựng"): page bị tắt vì lỗi
// token, lỗi cấu hình, ffmpeg. KHÔNG trả token/secret.
// ------------------------------------------------------------------
let ffmpegStatus = { ok: null, detail: "chưa kiểm tra" };
app.get("/api/social-status", (_req, res) => {
  const { pages, problems } = inspectConfiguredPages();
  const { disabledPages } = loadQueue();
  res.json({
    autoPost: isAutoPostEnabled(),
    configuredPages: pages.map((p) => ({ id: p.id, name: p.name, locale: p.locale })),
    configProblems: problems,
    disabledPages: listDisabledPages(pages, disabledPages).map((d) => ({
      ...d,
      howToEnable: "Tạo lại Page Access Token đúng, sửa FB_PAGE_n_ACCESS_TOKEN trong .env rồi restart server (xem docs/facebook-auto-post.md).",
    })),
    ffmpeg: { ok: ffmpegStatus.ok, detail: redactSecrets(ffmpegStatus.detail || "") },
  });
});

// ------------------------------------------------------------------
// Khởi động + tắt an toàn
// ------------------------------------------------------------------
function validateFbConfigAtStartup() {
  const { pages, problems } = inspectConfiguredPages();
  for (const p of problems) fbLog.warn(p);
  const enabled = isAutoPostEnabled();
  if (enabled && !pages.length) {
    fbLog.warn("FB_AUTO_POST đang bật nhưng KHÔNG có page hợp lệ nào (cần FB_PAGE_n_ID + FB_PAGE_n_ACCESS_TOKEN) — sẽ không đăng gì.");
  } else if (enabled) {
    fbLog.info(`Tự động đăng bật: ${pages.length} page (${pages.map((p) => `${p.name} [${p.locale}]`).join(", ")}), Graph API ${graphVersion()}.`);
  }
  if (enabled && pages.length) {
    const ff = checkFfmpeg();
    ffmpegStatus = ff;
    if (!ff.ok) makeLogger("thumbnail").warn(`ffmpeg không chạy được (${ff.detail}) — ảnh bìa Reel sẽ không đặt được; đăng bài vẫn bình thường.`);
  }
}

const tickTimer = setInterval(() => {
  currentTick = processSocialQueueTick()
    .catch((e) => fbLog.error(`Lỗi không mong đợi ở tick: ${e.message}`))
    .finally(() => {
      currentTick = null;
    });
}, SOCIAL_TICK_MS);

// Nạp + kiểm tra config/locales, config/tts-engines, config/themes ngay lúc khởi động: file lỗi bị log rõ và tắt
// (xem loadLocales/loadRegistry), server vẫn chạy. Chỉ thiếu cả locale mặc định mới không chạy được -> dừng.
function validateLocalesAtStartup() {
  const lg = makeLogger("locales");
  try {
    const def = getDefaultLocale();
    const all = listLocales();
    lg.info(`Thị trường mặc định: ${def.code}. Đang bật: ${all.map((l) => l.code).join(", ")}.`);
    for (const l of all) {
      const r = checkRenderability(l);
      if (!r.renderable) lg.info(`${l.code}: chưa render được — ${r.blockers.map((b) => b.message).join(" ")}`);
    }
  } catch (e) {
    lg.error(e.message);
    process.exit(1);
  }
  void localeErrors();
  void capabilityErrors();
}

const httpServer = app.listen(PORT, () => {
  console.log(`Auto Compare Video UI  ->  http://localhost:${PORT}`);
  validateLocalesAtStartup();
  validateFbConfigAtStartup();
  void validateGeminiModels(); // không chặn khởi động; chỉ log cảnh báo nếu tên model sai / chưa có model dự phòng
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  fbLog.info(`Nhận ${signal} — dừng nhận tick mới${currentTick ? `, đợi lần đăng đang chạy tối đa ${SHUTDOWN_GRACE_MS / 1000}s` : ""}.`);
  clearInterval(tickTimer);
  httpServer.close();
  if (currentTick) {
    const timedOut = await Promise.race([
      currentTick.then(() => false),
      new Promise((resolve) => setTimeout(() => resolve(true), SHUTDOWN_GRACE_MS)),
    ]);
    // Hết giờ: job chưa có video_id vẫn "pending" (chưa coi là đã đăng); job đã finish thì đã
    // được lưu "verifying" qua onSubmitted — queue nhất quán, restart sẽ tiếp tục đúng.
    if (timedOut) fbLog.warn("Hết thời gian chờ — thoát; job đang upload dở giữ nguyên trạng thái trong queue.");
  }
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
