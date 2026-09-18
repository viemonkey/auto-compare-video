// TTS generation for an auto-compare video's narration.
// (Canonical copy: templates/auto-compare/generate-vo.mjs — scaffold-compare-video.mjs
//  copies this over the create-video scaffold's generic generate-vo.mjs. LINES is
//  rewritten per-video by scaffold-compare-video.mjs.)
// Supports two providers via TTS_PROVIDER in repo-root .env:
//   "edge" (default in .env.example) — Microsoft Edge TTS (free, no API key), via
//          edge-tts-universal. ALSO returns per-word boundaries → assets/vo/words.json,
//          which the running karaoke caption needs. Required for new videos.
//   "vbee" — Vbee TTS API (VBEE_APP_ID + VBEE_ACCESS_TOKEN). No word boundaries →
//          no words.json → captions fall back to nothing. Prefer edge.
// Writes one mp3 per line to assets/vo/ (silence-trimmed to the first/last word
// boundary), plus assets/vo/durations.json and assets/vo/words.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..", "..");

function readEnvFile(file, into) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.trim().match(/^([A-Z_]+)=(.*)$/);
    if (m) into[m[1]] = m[2].trim();
  }
}

function loadEnv() {
  const env = {};
  // 0. .env.example — chỉ làm nền cho các giá trị không phải bí mật (TTS_PROVIDER=edge,
  //    EDGE_VOICE...). Không có bước này thì người vừa `git pull` mà chưa tạo .env sẽ rơi
  //    về provider mặc định dưới đây và gặp lỗi "thiếu VBEE_APP_ID", dù README và
  //    .env.example đều nói mặc định là Edge TTS. scripts/sync-channel.mjs của mỗi video
  //    đã fallback y hệt — giữ cho hai bên hành xử giống nhau.
  readEnvFile(path.join(REPO_ROOT, ".env.example"), env);
  // 1. Root .env
  const rootEnvPath = path.join(REPO_ROOT, ".env");
  if (fs.existsSync(rootEnvPath)) {
    const raw = fs.readFileSync(rootEnvPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.trim().match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  // 2. Local video .env (overrides root .env)
  const localEnvPath = path.join(ROOT, ".env");
  if (fs.existsSync(localEnvPath)) {
    const raw = fs.readFileSync(localEnvPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.trim().match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  // 3. process.env (overrides all)
  for (const k of ["TTS_PROVIDER", "VIENEU_VOICE", "EDGE_VOICE", "VBEE_APP_ID", "VBEE_ACCESS_TOKEN", "VBEE_VOICE_CODE"]) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}

const ENV = loadEnv();
const TTS_PROVIDER = (ENV.TTS_PROVIDER || "vbee").toLowerCase();

// --- Vbee config (only required when TTS_PROVIDER=vbee) ---
const VBEE_APP_ID = ENV.VBEE_APP_ID;
const VBEE_ACCESS_TOKEN = ENV.VBEE_ACCESS_TOKEN;
const VOICE_CODE = ENV.VBEE_VOICE_CODE || "n_hanoi_male_protrainer_education_vc";

// --- Edge TTS config (only required when TTS_PROVIDER=edge) ---
const EDGE_VOICE = ENV.EDGE_VOICE || "vi-VN-NamMinhNeural";

// --- VieNeu TTS config (only required when TTS_PROVIDER=vieneu) ---
const VIENEU_VOICE = ENV.VIENEU_VOICE || "Adam";

const SPEED_RATE = 1.1;

if (TTS_PROVIDER === "vbee") {
  if (!VBEE_APP_ID || !VBEE_ACCESS_TOKEN) {
    throw new Error(
      "TTS_PROVIDER=vbee nhưng thiếu VBEE_APP_ID / VBEE_ACCESS_TOKEN trong .env.\n" +
        "Điền credentials Vbee, hoặc đổi TTS_PROVIDER=edge để dùng Edge TTS miễn phí.",
    );
  }
}

console.log(`TTS provider: ${TTS_PROVIDER}${TTS_PROVIDER === "vieneu" ? ` (voice: ${VIENEU_VOICE})` : ""}`);

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
  { id: "line-1", text: "Đây là Đá Moissanite." },
  { id: "line-2", text: "Đây là Đá CZ." },
  { id: "line-3", text: "Nên chọn đá Moissanite hay đá CZ để làm trang sức?" },
  { id: "line-4", text: "Bạn đang phân vân giữa Moissanite lấp lánh và đá CZ giá rẻ để đính lên trang sức?" },
  { id: "line-5", text: "Moissanite cực kỳ cứng, đạt chín phẩy hai lăm điểm, hầu như không bao giờ bị trầy xước hay mờ đục." },
  { id: "line-6", text: "Trong khi đó, đá CZ mềm hơn, dễ bị xước và sẽ mờ dần, mất độ bóng sau một thời gian đeo." },
  { id: "line-7", text: "Moissanite sở hữu độ khúc xạ cực cao, tạo ra luồng ánh sáng cầu vồng rực rỡ vô cùng bắt mắt." },
  { id: "line-8", text: "Đá CZ thì cho ánh sáng trắng trẻo, thanh lịch và có vẻ ngoài giống với kim cương tự nhiên hơn." },
  { id: "line-9", text: "Nếu bạn muốn đeo hàng ngày lâu dài, hãy đầu tư Moissanite vì độ bền vĩnh cửu của nó." },
  { id: "line-10", text: "Còn nếu chỉ cần phụ kiện đeo đi tiệc vài lần với ngân sách tiết kiệm, đá CZ là lựa chọn tối ưu." },
  { id: "line-11", text: "Đá Moissanite hay Đá CZ — giờ thì bạn đã rõ rồi đấy!" },
];

// ============================================================
// Edge TTS — Node.js API via edge-tts-universal (no Python needed)
// ============================================================

function speedRateToEdgeRate(rate) {
  const pct = Math.round((rate - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

// Returns { subtitle } where subtitle is Edge TTS's per-word boundary array
// ([{ text, offset, duration }] in 100-nanosecond units, offset from the start
// of the *untrimmed* clip). Writes the raw (untrimmed) mp3 to outPath.
async function generateEdgeSpeech(text, outPath, maxRetries = 8) {
  const { EdgeTTS } = await import("edge-tts-universal");
  const rate = speedRateToEdgeRate(SPEED_RATE);

  // Edge TTS's public endpoint intermittently returns "No audio was received"
  // (empty stream) for a request that succeeds on retry — not text-dependent.
  // Retry generously with a capped backoff so one flaky line doesn't abort the
  // whole scaffold run.
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const tts = new EdgeTTS(text, EDGE_VOICE, { rate });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("EdgeTTS synthesize timeout (20s)")), 20000),
      );
      const result = await Promise.race([tts.synthesize(), timeoutPromise]);
      const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
      if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error("Empty audio buffer returned");
      }
      fs.writeFileSync(outPath, audioBuffer);
      await new Promise((r) => setTimeout(r, 400));
      return { subtitle: result.subtitle || [] };
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const backoff = Math.min(1500 * attempt, 9000) + Math.floor(Math.random() * 500);
      console.warn(
        `  [Thử lại ${attempt}/${maxRetries} cho dòng "${text.slice(0, 20)}..."]: ${err.message} — chờ ${backoff}ms`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

// ---- silence trim (matches the 2026-09-02 pacing fix) --------------------
// TTS clips carry ~0.2s leading + ~0.8s trailing silence. Trim relative to the
// first/last WORD BOUNDARY (same source as the karaoke timing, so the two stay
// consistent) and keep a small margin so soft onsets/decays aren't clipped.
const TRIM_LEAD = 0.08;
const TRIM_TRAIL = 0.14;
const TL_START1 = 0.55;        // first VO start (after the entrance animation)
const TL_GAP = 0.14;           // flat timeline gap. Word-boundary trim (below) keeps
                               // a little more head/tail than the old envelope trim,
                               // so a smaller gap lands speech-to-speech at ~0.5s.
const TL_OUTRO = 1.2;          // hold after the last clip

function tickToSec(t) {
  return t / 1e7;
}

async function ffprobeDuration(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ]);
  return parseFloat(stdout.trim());
}

async function trimClip(rawPath, finalPath, startSec, durSec) {
  await execFileAsync("ffmpeg", [
    "-v", "error", "-y",
    "-ss", startSec.toFixed(3), "-t", durSec.toFixed(3),
    "-i", rawPath, "-c:a", "libmp3lame", "-q:a", "2", finalPath,
  ]);
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

async function main() {
  const outDir = path.join(ROOT, "assets", "vo");
  const rawDir = path.join(outDir, ".raw");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const durations = {};
  const words = {};          // { "line-1": [{ t, s, d }] }  (s/d in seconds, relative to TRIMMED clip)
  const edgeOnly = TTS_PROVIDER === "edge";
  const isVieNeu = TTS_PROVIDER === "vieneu";
  if (!edgeOnly && !isVieNeu) {
    console.warn("\n⚠ TTS_PROVIDER != edge/vieneu — Vbee không trả word boundary.\n");
  }

  for (const line of LINES) {
    const rawPath = path.join(rawDir, `${line.id}.mp3`);
    const finalPath = path.join(outDir, `${line.id}.mp3`);
    process.stdout.write(`Generating ${line.id}: "${line.text}" ... `);

    let subtitle = [];
    if (isVieNeu) {
      await generateVieNeuSpeech(line.text, rawPath);
    } else if (edgeOnly) {
      ({ subtitle } = await generateEdgeSpeech(line.text, rawPath));
    } else {
      const audioUrl = await generateVbeeSpeech(line.text);
      await downloadAudio(audioUrl, rawPath);
    }

    // Trim bounds from the word boundaries (Edge) — falls back to no-trim if absent.
    let trimStart = 0;
    if (subtitle.length) {
      const first = tickToSec(subtitle[0].offset);
      const last = tickToSec(subtitle.at(-1).offset + subtitle.at(-1).duration);
      const rawDur = await ffprobeDuration(rawPath);
      trimStart = Math.max(0, first - TRIM_LEAD);
      const trimEnd = Math.min(rawDur, last + TRIM_TRAIL);
      await trimClip(rawPath, finalPath, trimStart, trimEnd - trimStart);
    } else {
      fs.copyFileSync(rawPath, finalPath);
    }

    const dur = await ffprobeDuration(finalPath);
    durations[line.id] = Math.round(dur * 1000) / 1000;

    if (subtitle.length) {
      // Match display tokens (original text, keeps punctuation like "biệt:" / "đời,")
      // to Edge word boundaries by index. Drop punctuation-only tokens first
      // (e.g. a standalone "—") — Edge doesn't emit a boundary for them.
      const display = line.text
        .split(/\s+/)
        .filter((tok) => /[\p{L}\p{N}]/u.test(tok));
      const wt = subtitle.map((w, i) => ({
        t: display[i] ?? w.text,
        s: Math.round(Math.max(0, tickToSec(w.offset) - trimStart) * 1000) / 1000,
        d: Math.round(tickToSec(w.duration) * 1000) / 1000,
      }));
      if (display.length !== subtitle.length) {
        console.warn(
          `\n  ⚠ ${line.id}: ${display.length} token chữ vs ${subtitle.length} word boundary — ` +
          `kiểm tra lại text dòng này.`,
        );
      }
      words[line.id] = wt;
    } else if (isVieNeu) {
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
    console.log(`${dur.toFixed(2)}s${subtitle.length ? `  (${subtitle.length} từ)` : ""}`);
  }

  fs.writeFileSync(path.join(outDir, "durations.json"), JSON.stringify(durations, null, 2));
  if (Object.keys(words).length) {
    fs.writeFileSync(path.join(outDir, "words.json"), JSON.stringify(words, null, 2));
  }

  // ---- print the retimed HyperFrames timeline (paste into index.html) -------
  const ids = LINES.map((l) => l.id);
  const starts = {};
  let cur = TL_START1;
  for (const id of ids) {
    starts[id] = Math.round(cur * 1000) / 1000;
    cur = Math.round((cur + durations[id] + TL_GAP) * 1000) / 1000;
  }
  const total = Math.round((cur - TL_GAP + TL_OUTRO) * 10) / 10;

  console.log("\n--- assets/vo written: durations.json" + (Object.keys(words).length ? " + words.json" : "") + " ---");
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
