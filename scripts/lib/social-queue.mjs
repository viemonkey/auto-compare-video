// Hàng đợi đăng Facebook + lịch sử đăng từng Page — JSON đơn giản, đọc/ghi toàn bộ file mỗi
// lần thay đổi (file nhỏ, tần suất ghi thấp).
//
// Độ tin cậy:
//  - Ghi nguyên tử: ghi file tạm rồi rename, crash/tắt máy giữa chừng không để file dở dang.
//  - Mọi thao tác đọc-sửa-ghi đi qua updateQueue(): chạy ĐỒNG BỘ từ đầu tới cuối nên không thể
//    xen kẽ với thao tác khác trong process (Node đơn luồng); cờ `updating` chặn gọi lồng nhau.
//  - File JSON hỏng được đổi tên thành social-queue.corrupt-<timestamp>.json, khởi tạo queue rỗng.
//
// KHÔNG throw khi đọc/ghi lỗi — đăng bài mạng xã hội là tính năng phụ, không được làm hỏng
// pipeline dựng video chính (cùng triết lý với scripts/lib/cost-ledger.mjs).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeLogger, redactSecrets } from "./fb-config.mjs";

const log = makeLogger("queue");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
// SOCIAL_QUEUE_PATH cho phép test trỏ sang file tạm; production dùng data/social-queue.json.
export const SOCIAL_QUEUE_PATH = process.env.SOCIAL_QUEUE_PATH || path.join(REPO_ROOT, "data", "social-queue.json");

const MAX_ATTEMPTS = 5;
// Backoff giữa các lần THỬ LẠI 1 job lỗi thường (khác khoảng nghỉ 30-60p giữa 2 lần đăng lên CÙNG
// 1 page). Tăng dần theo số lần thử, chặn trần 30 phút.
export function retryBackoffMinutes(attempts) {
  return Math.min(2 ** attempts, 30);
}

// Rate limit của Facebook: chờ lâu hơn lỗi thường và KHÔNG tính vào MAX_ATTEMPTS.
export function rateLimitBackoffMinutes(env = process.env) {
  const v = Number(env.FB_RATE_LIMIT_BACKOFF_MINUTES);
  return Math.max(15, Number.isFinite(v) && v > 0 ? v : 30);
}

function emptyState() {
  return { queue: [], pageHistory: {}, posts: [], disabledPages: {} };
}

function normalize(data) {
  return {
    queue: Array.isArray(data.queue) ? data.queue : [],
    pageHistory: data.pageHistory && typeof data.pageHistory === "object" ? data.pageHistory : {},
    posts: Array.isArray(data.posts) ? data.posts : [],
    disabledPages: data.disabledPages && typeof data.disabledPages === "object" ? data.disabledPages : {},
  };
}

export function loadQueue() {
  let raw;
  try {
    if (!fs.existsSync(SOCIAL_QUEUE_PATH)) return emptyState();
    raw = fs.readFileSync(SOCIAL_QUEUE_PATH, "utf8");
  } catch (e) {
    log.error(`Không đọc được ${SOCIAL_QUEUE_PATH}: ${e.message} — dùng trạng thái rỗng (KHÔNG ghi đè file).`);
    return emptyState();
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("JSON gốc không phải object");
    return normalize(data);
  } catch (e) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(path.dirname(SOCIAL_QUEUE_PATH), `social-queue.corrupt-${ts}.json`);
    try {
      fs.renameSync(SOCIAL_QUEUE_PATH, backup);
      log.error(`${SOCIAL_QUEUE_PATH} bị hỏng (${e.message}) — đã backup thành ${backup}, khởi tạo queue rỗng.`);
    } catch (e2) {
      log.error(`${SOCIAL_QUEUE_PATH} bị hỏng (${e.message}) và không backup được (${e2.message}) — khởi tạo queue rỗng.`);
    }
    return emptyState();
  }
}

