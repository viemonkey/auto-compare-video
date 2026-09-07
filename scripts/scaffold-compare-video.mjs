#!/usr/bin/env node
// Auto Compare Video — orchestrator chính.
//
// Ghép: 2 ảnh người dùng upload -> generate-compare-content.mjs (Gemini) -> template
// templates/auto-compare/ -> 1 project HyperFrames hoàn chỉnh mới dưới videos/<slug>/.
//
// KHÔNG bao giờ sửa/ghi đè video đã có sẵn — luôn tạo thư mục videos/<slug>/ mới, dừng lại
// với lỗi rõ ràng nếu <slug> đã tồn tại.
//
// Usage:
//   node scripts/scaffold-compare-video.mjs <left-image> <right-image> [options]
//
// Options:
//   --slug <name>        Tên thư mục videos/<slug>/ (mặc định: tự sinh kebab-case từ
//                         label_left/label_right Gemini trả về, check trùng)
//   --content <path>     Dùng 1 file compare-content.json ĐÃ CÓ SẴN thay vì gọi lại Gemini
//                         (tiết kiệm quota khi test lại cùng nội dung nhiều lần). 2 ảnh vẫn
//                         phải truyền — chỉ bỏ qua bước GỌI GEMINI, ảnh vẫn được copy vào card.
//   --topic-hint <text>  Gợi ý ngữ cảnh thêm cho Gemini (bỏ qua nếu dùng --content)
//   --skip-check         Không tự chạy `npm run check` sau khi dựng xong
//
// Ví dụ:
//   node scripts/scaffold-compare-video.mjs test-images/nhan-vang.jpg test-images/nhan-kim-cuong.jpg \
//     --content /tmp/compare-test-jewelry.json
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCompareContent, loadActionCatalog } from "./generate-compare-content.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ---------- nhịp kịch bản cố định cho template này (xem DESIGN.md § Rhythm — auto-compare
// variant): hook(2, tự sinh) -> question(1, = title Gemini) -> body(N, = points Gemini) ->
// payoff(1, tự sinh). Không dùng nhịp 12-dòng cố định của skill create-video. ----------
// Fixed poses for the beats the model does not choose. All four must exist in
// assets/actions/actions.json with frame.frame_class "full" (the flag that marks
// a pose usable by this pipeline — the 2026-08 set is a uniform square crop, no
// more camera-distance mixing). 2026-08-31: picked to match each pose's own
// actions.json "use_case" for that beat (an earlier draft used a "point at the
// right card" pose for the hook, which overlapped with what body points do and
// didn't fit hook/payoff).
// 2026-09-03: wave / offer-a removed from the catalog. Hook now points at the
// card being introduced ("đây là X").
// 2026-09-04: bộ ảnh HuyK thay mới (7 pose), offer-b bị gỡ — hook phải giờ
// dùng point-up-right (đối xứng với point-up-left) thay cho cử chỉ xoè hai tay.
const HOOK_POSE_LEFT = "point-up-left"; // giới thiệu khái niệm bên card trái
const HOOK_POSE_RIGHT = "point-up-right"; // giới thiệu khái niệm bên card phải (chỉ chéo lên phải)
const QUESTION_POSE = "thinking"; // use_case: "đặt câu hỏi mở đầu kiểu 'Sự khác nhau là gì?'"
const PAYOFF_POSE = "thumbs-up-a"; // use_case: "xác nhận câu trả lời đúng / khen ngợi"

// #root backdrop (2026-09-07, was marble-jewelry-stand.png) —
// templates/auto-compare/index.html references this filename directly; each
// scaffolded video needs its own local copy (same pattern as assets/actions/*.svg
// below), so keep this in sync with the template's CSS.
const BACKGROUND_FILE = "paper-crumpled.webp";

// Timing (2026-09-04, bản v2): generate-vo.mjs đã trim ~0.2s lead + ~0.8s trailing
// silence khỏi mỗi line-*.mp3 theo word boundary, nên KHÔNG cần gap lớn theo beat
// nữa — 1 gap phẳng nhỏ cho ~0.5s speech-to-speech. Xem templates/auto-compare/generate-vo.mjs
// (TL_START1 / TL_GAP / TL_OUTRO) — giữ 3 hằng số này khớp nhau.
const START_1 = 0.55;
const GAP_FLAT = 0.14;
const OUTRO_HOLD = 1.2;

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exitCode = 1;
  throw new Error(msg);
}

