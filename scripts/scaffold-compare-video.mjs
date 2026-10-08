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
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCompareContent, loadActionCatalog, enforceContextImageLimits } from "./generate-compare-content.mjs";
import { generateContextImage } from "./generate-context-image.mjs";
import { renameCostLedgerSlug } from "./lib/cost-ledger.mjs";
import { npmCommand } from "./lib/npm-cmd.mjs";
import { stripDiacritics, slugify } from "./lib/slug.mjs";
import { resolveLocale } from "./lib/locales.mjs";
import { baseSlugFromContent, slugForLocale } from "./lib/market-slug.mjs";
import { checkRenderability } from "./lib/capabilities.mjs";
import { copyFontsToVideo, familiesOfLocale } from "./lib/fonts.mjs";
import { planVideoText } from "./lib/fit-check.mjs";
import { buildLines, computeTiming, buildIndexHtml } from "./lib/compose.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ---------- nhịp kịch bản cố định cho template này (xem DESIGN.md § Rhythm — auto-compare
// variant): hook(2, tự sinh) -> question(1, = title Gemini) -> body(N, = points Gemini) ->
// payoff(1, tự sinh). Không dùng nhịp 12-dòng cố định của skill create-video. ----------
 // use_case: "xác nhận câu trả lời đúng / khen ngợi"

