// Đăng 1 video lên Facebook Page qua Graph API — 2 kiểu:
//   - postVideoToPage()  : feed video thường, non-resumable "source" upload, 1 request.
//   - postReelToPage()   : Reels, bắt buộc luồng 3 bước (start/upload/finish) + poll trạng thái
//                          xử lý bất đồng bộ trước khi coi là "đã đăng" — xem hàm bên dưới.
// publishVideo() là điểm vào DUY NHẤT server.mjs nên gọi: tự chọn reel/video theo FB_POST_TYPE,
// tự kiểm tra điều kiện Reels và fallback về video thường nếu không đạt.
//
// Dùng fetch/FormData/fs.openAsBlob global (Node 18+/19+), không cần thêm dependency.
import fs from "node:fs";
import { probeMp4, reelEligibility } from "./mp4-probe.mjs";
import { graphBase, graphVideoBase, makeLogger, redactSecrets } from "./fb-config.mjs";
import { graphErrorFlags } from "./fb-errors.mjs";

const log = makeLogger("facebook");
// Đủ rộng cho video vài chục MB qua kết nối chậm, nhưng vẫn phải có giới hạn — không có timeout
// thì 1 request treo sẽ giữ socialTickInFlight=true mãi ở server.mjs, khoá luôn cả hàng đợi.
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
// Facebook xử lý Reel BẤT ĐỒNG BỘ sau bước "finish" — poll cho tới khi publishing_phase báo
// xong hẳn (complete/error) thay vì tin ngay finish thành công. Video ngắn (30-40s) thường xử lý
// xong trong vài chục giây; 3 phút là biên an toàn trước khi coi là treo/timeout.
const REEL_POLL_INTERVAL_MS = 5_000;
const REEL_POLL_TIMEOUT_MS = 3 * 60_000;

/**
 * @param {{id:string,name:string,accessToken:string}} page
 * @param {string} absoluteVideoPath - đường dẫn TUYỆT ĐỐI trên đĩa
 * @param {string} caption
 * @returns {Promise<{id:string}>}
 */
export async function postVideoToPage(page, absoluteVideoPath, caption) {
  // fs.openAsBlob() STREAM file khi fetch gửi đi, không đọc hết vào RAM như
  // readFileSync+new Blob([buf]) bản trước — quan trọng nếu sau này video dài/nặng hơn.
  const blob = await fs.openAsBlob(absoluteVideoPath, { type: "video/mp4" });
  const form = new FormData();
  form.append("access_token", page.accessToken);
  form.append("description", caption || "");
  form.append("source", blob, "video.mp4");

  const url = `${graphVideoBase()}/${page.id}/videos`;
  let res;
  try {
    res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  } catch (e) {
    if (e.name === "TimeoutError") {
      throw new Error(`Facebook Graph API không phản hồi sau ${UPLOAD_TIMEOUT_MS / 60_000} phút (page "${page.name}").`);
    }
    throw e;
  }
  const json = await res.json().catch(() => null);

  if (!res.ok || !json || json.error) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const err = new Error(redactSecrets(`Facebook Graph API lỗi khi đăng lên "${page.name}": ${msg}`));
    // OAuthException (code 190) = token hết hạn/bị thu hồi/sai quyền — KHÔNG tự khỏi bằng cách
    // thử lại, đánh dấu permanent để recordFailure() dừng ngay thay vì đốt hết MAX_ATTEMPTS lần
    // (mỗi lần chặn luôn các video khác phía sau trong hàng đợi tới khi hết backoff).
    Object.assign(err, graphErrorFlags(json, res.status));
    throw err;
  }
  return { id: json.id };
}

