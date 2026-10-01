// Đặt ảnh bìa cho 1 Reel ĐÃ đăng: node scripts/set-reel-thumbnail.mjs <slug> [videoId]
// videoId mặc định lấy từ data/social-queue.json (posts[].fbPostId) theo slug.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfiguredPages } from "./lib/facebook-pages.mjs";
import { loadQueue } from "./lib/social-queue.mjs";
import { setReelThumbnail } from "./lib/reel-thumbnail.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [slug, argId] = process.argv.slice(2);
if (!slug) throw new Error("Thiếu <slug>");
const post = loadQueue().posts.find((p) => p.slug === slug);
const videoId = argId || post?.fbPostId;
const page = getConfiguredPages().find((p) => p.id === post?.pageId) || getConfiguredPages()[0];
const r = await setReelThumbnail({
  videoId,
  page,
  videoPath: path.join(root, "output", `${slug}.mp4`),
  poseTimelinePath: path.join(root, "output", "content", `${slug}.pose-timeline.json`),
});
console.log(JSON.stringify(r, null, 2));
