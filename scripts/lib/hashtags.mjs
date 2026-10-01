// Hashtag caption Reel dựa trên BỘ TỪ VỰNG KIỂM SOÁT (config/hashtags.json) — Gemini không sinh tự do:
//   - tầng "specific": tag vật liệu tra từ bảng `materials` (fallback: label trái/phải chuẩn hoá)
//   - tầng "topic"   : tag chủ đề CHỌN TỪ whitelist `topic`, mỗi lần đăng đổi ngẫu nhiên sang tag khác
//                      CÙNG NHÓM để nhiều page không trùng caption
// Thứ tự caption luôn là specific -> topic. Mọi tag đều qua normalizeTag() + lọc `blocked` + khử trùng.
//
// KHÔNG throw khi thiếu/hỏng config — hashtag là phần phụ, không được làm hỏng luồng dựng/đăng video.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeLogger } from "./fb-config.mjs";

const log = makeLogger("hashtags");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const HASHTAGS_CONFIG_PATH = process.env.HASHTAGS_CONFIG_PATH || path.join(REPO_ROOT, "config", "hashtags.json");
export const HASHTAG_SUGGESTIONS_PATH =
  process.env.HASHTAG_SUGGESTIONS_PATH || path.join(REPO_ROOT, "data", "hashtag-suggestions.json");

export const MAX_TAG_LENGTH = 25; // gồm cả dấu '#'
export const MAX_SPECIFIC = 2;
export const MAX_TOPIC = 2;

/** Số hashtag tối đa/caption: FB_MAX_HASHTAGS, mặc định 4, kẹp trong [1, 10]. */
export function maxHashtags(env = process.env) {
  const n = Number.parseInt(env.FB_MAX_HASHTAGS, 10);
  if (!Number.isFinite(n) || n < 1) return 4;
  return Math.min(n, 10);
}