async function graphFormPost(url, fields, { page, step }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  let res;
  try {
    res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  } catch (e) {
    if (e.name === "TimeoutError") {
      throw new Error(`Facebook Graph API không phản hồi sau ${UPLOAD_TIMEOUT_MS / 60_000} phút ở bước "${step}" (page "${page.name}").`);
    }
    throw e;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error || json.success === false) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const err = new Error(redactSecrets(`Facebook Graph API lỗi ở bước "${step}" khi đăng Reel lên "${page.name}": ${msg}`));
    Object.assign(err, graphErrorFlags(json, res.status));
    // "Rõ ràng" = Facebook THỰC SỰ TRẢ LỜI với 1 object error (json.error tồn tại) — phân biệt
    // với response không ok/success:false nhưng KHÔNG có json.error (body rỗng/không parse
    // được...), vốn không thực sự "nói" gì về việc request đã tới Facebook hay chưa. Bước
    // finish() dùng cờ này để quyết định retry hay chuyển sang verifying — xem postReelToPage().
    if (json?.error) err.hasApiErrorJson = true;
    throw err;
  }
  return json;
}

/**
 * Đăng Reel — luồng bắt buộc của Facebook (KHÁC hẳn /videos "source" 1-request): start (xin
 * video_id + upload_url) -> upload byte thô lên upload_url (domain riêng rupload.facebook.com,
 * header Authorization/offset/file_size, không phải multipart) -> finish (publish, caption vào
 * "description") -> POLL /{video_id}?fields=status tới khi publishing_phase xong hẳn. Xem
 * https://developers.facebook.com/docs/video-api/guides/reels-publishing (luồng "Upload Video").
 *
 * @param {{id:string,name:string,accessToken:string}} page
 * @param {string} absoluteVideoPath
 * @param {string} caption
 * @returns {Promise<{id:string}>}
 */
