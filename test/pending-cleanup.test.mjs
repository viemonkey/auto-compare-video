// Dọn videos/<slug>/ sau render khi gặp EPERM: retry 1s/3s/5s, danh sách chờ bền, an toàn (chỉ xoá khi MP4 còn), videoPath luôn trỏ file tồn tại.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCleanupQueue, existingVideoWebPath, CLEANUP_DELAYS_MS } from "../scripts/lib/pending-cleanup.mjs";

function setup({ slug = "vid", mp4 = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pc-"));
  const videos = path.join(root, "videos");
  const output = path.join(root, "output");
  fs.mkdirSync(path.join(videos, slug), { recursive: true });
  fs.writeFileSync(path.join(videos, slug, "index.html"), "x");
  fs.mkdirSync(output, { recursive: true });
  if (mp4) fs.writeFileSync(path.join(output, `${slug}.mp4`), Buffer.alloc(200 * 1024));
  const logs = [];
  const log = { warn: (m) => logs.push(m), info: (m) => logs.push(m) };
  const file = path.join(root, "data", "pending-cleanup.json");
  const mk = (extra = {}) => createCleanupQueue({ file, videosDir: videos, outputDir: output, log, ...extra });
  return { root, videos, output, logs, file, mk, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const eperm = () => Object.assign(new Error("EPERM: operation not permitted, rmdir"), { code: "EPERM" });

test("delays mặc định là 1s, 3s, 5s", () => {
  assert.deepEqual(CLEANUP_DELAYS_MS, [1000, 3000, 5000]);
});

test("EPERM 2 lần rồi được: retry theo delay 1s/3s, dọn xong, KHÔNG vào danh sách chờ", async () => {
  const t = setup();
  try {
    let n = 0;
    const slept = [];
    const q = t.mk({ rm: (dir) => { if (++n <= 2) throw eperm(); fs.rmSync(dir, { recursive: true, force: true }); }, sleep: async (ms) => slept.push(ms) });
    assert.equal(await q.cleanNowOrDefer("vid"), true);
    assert.deepEqual(slept, [1000, 3000]);
    assert.equal(fs.existsSync(path.join(t.videos, "vid")), false);
    assert.deepEqual(q.list(), []);
  } finally { t.done(); }
});

test("EPERM mãi: thử 4 lần (1s,3s,5s giữa các lần), vào danh sách chờ (file bền), log nêu rõ thư mục", async () => {
  const t = setup();
  try {
    let n = 0;
    const slept = [];
    const q = t.mk({ rm: () => { n++; throw eperm(); }, sleep: async (ms) => slept.push(ms) });
    assert.equal(await q.cleanNowOrDefer("vid"), false);
    assert.equal(n, 4);
    assert.deepEqual(slept, [1000, 3000, 5000]);
    assert.ok(fs.existsSync(path.join(t.videos, "vid")), "thư mục còn nguyên");
    assert.deepEqual(q.list().map((j) => j.slug), ["vid"]);
    assert.ok(t.logs.some((l) => /đang chờ dọn/.test(l) && l.includes(path.join(t.videos, "vid"))), t.logs.join("\n"));
    // sống qua restart: instance mới đọc lại cùng file
    assert.deepEqual(t.mk().list().map((j) => j.slug), ["vid"]);
  } finally { t.done(); }
});

test("processPending (tick sau / khởi động): hết bị giữ thì dọn và gỡ khỏi danh sách; còn bị giữ thì giữ lại và tăng số lần thử", async () => {
  const t = setup();
  try {
    let locked = true;
    const q = t.mk({ rm: (dir) => { if (locked) throw eperm(); fs.rmSync(dir, { recursive: true, force: true }); }, sleep: async () => {} });
    await q.cleanNowOrDefer("vid");
    const r1 = q.processPending();
    assert.deepEqual(r1.pending, ["vid"]);
    assert.ok(q.list()[0].attempts > 4);
    locked = false;
    const r2 = q.processPending();
    assert.deepEqual(r2.removed, ["vid"]);
    assert.deepEqual(q.list(), []);
    assert.equal(fs.existsSync(path.join(t.videos, "vid")), false);
  } finally { t.done(); }
});

test("AN TOÀN: MP4 thành phẩm không còn -> KHÔNG xoá thư mục, bỏ khỏi danh sách chờ; slug thoát khỏi videos/ bị bỏ qua", async () => {
  const t = setup({ mp4: false });
  try {
    let removed = 0;
    const q = t.mk({ rm: () => { removed++; }, sleep: async () => {} });
    q.enqueue("vid", "EPERM");
    q.enqueue("../evil", "x");
    const r = q.processPending();
    assert.equal(removed, 0);
    assert.deepEqual(r.dropped.sort(), ["../evil", "vid"].sort());
    assert.deepEqual(q.list(), []);
    assert.ok(fs.existsSync(path.join(t.videos, "vid")));
  } finally { t.done(); }
});

test("thư mục đã biến mất (ai đó xoá tay) -> coi như xong, gỡ khỏi danh sách", () => {
  const t = setup();
  try {
    const q = t.mk({ rm: () => {} });
    q.enqueue("vid", "EPERM");
    fs.rmSync(path.join(t.videos, "vid"), { recursive: true });
    assert.deepEqual(q.processPending().removed, ["vid"]);
    assert.deepEqual(q.list(), []);
  } finally { t.done(); }
});

test("existingVideoWebPath: luôn trỏ file đang tồn tại (output/ trước, rồi renders/), không thấy cả hai thì trả output/", () => {
  const out = "/output/a.mp4";
  const ren = "/videos/a/renders/x.mp4";
  assert.equal(existingVideoWebPath({ outputWeb: out, rendersWeb: ren, exists: (p) => p === out }), out);
  assert.equal(existingVideoWebPath({ outputWeb: out, rendersWeb: ren, exists: (p) => p === ren }), ren);
  assert.equal(existingVideoWebPath({ outputWeb: out, rendersWeb: ren, exists: () => true }), out);
  assert.equal(existingVideoWebPath({ outputWeb: out, rendersWeb: ren, exists: () => false }), out);
});
