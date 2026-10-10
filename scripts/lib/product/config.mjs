// Cấu hình chế độ "Giới thiệu sản phẩm": đọc config/product-video.json, cho .env ghi đè các mục cần đổi nhanh (model, ngân sách, kích thước ảnh).
// Mọi nơi trong lib/product/ lấy số liệu từ đây — không có tên model / giá / ngưỡng / số lần thử nằm cứng trong code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const PRODUCT_CONFIG_PATH = process.env.PRODUCT_CONFIG_PATH || path.join(REPO_ROOT, "config", "product-video.json");

const TRUTHY = new Set(["1", "true", "yes", "on"]);
export const isTruthy = (v) => TRUTHY.has(String(v ?? "").trim().toLowerCase());

let cache = null;
/** Nạp config (cache theo mtime). Thiếu/hỏng file -> ném lỗi rõ ràng, không chạy với giá trị đoán. */
export function loadProductConfig(file = PRODUCT_CONFIG_PATH) {
  const mtime = fs.statSync(file).mtimeMs;
  if (cache && cache.file === file && cache.mtime === mtime) return cache.config;
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`config/product-video.json hỏng hoặc không đọc được: ${e.message}`);
  }
  for (const key of ["budget", "models", "scenes", "script", "video", "poses", "audio", "host", "upload", "labels"]) {
    if (!config[key] || typeof config[key] !== "object") throw new Error(`config/product-video.json thiếu mục "${key}".`);
  }
  cache = { file, mtime, config };
  return config;
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[_,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Trần chi phí 1 video (VND): PRODUCT_VIDEO_MAX_COST_VND trong .env, không hợp lệ thì dùng config (mặc định 15.000đ). */
export function maxCostVnd(env = process.env, config = loadProductConfig()) {
  const fromEnv = num(env[config.budget.maxVndEnv || "PRODUCT_VIDEO_MAX_COST_VND"]);
  return fromEnv !== null && fromEnv > 0 ? fromEnv : config.budget.maxVnd;
}

/** Model + kích thước ảnh sinh (env ghi đè config). */
export function imageSettings(env = process.env, config = loadProductConfig()) {
  const m = config.models.image;
  return {
    id: String(env[m.envId] || "").trim() || m.id,
    size: String(env[m.envSize] || "").trim() || m.size,
    aspectRatio: m.aspectRatio,
    batch: config.batch?.envFlag && env[config.batch.envFlag] !== undefined ? isTruthy(env[config.batch.envFlag]) : !!config.batch?.default,
  };
}

export function clipSettings(env = process.env, config = loadProductConfig()) {
  const m = config.models.clip;
  return { id: String(env[m.envId] || "").trim() || m.id, resolution: m.resolution, seconds: m.seconds, aspectRatio: m.aspectRatio, pollIntervalMs: m.pollIntervalMs, timeoutMs: m.timeoutMs };
}

/** Billing Gemini: người dùng tự bật GEMINI_BILLING_ENABLED=1 sau khi bật thanh toán trên Google AI Studio (không có API hỏi trực tiếp). */
export function billingFlag(env = process.env, config = loadProductConfig()) {
  return isTruthy(env[config.billing?.envFlag || "GEMINI_BILLING_ENABLED"]);
}

/** Từ khoá loại món (ring/necklace/earring) -> id; không khớp -> null (chưa có mẫu cảnh AI cho loại này). */
export function kindFromText(text, config = loadProductConfig()) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return null;
  for (const [kind, words] of Object.entries(config.productKinds)) if (words.some((w) => t.includes(w.toLowerCase()))) return kind;
  return null;
}

export function labelsFor(localeCode, config = loadProductConfig()) {
  return { ...config.labels["vi-VN"], ...(config.labels[localeCode] || {}) };
}

export const repoPath = (...p) => path.join(REPO_ROOT, ...p);
