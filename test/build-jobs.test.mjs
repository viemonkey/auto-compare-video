import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILD_STAGES, FileBuildJobStore, createBuildJob, resetJobForRetry, runBuildJob } from "../scripts/lib/build-jobs.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "build-jobs-test-"));

for (const failedStage of BUILD_STAGES.map((stage) => stage.id)) {
  test(`build job: lỗi ở ${failedStage} thì thử lại đúng từ khâu đó`, async () => {
    const dir = tmp();
    try {
      const store = new FileBuildJobStore(dir);
      const job = createBuildJob({ id: "11111111-1111-4111-8111-111111111111", slug: "demo-ja", request: { content: { title: "x" } } });
      store.write(job);
      const calls = Object.fromEntries(BUILD_STAGES.map((stage) => [stage.id, 0]));
      let shouldFail = true;
      const handlers = Object.fromEntries(BUILD_STAGES.map((stage) => [stage.id, async () => {
        calls[stage.id]++;
        if (stage.id === failedStage && shouldFail) throw Object.assign(new Error(`hỏng ${stage.id}`), { code: "TEST_FAIL" });
      }]));

      const first = await runBuildJob(job.id, { store, handlers });
      assert.equal(first.status, "error");
      assert.equal(first.activeStage, failedStage);
      assert.equal(first.stages.find((stage) => stage.id === failedStage).error.code, "TEST_FAIL");

      shouldFail = false;
      store.write(resetJobForRetry(store.read(job.id)));
      const second = await runBuildJob(job.id, { store, handlers });
      assert.equal(second.status, "success");
      const failedIndex = BUILD_STAGES.findIndex((stage) => stage.id === failedStage);
      BUILD_STAGES.forEach((stage, index) => {
        assert.equal(calls[stage.id], index < failedIndex ? 1 : index === failedIndex ? 2 : 1, stage.id);
      });
      assert.ok(second.stages.every((stage) => stage.status === "done"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("build job: request kịch bản được giữ nguyên, pipeline không có khâu gọi Gemini", async () => {
  const dir = tmp();
  try {
    const store = new FileBuildJobStore(dir);
    const request = { content: { title: "Nội dung đã duyệt" }, pendingSlug: "_pending-old" };
    const job = createBuildJob({ id: "22222222-2222-4222-8222-222222222222", slug: "demo", request });
    store.write(job);
    await runBuildJob(job.id, { store, handlers: Object.fromEntries(BUILD_STAGES.map((stage) => [stage.id, async () => {}])) });
    assert.deepEqual(store.read(job.id).request, request);
    assert.deepEqual(BUILD_STAGES.map((stage) => stage.id), ["voice", "timing", "scene", "render", "check"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
