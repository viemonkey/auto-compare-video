import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeTag,
  buildConfig,
  resolveSpecificTags,
  resolveTopicTags,
  planHashtags,
  sanitizePlan,
  finalizeHashtags,
  buildCaption,
  maxHashtags,
  recordHashtagSuggestions,
  loadHashtagConfig,
  resolveMaterialGroups,
  alignTopicTags,
} from "../scripts/lib/hashtags.mjs";

const RAW = {
  topic: [
    { tag: "#daquy", group: "đá quý" },
    { tag: "#kimcuong", group: "đá quý" },
    { tag: "#gemstone", group: "đá quý" },
    { tag: "#trangsucbac", group: "kim loại" },
    { tag: "#bac", group: "kim loại" },
    { tag: "#viral", group: "kiến thức" }, // trùng blocked -> phải bị loại khỏi whitelist
    { tag: "#trangsuc", group: "trang sức" },
    { tag: "#kienthuctrangsuc", group: "kiến thức" },
    { tag: "#meochontrangsuc", group: "kiến thức" },
  ],
  materials: {
    "thạch anh tím": ["#thachanhtim", "#amethyst"],
    peridot: ["#peridot"],
    "bạc 925": ["#bac925"],
    bạc: ["#bac", "#fyp"], // alias blocked phải bị bỏ
  },
  blocked: ["#fyp", "#viral", "#xuhuong", "#PNJ"],
};
const cfg = buildConfig(RAW);

test("normalizeTag: bỏ dấu, thường, bỏ ký tự đặc biệt/khoảng trắng", () => {
  assert.equal(normalizeTag("#Thạch Anh Tím"), "#thachanhtim");
  assert.equal(normalizeTag("Đá  Quý!!"), "#daquy");
  assert.equal(normalizeTag("bạc-925"), "#bac925");
  assert.equal(normalizeTag("Kim cương Đỏ"), "#kimcuongdo");
});