// Fingerprint (không phải token thật) để so sánh "token trong .env hiện tại" với "token đã bị
// gắn cờ lỗi lúc disablePage() chạy" — KHÔNG lưu token thật vào social-queue.json.
export function fingerprintToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex").slice(0, 16);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function saveQueue(data) {
  const tmp = `${SOCIAL_QUEUE_PATH}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(SOCIAL_QUEUE_PATH), { recursive: true });
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // Windows: antivirus/indexer thỉnh thoảng giữ handle khiến rename EPERM/EBUSY trong vài ms.
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, SOCIAL_QUEUE_PATH);
        break;
      } catch (e) {
        if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(e.code)) throw e;
        sleepSync(50 * (attempt + 1));
      }
    }
    return true;
  } catch (e) {
    log.error(`Không ghi được ${SOCIAL_QUEUE_PATH}: ${e.message}`);
    fs.rmSync(tmp, { force: true });
    return false;
  }
}

let updating = false;
/**
 * Đọc-sửa-ghi tuần tự. `fn(data)` sửa `data` tại chỗ và trả về kết quả; trả về `SKIP_SAVE` (đặt
 * qua `updateQueue.skip`) nếu không đổi gì. Trả `{result, saved}`.
 */
export function updateQueue(fn) {
  if (updating) throw new Error("updateQueue gọi lồng nhau");
  updating = true;
  try {
    const data = loadQueue();
    const result = fn(data);
    if (result === SKIP_SAVE) return { result: false, saved: false };
    return { result, saved: saveQueue(data) };
  } finally {
    updating = false;
  }
}
const SKIP_SAVE = Symbol("skip-save");

/**
 * @param {object} job
 * @param {string} job.slug
 * @param {string} job.videoPath - đường dẫn TUYỆT ĐỐI trên đĩa tới file MP4
 * @param {string} job.caption - title (câu hook); caption đăng thật = title + hashtag, dựng lúc đăng
 * @param {Array<{tag:string,tier:string,manual?:boolean}>} [job.hashtags] - plan hashtag (xem hashtags.mjs);
 *   thiếu (job cũ/video cũ) thì đăng đúng `caption` như trước
 * @returns item mới, hoặc null nếu slug đã đăng / đang chờ đăng
 */
export function enqueueVideo({ slug, videoPath, caption, hashtags, locale }) {
  return updateQueue((data) => {
    // Slug đã đăng, hoặc đang chờ/đang verify -> không enqueue trùng. Render lại cùng slug ghi đè
    // output/<slug>.mp4 nên job pending sẵn có tự đăng bản mới.
    if (data.posts.some((p) => p.slug === slug)) return SKIP_SAVE;
    if (data.queue.some((j) => j.slug === slug && (j.status === "pending" || j.status === "verifying"))) return SKIP_SAVE;
    const item = {
      id: crypto.randomUUID(),
      slug,
      videoPath,
      caption: caption || slug,
      hashtags: Array.isArray(hashtags) && hashtags.length ? hashtags : null,
      locale: locale || null, // thị trường của video; job cũ thiếu -> thị trường mặc định (xem jobLocale)
      addedAt: new Date().toISOString(),
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
    };
    data.queue.push(item);
    return item;
  }).result || null;
}

// ---------------------------------------------------------------------------------------------
// Thị trường (locale) <-> page: video chỉ được đăng lên page CÙNG locale. Kiểm ở CẢ lúc enqueue lẫn lúc chọn page để đăng
// (dữ liệu queue cũ không có locale = thị trường mặc định).
// ---------------------------------------------------------------------------------------------
/** Thị trường của 1 job (job cũ thiếu `locale` = mặc định). */
export const jobLocale = (job, defaultCode) => job.locale || defaultCode;

/** Các page thuộc đúng thị trường `localeCode` (page thiếu locale = mặc định). */
export function pagesForLocale(pages, localeCode, defaultCode) {
  return pages.filter((p) => (p.locale || defaultCode) === (localeCode || defaultCode));
}

/** Ném lỗi nếu page KHÔNG cùng thị trường với job — chốt chặn cuối trước khi đăng. */
export function assertPageMatchesJob(page, job, defaultCode) {
  const pl = page.locale || defaultCode;
  const jl = jobLocale(job, defaultCode);
  if (pl !== jl) throw new Error(`Chặn đăng nhầm: video "${job.slug}" thuộc thị trường ${jl} nhưng page "${page.name}" thuộc ${pl}.`);
}

/**
 * Enqueue có kiểm tra thị trường: không có page nào cùng locale -> KHÔNG enqueue, trả lý do rõ ràng.
 * @returns {{status:"enqueued", item:object}|{status:"duplicate"}|{status:"no-page-for-locale", reason:string}}
 */
export function tryEnqueueVideo(job, { pages, defaultCode }) {
  const locale = job.locale || defaultCode;
  if (!pagesForLocale(pages, locale, defaultCode).length) {
    return { status: "no-page-for-locale", reason: `Không có page nào cấu hình thị trường ${locale} (FB_PAGE_n_LOCALE) — không thêm "${job.slug}" vào hàng đợi đăng.` };
  }
  const item = enqueueVideo({ ...job, locale });
  return item ? { status: "enqueued", item } : { status: "duplicate" };
}

/**
 * Chọn (job, page) để đăng ở tick này. Duyệt job pending theo thứ tự; mỗi job chỉ xét page CÙNG thị trường. Job mà thị trường của nó
 * không có page nào được cấu hình -> trả trong `orphaned` (caller đánh dấu lỗi rõ ràng) và KHÔNG chặn job phía sau.
 * @returns {{job:object|null, page:object|null, orphaned:object[]}}
 */
export function selectJobAndPage(queue, pages, pageHistory, minGap, maxGap, disabledPages, defaultCode, now = Date.now(), rand = Math.random) {
  const orphaned = [];
  for (const job of queue) {
    if (job.status !== "pending" || (job.nextAttemptAt && Date.parse(job.nextAttemptAt) > now)) continue;
    const candidates = pagesForLocale(pages, jobLocale(job, defaultCode), defaultCode);
    if (!candidates.length) {
      orphaned.push(job);
      continue;
    }
    const page = pickEligiblePage(candidates, pageHistory, minGap, maxGap, disabledPages, now, rand);
    if (page) {
      assertPageMatchesJob(page, job, defaultCode);
      return { job, page, orphaned };
    }
  }
  return { job: null, page: null, orphaned };
}

function randomGapMs(minMinutes, maxMinutes) {
  const lo = Math.min(minMinutes, maxMinutes);
  const hi = Math.max(minMinutes, maxMinutes);
  const minutes = lo + Math.random() * (hi - lo);
  return minutes * 60_000;
}

/**
 * Chọn NGẪU NHIÊN 1 page trong số các page đã "nghỉ" đủ lâu kể từ lần đăng gần nhất (khoảng
 * nghỉ được bốc ngẫu nhiên MỖI LẦN gọi, dao động 30-60 phút), TRỪ page đang bị disablePage() gắn
 * cờ với CÙNG token hiện tại — nếu .env đã đổi FB_PAGE_n_ACCESS_TOKEN (khác fingerprint) thì coi
 * như page đã được sửa xong, tự động cho vào lại.
 *
 * @param {Array<{id:string,name:string,accessToken:string}>} pages
 * @param {object} pageHistory
 * @param {number} minGapMinutes
 * @param {number} maxGapMinutes
 * @param {object} [disabledPages]
 * @param {number} [now]
 * @param {() => number} [rand] - chỉ để test
 */
export function pickEligiblePage(pages, pageHistory, minGapMinutes, maxGapMinutes, disabledPages = {}, now = Date.now(), rand = Math.random) {
  const eligible = pages.filter((p) => {
    const disabled = disabledPages[p.id];
    if (disabled && disabled.tokenFingerprint === fingerprintToken(p.accessToken)) return false;
    const last = pageHistory[p.id]?.lastPostedAt;
    if (!last) return true;
    const lastMs = Date.parse(last);
    if (Number.isNaN(lastMs)) return true;
    const lo = Math.min(minGapMinutes, maxGapMinutes);
    const hi = Math.max(minGapMinutes, maxGapMinutes);
    return now - lastMs >= (lo + rand() * (hi - lo)) * 60_000;
  });
  if (!eligible.length) return null;
  return eligible[Math.floor(rand() * eligible.length)];
}

/**
 * Tắt 1 page (không chọn ở pickEligiblePage() nữa) sau lỗi VĨNH VIỄN (token hết hạn/bị thu hồi).
 * Job đang đăng dở được GIỮ NGUYÊN "pending" nên tick kế tiếp tự thử trên page KHÁC.
 *
 * Bật lại: sửa FB_PAGE_n_ACCESS_TOKEN đúng trong .env rồi khởi động lại server (fingerprint đổi
 * -> tự nhận ra). Ép bật lại không đổi token: xoá entry disabledPages["<pageId>"] trong
 * data/social-queue.json.
 */
export function disablePage(page, reason) {
  return updateQueue((data) => {
    data.disabledPages[page.id] = {
      pageName: page.name,
      disabledAt: new Date().toISOString(),
      reason: redactSecrets(reason || "") || null,
      tokenFingerprint: fingerprintToken(page.accessToken),
    };
    return true;
  }).saved;
}

/** Page đang bị tắt VỚI token hiện tại (đã đổi token thì không còn tính là bị tắt). */
export function listDisabledPages(pages, disabledPages) {
  const out = [];
  for (const p of pages) {
    const d = disabledPages[p.id];
    if (d && d.tokenFingerprint === fingerprintToken(p.accessToken)) {
      out.push({ pageId: p.id, pageName: d.pageName || p.name, disabledAt: d.disabledAt, reason: d.reason });
    }
  }
  return out;
}

/** Bản trả ra API: bỏ fingerprint token, che mọi chuỗi giống token. */
export function publicQueueState(data = loadQueue()) {
  const disabledPages = {};
  for (const [id, d] of Object.entries(data.disabledPages)) {
    disabledPages[id] = { pageName: d.pageName, disabledAt: d.disabledAt, reason: d.reason };
  }
  return JSON.parse(redactSecrets(JSON.stringify({ ...data, disabledPages })));
}

/**
 * @param {string} queueItemId
 * @param {{id:string,name:string,accessToken:string}} page
 * @param {string} fbPostId
 * @param {{postType?: "reel"|"video", fallbackReason?: string, thumbnail?: object, caption?: string}} [meta]
 *   caption = caption THỰC TẾ đã đăng (title + hashtag đã random hoá)
 */
export function recordPost(queueItemId, page, fbPostId, meta = {}) {
  return updateQueue((data) => {
    const idx = data.queue.findIndex((j) => j.id === queueItemId);
    if (idx === -1) return SKIP_SAVE;
    const [item] = data.queue.splice(idx, 1);
    const now = new Date().toISOString();
    data.posts.push({
      id: item.id,
      slug: item.slug,
      pageId: page.id,
      pageName: page.name,
      postedAt: now,
      fbPostId: fbPostId || null,
      postType: meta.postType || null,
      fallbackReason: meta.fallbackReason || null,
      thumbnail: meta.thumbnail || null,
      caption: meta.caption ?? item.caption ?? null,
    });
    data.pageHistory[page.id] = { lastPostedAt: now };
    return true;
  }).result;
}

// Trần thời gian THEO DÕI NỀN cho 1 Reel đang "verifying" (tính từ recordVerifying()) — hết hạn
// mà Facebook vẫn chưa báo complete/error thì chốt "failed", không tự ý coi là thành công.
/**
 * Chuyển job sang "verifying" (Reel đã tồn tại trên Facebook — video_id thật — nhưng chưa biết
 * kết quả publish). CỐ TÌNH cập nhật pageHistory NGAY TẠI ĐÂY (thời điểm nộp bài) để giữ khoảng
 * nghỉ 30-60p giữa 2 lần đăng lên CÙNG 1 page. Gọi lại nhiều lần an toàn (idempotent).
 */
export function recordVerifying(queueItemId, page, fbVideoId, meta = {}) {
  return updateQueue((data) => {
    const item = data.queue.find((j) => j.id === queueItemId);
    if (!item) return SKIP_SAVE;
    const now = new Date().toISOString();
    if (item.status !== "verifying") item.verifyStartedAt = now;
    item.status = "verifying";
    item.fbVideoId = fbVideoId;
    item.verifyPageId = page.id;
    item.verifyPageName = page.name;
    item.postType = meta.postType || "reel";
    if (meta.caption) item.postedCaption = meta.caption;
    item.nextAttemptAt = null;
    data.pageHistory[page.id] = { lastPostedAt: item.verifyStartedAt };
    return true;
  }).result;
}

/** Chốt THÀNH CÔNG 1 job "verifying". KHÔNG đụng pageHistory — đã set ở recordVerifying(). */
export function finalizeVerifiedPost(queueItemId, fbVideoId, meta = {}) {
  return updateQueue((data) => {
    const idx = data.queue.findIndex((j) => j.id === queueItemId);
    if (idx === -1) return SKIP_SAVE;
    const [item] = data.queue.splice(idx, 1);
    data.posts.push({
      id: item.id,
      slug: item.slug,
      pageId: item.verifyPageId,
      pageName: item.verifyPageName,
      postedAt: new Date().toISOString(),
      fbPostId: fbVideoId || item.fbVideoId || null,
      postType: item.postType || "reel",
      fallbackReason: null,
      thumbnail: meta.thumbnail || null,
      caption: item.postedCaption ?? item.caption ?? null,
    });
    return true;
  }).result;
}

/**
 * Chốt THẤT BẠI VĨNH VIỄN 1 job — lỗi SAU KHI Reel đã tồn tại, hoặc file mất. KHÔNG cộng dồn
 * attempts: job không quay lại "pending" (sẽ tạo Reel MỚI trùng nếu đăng lại).
 */
export function failJobTerminal(queueItemId, reason) {
  return updateQueue((data) => {
    const item = data.queue.find((j) => j.id === queueItemId);
    if (!item) return SKIP_SAVE;
    item.status = "failed";
    item.lastError = redactSecrets(reason);
    item.nextAttemptAt = null;
    return true;
  }).result;
}

export function verifyingJobs(queue) {
  return queue.filter((j) => j.status === "verifying");
}

/**
 * @param {string} queueItemId
 * @param {Error & {permanent?: boolean, rateLimited?: boolean}} err
 *   - permanent: dừng ngay (failed).
 *   - rateLimited: backoff dài (>=15p), KHÔNG tăng attempts.
 *   - còn lại: tăng attempts, backoff luỹ thừa, tới MAX_ATTEMPTS thì failed.
 */
export function recordFailure(queueItemId, err, now = Date.now()) {
  return updateQueue((data) => {
    const item = data.queue.find((j) => j.id === queueItemId);
    if (!item) return SKIP_SAVE;
    item.lastError = redactSecrets(err?.message || String(err));
    if (err?.rateLimited && !err?.permanent) {
      item.nextAttemptAt = new Date(now + rateLimitBackoffMinutes() * 60_000).toISOString();
      return true;
    }
    item.attempts = (item.attempts || 0) + 1;
    if (err?.permanent || item.attempts >= MAX_ATTEMPTS) {
      item.status = "failed";
      item.nextAttemptAt = null;
    } else {
      item.nextAttemptAt = new Date(now + retryBackoffMinutes(item.attempts) * 60_000).toISOString();
    }
    return true;
  }).result;
}

// Job "pending" TIẾP THEO đủ điều kiện thử (chưa tới job nào, hoặc đã tới giờ retry). KHÔNG chọn
// job "failed" — nằm im trong queue để còn hiện trạng thái lỗi ở UI.
export function nextPendingJob(queue, now = Date.now()) {
  return queue.find((j) => j.status === "pending" && (!j.nextAttemptAt || Date.parse(j.nextAttemptAt) <= now)) || null;
}

// Trần thời gian theo dõi nền 1 Reel "verifying" (tính từ recordVerifying(), không tính đợt poll
// nhanh sau finish). Hết hạn mà Facebook chưa báo complete/error thì chốt "failed".
export function verifyTimeoutMs(env = process.env) {
  const m = Number(env.FB_VERIFY_TIMEOUT_MINUTES);
  return (m > 0 ? m : 30) * 60_000;
}
