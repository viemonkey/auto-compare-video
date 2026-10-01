// Ảnh bìa cho Reel: chọn frame ngẫu nhiên (ưu tiên giữa 1 segment pose ổn định), trích JPEG
// 1080x1920 bằng ffmpeg, upload qua POST /{video_id}/thumbnails (is_preferred=true).
// Mọi hàm ở đây chỉ phục vụ tính năng phụ — nơi gọi phải bắt lỗi và chỉ log cảnh báo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { probeMp4 } from "./mp4-probe.mjs";
import { graphBase, makeLogger, redactSecrets } from "./fb-config.mjs";

const log = makeLogger("thumbnail");

/** FFMPEG_PATH (.env) ghi đè; mặc định là binary của ffmpeg-static. Không dùng ffmpeg trong PATH. */
export function ffmpegPath() {
  return process.env.FFMPEG_PATH || ffmpegStatic || null;
}

/** Chạy `ffmpeg -version`. @returns {{ok:boolean, path:string|null, detail:string}} */
export function checkFfmpeg() {
  const bin = ffmpegPath();
  if (!bin) return { ok: false, path: null, detail: "ffmpeg-static không có binary cho nền tảng này và FFMPEG_PATH chưa đặt." };
  const r = spawnSync(bin, ["-version"], { encoding: "utf8", timeout: 15_000 });
  if (r.error || r.status !== 0) return { ok: false, path: bin, detail: r.error?.message || `exit ${r.status}` };
  return { ok: true, path: bin, detail: String(r.stdout || "").slice(0, 60).trim() };
}

/**
 * Đọc timeline pose từ index.html của composition (changePose("x", VO[n].start) + khối VO).
 * Trả các segment {pose, start, end} — end = start pose kế tiếp, hoặc hết dòng VO cuối.
 * @returns {Array<{pose:string,start:number,end:number}>|null}
 */
export function extractPoseTimeline(indexHtml) {
  const vo = {};
  const voBlock = indexHtml.match(/const VO = \{([\s\S]*?)\};/);
  if (!voBlock) return null;
  for (const m of voBlock[1].matchAll(/(\d+)\s*:\s*\{\s*start:\s*([\d.]+)\s*,\s*dur:\s*([\d.]+)/g)) {
    vo[m[1]] = { start: Number(m[2]), dur: Number(m[3]) };
  }
  const changes = [];
  for (const m of indexHtml.matchAll(/changePose\("([^"]+)",\s*VO\[(\d+)\]\.start\)/g)) {
    const v = vo[m[2]];
    if (v) changes.push({ pose: m[1], start: v.start, dur: v.dur });
  }
  if (!changes.length) return null;
  changes.sort((a, b) => a.start - b.start);
  return changes.map((c, i) => ({
    pose: c.pose,
    start: c.start,
    end: changes[i + 1] ? changes[i + 1].start : c.start + c.dur,
  }));
}

/**
 * Chọn thời điểm frame. Có segments: chọn ngẫu nhiên 1 segment giao với [from,to], lấy điểm
 * giữa phần giao (tránh frame đang đổi dáng). Không có: random đều trong [from,to].
 * @returns {{timeSec:number, source:"segment-midpoint"|"random", pose?:string}}
 */
export function pickThumbnailTime(durationSeconds, segments, env = process.env) {
  const startSec = Number(env.FB_THUMB_START_SEC ?? 3);
  const endOffset = Number(env.FB_THUMB_END_OFFSET_SEC ?? 2);
  const from = Math.max(0, Number.isFinite(startSec) ? startSec : 3);
  const to = durationSeconds - (Number.isFinite(endOffset) ? endOffset : 2);
  if (to <= from) return { timeSec: round(Math.max(0, durationSeconds / 2)), source: "random" };

  const usable = (segments || [])
    .map((s) => ({ pose: s.pose, a: Math.max(s.start, from), b: Math.min(s.end, to) }))
    .filter((s) => s.b - s.a > 0.3);
  if (usable.length) {
    const s = usable[Math.floor(Math.random() * usable.length)];
    return { timeSec: round((s.a + s.b) / 2), source: "segment-midpoint", pose: s.pose };
  }
  return { timeSec: round(from + Math.random() * (to - from)), source: "random" };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export function extractFrameJpeg(videoPath, timeSec, outPath) {
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) throw new Error("Không có ffmpeg (ffmpeg-static thiếu binary, FFMPEG_PATH chưa đặt).");
  const r = spawnSync(
    ffmpeg,
    [
      "-y", "-ss", String(timeSec), "-i", videoPath, "-frames:v", "1",
      "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
      "-q:v", "2", outPath,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  if (r.error) throw new Error(`Không chạy được ffmpeg (${r.error.message}) — kiểm tra FFMPEG_PATH hoặc cài lại ffmpeg-static.`);
  if (r.status !== 0 || !fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error(`ffmpeg trích frame thất bại (mã ${r.status}): ${(r.stderr || "").slice(-300)}`);
  }
}

export async function uploadThumbnail(videoId, page, jpegPath) {
  const form = new FormData();
  form.append("access_token", page.accessToken);
  form.append("is_preferred", "true");
  form.append("source", await fs.openAsBlob(jpegPath, { type: "image/jpeg" }), "thumbnail.jpg");
  const res = await fetch(`${graphBase()}/${videoId}/thumbnails`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(2 * 60_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error || json.success === false) {
    throw new Error(json?.error?.message || `HTTP ${res.status}`);
  }
  return json;
}

/**
 * Toàn bộ luồng. KHÔNG throw: trả {ok, timeSec, source, pose?, error?} để ghi vào posts[].
 * @param {{poseTimelinePath?:string}} [opts]
 */
export async function setReelThumbnail({ videoId, page, videoPath, poseTimelinePath }) {
  let pick = null;
  const tmp = path.join(os.tmpdir(), `fb-thumb-${videoId}-${Date.now()}.jpg`);
  try {
    let segments = null;
    try {
      if (poseTimelinePath && fs.existsSync(poseTimelinePath)) {
        segments = JSON.parse(fs.readFileSync(poseTimelinePath, "utf8"));
      }
    } catch {
      // không có/hỏng dữ liệu pose -> random thuần
    }
    const { durationSeconds } = probeMp4(videoPath);
    pick = pickThumbnailTime(durationSeconds, segments);
    extractFrameJpeg(videoPath, pick.timeSec, tmp);
    await uploadThumbnail(videoId, page, tmp);
    return { ok: true, ...pick };
  } catch (e) {
    return { ok: false, ...(pick || {}), error: redactSecrets(e.message) };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
