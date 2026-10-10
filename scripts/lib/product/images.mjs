// Xử lý ảnh bằng ffmpeg/ffprobe đóng gói sẵn (ffmpeg-static + ffprobe-static) — không thêm thư viện native, chạy như nhau trên Windows/macOS.
//   probeImage      : kích thước ảnh
//   decodeRgba      : ảnh -> bộ đệm RGBA thô (ffmpeg -f rawvideo)
//   encodeRgbaPng   : bộ đệm RGBA -> PNG (có thể phóng to bằng lanczos + làm nét nhẹ)
//   findContentBox  : khung bao của vật thể trên nền đồng màu (dùng kiểm chứng/dự phòng cho khung bao Gemini trả)
//   cutoutBackground: tách nền đơn giản (nền trắng/đồng màu của ảnh sản phẩm) -> PNG nền trong suốt
//   cropImage       : cắt theo khung bao chuẩn hoá 0-1 (cảnh cận đá / nửa người)
import fs from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMediaBinaries, mediaToolsEnv } from "../media-binaries.mjs";

const execFileAsync = promisify(execFile);

/** Chạy ffmpeg, gom stdout dạng Buffer. */
function runFfmpeg(args, { input } = {}) {
  const { ffmpeg } = resolveMediaBinaries();
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-v", "error", "-y", ...args], { windowsHide: true, env: mediaToolsEnv() });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg thoát mã ${code}: ${Buffer.concat(err).toString().slice(0, 400)}`))));
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function probeImage(file) {
  const { ffprobe } = resolveMediaBinaries();
  const { stdout } = await execFileAsync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file], { windowsHide: true, env: mediaToolsEnv() });
  const s = JSON.parse(stdout).streams?.[0];
  if (!s?.width || !s?.height) throw new Error(`Không đọc được kích thước ảnh: ${file}`);
  return { width: s.width, height: s.height };
}

/** Ảnh -> RGBA thô, thu nhỏ nếu cạnh dài hơn maxDim (giữ tỉ lệ). */
export async function decodeRgba(file, { maxDim = 1600 } = {}) {
  const { width, height } = await probeImage(file);
  const k = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const data = await runFfmpeg(["-i", file, "-vf", `scale=${w}:${h}:flags=lanczos`, "-pix_fmt", "rgba", "-f", "rawvideo", "-"]);
  if (data.length !== w * h * 4) throw new Error(`Giải mã ảnh ra ${data.length} byte, cần ${w * h * 4}.`);
  return { width: w, height: h, data };
}

/** RGBA thô -> PNG. `scale` > 1: phóng to bằng lanczos + unsharp nhẹ (ảnh sản phẩm nhỏ khi lên khung dọc). */
export async function encodeRgbaPng({ width, height, data }, outFile, { scale = 1, sharpen = true } = {}) {
  const filters = [];
  if (scale !== 1) filters.push(`scale=${Math.round(width * scale)}:${Math.round(height * scale)}:flags=lanczos`);
  if (sharpen && scale > 1) filters.push("unsharp=5:5:0.6:5:5:0.0");
  const args = ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-i", "-"];
  if (filters.length) args.push("-vf", filters.join(","));
  args.push("-frames:v", "1", outFile);
  await runFfmpeg(args, { input: data });
  return outFile;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Màu nền = trung vị các điểm viền ảnh. */
function borderColor({ width, height, data }) {
  const ch = [[], [], []];
  const take = (x, y) => {
    const i = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) ch[c].push(data[i + c]);
  };
  for (let x = 0; x < width; x++) { take(x, 0); take(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { take(0, y); take(width - 1, y); }
  return ch.map((arr) => arr.sort((a, b) => a - b)[arr.length >> 1]);
}

/**
 * Mặt nạ nền: điểm "giống màu nền" (khoảng cách <= tolerance) nối với viền ảnh, cộng các vùng giống nền KHÔNG chạm viền nhưng đủ lớn
 * (lỗ giữa nhẫn, khoảng hở) — vùng nhỏ (điểm sáng của đá) được giữ lại. Trả Uint8Array 1 = nền.
 */
export function backgroundMask({ width, height, data }, { tolerance = 12, holeTolerance = 4, holeMinFraction = 0.004 } = {}) {
  const bg = borderColor({ width, height, data });
  const n = width * height;
  const like = new Uint8Array(n);
  const dist = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const d = Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
    dist[p] = Math.min(255, d);
    like[p] = d <= tolerance ? 1 : 0;
  }
  const label = new Int32Array(n); // 0 = chưa xét
  const mask = new Uint8Array(n);
  const stack = new Int32Array(n);
  let next = 0;
  const holeMin = Math.max(30, Math.round(n * holeMinFraction));
  for (let seed = 0; seed < n; seed++) {
    if (!like[seed] || label[seed]) continue;
    next++;
    let top = 0;
    stack[top++] = seed;
    label[seed] = next;
    let touchesBorder = false;
    const members = [];
    while (top) {
      const p = stack[--top];
      members.push(p);
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      const nb = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const q of nb) if (q >= 0 && like[q] && !label[q]) { label[q] = next; stack[top++] = q; }
    }
    // Lỗ giữa nhẫn: phải đủ lớn VÀ gần như đúng màu nền (thân kim loại trắng cũng "giống nền" nhưng có sắc độ khác hẳn nên bị loại).
    const tight = touchesBorder ? 0 : members.reduce((a, p) => a + (dist[p] <= holeTolerance ? 1 : 0), 0) / members.length;
    if (touchesBorder || (members.length >= holeMin && tight >= 0.9)) for (const p of members) mask[p] = 1;
  }
  return { mask, bg };
}