// ============================================================
// CLI args
// ============================================================
function parseArgs(argv) {
  const positional = [];
  const opts = { slug: null, contentPath: null, topicHint: null, skipCheck: false, ttsProvider: null, vieneuVoice: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--slug") opts.slug = argv[++i];
    else if (a === "--content") opts.contentPath = argv[++i];
    else if (a === "--topic-hint") opts.topicHint = argv[++i];
    else if (a === "--skip-check") opts.skipCheck = true;
    else if (a === "--tts-provider") opts.ttsProvider = argv[++i];
    else if (a === "--vieneu-voice") opts.vieneuVoice = argv[++i];
    else if (!a.startsWith("--")) positional.push(a);
    else fail(`Cờ không nhận diện được: ${a}`);
  }
  if (positional.length !== 2) {
    fail(
      "Usage: node scripts/scaffold-compare-video.mjs <left-image> <right-image> " +
        "[--slug <name>] [--content <path>] [--topic-hint <text>] [--skip-check] [--tts-provider <name>] [--vieneu-voice <voice_or_path>]",
    );
  }
  opts.left = positional[0];
  opts.right = positional[1];
  if (opts.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(opts.slug)) {
    // Most common cause: the caller stripped Vietnamese text with a bare
    // /[^a-z0-9]+/ and deleted the accented letters themselves ("Cá voi sát
    // thủ" -> "c-voi-s-t-th-"). slugify() below does the NFD pass properly.
    const fixed = slugify(opts.slug);
    fail(
      `--slug "${opts.slug}" không hợp lệ — dùng kebab-case chữ thường, ví dụ "vang-vs-kim-cuong".` +
        (fixed && fixed !== opts.slug ? ` Ý bạn là "${fixed}"?` : "") +
        " Nếu slug do code sinh ra: nhớ .normalize(\"NFD\") + bỏ dấu tổ hợp TRƯỚC khi lọc [^a-z0-9].",
    );
  }
  return opts;
}

// ============================================================
// Helpers dùng chung
// ============================================================
function stripDiacritics(str) {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, (m) => (m === "đ" ? "d" : "D"))
    .toLowerCase();
}