/** "  Thạch anh Tím! " -> "thach anh tim!" (bỏ dấu, thường). Dùng chung cho tra bảng lẫn chuẩn hoá tag. */
export function foldVietnamese(str) {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Chuẩn hoá 1 tag: thường, bỏ dấu, chỉ giữ a-z0-9, tối đa 25 ký tự (gồm '#'), thêm '#'.
 * Trả null nếu rỗng hoặc chỉ toàn số (Facebook không nhận hashtag thuần số).
 */
export function normalizeTag(raw) {
  const body = foldVietnamese(raw).replace(/[^a-z0-9]/g, "").slice(0, MAX_TAG_LENGTH - 1);
  if (!body || /^\d+$/.test(body)) return null;
  return `#${body}`;
}

/** Khoá tra bảng materials: bỏ dấu, thường, gộp khoảng trắng. */
function materialKey(name) {
  return foldVietnamese(name).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Dựng config nội bộ từ JSON thô (thuần, dễ test): chuẩn hoá mọi tag, loại tag blocked/trùng.
 * materials: mỗi mục là `{tags:[...], group}` (group tuỳ chọn) hoặc mảng tag thuần (không có group).
 * @returns {{topic: Array<{tag:string,group:string}>, materials: Map<string,string[]>, materialGroups: Map<string,string>, blocked: Set<string>, groupOf: Map<string,string>}}
 */
export function buildConfig(raw) {
  const blocked = new Set();
  for (const t of Array.isArray(raw?.blocked) ? raw.blocked : []) {
    const n = normalizeTag(t);
    if (n) blocked.add(n);
  }

  const topic = [];
  const groupOf = new Map();
  for (const entry of Array.isArray(raw?.topic) ? raw.topic : []) {
    const tag = normalizeTag(entry?.tag);
    const group = String(entry?.group ?? "").trim();
    if (!tag || !group || blocked.has(tag) || groupOf.has(tag)) continue;
    topic.push({ tag, group });
    groupOf.set(tag, group);
  }

  const materials = new Map();
  const materialGroups = new Map();
  const src = raw?.materials && typeof raw.materials === "object" ? raw.materials : {};
  for (const [name, tags] of Object.entries(src)) {
    if (name.startsWith("_")) continue;
    const key = materialKey(name);
    if (!key) continue;
    const list = [];
    const rawTags = Array.isArray(tags) ? tags : tags?.tags;
    for (const t of Array.isArray(rawTags) ? rawTags : []) {
      const n = normalizeTag(t);
      if (n && !blocked.has(n) && !list.includes(n)) list.push(n);
    }
    if (!list.length) continue;
    materials.set(key, list);
    const group = Array.isArray(tags) ? "" : String(tags?.group ?? "").trim();
    if (group) materialGroups.set(key, group);
  }

  return { topic, materials, materialGroups, blocked, groupOf };
}

let cached = null;
/** Đọc config/hashtags.json (cache theo mtime). Lỗi -> config rỗng + log, không throw. */
export function loadHashtagConfig(file = HASHTAGS_CONFIG_PATH) {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (cached && cached.file === file && cached.mtime === mtime) return cached.cfg;
    const cfg = buildConfig(JSON.parse(fs.readFileSync(file, "utf8")));
    cached = { file, mtime, cfg };
    return cfg;
  } catch (e) {
    log.error(`Không đọc được ${file}: ${e.message} — dùng config hashtag rỗng (chỉ còn fallback theo label).`);
    return buildConfig({});
  }
}

/** Tag hợp lệ để đăng: đã chuẩn hoá và không nằm trong blocked. Trả null nếu không. */
export function cleanTag(raw, cfg) {
  const n = normalizeTag(raw);
  return n && !cfg.blocked.has(n) ? n : null;
}

/** Tra tag của 1 vật liệu theo tên (Gemini "tên chuẩn" hoặc label). Trả [] nếu chưa có trong bảng. */
export function lookupMaterial(name, cfg) {
  return cfg.materials.get(materialKey(name)) || [];
}

/** Nhóm (đá quý / kim loại / trang sức) của 1 vật liệu theo tên; undefined nếu không rõ. */
export function lookupMaterialGroup(name, cfg) {
  return cfg.materialGroups.get(materialKey(name));
}

/**
 * Nhóm của 2 đối tượng so sánh (theo thứ tự trái -> phải, khử trùng): mỗi bên tra `material` rồi
 * `label`, bên nào không có trong bảng thì bỏ qua. Rỗng = không xác định được nhóm.
 */
export function resolveMaterialGroups({ materials, label_left, label_right } = {}, cfg) {
  const mats = Array.isArray(materials) ? materials : [];
  const labels = [label_left, label_right];
  const groups = [];
  for (let side = 0; side < 2; side++) {
    for (const name of [mats[side], labels[side]]) {
      const g = typeof name === "string" && name.trim() ? lookupMaterialGroup(name, cfg) : undefined;
      if (g) {
        if (!groups.includes(g)) groups.push(g);
        break;
      }
    }
  }
  return groups;
}

// Nhóm "kiến thức" áp dụng cho MỌI video: tag thuộc nhóm này luôn hợp lệ để giữ, và là nhóm để chọn
// thay thế khi 2 vật liệu KHÁC nhóm (vd kim cương vs vàng).
export const MIXED_GROUP = "kiến thức";

/**
 * Căn topicTags theo nhóm của vật liệu (dùng khi tính lại tag sau khi sửa label): giữ tag đã cùng
 * nhóm HOẶC thuộc nhóm MIXED_GROUP ("kiến thức" — luôn hợp lệ, mọi trường hợp); chỉ bỏ tag thuộc nhóm
 * vật liệu không khớp. Nếu có tag nhưng không còn tag nào hợp lệ thì thay bằng 1 tag ngẫu nhiên: 2 vật
 * liệu cùng nhóm -> trong nhóm đó; KHÁC nhóm -> trong nhóm MIXED_GROUP. Không xác định được nhóm ->
 * giữ nguyên. topicTags RỖNG (Gemini xác định nội dung ngoài ngành) -> giữ rỗng, KHÔNG tự thêm tag.
 * @param {() => number} [rand] - chỉ để test
 */
export function alignTopicTags(topicTags, groups, cfg, rand = Math.random) {
  const current = resolveTopicTags(topicTags, cfg);
  if (!current.length || !groups.length) return current;
  const mixed = groups.length > 1;
  const allowed = [...groups, MIXED_GROUP];
  const kept = current.filter((t) => allowed.includes(cfg.groupOf.get(t)));
  if (kept.length) return kept;
  let pool = cfg.topic.filter((t) => t.group === (mixed ? MIXED_GROUP : groups[0]));
  if (!pool.length && mixed) pool = cfg.topic.filter((t) => t.group === groups[0]);
  if (!pool.length) return current;
  return [pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))].tag];
}

