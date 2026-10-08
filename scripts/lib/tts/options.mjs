// Danh sách engine + giọng hiển thị ở Bước 1, LỌC THEO THỊ TRƯỜNG: chỉ engine hỗ trợ ngôn ngữ đó, chỉ giọng của thị trường đó.
// Giọng mặc định: config/locales/<code>.json → tts.voices[engine] (nếu có) rồi tới defaultVoices trong config/tts-engines/<id>.json.
import fs from "node:fs";
import path from "node:path";
import { defaultVoiceFor } from "../capabilities.mjs";
import { planEngines } from "./select.mjs";

/** Danh sách giọng của 1 engine cho 1 thị trường (file giọng của engine như VieNeu, hoặc `voices` khai báo trong config). */
export function resolveEngineVoices(engine, locale, repoRoot) {
  const fallback = engine.voiceFallback ? [{ id: engine.voiceFallback.id, label: engine.voiceFallback.label }] : [];
  const fallbackId = engine.voiceFallback?.id ?? null;
  if (engine.voicesFile) {
    const file = path.join(repoRoot, engine.voicesFile);
    if (!fs.existsSync(file)) return { voices: fallback, defaultVoice: fallbackId };
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const presets = data.presets || {};
      const voices = Object.keys(presets).map((name) => {
        const info = presets[name];
        const desc = info.description ? ` (${info.description})` : "";
        return { id: name, label: `${name}${desc}` };
      });
      return { voices, defaultVoice: data.default_voice || defaultVoiceFor(engine, locale.code) || fallbackId };
    } catch {
      return { voices: fallback, defaultVoice: fallbackId };
    }
  }
  const voices = engine.voices?.[locale.code] || [];
  const wanted = locale.tts?.voices?.[engine.id] ?? defaultVoiceFor(engine, locale.code);
  const defaultVoice = voices.some((v) => v.id === wanted) ? wanted : voices[0]?.id || fallbackId;
  return { voices, defaultVoice };
}

/**
 * @returns {{engines:Array<object>, defaultEngine:string|null, message:string}}
 *   engines: chỉ engine hỗ trợ ngôn ngữ của locale (kèm `ready` + lý do nếu chưa sẵn sàng)
 *   defaultEngine: engine đầu tiên dùng được theo thứ tự ưu tiên của thị trường; thị trường không khai báo ưu tiên (vi-VN) -> null (UI giữ mặc định cũ: engine đầu danh sách)
 */
export function ttsOptionsForLocale(locale, { engines, readiness, repoRoot }) {
  const supported = engines.filter((e) => e.languages.includes(locale.language));
  const list = supported.map((e) => {
    const { ready, reason } = readiness(e);
    const { voices, defaultVoice } = resolveEngineVoices(e, locale, repoRoot);
    return { id: e.id, label: e.label, languages: e.languages, supported: true, ready, notReadyReason: reason, modes: e.modes, voices, defaultVoice };
  });
  const defaultEngine = locale.tts?.priority ? planEngines({ locale, engines, readiness }).chain[0] ?? null : null;
  return {
    engines: list,
    defaultEngine,
    message: list.length ? "" : `Chưa có giọng đọc (TTS) nào hỗ trợ ${locale.displayName} (${locale.language}).`,
  };
}
