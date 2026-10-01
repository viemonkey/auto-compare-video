import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-test-"));
process.env.SOCIAL_QUEUE_PATH = path.join(dir, "social-queue.json");
const Q = await import("../scripts/lib/social-queue.mjs");
const { classifyError, graphErrorFlags } = await import("../scripts/lib/fb-errors.mjs");

const reset = () => {
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
};
beforeEach(reset);

const pageA = { id: "A", name: "A", accessToken: "tokA-aaaaaaaaaaaa" };
const pageB = { id: "B", name: "B", accessToken: "tokB-bbbbbbbbbbbb" };
const MIN = 60_000;

test("pickEligiblePage: chỉ chọn page đã nghỉ đủ gap", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const hist = {
    A: { lastPostedAt: new Date(now - 10 * MIN).toISOString() },
    B: { lastPostedAt: new Date(now - 90 * MIN).toISOString() },
  };
  for (let i = 0; i < 20; i++) {
    assert.equal(Q.pickEligiblePage([pageA, pageB], hist, 30, 60, {}, now).id, "B");
  }
  assert.equal(Q.pickEligiblePage([pageA], hist, 30, 60, {}, now), null);
  assert.equal(Q.pickEligiblePage([pageA], {}, 30, 60, {}, now).id, "A");
});

test("pickEligiblePage: gap ngẫu nhiên trong [min,max]", () => {
  const now = Date.now();
  const hist = { A: { lastPostedAt: new Date(now - 45 * MIN).toISOString() } };
  assert.equal(Q.pickEligiblePage([pageA], hist, 30, 60, {}, now, () => 0)?.id, "A");
  assert.equal(Q.pickEligiblePage([pageA], hist, 30, 60, {}, now, () => 0.99), null);
});

test("disablePage: bỏ qua page cho tới khi token đổi", () => {
  Q.disablePage(pageA, "token EAAB1234567890abcdef hết hạn");
  const { disabledPages } = Q.loadQueue();
  assert.ok(!JSON.stringify(disabledPages).includes("EAAB1234567890abcdef"), "reason phải được che");
  assert.equal(Q.pickEligiblePage([pageA], {}, 30, 60, disabledPages), null);
  const fixed = { ...pageA, accessToken: "token-moi-cccccccc" };
  assert.equal(Q.pickEligiblePage([fixed], {}, 30, 60, disabledPages).id, "A");
  assert.equal(Q.listDisabledPages([pageA], disabledPages).length, 1);
  assert.equal(Q.listDisabledPages([fixed], disabledPages).length, 0);
  const pub = Q.publicQueueState();
  assert.equal(pub.disabledPages.A.tokenFingerprint, undefined);
});

test("backoff lỗi thường tăng dần, chặn trần 30 phút", () => {
  assert.equal(Q.retryBackoffMinutes(1), 2);
  assert.equal(Q.retryBackoffMinutes(3), 8);
  assert.equal(Q.retryBackoffMinutes(10), 30);
});

test("recordFailure: lỗi thường tăng attempts, đủ 5 lần thì failed", () => {
  const job = Q.enqueueVideo({ slug: "s", videoPath: "/x.mp4", caption: "c" });
  const now = Date.now();
  Q.recordFailure(job.id, new Error("boom"), now);
  let j = Q.loadQueue().queue[0];
  assert.equal(j.attempts, 1);
  assert.equal(j.status, "pending");
  assert.equal(Date.parse(j.nextAttemptAt), now + 2 * MIN);
  for (let i = 0; i < 4; i++) Q.recordFailure(job.id, new Error("boom"), now);
  j = Q.loadQueue().queue[0];
  assert.equal(j.status, "failed");
  assert.equal(Q.nextPendingJob(Q.loadQueue().queue), null);
});

test("recordFailure: rate limit backoff >=15 phút, KHÔNG tính attempts", () => {
  const job = Q.enqueueVideo({ slug: "s", videoPath: "/x.mp4", caption: "c" });
  const now = Date.now();
  const err = Object.assign(new Error("limit"), { rateLimited: true });
  for (let i = 0; i < 10; i++) Q.recordFailure(job.id, err, now);
  const j = Q.loadQueue().queue[0];
  assert.equal(j.attempts, 0);
  assert.equal(j.status, "pending");
  assert.ok(Date.parse(j.nextAttemptAt) - now >= 15 * MIN);
  assert.equal(Q.nextPendingJob([j], now), null);
  assert.equal(Q.nextPendingJob([j], now + 31 * MIN)?.id, job.id);
});

test("recordFailure: token che trong lastError", () => {
  const job = Q.enqueueVideo({ slug: "s", videoPath: "/x.mp4", caption: "c" });
  Q.recordFailure(job.id, new Error("bad access_token=EAABsecretsecret123 here"));
  assert.ok(!Q.loadQueue().queue[0].lastError.includes("secretsecret"));
});