export async function postReelToPage(page, absoluteVideoPath, caption, { onSubmitted } = {}) {
  // onSubmitted(videoId): gọi ngay khi finish đã (hoặc có thể đã) tới Facebook — nơi gọi lưu job
  // sang "verifying" để nếu server tắt giữa chừng, job không bị đăng lại và tạo Reel trùng.
  const notifySubmitted = (id) => {
    try {
      onSubmitted?.(id);
    } catch (e) {
      log.error(`onSubmitted lỗi: ${e.message}`);
    }
  };
  // Phase 1: start
  const startJson = await graphFormPost(
    `${graphBase()}/${page.id}/video_reels`,
    { upload_phase: "start", access_token: page.accessToken },
    { page, step: "start" },
  );
  const videoId = startJson.video_id;
  const uploadUrl = startJson.upload_url;
  if (!videoId || !uploadUrl) {
    throw new Error(`Facebook không trả video_id/upload_url ở bước "start" cho page "${page.name}".`);
  }

  // Phase 2: upload byte thô — fs.openAsBlob() STREAM file, không đọc hết vào RAM (cùng lý do
  // với postVideoToPage()).
  const stat = fs.statSync(absoluteVideoPath);
  const blob = await fs.openAsBlob(absoluteVideoPath, { type: "video/mp4" });
  let uploadRes;
  try {
    uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${page.accessToken}`,
        offset: "0",
        file_size: String(stat.size),
      },
      body: blob,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (e) {
    if (e.name === "TimeoutError") {
      throw new Error(`Upload byte Reel không phản hồi sau ${UPLOAD_TIMEOUT_MS / 60_000} phút (page "${page.name}").`);
    }
    throw e;
  }
  const uploadJson = await uploadRes.json().catch(() => null);
  if (!uploadRes.ok || !uploadJson || uploadJson.success === false) {
    const msg = uploadJson?.error?.message || `HTTP ${uploadRes.status}`;
    const err = new Error(redactSecrets(`Upload byte Reel thất bại (page "${page.name}", video_id=${videoId}): ${msg}`));
    Object.assign(err, graphErrorFlags(uploadJson, uploadRes.status));
    throw err;
  }

  // Phase 3: finish — publish, caption vào "description". video_id đã tồn tại từ bước start (dù
  // finish có thành công hay không) — nếu finish thất bại một cách MƠ HỒ (lỗi mạng/timeout,
  // không có response rõ ràng từ Facebook để biết finish có thực sự tới nơi hay không), KHÔNG
  // retry bằng cách start() lại từ đầu (sẽ tạo video_id MỚI, có thể trùng với video_id cũ nếu
  // finish thực ra ĐÃ thành công phía Facebook) — thay vào đó chuyển thẳng sang verifying với
  // video_id đã có, để checkReelStatus() ở tick sau tự xác nhận. CHỈ retry khi Facebook trả lời
  // RÕ RÀNG bằng 1 JSON lỗi thật (err.hasApiErrorJson, xem graphFormPost()) — kể cả lỗi token
  // (err.permanent) vẫn tính là "rõ ràng", để nơi gọi tự xử lý theo nhánh permanent như cũ.
  try {
    await graphFormPost(
      `${graphBase()}/${page.id}/video_reels`,
      {
        upload_phase: "finish",
        access_token: page.accessToken,
        video_id: videoId,
        video_state: "PUBLISHED",
        description: caption || "",
      },
      { page, step: "finish" },
    );
  } catch (e) {
    if (e.permanent || e.hasApiErrorJson) throw e;
    log.warn(`Bước "finish" cho video_id=${videoId} (page "${page.name}") không có phản hồi rõ ràng (${e.message}) — chuyển sang verifying thay vì retry (tránh tạo video_id trùng).`);
    notifySubmitted(videoId);
    return { id: videoId, outcome: "verifying" };
  }
  notifySubmitted(videoId);

  // finish thành công CHỈ nghĩa là Facebook đã NHẬN — video còn xử lý bất đồng bộ (transcode,
  // kiểm duyệt) phía sau, chưa chắc publish được. TỪ ĐÂY VỀ SAU, Reel với video_id này ĐÃ TỒN
  // TẠI trên Facebook — hàm này SẼ KHÔNG throw nữa (kể cả hết giờ chờ hay lỗi token khi poll):
  // throw ở giai đoạn này sẽ khiến server.mjs hiểu nhầm thành "chưa tạo được gì" và đăng lại từ
  // đầu -> tạo Reel trùng. Poll nhanh 1 đợt (REEL_POLL_TIMEOUT_MS) để trả kết quả ngay nếu Facebook
  // xử lý xong sớm (thường vài chục giây với video ngắn); nếu chưa xong thì trả outcome="verifying"
  // để server.mjs chuyển job sang trạng thái theo dõi nền (xem checkReelStatus() + recordVerifying()
  // trong social-queue.mjs) thay vì coi là lỗi.
  const fast = await pollReelPublishStatusOnce(videoId, page);
  return { id: videoId, ...fast };
}

/**
 * 1 đợt poll NHANH, có ngân sách thời gian (REEL_POLL_TIMEOUT_MS) — dùng ngay sau finish() để
 * trả kết quả tức thì cho trường hợp phổ biến (video ngắn xử lý xong trong vài chục giây).
 * KHÔNG BAO GIỜ throw: mọi lỗi (kể cả token hết hạn) trong lúc poll bị NUỐT và coi như "chưa biết
 * kết quả", hết ngân sách thì trả "verifying" — lỗi thật (kể cả permanent) chỉ được phân loại
 * đúng ở checkVerifyingJobs() phía server.mjs, nơi có thể disablePage() mà không huỷ job.
 *
 * @returns {Promise<{outcome:"complete"}|{outcome:"error",reason:string}|{outcome:"verifying"}>}
 */
async function pollReelPublishStatusOnce(videoId, page) {
  const deadline = Date.now() + REEL_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const result = await checkReelStatus(videoId, page);
      if (result.state === "complete") return { outcome: "complete" };
      if (result.state === "error") return { outcome: "error", reason: result.reason };
      // "pending" — Facebook còn xử lý, thử lại trong ngân sách này
    } catch {
      // network blip / token lỗi / bất kỳ gì — nuốt, không phân loại ở đây (xem comment trên)
    }
    await new Promise((resolve) => setTimeout(resolve, REEL_POLL_INTERVAL_MS));
  }
  return { outcome: "verifying" };
}

function extractPhaseErrorDetail(phase) {
  const first = phase?.errors?.[0];
  if (!first) return null;
  return typeof first === "string" ? first : first.message || JSON.stringify(first);
}

/**
 * 1 lần kiểm tra trạng thái xử lý Reel — dùng cả trong pollReelPublishStatusOnce() (đợt poll
 * nhanh sau finish) LẪN checkVerifyingJobs() ở server.mjs (kiểm tra nền các tick sau). Kiểm tra
 * CẢ processing_phase VÀ publishing_phase báo lỗi — Facebook có thể từ chối video ở bước xử lý
 * (processing, vd sai định dạng/nội dung vi phạm) TRƯỚC KHI tới bước publish.
 *
 * THROW (với err.permanent cho lỗi token) khi tự BẢN THÂN request kiểm tra thất bại — gọi nơi
 * dùng hàm này tự quyết định có coi throw là lỗi thật hay chỉ là "chưa biết, thử lại sau".
 *
 * @returns {Promise<{state:"complete"}|{state:"error",reason:string}|{state:"pending"}>}
 */
export async function checkReelStatus(videoId, page) {
  // Token đi qua header (không nằm trong URL) để không lọt vào log/stack trace.
  const url = `${graphBase()}/${videoId}?fields=status`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${page.accessToken}` }, signal: AbortSignal.timeout(30_000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    const err = new Error(redactSecrets(`Facebook Graph API lỗi khi kiểm tra trạng thái Reel (video_id=${videoId}, page "${page.name}"): ${msg}`));
    Object.assign(err, graphErrorFlags(json, res.status));
    throw err;
  }

  const processing = json.status?.processing_phase;
  const publishing = json.status?.publishing_phase;
  if (processing?.status === "error") {
    return { state: "error", reason: extractPhaseErrorDetail(processing) || "processing_phase báo lỗi không rõ nguyên nhân." };
  }
  if (publishing?.status === "error") {
    return { state: "error", reason: extractPhaseErrorDetail(publishing) || "publishing_phase báo lỗi không rõ nguyên nhân." };
  }
  if (publishing?.status === "complete") {
    return { state: "complete" };
  }
  return { state: "pending" };
}