test("normalizeTag: rỗng / chỉ số -> null; tối đa 25 ký tự gồm '#'", () => {
  assert.equal(normalizeTag(""), null);
  assert.equal(normalizeTag("###"), null);
  assert.equal(normalizeTag("925"), null);
  assert.equal(normalizeTag(null), null);
  const long = normalizeTag("a".repeat(60));
  assert.equal(long.length, 25);
  assert.match(long, /^#a+$/);
});

test("buildConfig: blocked chuẩn hoá, loại khỏi topic/materials", () => {
  assert.ok(cfg.blocked.has("#pnj"));
  assert.ok(!cfg.groupOf.has("#viral"));
  assert.deepEqual(cfg.materials.get("bac"), ["#bac"]);
});

test("specific: tra bảng theo tên chuẩn, tag chính mỗi bên trước", () => {
  const r = resolveSpecificTags({ materials: ["Thạch anh tím", "Peridot"], label_left: "x", label_right: "y" }, cfg);
  assert.deepEqual(r.tags, ["#thachanhtim", "#peridot"]);
  assert.deepEqual(r.unmapped, []);
});

test("specific: 2 bên trùng tag -> bù bằng alias, không lặp", () => {
  const r = resolveSpecificTags({ materials: ["Thạch anh tím", "Thạch anh tím"] }, cfg);
  assert.deepEqual(r.tags, ["#thachanhtim", "#amethyst"]);
});

test("specific: tối đa 2 tag", () => {
  const r = resolveSpecificTags({ materials: ["Thạch anh tím", "Bạc 925"] }, cfg);
  assert.equal(r.tags.length, 2);
});

test("fallback: vật liệu chưa có trong bảng -> tên chuẩn hoá từ label, ghi vào unmapped", () => {
  const r = resolveSpecificTags(
    { materials: ["Alexandrite", "Peridot"], label_left: "Đá Alexandrite", label_right: "Peridot" },
    cfg,
  );
  assert.deepEqual(r.tags, ["#daalexandrite", "#peridot"]);
  assert.deepEqual(r.unmapped, ["Alexandrite"]);
});

test("fallback: video cũ không có materials/topicTags -> theo label, không lỗi", () => {
  const { plan } = planHashtags({ title: "t", label_left: "Bạc 925", label_right: "Bạch kim" }, cfg);
  assert.deepEqual(plan, [
    { tag: "#bac925", tier: "specific" },
    { tag: "#bachkim", tier: "specific" },
  ]);
  assert.doesNotThrow(() => planHashtags({}, cfg));
  assert.doesNotThrow(() => planHashtags(undefined, cfg));
});

test("blocked: label là thương hiệu bị cấm -> bị loại", () => {
  const r = resolveSpecificTags({ label_left: "PNJ", label_right: "Peridot" }, cfg);
  assert.deepEqual(r.tags, ["#peridot"]);
});

test("blocked: alias trong bảng bị cấm không lọt vào tag cụ thể", () => {
  const r = resolveSpecificTags({ materials: ["Bạc", "Bạc"] }, cfg);
  assert.deepEqual(r.tags, ["#bac"]);
});

test("topicTags: chỉ giữ tag trong whitelist, khử trùng, tối đa 2", () => {
  assert.deepEqual(resolveTopicTags(["#DaQuy", "#tuychon", "#viral", "#daquy", "#bac", "#kimcuong"], cfg), ["#daquy", "#bac"]);
  assert.deepEqual(resolveTopicTags(undefined, cfg), []);
});

test("sanitizePlan: chuẩn hoá tag thêm tay, lọc blocked + trùng, giữ thứ tự tầng", () => {
  const plan = sanitizePlan(
    [
      { tag: "#daquy", tier: "topic" },
      { tag: "Thạch Anh Tím", tier: "specific", manual: true },
      { tag: "#FYP", tier: "specific" },
      { tag: "#thachanhtim", tier: "specific" },
      { tag: "#xuhuong", tier: "topic" },
      "###",
    ],
    cfg,
  );
  assert.deepEqual(plan, [
    { tag: "#thachanhtim", tier: "specific", manual: true },
    { tag: "#daquy", tier: "topic" },
  ]);
  assert.equal(sanitizePlan("không phải mảng", cfg), null);
});

test("finalize: thứ tự cụ thể -> chủ đề, tag chủ đề đổi trong CÙNG nhóm", () => {
  const plan = [
    { tag: "#peridot", tier: "specific" },
    { tag: "#amethyst", tier: "specific" },
    { tag: "#daquy", tier: "topic" },
  ];
  // rand=0.99 -> ứng viên cuối của nhóm "đá quý": [#daquy, #kimcuong, #gemstone] -> #gemstone
  assert.deepEqual(finalizeHashtags(plan, cfg, { max: 4, rand: () => 0.99 }), ["#peridot", "#amethyst", "#gemstone"]);
  // rand=0 -> ứng viên đầu = chính tag gốc
  assert.deepEqual(finalizeHashtags(plan, cfg, { max: 4, rand: () => 0 }), ["#peridot", "#amethyst", "#daquy"]);
});

test("finalize: mọi kết quả random đều cùng nhóm, hợp lệ, không trùng", () => {
  const plan = [
    { tag: "#peridot", tier: "specific" },
    { tag: "#daquy", tier: "topic" },
    { tag: "#kimcuong", tier: "topic" },
  ];
  const group = new Set(["#daquy", "#kimcuong", "#gemstone"]);
  for (let i = 0; i < 200; i++) {
    const tags = finalizeHashtags(plan, cfg, { max: 4 });
    assert.equal(tags[0], "#peridot");
    assert.equal(new Set(tags).size, tags.length);
    for (const t of tags.slice(1)) assert.ok(group.has(t), t);
  }
});

test("finalize: tag thêm tay (manual) không bị random hoá", () => {
  const plan = [{ tag: "#daquy", tier: "topic", manual: true }];
  for (let i = 0; i < 30; i++) assert.deepEqual(finalizeHashtags(plan, cfg), ["#daquy"]);
});

test("finalize: giới hạn số lượng theo max, giữ thứ tự", () => {
  const plan = [
    { tag: "#a1", tier: "specific" },
    { tag: "#b2", tier: "specific" },
    { tag: "#c3", tier: "specific", manual: true },
    { tag: "#d4", tier: "topic", manual: true },
    { tag: "#e5", tier: "topic", manual: true },
  ];
  assert.deepEqual(finalizeHashtags(plan, cfg, { max: 4 }), ["#a1", "#b2", "#c3", "#d4"]);
  assert.deepEqual(finalizeHashtags(plan, cfg, { max: 2 }), ["#a1", "#b2"]);
});

test("maxHashtags: mặc định 4, đọc FB_MAX_HASHTAGS, kẹp [1,10]", () => {
  assert.equal(maxHashtags({}), 4);
  assert.equal(maxHashtags({ FB_MAX_HASHTAGS: "3" }), 3);
  assert.equal(maxHashtags({ FB_MAX_HASHTAGS: "abc" }), 4);
  assert.equal(maxHashtags({ FB_MAX_HASHTAGS: "0" }), 4);
  assert.equal(maxHashtags({ FB_MAX_HASHTAGS: "99" }), 10);
});

test("buildCaption: '<title>\\n\\n<tag tag>', không tag thì chỉ title", () => {
  assert.equal(buildCaption("  Tiêu đề? ", ["#a", "#b"]), "Tiêu đề?\n\n#a #b");
  assert.equal(buildCaption("Tiêu đề?", []), "Tiêu đề?");
});

test("gợi ý: ghi ra file duyệt, KHÔNG nằm trong plan/caption; chuẩn hoá + lọc blocked", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ht-test-"));
  const file = path.join(dir, "hashtag-suggestions.json");
  const content = {
    label_left: "Alexandrite",
    label_right: "Peridot",
    materials: ["Alexandrite", "Peridot"],
    topicTags: ["#daquy"],
    suggestedTags: ["#Alexandrite", "#fyp", "#Đá Hiếm"],
  };
  const { plan, unmapped } = planHashtags(content, cfg);
  const entry = recordHashtagSuggestions({ slug: "s1", unmapped, suggestedTags: content.suggestedTags }, cfg, file);
  assert.deepEqual(entry.suggestedTags, ["#alexandrite", "#dahiem"]);
  assert.deepEqual(entry.materials, ["Alexandrite"]);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).suggestions.length, 1);

  // #alexandrite chỉ có mặt vì fallback label ("Alexandrite" -> #alexandrite), còn suggestedTags
  // "#dahiem" tuyệt đối không được vào caption.
  const posted = finalizeHashtags(plan, cfg, { max: 4 });
  assert.ok(!posted.includes("#dahiem"));

  // ghi lại cùng slug -> thay thế, không nhân đôi
  recordHashtagSuggestions({ slug: "s1", unmapped, suggestedTags: ["#x1"] }, cfg, file);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).suggestions.length, 1);
  // không có gì để ghi -> không tạo entry
  assert.equal(recordHashtagSuggestions({ slug: "s2", unmapped: [], suggestedTags: ["#fyp"] }, cfg, file), null);
});

