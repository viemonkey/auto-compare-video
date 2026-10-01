// GOLDEN TEST luồng tiếng Việt (M0 refactor đa thị trường): ghi lại output của code TRƯỚC refactor với
// input cố định; sau refactor (tiếng Việt chạy qua config/locales/vi-VN.json) output phải giống hệt.
// Input hashtag/catalog đóng băng trong test/fixtures/golden-vi/ để không đổi khi config thật được chỉnh.
// Cập nhật snapshot (chỉ khi CHỦ ĐÍCH đổi hành vi tiếng Việt): UPDATE_GOLDEN=1 npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildComparePrompt } from "../scripts/lib/compare-prompt.mjs";
import {
  loadHashtagConfig, normalizeTag, planHashtags, finalizeHashtags, buildCaption, resolveTopicTags,
  resolveSpecificTags, alignTopicTags, resolveMaterialGroups, sanitizePlan, cleanTag, maxHashtags,
} from "../scripts/lib/hashtags.mjs";
import { RetryableError, NonRetryableError } from "../scripts/lib/gemini-retry.mjs";
import { loadExtracted } from "./helpers/extract-fn.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "test", "fixtures", "golden-vi");
const SNAP = path.join(FIX, "snapshot.json");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const cfg = loadHashtagConfig(path.join(FIX, "hashtags.json"));
const catalog = {
  actions: [
    { id: "explain-a", use_case: "Đang giải thích, đưa tay lên" },
    { id: "point-up-left", use_case: "Chỉ lên card bên trái" },
    { id: "inspect-gem", prop: "jewelry", use_case: "Soi viên đá bằng kính lúp" },
    { id: "present-ring", prop: "jewelry", use_case: "Giới thiệu chiếc nhẫn" },
  ],
  allIds: ["explain-a", "point-up-left", "inspect-gem", "present-ring"],
  jewelryIds: ["inspect-gem", "present-ring"],
  generalIds: ["explain-a", "point-up-left"],
};

// rand cố định, lặp chu kỳ — để finalize/align deterministic
function seq(...vals) {
  let i = 0;
  return () => vals[i++ % vals.length];
}

