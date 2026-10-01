// UI là ES module (<script type="module">): handler inline (onclick="fn()") gọi hàm của module sẽ ReferenceError vì hàm
// không nằm ở global. Mọi sự kiện phải gắn bằng addEventListener / event delegation — kể cả HTML sinh động trong
// template string của app.js. Test này quét HTML tĩnh và mã nguồn trình duyệt.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

function listFiles(dir, exts) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// thuộc tính on<event>=" hoặc on<event>=' (HTML tĩnh hoặc nằm trong chuỗi JS/template string); gán thuộc tính JS
// kiểu `reader.onload = fn` KHÔNG khớp vì sau dấu = không phải dấu nháy.
const INLINE_ATTR = /(^|[\s"'`<])on[a-z]+\s*=\s*["'\\]/i;
const JS_URL = /(href|src|action)\s*=\s*["']\s*javascript:/i;
const SET_ATTR = /setAttribute\(\s*["']on[a-z]+["']/i;

const files = listFiles(PUBLIC, [".html", ".js", ".mjs"]);

test("quét được file giao diện (index.html, app.js, shared)", () => {
  const names = files.map((f) => path.basename(f));
  assert.ok(names.includes("index.html"));
  assert.ok(names.includes("app.js"));
});

test("không còn handler inline on*= trong HTML tĩnh và template string của public/", () => {
  const offenders = [];
  for (const f of files) {
    fs.readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (INLINE_ATTR.test(line) || JS_URL.test(line) || SET_ATTR.test(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, [], `Handler inline không chạy được trong ES module — dùng addEventListener:\n${offenders.join("\n")}`);
});

test("bộ phát hiện bắt được các dạng handler inline (tự kiểm tra regex)", () => {
  for (const bad of [
    `<button onclick="foo()">`,
    `<input onchange='bar()'>`,
    "html = `<a onclick=\"x()\">`",
    `'<img onerror=\\"x()\\">'`,
    `<a href="javascript:void(0)">`,
    `el.setAttribute("onclick", "x()")`,
  ]) {
    assert.ok(INLINE_ATTR.test(bad) || JS_URL.test(bad) || SET_ATTR.test(bad), bad);
  }
  for (const ok of [`reader.onload = (e) => {`, `img.onerror = null;`, `const monitor = x;`, `<div data-action="click">`, `button.addEventListener("click", fn)`]) {
    assert.ok(!(INLINE_ATTR.test(ok) || JS_URL.test(ok) || SET_ATTR.test(ok)), ok);
  }
});
