// Phụ đề karaoke: câu cũ phải tắt hẳn TRƯỚC khi câu mới hiện (câu mới hiện sớm hơn chữ đầu 0.1s), nếu không hai câu
// đè lên nhau vài khung hình (lỗi thấy ở video tiếng Nhật, nơi các câu nói sát nhau). Chạy đúng hàm captionWindow trong template.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "templates", "auto-compare", "index.html"), "utf8");
const source = html.match(/\/\* captionWindow:start \*\/([\s\S]*?)\/\* captionWindow:end \*\//)?.[1];
assert.ok(source, "template phải có khối captionWindow:start/end");
const { captionWindow, phraseTimes } = new Function(`${source}; return { captionWindow, phraseTimes };`)();

const LEAD = 0.1; // câu mới hiện sớm hơn chữ đầu 0.1s (xem tl.set(lineEl, { opacity: 1 }, firstAbs - 0.1))

// Beat n bắt đầu ở start, nói trong dur giây; từ cuối bắt đầu ở lastAt; chữ đầu ở 0.
const make = (beats) => {
  const vo = {};
  const captions = {};
  for (const [n, start, dur, firstAt, lastAt] of beats) {
    vo[n] = { start, dur };
    captions[n] = [["a", firstAt], ["b", (firstAt + lastAt) / 2], ["c", lastAt]];
  }
  return { vo, captions };
};

function assertNoOverlap({ vo, captions }) {
  const keys = Object.keys(captions).map(Number).sort((a, b) => a - b);
  for (let i = 0; i + 1 < keys.length; i++) {
    const [n, m] = [keys[i], keys[i + 1]];
    const { hideAt } = captionWindow(n, vo, captions);
    const appears = vo[m].start + captions[m][0][1] - LEAD;
    assert.ok(hideAt <= appears, `beat ${n} còn hiện (${hideAt.toFixed(3)}) khi beat ${m} đã hiện (${appears.toFixed(3)})`);
  }
}

test("câu nói sát nhau (từ cuối dài đến sát câu sau): câu cũ tắt trước khi câu mới hiện", () => {
  // đúng kiểu video tiếng Nhật: beat sau bắt đầu ngay khi beat trước hết, chữ đầu ở gần 0
  assertNoOverlap(make([[1, 0.0, 2.0, 0.0, 1.6], [2, 2.0, 1.7, 0.02, 1.4], [3, 3.7, 1.9, 0.0, 1.5], [4, 5.6, 2.2, 0.05, 1.9]]));
});

test("quét nhiều khoảng nghỉ: không bao giờ chồng, kể cả khi chữ đầu của câu sau ở 0", () => {
  for (const gap of [0, 0.02, 0.05, 0.1, 0.2, 0.4, 0.9, 1.5]) {
    for (const firstAt of [0, 0.03, 0.1, 0.3]) {
      assertNoOverlap(make([[1, 0, 2, 0, 1.8], [2, 2 + gap, 2, firstAt, 1.8], [3, 4 + gap * 2, 2, firstAt, 1.8]]));
    }
  }
});

test("còn chỗ trống thì giữ nguyên hành vi cũ: nán lại 0.75s rồi mờ dần 0.18s", () => {
  const { vo, captions } = make([[1, 0, 3, 0, 1.0], [2, 5, 2, 0.2, 1.0]]);
  const w = captionWindow(1, vo, captions);
  assert.ok(Math.abs(w.fadeStart - 1.75) < 1e-9);
  assert.ok(Math.abs(w.fadeDur - 0.18) < 1e-9);
});

test("beat không có phụ đề (nhãn rộng dùng chung dải y): câu cũ vẫn tắt kịp trước khi beat đó bắt đầu", () => {
  // beat 3 không có caption nhưng bắt đầu ở 4.0; caption beat 2 không được kéo dài sang đó
  const vo = { 1: { start: 0, dur: 2 }, 2: { start: 2, dur: 2 }, 3: { start: 4, dur: 2 }, 4: { start: 6, dur: 2 } };
  const captions = { 1: [["a", 0], ["b", 1.8]], 2: [["a", 0.1], ["b", 1.9]], 4: [["a", 0.1], ["b", 1.8]] };
  const { hideAt } = captionWindow(2, vo, captions);
  assert.ok(hideAt <= vo[3].start + 0.13 + 1e-9, `hideAt ${hideAt}`);
});

test("beat cuối: không có câu sau thì nán lại bình thường", () => {
  const { vo, captions } = make([[1, 0, 2, 0, 1.0]]);
  const w = captionWindow(1, vo, captions);
  assert.ok(Math.abs(w.fadeStart - 1.75) < 1e-9);
});

test("đổi cụm chữ trong 1 câu: cụm cũ ẩn không muộn hơn lúc cụm mới hiện (không có khung hình nào thấy cả hai)", () => {
  const starts = [0, 0.8, 1.7, 2.9];
  for (const base of [0, 1.234, 7.5, 12.345678]) {
    for (let pi = 0; pi + 1 < starts.length; pi++) {
      const cur = phraseTimes(base, starts, pi, base + 5);
      const next = phraseTimes(base, starts, pi + 1, base + 5);
      assert.ok(cur.hideAt <= next.showAt, `cụm ${pi} ẩn ${cur.hideAt} sau khi cụm ${pi + 1} hiện ${next.showAt}`);
    }
  }
});

test("cụm cuối của câu ẩn đúng lúc câu tắt hẳn (hideAt của captionWindow)", () => {
  const { vo, captions } = make([[1, 0, 2, 0, 1.0], [2, 5, 2, 0.2, 1.0]]);
  const w = captionWindow(1, vo, captions);
  const last = phraseTimes(0, [0, 0.5], 1, w.hideAt);
  assert.ok(Math.abs(last.hideAt - w.hideAt) < 1e-9);
});
