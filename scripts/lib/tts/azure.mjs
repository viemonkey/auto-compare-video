// Adapter Azure AI Speech (REST API chính thức, dự phòng cho Edge TTS).
//   POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1
//   Headers: Ocp-Apim-Subscription-Key, Content-Type: application/ssml+xml, X-Microsoft-OutputFormat, User-Agent
//   Body: SSML. Tài liệu: learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
// REST KHÔNG trả word boundary (chỉ Speech SDK/WebSocket mới có) -> boundaries rỗng; voiceover.mjs ước lượng timing từ thời lượng
// file thật (đo bằng ffprobe) như đã làm cho VieNeu. Khoá lấy từ AZURE_SPEECH_KEY / AZURE_SPEECH_REGION (.env).
import { TtsHttpError } from "./messages.mjs";
import { speedToRate } from "./edge.mjs";

export const AZURE_OUTPUT_FORMAT = "audio-24khz-96kbitrate-mono-mp3";
const REGION_RE = /^[a-z0-9]+$/;

const escapeXml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Mã ngôn ngữ xml:lang lấy từ tên giọng: "ja-JP-KeitaNeural" -> "ja-JP". */
export const langOfVoice = (voice) => voice.split("-").slice(0, 2).join("-");

export function buildSsml({ text, voice, speed }) {
  const lang = langOfVoice(voice);
  return `<speak version='1.0' xml:lang='${lang}'><voice xml:lang='${lang}' name='${escapeXml(voice)}'><prosody rate='${speedToRate(speed)}'>${escapeXml(text)}</prosody></voice></speak>`;
}

export const azureEndpoint = (region) => `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

export function createAzureEngine({ key, region, fetchImpl = globalThis.fetch, timeoutMs = 30_000, userAgent = "auto-compare-video" }) {
  if (!key || !region) throw new Error("Thiếu AZURE_SPEECH_KEY hoặc AZURE_SPEECH_REGION trong .env — không dùng được Azure AI Speech.");
  if (!REGION_RE.test(region)) throw new Error(`AZURE_SPEECH_REGION="${region}" không hợp lệ (vd "eastus", "japaneast", "southeastasia").`);
  return {
    id: "azure",
    supportsBoundaries: false,
    /** @returns {Promise<{audio:Buffer, boundaries:[]}>} */
    async synthesize({ text, voice, speed }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(azureEndpoint(region), {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": AZURE_OUTPUT_FORMAT,
            "User-Agent": userAgent,
          },
          body: buildSsml({ text, voice, speed }),
          signal: controller.signal,
        });
      } catch (e) {
        if (e?.name === "AbortError") throw new Error(`Azure synthesize timeout (${timeoutMs / 1000}s)`);
        throw e;
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new TtsHttpError(res.status, `HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      }
      const audio = Buffer.from(await res.arrayBuffer());
      if (!audio.length) throw new Error("Empty audio buffer returned");
      return { audio, boundaries: [] };
    },
  };
}
