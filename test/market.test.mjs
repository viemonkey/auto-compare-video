// M4: slug theo thị trường, bản ghi nội dung (locale, nháp, ảnh nguồn), caption đăng theo thị trường của video.
// Test kiểm tra CẤU TRÚC và QUY TẮC, không kiểm tra số lượng cụ thể của dữ liệu config.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listLocales, getDefaultLocale, needsGloss } from "../scripts/lib/locales.mjs";
import {
  effectiveSlugSuffix, slugForLocale, hasLocaleSuffix, stripLocaleSuffix, baseSlugFromContent, uniqueSlugForLocale, SLUG_RE,
} from "../scripts/lib/market-slug.mjs";
import { slugify } from "../scripts/lib/slug.mjs";
import {
  readRecord, writeRecord, listRecords, copySourceImages, resolveSource, recordPath,
} from "../scripts/lib/content-store.mjs";
import { buildRecord, resolveSocialPost } from "../server-market.mjs";
import { loadHashtagConfig, planHashtags, finalizeHashtags, buildCaption, normalizeTag } from "../scripts/lib/hashtags.mjs";
import { bilingual } from "../public/shared/bilingual.mjs";

const all = listLocales();
const def = getDefaultLocale();
const foreign = all.filter((l) => l.code !== def.code);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "m4-"));

// ---------------------------------------------------------------------------------------------
// slug theo thị trường
// ---------------------------------------------------------------------------------------------
test("hậu tố slug: thị trường mặc định không có; thị trường khác dùng slugSuffix (rỗng -> mã ngôn ngữ), không trùng nhau", () => {
  assert.equal(effectiveSlugSuffix(def), "");
  const suffixes = foreign.map((l) => effectiveSlugSuffix(l));
  assert.ok(suffixes.every(Boolean));
  assert.equal(new Set(suffixes).size, suffixes.length);
  // locale không phải mặc định mà slugSuffix rỗng: dùng mã ngôn ngữ, KHÔNG rỗng (nếu rỗng sẽ đụng slug của thị trường mặc định)
  const odd = { ...foreign[0], code: "xx-XX", language: "xx", slugSuffix: "" };
  assert.equal(effectiveSlugSuffix(odd, def.code), "xx");
  // DEFAULT_LOCALE đổi sang thị trường khác -> thị trường đó mới là bên không có hậu tố
  assert.equal(effectiveSlugSuffix(foreign[0], foreign[0].code), "");
});

test("slug = slug gốc + slugSuffix; thị trường mặc định giữ nguyên slug cũ; kiểm tra/bỏ hậu tố", () => {
  const base = "thach-anh-tim-vs-thach-anh-vang";
  assert.equal(slugForLocale(base, def, def.code), base);
  for (const l of foreign) {
    const slug = slugForLocale(base, l, def.code);
    assert.equal(slug, `${base}-${effectiveSlugSuffix(l, def.code)}`);
    assert.ok(SLUG_RE.test(slug));
    assert.equal(hasLocaleSuffix(slug, l, def.code), true);
    assert.equal(hasLocaleSuffix(base, l, def.code), false, "slug thiếu hậu tố bị từ chối");
    assert.equal(hasLocaleSuffix(effectiveSlugSuffix(l, def.code), l, def.code), false, "chỉ có hậu tố, không có phần gốc");
    assert.equal(stripLocaleSuffix(slug, l, def.code), base);
    assert.equal(stripLocaleSuffix(base, l, def.code), base);
  }
  assert.equal(hasLocaleSuffix(base, def, def.code), true);
  assert.equal(stripLocaleSuffix(base, def, def.code), base);
});

test("slug gốc sinh từ nghĩa tiếng Việt (vi), không từ chữ đích — label toàn chữ Nhật/Thái KHÔNG ra slug rỗng", () => {
  const content = { label_left: bilingual("アメジスト", "Thạch anh tím"), label_right: bilingual("シトリン", "Thạch anh vàng") };
  assert.equal(baseSlugFromContent(content), "thach-anh-tim-vs-thach-anh-vang");
  const thai = { label_left: bilingual("อเมทิสต์", "Thạch anh tím"), label_right: bilingual("ซิทริน", "Thạch anh vàng") };
  assert.equal(baseSlugFromContent(thai), "thach-anh-tim-vs-thach-anh-vang");
  // slugify trực tiếp trên chữ đích ra rỗng — đúng là lỗi cần tránh
  assert.equal(slugify("アメジスト"), "");
  assert.equal(slugify("อเมทิสต์"), "");
  // nội dung phẳng (tiếng Việt / dữ liệu cũ) như trước
  assert.equal(baseSlugFromContent({ label_left: "Thạch anh tím", label_right: "Peridot" }), "thach-anh-tim-vs-peridot");
});

