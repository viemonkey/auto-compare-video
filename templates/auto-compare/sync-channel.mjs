// Đồng bộ thẻ kênh ("#eyebrow" trong index.html) trước dev/check/render/publish (npm pre* hooks).
// (Canonical copy: templates/auto-compare/sync-channel.mjs — scaffold-compare-video.mjs chép đè bản generic của create-video.)
// Tên kênh theo THỊ TRƯỜNG của video (VIDEO_LOCALE trong .env của video): config/locales/<code>.json → video.channel;
// thị trường không khai báo (vi-VN) dùng CHANNEL trong .env gốc như trước. Video cũ (copy cũ của script này) vẫn chỉ đọc CHANNEL.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..", "..");
const lib = (...p) => import(pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", ...p)).href);

const { loadVideoEnv } = await lib("tts", "env.mjs");
const { resolveChannel, applyChannelToHtml } = await lib("channel.mjs");
const { resolveLocale, defaultLocaleCode } = await lib("locales.mjs");

// .env.example < .env gốc < .env riêng của video (không lấy process.env của hệ thống để kết quả không phụ thuộc shell)
const env = loadVideoEnv({ repoRoot: REPO_ROOT, videoRoot: ROOT, processEnv: {} });
const locale = resolveLocale(env.VIDEO_LOCALE || defaultLocaleCode());
const { channel, source } = resolveChannel({ locale, env });
if (!channel) {
  throw new Error(`Thiếu tên kênh: khai báo video.channel trong config/locales/${locale.code}.json hoặc CHANNEL trong .env`);
}

const indexPath = path.join(ROOT, "index.html");
const { html, changed, found } = applyChannelToHtml(fs.readFileSync(indexPath, "utf8"), channel);
if (!found) throw new Error('No element with id="eyebrow" found in index.html');
if (changed) {
  fs.writeFileSync(indexPath, html);
  console.log(`Synced #eyebrow to "${channel}" (${locale.code}, từ ${source})`);
} else {
  console.log(`#eyebrow already matches "${channel}" (${locale.code})`);
}
