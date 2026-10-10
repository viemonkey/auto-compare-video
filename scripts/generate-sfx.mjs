#!/usr/bin/env node
// Tạo hiệu ứng âm thanh cho video giới thiệu sản phẩm bằng TỔNG HỢP (ffmpeg lavfi) — không dùng mẫu âm thanh của bên thứ ba nên giấy phép rõ ràng (CC0, do repo này tự tạo).
// Ghi vào assets/audio/sfx/ + khai báo ở assets/audio/audio.json. Chạy lại an toàn: node scripts/generate-sfx.mjs
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveMediaBinaries } from "./lib/media-binaries.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(ROOT, "assets", "audio");
fs.mkdirSync(path.join(dir, "sfx"), { recursive: true });
fs.mkdirSync(path.join(dir, "bgm"), { recursive: true });
const { ffmpeg } = resolveMediaBinaries();

const SOUNDS = {
  whoosh: { title: "Whoosh chuyển cảnh", args: ["-f", "lavfi", "-i", "anoisesrc=d=0.7:c=pink:a=0.9:r=44100", "-af", "highpass=f=250,lowpass=f=3800,afade=t=in:st=0:d=0.32,afade=t=out:st=0.32:d=0.38,volume=0.9"] },
  sparkle: { title: "Lấp lánh khi ánh sáng chạy qua", args: ["-f", "lavfi", "-i", "aevalsrc=exp(-7*t)*sin(2*PI*2093*t)+0.6*exp(-9*t)*sin(2*PI*3136*t)+0.4*exp(-11*t)*sin(2*PI*4186*t):d=0.7:s=44100", "-af", "aecho=0.8:0.55:70:0.35,afade=t=out:st=0.45:d=0.25,volume=0.7"] },
};
const manifest = { _doc: "Âm thanh dùng trong video giới thiệu sản phẩm. Mỗi mục BẮT BUỘC có license + source, thiếu thì tool không dùng. Nhạc nền: thêm mục vào \"bgm\" (xem docs/product-showcase.md); để trống = video không nhạc.", sfx: [], bgm: [] };
for (const [id, s] of Object.entries(SOUNDS)) {
  const out = path.join(dir, "sfx", `${id}.wav`);
  const r = spawnSync(ffmpeg, ["-v", "error", "-y", ...s.args, "-ac", "2", out], { encoding: "utf8" });
  if (r.status !== 0) { console.error(`Lỗi tạo ${id}: ${r.stderr}`); process.exit(1); }
  manifest.sfx.push({ id, file: `sfx/${id}.wav`, title: s.title, license: "CC0-1.0", source: "Tổng hợp bằng scripts/generate-sfx.mjs (ffmpeg lavfi) — không dùng mẫu của bên thứ ba" });
  console.log(`✔ ${path.relative(ROOT, out)}`);
}
fs.writeFileSync(path.join(dir, "audio.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("✔ assets/audio/audio.json");