test("slug gốc: thiếu vi thì thử chữ đích (Latin) rồi tên vật liệu; không có gì dùng được -> null (không sinh slug hỏng)", () => {
  assert.equal(baseSlugFromContent({ label_left: bilingual("Aquamarine", ""), label_right: bilingual("Blue Sapphire", "") }), "aquamarine-vs-blue-sapphire");
  const jaOnly = { label_left: bilingual("アメジスト", ""), label_right: bilingual("シトリン", ""), materials: ["Amethyst", "Citrine"] };
  assert.equal(baseSlugFromContent(jaOnly), "amethyst-vs-citrine", "rơi về tên vật liệu Latin");
  assert.equal(baseSlugFromContent({ label_left: bilingual("アメジスト", ""), label_right: bilingual("シトリン", ""), materials: ["アメジスト", "シトリン"] }), null);
  assert.equal(baseSlugFromContent({ label_left: bilingual("アメジスト", "Thạch anh tím"), label_right: bilingual("シトリン", "") }), null, "1 bên rỗng -> null");
  assert.equal(baseSlugFromContent({}), null);
  assert.equal(baseSlugFromContent(null), null);
});

test("slug duy nhất: số thứ tự chèn TRƯỚC hậu tố thị trường (x-2-ja), hậu tố luôn nằm cuối", () => {
  for (const l of foreign) {
    const suffix = effectiveSlugSuffix(l, def.code);
    const taken = new Set([`abc-vs-xyz-${suffix}`, `abc-vs-xyz-2-${suffix}`]);
    const slug = uniqueSlugForLocale("abc-vs-xyz", l, (s) => taken.has(s), def.code);
    assert.equal(slug, `abc-vs-xyz-3-${suffix}`);
    assert.ok(hasLocaleSuffix(slug, l, def.code));
  }
  assert.equal(uniqueSlugForLocale("abc", def, (s) => s === "abc", def.code), "abc-2");
  assert.equal(uniqueSlugForLocale("abc", def, () => false, def.code), "abc");
});

// ---------------------------------------------------------------------------------------------
// bản ghi nội dung
// ---------------------------------------------------------------------------------------------
test("buildRecord: ghi locale + trạng thái + nguồn; không để _meta/hashtagPlan/locale cũ của content lọt vào", () => {
  const content = { title: "t", locale: "xx-XX", hashtagPlan: [1], _meta: { status: "stale", warnings: [1] }, points: [{ text: "a" }] };
  const rec = buildRecord({ content, locale: foreign[0], hashtagPlan: [{ tag: "#a" }], status: "draft", source: { left: "l" }, derivedFrom: "g", savedAt: "2026-01-01T00:00:00Z" });
  assert.equal(rec.locale, foreign[0].code);
  assert.deepEqual(rec.hashtagPlan, [{ tag: "#a" }]);
  assert.deepEqual(rec._meta, { status: "draft", savedAt: "2026-01-01T00:00:00Z", source: { left: "l" }, derivedFrom: "g" });
  assert.equal(rec.title, "t");
});