/**
 * Điểm vào DUY NHẤT nên gọi từ server.mjs. Chọn reel/video theo FB_POST_TYPE (mặc định "reel"),
 * và với "reel" — kiểm tra điều kiện Reels (9:16, 3-90s, xem mp4-probe.mjs) TRƯỚC khi gọi API,
 * không đạt thì tự rơi về postVideoToPage() (feed video thường) và log lý do thay vì để Facebook
 * tự từ chối giữa chừng.
 *
 * @param {{id:string,name:string,accessToken:string}} page
 * @param {string} absoluteVideoPath
 * @param {string} caption
 * @returns {Promise<{id:string, postType:"reel"|"video", outcome:"complete"|"verifying"|"error", reason?:string, fallbackReason?:string}>}
 */
export async function publishVideo(page, absoluteVideoPath, caption, opts = {}) {
  const postType = (process.env.FB_POST_TYPE || "reel").toLowerCase();
  if (postType === "video") {
    const { id } = await postVideoToPage(page, absoluteVideoPath, caption);
    return { id, postType: "video", outcome: "complete" };
  }

  let fallbackReason = null;
  try {
    const probe = probeMp4(absoluteVideoPath);
    const eligibility = reelEligibility(probe);
    if (!eligibility.ok) fallbackReason = eligibility.reason;
  } catch (e) {
    fallbackReason = `Không đọc được metadata video (${e.message})`;
  }

  if (fallbackReason) {
    log.warn(`"${absoluteVideoPath}" không đạt điều kiện Reels — đăng dạng video thường thay thế. Lý do: ${fallbackReason}`);
    const { id } = await postVideoToPage(page, absoluteVideoPath, caption);
    return { id, postType: "video", outcome: "complete", fallbackReason };
  }

  // outcome: "complete" (xử lý xong trong đợt poll nhanh) | "verifying" (chưa xong, cần theo
  // dõi nền) | "error" (Facebook từ chối — Reel ĐÃ TỒN TẠI với video_id này nhưng không publish
  // được, KHÔNG retry bằng cách tạo Reel mới). postReelToPage() không throw cho các trường hợp
  // này nữa (xem comment trong hàm đó) — chỉ throw cho lỗi ở start/upload/finish.
  const { id, outcome, reason } = await postReelToPage(page, absoluteVideoPath, caption, opts);
  return { id, postType: "reel", outcome, reason };
}