function slugify(str) {
  return stripDiacritics(str)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function genUniqueSlug(labelLeft, labelRight) {
  const base = `${slugify(labelLeft)}-vs-${slugify(labelRight)}`;
  let slug = base;
  let n = 2;
  while (fs.existsSync(path.join(REPO_ROOT, "videos", slug))) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function run(cmd, cwd, label) {
  console.log(`\n[${label}] ${cmd}  (cwd: ${cwd})`);
  const res = spawnSync(cmd, { cwd, stdio: "inherit", shell: true });
  if (res.status !== 0) {
    fail(`${label} thất bại (exit ${res.status}).`);
  }
}

// ============================================================
// Validate compare-content (kể cả khi nạp từ --content, có thể sửa tay/cũ)
// ============================================================
// ============================================================
// Tương thích ngược: content sinh bởi bản generate-compare-content.mjs cũ (hoặc
// viết tay) chỉ có { text, suggested_action } — thiếu side/tag/sub mà layout
// nhãn cần. Suy ra tạm để không chặn build, và IN RÕ cái gì bị suy ra: tag máy
// cắt từ câu thoại luôn kém hơn tag do model viết, nên nên sửa lại trong UI.
// ============================================================
function shortenForLabel(text, max) {
  const clean = String(text).trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.5 ? cut.slice(0, sp) : clean.slice(0, max)).replace(/[,;:–—-]+$/, "").trim();
}

// Safety net for old / hand-written --content files that still name a pose id
// removed in the 2026-08 pose set — map each to the closest surviving id.
const POSE_DOWNGRADE = {
  // Pose chỉ tay trái/phải — chuẩn 2026-09-01: CHỈ point-up-left (trái) /
  // point-up-right (phải). Mọi biến thể cũ gập về đúng 1 trong 2.
  "point-left-far": "point-up-left",
  "point-right-far": "point-up-right",
  "point-up-a": "point-up-left",
  "point-up-b": "point-up-right",
  "point-right-near": "explain-b", // không phải hành động chỉ trái/phải thuần
  "walk": "explain-a", // 2026-09-03: idle-confident removed
  "wave": "point-up-left", // 2026-09-03: removed — hook giới thiệu card trái
  "offer-a": "point-up-right", // 2026-09-03: removed; 2026-09-04: offer-b cũng gỡ
  "offer-b": "point-up-right", // 2026-09-04: gỡ cùng bộ ảnh HuyK mới — hook phải -> point-up-right
  "idle-confident": "explain-a", // 2026-09-03: removed
  "wow": "shocked-a", // 2026-09-03: removed
  "stop": "explain-a", // 2026-09-03: removed
  "listening": "explain-a", // 2026-09-03: removed
  "shocked-b": "shocked-a", // 2026-09-03: removed variant
  "shrug-b": "shrug-a", // 2026-09-03: removed variant
  "thumbs-up-b": "thumbs-up-a", // 2026-09-03: removed variant
  "inspect-gem": "thinking",
  "present-ring": "point-up-right", // 2026-09-04: offer-b gỡ
  "show-item": "point-up-right", // 2026-09-04: offer-b gỡ
  "present-clipboard": "explain-a",
};

function backfillPointFields(content, catalogFull) {
  const derived = [];
  const norm = (s) => stripDiacritics(String(s || "")).toLowerCase();
  const left = norm(content.label_left);
  const right = norm(content.label_right);
  let alternate = 0;

  content.points.forEach((p, i) => {
    const missing = [];
    if (!["left", "right", "both"].includes(p.side)) {
      const t = norm(p.text);
      const hasL = left && t.includes(left);
      const hasR = right && t.includes(right);
      if (hasL && !hasR) p.side = "left";
      else if (hasR && !hasL) p.side = "right";
      else if (hasL && hasR) p.side = "both";
      else p.side = alternate++ % 2 === 0 ? "left" : "right";
      missing.push(`side=${p.side}`);
    }
    // Split on the first clause break — Vietnamese comparison lines almost
    // always read "<đặc điểm>, <chi tiết>", which maps straight onto tag/sub.
    const parts = String(p.text).split(/\s*[,;:–—]\s*/).filter(Boolean);
    if (typeof p.tag !== "string" || !p.tag.trim()) {
      p.tag = shortenForLabel(parts[0] || p.text, 18);
      missing.push(`tag="${p.tag}"`);
    }
    if (typeof p.sub !== "string") {
      p.sub = parts.length > 1 ? shortenForLabel(parts.slice(1).join(", "), 26) : "";
      missing.push(`sub="${p.sub}"`);
    }
    if (missing.length) derived.push(`  points[${i}]: ${missing.join("  ")}`);
  });

  // Pose: only ids present in the catalog (frame.frame_class "full") are usable.
  // An old / hand-written --content file may still name a removed id — remap it.
  const remapped = [];
  content.points.forEach((p, i) => {
    if (catalogFull.includes(p.suggested_action)) return;
    const to = POSE_DOWNGRADE[p.suggested_action] || "explain-a";
    remapped.push(`  points[${i}]: ${p.suggested_action} -> ${to}`);
    p.suggested_action = to;
  });
  if (remapped.length) {
    console.warn(
      `\n⚠ ${remapped.length} pose không có trong actions.json (bộ ảnh mới) — đã thay bằng pose gần nghĩa:\n` +
        remapped.join("\n") + "\n",
    );
  }

  if (derived.length) {
    console.warn(
      `\n⚠ compare-content thiếu field nhãn (side/tag/sub) — đã suy ra tự động cho ${derived.length}/${content.points.length} point:\n` +
        derived.join("\n") +
        "\n  Nguyên nhân thường gặp: server đang chạy bản generate-compare-content.mjs cũ trong memory —" +
        "\n  restart server để Gemini tự viết tag ngắn gọn thay vì cắt máy móc từ câu thoại.\n",
    );
  }
  return derived.length;
}

function validateContent(content, catalog) {
  for (const k of ["title", "label_left", "label_right", "points"]) {
    if (!(k in content)) fail(`compare-content thiếu field "${k}".`);
  }
  for (const k of ["title", "label_left", "label_right"]) {
    if (typeof content[k] !== "string" || !content[k].trim()) fail(`compare-content.${k} rỗng.`);
  }
  if (!Array.isArray(content.points) || content.points.length === 0) {
    fail("compare-content.points phải là mảng có ít nhất 1 phần tử.");
  }
  for (const [i, p] of content.points.entries()) {
    if (typeof p.text !== "string" || !p.text.trim()) fail(`points[${i}].text rỗng.`);
    if (!["left", "right", "both"].includes(p.side)) {
      fail(`points[${i}].side = ${JSON.stringify(p.side)} phải là "left" | "right" | "both".`);
    }
    if (typeof p.tag !== "string" || !p.tag.trim()) fail(`points[${i}].tag rỗng.`);
    if (typeof p.sub !== "string") fail(`points[${i}].sub phải là string ("" nếu không có dòng phụ).`);
    if (typeof p.suggested_action !== "string" || !catalog.allIds.includes(p.suggested_action)) {
      fail(
        `points[${i}].suggested_action = "${p.suggested_action}" không dùng được. ` +
          "Chỉ chấp nhận pose có frame.frame_class=\"full\" trong assets/actions/actions.json: " +
          `${catalog.allIds.join(", ")}.` +
          (catalog.excludedIds && catalog.excludedIds.includes(p.suggested_action)
            ? ` ("${p.suggested_action}" tồn tại nhưng là biến thể phụ *-alt, không vào pipeline.)`
            : ""),
      );
    }
  }
}

// ============================================================
// Xây danh sách dòng thoại (hook -> question -> body -> payoff) từ content
// ============================================================
// `text` is the spoken line (drives the TTS + timing); `side` / `tag` / `sub`
// are what actually appears on screen — the reference clip carries no sentence
// subtitles, only a short tag under each panel.
function buildLines(content) {
  const { label_left, label_right, title, points } = content;
  const lines = [];

  lines.push({
    n: 1,
    beat: "hook",
    pose: HOOK_POSE_LEFT,
    text: `Đây là ${label_left}.`,
    side: "left",
    tag: label_left,
    sub: "",
  });
  lines.push({
    n: 2,
    beat: "hook",
    pose: HOOK_POSE_RIGHT,
    text: `Đây là ${label_right}.`,
    side: "right",
    tag: label_right,
    sub: "",
  });
  lines.push({
    n: 3,
    beat: "question",
    pose: QUESTION_POSE,
    text: title,
    side: "both",
    tag: title,
    sub: "",
  });
  points.forEach((p, i) => {
    lines.push({
      n: 4 + i,
      beat: "body",
      pose: p.suggested_action,
      text: p.text,
      side: p.side,
      tag: p.tag,
      sub: p.sub || "",
    });
  });
  const payoffText = `${label_left} hay ${label_right} — giờ thì bạn đã rõ rồi đấy!`;
  lines.push({
    n: 4 + points.length,
    beat: "payoff",
    pose: PAYOFF_POSE,
    text: payoffText,
    side: "both",
    tag: "Bạn chọn bên nào?",
    sub: "Comment cho mình biết nhé",
  });

  return lines.map((l) => ({ ...l, id: `line-${l.n}` }));
}

// ============================================================
// Caption karaoke (bản v2, 2026-09-04)
// ------------------------------------------------------------
// Nhãn 2 khái niệm giờ CỐ ĐỊNH phía trên 2 ảnh (#lb-fixed, chèn thẳng bằng
// __LABEL_LEFT__ / __LABEL_RIGHT__). Toàn bộ text theo từng beat do caption chạy
// word-by-word ở khe giữa ảnh và host đảm nhiệm. Nguồn timing: assets/vo/words.json
// (Edge TTS word boundary, do templates/auto-compare/generate-vo.mjs ghi ra).
// Sinh object CAPTIONS = { <n>: [[word, startSec], ...], ... } cho template.
// ============================================================
function buildCaptionsJs(lines, target) {
  const wordsPath = path.join(target, "assets", "vo", "words.json");
  if (!fs.existsSync(wordsPath)) {
    fail(
      `Không thấy ${wordsPath} — caption karaoke cần word boundary từ Edge TTS.\n` +
        "Đặt TTS_PROVIDER=edge trong .env (repo root) rồi chạy lại.",
    );
  }
  const words = JSON.parse(fs.readFileSync(wordsPath, "utf8"));
  return lines
    .map((l) => {
      const w = words[l.id];
      if (!Array.isArray(w) || w.length === 0) {
        fail(`words.json thiếu hoặc rỗng cho "${l.id}" — kiểm tra lại generate-vo.mjs.`);
      }
      const pairs = w.map((x) => `[${JSON.stringify(String(x.t))},${round3(x.s)}]`).join(",");
      return `        ${l.n}: [${pairs}],`;
    })
    .join("\n");
}

// ============================================================
// Timing — công thức gap của script-and-timing.md, áp cho N dòng linh hoạt
// ============================================================
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function computeTiming(lines, durations) {
  const timing = [];
  let start = START_1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dur = durations[line.id];
    if (dur == null) fail(`Thiếu duration cho "${line.id}" trong assets/vo/durations.json.`);
    if (i > 0) {
      start = timing[i - 1].start + timing[i - 1].dur + GAP_FLAT;
    }
    timing.push({ start: round3(start), dur });
  }
  const last = timing[timing.length - 1];
  const ROOT_DURATION = Math.round((last.start + last.dur + OUTRO_HOLD) * 10) / 10;
  return { timing, ROOT_DURATION };
}

