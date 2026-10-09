import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const bundledDefaults = {
  ffmpeg: ffmpegStatic || null,
  ffprobe: ffprobeStatic?.path || null,
};

export function resolveMediaBinaries(env = process.env, bundled = bundledDefaults) {
  return {
    ffmpeg: String(env.FFMPEG_PATH || bundled.ffmpeg || "ffmpeg"),
    ffprobe: String(env.FFPROBE_PATH || bundled.ffprobe || "ffprobe"),
  };
}

/**
 * env cho tiến trình con (hyperframes render/check, scaffold...): các công cụ đó tự gọi `ffmpeg`/`ffprobe` theo tên qua PATH,
 * nên thêm thư mục chứa bản đóng gói (hoặc FFMPEG_PATH/FFPROBE_PATH) lên ĐẦU PATH. Máy đã có ffmpeg hệ thống vẫn chạy bình thường.
 */
export function mediaToolsEnv(env = process.env, bundled = bundledDefaults) {
  const paths = resolveMediaBinaries(env, bundled);
  const dirs = [...new Set([paths.ffmpeg, paths.ffprobe].filter((bin) => path.isAbsolute(bin)).map((bin) => path.dirname(bin)))];
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path") || "PATH";
  return { ...env, [key]: [...dirs, env[key]].filter(Boolean).join(path.delimiter) };
}

export function describeSpawnError(error, fallbackCommand = "tiến trình") {
  const command = error?.path || error?.spawnargs?.[0] || fallbackCommand;
  const code = error?.code || error?.errno || "UNKNOWN";
  const detail = String(error?.message || "Không có thông tin lỗi từ hệ điều hành.").trim();
  return `Không chạy được ${command} [${code}]: ${detail}`;
}

function inspectBinary(label, binary, spawn = spawnSync) {
  if (!binary) {
    return { ok: false, path: null, code: "MISSING", error: `Không tìm thấy ${label}.` };
  }
  if (fs.existsSync(binary) && fs.statSync(binary).isDirectory()) {
    return { ok: false, path: binary, code: "EISDIR", error: `${label} đang trỏ tới thư mục, không phải file chạy.` };
  }

  const result = spawn(binary, ["-version"], { encoding: "utf8", windowsHide: true });
  if (result.error) {
    return { ok: false, path: binary, code: result.error.code || "SPAWN_ERROR", error: describeSpawnError(result.error, label) };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "không có stdout/stderr").trim();
    return { ok: false, path: binary, code: `EXIT_${result.status}`, error: `${label} thoát với mã ${result.status}: ${detail}` };
  }
  const version = String(result.stdout || result.stderr || "").split(/\r?\n/, 1)[0].trim();
  return { ok: true, path: binary, code: null, version, error: null };
}

export function checkMediaBinaries({ env = process.env, bundled = bundledDefaults, spawn = spawnSync } = {}) {
  const paths = resolveMediaBinaries(env, bundled);
  const ffmpeg = inspectBinary("FFmpeg", paths.ffmpeg, spawn);
  const ffprobe = inspectBinary("FFprobe", paths.ffprobe, spawn);
  const errors = [ffmpeg, ffprobe].filter((item) => !item.ok).map((item) => item.error);
  return { ok: errors.length === 0, ffmpeg, ffprobe, errors };
}

export function mediaToolsErrorVi(report) {
  if (report?.ok) return "";
  const details = report?.errors?.length ? report.errors.join("; ") : "Không xác định được trạng thái FFmpeg/FFprobe.";
  return `Công cụ xử lý âm thanh chưa sẵn sàng: ${details} Hãy chạy npm install hoặc đặt FFMPEG_PATH / FFPROBE_PATH tới file chạy hợp lệ.`;
}
