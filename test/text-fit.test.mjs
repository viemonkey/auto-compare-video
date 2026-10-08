import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sizeSteps, fitLabel, fitCaption, overflowMessage } from "../public/shared/text-fit.mjs";
import { checkContentFit, planVideoText, assertFitsForBuild, FitBlockedError, fieldLabel, describeIssues, estimateTokens, fitItems } from "../scripts/lib/fit-check.mjs";
import { buildMeasurePage, findChrome } from "../scripts/lib/browser-fit.mjs";
import { spokenLines, fillTemplate } from "../scripts/lib/video-lines.mjs";
import { resolveLocale, listLocales } from "../scripts/lib/locales.mjs";
import { listThemes } from "../scripts/lib/capabilities.mjs";

const hasChrome = !!findChrome();
const ja = resolveLocale("ja-JP");
const vi = resolveLocale("vi-VN");

// đo giả: mỗi ký tự rộng 0.6 * cỡ chữ
const fakeLine = (px) => (s) => [...s].length * px * 0.6;
const fakeGroup = (px) => (g) => g.join("").length * px * 0.6 + g.length * 8;
const lb = (mode, extra = {}) => ({ mode, kinsoku: false, balance: false, ...extra });

test("sizeSteps: giảm theo bước, luôn kết thúc đúng ở ngưỡng tối thiểu", () => {
  assert.deepEqual(sizeSteps({ fontPx: 46, minFontPx: 38, stepPx: 4 }), [46, 42, 38]);
  assert.deepEqual(sizeSteps({ fontPx: 46, minFontPx: 39, stepPx: 4 }), [46, 42, 39]);
  assert.deepEqual(sizeSteps({ fontPx: 30, minFontPx: 30, stepPx: 2 }), [30]);
});

test("fitLabel: vừa ở cỡ gốc thì giữ nguyên, không thu nhỏ", () => {
  const r = fitLabel("Vàng trắng", { box: { fontPx: 46, minFontPx: 30, stepPx: 2, maxLines: 2 }, frame: { widthPx: 444, lineHeight: 1.08 }, lineBreak: lb("space"), language: "vi", measureAt: fakeLine });
  assert.deepEqual({ ok: r.ok, fontPx: r.fontPx, shrunk: r.shrunk, lines: r.lines }, { ok: true, fontPx: 46, shrunk: false, lines: ["Vàng trắng"] });
});

test("fitLabel: quá rộng -> giảm cỡ từng bước tới khi vừa số dòng cho phép", () => {
  const box = { fontPx: 46, minFontPx: 28, stepPx: 2, maxLines: 2 };
  const text = "Natural Diamond Ring Collection Special";
  const r = fitLabel(text, { box, frame: { widthPx: 444, lineHeight: 1.08 }, lineBreak: lb("space"), language: "en", measureAt: fakeLine });
  assert.equal(r.ok, true);
  assert.equal(r.shrunk, true);
  assert.ok(r.fontPx < 46 && r.fontPx >= 28);
  assert.ok(r.lines.length <= 2);
  assert.equal(r.lines.join(" "), text);
  for (const l of r.lines) assert.ok(fakeLine(r.fontPx)(l) <= 444);
  // cỡ chọn là LỚN NHẤT vừa: cỡ lớn hơn 1 bước phải không vừa
  const bigger = fitLabel(text, { box: { ...box, fontPx: r.fontPx + 2, minFontPx: r.fontPx + 2 }, frame: { widthPx: 444, lineHeight: 1.08 }, lineBreak: lb("space"), language: "en", measureAt: fakeLine });
  assert.equal(bigger.ok, false);
});

test("fitLabel: tới ngưỡng tối thiểu vẫn tràn -> ok=false (chặn dựng), giữ cỡ tối thiểu + lý do", () => {
  const box = { fontPx: 46, minFontPx: 40, stepPx: 2, maxLines: 2 };
  const r = fitLabel("Natural Diamond Ring Collection Special Edition", { box, frame: { widthPx: 444, lineHeight: 1.08 }, lineBreak: lb("space"), language: "en", measureAt: fakeLine });
  assert.equal(r.ok, false);
  assert.equal(r.fontPx, 40);
  assert.equal(r.reason, "too-many-lines");
});

test("fitLabel: một từ dài hơn khung không thể xuống dòng -> chẻ ký tự, quá số dòng -> ok=false", () => {
  const box = { fontPx: 46, minFontPx: 30, stepPx: 2, maxLines: 2 };
  const r = fitLabel("A".repeat(60), { box, frame: { widthPx: 444, lineHeight: 1.08 }, lineBreak: lb("space"), language: "en", measureAt: fakeLine });
  assert.equal(r.ok, false);
});

