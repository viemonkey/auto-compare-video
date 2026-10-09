// Công cụ âm thanh dùng binary đa nền tảng đã đóng gói cùng repo
// (ffmpeg-static + ffprobe-static), vẫn cho phép ghi đè bằng biến môi trường.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMediaBinaries } from "../media-binaries.mjs";

const execFileAsync = promisify(execFile);

export async function probeDuration(file, { exec = execFileAsync, env = process.env, bundled } = {}) {
  const { ffprobe } = resolveMediaBinaries(env, bundled);
  const { stdout } = await exec(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
  return parseFloat(stdout.trim());
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
