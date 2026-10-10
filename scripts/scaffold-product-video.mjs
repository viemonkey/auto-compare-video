#!/usr/bin/env node
// Chế độ "Giới thiệu sản phẩm" — orchestrator dựng videos/<slug>/ theo khâu (cùng khung khâu với scaffold-compare-video.mjs để dùng lại build job):
//   voice  : scaffold HyperFrames + sinh giọng HuyK (TTS theo thị trường)
//   timing : tính nhịp từ độ dài từng câu
//   scene  : tách nền sản phẩm, ghép âm thanh (giọng + SFX + nhạc, -14 LUFS), dựng index.html (GSAP, phụ đề từng từ)
// Render + check do server chạy (npm run render / check) như video so sánh.
//
//   node scripts/scaffold-product-video.mjs --project <id> --slug <slug> --stage voice|timing|scene [--resume] [--tts-provider x] [--tts-voice y] [--vieneu-voice z]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLocale } from "./lib/locales.mjs";
import { checkRenderability } from "./lib/capabilities.mjs";
import { copyFontsToVideo, familiesOfLocale } from "./lib/fonts.mjs";
import { npmCommand } from "./lib/npm-cmd.mjs";
import { loadProductConfig } from "./lib/product/config.mjs";
import { createProductStore } from "./lib/product/store.mjs";
import { run, runScaffoldMjs, patchPackageScripts, overrideFromTemplates, patchGenerateVoLines, planCaptions, copyUsedPoses } from "./lib/product/scaffold-steps.mjs";
import { computeProductTiming, buildProductIndexHtml, sceneWindows } from "./lib/product/compose-product.mjs";
import { prepareSceneAssets } from "./lib/product/scene-assets.mjs";
import { loadAudioManifest, pickBgm, mixAudio } from "./lib/product/audio-mix.mjs";
import { usesAiImages } from "./lib/product/ai-flag.mjs";
import { CLIP_FILE } from "./lib/product/clip-flow.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.PRODUCT_DATA_DIR || path.join(REPO_ROOT, "data");