function compute() {
  const prompts = {
    full: buildComparePrompt({ catalog, hashtagCfg: cfg, topicHint: "Đồ trang sức kim hoàn", angleInstruction: "Phân tích rõ ưu điểm và nhược điểm của từng bên." }),
    noHints: buildComparePrompt({ catalog, hashtagCfg: cfg }),
  };

  const tagInputs = ["#Thạch Anh Tím", "Đá  Quý!!", "bạc-925", "Kim cương Đỏ", "Đồng hồ Đeo Tay", "925", "###", "", null, "a".repeat(60), "#宝石", "#อัญมณี", "Ｄiamond"];
  const normalized = tagInputs.map((t) => normalizeTag(t));

  const contents = [
    { materials: ["Thạch anh tím", "Peridot"], label_left: "Thạch anh tím", label_right: "Peridot", topicTags: ["#daquy", "#trangsuc"] },
    { materials: ["Bạc 925", "Vàng trắng"], label_left: "Bạc 925", label_right: "Vàng trắng", topicTags: ["#kienthuctrangsuc"] },
    { label_left: "Chó Phú Quốc", label_right: "Chó Alaska", topicTags: [] },
    { label_left: "Moissanite", label_right: "Kim cương" },
  ];
  const plans = contents.map((c) => planHashtags(c, cfg));
  const specific = contents.map((c) => resolveSpecificTags(c, cfg));
  const topics = contents.map((c) => resolveTopicTags(c.topicTags, cfg));
  const groups = contents.map((c) => resolveMaterialGroups(c, cfg));
  const aligned = groups.map((g) => alignTopicTags(["#daquy"], g, cfg, seq(0, 0.5, 0.99)));
  const finalized = plans.map((p) => finalizeHashtags(p.plan, cfg, { max: 4, rand: seq(0.1, 0.6, 0.95, 0.3, 0) }));
  const finalizedMax2 = plans.map((p) => finalizeHashtags(p.plan, cfg, { max: 2, rand: seq(0.5) }));
  const sanitized = sanitizePlan(
    [{ tag: "Thạch Anh", tier: "specific" }, "#fyp", { tag: "#daquy", tier: "topic" }, { tag: "đá quý", tier: "topic" }, { tag: "tay thêm", manual: true }, { tag: "  " }],
    cfg,
  );
  const cleaned = ["#fyp", "Viral", "Thạch anh", "925"].map((t) => cleanTag(t, cfg));
  const captions = [
    buildCaption("Thạch anh tím hay Peridot?", ["#thachanhtim", "#peridot", "#daquy"]),
    buildCaption("  Chỉ title  ", []),
    buildCaption(null, ["#a"]),
  ];
  const max = [{}, { FB_MAX_HASHTAGS: "7" }, { FB_MAX_HASHTAGS: "99" }, { FB_MAX_HASHTAGS: "0" }, { FB_MAX_HASHTAGS: "x" }].map((e) => maxHashtags(e));

  // --- hàm nằm trong file không import được: trích nguyên văn nguồn ---
  const gen = loadExtracted(
    path.join(ROOT, "scripts", "generate-compare-content.mjs"),
    ["JEWELRY_KEYWORDS", "stripDiacritics", "isJewelryTopic", "JEWELRY_FALLBACK", "enforceJewelryGating", "MAX_CONTEXT_IMAGES", "enforceContextImageLimits", "normalizeHashtagFields", "parseAndValidate"],
    { RetryableError, NonRetryableError, loadHashtagConfig: () => cfg, resolveTopicTags, cleanTag },
  );
  const scaf = loadExtracted(path.join(ROOT, "scripts", "scaffold-compare-video.mjs"), ["stripDiacritics", "slugify"]);

  const jewelry = [
    [{ title: "Kim cương hay moissanite?", label_left: "Kim cương", label_right: "Moissanite" }, null],
    [{ title: "Chó nào dễ nuôi?", label_left: "Chó Phú Quốc", label_right: "Chó Alaska" }, null],
    [{ title: "Chó nào dễ nuôi?", label_left: "Chó", label_right: "Mèo" }, "Đồ trang sức kim hoàn"],
    [{ title: "Diamond vs gem", label_left: "A", label_right: "B" }, ""],
    [{ title: "Nhẫn cưới", label_left: "Vàng", label_right: "Bạc" }, null],
  ].map(([c, h]) => gen.isJewelryTopic(c, h));

  const mkPoints = () => [
    { text: "p0", side: "left", suggested_action: "inspect-gem", needs_context_image: true, image_concept: "x" },
    { text: "p1", side: "left", suggested_action: "explain-a", needs_context_image: true, image_concept: "y" },
    { text: "p2", side: "right", suggested_action: "present-ring", needs_context_image: true, image_concept: "z" },
    { text: "p3", side: "both", suggested_action: "explain-a", needs_context_image: true, image_concept: "w" },
    { text: "p4", side: "left", suggested_action: "explain-a", needs_context_image: true, image_concept: "v" },
    { text: "p5", side: "right", suggested_action: "explain-a", needs_context_image: true, image_concept: "u" },
    { text: "p6", side: "left", suggested_action: "explain-a", needs_context_image: true, image_concept: "t" },
    { text: "p7", side: "right", suggested_action: "explain-a" },
  ];
  const gating = (() => {
    const content = { title: "Chó và mèo", label_left: "Chó", label_right: "Mèo", points: mkPoints() };
    const r = gen.enforceJewelryGating(content, catalog, null);
    return { corrections: r.corrections, actions: content.points.map((p) => p.suggested_action) };
  })();
  const ctxLimits = (() => {
    const content = { points: mkPoints() };
    const r = gen.enforceContextImageLimits(content);
    return { corrections: r.corrections, points: content.points };
  })();

  const rawOk = {
    error: "", title: "Thạch anh tím hay Peridot?", label_left: "Thạch anh tím", label_right: "Peridot",
    materials: [" Thạch anh tím ", "Peridot", "extra"], topicTags: ["#DaQuy", "#khongcotrongwhitelist", "#trangsuc"],
    suggestedTags: ["#Alexandrite", "#fyp", "Alexandrite", "#hai", "#ba"],
    points: [{ text: "Câu 1", side: "left", tag: "Rất cứng", sub: "10/10", suggested_action: "explain-a", needs_context_image: false, image_concept: "" }],
  };
  const parse = (mutate) => {
    const o = JSON.parse(JSON.stringify(rawOk));
    mutate(o);
    try {
      return { ok: gen.parseAndValidate(JSON.stringify(o), catalog) };
    } catch (e) {
      return { err: e.constructor.name, retryable: e instanceof RetryableError, message: e.message.replace(/Raw: .*/s, "Raw: …") };
    }
  };
  const parsed = {
    ok: parse(() => {}),
    geminiError: parse((o) => { o.error = "Hai ảnh giống nhau"; }),
    missingField: parse((o) => { delete o.points; }),
    emptyTitle: parse((o) => { o.title = "  "; }),
    badSide: parse((o) => { o.points[0].side = "x"; }),
    badAction: parse((o) => { o.points[0].suggested_action = "nope"; }),
    badSub: parse((o) => { o.points[0].sub = 1; }),
    noMaterials: parse((o) => { delete o.materials; delete o.topicTags; delete o.suggestedTags; }),
  };
  try {
    gen.parseAndValidate("không phải json", catalog);
  } catch (e) {
    parsed.notJson = { err: e.constructor.name, retryable: e instanceof RetryableError };
  }

  const slugInputs = ["Thạch anh tím", "Đá Quý & Kim Cương!", "  Bạc 925  ", "Nhẫn cưới nam", "ĐÈN LED", "宝石", "อัญมณี", "", "--a--b--", "Peridot (Chế tác)"];
  const slugs = slugInputs.map((s) => scaf.slugify(s));

  return { prompts, normalized, plans, specific, topics, groups, aligned, finalized, finalizedMax2, sanitized, cleaned, captions, max, jewelry, gating, ctxLimits, parsed, slugs };
}

test("golden vi: output luồng tiếng Việt khớp snapshot (prompt, schema, hashtag, caption, slug, validate)", () => {
  const actual = JSON.parse(JSON.stringify(compute())); // chuẩn hoá undefined như khi lưu JSON
  if (UPDATE || !fs.existsSync(SNAP)) {
    fs.writeFileSync(SNAP, JSON.stringify(actual, null, 2) + "\n");
    if (!UPDATE) return;
  }
  const expected = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  for (const key of Object.keys(expected)) {
    assert.deepEqual(actual[key], expected[key], `golden "${key}" đã đổi so với snapshot`);
  }
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
});