/**
 * Tag "cụ thể" cho 2 đối tượng so sánh. Mỗi bên lấy tag chính (đầu danh sách) trước, rồi mới tới
 * các alias (vd tên tiếng Anh) để bù khi 2 bên trùng tag; tối đa MAX_SPECIFIC.
 * Vật liệu chưa có trong bảng -> fallback tên chuẩn hoá từ label bên đó.
 * @returns {{tags:string[], unmapped:string[]}} unmapped = tên vật liệu chưa có trong bảng (để gợi ý duyệt)
 */
export function resolveSpecificTags({ materials, label_left, label_right } = {}, cfg) {
  const mats = Array.isArray(materials) ? materials : [];
  const labels = [label_left, label_right];
  const primary = [];
  const aliases = [];
  const unmapped = [];

  for (let side = 0; side < 2; side++) {
    const material = typeof mats[side] === "string" ? mats[side].trim() : "";
    const label = typeof labels[side] === "string" ? labels[side].trim() : "";
    let found = [];
    for (const name of [material, label]) {
      if (name && !found.length) found = lookupMaterial(name, cfg).filter((t) => !cfg.blocked.has(t));
    }
    if (found.length) {
      primary.push(found[0]);
      aliases.push(...found.slice(1));
    } else {
      if (material) unmapped.push(material);
      const fb = cleanTag(label || material, cfg);
      if (fb) primary.push(fb);
    }
  }

  const tags = [];
  for (const t of [...primary, ...aliases]) {
    if (!tags.includes(t)) tags.push(t);
    if (tags.length >= MAX_SPECIFIC) break;
  }
  return { tags, unmapped };
}

/** topicTags Gemini trả về -> chỉ giữ tag có trong whitelist, khử trùng, tối đa MAX_TOPIC. */
export function resolveTopicTags(topicTags, cfg) {
  const out = [];
  for (const raw of Array.isArray(topicTags) ? topicTags : []) {
    const n = normalizeTag(raw);
    if (n && cfg.groupOf.has(n) && !cfg.blocked.has(n) && !out.includes(n)) out.push(n);
    if (out.length >= MAX_TOPIC) break;
  }
  return out;
}

/**
 * Kế hoạch hashtag mặc định cho 1 video (deterministic — chưa random tag chủ đề).
 * Video cũ không có materials/topicTags vẫn chạy: specific rơi về label, không có tầng topic.
 * @returns {{plan: Array<{tag:string,tier:"specific"|"topic",manual?:boolean}>, unmapped:string[]}}
 */
export function planHashtags(content, cfg) {
  const { tags, unmapped } = resolveSpecificTags(content || {}, cfg);
  const topics = resolveTopicTags(content?.topicTags, cfg);
  return {
    plan: [
      ...tags.map((tag) => ({ tag, tier: "specific" })),
      ...topics.map((tag) => ({ tag, tier: "topic" })),
    ],
    unmapped,
  };
}

