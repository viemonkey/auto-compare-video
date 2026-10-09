// Công cụ âm thanh dùng ffmpeg/ffprobe. Ưu tiên biến môi trường, sau đó dùng
// ffmpeg-static đã cài cùng repo; ffprobe không có thì đo thời lượng bằng
// progress output của ffmpeg. Tách riêng để voiceover.mjs test được bằng bản giả.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);
export function resolveMediaBinaries(env = process.env, staticPath = ffmpegStatic) {
  return {
    ffmpeg: env.FFMPEG_PATH || staticPath || "ffmpeg",
    ffprobe: env.FFPROBE_PATH || "ffprobe",
  };
}

/** Đọc mốc cuối cùng từ `ffmpeg -progress pipe:1` (microsecond). */
export function parseFfmpegProgressDuration(stdout) {
  const text = String(stdout || "");
  const micros = [...text.matchAll(/^out_time_(?:us|ms)=(\d+)$/gm)].map((m) => Number(m[1])).filter(Number.isFinite);
  if (micros.length) return Math.max(...micros) / 1e6;

  const clocks = [...text.matchAll(/^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)$/gm)];
  if (!clocks.length) return NaN;
  return Math.max(...clocks.map((m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])));
}

export async function probeDuration(file, { exec = execFileAsync, env = process.env, staticPath = ffmpegStatic } = {}) {
  const { ffmpeg, ffprobe } = resolveMediaBinaries(env, staticPath);
  try {
    const { stdout } = await exec(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
    return parseFloat(stdout.trim());
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const { stdout } = await exec(ffmpeg, [
    "-v", "error", "-progress", "pipe:1", "-nostats",
    "-i", file, "-map", "0:a:0", "-f", "null", "-",
  ]);
  const duration = parseFfmpegProgressDuration(stdout);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Không đo được thời lượng audio bằng ffmpeg: ${file}`);
  }
  return duration;
}

export async function trimClip(rawPath, finalPath, startSec, durSec) {
  const { ffmpeg } = resolveMediaBinaries();
  await execFileAsync(ffmpeg, ["-v", "error", "-y", "-ss", startSec.toFixed(3), "-t", durSec.toFixed(3), "-i", rawPath, "-c:a", "libmp3lame", "-q:a", "2", finalPath]);
}

/** Parse đầu ra `silencedetect` của ffmpeg -> khoảng có tiếng [start, end] (giây). Không có khoảng lặng nào -> toàn clip. */
export function parseSilenceDetect(stderr, totalDur) {
  let start = 0;
  let end = totalDur;
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  // lặng ở đầu: silence_start ≈ 0 và có silence_end
  if (starts.length && starts[0] <= 0.02 && ends.length) start = ends[0];
  // lặng ở cuối: silence_start cuối cùng không có silence_end đi kèm sau nó (kéo tới hết clip)
  if (starts.length && starts.length > ends.length) end = starts.at(-1);
  else if (starts.length && ends.length && totalDur - ends.at(-1) < 0.02 && starts.at(-1) > start) end = starts.at(-1);
  return { start: Math.max(0, start), end: Math.max(start, Math.min(totalDur, end)) };
}

/** Khoảng có tiếng của 1 clip không có word boundary (Azure REST...). Lỗi/không đọc được -> null (không cắt). */
export async function detectSpeech(file) {
  try {
    const total = await probeDuration(file);
    const { ffmpeg } = resolveMediaBinaries();
    const { stderr } = await execFileAsync(ffmpeg, ["-v", "info", "-i", file, "-af", "silencedetect=noise=-42dB:d=0.12", "-f", "null", "-"], { encoding: "utf8" }).catch((e) => ({ stderr: e.stderr || "" }));
    return parseSilenceDetect(stderr, total);
  } catch {
    return null;
  }
}

export const audioTools = { probeDuration, trimClip, detectSpeech };
