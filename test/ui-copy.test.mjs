import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");

test("nhãn Bước 2 thuần tiếng Việt và ví dụ Bước 1 thuộc ngành kim hoàn", () => {
  for (const mixed of ["Label Left", "Label Right", "Question Beat", "Comparison Points", "Slug ID", "Dev vs DevOps"]) {
    assert.doesNotMatch(html, new RegExp(mixed, "i"));
  }
  assert.match(html, /kim cương tự nhiên và kim cương nhân tạo/);
  assert.match(html, /Tên đối tượng bên trái/);
  assert.match(html, /Câu hỏi mở đầu/);
});

test("nút hashtag dùng cùng hệ nút và lý do khóa nằm ngay dưới nút dựng", () => {
  assert.match(html, /id="btn-add-hashtag" class="btn btn-secondary hashtag-action"/);
  assert.match(html, /id="btn-refresh-hashtags" class="btn btn-secondary hashtag-action"/);
  assert.match(html, /id="btn-approve-build"[^>]*aria-describedby="approve-lock-reason"/);
  assert.match(html, /id="approve-lock-reason"[^>]*role="status"/);
  assert.match(app, /Hãy rút gọn các dòng viền đỏ rồi thử lại/);
});

test("điều khiển chính dùng sprite SVG nội tuyến thay vì trộn emoji", () => {
  for (const id of ["icon-bolt", "icon-chart", "icon-folder", "icon-image", "icon-globe", "icon-spark", "icon-mic", "icon-save", "icon-rocket"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /[📷🤖🚀💰📁🖼️💡🎯🎙️🗣️🎵✨🏷️❓📝💾🌏]/u);
});