test("fitLabel: giới hạn chiều cao khung (maxHeightPx) cũng tính — nhiều dòng mà cao quá thì phải thu nhỏ hoặc báo lỗi", () => {
  const box = { fontPx: 46, minFontPx: 46, stepPx: 2, maxLines: 20 };
  const text = "một hai ba bốn năm sáu bảy tám chín mười mười một";
  const tall = fitLabel(text, { box, frame: { widthPx: 200, lineHeight: 1.1, maxHeightPx: 100 }, lineBreak: lb("space"), language: "vi", measureAt: fakeLine });
  assert.equal(tall.ok, false);
  assert.equal(tall.reason, "too-tall");
  const shrinkable = fitLabel(text, { box: { ...box, minFontPx: 18 }, frame: { widthPx: 200, lineHeight: 1.1, maxHeightPx: 100 }, lineBreak: lb("space"), language: "vi", measureAt: fakeLine });
  assert.equal(shrinkable.ok, true);
  assert.ok(shrinkable.lines.length * shrinkable.fontPx * 1.1 <= 100);
});

test("fitCaption: cụm đo theo độ rộng khung; cụm 1 token quá rộng bị giảm cỡ riêng, token vừa giữ cỡ gốc", () => {
  const box = { fontPx: 44, minFontPx: 24, stepPx: 4, maxTokens: 4, hardMaxTokens: 5, maxUnits: 99, clauseMinTokens: 2, clauseEnders: ".", joiner: " ", wordGapPx: 8, activeScale: 1.1 };
  const tokens = ["xin", "chào", "A".repeat(30), "bạn"];
  const r = fitCaption(tokens, { box, frame: { widthPx: 600 }, kinsoku: false, measureAt: fakeGroup });
  assert.deepEqual(r.groups.flatMap((g) => g.indices), [0, 1, 2, 3]);
  assert.equal(r.ok, true);
  const long = r.groups.find((g) => g.indices.includes(2));
  assert.ok(long.fontPx < 44, "cụm chứa token dài phải giảm cỡ");
  assert.equal(r.groups.find((g) => g.indices.includes(0)).fontPx, 44);
  for (const g of r.groups) assert.ok(fakeGroup(g.fontPx)(g.indices.map((i) => tokens[i])) <= 600);
});

test("fitCaption: token dài tới mức dù cỡ nhỏ nhất vẫn tràn -> ok=false", () => {
  const box = { fontPx: 44, minFontPx: 40, stepPx: 2, maxTokens: 4, hardMaxTokens: 5, maxUnits: 99, clauseMinTokens: 2, clauseEnders: ".", joiner: " ", wordGapPx: 8, activeScale: 1.1 };
  const r = fitCaption(["A".repeat(80)], { box, frame: { widthPx: 600 }, kinsoku: false, measureAt: fakeGroup });
  assert.equal(r.ok, false);
  assert.equal(r.groups[0].fontPx, 40);
});

test("overflowMessage: tiếng Việt dễ hiểu", () => {
  assert.match(overflowMessage("label"), /rút gọn/);
  assert.match(overflowMessage("caption"), /rút gọn/);
});

// ---------------------------------------------------------------------------------------------
// Dòng thoại + kiểm tra nội dung (không cần Chrome: forceEstimate)
// ---------------------------------------------------------------------------------------------
const jaContent = {
  title: "ダイヤモンドとモアッサナイト、違いを知っていますか？",
  label_left: "ダイヤモンド",
  label_right: "モアッサナイト",
  points: [{ text: "ダイヤモンドは天然の鉱物の中でも特に硬いとされています。" }, { text: "モース硬度は10です。" }],
};

test("video-lines: câu mở đầu/chốt lấy từ config locale (vi giữ đúng chữ cũ)", () => {
  assert.equal(fillTemplate("A {x} B {y}", { x: 1 }), "A 1 B {y}");
  const lines = spokenLines({ title: "T", label_left: "Vàng vàng", label_right: "Vàng trắng", points: [{ text: "p1" }] }, vi);
  assert.deepEqual(lines.map((l) => l.text), ["Đây là Vàng vàng.", "Đây là Vàng trắng.", "T", "p1", "Vàng vàng hay Vàng trắng — giờ thì bạn đã rõ rồi đấy!"]);
  assert.deepEqual(lines.map((l) => l.field), ["label_left", "label_right", "title", "points.0.text", "label_left"]);
  const jl = spokenLines(jaContent, ja);
  assert.equal(jl[0].text, "これはダイヤモンドです。");
  assert.match(jl.at(-1).text, /ダイヤモンドとモアッサナイト、もうわかりましたね/);
});