test("config thật config/hashtags.json: hợp lệ, >=10 tag chủ đề, 4 nhóm, không tag nào bị chặn", () => {
  const real = loadHashtagConfig();
  assert.ok(real.topic.length >= 10);
  assert.deepEqual(
    [...new Set(real.topic.map((t) => t.group))].sort(),
    ["kim loại", "kiến thức", "trang sức", "đá quý"].sort(),
  );
  for (const t of real.topic) assert.ok(!real.blocked.has(t.tag), t.tag);
  for (const tags of real.materials.values()) for (const t of tags) assert.ok(!real.blocked.has(t), t);
  // mỗi nhóm đủ tag để 4 page không trùng caption
  for (const g of new Set(real.topic.map((t) => t.group))) {
    assert.ok(real.topic.filter((t) => t.group === g).length >= 3, g);
  }
  const r = resolveSpecificTags({ materials: ["Thạch anh tím", "Peridot"] }, real);
  assert.deepEqual(r.tags, ["#thachanhtim", "#peridot"]);
});

test("config thiếu -> config rỗng, không throw, vẫn fallback label", () => {
  const empty = loadHashtagConfig(path.join(os.tmpdir(), "khong-ton-tai-hashtags.json"));
  assert.equal(empty.topic.length, 0);
  assert.deepEqual(
    planHashtags({ label_left: "Ruby", label_right: "Garnet" }, empty).plan.map((e) => e.tag),
    ["#ruby", "#garnet"],
  );
});

test("config thật: tag chủ đề là tag CHUNG — không trùng bất kỳ tag nào trong materials", () => {
  const real = loadHashtagConfig();
  const materialTags = new Set([...real.materials.values()].flat());
  const overlap = real.topic.map((t) => t.tag).filter((t) => materialTags.has(t));
  assert.deepEqual(overlap, []);
});