/**
 * Làm sạch plan do client gửi lên (KHÔNG tin client): chuẩn hoá, lọc blocked, khử trùng, tier hợp lệ.
 * Tag thêm tay (manual) không bị random hoá lúc đăng. Plan không phải mảng -> null.
 */
export function sanitizePlan(rawPlan, cfg) {
  if (!Array.isArray(rawPlan)) return null;
  const seen = new Set();
  const out = [];
  for (const item of rawPlan) {
    const tag = cleanTag(typeof item === "string" ? item : item?.tag, cfg);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    const entry = { tag, tier: item?.tier === "topic" ? "topic" : "specific" };
    if (item?.manual === true) entry.manual = true;
    out.push(entry);
  }
  // Giữ thứ tự tầng cụ thể -> chủ đề (sort ổn định, không đổi thứ tự trong cùng tầng).
  return [...out.filter((e) => e.tier === "specific"), ...out.filter((e) => e.tier === "topic")];
}

/**
 * Chốt danh sách tag THỰC SỰ đăng cho 1 lần đăng: mỗi tag chủ đề (không phải manual, có trong
 * whitelist) được đổi ngẫu nhiên sang 1 tag hợp lệ CÙNG NHÓM chưa dùng (gồm chính nó). Giữ thứ tự
 * specific -> topic, khử trùng, cắt còn `max`.
 * @param {() => number} [rand] - chỉ để test
 */
export function finalizeHashtags(plan, cfg, { max = maxHashtags(), rand = Math.random } = {}) {
  const items = sanitizePlan(plan, cfg) || [];
  const used = new Set(items.map((e) => e.tag));
  const result = [];
  for (const e of items) {
    let tag = e.tag;
    const group = e.tier === "topic" && !e.manual ? cfg.groupOf.get(tag) : null;
    if (group) {
      // `used` đã chứa mọi tag của plan -> ứng viên chỉ gồm tag chưa nằm trong plan + chính tag này
      const pool = cfg.topic.filter((t) => t.group === group && (t.tag === tag || !used.has(t.tag)));
      if (pool.length) {
        tag = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))].tag;
        used.add(tag);
      }
    }
    if (!result.includes(tag)) result.push(tag);
  }
  return result.slice(0, Math.max(1, max));
}

/** `<title>\n\n<tag tag tag>`; không có tag thì chỉ title. */
export function buildCaption(title, tags) {
  const t = String(title ?? "").trim();
  const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!list.length) return t;
  return `${t}\n\n${list.join(" ")}`;
}

/**
 * Ghi gợi ý cần người duyệt vào data/hashtag-suggestions.json — KHÔNG BAO GIỜ tự đăng.
 * Vật liệu chưa có trong bảng + suggestedTags Gemini đề xuất (đã chuẩn hoá, lọc blocked).
 * Không throw. Trả entry đã ghi, hoặc null nếu không có gì để ghi.
 */
export function recordHashtagSuggestions({ slug, unmapped = [], suggestedTags = [] }, cfg, file = HASHTAG_SUGGESTIONS_PATH) {
  try {
    const tags = [];
    for (const raw of Array.isArray(suggestedTags) ? suggestedTags : []) {
      const n = cleanTag(raw, cfg);
      if (n && !tags.includes(n)) tags.push(n);
      if (tags.length >= 2) break;
    }
    const materials = [...new Set(unmapped.map((m) => String(m).trim()).filter(Boolean))];
    if (!tags.length && !materials.length) return null;

    let data = { suggestions: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && Array.isArray(parsed.suggestions)) data = parsed;
    } catch {
      // chưa có file / file hỏng -> bắt đầu mới
    }
    const entry = { slug: slug || null, materials, suggestedTags: tags, at: new Date().toISOString() };
    data.suggestions = data.suggestions.filter((s) => !slug || s.slug !== slug);
    data.suggestions.push(entry);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return entry;
  } catch (e) {
    log.error(`Không ghi được gợi ý hashtag: ${e.message}`);
    return null;
  }
}