/** Khung bao (chuẩn hoá 0-1) của vùng KHÔNG phải nền. Không có vật thể -> null. */
export function contentBoxFromMask(mask, width, height, pad = 0.01) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const bx0 = clamp01(x0 / width - pad);
  const by0 = clamp01(y0 / height - pad);
  const bx1 = clamp01((x1 + 1) / width + pad);
  const by1 = clamp01((y1 + 1) / height + pad);
  return { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
}

export async function findContentBox(file, opts = {}) {
  const img = await decodeRgba(file, { maxDim: 600 });
  const { mask } = backgroundMask(img, opts);
  return contentBoxFromMask(mask, img.width, img.height);
}

/** Làm mềm biên mặt nạ: alpha 0..255 = 255*(1-nền) rồi blur hộp 3x3 `passes` lần. */
function featheredAlpha(mask, width, height, passes = 2) {
  let a = new Float32Array(width * height);
  for (let p = 0; p < a.length; p++) a[p] = mask[p] ? 0 : 255;
  for (let pass = 0; pass < passes; pass++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            sum += a[yy * width + xx];
            cnt++;
          }
        }
        b[y * width + x] = sum / cnt;
      }
    }
    a = b;
  }
  return a;
}

/**
 * Tách nền đơn giản: ảnh sản phẩm nền trắng/đồng màu -> PNG nền trong suốt, cắt sát vật thể (+ lề), phóng to `scale` lần.
 * @returns {{file:string, box:{x:number,y:number,w:number,h:number}, width:number, height:number}}
 *   box = khung bao của vật thể trong ẢNH GỐC (chuẩn hoá); width/height = kích thước PNG kết quả.
 */
export async function cutoutBackground(inFile, outFile, { tolerance = 12, holeTolerance = 4, scale = 0, targetWidth = 1000, pad = 0.03, maxDim = 1600 } = {}) {
  const img = await decodeRgba(inFile, { maxDim });
  const { mask } = backgroundMask(img, { tolerance, holeTolerance });
  const box = contentBoxFromMask(mask, img.width, img.height, 0);
  if (!box) throw new Error("Không tách được sản phẩm khỏi nền (ảnh không có vật thể rõ ràng trên nền đồng màu).");
  const alpha = featheredAlpha(mask, img.width, img.height);
  const padPx = Math.round(Math.max(box.w * img.width, box.h * img.height) * pad);
  const cx0 = Math.max(0, Math.floor(box.x * img.width) - padPx);
  const cy0 = Math.max(0, Math.floor(box.y * img.height) - padPx);
  const cx1 = Math.min(img.width, Math.ceil((box.x + box.w) * img.width) + padPx);
  const cy1 = Math.min(img.height, Math.ceil((box.y + box.h) * img.height) + padPx);
  const w = cx1 - cx0;
  const h = cy1 - cy0;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y + cy0) * img.width + (x + cx0);
      const o = (y * w + x) * 4;
      out[o] = img.data[src * 4];
      out[o + 1] = img.data[src * 4 + 1];
      out[o + 2] = img.data[src * 4 + 2];
      out[o + 3] = Math.round(alpha[src]);
    }
  }
  // Ảnh sản phẩm thường nhỏ: phóng to tới ~targetWidth (tối đa x8) để khỏi bị vỡ ô khi đặt lên khung dọc.
  const k = scale || Math.min(8, Math.max(1, targetWidth / w));
  await encodeRgbaPng({ width: w, height: h, data: out }, outFile, { scale: k });
  return { file: outFile, box, width: Math.round(w * k), height: Math.round(h * k) };
}

/** Cắt ảnh theo khung bao chuẩn hoá {x,y,w,h}; `outWidth` (tuỳ chọn) phóng/thu về chiều ngang đó (lanczos). */
export async function cropImage(inFile, box, outFile, { outWidth = 0 } = {}) {
  const { width, height } = await probeImage(inFile);
  const x = Math.max(0, Math.round(box.x * width));
  const y = Math.max(0, Math.round(box.y * height));
  const w = Math.max(2, Math.min(width - x, Math.round(box.w * width)));
  const h = Math.max(2, Math.min(height - y, Math.round(box.h * height)));
  const filters = [`crop=${w}:${h}:${x}:${y}`];
  if (outWidth) filters.push(`scale=${outWidth}:-2:flags=lanczos`);
  await runFfmpeg(["-i", inFile, "-vf", filters.join(","), "-frames:v", "1", outFile]);
  return { file: outFile, width: outWidth || w, height: outWidth ? Math.round((h * outWidth) / w) : h };
}

export const fileExists = (f) => fs.existsSync(f);

/** Ảnh -> JPEG base64 thu nhỏ (cạnh dài <= maxPx) để gửi vision / làm ảnh tham chiếu — giảm token và dung lượng request. */
export async function toJpegBase64(file, { maxPx = 1024, quality = 3 } = {}) {
  const { width, height } = await probeImage(file);
  const k = Math.min(1, maxPx / Math.max(width, height));
  const w = Math.max(2, Math.round((width * k) / 2) * 2);
  const h = Math.max(2, Math.round((height * k) / 2) * 2);
  const data = await runFfmpeg(["-i", file, "-vf", `scale=${w}:${h}:flags=lanczos,format=yuvj420p`, "-q:v", String(quality), "-frames:v", "1", "-f", "mjpeg", "-"]);
  return { mimeType: "image/jpeg", data: data.toString("base64"), width: w, height: h };
}
