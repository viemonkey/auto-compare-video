// Phân loại lỗi Graph API. Cờ được gắn lên Error để social-queue/server quyết định retry.
//   permanent   : token hết hạn/bị thu hồi (OAuthException / code 190) -> tắt page
//   rateLimited : bị throttle (code 4, 17, 32, 613, ...) -> backoff dài, KHÔNG tính vào attempts
//   file_missing: file MP4 mất -> failed luôn
//   transient   : còn lại (5xx, mạng, timeout) -> retry backoff thường
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 368, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);

export function graphErrorFlags(json, httpStatus) {
  const e = json?.error;
  const rateLimited = !!e && (RATE_LIMIT_CODES.has(e.code) || RATE_LIMIT_CODES.has(e.error_subcode)) || httpStatus === 429;
  // Code 4/17/32/613 cũng mang type "OAuthException" nhưng là throttle chứ không phải token hỏng.
  const permanent = !rateLimited && (e?.type === "OAuthException" || e?.code === 190);
  return { permanent, rateLimited };
}

export function classifyError(err) {
  if (err?.fileMissing) return "file_missing";
  if (err?.permanent) return "permanent";
  if (err?.rateLimited) return "rate_limit";
  return "transient";
}
