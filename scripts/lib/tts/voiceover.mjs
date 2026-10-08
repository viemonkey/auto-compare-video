// Sinh giọng đọc cho toàn bộ dòng thoại của 1 video bằng engine "đọc từng câu" (Edge, Azure): cache theo hash, thử lại có lùi dần,
// tự chuyển engine dự phòng, cắt khoảng lặng theo word boundary, ghi durations.json + words.json (đúng định dạng luồng vi-VN)
// và dòng cost-ledger (task "tts"). Mọi phụ thuộc ngoài (engine, ffmpeg, cache, sổ chi phí, sleep) được TIÊM vào nên test không cần mạng.
import fs from "node:fs";
import path from "node:path";
import { alignBoundaries, estimateTokens } from "../../../public/shared/caption-chunk.mjs";
import { countGraphemes } from "../../../public/shared/text-length.mjs";
import { ttsCacheKey } from "./cache.mjs";
import { withRetry } from "./retry.mjs";
import { ttsErrorMessage } from "./messages.mjs";

// Cắt khoảng lặng so với từ ĐẦU/CUỐI theo word boundary (cùng nguồn với timing karaoke nên hai thứ khớp nhau) và chừa lề nhỏ.
// Giữ đúng các hằng số của luồng vi-VN (xem templates/auto-compare/generate-vo.mjs: TL_START1 / TL_GAP / TL_OUTRO ở phía scaffold).
export const TRIM_LEAD = 0.08;
export const TRIM_TRAIL = 0.14;
const tickToSec = (t) => t / 1e7;
const round3 = (n) => Math.round(n * 1000) / 1000;

/** Engine hỏng liên tục (đã hết lượt thử lại) — voiceover sẽ chuyển sang engine kế tiếp nếu còn. */
export class EngineFailure extends Error {
  constructor(engineId, cause, lineId) {
    super(ttsErrorMessage(engineId, cause));
    this.name = "EngineFailure";
    this.engineId = engineId;
    this.cause = cause;
    this.lineId = lineId;
  }
}

/** Timing ƯỚC LƯỢNG cho clip không có word boundary: chia đều thời lượng tiếng nói theo số ký tự của từng token. */
export function estimateWordTimings(tokens, speechStart, speechEnd) {
  const weights = tokens.map((t) => Math.max(1, countGraphemes(t)));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0.05, speechEnd - speechStart);
  let at = speechStart;
  return tokens.map((t, i) => {
    const d = (span * weights[i]) / total;
    const w = { t, s: round3(at), d: round3(d) };
    at += d;
    return w;
  });
}

/**
 * @param {object} o
 * @param {Array<{id:string,text:string}>} o.lines
 * @param {object} o.locale
 * @param {string[]} o.chain                thứ tự engine sẽ thử
 * @param {Record<string,object>} o.engines  id -> engine (đã khởi tạo)
 * @param {(engineId:string)=>string} o.voiceFor
 * @param {number} o.speed
 * @param {string} o.outDir                  assets/vo
 * @param {{get:Function,put:Function}} o.cache
 * @param {{probeDuration:Function,trimClip:Function,detectSpeech:Function}} o.tools
 * @param {(entry:object)=>void} [o.ledger]  appendCostEntry
 * @param {(engineId:string, characters:number)=>number} [o.costOf]
 * @param {string|null} [o.slug]
 * @param {(msg:string)=>void} [o.log]
 * @param {object} [o.retry]                 tuỳ chọn withRetry (sleep/random/maxRetries...)
 * @param {(ms:number)=>Promise<void>} [o.pace]   nghỉ ngắn giữa 2 lần gọi dịch vụ thật (lịch sự với endpoint công khai)
 */
export async function runVoiceover(o) {
  const log = o.log || (() => {});
  let lastError;
  for (const [i, engineId] of o.chain.entries()) {
    try {
      const result = await runWithEngine({ ...o, engineId, log });
      return { ...result, switchedFrom: i > 0 ? o.chain.slice(0, i) : [] };
    } catch (e) {
      if (!(e instanceof EngineFailure)) throw e;
      lastError = e;
      const next = o.chain[i + 1];
      if (!next) break;
      log(`⚠ ${e.message} (dòng ${e.lineId}) — engine "${engineId}" lỗi liên tục, TỰ CHUYỂN sang "${next}" và đọc lại toàn bộ video bằng giọng đó để cả video cùng một giọng.`);
    }
  }
  throw new Error(lastError ? lastError.message : "Không có engine giọng đọc nào để chạy.");
}

