import { test } from "node:test";
import assert from "node:assert/strict";
import { breakLines, atomize, canBreak, NO_START, NO_END } from "../public/shared/line-break.mjs";
import { alignBoundaries, chunkCaption } from "../public/shared/caption-chunk.mjs";
import { countGraphemes } from "../public/shared/text-length.mjs";
import { listLocales } from "../scripts/lib/locales.mjs";

const locale = (code) => listLocales().find((l) => l.code === code);
const optsOf = (code, extra = {}) => {
  const l = locale(code);
  return { language: l.language, mode: l.layout.lineBreak.mode, kinsoku: l.layout.lineBreak.kinsoku, ...extra };
};
// ghép lại các dòng phải ra đúng chữ gốc (không mất/thừa ký tự; khoảng trắng chuẩn hoá)
const reassemble = (lines, spaced) => lines.join(spaced ? " " : "");

// ----------------------------------------------------------------------------------------------
// en / vi: theo khoảng trắng
// ----------------------------------------------------------------------------------------------
test("line-break en: ngắt ở khoảng trắng, mỗi dòng <= maxUnits, ghép lại đúng chữ gốc", () => {
  const text = "Natural diamond is much harder than moissanite";
  const r = breakLines(text, optsOf("en-US", { maxUnits: 16, maxLines: 4 }));
  assert.equal(r.overflow, false);
  for (const l of r.lines) assert.ok(countGraphemes(l) <= 16, l);
  assert.equal(reassemble(r.lines, true), text);
  assert.deepEqual(r.lines, ["Natural diamond", "is much harder", "than moissanite"]);
});

test("line-break vi: giữ nguyên dấu, không cắt giữa từ; vượt số dòng -> overflow", () => {
  const text = "Kim cương cứng nhất hành tinh, đạt mười trên mười trên thang Mohs";
  const r = breakLines(text, optsOf("vi-VN", { maxUnits: 18, maxLines: 2 }));
  assert.equal(r.overflow, true);
  assert.equal(r.reason, "too-many-lines");
  assert.equal(reassemble(r.lines, true), text);
  assert.ok(r.lines.every((l) => !l.startsWith(" ") && !l.endsWith(" ")));
});

test("line-break: chuỗi rỗng / chỉ khoảng trắng -> không có dòng", () => {
  for (const code of ["en-US", "ja-JP", "th-TH"]) {
    assert.deepEqual(breakLines("", optsOf(code, { maxUnits: 5 })), { lines: [], overflow: false, reason: "" });
    assert.deepEqual(breakLines("   \n ", optsOf(code, { maxUnits: 5 })).lines, []);
  }
});

test("line-break: chuỗi rất dài không có khoảng trắng bị chẻ theo ký tự, báo overflow khi quá số dòng", () => {
  const long = "x".repeat(100);
  const r = breakLines(long, optsOf("en-US", { maxUnits: 10, maxLines: 2 }));
  assert.equal(r.overflow, true);
  assert.equal(r.lines.length, 10);
  assert.ok(r.lines.every((l) => countGraphemes(l) <= 10));
  assert.equal(r.lines.join(""), long);
  const ok = breakLines(long.slice(0, 20), optsOf("en-US", { maxUnits: 10, maxLines: 2 }));
  assert.equal(ok.overflow, false);
});

test("line-break: toàn số và dấu câu", () => {
  const digits = "3141592653589793238462643383279";
  const r = breakLines(digits, optsOf("th-TH", { maxUnits: 12, maxLines: 3 }));
  assert.equal(r.lines.join(""), digits);
  assert.ok(r.lines.every((l) => countGraphemes(l) <= 12));
  assert.equal(r.overflow, false);
  const punct = breakLines("!!!???...,,,", optsOf("en-US", { maxUnits: 5, maxLines: 5 }));
  assert.equal(punct.lines.join(""), "!!!???...,,,");
  assert.ok(punct.lines.every((l) => countGraphemes(l) <= 5));
});

