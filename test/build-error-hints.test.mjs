import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildErrorHint } from "../public/shared/build-error-hints.mjs";
import { BUILD_STAGES, FileBuildJobStore, createBuildJob, runBuildJob } from "../scripts/lib/build-jobs.mjs";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("gợi ý lỗi: mã lỗi cụ thể thắng, thiếu ffprobe chỉ cách cài, mọi khâu đều có gợi ý tiếng Việt", () => {
  assert.match(buildErrorHint("voice", { code: "ENOENT", message: "spawn ffprobe ENOENT" }), /npm install/);
  assert.match(buildErrorHint("voice", { code: "MEDIA_TOOLS_MISSING" }), /ffmpeg\/ffprobe/);
  assert.match(buildErrorHint("render", { code: "INTERRUPTED" }), /Thử lại/);
  assert.match(buildErrorHint("voice", { message: "spawn ffprobe ENOENT" }), /npm install/);
  for (const stage of BUILD_STAGES) assert.match(buildErrorHint(stage.id, { message: "x" }), /[ăâêôơưđ]|Thử lại/i, stage.id);
  assert.match(buildErrorHint("không-có", {}), /Thử lại/);
});

test("khâu lỗi được lưu kèm gợi ý và mã lỗi để màn Bước 3 hiện được", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-hint-test-"));
  try {
    const store = new FileBuildJobStore(dir);
    const job = createBuildJob({ id: "33333333-3333-4333-8333-333333333333", slug: "demo", request: {} });
    store.write(job);
    const handlers = Object.fromEntries(BUILD_STAGES.map((s) => [s.id, async () => { if (s.id === "voice") throw Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" }); }]));
    const done = await runBuildJob(job.id, { store, handlers });
    const error = done.stages[0].error;
    assert.equal(error.code, "ENOENT");
    assert.match(error.hint, /npm install/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Bước 3: có đủ 3 nút, danh sách khâu, log gập lại + nút sao chép, và dùng job thay vì SSE", () => {
  const html = read("public", "index.html");
  const app = read("public", "app.js");
  for (const id of ["build-stages", "btn-build-retry", "btn-build-back", "btn-build-restart", "btn-copy-build-log", "build-error-card"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<details[^>]*build-error-tech[\s\S]*Log kỹ thuật/);
  assert.match(html, /Quay lại Bước 2/);
  assert.match(html, /Dựng lại từ đầu/);
  assert.match(app, /\/api\/build-jobs/);
  assert.doesNotMatch(app, /\/api\/create-video/);
  assert.match(app, /Mất kết nối tới server — đang tự thử lại/, "mất mạng không bắt tải lại trang");
  assert.doesNotMatch(app, /location\.reload/);
});
