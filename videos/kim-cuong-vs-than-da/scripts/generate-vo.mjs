// Voiceover generation for Kim Cương vs Than Đá narration.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..", "..");

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
const TTS_PROVIDER = (ENV.TTS_PROVIDER || "edge").toLowerCase();

const VBEE_APP_ID = ENV.VBEE_APP_ID;
const VBEE_ACCESS_TOKEN = ENV.VBEE_ACCESS_TOKEN;
const VOICE_CODE = ENV.VBEE_VOICE_CODE || "n_hanoi_male_protrainer_education_vc";
const EDGE_VOICE = ENV.EDGE_VOICE || "vi-VN-NamMinhNeural";

const SPEED_RATE = 1.1;

if (TTS_PROVIDER === "vbee") {
  if (!VBEE_APP_ID || !VBEE_ACCESS_TOKEN) {
    throw new Error(
      "TTS_PROVIDER=vbee nhưng thiếu VBEE_APP_ID / VBEE_ACCESS_TOKEN trong .env.\n" +
        "Điền credentials Vbee, hoặc đổi TTS_PROVIDER=edge để dùng Edge TTS miễn phí.",
    );
  }
}

console.log(`TTS provider: ${TTS_PROVIDER}`);

const LINES = [
  { id: "line-1", text: "Đây là Kim Cương." },
  { id: "line-2", text: "Đây là Than Đá." },
  { id: "line-3", text: "Sự khác nhau là gì?" },
  { id: "line-4", text: "Kim Cương hình thành dưới áp suất cực lớn, với cấu trúc tinh thể siêu bền." },
  { id: "line-5", text: "Nó là vật liệu tự nhiên cứng nhất hành tinh, phản xạ ánh sáng lấp lánh." },
  { id: "line-6", text: "Nên được dùng làm trang sức xa xỉ và mũi khoan công nghiệp." },
  { id: "line-7", text: "Than đá cũng tạo từ Carbon, nhưng cấu trúc xếp lớp lỏng lẻo." },
  { id: "line-8", text: "Rất mềm, dễ vỡ và có màu đen nhám." },
  { id: "line-9", text: "Nên được dùng chủ yếu làm nhiên liệu đốt phát điện." },
  { id: "line-10", text: "Cùng là Carbon — một bên chịu áp lực tỏa sáng, một bên cháy thành tro." },
  { id: "line-11", text: "Kim Cương xa xỉ — Than Đá âm thầm tạo ra năng lượng!" },
  { id: "line-12", text: "Tùy thuộc vào áp lực, kết quả sẽ hoàn toàn khác biệt!" },
];

function speedRateToEdgeRate(rate) {
  const pct = Math.round((rate - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

async function generateEdgeSpeech(text, outPath) {
  const { EdgeTTS } = await import("edge-tts-universal");
  const rate = speedRateToEdgeRate(SPEED_RATE);
  const tts = new EdgeTTS(text, EDGE_VOICE, { rate });
  const result = await tts.synthesize();
  const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
  fs.writeFileSync(outPath, audioBuffer);
}

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

async function getDuration(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return parseFloat(stdout.trim());
}

async function main() {
  const outDir = path.join(ROOT, "assets", "vo");
  fs.mkdirSync(outDir, { recursive: true });
  const durations = {};

  for (const line of LINES) {
    const outPath = path.join(outDir, `${line.id}.mp3`);
    process.stdout.write(`Generating ${line.id}: "${line.text}" ... `);

    if (TTS_PROVIDER === "edge") {
      await generateEdgeSpeech(line.text, outPath);
    } else {
      const audioUrl = await generateVbeeSpeech(line.text);
      await downloadAudio(audioUrl, outPath);
    }

    const dur = await getDuration(outPath);
    durations[line.id] = dur;
    console.log(`${dur.toFixed(2)}s`);
  }

  fs.writeFileSync(
    path.join(outDir, "durations.json"),
    JSON.stringify(durations, null, 2),
  );
  console.log("Done. Durations written to assets/vo/durations.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