test("content-store: ghi/đọc/liệt kê bản ghi; file hỏng bị bỏ qua; ảnh nguồn được copy bền", () => {
  const dir = tmp();
  try {
    writeRecord(dir, "a-vs-b", { title: "x", locale: foreign[0].code, _meta: { status: "draft" } });
    writeRecord(dir, "c-vs-d", { title: "y" }); // bản ghi cũ: không locale, không _meta
    fs.writeFileSync(recordPath(dir, "hong"), "{ không phải json");
    assert.equal(readRecord(dir, "a-vs-b").title, "x");
    assert.equal(readRecord(dir, "khong-co"), null);
    assert.equal(readRecord(dir, "hong"), null);
    assert.deepEqual(listRecords(dir).map((r) => r.slug).sort(), ["a-vs-b", "c-vs-d"]);

    const left = path.join(dir, "in-left.jpg");
    const right = path.join(dir, "in-right.PNG");
    fs.writeFileSync(left, "L");
    fs.writeFileSync(right, "R");
    const rel = copySourceImages(dir, "a-vs-b", left, right);
    assert.deepEqual(rel, { left: "sources/a-vs-b/left.jpg", right: "sources/a-vs-b/right.png" });
    fs.rmSync(left);
    fs.rmSync(right); // file gốc (uploads) có thể bị dọn — bản copy vẫn còn
    assert.equal(fs.readFileSync(path.join(dir, rel.left), "utf8"), "L");
    assert.throws(() => copySourceImages(dir, "z", path.join(dir, "x.exe"), path.join(dir, "y.exe")), /Đuôi ảnh/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveSource: bản sao đã lưu -> project còn trên đĩa (video cũ) -> null; mang theo gợi ý + góc độ", () => {
  const dir = tmp();
  const videos = tmp();
  try {
    const l = path.join(dir, "l.jpg");
    const r = path.join(dir, "r.jpg");
    fs.writeFileSync(l, "L");
    fs.writeFileSync(r, "R");
    const rel = copySourceImages(dir, "slug-1", l, r);
    const record = { _meta: { source: { ...rel, topicHint: "đá quý", contentAngleId: "pros-cons", customAngleText: "" } } };
    const s1 = resolveSource({ dir, videosDir: videos, slug: "slug-1", record });
    assert.equal(s1.from, "record");
    assert.equal(s1.topicHint, "đá quý");
    assert.equal(s1.contentAngleId, "pros-cons");
    assert.ok(fs.existsSync(s1.left) && fs.existsSync(s1.right));

    // bản ghi cũ không có nguồn nhưng project còn ảnh
    fs.mkdirSync(path.join(videos, "slug-2", "assets", "images"), { recursive: true });
    fs.writeFileSync(path.join(videos, "slug-2", "assets", "images", "card-left.webp"), "L");
    fs.writeFileSync(path.join(videos, "slug-2", "assets", "images", "card-right.jpg"), "R");
    const s2 = resolveSource({ dir, videosDir: videos, slug: "slug-2", record: {} });
    assert.equal(s2.from, "project");
    assert.equal(s2.contentAngleId, "auto");

    assert.equal(resolveSource({ dir, videosDir: videos, slug: "slug-3", record: {} }), null);
    // bản sao bị xoá mất file -> không tin đường dẫn cũ
    fs.rmSync(path.join(dir, rel.left));
    assert.equal(resolveSource({ dir, videosDir: videos, slug: "slug-1", record }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(videos, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// caption đăng: title + hashtag của ĐÚNG thị trường của video
// ---------------------------------------------------------------------------------------------
test("resolveSocialPost: title = chữ đích (không phải vi); hashtag theo bộ từ vựng của thị trường lưu trong bản ghi", () => {
  const dir = tmp();
  try {
    for (const l of foreign.filter(needsGloss)) {
      const cfg = loadHashtagConfig(l);
      const matName = [...cfg.materials.keys()][0];
      const content = {
        title: bilingual("TITLE-DICH", "Tiêu đề tiếng Việt"),
        label_left: bilingual(matName, "x"), label_right: bilingual(matName, "y"),
        materials: [matName, matName], topicTags: [cfg.topic[0].tag],
      };
      const plan = planHashtags(content, cfg).plan;
      writeRecord(dir, `slug-${l.language}`, buildRecord({ content, locale: l, hashtagPlan: plan, status: "built" }));
      const post = resolveSocialPost({ dir, slug: `slug-${l.language}`, fallbackName: "fb" });
      assert.equal(post.title, "TITLE-DICH", l.code);
      assert.deepEqual(post.hashtags, plan, l.code);
      const caption = buildCaption(post.title, finalizeHashtags(post.hashtags, cfg, { max: 4, rand: () => 0 }));
      assert.ok(caption.startsWith("TITLE-DICH\n\n#"), l.code);
      // mọi tag trong caption sống sót qua chuẩn hoá của CHÍNH thị trường đó (không bị ép ASCII)
      for (const tag of caption.split("\n\n")[1].split(" ")) assert.equal(normalizeTag(tag, l), tag, `${l.code}: ${tag}`);
    }
    // bản ghi cũ: title phẳng, không locale -> thị trường mặc định
    writeRecord(dir, "cu", { title: "Câu hỏi cũ", label_left: "Peridot", label_right: "Thạch anh tím", materials: ["Peridot", "Thạch anh tím"] });
    const old = resolveSocialPost({ dir, slug: "cu", fallbackName: "fb" });
    assert.equal(old.title, "Câu hỏi cũ");
    assert.ok(old.hashtags.length > 0);
    assert.equal(resolveSocialPost({ dir, slug: "khong-co", fallbackName: "Tên dự phòng" }).title, "Tên dự phòng");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// slug bản ngoại ngữ: ưu tiên tên tiếng Anh/quốc tế, KHÔNG chứa chữ Nhật/Thái
// ---------------------------------------------------------------------------------------------
test("slug bản ngoại ngữ: materials Latin -> label Latin -> nghĩa tiếng Việt (thứ tự ưu tiên)", async () => {
  const { isLatinName } = await import("../public/shared/slug-base.mjs");
  const jp = (text, vi) => bilingual(text, vi);
  // 1. materials Latin thắng cả label Latin lẫn vi
  assert.equal(
    baseSlugFromContent({ label_left: jp("Aquamarine Cut", "Cắt aquamarine"), label_right: jp("Rough", "Thô"), materials: ["Aquamarine", "Sapphire"] }),
    "aquamarine-vs-sapphire",
  );
  // 2. materials không Latin -> label Latin (vd en-US: label là tên quốc tế)
  assert.equal(baseSlugFromContent({ label_left: jp("Aquamarine", "Đá Aquamarine"), label_right: jp("Blue Sapphire", "Sapphire xanh"), materials: ["アクアマリン", "サファイア"] }), "aquamarine-vs-blue-sapphire");
  // 3. cả materials lẫn label đều Nhật -> nghĩa tiếng Việt
  assert.equal(baseSlugFromContent({ label_left: jp("アクアマリン", "Aquamarine"), label_right: jp("サファイア", "Sapphire"), materials: ["アクアマリン", "サファイア"] }), "aquamarine-vs-sapphire");
  assert.equal(baseSlugFromContent({ label_left: jp("アメジスト", "Thạch anh tím"), label_right: jp("シトリン", "Thạch anh vàng") }), "thach-anh-tim-vs-thach-anh-vang");
  // trộn: mỗi bên tự rơi về mức ưu tiên kế tiếp
  assert.equal(baseSlugFromContent({ label_left: jp("アクアマリン", "Aquamarine"), label_right: jp("サファイア", "Sapphire"), materials: ["アクアマリン", "Sapphire"] }), "aquamarine-vs-sapphire");
  // chuỗi lai Nhật+Latin ("シルバー925") KHÔNG được thành slug "925"
  assert.equal(isLatinName("シルバー925"), false);
  assert.equal(isLatinName("Silver 925"), true);
  assert.equal(isLatinName("アクアマリン"), false);
  assert.equal(
    baseSlugFromContent({ label_left: jp("シルバー925", "Bạc 925"), label_right: jp("プラチナ", "Bạch kim"), materials: ["シルバー925", "プラチナ"] }),
    "bac-925-vs-bach-kim",
  );
});

test("slug bản ngoại ngữ (mọi thị trường có nghĩa tiếng Việt): luôn khớp SLUG_RE, không có ký tự CJK/Thái, thêm slugSuffix vẫn hợp lệ", () => {
  const samples = [
    { label_left: bilingual("アクアマリン", "Aquamarine"), label_right: bilingual("サファイア", "Sapphire"), materials: ["アクアマリン", "サファイア"] },
    { label_left: bilingual("อความารีน", "Aquamarine"), label_right: bilingual("แซฟไฟร์", "Sapphire"), materials: ["อความารีน", "แซฟไฟร์"] },
    { label_left: bilingual("Aquamarine", "Aquamarine"), label_right: bilingual("Sapphire", "Sapphire"), materials: ["Aquamarine", "Sapphire"] },
  ];
  for (const l of all.filter((x) => x.slugSuffix)) {
    for (const c of samples) {
      const slug = slugForLocale(baseSlugFromContent(c), l, getDefaultLocale().code);
      assert.match(slug, SLUG_RE, `${l.code}: ${slug}`);
      assert.ok(!/[^\x00-\x7f]/.test(slug));
    }
  }
});

test("slug tiếng Việt / dữ liệu phẳng giữ nguyên hành vi cũ (không đổi slug dữ liệu đã có)", () => {
  assert.equal(baseSlugFromContent({ label_left: "Thạch anh tím", label_right: "Peridot", materials: ["Amethyst", "Peridot"] }), "thach-anh-tim-vs-peridot");
  assert.equal(baseSlugFromContent({ label_left: "Kim cương", label_right: "Moissanite" }), "kim-cuong-vs-moissanite");
});

test("titleOf: tiêu đề chữ đích + nghĩa tiếng Việt cho danh sách video; bản tiếng Việt vi rỗng; không có title -> null", async () => {
  const { titleOf } = await import("../server-market.mjs");
  assert.deepEqual(titleOf({ title: bilingual("タイトル", "Tiêu đề") }), { text: "タイトル", vi: "Tiêu đề" });
  assert.deepEqual(titleOf({ title: "Aquamarine hay Sapphire?" }), { text: "Aquamarine hay Sapphire?", vi: "" });
  assert.equal(titleOf({}), null);
  assert.equal(titleOf(null), null);
});
