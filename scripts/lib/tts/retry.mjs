// Thử lại có lùi dần (exponential-ish backoff có trần + jitter). Hàm sleep/random truyền vào được để test không phải chờ thật.
import { isPermanent } from "./messages.mjs";

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {(attempt:number)=>Promise<T>} fn
 * @param {object} [o]
 * @param {number} [o.maxRetries] số lần thử tối đa
 * @param {number} [o.baseMs] @param {number} [o.maxMs] @param {number} [o.jitterMs]
 * @param {(ms:number)=>Promise<void>} [o.sleep] @param {()=>number} [o.random]
 * @param {(info:{attempt:number, maxRetries:number, error:Error, waitMs:number})=>void} [o.onRetry]
 * @template T
 */
export async function withRetry(fn, { maxRetries = 8, baseMs = 1500, maxMs = 9000, jitterMs = 500, sleep = realSleep, random = Math.random, onRetry } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxRetries || isPermanent(error)) {
        error.attempts = attempt;
        throw error;
      }
      const waitMs = Math.min(baseMs * attempt, maxMs) + Math.floor(random() * jitterMs);
      if (onRetry) onRetry({ attempt, maxRetries, error, waitMs });
      await sleep(waitMs);
    }
  }
}