// ----------------------------------------------------------------------------------------------
// ja: theo từ + kinsoku
// ----------------------------------------------------------------------------------------------
test("line-break ja: không dòng nào bắt đầu bằng ký tự cấm đầu dòng hay kết thúc bằng ký tự cấm cuối dòng", () => {
  const texts = [
    "ダイヤモンドは天然の鉱物の中でも特に硬いとされています。",
    "モース硬度は10で、靭性（割れにくさ）とは別の性質です。",
    "「ダイヤモンド」と「モアッサナイト」の違い、知っていますか？",
    "ルビーとサファイアは、どちらもコランダムの仲間・・・ですね！",
  ];
  for (const text of texts) {
    for (const maxUnits of [6, 7, 8, 9, 10, 12]) {
      const r = breakLines(text, optsOf("ja-JP", { maxUnits, maxLines: 10 }));
      assert.equal(r.lines.join(""), text.replace(/\s+/g, ""), `${maxUnits}: ${text}`);
      r.lines.slice(1).forEach((l) => assert.ok(!NO_START.has([...l][0]), `dòng bắt đầu bằng "${[...l][0]}": ${JSON.stringify(r.lines)}`));
      r.lines.slice(0, -1).forEach((l) => assert.ok(!NO_END.has([...l].at(-1)), `dòng kết thúc bằng "${[...l].at(-1)}": ${JSON.stringify(r.lines)}`));
    }
  }
});

test("line-break ja: 。 đứng riêng sau từ dài -> đẩy ký tự cuối xuống chứ không để 。 đầu dòng", () => {
  const r = breakLines("あいうえお。", optsOf("ja-JP", { maxUnits: 5, maxLines: 3 }));
  assert.deepEqual(r.lines, ["あいうえ", "お。"]);
  assert.equal(r.overflow, false);
  const r2 = breakLines("硬い宝石です。", optsOf("ja-JP", { maxUnits: 4, maxLines: 3 }));
  assert.deepEqual(r2.lines, ["硬い宝石", "です。"]);
});

test("line-break ja: 「 không nằm cuối dòng, ー ・ ） không nằm đầu dòng", () => {
  assert.equal(canBreak({ text: "を" }, { text: "「ダイヤ" }, true), true);
  assert.equal(canBreak({ text: "「" }, { text: "ダイヤ" }, true), false);
  assert.equal(canBreak({ text: "ダイヤ" }, { text: "ー" }, true), false);
  assert.equal(canBreak({ text: "ダイヤ" }, { text: "・" }, true), false);
  assert.equal(canBreak({ text: "ダイヤ" }, { text: "）" }, true), false);
  assert.equal(canBreak({ text: "ダイヤ" }, { text: "）" }, false), true);
  const r = breakLines("宝石を「ダイヤモンド」と呼びます", optsOf("ja-JP", { maxUnits: 5, maxLines: 6 }));
  r.lines.slice(0, -1).forEach((l) => assert.ok(![...l].at(-1).includes("「")));
});

test("line-break ja: ngắt theo từ (không cắt giữa 'ダイヤモンド' nếu còn vừa), cân bằng khi bật balance", () => {
  const atoms = atomize("ダイヤモンドは硬いです", { language: "ja", mode: "segmenter" }).map((a) => a.text);
  assert.ok(atoms.includes("ダイヤモンド"));
  const text = "モース硬度は十です";
  const greedy = breakLines(text, optsOf("ja-JP", { maxUnits: 8, maxLines: 2 }));
  const bal = breakLines(text, optsOf("ja-JP", { maxUnits: 8, maxLines: 2, balance: true }));
  assert.equal(bal.lines.join(""), text);
  const spread = (r) => Math.max(...r.lines.map(countGraphemes)) - Math.min(...r.lines.map(countGraphemes));
  assert.ok(spread(bal) <= spread(greedy), `${JSON.stringify(greedy.lines)} vs ${JSON.stringify(bal.lines)}`);
});

test("line-break ja: đo bằng px (measure) thay cho số ký tự", () => {
  const measure = (s) => [...s].length * 40; // mỗi chữ 40px
  const r = breakLines("ダイヤモンドは硬いです", { ...optsOf("ja-JP"), measure, maxWidth: 200, maxLines: 3 });
  for (const l of r.lines) assert.ok(measure(l) <= 200, l);
  assert.equal(r.lines.join(""), "ダイヤモンドは硬いです");
});

