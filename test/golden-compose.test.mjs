// GOLDEN index.html của luồng vi-VN sau khi tách font/ngắt dòng/vừa-khung theo thị trường: với nội dung + audio + word boundary cố định,
// index.html dựng ra phải giống snapshot (đã đối chiếu với bản dựng bằng template CŨ: ảnh render giống nhau từng điểm ảnh).
// Cập nhật snapshot (chỉ khi CHỦ ĐÍCH đổi giao diện): UPDATE_GOLDEN=1 npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLines, computeTiming, buildIndexHtml } from "../scripts/lib/compose.mjs";
import { planVideoText } from "../scripts/lib/fit-check.mjs";
import { resolveLocale } from "../scripts/lib/locales.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = path.join(ROOT, "test", "fixtures", "golden-vi", "compose");
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const UPDATE = process.env.UPDATE_GOLDEN === "1";

async function compose(locale, content, words, durations) {
  const lines = buildLines(content, locale);
  const timing = computeTiming(lines, durations);
  const plan = await planVideoText(
    { left: content.label_left, right: content.label_right, lines: lines.map((l) => ({ n: l.n, tokens: words[l.id].map((w) => String(w.t)) })) },
    locale,
    { forceEstimate: true }, // snapshot không phụ thuộc máy có Chrome hay không
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "compose-"));
  try {
    buildIndexHtml(dir, content, lines, timing, { left: ".jpg", right: ".jpg" }, locale, words, plan);
    return { html: fs.readFileSync(path.join(dir, "index.html"), "utf8"), lines, plan };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("golden vi: index.html dựng từ nội dung cố định giống snapshot", async () => {
  const vi = resolveLocale("vi-VN");
  const { html } = await compose(vi, read("content.json"), read("words.json"), read("durations.json"));
  const snap = path.join(FIX, "index.html");
  const norm = (s) => s.replace(/\r\n/g, "\n");
  if (UPDATE || !fs.existsSync(snap)) {
    fs.writeFileSync(snap, norm(html));
    return;
  }
  assert.equal(norm(html), norm(fs.readFileSync(snap, "utf8")));
});

test("vi: không còn placeholder; font local; cụm caption bằng thuật toán cũ; nhãn 46px in hoa nghiêng như trước", async () => {
  const vi = resolveLocale("vi-VN");
  const { html, plan } = await compose(vi, read("content.json"), read("words.json"), read("durations.json"));
  assert.doesNotMatch(html, /__[A-Z_]+__|\/\*[A-Z_]+\*\/|<!--AUDIO_TAGS-->/);
  assert.doesNotMatch(html, /fonts\.gstatic\.com/);
  assert.match(html, /<html lang="vi">/);
  assert.match(html, /--font-display: "Be Vietnam Pro", sans-serif;/);
  assert.match(html, /--label-px: 46px;/);
  assert.match(html, /--label-style: italic;/);
  assert.match(html, /--label-transform: uppercase;/);
  assert.match(html, /--cap-gap: 16px;/);
  assert.match(html, /const CAP_JOINER = " ";/);
  assert.match(html, /const CAP_ACTIVE_SCALE = 1\.13;/);
  assert.match(html, /<div class="lb-1">Bạch kim<\/div>/);
  assert.deepEqual(plan.phrases[1], [[4, 0]]);
});

test("ja: lang/font/kiểu chữ theo locale, caption không dấu cách, nhãn không in hoa/nghiêng", async () => {
  const ja = resolveLocale("ja-JP");
  const content = { title: "ダイヤモンドとモアッサナイト、違いは？", label_left: "ダイヤモンド", label_right: "モアッサナイト", points: [{ text: "ダイヤモンドは硬いです。", side: "left", tag: "硬い", sub: "", suggested_action: "explain-a" }] };
  const lines = buildLines(content, ja);
  assert.equal(lines[0].text, "これはダイヤモンドです。");
  assert.equal(lines.at(-1).tag, ja.video.payoffTag);
  const words = Object.fromEntries(lines.map((l) => [l.id, [{ t: l.text.slice(0, 3), s: 0, d: 0.3 }, { t: l.text.slice(3), s: 0.3, d: 0.5 }]]));
  const durations = Object.fromEntries(lines.map((l) => [l.id, 1.5]));
  const { html } = await compose(ja, content, words, durations);
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /font-family: "Noto Sans JP";/);
  assert.match(html, /src: url\(assets\/fonts\/noto-sans-jp\/NotoSansJP-Black-subset\.woff2\)/);
  assert.match(html, /--font-display: "Noto Sans JP", "Be Vietnam Pro", sans-serif;/);
  assert.match(html, /--label-style: normal;/);
  assert.match(html, /--label-transform: none;/);
  assert.match(html, /--cap-gap: 0px;/);
  assert.match(html, /const CAP_JOINER = "";/);
  assert.match(html, /const CAP_ACTIVE_SCALE = 1\.06;/);
  assert.match(html, /<div class="lb-1">ダイヤモンド<\/div>/);
  assert.match(html, /<div id="eyebrow"[^>]*>豆知識くらべ<\/div>|id="eyebrow">豆知識くらべ</);
  assert.match(html, /<title>比較 — ダイヤモンド vs モアッサナイト<\/title>/);
});

test("th: nhãn nhiều dòng được xuống dòng bằng <br> theo từ", async () => {
  const th = resolveLocale("th-TH");
  const content = { title: "เพชรกับมอยส์ซาไนต์ต่างกันอย่างไร", label_left: "เพชรธรรมชาติคุณภาพสูงพิเศษมากมาย", label_right: "มอยส์ซาไนต์", points: [{ text: "เพชรแข็งมาก", side: "left", tag: "แข็ง", sub: "", suggested_action: "explain-a" }] };
  const lines = buildLines(content, th);
  const words = Object.fromEntries(lines.map((l) => [l.id, [{ t: l.text, s: 0, d: 0.5 }]]));
  const durations = Object.fromEntries(lines.map((l) => [l.id, 1.5]));
  const { html } = await compose(th, content, words, durations);
  assert.match(html, /<html lang="th">/);
  assert.match(html, /--font-display: "Noto Sans Thai", "Be Vietnam Pro", sans-serif;/);
  assert.match(html, /<div class="lb-1">[^<]+<br>/);
});