// ============================================================
// Sinh khối JS timeline: pose swap + card active-emphasis theo từng beat.
// (Nhãn 2 khái niệm cố định; text theo beat do caption karaoke lo — xem
//  buildCaptionsJs + template.)
// ============================================================
function buildTimelineBeatsJs(lines) {
  const chunks = [];
  const BEAT_TITLE = {
    hook: "HOOK",
    question: "QUESTION",
    body: `BODY (${lines.filter((l) => l.beat === "body").length} điểm so sánh, từ Gemini)`,
    payoff: "PAYOFF",
  };

  chunks.push(
    "      // Pose set: khung vuông cố định, không transform per-pose — xem",
    "      // .host-avatar-img + const POSE_ADJUST trong index.html.",
    `      tl.set("#host-img", poseFor("${lines[0].pose}"), 0);`,
    "",
  );

  let lastBeat = null;
  let lastFocus = null;
  lines.forEach((line, i) => {
    if (line.beat !== lastBeat) {
      if (i > 0) chunks.push("");
      chunks.push(`      // ---------- BEAT: ${BEAT_TITLE[line.beat]} ----------`);
      lastBeat = line.beat;
    }
    const at = `VO[${line.n}].start`;
    chunks.push(`      changePose("${line.pose}", ${at});`);

    if (line.side !== lastFocus) {
      chunks.push(`      focus("${line.side}", ${at});`);
      lastFocus = line.side;
    }

    if (line.beat === "payoff") {
      chunks.push(
        `      tl.fromTo("#avatar-host", { scale: 1 }, { scale: 1.03, duration: 0.3, ease: "power2.out", yoyo: true, repeat: 1 }, ${at});`,
      );
    }
    chunks.push("");
  });

  return chunks.join("\n").replace(/\n+$/, "");
}

