// Ảnh tham chiếu của host HuyK cho nguồn ảnh AI (gemini/manual):
//   assets/host-refs/face-*.jpg (3-4 ảnh, trang phục bất kỳ) — CHỈ để giữ khuôn mặt + kiểu tóc;
//   trang phục lấy từ config host.outfit (mô tả chữ + ảnh tuỳ chọn assets/host-refs/outfit.jpg).
// Thiếu ảnh / ảnh nhỏ chỉ CẢNH BÁO (tiếng Việt, kèm hướng dẫn) — không chặn nguồn "pose".
import fs from "node:fs";
import path from "node:path";
import { loadProductConfig, repoPath } from "./config.mjs";
import { probeImage } from "./images.mjs";

export const FACE_GUIDE_VI =
  "Chọn 3–4 ảnh chân dung của HuyK: chính diện (face-front.jpg), nghiêng trái (face-left.jpg), nghiêng phải (face-right.jpg), mỉm cười (face-smile.jpg). " +
  "Ảnh rõ nét, đủ sáng, thấy rõ cả khuôn mặt và kiểu tóc, không kính râm/khẩu trang, cạnh ngắn tối thiểu 1024px. Trang phục trong các ảnh này bất kỳ — chỉ khuôn mặt được dùng.";

export const MIME_BY_EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** Liệt kê file ảnh face-* (đã sắp theo tên) và outfit trong thư mục host-refs. */
export function listHostRefFiles(config = loadProductConfig(), root = repoPath()) {
  const { dir, prefix, extensions } = config.host.faceRefs;
  const abs = path.join(root, dir);
  let names = [];
  try {
    names = fs.readdirSync(abs);
  } catch {
    names = [];
  }
  const faces = names
    .filter((n) => n.toLowerCase().startsWith(prefix) && extensions.includes(path.extname(n).toLowerCase()))
    .sort()
    .slice(0, config.host.faceRefs.maxCount)
    .map((n) => path.join(abs, n));
  const outfitFile = path.join(root, config.host.outfit.imageFile);
  return { faces, outfit: fs.existsSync(outfitFile) ? outfitFile : null };
}

/**
 * @returns {Promise<{faces:Array<{file:string,width:number,height:number,small:boolean}>, outfit:{text:string,file:string|null}, ready:boolean, warnings:string[], guide:string}>}
 *   ready = đủ số ảnh face tối thiểu và đều đủ lớn (nguồn "gemini"/"manual" nên dùng); chưa ready thì chỉ cảnh báo.
 */
export async function inspectHostRefs({ config = loadProductConfig(), root = repoPath(), probe = probeImage } = {}) {
  const { faces: files, outfit } = listHostRefFiles(config, root);
  const { minCount, minPx, dir } = config.host.faceRefs;
  const faces = [];
  for (const file of files) {
    try {
      const { width, height } = await probe(file);
      faces.push({ file, width, height, small: Math.min(width, height) < minPx });
    } catch {
      faces.push({ file, width: 0, height: 0, small: true });
    }
  }
  const warnings = [];
  if (faces.length < minCount) {
    warnings.push(`Mới có ${faces.length}/${minCount} ảnh khuôn mặt HuyK trong ${dir}/ — ảnh AI sẽ dễ lệch mặt. ${FACE_GUIDE_VI}`);
  }
  for (const f of faces.filter((x) => x.small)) {
    warnings.push(`Ảnh ${path.basename(f.file)} nhỏ (${f.width}×${f.height}px, cần cạnh ngắn ≥ ${minPx}px) — mặt dễ bị trôi. Hãy thay bằng ảnh lớn hơn.`);
  }
  return { faces, outfit: { text: config.host.outfit.text, file: outfit }, ready: faces.length >= minCount && !faces.some((f) => f.small), warnings, guide: FACE_GUIDE_VI };
}
