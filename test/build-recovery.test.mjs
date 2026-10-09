import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileBuildJobStore, createBuildJob, jobSummary, latestJobBySlug, recoverInterruptedJobs, resetJobForRetry, runBuildJob, BUILD_STAGES } from "../scripts/lib/build-jobs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "build-recovery-test-"));
const ID = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

test("tải lại trang: job đang lỗi đọc lại nguyên vẹn từ đĩa bằng store mới (mô phỏng restart server)", async () => {
  const dir = tmp();
  try {
    const first = new FileBuildJobStore(dir);
    const job = createBuildJob({ id: ID(1), slug: "demo-ja", request: { content: { title: "giữ nguyên" } } });
    first.write(job);
    const handlers = Object.fromEntries(BUILD_STAGES.map((s) => [s.id, async () => { if (s.id === "render") throw new Error("hết RAM"); }]));
    await runBuildJob(job.id, { store: first, handlers });

    const second = new FileBuildJobStore(dir); // tiến trình mới, không còn gì trong bộ nhớ
    const restored = second.read(job.id);
    assert.equal(restored.status, "error");
    assert.deepEqual(restored.stages.map((s) => s.status), ["done", "done", "done", "error", "pending"]);
    assert.deepEqual(restored.request, { content: { title: "giữ nguyên" } });
    assert.match(restored.stages[3].error.hint, /Thử lại/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("server khởi động lại giữa lúc đang chạy: job chuyển thành lỗi INTERRUPTED ở đúng khâu và thử lại chạy tiếp được", async () => {
  const dir = tmp();
  try {
    const store = new FileBuildJobStore(dir);
    const job = createBuildJob({ id: ID(2), slug: "demo-en", request: {} });
    job.status = "running";
    job.stages[0].status = "done";
    job.stages[1].status = "done";
    job.stages[2].status = "running"; // đang dựng cảnh thì server chết
    store.write(job);

    assert.deepEqual(recoverInterruptedJobs(store, { isRunning: () => true }), [], "job đang chạy thật trong tiến trình thì giữ nguyên");
    assert.deepEqual(recoverInterruptedJobs(store), [job.id]);
    const recovered = store.read(job.id);
    assert.equal(recovered.status, "error");
    assert.equal(recovered.activeStage, "scene");
    assert.equal(recovered.stages[2].error.code, "INTERRUPTED");
    assert.match(recovered.stages[2].error.hint, /Thử lại/);
    assert.deepEqual(recoverInterruptedJobs(store), [], "chạy lần 2 không đổi gì");

    const calls = [];
    const handlers = Object.fromEntries(BUILD_STAGES.map((s) => [s.id, async () => { calls.push(s.id); }]));
    store.write(resetJobForRetry(store.read(job.id)));
    const done = await runBuildJob(job.id, { store, handlers });
    assert.equal(done.status, "success");
    assert.deepEqual(calls, ["scene", "render", "check"], "chỉ chạy tiếp từ khâu bị ngắt");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("danh sách video: lấy job mới nhất của mỗi slug để hiện Đang dựng / Lỗi", () => {
  const dir = tmp();
  try {
    const store = new FileBuildJobStore(dir);
    const old = createBuildJob({ id: ID(3), slug: "demo", request: {}, now: () => Date.parse("2026-10-01T00:00:00Z") });
    old.status = "success";
    old.updatedAt = "2026-10-01T00:00:00.000Z";
    const fresh = createBuildJob({ id: ID(4), slug: "demo", request: {}, now: () => Date.parse("2026-10-02T00:00:00Z") });
    fresh.status = "error";
    fresh.updatedAt = "2026-10-02T00:00:00.000Z";
    store.write(old);
    store.write(fresh);
    const latest = latestJobBySlug(store).get("demo");
    assert.equal(latest.id, fresh.id);
    assert.deepEqual(Object.keys(jobSummary(latest)).sort(), ["activeStage", "id", "slug", "status", "updatedAt"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("giao diện + server nối đủ: tự khôi phục job khi tải trang, video lỗi hiện nhãn Lỗi và mở lại được", () => {
  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "server.mjs"), "utf8");
  assert.match(app, /restoreBuildJob\(\);/);
  assert.match(app, /localStorage\.setItem\(BUILD_JOB_KEY/);
  assert.match(app, /status-badge error">Lỗi</);
  assert.match(app, /btn-open-job/);
  assert.match(server, /recoverInterruptedJobs\(buildJobStore/);
  assert.match(server, /v\.buildJob = jobSummary\(job\)/);
  assert.match(server, /writeRecord\(CONTENT_ARCHIVE_DIR, slug, buildRecord\(\{ content, locale, hashtagPlan, status: "building"/, "nháp được lưu trước khi khâu đầu chạy");
});