// ============================================================
// Ghi index.html từ templates/auto-compare/index.html
// ============================================================
function buildIndexHtml(target, content, lines, timingResult, cardExts) {
  const templatePath = path.join(REPO_ROOT, "templates", "auto-compare", "index.html");
  let html = fs.readFileSync(templatePath, "utf8");

  const docTitle = escapeHtml(`So sánh — ${content.label_left} vs ${content.label_right}`);
  const eLabelLeft = escapeHtml(content.label_left);
  const eLabelRight = escapeHtml(content.label_right);

  const captionsJs = buildCaptionsJs(lines, target);

  const audioTagsHtml = lines
    .map((l, i) => {
      const t = timingResult.timing[i];
      return `      <audio id="vo-${l.n}" src="assets/vo/${l.id}.mp3" data-start="${t.start}" data-duration="${t.dur}" data-track-index="20"></audio>`;
    })
    .join("\n");

  const voObjectJs = lines
    .map((l, i) => {
      const t = timingResult.timing[i];
      return `        ${l.n}: { start: ${t.start}, dur: ${t.dur} },`;
    })
    .join("\n");

  const timelineBeatsJs = buildTimelineBeatsJs(lines);

  html = html
    .replace(/__DOC_TITLE__/g, docTitle)
    .replace(/__LABEL_LEFT__/g, eLabelLeft)
    .replace(/__LABEL_RIGHT__/g, eLabelRight)
    .replace(/__CARD_LEFT_SRC__/g, `assets/images/card-left${cardExts.left}`)
    .replace(/__CARD_RIGHT_SRC__/g, `assets/images/card-right${cardExts.right}`)
    .replace(/__AVATAR_INITIAL_SRC__/g, `assets/actions/${lines[0].pose}.svg`)
    .replace(/__ROOT_DURATION__/g, String(timingResult.ROOT_DURATION))
    .replace(/__DEFAULT_EYEBROW__/g, "SO SÁNH KIẾN THỨC")
    .replace("<!--AUDIO_TAGS-->", audioTagsHtml)
    .replace("/*CAPTIONS_OBJECT*/", captionsJs)
    .replace("/*VO_OBJECT*/", voObjectJs)
    .replace("/*TIMELINE_BEATS*/", timelineBeatsJs);

  const leftover = html.match(/__[A-Z_]+__|\/\*(?:CAPTIONS_OBJECT|VO_OBJECT|TIMELINE_BEATS)\*\/|<!--AUDIO_TAGS-->/);
  if (leftover) fail(`Template còn placeholder chưa thay: ${leftover[0]} — kiểm tra templates/auto-compare/index.html.`);

  fs.writeFileSync(path.join(target, "index.html"), html);
}