// ----------------------------------------------------------------------------------------------
// th: theo từ
// ----------------------------------------------------------------------------------------------
test("line-break th: ngắt ở ranh giới từ, không cắt giữa dấu/nguyên âm kết hợp", () => {
  const text = "เพชรเป็นอัญมณีที่แข็งที่สุดชนิดหนึ่ง ค่าความแข็งโมห์สคือ 10";
  const r = breakLines(text, optsOf("th-TH", { maxUnits: 14, maxLines: 6 }));
  assert.equal(r.lines.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
  for (const l of r.lines) {
    assert.ok(countGraphemes(l) <= 14, l);
    // dòng không bắt đầu bằng nguyên âm/dấu kết hợp (ั ิ ี ื ุ ู ่ ้ ็ ์ ะ า ำ)
    assert.doesNotMatch(l, /^[ะ-ฺๅ็-๎]/u, l);
  }
  assert.ok(r.lines.length >= 3);
});

test("line-break th: một cụm dài không có chỗ ngắt vẫn được chẻ theo grapheme (giữ nguyên cụm ký tự)", () => {
  const word = "อัญมณีอัญมณีอัญมณีอัญมณีอัญมณี";
  const r = breakLines(word, optsOf("th-TH", { maxUnits: 6, maxLines: 9 }));
  assert.equal(r.lines.join(""), word);
  assert.ok(r.lines.every((l) => countGraphemes(l) <= 6));
});

// ----------------------------------------------------------------------------------------------
// caption: căn token TTS + gom cụm
// ----------------------------------------------------------------------------------------------
test("alignBoundaries: gắn dấu câu đúng token (vi: biệt:, đời,; bỏ '—' đứng riêng)", () => {
  const src = "Vàng vàng hay Vàng trắng — giờ thì bạn đã rõ rồi đấy!";
  const spoken = ["Vàng", "vàng", "hay", "Vàng", "trắng", "giờ", "thì", "bạn", "đã", "rõ", "rồi", "đấy"];
  const { tokens, misses } = alignBoundaries(src, spoken);
  assert.equal(misses, 0);
  assert.deepEqual(tokens, ["Vàng", "vàng", "hay", "Vàng", "trắng", "giờ", "thì", "bạn", "đã", "rõ", "rồi", "đấy!"]);
  assert.deepEqual(alignBoundaries("Sự khác biệt: hơn, kém.", ["Sự", "khác", "biệt", "hơn", "kém"]).tokens, ["Sự", "khác", "biệt:", "hơn,", "kém."]);
});

test("alignBoundaries ja: 、。 dính token trước, 「 dính token sau", () => {
  const { tokens } = alignBoundaries("ダイヤモンドは、「とても」硬い宝石です。", ["ダイヤモンド", "は", "とても", "硬い", "宝石", "です"]);
  assert.deepEqual(tokens, ["ダイヤモンド", "は、", "「とても」", "硬い", "宝石", "です。"]);
});

test("alignBoundaries th: bỏ khoảng trắng, giữ chữ; từ không tìm thấy -> dùng chữ TTS và đếm misses", () => {
  const { tokens, misses } = alignBoundaries("ค่าความแข็ง คือ 10", ["ค่า", "ความ", "แข็ง", "คือ", "10"]);
  assert.deepEqual(tokens, ["ค่า", "ความ", "แข็ง", "คือ", "10"]);
  assert.equal(misses, 0);
  const miss = alignBoundaries("abc", ["abc", "zzz"]);
  assert.equal(miss.misses, 1);
  assert.deepEqual(miss.tokens, ["abc", "zzz"]);
});

// Bản sao NGUYÊN VĂN thuật toán gom cụm vi-VN cũ (templates/auto-compare/index.html trước đa thị trường) — vi phải ra đúng như cũ.
function legacyChunk(words) {
  const isClause = (s) => /[,.:;!?]$/.test(s);
  const out = [];
  let cur = [];
  let chars = 0;
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    chars += words[i].length + 1;
    const clause = isClause(words[i]);
    const nextClause = i + 1 < words.length && isClause(words[i + 1]);
    if ((clause && cur.length >= 2) || chars >= 22 || cur.length >= 5 || (cur.length >= 4 && !nextClause)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

test("chunkCaption vi: giống hệt thuật toán cũ trên nhiều câu", () => {
  const p = locale("vi-VN").layout.caption;
  const sentences = [
    "Đây là Vàng vàng.",
    "Chọn nhẫn cưới: Vàng vàng truyền thống hay vàng trắng hiện đại?",
    "Vàng vàng còn có một ưu điểm đặc biệt: rất hợp làm nhẫn cưới truyền đời, gắn kết gia đình qua nhiều thế hệ.",
    "Còn vàng trắng có một điểm cộng lớn: giúp tôn sáng viên đá chính, khiến kim cương lấp lánh và nổi bật hơn hẳn.",
    "Vàng trắng cần xi mạ lại lớp Rhodium sau vài năm để giữ độ sáng bóng như mới.",
    "Thích truyền thống chọn vàng vàng, chuộng hiện đại trẻ trung thì chốt ngay vàng trắng nhé!",
    "Moissanite cực kỳ cứng, độ cứng Mohs 9,25 — chỉ kém kim cương một chút.",
    "A", "A B", "Một. Hai. Ba. Bốn. Năm. Sáu.",
  ];
  for (const s of sentences) {
    const words = s.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
    const expected = legacyChunk(words);
    const got = chunkCaption(words, p, { kinsoku: false }).map((g) => g.map((i) => words[i]));
    assert.deepEqual(got, expected, s);
  }
});

test("chunkCaption ja: cụm <= maxUnits, không bắt đầu bằng dấu cấm đầu dòng, ghép lại đủ token", () => {
  const p = locale("ja-JP").layout.caption;
  const { tokens } = alignBoundaries(
    "ダイヤモンドは、とても硬い宝石とされています。モース硬度は10です。",
    ["ダイヤモンド", "は", "とても", "硬い", "宝石", "と", "さ", "れ", "てい", "ます", "モース", "硬度", "は", "10", "です"],
  );
  const groups = chunkCaption(tokens, p, { kinsoku: true });
  assert.deepEqual(groups.flat(), tokens.map((_, i) => i));
  for (const g of groups) {
    const text = g.map((i) => tokens[i]).join("");
    assert.ok(countGraphemes(text) <= Math.ceil(p.maxUnits * 1.5), text);
    assert.ok(!NO_START.has([...text][0]), text);
  }
  assert.ok(groups.length >= 2);
});

test("chunkCaption: weakStartPattern giữ trợ từ ngắn dính token trước; fits() đóng cụm khi tràn khung", () => {
  const p = { maxTokens: 2, hardMaxTokens: 4, maxUnits: 99, clauseMinTokens: 2, clauseEnders: "。", joiner: "", weakStartPattern: "^[\\p{Script=Hiragana}]{1,2}$" };
  const g = chunkCaption(["硬い", "宝石", "と", "されます"], p, {});
  assert.deepEqual(g, [[0, 1, 2], [3]]);
  const widthOf = (group) => group.join("").length * 10;
  const g2 = chunkCaption(["aaaa", "bbbb", "cccc", "dddd"], { ...p, weakStartPattern: undefined, maxTokens: 4, hardMaxTokens: 4 }, { fits: (grp) => widthOf(grp) <= 80 });
  assert.deepEqual(g2, [[0, 1], [2, 3]]);
});

test("chunkCaption th: token ghép lại đủ, không vượt hardMaxTokens", () => {
  const p = locale("th-TH").layout.caption;
  const tokens = ["เพชร", "เป็น", "อัญมณี", "ที่", "แข็ง", "ที่สุด", "ชนิด", "หนึ่ง", "ค่า", "ความ", "แข็ง", "โมห์ส", "คือ", "10"];
  const groups = chunkCaption(tokens, p, {});
  assert.deepEqual(groups.flat(), tokens.map((_, i) => i));
  assert.ok(groups.every((g) => g.length <= p.hardMaxTokens));
});

test("locale layout: mỗi locale đều có tham số ngắt dòng (độ rộng / số dòng) trong config", () => {
  for (const l of listLocales()) {
    assert.ok(["space", "segmenter"].includes(l.layout.lineBreak.mode), l.code);
    assert.ok(l.layout.label.maxLines >= 1 && l.layout.label.maxUnitsPerLine >= 1, l.code);
    assert.ok(l.layout.caption.maxUnits >= 1, l.code);
  }
  assert.equal(locale("ja-JP").layout.lineBreak.kinsoku, true);
  assert.equal(locale("ja-JP").layout.lineBreak.mode, "segmenter");
  assert.equal(locale("th-TH").layout.lineBreak.mode, "segmenter");
  assert.equal(locale("en-US").layout.lineBreak.mode, "space");
  assert.equal(locale("vi-VN").layout.lineBreak.mode, "space");
});

test("validateLocale: tham số layout sai bị từ chối", async () => {
  const { validateLocale } = await import("../scripts/lib/locales.mjs");
  const fs = await import("node:fs");
  const base = JSON.parse(fs.readFileSync(new URL("../config/locales/ja-JP.json", import.meta.url), "utf8"));
  const bad = (mut) => { const r = structuredClone(base); mut(r); return validateLocale(r).problems.join(" | "); };
  assert.match(bad((r) => { r.layout.lineBreak.mode = "magic"; }), /lineBreak/);
  assert.match(bad((r) => { delete r.layout.lineBreak.balance; }), /lineBreak/);
  assert.match(bad((r) => { r.layout.label.maxLines = 0; }), /label\.maxLines/);
  assert.match(bad((r) => { r.layout.label.minFontPx = 99; }), /minFontPx/);
  assert.match(bad((r) => { r.layout.caption.weakStartPattern = "([";}), /weakStartPattern/);
  assert.match(bad((r) => { r.layout.caption.hardMaxTokens = 1; }), /hardMaxTokens/);
  assert.match(bad((r) => { delete r.video.hookLine; }), /hookLine/);
  assert.equal(bad(() => {}), "");
});
