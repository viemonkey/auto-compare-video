// Tên model Gemini đang cấu hình (GEMINI_MODEL / GEMINI_FALLBACK_MODEL) + kiểm tra chúng có thật lúc khởi động.
// Nguồn DUY NHẤT để đọc tên model — gemini-client.mjs (rewrite/translate) và generate-compare-content.mjs (sinh nội dung,
// tạo phiên bản thị trường) đều dùng, để mọi lời gọi Gemini đi cùng 1 cặp model chính/dự phòng.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** @returns {{primary:string, fallback:string}} fallback = "" nếu không đặt hoặc trùng model chính (tức là không có dự phòng). */
export function resolveGeminiModels(env = process.env) {
  const primary = String(env.GEMINI_MODEL || "").trim() || DEFAULT_GEMINI_MODEL;
  const fb = String(env.GEMINI_FALLBACK_MODEL || "").trim();
  return { primary, fallback: fb && fb !== primary ? fb : "" };
}

/**
 * Hỏi Google danh sách model (có phân trang) rồi đối chiếu tên đã cấu hình.
 * Không bao giờ ném lỗi: không kiểm tra được (mất mạng, key sai...) chỉ trả `checked:false` + 1 cảnh báo.
 * @param {{env?:object, fetchImpl?:typeof fetch, log?:{warn:Function, info?:Function}}} o
 * @returns {Promise<{checked:boolean, warnings:string[]}>}
 */
export async function validateGeminiModels({ env = process.env, fetchImpl = fetch, log = console } = {}) {
  const key = String(env.GEMINI_API_KEY || "").trim();
  const warnings = [];
  const { primary, fallback } = resolveGeminiModels(env);
  const wanted = [["GEMINI_MODEL", primary], ["GEMINI_FALLBACK_MODEL", fallback], ["IMAGE_GEN_MODEL", String(env.IMAGE_GEN_MODEL || "").trim()]].filter(([, v]) => v);
  if (!key) return { checked: false, warnings };
  if (!String(env.GEMINI_FALLBACK_MODEL || "").trim()) {
    warnings.push("Chưa đặt GEMINI_FALLBACK_MODEL — khi model chính quá tải (503) sẽ báo lỗi thay vì chuyển model dự phòng.");
  } else if (!fallback) {
    warnings.push("GEMINI_FALLBACK_MODEL trùng GEMINI_MODEL — coi như không có model dự phòng.");
  }
  try {
    const names = new Set();
    let pageToken = "";
    for (let page = 0; page < 10; page++) {
      const url = `${MODELS_URL}?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const res = await fetchImpl(url, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      for (const m of json.models || []) names.add(String(m.name || "").replace(/^models\//, ""));
      pageToken = json.nextPageToken || "";
      if (!pageToken) break;
    }
    for (const [envName, model] of wanted) {
      if (!names.has(model)) warnings.push(`${envName}="${model}" không có trong danh sách model của Google — kiểm tra lại tên (gõ sai / model đã đổi tên hoặc bị gỡ).`);
    }
    for (const w of warnings) log.warn(`⚠ [gemini] ${w}`);
    log.info?.(`[gemini] model chính=${primary}${fallback ? `, dự phòng=${fallback}` : ", không có dự phòng"} — ${warnings.length ? "có cảnh báo ở trên" : "tên model hợp lệ"}.`);
    return { checked: true, warnings };
  } catch (e) {
    warnings.push(`Không kiểm tra được tên model Gemini lúc khởi động (${String(e.message).replace(/AIza[0-9A-Za-z_-]{20,}/g, "****")}).`);
    for (const w of warnings) log.warn(`⚠ [gemini] ${w}`);
    return { checked: false, warnings };
  }
}