test("checkContentFit (ước lượng): nội dung hợp lệ -> ok; chữ ngoài font Nhật -> lỗi tofu gán đúng dòng", async () => {
  const ok = await checkContentFit(jaContent, ja, { forceEstimate: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.measuredBy, "estimate");
  const bad = await checkContentFit({ ...jaContent, points: [{ text: "ダイヤは𠮷野家で" }, { text: "ok" }] }, ja, { forceEstimate: true });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.issues.map((i) => [i.field, i.code]), [["points.0.text", "tofu"]]);
  assert.match(bad.issues[0].message, /ô vuông/);
});

test("checkContentFit: ký hiệu Latin/Common thiếu trong font (≈ °) không bị chặn — như vi-VN vẫn chạy từ trước", async () => {
  const r = await checkContentFit({ title: "T", label_left: "A", label_right: "B", points: [{ text: "Nhiệt độ ≈ 100° → sôi" }] }, vi, { forceEstimate: true });
  assert.equal(r.ok, true);
});

test("assertFitsForBuild: chặn dựng bằng FitBlockedError kèm câu tiếng Việt chỉ rõ từng dòng", async () => {
  // đo giả: mọi nhãn/caption đều tràn
  const failing = async (_html) => ({
    label_left: { ok: false, fontPx: 28, lines: ["x"], reason: "too-many-lines" },
    label_right: { ok: true, fontPx: 46, lines: ["y"], reason: "" },
    ...Object.fromEntries(["hook-left", "hook-right", "title", "point-0", "payoff"].map((id) => [id, { ok: id !== "point-0", groups: [{ indices: [0], fontPx: 44, ok: true }] }])),
  });
  const chrome = process.execPath; // chỉ để vượt cổng "có Chrome"; runner giả không chạy gì
  await assert.rejects(
    () => assertFitsForBuild({ title: "T", label_left: "Quá dài", label_right: "Ngắn", points: [{ text: "một câu" }] }, vi, { chrome, runner: failing }),
    (e) => {
      assert.ok(e instanceof FitBlockedError);
      assert.deepEqual(e.issues.map((i) => i.field).sort(), ["label_left", "points.0.text"]);
      assert.match(e.userMessage, /Tên bên trái/);
      assert.match(e.userMessage, /Điểm so sánh 1/);
      assert.match(e.userMessage, /rút gọn/);
      return true;
    },
  );
  const fine = async () => ({
    label_left: { ok: true, fontPx: 46, lines: ["a"], reason: "" },
    label_right: { ok: true, fontPx: 46, lines: ["b"], reason: "" },
    ...Object.fromEntries(["hook-left", "hook-right", "title", "point-0", "payoff"].map((id) => [id, { ok: true, groups: [{ indices: [0], fontPx: 44, ok: true }] }])),
  });
  const res = await assertFitsForBuild({ title: "T", label_left: "A", label_right: "B", points: [{ text: "một câu" }] }, vi, { chrome, runner: fine });
  assert.equal(res.ok, true);
  assert.equal(res.measuredBy, "chrome");
});

test("fitItems: Chrome chạy lỗi -> rơi về ước lượng, không ném lỗi", async () => {
  const boom = async () => { throw new Error("chrome chết"); };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const r = await fitItems([{ id: "label_left", frame: "label", text: "Vàng" }], vi, { chrome: process.execPath, runner: boom });
    assert.equal(r.measuredBy, "estimate");
    assert.equal(r.results.label_left.ok, true);
  } finally {
    console.warn = origWarn;
  }
});

test("planVideoText: gom kết quả thành cụm [số từ, cỡ] và báo từng chỗ lỗi bằng tiếng Việt", async () => {
  const runner = async () => ({
    label_left: { ok: true, fontPx: 46, lines: ["Vàng"], reason: "" },
    label_right: { ok: true, fontPx: 38, lines: ["Vàng", "trắng"], reason: "" },
    "line-1": { ok: true, groups: [{ indices: [0, 1, 2], fontPx: 44, ok: true }, { indices: [3], fontPx: 36, ok: true }] },
    "line-2": { ok: false, groups: [{ indices: [0], fontPx: 24, ok: false }] },
  });
  const plan = await planVideoText({ left: "Vàng", right: "Vàng trắng", lines: [{ n: 1, tokens: ["a", "b", "c", "d"] }, { n: 2, tokens: ["x"] }] }, vi, { chrome: process.execPath, runner });
  assert.equal(plan.label.fontPx, 38); // cỡ chung = nhỏ nhất của hai nhãn
  assert.deepEqual(plan.label.right, ["Vàng", "trắng"]);
  assert.deepEqual(plan.phrases, { 1: [[3, 0], [1, 36]], 2: [[1, 24]] });
  assert.equal(plan.ok, false);
  assert.match(plan.issues[0].where, /dòng thoại 2/);
});

test("fieldLabel / describeIssues", () => {
  assert.equal(fieldLabel("points.2.text"), "Điểm so sánh 3");
  assert.equal(fieldLabel("title"), "Tiêu đề (câu hỏi)");
  assert.match(describeIssues([{ field: "label_right", message: "Hãy rút gọn." }]), /Tên bên phải: Hãy rút gọn\./);
});

