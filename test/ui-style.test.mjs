import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(ROOT, "public", "style.css"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
const editor = fs.readFileSync(path.join(ROOT, "public", "field-editor.js"), "utf8");

test("design tokens gom màu, khoảng cách, cỡ chữ, bo góc, bóng và chiều cao điều khiển", () => {
  for (const token of [
    "--panel-raised", "--fg-dim", "--success", "--danger", "--focus",
    "--space-1", "--space-4", "--space-8", "--text-sm", "--text-xl",
    "--radius-sm", "--radius-lg", "--shadow-card", "--control-height",
  ]) assert.match(css, new RegExp(`${token}:`), token);
  assert.match(css, /min-height:\s*var\(--control-height\)/);
});

test("font Nhật và Thái dùng asset local, có dòng cao riêng", () => {
  assert.match(css, /NotoSansJP-Black-subset\.woff2/);
  assert.match(css, /NotoSansThai-Black\.woff2/);
  assert.match(css, /\.bi-main:lang\(ja\)[\s\S]*line-height:\s*1\.7/);
  assert.match(css, /\.bi-main:lang\(th\)[\s\S]*line-height:\s*1\.85/);
  assert.match(app, /input\.lang = currentLocaleInfo\(\)\?\.language/);
});

test("mobile 390px có breakpoint, bố cục một cột và điều khiển chạm đủ lớn", () => {
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /\.dropzone-grid,[\s\S]*\.studio-row-2\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.card-footer[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.modal-dialog\.wide[\s\S]*100dvh/);
});

test("focus bàn phím, lỗi tràn chữ và nút sửa luôn nhận biết được", () => {
  assert.match(css, /:focus-visible[\s\S]*outline:\s*3px solid var\(--focus\)/);
  assert.match(css, /\.bi-card\.has-danger[\s\S]*border:\s*2px solid var\(--danger\)/);
  assert.match(css, /\.bi-vi-actions \.bi-btn[^}]*opacity:\s*0\.62/);
  assert.match(editor, /btnRe\.classList\.toggle\("hidden", !\(gloss && text\.trim\(\) !== ""\)\)/);
});

test("hộp thoại thống kê chi phí rộng hơn hộp thường và slug dài bị cắt bằng … (không đẩy bảng ra ngoài)", () => {
  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  assert.match(html, /id="cost-stats-modal"[\s\S]*?class="modal-dialog wide cost-dialog"/);
  assert.match(css, /\.modal-dialog\.wide\.cost-dialog \{\s*max-width: min\(1240px, 100%\);/);
  assert.match(css, /\.cost-td-slug \{[^}]*max-width: clamp\([^}]*text-overflow: ellipsis/);
  assert.match(app, /class="cost-td-slug" title="\$\{escapeAttr\(v\.slug\)\}"/);
});