function parseArgs(argv) {
  const o = { project: null, slug: null, stage: null, resume: false, ttsProvider: null, ttsVoice: null, vieneuVoice: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") o.project = argv[++i];
    else if (a === "--slug") o.slug = argv[++i];
    else if (a === "--stage") o.stage = argv[++i];
    else if (a === "--resume") o.resume = true;
    else if (a === "--tts-provider") o.ttsProvider = argv[++i];
    else if (a === "--tts-voice") o.ttsVoice = argv[++i];
    else if (a === "--vieneu-voice") o.vieneuVoice = argv[++i];
    else throw new Error(`Cờ không nhận diện được: ${a}`);
  }
  if (!o.project || !o.slug) throw new Error("Cần --project <id> và --slug <slug>.");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.slug)) throw new Error(`--slug "${o.slug}" không hợp lệ.`);
  if (!["voice", "timing", "scene"].includes(o.stage)) throw new Error('--stage phải là voice | timing | scene.');
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = loadProductConfig();
  const store = createProductStore({ dir: path.join(DATA_DIR, "products") });
  const project = store.read(opts.project);
  if (!project?.script?.lines?.length) throw new Error("Dự án chưa có kịch bản.");
  const locale = resolveLocale(project.locale);
  const renderability = checkRenderability(locale);
  if (!renderability.renderable) throw new Error(`Thị trường ${locale.displayName} chưa dựng được video: ${renderability.blockers.map((b) => b.message).join(" ")}`);
  const target = path.join(REPO_ROOT, "videos", opts.slug);
  const buildDir = path.join(target, ".build");
  const planPath = path.join(buildDir, "plan.json");
  const timingPath = path.join(buildDir, "timing.json");
  const lines = project.script.lines.map((l) => ({ id: `line-${l.n}`, n: l.n, beat: l.beat, text: l.text }));

  console.log(`\n▶ KHÂU ${opts.stage.toUpperCase()} — ${opts.slug} (${lines.length} câu, ${project.scenes.length} cảnh, thị trường ${locale.code})`);
  if (opts.stage === "voice") {
    if (opts.resume && fs.existsSync(planPath)) {
      console.log("ℹ Dùng lại scaffold đã có; chỉ sinh lại giọng.");
    } else {
      if (fs.existsSync(target)) throw new Error(`videos/${opts.slug}/ đã tồn tại nhưng chưa có checkpoint — hãy “Dựng lại từ đầu”.`);
      runScaffoldMjs(opts.slug);
      patchPackageScripts(target);
      overrideFromTemplates(target);
      const fonts = copyFontsToVideo(target, familiesOfLocale(locale));
      console.log(`Font (local, OFL): ${fonts.filter((f) => f.endsWith(".woff2")).join(", ")}`);
      patchGenerateVoLines(target, lines);
      const env = [`VIDEO_LOCALE=${locale.code}`];
      if (opts.ttsProvider) env.push(`TTS_PROVIDER=${opts.ttsProvider}`);
      if (opts.vieneuVoice) env.push(`VIENEU_VOICE=${opts.vieneuVoice}`);
      if (opts.ttsVoice) env.push(`TTS_VOICE=${opts.ttsVoice}`);
      fs.writeFileSync(path.join(target, ".env"), `${env.join("\n")}\n`);
      fs.mkdirSync(buildDir, { recursive: true });
      fs.writeFileSync(planPath, `${JSON.stringify({ version: 1, kind: "product", slug: opts.slug, projectId: project.id, localeCode: locale.code, lines }, null, 2)}\n`);
    }
    if (!fs.existsSync(path.join(target, "node_modules"))) {
      const npmInstall = npmCommand("npm", ["install", "--ignore-scripts"]);
      run(npmInstall.command, npmInstall.args, target, "npm install");
    }
    run(process.execPath, ["scripts/generate-vo.mjs"], target, "generate-vo.mjs");
    console.log("✔ Khâu sinh giọng hoàn tất.");
  } else if (opts.stage === "timing") {
    if (!fs.existsSync(planPath)) throw new Error(`Project chưa xong khâu sinh giọng (thiếu ${planPath}).`);
    const durationsPath = path.join(target, "assets", "vo", "durations.json");
    if (!fs.existsSync(durationsPath)) throw new Error(`Không thấy ${durationsPath}; hãy thử lại từ khâu sinh giọng.`);
    const result = computeProductTiming(lines, JSON.parse(fs.readFileSync(durationsPath, "utf8")), config);
    fs.writeFileSync(timingPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`ROOT_DURATION: ${result.ROOT_DURATION}s`);
    const [lo, hi] = config.script.targetSeconds;
    if (result.ROOT_DURATION < lo - 1 || result.ROOT_DURATION > hi + 3) console.warn(`⚠ Video dài ${result.ROOT_DURATION}s, ngoài khoảng ${lo}–${hi}s dự kiến — kiểm tra lại độ dài lời thoại.`);
    console.log("✔ Khâu tính nhịp hoàn tất.");
  } else {
    if (!fs.existsSync(timingPath)) throw new Error(`Project chưa xong khâu tính nhịp (thiếu ${timingPath}).`);
    const timing = JSON.parse(fs.readFileSync(timingPath, "utf8"));
    const wordsPath = path.join(target, "assets", "vo", "words.json");
    if (!fs.existsSync(wordsPath)) throw new Error(`Không thấy ${wordsPath} — phụ đề từng từ cần word boundary của TTS.`);
    const words = JSON.parse(fs.readFileSync(wordsPath, "utf8"));
    for (const l of lines) if (!Array.isArray(words[l.id]) || !words[l.id].length) throw new Error(`words.json thiếu "${l.id}" — kiểm tra lại generate-vo.mjs.`);

    const textPlan = await planCaptions(lines, words, locale);
    console.log(`Chữ vừa khung: đo bằng ${textPlan.measuredBy === "chrome" ? "Chrome + font thật" : "ƯỚC LƯỢNG (không có Chrome)"}.`);
    if (!textPlan.ok) throw new Error(`Chữ không vừa khung, không dựng để tránh tràn chữ:\n${textPlan.issues.map((i) => `  - ${i.where}: ${i.message}`).join("\n")}`);

    const assets = await prepareSceneAssets({ project, store, targetDir: target, config });
    console.log(`Pose HuyK: ${copyUsedPoses(target, project.scenes).join(", ") || "(không dùng)"}`);
    console.log(`Ảnh: ${Object.keys(assets.products).length} ảnh sản phẩm tách nền, ${Object.keys(assets.photos).length} ảnh cảnh có HuyK.`);

    let clip = null;
    if (project.clip?.status === "ok" && project.clip.file && fs.existsSync(store.fileAbs(project.id, project.clip.file))) {
      fs.mkdirSync(path.join(target, "assets", "video"), { recursive: true });
      fs.copyFileSync(store.fileAbs(project.id, project.clip.file), path.join(target, "assets", "video", CLIP_FILE));
      clip = { file: `assets/video/${CLIP_FILE}`, seconds: project.clip.seconds };
      console.log(`Clip AI cảnh mở đầu: ${project.clip.seconds}s (${project.clip.model}).`);
    } else if (project.settings?.aiClip) console.log(`ℹ Clip AI không dùng (${project.clip?.note || "chưa tạo"}) — cảnh mở đầu dùng hiệu ứng GSAP.`);

    // âm thanh: giọng từng câu + whoosh khi cắt cảnh + lấp lánh + nhạc nền (nếu có giấy phép) -> 1 file, -14 LUFS
    const manifest = loadAudioManifest(config);
    for (const w of manifest.warnings) console.warn(`⚠ ${w}`);
    const wins = sceneWindows(timing.timing, timing.ROOT_DURATION);
    const cues = [];
    project.scenes.forEach((s, i) => {
      if (manifest.sfx.whoosh && i > 0) cues.push({ file: manifest.sfx.whoosh.abs, at: wins[i].at, gainDb: config.audio.sfxVolumeDb });
      if (manifest.sfx.sparkle && ["macro", "hero", "pose", "photo"].includes(s.kind) && !(clip && i === 0)) cues.push({ file: manifest.sfx.sparkle.abs, at: wins[i].at + 0.35, gainDb: config.audio.sfxVolumeDb - 4 });
    });
    const bgm = pickBgm(manifest, process.env.PRODUCT_BGM || "");
    console.log(bgm ? `Nhạc nền: ${bgm.title || bgm.id} (${bgm.license})` : "Nhạc nền: không có (assets/audio/bgm trống) — chỉ giọng + hiệu ứng.");
    const mix = await mixAudio({ voices: lines.map((l, i) => ({ file: path.join(target, "assets", "vo", `${l.id}.mp3`), startSec: timing.timing[i].start })), cues, bgm: bgm ? { file: bgm.abs } : null, duration: timing.ROOT_DURATION, outFile: path.join(target, "assets", "audio", "mix.mp3"), config });
    console.log(`Âm thanh đã ghép: ${mix.outputI ?? "?"} LUFS (đích ${config.audio.targetLufs}).`);

    const info = await buildProductIndexHtml({ target, project, locale, lines, timing, words, textPlan, assets, clip, audio: { file: "assets/audio/mix.mp3" }, config });
    const aiGenerated = usesAiImages(project);
    fs.writeFileSync(path.join(target, "BRIEF.md"), `# Brief — ${project.displayName}\n\n- Video giới thiệu sản phẩm tự động (HuyK), thị trường ${locale.code}.\n- Nguồn ảnh: ${project.settings.imageSource}; clip AI: ${clip ? "có" : "không"}.\n- ai_generated: ${aiGenerated}\n- Từ khoá phụ đề: ${info.keywords.join(", ")}\n`);
    fs.writeFileSync(path.join(buildDir, "product-meta.json"), `${JSON.stringify({ ai_generated: aiGenerated, clip: !!clip, scenes: info.scenes.length, rootDuration: timing.ROOT_DURATION }, null, 2)}\n`);
    console.log(`✔ Khâu dựng cảnh hoàn tất (${info.scenes.length} cảnh, ${timing.ROOT_DURATION}s, ai_generated=${aiGenerated}).`);
  }
}

main().catch((err) => {
  console.error(`\nTHẤT BẠI: ${err.message}`);
  process.exitCode = 1;
});
