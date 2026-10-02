// Dọn videos/<slug>/ sau khi render xong, chịu được EPERM trên Windows (antivirus / Chrome headless / terminal đang đứng trong thư mục).
//   1. Thử dọn ngay, nếu lỗi thì thử lại vài lần có delay (mặc định 1s, 3s, 5s).
//   2. Vẫn lỗi -> ghi vào danh sách chờ dọn (file JSON, sống qua restart); mỗi tick (1 phút) và lúc khởi động thử lại.
// AN TOÀN: chỉ xoá thư mục NẰM TRONG videosDir và CHỈ khi MP4 thành phẩm output/<slug>.mp4 đang tồn tại (không mất trắng video).
import fs from "node:fs";
import path from "node:path";

export const CLEANUP_DELAYS_MS = [1000, 3000, 5000];
const MIN_MP4_BYTES = 100 * 1024; // cùng ngưỡng với archiveAndCleanup(): nhỏ hơn = nghi render lỗi

const defaultRm = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createCleanupQueue({ file, videosDir, outputDir, log = console, rm = defaultRm, sleep = defaultSleep, delays = CLEANUP_DELAYS_MS }) {
  const root = path.resolve(videosDir);

  const read = () => {
    try {
      const list = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const write = (list) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(list, null, 2));
  };

  const dirOf = (slug) => path.join(root, slug);
  const insideRoot = (dir) => path.resolve(dir).startsWith(root + path.sep);
  const archived = (slug) => {
    try {
      return fs.statSync(path.join(outputDir, `${slug}.mp4`)).size >= MIN_MP4_BYTES;
    } catch {
      return false;
    }
  };

  /** Dọn 1 slug ngay, thử lại theo `delays`. @returns {Promise<{ok:boolean, error?:string}>} */
  async function tryRemove(slug) {
    const dir = dirOf(slug);
    let lastErr = "";
    for (let i = 0; i <= delays.length; i++) {
      try {
        rm(dir);
        return { ok: true };
      } catch (e) {
        lastErr = e.message;
        if (i < delays.length) {
          log.warn(`[cleanup] chưa dọn được ${dir} (${e.code || e.message}) — thử lại sau ${delays[i] / 1000}s (${i + 1}/${delays.length})`);
          await sleep(delays[i]);
        }
      }
    }
    return { ok: false, error: lastErr };
  }

  function enqueue(slug, error = "") {
    const list = read().filter((j) => j.slug !== slug);
    list.push({ slug, since: new Date().toISOString(), attempts: delays.length + 1, lastError: error });
    write(list);
    log.warn(`[cleanup] đang chờ dọn: ${dirOf(slug)} — thử lại mỗi phút và khi khởi động lại (${error})`);
  }

  /** Dọn ngay (có retry); thất bại -> đưa vào danh sách chờ. @returns {Promise<boolean>} đã dọn xong? */
  async function cleanNowOrDefer(slug) {
    const r = await tryRemove(slug);
    if (!r.ok) enqueue(slug, r.error);
    return r.ok;
  }

  /** Thử lại mọi thư mục đang chờ (1 lần mỗi thư mục, không delay). @returns {{removed:string[], pending:string[], dropped:string[]}} */
  function processPending() {
    const out = { removed: [], pending: [], dropped: [] };
    const keep = [];
    for (const job of read()) {
      const dir = dirOf(job.slug);
      if (!insideRoot(dir)) {
        out.dropped.push(job.slug);
        log.warn(`[cleanup] bỏ qua "${job.slug}": đường dẫn không nằm trong videos/.`);
        continue;
      }
      if (!fs.existsSync(dir)) {
        out.removed.push(job.slug);
        continue;
      }
      if (!archived(job.slug)) {
        // MP4 không còn -> thư mục này có thể là bản duy nhất: tuyệt đối không xoá, bỏ khỏi danh sách chờ.
        out.dropped.push(job.slug);
        log.warn(`[cleanup] không dọn ${dir}: không thấy output/${job.slug}.mp4 — giữ nguyên thư mục, bỏ khỏi danh sách chờ.`);
        continue;
      }
      try {
        rm(dir);
        out.removed.push(job.slug);
        log.info?.(`[cleanup] đã dọn xong (lần thử lại): ${dir}`);
      } catch (e) {
        keep.push({ ...job, attempts: (job.attempts || 0) + 1, lastError: e.message });
        out.pending.push(job.slug);
        log.warn(`[cleanup] vẫn đang chờ dọn: ${dir} (${e.code || e.message}) — lần thử ${(job.attempts || 0) + 1}`);
      }
    }
    write(keep);
    return out;
  }

  return { cleanNowOrDefer, processPending, list: read, enqueue };
}

/**
 * Đường dẫn web của MP4 thành phẩm: ưu tiên file đang TỒN TẠI (đã chuyển sang output/ hay còn ở renders/) — để videoPath trong
 * hàng đợi đăng bài không bao giờ trỏ vào file đã bị di chuyển.
 * @param {{outputWeb:string, rendersWeb:string, exists:(webPath:string)=>boolean}} p
 */
export function existingVideoWebPath({ outputWeb, rendersWeb, exists }) {
  if (exists(outputWeb)) return outputWeb;
  if (exists(rendersWeb)) return rendersWeb;
  return outputWeb; // không thấy cả hai: để nơi gọi báo lỗi "file không tồn tại" rõ ràng
}