async function runWithEngine({ lines, locale, engineId, engines, voiceFor, speed, outDir, cache, tools, ledger, costOf, slug, log, retry = {}, pace }) {
  const engine = engines[engineId];
  if (!engine) throw new Error(`Engine giọng đọc "${engineId}" chưa được khởi tạo.`);
  const voice = voiceFor(engineId);
  if (!voice) throw new Error(`Chưa chọn được giọng cho engine "${engineId}" ở thị trường ${locale.displayName} — đặt trong config/locales/${locale.code}.json (tts.voices) hoặc config/tts-engines/${engineId}.json (defaultVoices).`);
  log(`TTS: engine=${engineId}, giọng=${voice}, tốc độ=${speed}`);

  const rawDir = path.join(outDir, ".raw");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const durations = {};
  const words = {};
  const stats = { synthesized: 0, cached: 0, characters: 0 };

  for (const line of lines) {
    const rawPath = path.join(rawDir, `${line.id}.mp3`);
    const finalPath = path.join(outDir, `${line.id}.mp3`);
    const key = ttsCacheKey({ engine: engineId, voice, speed, text: line.text });
    const characters = [...line.text].length;

    let hit = cache.get(key);
    if (hit) {
      stats.cached++;
      log(`  ${line.id}: dùng lại audio đã đọc (cache) — "${line.text.slice(0, 40)}"`);
    } else {
      try {
        const out = await withRetry(() => engine.synthesize({ text: line.text, voice, speed }), {
          ...retry,
          onRetry: ({ attempt, maxRetries, error, waitMs }) =>
            log(`  [Thử lại ${attempt}/${maxRetries} cho ${line.id}] ${ttsErrorMessage(engineId, error)} — chờ ${waitMs}ms`),
        });
        cache.put(key, out, { engine: engineId, voice, speed, text: line.text });
        hit = out;
        stats.synthesized++;
        stats.characters += characters;
        if (ledger) ledger({ slug, locale: locale.code, task: "tts", engine: engineId, voice, characters, model: null, status: "success", costUsd: costOf ? costOf(engineId, characters) : 0 });
        if (pace) await pace();
      } catch (cause) {
        if (ledger) ledger({ slug, locale: locale.code, task: "tts", engine: engineId, voice, characters, model: null, status: "error", costUsd: 0, errorMessage: String(cause?.message || cause).slice(0, 300), attempt: cause?.attempts });
        throw new EngineFailure(engineId, cause, line.id);
      }
      log(`  ${line.id}: đã đọc bằng ${engineId} (${characters} ký tự)`);
    }

    fs.writeFileSync(rawPath, hit.audio);
    const rawDur = await tools.probeDuration(rawPath);
    const b = hit.boundaries || [];
    let trimStart = 0;
    let trimEnd = rawDur;
    if (b.length) {
      trimStart = Math.max(0, tickToSec(b[0].offset) - TRIM_LEAD);
      trimEnd = Math.min(rawDur, tickToSec(b.at(-1).offset + b.at(-1).duration) + TRIM_TRAIL);
    } else {
      const speech = await tools.detectSpeech(rawPath);
      if (speech) {
        trimStart = Math.max(0, speech.start - TRIM_LEAD);
        trimEnd = Math.min(rawDur, speech.end + TRIM_TRAIL);
      }
    }
    if (trimEnd - trimStart < 0.05 || (trimStart === 0 && trimEnd === rawDur)) fs.copyFileSync(rawPath, finalPath);
    else await tools.trimClip(rawPath, finalPath, trimStart, trimEnd - trimStart);

    const dur = await tools.probeDuration(finalPath);
    durations[line.id] = round3(dur);

    if (b.length) {
      // Token hiển thị = chữ gốc (kèm dấu câu dính liền) khớp với từng word boundary của engine
      const { tokens, misses } = alignBoundaries(line.text, b.map((w) => w.text));
      if (misses) log(`  ⚠ ${line.id}: ${misses} từ do engine trả về không tìm thấy trong câu gốc — dùng nguyên chữ engine.`);
      words[line.id] = b.map((w, k) => ({
        t: tokens[k],
        s: round3(Math.max(0, tickToSec(w.offset) - trimStart)),
        d: round3(tickToSec(w.duration)),
      }));
    } else {
      const tokens = estimateTokens(line.text, { language: locale.language, mode: locale.layout.lineBreak.mode });
      words[line.id] = estimateWordTimings(tokens, Math.min(TRIM_LEAD, dur / 4), Math.max(0.1, dur - TRIM_TRAIL));
    }
  }

  fs.writeFileSync(path.join(outDir, "durations.json"), JSON.stringify(durations, null, 2));
  fs.writeFileSync(path.join(outDir, "words.json"), JSON.stringify(words, null, 2));
  return { engineId, voice, durations, words, stats };
}