test("estimateTokens: ja/th/vi cho token có dấu câu dính liền, bỏ dấu câu đứng riêng", () => {
  assert.deepEqual(estimateTokens("Vàng trắng — giờ thì rõ rồi!", vi), ["Vàng", "trắng", "giờ", "thì", "rõ", "rồi!"]);
  const t = estimateTokens("モース硬度は10です。", ja);
  assert.equal(t.join(""), "モース硬度は10です。");
  assert.ok(t.length >= 4);
});

test("buildMeasurePage: trang đo dùng font LOCAL (file://), không CDN", () => {
  const html = buildMeasurePage({
    language: "ja", fontChain: ja.fonts.display, video: ja.video, lineBreak: ja.layout.lineBreak,
    labelBox: ja.layout.label, captionBox: ja.layout.caption, frames: listThemes()[0].frames, items: [],
  });
  assert.match(html, /@font-face\{font-family:"Noto Sans JP"/);
  assert.match(html, /url\(file:\/\/\/[^)]*NotoSansJP-Black-subset\.woff2\)/);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3)/);
});

test("mọi locale có layout đủ cho theme mặc định (frames) — không thiếu tham số đo", () => {
  const frames = listThemes().find((t) => t.default)?.frames;
  assert.ok(frames && frames.label.widthPx > 0 && frames.caption.widthPx > 0);
  for (const l of listLocales()) assert.ok(l.layout.label.minFontPx <= l.layout.label.fontPx, l.code);
});

// ---------------------------------------------------------------------------------------------
// Đo thật bằng Chrome + font thật (bỏ qua nếu máy không có Chrome)
// ---------------------------------------------------------------------------------------------
test("Chrome + font thật: nhãn/caption ja·th·en·vi vừa khung; nhãn dài giảm cỡ; token khổng lồ bị chặn", { skip: !hasChrome }, async () => {
  const cases = {
    "ja-JP": jaContent,
    "th-TH": { title: "เพชรกับมอยส์ซาไนต์ ต่างกันอย่างไร", label_left: "เพชร", label_right: "มอยส์ซาไนต์", points: [{ text: "เพชรเป็นอัญมณีที่แข็งที่สุดชนิดหนึ่ง ค่าความแข็งโมห์สคือ 10" }] },
    "en-US": { title: "Diamond vs moissanite: what is the difference?", label_left: "Diamond", label_right: "Moissanite", points: [{ text: "Diamond is one of the hardest natural materials, rated 10 on the Mohs scale." }] },
    "vi-VN": { title: "Vàng vàng hay vàng trắng?", label_left: "Vàng vàng", label_right: "Vàng trắng", points: [{ text: "Vàng trắng cần xi mạ lại lớp Rhodium sau vài năm." }] },
  };
  for (const [code, content] of Object.entries(cases)) {
    const r = await checkContentFit(content, resolveLocale(code));
    assert.equal(r.measuredBy, "chrome", code);
    assert.deepEqual(r.issues, [], code);
    assert.equal(r.label.left.fontPx, 46, `${code}: nhãn ngắn không bị thu nhỏ`);
  }
  const long = await checkContentFit({ ...cases["en-US"], label_left: "Natural Diamond Ring Collection Special" }, resolveLocale("en-US"));
  assert.deepEqual(long.issues, []);
  assert.ok(long.label.left.shrunk && long.label.left.fontPx < 46 && long.label.left.lines.length === 2);
  const huge = await checkContentFit({ ...jaContent, points: [{ text: "A".repeat(150) }] }, ja);
  assert.deepEqual(huge.issues.map((i) => [i.field, i.code]), [["points.0.text", "overflow"]]);
  await assert.rejects(() => assertFitsForBuild({ ...jaContent, points: [{ text: "A".repeat(150) }] }, ja), FitBlockedError);
});

test("Chrome + font thật: nhãn tiếng Nhật xuống dòng đúng kinsoku, không dòng nào bắt đầu bằng 。、ー", { skip: !hasChrome }, async () => {
  const label = "ダイヤモンドとモアッサナイトの違い。ー・";
  const r = await checkContentFit({ ...jaContent, label_left: label }, ja);
  const lines = r.label.left.lines;
  assert.equal(lines.join(""), label);
  for (const l of lines.slice(1)) assert.ok(!"。、ー・".includes([...l][0]), JSON.stringify(lines));
});

test("trang đo tạm được dọn sau khi đo (không để rác trong thư mục tạm)", { skip: !hasChrome }, async () => {
  const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("acv-fit-")).length;
  await checkContentFit(jaContent, ja);
  const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("acv-fit-") && fs.existsSync(path.join(os.tmpdir(), f))).length;
  assert.ok(after <= before);
});
