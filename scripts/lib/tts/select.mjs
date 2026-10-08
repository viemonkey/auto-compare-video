// Chọn engine + giọng cho 1 video, hoàn toàn theo CẤU HÌNH (không hard-code tên giọng / thứ tự engine trong code):
//   - config/locales/<code>.json → tts.priority (thứ tự ưu tiên engine) + tts.voices[engine] (giọng mặc định)
//   - config/tts-engines/<id>.json → languages, defaultVoices (dự phòng), requires.env (khoá cần có)
// Thị trường KHÔNG khai báo tts.priority (vi-VN) giữ hành vi cũ: đúng engine người dùng/.env chọn, không tự chuyển.
export const DEFAULT_SPEED = 1.1; // tốc độ đọc mặc định (+10%) — như luồng vi-VN từ trước; đổi bằng locale.tts.speed

/** Giọng cho (engine, locale): ghi đè > locale.tts.voices[engine] > engine.defaultVoices[locale]. Không có -> undefined. */
export function resolveVoice({ engine, locale, override }) {
  if (override && String(override).trim()) return String(override).trim();
  return locale.tts?.voices?.[engine.id] ?? engine.defaultVoices?.[locale.code];
}

export const resolveSpeed = (locale) => locale.tts?.speed ?? DEFAULT_SPEED;

/**
 * Chuỗi engine sẽ thử, theo thứ tự (phần tử đầu dùng trước; lỗi liên tục thì chuyển sang phần tử kế).
 * @param {object} o
 * @param {object} o.locale
 * @param {string} [o.requested]  engine người dùng chọn rõ ràng (UI / --tts-provider / TTS_PROVIDER)
 * @param {Array<object>} o.engines   mọi engine đang bật (listEngines())
 * @param {(engine:object)=>{ready:boolean, reason:string}} o.readiness
 * @returns {{chain:string[], notes:string[]}}
 */
export function planEngines({ locale, requested, engines, readiness }) {
  const byId = new Map(engines.map((e) => [e.id, e]));
  const notes = [];
  const priority = locale.tts?.priority;
  if (!priority) {
    // hành vi cũ (vi-VN): một engine duy nhất; không có yêu cầu -> engine mặc định cũ của template
    return { chain: [requested || "vbee"], notes };
  }
  const usable = (id) => {
    const e = byId.get(id);
    if (!e) return false;
    if (!e.languages.includes(locale.language)) return false;
    const r = readiness(e);
    if (!r.ready) notes.push(`${e.label}: ${r.reason}`);
    return r.ready;
  };
  const ordered = priority.filter(usable);
  let chain = ordered;
  if (requested) {
    const e = byId.get(requested);
    if (e && e.languages.includes(locale.language) && readiness(e).ready) {
      chain = [requested, ...ordered.filter((id) => id !== requested)];
    } else {
      notes.push(`Engine "${requested}" không dùng được cho ${locale.displayName} — chuyển sang thứ tự ưu tiên trong config.`);
    }
  }
  return { chain, notes };
}

/** Engine nào mặc định cho UI của thị trường này (đầu chuỗi ưu tiên đã sẵn sàng); không có -> null. */
export function defaultEngineId({ locale, engines, readiness }) {
  const { chain } = planEngines({ locale, engines, readiness });
  return chain[0] ?? null;
}