// ============================================================
// Copy assets
// ============================================================
function copyCardImages(target, leftPath, rightPath) {
  const leftExt = path.extname(leftPath).toLowerCase() || ".jpg";
  const rightExt = path.extname(rightPath).toLowerCase() || ".jpg";
  const imgDir = path.join(target, "assets", "images");
  fs.mkdirSync(imgDir, { recursive: true });
  fs.copyFileSync(path.resolve(leftPath), path.join(imgDir, `card-left${leftExt}`));
  fs.copyFileSync(path.resolve(rightPath), path.join(imgDir, `card-right${rightExt}`));
  return { left: leftExt, right: rightExt };
}

function copyBackground(target) {
  const src = path.join(REPO_ROOT, "assets", "backgrounds", BACKGROUND_FILE);
  if (!fs.existsSync(src)) {
    fail(`Không tìm thấy ${src} — templates/auto-compare/index.html #root cần file này.`);
  }
  const dstDir = path.join(target, "assets", "backgrounds");
  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, path.join(dstDir, BACKGROUND_FILE));
}

function copyUsedActions(target, lines) {
  const srcDir = path.join(REPO_ROOT, "assets", "actions");
  const dstDir = path.join(target, "assets", "actions");
  fs.mkdirSync(dstDir, { recursive: true });
  const usedIds = [...new Set(lines.map((l) => l.pose))];
  for (const id of usedIds) {
    const file = `${id}.svg`;
    fs.copyFileSync(path.join(srcDir, file), path.join(dstDir, file));
  }
  fs.copyFileSync(path.join(srcDir, "actions.json"), path.join(dstDir, "actions.json"));
  return usedIds;
}

// ============================================================
// Scaffold cơ học — TÁI DÙNG script có sẵn của skill create-video, không viết lại
// (hyperframes init, un-nest, xoá CLAUDE.md/AGENTS.md, copy sync-channel.mjs +
// generate-vo.mjs từ project tham chiếu, wire package.json).
// ============================================================
function runScaffoldMjs(slug) {
  const scaffoldScript = path.join(REPO_ROOT, ".claude", "skills", "create-video", "scripts", "scaffold.mjs");
  if (!fs.existsSync(scaffoldScript)) {
    fail(`Không tìm thấy ${scaffoldScript} — cần script scaffold.mjs của skill create-video.`);
  }
  run(`node "${scaffoldScript}" ${slug}`, REPO_ROOT, "scaffold.mjs (create-video skill)");
}

