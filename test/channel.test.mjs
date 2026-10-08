// Thẻ kênh theo thị trường (MỐC 1): config/locales/<code>.json → video.channel; vi-VN không khai báo → CHANNEL trong .env.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveChannel, applyChannelToHtml } from "../scripts/lib/channel.mjs";
import { resolveLocale, validateLocale, listLocales } from "../scripts/lib/locales.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("resolveChannel: locale khai báo thì thắng CHANNEL; không khai báo thì dùng CHANNEL; không có gì -> rỗng", () => {
  assert.deepEqual(resolveChannel({ locale: { code: "ja-JP", video: { channel: " 宝石チャンネル " } }, env: { CHANNEL: "HuyK" } }).channel, "宝石チャンネル");
  const vi = resolveChannel({ locale: { code: "vi-VN", video: {} }, env: { CHANNEL: "HuyK" } });
  assert.equal(vi.channel, "HuyK");
  assert.match(vi.source, /CHANNEL/);
  assert.equal(resolveChannel({ locale: { video: { channel: "  " } }, env: { CHANNEL: "A" } }).channel, "A");
  assert.equal(resolveChannel({ locale: { video: {} }, env: {} }).channel, "");
});

test("config thật: vi-VN KHÔNG khai báo video.channel (giữ hành vi cũ), ja/en/th có khai báo", () => {
  assert.equal(resolveLocale("vi-VN").video.channel, undefined);
  for (const code of ["ja-JP", "en-US", "th-TH"]) assert.ok(resolveLocale(code).video.channel, code);
});

test("validateLocale: video.channel rỗng hoặc quá dài bị từ chối", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "locales", "ja-JP.json"), "utf8"));
  assert.deepEqual(validateLocale(raw).problems, []);
  raw.video.channel = "";
  assert.match(validateLocale(raw).problems.join("|"), /video\.channel/);
  raw.video.channel = "x".repeat(41);
  assert.match(validateLocale(raw).problems.join("|"), /video\.channel/);
  for (const l of listLocales()) assert.ok(!l.video.channel || l.video.channel.length <= 40);
});

test("applyChannelToHtml: thay nội dung #eyebrow, escape HTML, idempotent, báo khi thiếu phần tử", () => {
  const html = '<div id="root"><div data-hf-id="x" id="eyebrow">cũ</div></div>';
  const r = applyChannelToHtml(html, 'A & <B>');
  assert.equal(r.changed, true);
  assert.match(r.html, /id="eyebrow">A &amp; &lt;B&gt;<\/div>/);
  assert.equal(applyChannelToHtml(r.html, "A & <B>").changed, false);
  assert.equal(applyChannelToHtml("<div></div>", "x").found, false);
});

test("sync-channel.mjs thật: video ja lấy tên kênh từ locale (bỏ qua CHANNEL), video vi dùng CHANNEL trong .env của video", () => {
  const base = path.join(ROOT, "videos", `_test-sync-${process.pid}`);
  const run = (locale, extraEnv) => {
    fs.rmSync(base, { recursive: true, force: true });
    fs.mkdirSync(path.join(base, "scripts"), { recursive: true });
    fs.copyFileSync(path.join(ROOT, "templates", "auto-compare", "sync-channel.mjs"), path.join(base, "scripts", "sync-channel.mjs"));
    fs.writeFileSync(path.join(base, "index.html"), '<div id="eyebrow">placeholder</div>');
    fs.writeFileSync(path.join(base, ".env"), `VIDEO_LOCALE=${locale}\n${extraEnv}`);
    const r = spawnSync(process.execPath, ["scripts/sync-channel.mjs"], { cwd: base, encoding: "utf8" });
    return { r, html: fs.readFileSync(path.join(base, "index.html"), "utf8") };
  };
  try {
    const ja = run("ja-JP", "CHANNEL=KHAC\n");
    assert.equal(ja.r.status, 0, ja.r.stderr);
    assert.match(ja.html, new RegExp(`>${resolveLocale("ja-JP").video.channel}</div>`));
    assert.doesNotMatch(ja.html, /KHAC/);
    const vi = run("vi-VN", "CHANNEL=KenhVi\n");
    assert.equal(vi.r.status, 0, vi.r.stderr);
    assert.match(vi.html, />KenhVi<\/div>/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