// #root backdrop (2026-09-07, was marble-jewelry-stand.png) —
// templates/auto-compare/index.html references this filename directly; each
// scaffolded video needs its own local copy (same pattern as assets/actions/*.svg
// below), so keep this in sync with the template's CSS.
const BACKGROUND_FILE = "paper-crumpled.webp";



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
  const opts = { slug: null, contentPath: null, topicHint: null, skipCheck: false, ttsProvider: null, vieneuVoice: null, edgeVoice: null, ttsVoice: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--slug") opts.slug = argv[++i];
    else if (a === "--content") opts.contentPath = argv[++i];
    else if (a === "--topic-hint") opts.topicHint = argv[++i];
    else if (a === "--skip-check") opts.skipCheck = true;
    else if (a === "--tts-provider") opts.ttsProvider = argv[++i];
    else if (a === "--vieneu-voice") opts.vieneuVoice = argv[++i];
    else if (a === "--edge-voice") opts.edgeVoice = argv[++i];
    else if (a === "--tts-voice") opts.ttsVoice = argv[++i];
    else if (!a.startsWith("--")) positional.push(a);
    else fail(`Cờ không nhận diện được: ${a}`);
  }
  if (positional.length !== 2) {
    fail(
      "Usage: node scripts/scaffold-compare-video.mjs <left-image> <right-image> " +
        "[--slug <name>] [--content <path>] [--topic-hint <text>] [--skip-check] [--tts-provider <name>] [--vieneu-voice <voice_or_path>] [--edge-voice <voice>] [--tts-voice <voice>]",
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
// videos/<slug>/ trùng tên -> thêm hậu tố số thứ tự thay vì báo lỗi dừng lại. Dùng cho cả
// slug tự sinh từ label (genUniqueSlug) LẪN slug người dùng/caller truyền qua --slug (xem
// chỗ gọi ở main()) — một lần dựng lại tình cờ trùng tên không đáng phải huỷ cả run.
function ensureUniqueSlugDir(baseSlug) {
  let slug = baseSlug;
  let n = 2;
  while (fs.existsSync(path.join(REPO_ROOT, "videos", slug))) {
    slug = `${baseSlug}-${n}`;
    n++;
  }
  return slug;
}

// Slug tự sinh từ nội dung: gốc "<trái>-vs-<phải>" (từ nghĩa tiếng Việt nếu là nội dung song ngữ — chữ Nhật/Thái sẽ ra slug rỗng) +
// hậu tố thị trường (thị trường mặc định không có hậu tố). Không sinh được -> dừng, bắt truyền --slug.
function genUniqueSlug(content) {
  const base = baseSlugFromContent(content);
  if (!base) fail("Không sinh được slug từ nhãn (toàn ký tự không phải a-z0-9) — truyền --slug <tên-kebab-case>.");
  return ensureUniqueSlugDir(slugForLocale(base, resolveLocale(content.locale)));
}


// command + args là mảng (không shell, không nối chuỗi) — npm/npx xem lib/npm-cmd.mjs.
function run(command, args, cwd, label) {
  console.log(`\n[${label}] ${command} ${args.join(" ")}  (cwd: ${cwd})`);
  const res = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (res.error) fail(`${label} không chạy được: ${res.error.message}`);
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

  // Chạy LẠI enforceContextImageLimits ở đây (không chỉ trong runCompareContent) vì content
  // có thể đến từ --content <path> — 1 file cũ/viết tay có thể thiếu hẳn field
  // needs_context_image/image_concept, hoặc có side đã được suy ra Ở TRÊN (side lúc này mới
  // chắc chắn hợp lệ). Hàm này tự coerce field thiếu về false/"" nên không phá content cũ.
  const { corrections: contextImageCorrections } = enforceContextImageLimits(content);
  if (contextImageCorrections.length) {
    console.warn(`\n⚠ Đã bỏ needs_context_image cho ${contextImageCorrections.length} point (giữ ảnh sản phẩm gốc):`);
    for (const c of contextImageCorrections) console.warn(`  - "${c.point}": ${c.reason}`);
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
// Caption karaoke (bản v2, 2026-09-04)
// ------------------------------------------------------------
// Nhãn 2 khái niệm giờ CỐ ĐỊNH phía trên 2 ảnh (#lb-fixed, chèn thẳng bằng
// __LABEL_LEFT__ / __LABEL_RIGHT__). Toàn bộ text theo từng beat do caption chạy
// word-by-word ở khe giữa ảnh và host đảm nhiệm. Nguồn timing: assets/vo/words.json
// (Edge TTS word boundary, do templates/auto-compare/generate-vo.mjs ghi ra).
// Sinh object CAPTIONS = { <n>: [[word, startSec], ...], ... } cho template.
// ============================================================
function readWords(lines, target) {
  const wordsPath = path.join(target, "assets", "vo", "words.json");
  if (!fs.existsSync(wordsPath)) {
    fail(
      `Không thấy ${wordsPath} — caption karaoke cần word boundary (Edge TTS) hoặc timing ước lượng của engine.\n` +
        "Đặt TTS_PROVIDER=edge trong .env (repo root) rồi chạy lại.",
    );
  }
  const words = JSON.parse(fs.readFileSync(wordsPath, "utf8"));
  for (const l of lines) {
    if (!Array.isArray(words[l.id]) || words[l.id].length === 0) {
      fail(`words.json thiếu hoặc rỗng cho "${l.id}" — kiểm tra lại generate-vo.mjs.`);
    }
  }
  return words;
}







// ============================================================
// Giai đoạn 1 — sinh ảnh minh hoạ ngữ cảnh (nếu point có needsContextImage=true) và ghi vào
// videos/<slug>/assets/images/context-<n>.<ext>. KHÔNG throw khi 1 ảnh lỗi — generateContextImage
// đã tự trả null + tự log cảnh báo; ở đây chỉ cần giữ contextImageFile=null để
// buildTimelineBeatsJs biết mà bỏ qua setCardImage, giữ nguyên ảnh sản phẩm gốc cho point đó.
// ============================================================
async function generateContextImages(target, lines, slug) {
  const candidates = lines.filter((l) => l.needsContextImage);
  // Log LUÔN chạy, kể cả 0 candidate — để phân biệt "hàm này không được gọi" (bug) với
  // "hàm được gọi nhưng không có point nào cần ảnh" (đúng thiết kế, do content.points không
  // có point nào needs_context_image=true sau enforceContextImageLimits — xem log ở
  // generate-compare-content.mjs để biết đó là do Gemini hay do bị cắt).
  console.log(`\n[generateContextImages] gọi với ${lines.length} dòng, ${candidates.length} dòng cần sinh ảnh minh hoạ.`);
  if (candidates.length === 0) {
    console.log("  (không có dòng nào needsContextImage=true — không gọi generateContextImage lần nào, giữ nguyên ảnh gốc cả video.)");
    return;
  }

  const imgDir = path.join(target, "assets", "images");
  for (const line of candidates) {
    const outBase = path.join(imgDir, `context-${line.n}`);
    console.log(`  → gọi generateContextImage cho point ${line.n} [${line.side}], concept: "${line.imageConcept}"`);
    const result = await generateContextImage({ concept: line.imageConcept, outBase, slug });
    console.log(`  ← point ${line.n} trả về: ${result ? result : "null"}`);
    if (result) {
      line.contextImageFile = path.basename(result);
      console.log(`  ✔ point ${line.n}: ${line.contextImageFile}`);
    } else {
      // generateContextImage đã tự console.warn lý do cụ thể — ở đây chỉ xác nhận fallback.
      console.log(`  ⚠ point ${line.n}: giữ ảnh sản phẩm gốc (xem cảnh báo ở trên).`);
    }
  }
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
  run(process.execPath, [scaffoldScript, slug], REPO_ROOT, "scaffold.mjs (create-video skill)");
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

function writeBrief(target, content, sourceImages, corrections, contextImageCorrections, lines) {
  const pointsMd = content.points.map((p, i) => `${i + 1}. ${p.text} _(pose: \`${p.suggested_action}\`)_`).join("\n");
  const correctionsMd = corrections && corrections.length
    ? `\n## Điều chỉnh gate trang sức\n\n${corrections.length} suggested_action đã bị hạ cấp lúc sinh content vì chủ đề không phải trang sức/đá quý:\n\n${corrections.map((c) => `- "${c.point}": \`${c.from}\` → \`${c.to}\``).join("\n")}\n`
    : "";
  const generatedImages = (lines || []).filter((l) => l.contextImageFile);
  const skippedContextImages = (lines || []).filter((l) => l.needsContextImage && !l.contextImageFile);
  const contextImageMd = generatedImages.length || (contextImageCorrections && contextImageCorrections.length) || skippedContextImages.length
    ? `\n## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)\n\n${
        generatedImages.length
          ? generatedImages.map((l) => `- point ${l.n} (card \`${l.side}\`): \`assets/images/${l.contextImageFile}\` — concept: "${l.imageConcept}"`).join("\n") + "\n"
          : "- Không có ảnh nào sinh thành công lần này.\n"
      }${
        skippedContextImages.length
          ? `\nSinh lỗi/fallback, giữ ảnh sản phẩm gốc (xem log lúc chạy):\n${skippedContextImages.map((l) => `- point ${l.n}: "${l.text}"`).join("\n")}\n`
          : ""
      }${
        contextImageCorrections && contextImageCorrections.length
          ? `\nBị code cắt bớt trước khi gọi API (giới hạn cứng — xem \`enforceContextImageLimits\`):\n${contextImageCorrections.map((c) => `- "${c.point}": ${c.reason}`).join("\n")}\n`
          : ""
      }`
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
${correctionsMd}${contextImageMd}
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

  let content, corrections, contextImageCorrections, sourceImages;
  // slug thật (khi không truyền --slug) chỉ tính được SAU khi có label_left/label_right từ
  // Gemini (xem genUniqueSlug() bên dưới) — nhưng dòng cost-ledger.jsonl cho lần gọi Gemini
  // phải ghi NGAY lúc gọi, trước khi biết slug đó. Dùng slug TẠM (placeholder) cho lần ghi
  // đầu tiên, rồi renameCostLedgerSlug() đổi lại thành slug thật ngay sau khi chốt xong, để
  // không còn dòng "slug": null mồ côi trong ledger (xem cost-ledger.mjs).
  let pendingContentSlug = null;
  if (opts.contentPath) {
    console.log(`Dùng compare-content có sẵn: ${opts.contentPath} (bỏ qua gọi Gemini).`);
    const raw = JSON.parse(fs.readFileSync(opts.contentPath, "utf8"));
    content = raw;
    corrections = raw._meta?.corrections || [];
    contextImageCorrections = raw._meta?.contextImageCorrections || [];
    sourceImages = raw._meta?.source_images || {};
  } else {
    console.log("Gọi Gemini (generate-compare-content.mjs) để sinh nội dung từ 2 ảnh...");
    pendingContentSlug = opts.slug || `_pending-${crypto.randomUUID()}`;
    const result = await runCompareContent({ left: opts.left, right: opts.right, topicHint: opts.topicHint, slug: pendingContentSlug });
    content = result.content;
    corrections = result.corrections;
    contextImageCorrections = result.contextImageCorrections;
    sourceImages = result.source_images;
  }

  // Thị trường của nội dung (thiếu = mặc định). Chưa đủ điều kiện dựng (giọng đọc / chữ / pipeline) -> dừng, không dựng hỏng.
  const contentLocale = resolveLocale(content.locale);
  const renderability = checkRenderability(contentLocale);
  if (!renderability.renderable) {
    fail(`Thị trường ${contentLocale.displayName} chưa dựng được video: ${renderability.blockers.map((b) => b.message).join(" ")}`);
  }

  const catalog = loadActionCatalog();
  backfillPointFields(content, catalog.allIds);
  validateContent(content, catalog);

  const requestedSlug = opts.slug || genUniqueSlug(content);
  const slug = opts.slug ? ensureUniqueSlugDir(requestedSlug) : requestedSlug;
  if (slug !== requestedSlug) {
    console.log(`ℹ videos/${requestedSlug}/ đã tồn tại — dùng "${slug}" thay thế.`);
  }
  if (pendingContentSlug && pendingContentSlug !== slug) {
    const renamed = renameCostLedgerSlug(pendingContentSlug, slug);
    if (renamed > 0) {
      console.log(`ℹ Đã đổi ${renamed} dòng cost-ledger từ slug tạm "${pendingContentSlug}" sang "${slug}".`);
    }
  }
  const target = path.join(REPO_ROOT, "videos", slug);

  console.log(`\nSlug: ${slug}`);
  console.log(`Chủ đề: ${content.label_left} vs ${content.label_right}`);
  console.log(`Points: ${content.points.length}${corrections.length ? ` (${corrections.length} action đã bị hạ cấp jewelry-gate)` : ""}`);
  const contextImageWanted = content.points.filter((p) => p.needs_context_image).length;
  console.log(`Ảnh minh hoạ ngữ cảnh cần sinh: ${contextImageWanted}${contextImageCorrections.length ? ` (đã cắt bớt ${contextImageCorrections.length} theo giới hạn cứng)` : ""}`);

  // 1. scaffold cơ học (hyperframes init + wiring), tái dùng script có sẵn
  runScaffoldMjs(slug);
  patchCheckTimeout(target);
  overrideGenerateVo(target);
  patchRenderWorkers(target);

  // 2. copy 2 ảnh gốc vào card + backdrop #root dùng chung
  const cardExts = copyCardImages(target, opts.left, opts.right);
  copyBackground(target);
  const copiedFonts = copyFontsToVideo(target, familiesOfLocale(contentLocale));
  console.log(`Font (local, OFL): ${copiedFonts.filter((f) => f.endsWith(".woff2")).join(", ")}`);

  // 3. dựng danh sách dòng thoại + pose
  const lines = buildLines(content, contentLocale);

  // 3b. Giai đoạn 1 — sinh ảnh minh hoạ ngữ cảnh cho point nào cần (tối đa MAX_CONTEXT_IMAGES/
  // video, đã ép ở enforceContextImageLimits). Lỗi ở đây KHÔNG chặn build — line.contextImageFile
  // ở lại null.
  console.log("\n▶ Bước 3b: generateContextImages() ...");
  await generateContextImages(target, lines, slug);

  // 4. copy action SVG thực sự dùng tới + actions.json tham chiếu
  const usedActions = copyUsedActions(target, lines);
  console.log(`Action dùng: ${usedActions.join(", ")}`);

  // 5. patch LINES trong generate-vo.mjs đã copy sẵn
  patchGenerateVoLines(target, lines);

  // 5b. Ghi .env cục bộ cho video nếu truyền ttsProvider / vieneuVoice
  // VIDEO_LOCALE luôn được ghi: generate-vo.mjs dựa vào đó để chọn giọng/ngôn ngữ (không phụ thuộc DEFAULT_LOCALE của máy).
  const localEnvLines = [`VIDEO_LOCALE=${contentLocale.code}`];
  if (opts.ttsProvider) localEnvLines.push(`TTS_PROVIDER=${opts.ttsProvider}`);
  if (opts.vieneuVoice) localEnvLines.push(`VIENEU_VOICE=${opts.vieneuVoice}`);
  if (opts.edgeVoice) localEnvLines.push(`EDGE_VOICE=${opts.edgeVoice}`);
  if (opts.ttsVoice) localEnvLines.push(`TTS_VOICE=${opts.ttsVoice}`);
  fs.writeFileSync(path.join(target, ".env"), localEnvLines.join("\n") + "\n");

  // 6. cài dependency (edge-tts-universal) rồi sinh VO thật
  // --ignore-scripts: bare `npm install` here must NOT run the project's lifecycle hooks —
  // npm treats the (deprecated) "prepublish" script as an alias of "prepare" and fires it on
  // plain install, which runs sync-channel.mjs against index.html — but index.html is still
  // hyperframes init's blank example at this point (ours isn't written until step 8, after
  // real VO timing exists), so sync-channel.mjs's "#eyebrow not found" check throws. None of
  // dev/check/render/publish are being invoked here, so skipping hooks is safe and correct.
  const npmInstall = npmCommand("npm", ["install", "--ignore-scripts"]);
  run(npmInstall.command, npmInstall.args, target, "npm install");
  run(process.execPath, ["scripts/generate-vo.mjs"], target, "generate-vo.mjs");

  // 7. đọc durations thật, tính timing
  const durationsPath = path.join(target, "assets", "vo", "durations.json");
  if (!fs.existsSync(durationsPath)) fail(`Không thấy ${durationsPath} sau khi chạy generate-vo.mjs.`);
  const durations = JSON.parse(fs.readFileSync(durationsPath, "utf8"));
  const timingResult = computeTiming(lines, durations);
  console.log(`ROOT_DURATION: ${timingResult.ROOT_DURATION}s`);

  // 8. kế hoạch chữ (nhãn + cụm caption) đo bằng font thật, rồi dựng index.html từ template
  const words = readWords(lines, target);
  const textPlan = await planVideoText(
    {
      left: content.label_left,
      right: content.label_right,
      lines: lines.map((l) => ({ n: l.n, tokens: words[l.id].map((w) => String(w.t)) })),
    },
    contentLocale,
  );
  console.log(`Chữ vừa khung: đo bằng ${textPlan.measuredBy === "chrome" ? "Chrome + font thật" : "ƯỚC LƯỢNG (không có Chrome)"}; nhãn ${textPlan.label.fontPx}px.`);
  if (!textPlan.ok) {
    fail(`Chữ không vừa khung, không dựng để tránh video bị tràn chữ:\n${textPlan.issues.map((i) => `  - ${i.where}: ${i.message}`).join("\n")}`);
  }
  buildIndexHtml(target, content, lines, timingResult, cardExts, contentLocale, words, textPlan);

  // 9. BRIEF.md
  writeBrief(target, content, sourceImages, corrections, contextImageCorrections, lines);

  // 10. check
  if (!opts.skipCheck) {
    const npmCheck = npmCommand("npm", ["run", "check"]);
    run(npmCheck.command, npmCheck.args, target, "npm run check");
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
