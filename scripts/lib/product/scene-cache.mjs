// Cache ảnh cảnh + kết quả kiểm theo hash đầu vào (model, kích thước, prompt, byte của mọi ảnh tham chiếu, hành động): cùng đầu vào thì KHÔNG gọi lại API.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** Hash của danh sách ảnh tham chiếu ({data: base64}) — đổi 1 byte của ảnh nào là đổi khoá. */
export const hashRefs = (refs) => refs.map((r) => sha256(r.data));

// `variant` = lần thứ mấy cùng một hành động trên cùng cảnh: dựng lại y hệt thì lặp đúng chuỗi khoá (trúng cache),
// còn bấm "Tạo lại" cố ý thì variant tăng -> khoá mới -> gọi API lấy ảnh mới (không trả lại đúng ảnh cũ).
export function imageCacheKey({ model, size, aspectRatio, action, prompt, refHashes, variant = 0 }) {
  return sha256(JSON.stringify({ v: 1, model, size, aspectRatio, action, prompt, refHashes, variant }));
}
export function checkCacheKey({ model, prompt, imageHashes }) {
  return sha256(JSON.stringify({ v: 1, kind: "check", model, prompt, imageHashes }));
}

export function createSceneCache(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (key, ext) => path.join(dir, `${key}${ext}`);
  return {
    dir,
    getImage(key) {
      const meta = file(key, ".json");
      if (!fs.existsSync(meta)) return null;
      try {
        const info = JSON.parse(fs.readFileSync(meta, "utf8"));
        const img = file(key, info.ext || ".png");
        return fs.existsSync(img) ? { buffer: fs.readFileSync(img), ...info } : null;
      } catch {
        return null;
      }
    },
    putImage(key, { buffer, mimeType, ext, model }) {
      fs.writeFileSync(file(key, ext), buffer);
      fs.writeFileSync(file(key, ".json"), JSON.stringify({ ext, mimeType, model, createdAt: new Date().toISOString() }));
    },
    getCheck(key) {
      try {
        return JSON.parse(fs.readFileSync(file(key, ".check.json"), "utf8"));
      } catch {
        return null;
      }
    },
    putCheck(key, result) {
      fs.writeFileSync(file(key, ".check.json"), JSON.stringify(result));
    },
  };
}