// hyperframes check's default --timeout is 3000ms ("scripts and media settle"). Auto-compare
// videos load ~10 assets/actions/*.svg (raster-PNG-in-SVG with <mask>+feColorMatrix, 46-108KB
// each) plus 2 real card photos — measured: default timeout reliably fails with
// "Runtime.callFunctionOn timed out" (confirmed NOT a composition bug — the same page passes
// clean at --timeout=20000; videos/dev-vs-devops and videos/kim-cuong-vs-than-da, which load
// far fewer/no such assets, pass fine at the 3000ms default). Bake a longer timeout into this
// video's own `check` script so bare `npm run check` passes without extra flags.
function patchCheckTimeout(target) {
  const pkgPath = path.join(target, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (pkg.scripts?.check) {
    pkg.scripts.check = pkg.scripts.check.replace(
      /npx --yes hyperframes@([\d.]+) check$/,
      "npx --yes hyperframes@$1 check --timeout=20000",
    );
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

// The create-video scaffold copies a generic generate-vo.mjs (no word boundaries,
// no silence trim). Auto-compare needs the v2 one — word-boundary words.json for the
// karaoke caption + per-line trim so the flat GAP_FLAT timing lands right.
function overrideGenerateVo(target) {
  const src = path.join(REPO_ROOT, "templates", "auto-compare", "generate-vo.mjs");
  if (!fs.existsSync(src)) fail(`Không tìm thấy ${src} — cần bản generate-vo.mjs canonical cho auto-compare.`);
  fs.copyFileSync(src, path.join(target, "scripts", "generate-vo.mjs"));
}

// Raster-in-SVG poses can pop a frame under a multi-worker headless compositor
// (see assets/actions/actions.json). Bake --workers=1 into this video's render.
function patchRenderWorkers(target) {
  const pkgPath = path.join(target, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (pkg.scripts?.render && !/--workers=/.test(pkg.scripts.render)) {
    pkg.scripts.render = pkg.scripts.render.replace(
      /(npx --yes hyperframes@[\d.]+ render)/,
      "$1 --workers=1",
    );
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function patchGenerateVoLines(target, lines) {
  const voPath = path.join(target, "scripts", "generate-vo.mjs");
  const src = fs.readFileSync(voPath, "utf8");
  const entries = lines.map((l) => `  { id: "${l.id}", text: ${JSON.stringify(l.text)} },`).join("\n");
  const newBlock = `const LINES = [\n${entries}\n];`;
  const patched = src.replace(/const LINES = \[[\s\S]*?\n\];/, newBlock);
  if (patched === src) {
    fail(`Không tìm thấy khối "const LINES = [...]" trong ${voPath} để thay thế.`);
  }
  fs.writeFileSync(voPath, patched);
}

function writeBrief(target, content, sourceImages, corrections) {
  const pointsMd = content.points.map((p, i) => `${i + 1}. ${p.text} _(pose: \`${p.suggested_action}\`)_`).join("\n");
  const correctionsMd = corrections && corrections.length
    ? `\n## Điều chỉnh gate trang sức\n\n${corrections.length} suggested_action đã bị hạ cấp lúc sinh content vì chủ đề không phải trang sức/đá quý:\n\n${corrections.map((c) => `- "${c.point}": \`${c.from}\` → \`${c.to}\``).join("\n")}\n`
    : "";
  const md = `# Brief — ${content.label_left} vs ${content.label_right}

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi \`scripts/scaffold-compare-video.mjs\`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (\`scripts/generate-compare-content.mjs\`) — không phải viết tay theo skill \`create-video\`.
- **Chủ đề**: So sánh ${content.label_left} vs ${content.label_right}.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: ${content.title}
- **Sinh lúc**: ${new Date().toISOString()}

## Assets

- **Card trái**: ảnh thật, nguồn \`${sourceImages.left || "(không rõ — đã dùng --content, xem log lúc chạy)"}\`.
- **Card phải**: ảnh thật, nguồn \`${sourceImages.right || "(không rõ — đã dùng --content, xem log lúc chạy)"}\`.
- **Host avatar**: ảnh thật host "HuyK" (\`assets/actions/\`, xem \`actions.json\` cùng thư mục),
  đổi pose theo \`suggested_action\` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua \`scripts/generate-vo.mjs\` (provider theo \`.env\` root repo).

## Nội dung tự sinh (Gemini, body beat)

${pointsMd}
${correctionsMd}
## Notes

- Layout 3-zone dùng chung \`../../DESIGN.md\`. **Nhịp kịch bản riêng cho template
  auto-compare** — KHÔNG theo nhịp 12-dòng cố định của skill \`create-video\`:
  hook (2 dòng, tự sinh từ label) → question (1 dòng, = title Gemini) → body (N dòng =
  \`points\`, mỗi dòng 1 \`suggested_action\` Gemini chọn) → payoff (1 dòng, tự sinh, không
  qua Gemini — giữ deterministic).
- Body/question **không có** từ khoá tô màu \`.kw\` — schema Gemini hiện tại không sinh field
  "từ khoá cần nhấn mạnh", nên các dòng này hiển thị plain text. Hook/payoff có tô cyan tên
  2 khái niệm (tự sinh cố định, không qua Gemini).
- Card active-emphasis (dim bên không liên quan) theo field \`side\` của mỗi dòng
  (left / right / both). Pose chỉ tay: \`point-up-left\` (trái) / \`point-up-right\` (phải)
  — đây là 2 pose chỉ tay DUY NHẤT, tái dùng lại khi nhiều beat cùng hướng.
- Chưa render MP4 — mới chỉ qua \`npm run check\`.
`;
  fs.writeFileSync(path.join(target, "BRIEF.md"), md);
}

// ============================================================
// Main
// ============================================================
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let content, corrections, sourceImages;
  if (opts.contentPath) {
    console.log(`Dùng compare-content có sẵn: ${opts.contentPath} (bỏ qua gọi Gemini).`);
    const raw = JSON.parse(fs.readFileSync(opts.contentPath, "utf8"));
    content = raw;
    corrections = raw._meta?.corrections || [];
    sourceImages = raw._meta?.source_images || {};
  } else {
    console.log("Gọi Gemini (generate-compare-content.mjs) để sinh nội dung từ 2 ảnh...");
    const result = await runCompareContent({ left: opts.left, right: opts.right, topicHint: opts.topicHint });
    content = result.content;
    corrections = result.corrections;
    sourceImages = result.source_images;
  }

  const catalog = loadActionCatalog();
  backfillPointFields(content, catalog.allIds);
  validateContent(content, catalog);

  const slug = opts.slug || genUniqueSlug(content.label_left, content.label_right);
  const target = path.join(REPO_ROOT, "videos", slug);
  if (fs.existsSync(target)) {
    fail(`videos/${slug}/ đã tồn tại — chọn --slug khác. Script này KHÔNG được ghi đè video có sẵn.`);
  }

  console.log(`\nSlug: ${slug}`);
  console.log(`Chủ đề: ${content.label_left} vs ${content.label_right}`);
  console.log(`Points: ${content.points.length}${corrections.length ? ` (${corrections.length} action đã bị hạ cấp jewelry-gate)` : ""}`);

  // 1. scaffold cơ học (hyperframes init + wiring), tái dùng script có sẵn
  runScaffoldMjs(slug);
  patchCheckTimeout(target);
  overrideGenerateVo(target);
  patchRenderWorkers(target);

  // 2. copy 2 ảnh gốc vào card + backdrop #root dùng chung
  const cardExts = copyCardImages(target, opts.left, opts.right);
  copyBackground(target);

  // 3. dựng danh sách dòng thoại + pose
  const lines = buildLines(content);

  // 4. copy action SVG thực sự dùng tới + actions.json tham chiếu
  const usedActions = copyUsedActions(target, lines);
  console.log(`Action dùng: ${usedActions.join(", ")}`);

  // 5. patch LINES trong generate-vo.mjs đã copy sẵn
  patchGenerateVoLines(target, lines);

  // 5b. Ghi .env cục bộ cho video nếu truyền ttsProvider / vieneuVoice
  const localEnvLines = [];
  if (opts.ttsProvider) localEnvLines.push(`TTS_PROVIDER=${opts.ttsProvider}`);
  if (opts.vieneuVoice) localEnvLines.push(`VIENEU_VOICE=${opts.vieneuVoice}`);
  if (localEnvLines.length) {
    fs.writeFileSync(path.join(target, ".env"), localEnvLines.join("\n") + "\n");
  }

  // 6. cài dependency (edge-tts-universal) rồi sinh VO thật
  // --ignore-scripts: bare `npm install` here must NOT run the project's lifecycle hooks —
  // npm treats the (deprecated) "prepublish" script as an alias of "prepare" and fires it on
  // plain install, which runs sync-channel.mjs against index.html — but index.html is still
  // hyperframes init's blank example at this point (ours isn't written until step 8, after
  // real VO timing exists), so sync-channel.mjs's "#eyebrow not found" check throws. None of
  // dev/check/render/publish are being invoked here, so skipping hooks is safe and correct.
  run("npm install --ignore-scripts", target, "npm install");
  run("node scripts/generate-vo.mjs", target, "generate-vo.mjs");

  // 7. đọc durations thật, tính timing
  const durationsPath = path.join(target, "assets", "vo", "durations.json");
  if (!fs.existsSync(durationsPath)) fail(`Không thấy ${durationsPath} sau khi chạy generate-vo.mjs.`);
  const durations = JSON.parse(fs.readFileSync(durationsPath, "utf8"));
  const timingResult = computeTiming(lines, durations);
  console.log(`ROOT_DURATION: ${timingResult.ROOT_DURATION}s`);

  // 8. dựng index.html từ template
  buildIndexHtml(target, content, lines, timingResult, cardExts);

  // 9. BRIEF.md
  writeBrief(target, content, sourceImages, corrections);

  // 10. check
  if (!opts.skipCheck) {
    run("npm run check", target, "npm run check");
  } else {
    console.log("\n(--skip-check) Bỏ qua npm run check — chạy tay: cd " + `videos/${slug} && npm run check`);
  }

  console.log(`\n✔ videos/${slug}/ đã dựng xong.`);
  console.log(`  Render thử: cd videos/${slug} && npm run render`);
}

main().catch((err) => {
  console.error(`\nTHẤT BẠI: ${err.message}`);
  process.exitCode = 1;
});
