// Hình học + nhịp cắt cảnh (thuần, không I/O — test được): chia mỗi cảnh thành các "shot" 1,5–2,5 giây với khung hình luân phiên, ánh xạ khung bao
// của sản phẩm (toạ độ chuẩn hoá trong ảnh) sang toạ độ khung video 1080×1920, và sinh vị trí chớp sáng XÁC ĐỊNH (PRNG có hạt giống, không Math.random).
import { loadProductConfig } from "./config.mjs";

export const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Hash chuỗi -> số nguyên 32 bit (cho hạt giống PRNG). */
export function hashSeed(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/** PRNG mulberry32 — cùng hạt giống luôn ra cùng dãy (render phải xác định). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Chia 1 cảnh dài `duration` giây thành các shot, mỗi shot trong [min, max] giây (mặc định 1,5–2,5) và gần 2 giây nhất có thể.
 * Cảnh quá ngắn / nằm ở khoảng không chia đều được trong [min, max] (vd 2,6 giây) thì giữ 1 shot dài hơn max một chút thay vì cắt ra 2 shot quá ngắn.
 * @returns {Array<{start:number, dur:number}>} start tương đối đầu cảnh; tổng dur = duration
 */
export function splitShots(duration, { min = 1.5, max = 2.5, ideal = 2 } = {}) {
  let best = { n: 1, penalty: Infinity, away: Infinity };
  for (let n = 1; n <= Math.max(1, Math.ceil(duration / min)); n++) {
    const each = duration / n;
    const penalty = Math.max(0, each - max) + Math.max(0, min - each);
    const away = Math.abs(each - ideal);
    if (penalty < best.penalty - 1e-9 || (Math.abs(penalty - best.penalty) <= 1e-9 && away < best.away)) best = { n, penalty, away };
  }
  const shots = [];
  for (let i = 0; i < best.n; i++) shots.push({ start: round((i * duration) / best.n), dur: round(i === best.n - 1 ? duration - (i * duration) / best.n : duration / best.n) });
  return shots;
}

/** Kích thước ảnh hiển thị kiểu object-fit: cover trong khung frameW×frameH, và vị trí góc trên-trái (px, có thể âm). */
export function coverLayout(imgW, imgH, frameW, frameH) {
  const k = Math.max(frameW / imgW, frameH / imgH);
  const w = imgW * k;
  const h = imgH * k;
  return { scale: k, w, h, x: (frameW - w) / 2, y: (frameH - h) / 2 };
}

/** Khung bao chuẩn hoá của sản phẩm trong ảnh -> khung px trong khung video khi ảnh hiển thị kiểu cover. */
export function boxToFrame(box, imgW, imgH, frameW = 1080, frameH = 1920) {
  const c = coverLayout(imgW, imgH, frameW, frameH);
  return { x: round(c.x + box.x * c.w, 1), y: round(c.y + box.y * c.h, 1), w: round(box.w * c.w, 1), h: round(box.h * c.h, 1) };
}

/** Điểm giữa của khung (px). */
export const centerOf = (b) => ({ x: round(b.x + b.w / 2, 1), y: round(b.y + b.h / 2, 1) });

/**
 * Vị trí chớp sáng nhỏ TRONG khung bao: lưới có nhiễu xác định, mỗi điểm có độ trễ/cỡ/độ sáng riêng.
 * @returns {Array<{x:number,y:number,size:number,delay:number,peak:number}>} x,y px trong cùng hệ toạ độ của `box`; delay (giây) tương đối đầu shot
 */
export function sparklePoints(box, count, seed, { shotDur = 2 } = {}) {
  const rand = seededRandom(hashSeed(seed));
  const cols = Math.ceil(Math.sqrt(count * (box.w / Math.max(1, box.h))));
  const rows = Math.ceil(count / cols);
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ r, c });
  // trộn xác định (Fisher–Yates với PRNG có hạt giống) rồi lấy `count` ô
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, count).map((cell, i) => ({
    x: round(box.x + ((cell.c + 0.2 + rand() * 0.6) / cols) * box.w, 1),
    y: round(box.y + ((cell.r + 0.2 + rand() * 0.6) / rows) * box.h, 1),
    size: round(26 + rand() * 30, 1),
    delay: round(((i + rand() * 0.6) / count) * Math.max(0.2, shotDur - 0.6), 2),
    peak: round(0.75 + rand() * 0.25, 2),
  }));
}

const FRAMINGS = ["wide", "tight", "side"];

/**
 * Kế hoạch shot cho 1 cảnh: khung hình luân phiên (rộng -> sát -> lệch) để cắt cảnh có nhịp, mỗi shot có hướng zoom/lia chậm.
 * @param {{start:number, dur:number, kind:string, seed:string, box:object|null, config?:object}} o  box = khung bao sản phẩm (px trong khung video) hoặc null
 */
export function planShots({ start, dur, kind, seed, box, config = loadProductConfig() }) {
  const { shotSeconds, sparklesPerShot, kenBurns } = config.video;
  const parts = splitShots(dur, { min: shotSeconds.min, max: shotSeconds.max });
  const rand = seededRandom(hashSeed(`${seed}:shots`));
  const dir = rand() < 0.5 ? -1 : 1;
  return parts.map((p, i) => {
    const framing = FRAMINGS[i % FRAMINGS.length];
    const zoomFrom = framing === "tight" ? 1.12 : 1;
    const zoomTo = zoomFrom * kenBurns.zoom;
    return {
      index: i,
      at: round(start + p.start),
      dur: p.dur,
      framing,
      zoom: [round(zoomFrom, 3), round(zoomTo, 3)],
      pan: [round((framing === "side" ? dir * kenBurns.panPx : 0) * (i % 2 ? -1 : 1), 1), round((framing === "side" ? -dir * kenBurns.panPx : dir * kenBurns.panPx * 0.5) * (i % 2 ? -1 : 1), 1)],
      sweepAt: round(0.15 + rand() * 0.35, 2),
      sparkles: box && kind !== "cta" ? sparklePoints(box, sparklesPerShot, `${seed}:${i}`, { shotDur: p.dur }) : [],
    };
  });
}
