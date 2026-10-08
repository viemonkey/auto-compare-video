// Engine Edge TTS (Microsoft Edge "Read aloud", miễn phí, không cần khoá) qua thư viện edge-tts-universal.
// Class EdgeTTS được TIÊM vào (thư viện cài trong node_modules của từng video) nên module này không phụ thuộc gói đó khi test.
// Trả word boundary thật: [{text, offset, duration}] (đơn vị 100ns, offset tính từ đầu clip CHƯA cắt).

/** speed 1.1 -> "+10%". */
export const speedToRate = (speed) => {
  const pct = Math.round((speed - 1) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
};

export function createEdgeEngine({ EdgeTTS, timeoutMs = 20_000 }) {
  return {
    id: "edge",
    supportsBoundaries: true,
    /** @returns {Promise<{audio:Buffer, boundaries:Array<{text:string,offset:number,duration:number}>}>} */
    async synthesize({ text, voice, speed }) {
      const tts = new EdgeTTS(text, voice, { rate: speedToRate(speed) });
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`EdgeTTS synthesize timeout (${timeoutMs / 1000}s)`)), timeoutMs);
      });
      try {
        const result = await Promise.race([tts.synthesize(), timeout]);
        const audio = Buffer.from(await result.audio.arrayBuffer());
        if (!audio.length) throw new Error("Empty audio buffer returned");
        const boundaries = (result.subtitle || []).map((w) => ({ text: String(w.text), offset: Number(w.offset), duration: Number(w.duration) }));
        return { audio, boundaries };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
