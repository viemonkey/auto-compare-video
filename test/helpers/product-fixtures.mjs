// Dữ liệu giả dùng chung cho test chế độ "Giới thiệu sản phẩm": ảnh tổng hợp bằng ffmpeg, thư mục tạm, fetch giả.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveMediaBinaries } from "../../scripts/lib/media-binaries.mjs";

export const tmpDir = (prefix = "pd-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** PNG tổng hợp: nền #f2f2f2, 1 "nhẫn" xám (khối có lỗ giữa). Trả đường dẫn. */
export function makeRingPng(file, { size = 300, withHole = true, box = [90, 90, 120, 120] } = {}) {
  const { ffmpeg } = resolveMediaBinaries();
  const [x, y, w, h] = box;
  const filters = [`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=0x707070:t=fill`];
  if (withHole) filters.push(`drawbox=x=${x + 35}:y=${y + 35}:w=${w - 70}:h=${h - 70}:color=0xf2f2f2:t=fill`);
  const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0xf2f2f2:s=${size}x${size}`, "-vf", filters.join(","), "-frames:v", "1", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  return file;
}

/** Ảnh phẳng 1 màu (ảnh host/ảnh cảnh giả). */
export function makeSolidPng(file, { size = 64, color = "0x884422", width, height } = {}) {
  const { ffmpeg } = resolveMediaBinaries();
  const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=${width || size}x${height || size}`, "-frames:v", "1", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  return file;
}

/** Phản hồi giả của generateContent: 1 ảnh PNG nhỏ + usage. */
export const imageResponse = (b64, usage = {}) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: b64 } }] }, finishReason: "STOP" }], usageMetadata: usage }), text: async () => "" });
export const textResponse = (obj, usage = { promptTokenCount: 100, candidatesTokenCount: 50 }) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: usage }), text: async () => "" });
export const errorResponse = (status, body) => ({ ok: false, status, text: async () => JSON.stringify(body), json: async () => body });
