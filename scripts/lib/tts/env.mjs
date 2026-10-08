// Nạp biến môi trường cho generate-vo.mjs của 1 video. Thứ tự ưu tiên (thấp → cao):
//   .env.example (nền, không bí mật) < .env gốc < process.env (CLI/hệ thống) < .env RIÊNG của video.
// .env riêng của video đứng cao nhất vì scaffold ghi lựa chọn của người dùng (engine/giọng/thị trường) vào đó, trong khi
// process.env của tiến trình con (server nạp .env gốc) luôn mang TTS_PROVIDER mặc định của máy (vd vieneu) — nếu để nó thắng
// thì ô "Chọn giọng" ở Bước 1 bị bỏ qua.
import fs from "node:fs";
import path from "node:path";

export const ENV_KEYS = [
  "TTS_PROVIDER", "TTS_VOICE", "VIENEU_VOICE", "EDGE_VOICE", "VBEE_APP_ID", "VBEE_ACCESS_TOKEN", "VBEE_VOICE_CODE",
  "VIDEO_LOCALE", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "TTS_CACHE_DIR",
];

export function readEnvFile(file, into = {}) {
  if (!fs.existsSync(file)) return into;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) into[m[1]] = m[2].trim();
  }
  return into;
}

export function loadVideoEnv({ repoRoot, videoRoot, processEnv = process.env }) {
  const env = {};
  readEnvFile(path.join(repoRoot, ".env.example"), env);
  readEnvFile(path.join(repoRoot, ".env"), env);
  for (const k of ENV_KEYS) if (processEnv[k]) env[k] = processEnv[k];
  Object.assign(env, readEnvFile(path.join(videoRoot, ".env")));
  return env;
}
