// Âm thanh video giới thiệu sản phẩm: ghép giọng từng câu + hiệu ứng (whoosh khi cắt cảnh, lấp lánh khi ánh sáng chạy) + nhạc nền (nếu có) thành 1 file,
// nhạc tự HẠ khi có giọng (sidechain), chuẩn hoá -14 LUFS (loudnorm 2 lượt, khớp đích chính xác). Nhạc/SFX chỉ lấy từ assets/audio/ có khai báo giấy phép ở audio.json.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveMediaBinaries, mediaToolsEnv } from "../media-binaries.mjs";
import { loadProductConfig, repoPath } from "./config.mjs";

/** Đọc audio.json; mục thiếu giấy phép/nguồn/file bị BỎ (kèm cảnh báo) — không dùng nhạc không rõ bản quyền. */
export function loadAudioManifest(config = loadProductConfig(), root = repoPath()) {
  const file = path.join(root, config.audio.manifest);
  const warnings = [];
  let raw = { bgm: [], sfx: [] };
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    warnings.push(`Không đọc được ${config.audio.manifest} — dựng không nhạc nền/hiệu ứng.`);
  }
  const valid = (e, kind) => {
    const abs = path.join(path.dirname(file), e.file || "");
    if (!e.id || !e.file || !fs.existsSync(abs)) { warnings.push(`${kind} "${e.id || e.file}": thiếu file — bỏ qua.`); return null; }
    if (!String(e.license || "").trim() || !String(e.source || "").trim()) { warnings.push(`${kind} "${e.id}": thiếu license/source — KHÔNG dùng (chỉ dùng âm thanh có giấy phép rõ ràng).`); return null; }
    return { ...e, abs };
  };
  const bgm = (raw.bgm || []).map((e) => valid(e, "Nhạc nền")).filter(Boolean);
  const sfx = Object.fromEntries((raw.sfx || []).map((e) => valid(e, "SFX")).filter(Boolean).map((e) => [e.id, e]));
  return { bgm, sfx, warnings };
}

export const pickBgm = (manifest, wantedId = "") => manifest.bgm.find((b) => b.id === wantedId) || manifest.bgm[0] || null;

const db = (x) => `${x}dB`;

/**
 * Đồ thị lọc ffmpeg. voice: [{file,startSec}], cues: [{file,at,gainDb}], bgm: {file}|null.
 * @returns {{inputs:string[], graph:string, label:string}} label = nhãn đầu ra TRƯỚC loudnorm
 */
export function buildMixGraph({ voices, cues, bgm, duration, config = loadProductConfig() }) {
  const a = config.audio;
  const inputs = [];
  const parts = [];
  const norm = "aformat=sample_rates=" + a.sampleRate + ":channel_layouts=stereo";
  voices.forEach((v, i) => {
    inputs.push(v.file);
    const ms = Math.max(0, Math.round(v.startSec * 1000));
    parts.push(`[${inputs.length - 1}:a]${norm},adelay=${ms}|${ms}[v${i}]`);
  });
  parts.push(`${voices.map((_, i) => `[v${i}]`).join("")}amix=inputs=${voices.length}:normalize=0:duration=longest,apad=whole_dur=${duration}[voice]`);
  const mixLabels = [];
  if (bgm) {
    parts.push(`[voice]asplit=2[vomain][vosc]`);
    inputs.push(bgm.file);
    const b = inputs.length - 1;
    parts.push(`[${b}:a]${norm},aloop=loop=-1:size=2147483647,atrim=0:${duration},volume=${db(a.bgmVolumeDb)},afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, duration - 1.5)}:d=1.5[bgm0]`);
    parts.push(`[bgm0][vosc]sidechaincompress=threshold=${a.duckThreshold}:ratio=${a.duckRatio}:attack=20:release=500[bgm]`);
    mixLabels.push("[vomain]", "[bgm]");
  } else mixLabels.push("[voice]");
  if (cues.length) {
    cues.forEach((c, i) => {
      inputs.push(c.file);
      const ms = Math.max(0, Math.round(c.at * 1000));
      parts.push(`[${inputs.length - 1}:a]${norm},volume=${db(c.gainDb ?? a.sfxVolumeDb)},adelay=${ms}|${ms}[c${i}]`);
    });
    parts.push(`${cues.map((_, i) => `[c${i}]`).join("")}amix=inputs=${cues.length}:normalize=0:duration=longest[sfx]`);
    mixLabels.push("[sfx]");
  }
  parts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:normalize=0:duration=longest,atrim=0:${duration}[premix]`);
  return { inputs, graph: parts.join(";"), label: "premix" };
}

function run(args) {
  const { ffmpeg } = resolveMediaBinaries();
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-nostats", "-y", ...args], { windowsHide: true, env: mediaToolsEnv() });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg thoát mã ${code}: ${err.slice(-600)}`))));
  });
}

/** Parse khối JSON của loudnorm (print_format=json) ở cuối stderr. */
export function parseLoudnorm(stderr) {
  const m = /\{[^{}]*"input_i"[^{}]*\}/s.exec(stderr);
  if (!m) throw new Error("Không đo được độ lớn âm thanh (loudnorm).");
  const j = JSON.parse(m[0]);
  return { i: Number(j.input_i), tp: Number(j.input_tp), lra: Number(j.input_lra), thresh: Number(j.input_thresh), offset: Number(j.target_offset) };
}

/**
 * @param {{voices:Array<{file,startSec}>, cues?:Array, bgm?:{file}|null, duration:number, outFile:string, config?:object}} o
 * @returns {Promise<{file:string, measured:{i:number,tp:number,lra:number}, outputI:number|null}>}
 */
export async function mixAudio({ voices, cues = [], bgm = null, duration, outFile, config = loadProductConfig() }) {
  if (!voices.length) throw new Error("Không có giọng đọc để ghép.");
  const { inputs, graph, label } = buildMixGraph({ voices, cues, bgm, duration, config });
  const a = config.audio;
  const inArgs = inputs.flatMap((f) => ["-i", f]);
  const target = `I=${a.targetLufs}:TP=${a.truePeakDb}:LRA=${a.lra}`;
  const pass1 = await run([...inArgs, "-filter_complex", `${graph};[${label}]loudnorm=${target}:print_format=json[out]`, "-map", "[out]", "-f", "null", "-"]);
  const m = parseLoudnorm(pass1);
  const second = `loudnorm=${target}:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true:print_format=json`;
  fs_mkdir(outFile);
  const pass2 = await run([...inArgs, "-filter_complex", `${graph};[${label}]${second}[out]`, "-map", "[out]", "-ar", String(a.sampleRate), "-c:a", "libmp3lame", "-q:a", "2", outFile]);
  let outputI = null;
  try { outputI = Number(JSON.parse(/\{[^{}]*"output_i"[^{}]*\}/s.exec(pass2)[0]).output_i); } catch { /* chỉ để báo cáo */ }
  return { file: outFile, measured: { i: m.i, tp: m.tp, lra: m.lra }, outputI };
}

const fs_mkdir = (file) => fs.mkdirSync(path.dirname(file), { recursive: true });

/** Đo độ lớn tích hợp (LUFS) của 1 file — dùng để kiểm kết quả. */
export async function measureLufs(file) {
  const err = await run(["-i", file, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]);
  return parseLoudnorm(err).i;
}
