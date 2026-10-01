// Bản ghi nội dung bền vững: <dir>/<slug>.compare-content.json — dùng cho video đã dựng LẪN bản nháp (_meta.status).
//   { ...content (phẳng hoặc {text,vi}), locale, hashtagPlan, _meta: { status, savedAt, source, derivedFrom } }
// Ảnh nguồn được COPY vào <dir>/sources/<slug>/ để "tạo phiên bản cho thị trường khác" dùng lại được (assets/uploads là thư mục tạm).
// Thiếu `locale` trong bản ghi cũ = thị trường mặc định (người gọi tự áp dụng).
import fs from "node:fs";
import path from "node:path";

const SUFFIX = ".compare-content.json";
const IMG_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

export const recordPath = (dir, slug) => path.join(dir, `${slug}${SUFFIX}`);

export function readRecord(dir, slug) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(dir, slug), "utf8"));
  } catch {
    return null;
  }
}

export function writeRecord(dir, slug, record) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(recordPath(dir, slug), JSON.stringify(record, null, 2));
}

/** [{slug, record}] của mọi bản ghi đọc được (file hỏng bị bỏ qua). */
export function listRecords(dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(SUFFIX));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    const slug = f.slice(0, -SUFFIX.length);
    const record = readRecord(dir, slug);
    if (record) out.push({ slug, record });
  }
  return out;
}

/** Copy 2 ảnh nguồn vào <dir>/sources/<slug>/left.<ext>, right.<ext>; trả đường dẫn TƯƠNG ĐỐI so với dir. */
export function copySourceImages(dir, slug, leftAbs, rightAbs) {
  const dest = path.join(dir, "sources", slug);
  fs.mkdirSync(dest, { recursive: true });
  const put = (src, name) => {
    const ext = path.extname(src).toLowerCase();
    if (!IMG_EXT.includes(ext)) throw new Error(`Đuôi ảnh "${ext}" chưa hỗ trợ.`);
    for (const old of fs.readdirSync(dest)) if (old.startsWith(`${name}.`)) fs.rmSync(path.join(dest, old), { force: true });
    const file = `${name}${ext}`;
    fs.copyFileSync(src, path.join(dest, file));
    return path.posix.join("sources", slug, file);
  };
  return { left: put(leftAbs, "left"), right: put(rightAbs, "right") };
}

/**
 * Nguồn để sinh lại nội dung cho thị trường khác: ảnh + gợi ý ngữ cảnh + góc độ. Thứ tự: bản sao đã lưu trong bản ghi -> project còn trên
 * đĩa (videos/<slug>/assets/images/card-left|right.*, video cũ chưa lưu nguồn) -> null (không dùng lại được).
 * @returns {{left:string,right:string,topicHint:string,contentAngleId:string,customAngleText:string,from:"record"|"project"}|null}
 */
export function resolveSource({ dir, videosDir, slug, record }) {
  const src = record?._meta?.source;
  if (src?.left && src?.right) {
    const left = path.join(dir, src.left);
    const right = path.join(dir, src.right);
    if (fs.existsSync(left) && fs.existsSync(right)) {
      return { left, right, topicHint: src.topicHint || "", contentAngleId: src.contentAngleId || "auto", customAngleText: src.customAngleText || "", from: "record" };
    }
  }
  const imgDir = path.join(videosDir, slug, "assets", "images");
  const find = (name) => IMG_EXT.map((e) => path.join(imgDir, `${name}${e}`)).find((p) => fs.existsSync(p));
  const left = find("card-left");
  const right = find("card-right");
  if (left && right) return { left, right, topicHint: "", contentAngleId: "auto", customAngleText: "", from: "project" };
  return null;
}