test("config thật: 'đá phong thủy' / 'đá màu' đã bỏ khỏi materials và bị blocked ở mọi đường", () => {
  const real = loadHashtagConfig();
  for (const name of ["đá phong thủy", "đá màu"]) assert.deepEqual(real.materials.get(name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")), undefined);
  for (const t of ["#phongthuydaquy", "#damaugoc"]) {
    assert.ok(real.blocked.has(t), t);
    assert.ok(![...real.materials.values()].flat().includes(t), t);
    assert.ok(!real.groupOf.has(t), t);
    assert.equal(sanitizePlan([{ tag: t, tier: "specific", manual: true }], real).length, 0);
    assert.equal(normalizeTag(t), t);
  }
  assert.deepEqual(resolveSpecificTags({ materials: ["Đá màu", "Đá phong thủy"] }, real).tags, ["#damau", "#daphongthuy"]);
});

test("config thật: mọi mục materials có group hợp lệ (đá quý / kim loại / trang sức) trùng nhóm topic", () => {
  const real = loadHashtagConfig();
  const topicGroups = new Set(real.topic.map((t) => t.group));
  assert.equal(real.materialGroups.size, real.materials.size);
  for (const [k, g] of real.materialGroups) assert.ok(topicGroups.has(g), `${k}: ${g}`);
});

const GCFG = buildConfig({
  topic: RAW.topic,
  materials: {
    peridot: { tags: ["#peridot"], group: "đá quý" },
    "bạc 925": { tags: ["#bac925"], group: "kim loại" },
    "nhẫn cưới": { tags: ["#nhancuoi"], group: "trang sức" },
    "không nhóm": ["#khongnhom"],
  },
  blocked: RAW.blocked,
});

test("nhóm vật liệu: đọc từ label/materials, khử trùng; không rõ nhóm -> rỗng", () => {
  assert.deepEqual(resolveMaterialGroups({ label_left: "Peridot", label_right: "Bạc 925" }, GCFG), ["đá quý", "kim loại"]);
  assert.deepEqual(resolveMaterialGroups({ materials: ["Peridot", "Peridot"] }, GCFG), ["đá quý"]);
  assert.deepEqual(resolveMaterialGroups({ label_left: "Không nhóm", label_right: "Lạ hoắc" }, GCFG), []);
  assert.deepEqual(resolveMaterialGroups({}, GCFG), []);
});

test("cập nhật tag: topicTags cùng nhóm vật liệu mới -> giữ nguyên", () => {
  const groups = resolveMaterialGroups({ label_left: "Peridot", label_right: "Peridot" }, GCFG);
  assert.deepEqual(alignTopicTags(["#daquy", "#kimcuong"], groups, GCFG, () => 0.99), ["#daquy", "#kimcuong"]);
});

test("cập nhật tag: khác nhóm -> 1 tag ngẫu nhiên trong nhóm đúng", () => {
  const groups = resolveMaterialGroups({ label_left: "Bạc 925", label_right: "Bạc 925" }, GCFG);
  assert.deepEqual(groups, ["kim loại"]);
  assert.deepEqual(alignTopicTags(["#daquy"], groups, GCFG, () => 0), ["#trangsucbac"]);
  assert.deepEqual(alignTopicTags(["#daquy"], groups, GCFG, () => 0.99), ["#bac"]);
  for (let i = 0; i < 50; i++) {
    const [t] = alignTopicTags(["#daquy"], groups, GCFG);
    assert.equal(GCFG.groupOf.get(t), "kim loại");
  }
  // tag hiện tại lệch nhóm (khác với rỗng) -> vẫn thay
  assert.equal(alignTopicTags(["#daquy"], groups, GCFG).length, 1);
});

test("cập nhật tag: chỉ giữ tag cùng nhóm, bỏ tag lệch nhóm khi vẫn còn tag đúng nhóm", () => {
  const groups = ["đá quý"];
  assert.deepEqual(alignTopicTags(["#bac", "#gemstone"], groups, GCFG), ["#gemstone"]);
});

test("cập nhật tag: không xác định được nhóm -> giữ nguyên topicTags", () => {
  assert.deepEqual(alignTopicTags(["#daquy", "#bac"], [], GCFG, () => 0.5), ["#daquy", "#bac"]);
});

test("cập nhật tag: 2 vật liệu KHÁC nhóm và cần thay -> chọn ngẫu nhiên từ nhóm 'kiến thức', không theo bên trái", () => {
  assert.equal(GCFG.mixedGroup, "kiến thức"); // MIXED_GROUP đã chuyển vào locale.mixedGroup (config/locales/vi-VN.json)
  const groups = resolveMaterialGroups({ label_left: "Peridot", label_right: "Bạc 925" }, GCFG);
  assert.deepEqual(groups, ["đá quý", "kim loại"]);
  // tag hiện tại thuộc nhóm "trang sức" (không khớp cả 2 vật liệu, cũng không phải kiến thức) -> thay
  assert.deepEqual(alignTopicTags(["#trangsuc"], groups, GCFG, () => 0), ["#kienthuctrangsuc"]);
  assert.deepEqual(alignTopicTags(["#trangsuc"], groups, GCFG, () => 0.99), ["#meochontrangsuc"]);
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const [t] = alignTopicTags(["#trangsuc"], groups, GCFG);
    assert.equal(GCFG.groupOf.get(t), "kiến thức");
    seen.add(t);
  }
  assert.equal(seen.size, 2);
});

test("cập nhật tag: khác nhóm nhưng tag hiện tại đã thuộc 1 trong 2 nhóm hoặc 'kiến thức' -> giữ nguyên", () => {
  const groups = ["đá quý", "kim loại"];
  assert.deepEqual(alignTopicTags(["#daquy"], groups, GCFG, () => 0.99), ["#daquy"]);
  assert.deepEqual(alignTopicTags(["#bac"], groups, GCFG, () => 0.99), ["#bac"]);
  // tag "kiến thức" chọn ở lần trước không bị đổi lại mỗi lần bấm nút
  assert.deepEqual(alignTopicTags(["#meochontrangsuc"], groups, GCFG, () => 0), ["#meochontrangsuc"]);
});

test("cập nhật tag: tag 'kiến thức' luôn được giữ — cùng nhóm, khác nhóm, không rõ nhóm", () => {
  const same = resolveMaterialGroups({ label_left: "Bạc 925", label_right: "Bạc 925" }, GCFG);
  assert.deepEqual(same, ["kim loại"]);
  // cùng nhóm (kim loại): tag kiến thức giữ, tag đá quý (lệch nhóm) bỏ, không random thêm
  assert.deepEqual(alignTopicTags(["#daquy", "#kienthuctrangsuc"], same, GCFG, () => 0.99), ["#kienthuctrangsuc"]);
  // cùng nhóm: kiến thức + đúng nhóm -> giữ cả hai
  assert.deepEqual(alignTopicTags(["#bac", "#meochontrangsuc"], same, GCFG, () => 0), ["#bac", "#meochontrangsuc"]);
  // khác nhóm
  const mixed = ["đá quý", "kim loại"];
  assert.deepEqual(alignTopicTags(["#trangsuc", "#kienthuctrangsuc"], mixed, GCFG, () => 0.99), ["#kienthuctrangsuc"]);
  // không rõ nhóm
  assert.deepEqual(alignTopicTags(["#kienthuctrangsuc"], [], GCFG, () => 0.99), ["#kienthuctrangsuc"]);
});

test("topicTags rỗng (nội dung ngoài ngành): alignTopicTags KHÔNG tự thêm tag chủ đề, mọi trường hợp nhóm", () => {
  for (const groups of [["kim loại"], ["đá quý", "kim loại"], []]) {
    for (let i = 0; i < 20; i++) assert.deepEqual(alignTopicTags([], groups, GCFG), []);
  }
  // topicTags Gemini trả toàn tag ngoài whitelist cũng coi như rỗng
  assert.deepEqual(alignTopicTags(["#khongcotrongwhitelist"], ["kim loại"], GCFG), []);
  assert.deepEqual(alignTopicTags(undefined, ["kim loại"], GCFG), []);
});

test("topicTags rỗng: plan/caption chỉ có tag cụ thể, không có tag chủ đề", () => {
  const content = { label_left: "Peridot", label_right: "Bạc 925", materials: ["Peridot", "Bạc 925"], topicTags: [] };
  const { plan } = planHashtags(content, GCFG);
  assert.deepEqual(plan, [
    { tag: "#peridot", tier: "specific" },
    { tag: "#bac925", tier: "specific" },
  ]);
  for (let i = 0; i < 20; i++) {
    const tags = finalizeHashtags(plan, GCFG, { max: 4 });
    assert.deepEqual(tags, ["#peridot", "#bac925"]);
    assert.equal(buildCaption("Hook?", tags), "Hook?\n\n#peridot #bac925");
  }
  // qua đường "Cập nhật tag": nhóm vật liệu khác nhau nhưng topicTags rỗng vẫn rỗng
  const groups = resolveMaterialGroups(content, GCFG);
  assert.deepEqual(groups, ["đá quý", "kim loại"]);
  const aligned = alignTopicTags(content.topicTags, groups, GCFG);
  assert.deepEqual(planHashtags({ ...content, topicTags: aligned }, GCFG).plan.filter((h) => h.tier === "topic"), []);
});
