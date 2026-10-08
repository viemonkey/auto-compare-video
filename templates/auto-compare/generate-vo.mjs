// TTS generation for an auto-compare video's narration.
// (Canonical copy: templates/auto-compare/generate-vo.mjs — scaffold-compare-video.mjs
//  copies this over the create-video scaffold's generic generate-vo.mjs. LINES is
//  rewritten per-video by scaffold-compare-video.mjs.)
//
// Engines (config/tts-engines/*.json; chosen per market in config/locales/<code>.json → tts):
//   "edge"  — Microsoft Edge TTS (free, no key), via edge-tts-universal. Returns per-word boundaries.   ┐ shared pipeline
//   "azure" — Azure AI Speech REST (AZURE_SPEECH_KEY + AZURE_SPEECH_REGION). No boundaries → estimated. ┘ scripts/lib/tts/voiceover.mjs
//             (audio cache by hash, retry/backoff, automatic fallback between engines, cost-ledger rows)
//   "vieneu" / "vbee" — Vietnamese only; kept as the original code below (unchanged behaviour).
// Writes one mp3 per line to assets/vo/ (silence-trimmed to the first/last word
// boundary), plus assets/vo/durations.json and assets/vo/words.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..", "..");

const lib = (...p) => import(pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", ...p)).href);
// Thứ tự ưu tiên env: .env.example < .env gốc < process.env < .env riêng của video (xem scripts/lib/tts/env.mjs)
const { loadVideoEnv } = await lib("tts", "env.mjs");
const ENV = loadVideoEnv({ repoRoot: REPO_ROOT, videoRoot: ROOT });
const REQUESTED_PROVIDER = (ENV.TTS_PROVIDER || "").toLowerCase();

const { resolveLocale, defaultLocaleCode } = await lib("locales.mjs");
// Thị trường của video = VIDEO_LOCALE (scaffold ghi vào .env cục bộ của video), không có thì DEFAULT_LOCALE (process.env / .env gốc).
const LOCALE = resolveLocale(ENV.VIDEO_LOCALE || defaultLocaleCode());

const SPEED_RATE = 1.1;

// --- Vbee config (only required when TTS_PROVIDER=vbee) ---
const VBEE_APP_ID = ENV.VBEE_APP_ID;
const VBEE_ACCESS_TOKEN = ENV.VBEE_ACCESS_TOKEN;
const VOICE_CODE = ENV.VBEE_VOICE_CODE || "n_hanoi_male_protrainer_education_vc";

// --- VieNeu TTS config (only required when TTS_PROVIDER=vieneu) ---
const VIENEU_VOICE = ENV.VIENEU_VOICE || "Adam";

// vieneu/vbee chỉ đọc tiếng Việt: thị trường khác vi luôn đi đường Edge/Azure (kể cả khi .env gốc đang đặt TTS_PROVIDER=vieneu).
const LEGACY_PROVIDERS = ["vieneu", "vbee"];
const USE_LEGACY = LOCALE.language === "vi" && (REQUESTED_PROVIDER === "" || LEGACY_PROVIDERS.includes(REQUESTED_PROVIDER));
// Không đặt gì: giữ mặc định cũ của template (vbee) cho tiếng Việt.
const TTS_PROVIDER = USE_LEGACY ? REQUESTED_PROVIDER || "vbee" : REQUESTED_PROVIDER;

if (USE_LEGACY && TTS_PROVIDER === "vbee") {
  if (!VBEE_APP_ID || !VBEE_ACCESS_TOKEN) {
    throw new Error(
      "TTS_PROVIDER=vbee nhưng thiếu VBEE_APP_ID / VBEE_ACCESS_TOKEN trong .env.\n" +
        "Điền credentials Vbee, hoặc đổi TTS_PROVIDER=edge để dùng Edge TTS miễn phí.",
    );
  }
}

async function generateVieNeuSpeech(text, outPath) {
  // venv layout khác nhau giữa Windows (Scripts/python.exe) và Unix (bin/python).
  const isWindows = process.platform === "win32";
  const pythonBin = path.join(
    REPO_ROOT, "VieNeu-TTS", ".venv",
    isWindows ? "Scripts" : "bin",
    isWindows ? "python.exe" : "python",
  );
  const cliScript = path.join(REPO_ROOT, "VieNeu-TTS", "infer_cli.py");
  if (!fs.existsSync(pythonBin)) {
    throw new Error(
      "TTS_PROVIDER=vieneu nhưng chưa dựng môi trường Python cho VieNeu-TTS.\n" +
        "Chạy `npm run setup:vieneu` ở gốc repo, hoặc đổi TTS_PROVIDER=edge để dùng Edge TTS miễn phí.",
    );
  }
  await execFileAsync(pythonBin, [
    cliScript,
    "--text", text,
    "--out", outPath,
    "--voice", VIENEU_VOICE,
  ], {
    // infer_cli.py prints emoji (e.g. 🎤) to stdout/stderr. Python on Windows defaults
    // those streams to the console's legacy code page (cp1252), which can't encode them
    // and crashes with UnicodeEncodeError before any TTS work happens. Force UTF-8
    // regardless of the console's code page — harmless on Unix where it's already UTF-8.
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
}

// TTS input uses phonetic Vietnamese spelling ("Đép" / "Đép Ốp") so Vbee
// pronounces "Dev" / "DevOps" correctly — on-screen captions in index.html
// keep the real spelling "Dev" / "DevOps".
const LINES = [
  { id: "line-1", text: "Đây là Vàng vàng." },
  { id: "line-2", text: "Đây là Vàng trắng." },
  { id: "line-3", text: "Chọn nhẫn cưới: Vàng vàng truyền thống hay vàng trắng hiện đại?" },
  { id: "line-4", text: "Bạn đang phân vân chọn nhẫn cưới vàng vàng hay vàng trắng cho ngày trọng đại?" },
  { id: "line-5", text: "Vàng vàng còn có một ưu điểm đặc biệt: rất hợp làm nhẫn cưới truyền đời, gắn kết gia đình qua nhiều thế hệ." },
  { id: "line-6", text: "Còn vàng trắng có một điểm cộng lớn: giúp tôn sáng viên đá chính, khiến kim cương lấp lánh và nổi bật hơn hẳn." },
  { id: "line-7", text: "Vàng vàng mang sắc ấm cổ điển, tượng trưng cho sự thịnh vượng và bền vững." },
  { id: "line-8", text: "Vàng trắng mang vẻ đẹp hiện đại, thanh lịch và cực kỳ dễ phối đồ hàng ngày." },
  { id: "line-9", text: "Nhẫn vàng vàng rất bền màu, hầu như không bị phai hay đổi màu theo thời gian." },
  { id: "line-10", text: "Vàng trắng cần xi mạ lại lớp Rhodium sau vài năm để giữ độ sáng bóng như mới." },
  { id: "line-11", text: "Thích truyền thống chọn vàng vàng, chuộng hiện đại trẻ trung thì chốt ngay vàng trắng nhé!" },
  { id: "line-12", text: "Vàng vàng hay Vàng trắng — giờ thì bạn đã rõ rồi đấy!" },
];

// ---- timeline constants (matches the 2026-09-02 pacing fix) --------------
// TTS clips carry ~0.2s leading + ~0.8s trailing silence; the edge/azure pipeline trims them
// (scripts/lib/tts/voiceover.mjs: TRIM_LEAD / TRIM_TRAIL, relative to the first/last word boundary).
// Keep TL_START1 / TL_GAP / TL_OUTRO in sync with scripts/lib/compose.mjs (START_1 / GAP_FLAT / OUTRO_HOLD).
const TL_START1 = 0.55;        // first VO start (after the entrance animation)
const TL_GAP = 0.14;           // flat timeline gap. Word-boundary trim keeps
                               // a little more head/tail than the old envelope trim,
                               // so a smaller gap lands speech-to-speech at ~0.5s.
const TL_OUTRO = 1.2;          // hold after the last clip

async function ffprobeDuration(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ]);
  return parseFloat(stdout.trim());
}

// ============================================================
// Vbee TTS — REST API (giữ nguyên logic cũ)
// ============================================================

async function generateVbeeSpeech(text) {
  const res = await fetch("https://vbee.vn/api/v1/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VBEE_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      app_id: VBEE_APP_ID,
      input_text: text,
      voice_code: VOICE_CODE,
      audio_type: "mp3",
      speed_rate: SPEED_RATE,
      callback_url: "https://example.com/callback",
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (data.status !== 1) {
    throw new Error(`Vbee error: ${data.error_message || data.error_code}`);
  }
  if (data.result?.audio_link) return data.result.audio_link;
  const requestId = data.result?.request_id;
  if (!requestId) throw new Error("No request_id returned");
  return pollForAudio(requestId);
}

async function pollForAudio(requestId) {
  const url = `https://vbee.vn/api/v1/tts/${requestId}`;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VBEE_ACCESS_TOKEN}`,
      },
    });
    if (!res.ok) continue;
    const data = await res.json();
    if (data.status === 1) {
      if (data.result?.status === "SUCCESS" && data.result?.audio_link) {
        return data.result.audio_link;
      }
      if (data.result?.status === "FAILURE") {
        throw new Error("Vbee processing failed");
      }
    }
  }
  throw new Error("Timeout waiting for Vbee audio");
}

async function downloadAudio(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

// ============================================================
// vieneu / vbee (chỉ tiếng Việt) — vòng lặp gốc, không đổi
// ============================================================
async function mainLegacy() {
  console.log(`TTS provider: ${TTS_PROVIDER}${TTS_PROVIDER === "vieneu" ? ` (voice: ${VIENEU_VOICE})` : ""}`);
  const outDir = path.join(ROOT, "assets", "vo");
  const rawDir = path.join(outDir, ".raw");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const durations = {};
  const words = {};          // { "line-1": [{ t, s, d }] }  (s/d in seconds, relative to the clip)
  const isVieNeu = TTS_PROVIDER === "vieneu";
  if (!isVieNeu) {
    console.warn("\n⚠ TTS_PROVIDER != edge/vieneu — Vbee không trả word boundary.\n");
  }

  for (const line of LINES) {
    const rawPath = path.join(rawDir, `${line.id}.mp3`);
    const finalPath = path.join(outDir, `${line.id}.mp3`);
    process.stdout.write(`Generating ${line.id}: "${line.text}" ... `);

    if (isVieNeu) {
      await generateVieNeuSpeech(line.text, rawPath);
    } else {
      const audioUrl = await generateVbeeSpeech(line.text);
      await downloadAudio(audioUrl, rawPath);
    }
    fs.copyFileSync(rawPath, finalPath);

    const dur = await ffprobeDuration(finalPath);
    durations[line.id] = Math.round(dur * 1000) / 1000;

    if (isVieNeu) {
      // Estimate word boundaries for VieNeu so karaoke captions work smoothly
      const display = line.text.split(/\s+/).filter((tok) => /[\p{L}\p{N}]/u.test(tok));
      if (display.length) {
        const perWordDur = Math.round((dur / display.length) * 1000) / 1000;
        words[line.id] = display.map((t, idx) => ({
          t,
          s: Math.round(idx * perWordDur * 1000) / 1000,
          d: perWordDur,
        }));
      }
    }
    console.log(`${dur.toFixed(2)}s`);
  }

  fs.writeFileSync(path.join(outDir, "durations.json"), JSON.stringify(durations, null, 2));
  if (Object.keys(words).length) {
    fs.writeFileSync(path.join(outDir, "words.json"), JSON.stringify(words, null, 2));
  }
  printTimeline(durations, Object.keys(words).length > 0);
}

// ============================================================
// edge / azure — pipeline dùng chung (scripts/lib/tts)
// ============================================================
async function mainPipeline() {
  const { listEngines, engineReadiness } = await lib("capabilities.mjs");
  const { planEngines, resolveVoice, resolveSpeed } = await lib("tts", "select.mjs");
  const { runVoiceover } = await lib("tts", "voiceover.mjs");
  const { createTtsCache } = await lib("tts", "cache.mjs");
  const { compilePronunciation } = await lib("tts", "pronounce.mjs");
  const { audioTools } = await lib("tts", "audio-tools.mjs");
  const { appendCostEntry } = await lib("cost-ledger.mjs");
  const { calcTtsCost } = await import(pathToFileURL(path.join(REPO_ROOT, "config", "pricing.mjs")).href);

  const engineConfigs = listEngines();
  const readiness = (e) => engineReadiness(e, { env: ENV, repoRoot: REPO_ROOT });
  const { chain, notes } = planEngines({ locale: LOCALE, requested: REQUESTED_PROVIDER || undefined, engines: engineConfigs, readiness });
  for (const n of notes) console.log(`ℹ ${n}`);
  if (!chain.length) {
    throw new Error(`Không có engine giọng đọc nào dùng được cho ${LOCALE.displayName}. Edge TTS cần mạng; Azure cần AZURE_SPEECH_KEY + AZURE_SPEECH_REGION trong .env.`);
  }

  // Giọng ghi đè (TTS_VOICE từ UI / EDGE_VOICE cũ) chỉ áp cho engine được chọn rõ ràng và CHỈ khi đúng ngôn ngữ của video
  // (.env gốc có thể còn EDGE_VOICE=vi-VN-... — không được đem đọc tiếng Nhật).
  const langOk = (v) => typeof v === "string" && v.startsWith(`${LOCALE.language}-`);
  const overrideFor = (engineId) => {
    const raw = engineId === REQUESTED_PROVIDER || (!REQUESTED_PROVIDER && engineId === chain[0]) ? ENV.TTS_VOICE || (engineId === "edge" ? ENV.EDGE_VOICE : "") : "";
    if (raw && !langOk(raw)) {
      console.warn(`⚠ Bỏ qua giọng "${raw}" vì không phải giọng ${LOCALE.displayName} — dùng giọng mặc định trong config.`);
      return "";
    }
    return raw;
  };
  const voiceFor = (engineId) => resolveVoice({ engine: engineConfigs.find((e) => e.id === engineId), locale: LOCALE, override: overrideFor(engineId) });

  const engines = {};
  for (const id of chain) {
    if (id === "edge") {
      const { EdgeTTS } = await import("edge-tts-universal");
      const { createEdgeEngine } = await lib("tts", "edge.mjs");
      engines.edge = createEdgeEngine({ EdgeTTS });
    } else if (id === "azure") {
      const { createAzureEngine } = await lib("tts", "azure.mjs");
      engines.azure = createAzureEngine({ key: ENV.AZURE_SPEECH_KEY, region: ENV.AZURE_SPEECH_REGION });
    } else {
      throw new Error(`Engine "${id}" chưa có adapter trong scripts/lib/tts.`);
    }
  }

  console.log(`TTS: thị trường ${LOCALE.code}, thứ tự engine: ${chain.join(" → ")}`);
  const slug = path.basename(ROOT);
  const outDir = path.join(ROOT, "assets", "vo");
  const result = await runVoiceover({
    lines: LINES,
    locale: LOCALE,
    chain,
    engines,
    voiceFor,
    speed: resolveSpeed(LOCALE),
    // Bảng phát âm của thị trường (config/locales/<code>.json → tts.pronunciation): chỉ đổi chữ GỬI TTS, không đổi chữ hiện trên video. vi-VN không có bảng = giữ nguyên.
    pronounce: compilePronunciation(LOCALE.tts?.pronunciation),
    outDir,
    cache: createTtsCache(ENV.TTS_CACHE_DIR || undefined),
    tools: audioTools,
    ledger: appendCostEntry,
    costOf: (engineId, characters) => calcTtsCost(engineId, characters),
    slug,
    log: (m) => console.log(m),
    // Edge công khai thỉnh thoảng trả "No audio was received" rồi lại ổn khi thử lại — thử nhiều lần, lùi dần có trần.
    retry: { maxRetries: 8, baseMs: 1500, maxMs: 9000, jitterMs: 500 },
    pace: () => new Promise((r) => setTimeout(r, 400)),
  });
  console.log(`✔ Giọng đọc xong bằng "${result.engineId}" (${result.voice}): đọc mới ${result.stats.synthesized} dòng (${result.stats.characters} ký tự), dùng lại cache ${result.stats.cached} dòng.`);
  printTimeline(result.durations, true);
}

// ---- print the retimed HyperFrames timeline (paste into index.html) -------
function printTimeline(durations, hasWords) {
  const ids = LINES.map((l) => l.id);
  const starts = {};
  let cur = TL_START1;
  for (const id of ids) {
    starts[id] = Math.round(cur * 1000) / 1000;
    cur = Math.round((cur + durations[id] + TL_GAP) * 1000) / 1000;
  }
  const total = Math.round((cur - TL_GAP + TL_OUTRO) * 10) / 10;

  console.log("\n--- assets/vo written: durations.json" + (hasWords ? " + words.json" : "") + " ---");
  console.log("\n--- <audio> tags (paste into index.html) ---");
  ids.forEach((id, i) => {
    console.log(
      `      <audio id="vo-${i + 1}" src="assets/vo/${id}.mp3" data-start="${starts[id]}" ` +
      `data-duration="${durations[id]}" data-track-index="20"></audio>`,
    );
  });
  console.log("\n--- VO object ---");
  ids.forEach((id, i) => {
    console.log(`        ${i + 1}: { start: ${starts[id]}, dur: ${durations[id]} },`);
  });
  console.log(`\n--- ROOT_DURATION = ${total}  (data-duration on #root/#scene, both ROOT_DURATION consts, scrubber max, time-display) ---`);
}

(USE_LEGACY ? mainLegacy() : mainPipeline()).catch((err) => {
  console.error(err);
  process.exit(1);
});
