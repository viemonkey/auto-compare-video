// Hiệu ứng spotlight của 2 panel ảnh (bên đang được nhắc phóng to + viền vàng, bên kia thu nhỏ + mất màu).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "templates", "auto-compare", "index.html"), "utf8");
const source = html.match(/\/\* focusSpans:start \*\/([\s\S]*?)\/\* focusSpans:end \*\//)?.[1];
assert.ok(source, "template phải có khối focusSpans:start/end");
const focusSpans = new Function(`${source}; return focusSpans;`)();

test("focusSpans: mỗi lần đổi bên kéo dài đến lần đổi kế tiếp, lần cuối đến hết video", () => {
  const spans = focusSpans([{ side: "right", at: 2.3 }, { side: "left", at: 0.55 }, { side: "both", at: 4 }], 38);
  assert.deepEqual(spans, [
    { side: "left", at: 0.55, end: 2.3 },
    { side: "right", at: 2.3, end: 4 },
    { side: "both", at: 4, end: 38 },
  ]);
});

test("focusSpans: không bao giờ có span âm/ngược dù mốc cuối vượt quá thời lượng", () => {
  const spans = focusSpans([{ side: "left", at: 40 }], 38);
  assert.equal(spans[0].end, 40);
  assert.deepEqual(focusSpans([], 38), []);
});

test("template: không dùng khung màu (độc lập màu ảnh), focus() chỉ ghi nhận rồi flushFocus chạy sau khi biết thời lượng", () => {
  assert.doesNotMatch(html, /\boutline(-offset)?\s*:|outlineColor|outlineOffset/, "không viền màu: hiệu ứng chỉ dựa vào kích thước/độ sáng");
  assert.doesNotMatch(html, /card-ring/);
  assert.match(html, /function focus\(side, at\) \{\s*FOCUS_EVENTS\.push/);
  assert.ok(html.indexOf("flushFocus(ROOT_DURATION)") > html.indexOf("/*TIMELINE_BEATS*/"), "flushFocus phải chạy SAU các lời gọi focus() do scaffold sinh");
  assert.ok(html.indexOf("flushFocus(ROOT_DURATION)") < html.indexOf('window.__timelines["main"]'), "và TRƯỚC khi đăng ký timeline");
});

test("template: không hạ opacity của .card (chỉ veil), bên được nhắc > 1 > bên còn lại, và hai card không chạm nhau", () => {
  const active = Number(html.match(/ACTIVE = \{ card: ([\d.]+)/)[1]);
  const idle = Number(html.match(/IDLE = \{ card: ([\d.]+)/)[1]);
  assert.ok(active > 1 && idle < 1);
  assert.doesNotMatch(html, /tl\.to\(card, \{[^}]*opacity/);
  // mỗi card phình/co tối đa (scale - 1) * 420 / 2 px về phía khe 48px; hai bên cộng lại phải để lại >= 12px
  assert.ok(((active - 1) * 420) / 2 + ((1 - idle) * 420) / 2 <= 48 - 12);
  assert.match(html, /left: 96px;/);
});
