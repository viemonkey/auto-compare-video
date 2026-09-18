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
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CONTENT_ANGLES } from "./config/content-angles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3002;

const PUBLIC_DIR = path.join(__dirname, "public");
const ASSETS_DIR = path.join(__dirname, "assets");
const VIDEOS_DIR = path.join(__dirname, "videos");
const SCRIPTS_DIR = path.join(__dirname, "scripts");
const UPLOAD_DIR = path.join(ASSETS_DIR, "uploads");
const TEMP_DIR = path.join(ASSETS_DIR, "temp");
// kho thành phẩm — xem archiveAndCleanup()
const OUTPUT_DIR = path.join(__dirname, "output");

for (const d of [UPLOAD_DIR, TEMP_DIR, OUTPUT_DIR]) fs.mkdirSync(d, { recursive: true });

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

app.get("/api/vieneu-voices", (_req, res) => {
  const voicesFile = path.join(__dirname, "VieNeu-TTS", "src", "vieneu", "assets", "voices_v3_turbo.json");
  if (!fs.existsSync(voicesFile)) {
    return res.json({ voices: [{ id: "Adam", label: "Adam (Mặc định)" }], defaultVoice: "Adam" });
  }
  try {
    const data = JSON.parse(fs.readFileSync(voicesFile, "utf8"));
    const presets = data.presets || {};
    const voices = Object.keys(presets).map((name) => {
      const info = presets[name];
      const desc = info.description ? ` (${info.description})` : "";
      return { id: name, label: `${name}${desc}` };
    });
    res.json({ voices, defaultVoice: data.default_voice || "Minh Quân" });
  } catch (e) {
    res.json({ voices: [{ id: "Adam", label: "Adam (Mặc định)" }], defaultVoice: "Adam" });
  }
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

app.post("/api/generate-content", async (req, res) => {
  let leftPath, rightPath;
  try {
    leftPath = assertInsideUploads(req.body?.leftPath, "leftPath");
    rightPath = assertInsideUploads(req.body?.rightPath, "rightPath");
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const outPath = path.join(TEMP_DIR, `content-${Date.now()}.json`);
  const args = [
    path.join(SCRIPTS_DIR, "generate-compare-content.mjs"),
    leftPath,
    rightPath,
    "--out",
    outPath,
  ];
  const hint = String(req.body?.topicHint || "").trim();
  if (hint) args.push("--topic-hint", hint);

  const contentAngleId = String(req.body?.contentAngleId || "").trim();
  if (contentAngleId) args.push("--content-angle-id", contentAngleId);
  if (contentAngleId === "custom") {
    const customAngleText = String(req.body?.customAngleText || "").trim();
    if (!customAngleText) {
      return res.status(400).json({ error: 'contentAngleId="custom" nhưng thiếu customAngleText.' });
    }
    args.push("--custom-angle-text", customAngleText);
  }

  const { code, out } = await runNode(args);
  if (code !== 0 || !fs.existsSync(outPath)) {
    return res.status(500).json({ error: out.trim().split("\n").slice(-6).join("\n") || "Gemini thất bại." });
  }

  try {
    const content = JSON.parse(fs.readFileSync(outPath, "utf8"));
    // client giữ nội dung trong state và POST lại ở /api/create-video, nên
    // file tạm này không cần sống tiếp
    fs.rmSync(outPath, { force: true });
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: `Không đọc được kết quả Gemini: ${e.message}` });
  }
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
  const say = (message) => send({ message });

  const fail = (message) => {
    say(`✖ ${message}`);
    send({ type: "error", error: message });
    res.end();
  };

  let contentPath = null;
  try {
    const { content, slug: rawSlug, topicHint, ttsProvider, vieneuVoice, vieneuRefPath } = req.body || {};
    const leftPath = assertInsideUploads(req.body?.leftPath, "leftPath");
    const rightPath = assertInsideUploads(req.body?.rightPath, "rightPath");

    if (!rawSlug || !SLUG_RE.test(rawSlug)) {
      return fail(`slug "${rawSlug}" không hợp lệ — chỉ a-z, 0-9 và dấu gạch ngang (không dấu tiếng Việt).`);
    }
    // Nhiều góc độ nội dung khác nhau cho CÙNG 1 cặp ảnh dễ ra trùng slug gốc (vd cùng
    // buildSlug() nhưng người dùng gõ tay giống nhau) — tự thêm hậu tố -2, -3... thay vì
    // chặn đứng, để không phải quay lại sửa tay mỗi lần thử góc độ khác.
    const slug = ensureUniqueSlug(rawSlug);
    if (slug !== rawSlug) {
      say(`ℹ slug "${rawSlug}" đã tồn tại — dùng "${slug}" thay thế.`);
    }
    if (!content || !Array.isArray(content.points) || content.points.length === 0) {
      return fail("Thiếu nội dung kịch bản (content.points rỗng).");
    }

    say("▶ Đang khởi động quy trình dựng video...");

    contentPath = path.join(TEMP_DIR, `content-${Date.now()}.json`);
    fs.writeFileSync(contentPath, JSON.stringify(content, null, 2));

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

    if (ttsProvider) args.push("--tts-provider", ttsProvider);
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

    const wantRender = req.body?.render !== false && process.env.AUTO_RENDER !== "0";
    const keepProject = req.body?.keepProject === true || process.env.KEEP_PROJECT === "1";
    if (wantRender) {
      say("");
      say("▶ Đang render MP4 (bước này lâu, khoảng 1-3 phút)...");
      const render = await new Promise((resolve) => {
        const child = spawn("npm", ["run", "render"], { cwd: target, shell: true });
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
  // Theo dõi riêng "đã rename xong chưa" — nếu rename thành công nhưng bước xoá
  // videos/<slug>/ sau đó lỗi (thường do Windows khoá file), vẫn phải trả về link
  // output/ thật. Trả nhầm renderWebPath cũ ở đây từng khiến UI đưa link 404 (file
  // đã dời đi rồi) dù MP4 nằm an toàn ở output/.
  let movedTo = null;

  try {
    const size = fs.statSync(src).size;
    if (size < 100 * 1024) throw new Error(`MP4 chỉ ${size} byte — nghi ngờ render lỗi`);

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.renameSync(src, dest); // cùng volume nên rename là đủ, không cần copy
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== size) {
      throw new Error("MP4 không đến nơi nguyên vẹn");
    }
    movedTo = `/output/${path.basename(dest)}`;

    // chỉ xoá SAU khi đã xác nhận MP4 nằm an toàn ở output/
    fs.rmSync(path.join(VIDEOS_DIR, slug), { recursive: true, force: true });
    say(`✔ Đã lưu: ${movedTo}  (${(size / 1048576).toFixed(1)} MB)`);
    say(`  Đã xoá videos/${slug}/ — chỉ giữ MP4. Muốn giữ source: KEEP_PROJECT=1`);
    return movedTo;
  } catch (e) {
    if (movedTo) {
      say(`⚠ MP4 đã lưu an toàn ở ${movedTo} nhưng không xoá được videos/${slug}/ (${e.message}) — giữ lại source.`);
      return movedTo;
    }
    say(`⚠ Không dọn được (${e.message}) — giữ nguyên videos/${slug}/ cho an toàn.`);
    return renderWebPath;
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

  out.sort((a, b) => a.slug.localeCompare(b.slug));
  res.json(out);
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

app.listen(PORT, () => {
  console.log(`Auto Compare Video UI  ->  http://localhost:${PORT}`);
});