test("phân loại lỗi: permanent / rate limit / tạm thời / file mất", () => {
  const f = (error, status = 400) => graphErrorFlags({ error }, status);
  assert.deepEqual(f({ type: "OAuthException", code: 190 }), { permanent: true, rateLimited: false });
  for (const code of [4, 17, 32, 613]) {
    assert.deepEqual(f({ type: "OAuthException", code }), { permanent: false, rateLimited: true }, `code ${code}`);
  }
  assert.equal(f({ type: "GraphMethodException", code: 1 }, 500).rateLimited, false);
  assert.equal(classifyError(Object.assign(new Error(), { permanent: true })), "permanent");
  assert.equal(classifyError(Object.assign(new Error(), { rateLimited: true })), "rate_limit");
  assert.equal(classifyError(Object.assign(new Error(), { fileMissing: true })), "file_missing");
  assert.equal(classifyError(new Error("ECONNRESET")), "transient");
});

test("luồng verifying: idempotent, finalize -> posts, pageHistory giữ", () => {
  const job = Q.enqueueVideo({ slug: "s", videoPath: "/x.mp4", caption: "c" });
  Q.recordVerifying(job.id, pageA, "vid1", { postType: "reel" });
  const first = Q.loadQueue().queue[0].verifyStartedAt;
  Q.recordVerifying(job.id, pageA, "vid1", { postType: "reel" });
  let data = Q.loadQueue();
  assert.equal(data.queue[0].status, "verifying");
  assert.equal(data.queue[0].verifyStartedAt, first);
  assert.ok(data.pageHistory.A.lastPostedAt);
  assert.equal(Q.nextPendingJob(data.queue), null);
  assert.equal(Q.verifyingJobs(data.queue).length, 1);
  Q.finalizeVerifiedPost(job.id, "vid1", { thumbnail: { ok: true, timeSec: 5 } });
  data = Q.loadQueue();
  assert.equal(data.queue.length, 0);
  assert.equal(data.posts[0].fbPostId, "vid1");
  assert.equal(data.posts[0].thumbnail.timeSec, 5);
});

test("failJobTerminal: failed, không retry", () => {
  const job = Q.enqueueVideo({ slug: "s", videoPath: "/x.mp4", caption: "c" });
  Q.failJobTerminal(job.id, "File không còn tồn tại");
  const { queue } = Q.loadQueue();
  assert.equal(queue[0].status, "failed");
  assert.equal(Q.nextPendingJob(queue), null);
});

test("chống enqueue trùng: slug đã đăng / đang chờ", () => {
  const a = Q.enqueueVideo({ slug: "s", videoPath: "/x.mp4", caption: "c" });
  assert.ok(a);
  assert.equal(Q.enqueueVideo({ slug: "s", videoPath: "/y.mp4", caption: "c" }), null);
  Q.recordPost(a.id, pageA, "post1", { postType: "reel" });
  assert.equal(Q.enqueueVideo({ slug: "s", videoPath: "/x.mp4", caption: "c" }), null);
  assert.ok(Q.enqueueVideo({ slug: "khac", videoPath: "/x.mp4", caption: "c" }));
});

test("atomic write: không để lại file tạm, nội dung đọc lại đúng", () => {
  Q.enqueueVideo({ slug: "s", videoPath: "/x.mp4", caption: "c" });
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
  assert.equal(JSON.parse(fs.readFileSync(process.env.SOCIAL_QUEUE_PATH, "utf8")).queue.length, 1);
});

test("file hỏng: backup social-queue.corrupt-*.json, khởi tạo queue rỗng, không crash", () => {
  fs.writeFileSync(process.env.SOCIAL_QUEUE_PATH, '{"queue": [ {"slug": "x"');
  const data = Q.loadQueue();
  assert.deepEqual(data.queue, []);
  const backups = fs.readdirSync(dir).filter((f) => f.startsWith("social-queue.corrupt-"));
  assert.equal(backups.length, 1);
  assert.ok(fs.readFileSync(path.join(dir, backups[0]), "utf8").includes('"slug": "x"'));
  assert.ok(Q.enqueueVideo({ slug: "moi", videoPath: "/x.mp4", caption: "c" }));
});

test("updateQueue: gọi lồng nhau bị chặn (không ghi đè nhau)", () => {
  assert.throws(() => Q.updateQueue(() => Q.updateQueue(() => true)), /lồng nhau/);
  assert.ok(Q.enqueueVideo({ slug: "s2", videoPath: "/x.mp4", caption: "c" }));
});

test("posts[] lưu caption THỰC TẾ (kể cả qua nhánh verifying); job không có hashtags giữ nguyên caption", () => {
  const plan = [{ tag: "#peridot", tier: "specific" }];
  const a = Q.enqueueVideo({ slug: "a", videoPath: "/x/a.mp4", caption: "Hook A?", hashtags: plan });
  const b = Q.enqueueVideo({ slug: "b", videoPath: "/x/b.mp4", caption: "Hook B?" });
  assert.deepEqual(a.hashtags, plan);
  assert.equal(b.hashtags, null);

  Q.recordPost(a.id, pageA, "fbA", { postType: "reel", caption: "Hook A?\n\n#peridot #daquy" });
  Q.recordVerifying(b.id, pageB, "vidB", { postType: "reel", caption: "Hook B?" });
  Q.finalizeVerifiedPost(b.id, "vidB");

  const { posts } = Q.loadQueue();
  assert.equal(posts.find((p) => p.slug === "a").caption, "Hook A?\n\n#peridot #daquy");
  assert.equal(posts.find((p) => p.slug === "b").caption, "Hook B?");
});
