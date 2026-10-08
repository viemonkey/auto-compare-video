// Cache audio TTS theo hash (engine + giọng + tốc độ + chữ): sửa 1 dòng chỉ đọc lại đúng dòng đó, dựng lại video không tốn gì.
// Lưu bản GỐC chưa cắt khoảng lặng (mp3) + word boundary thô; việc cắt/timeline chạy lại mỗi lần (rẻ, xác định).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Thư mục cache: TTS_CACHE_DIR (env) hoặc output/tts-cache ở gốc repo (output/ đã nằm trong .gitignore). */
export const defaultCacheDir = () => process.env.TTS_CACHE_DIR || path.join(__dirname, "..", "..", "..", "output", "tts-cache");

// Đổi phiên bản khi cách sinh/bố cục file cache đổi, để cache cũ không bị dùng nhầm.
const CACHE_VERSION = 1;

/** Khoá cache — cùng (engine, voice, speed, text) luôn ra cùng khoá. */
export function ttsCacheKey({ engine, voice, speed, text }) {
  const payload = JSON.stringify([CACHE_VERSION, String(engine), String(voice), Number(speed), String(text)]);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function createTtsCache(dir = defaultCacheDir()) {
  const files = (key) => ({ audio: path.join(dir, `${key}.mp3`), meta: path.join(dir, `${key}.json`) });
  return {
    dir,
    /** @returns {{audio:Buffer, boundaries:Array}|null} */
    get(key) {
      const f = files(key);
      try {
        const meta = JSON.parse(fs.readFileSync(f.meta, "utf8"));
        const audio = fs.readFileSync(f.audio);
        if (!audio.length || meta.version !== CACHE_VERSION) return null;
        return { audio, boundaries: Array.isArray(meta.boundaries) ? meta.boundaries : [] };
      } catch {
        return null;
      }
    },
    put(key, { audio, boundaries }, info = {}) {
      const f = files(key);
      fs.mkdirSync(dir, { recursive: true });
      // ghi file tạm rồi đổi tên: tiến trình khác không bao giờ đọc phải bản ghi dở
      const tmpAudio = `${f.audio}.${process.pid}.tmp`;
      fs.writeFileSync(tmpAudio, audio);
      fs.renameSync(tmpAudio, f.audio);
      fs.writeFileSync(f.meta, JSON.stringify({ version: CACHE_VERSION, ...info, boundaries: boundaries || [], createdAt: new Date().toISOString() }));
    },
  };
}
