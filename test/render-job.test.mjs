// Render job: log đầy đủ stdout+stderr, thông báo lỗi tiếng Việt kèm đuôi log, hàng đợi 1 render/lần.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJobQueue, runRenderJob, renderFailureMessage, cleanLines, pruneLogs } from "../scripts/lib/render-job.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "render-job-"));
const node = (code) => ({ command: process.execPath, args: ["-e", code] });

test("cleanLines: bỏ mã màu ANSI, tách theo \\n và \\r (thanh tiến độ ghi đè dòng), bỏ dòng trống", () => {
  const text = "\u001b[2K  █░░  5%  Compiling\r\u001b[2K  ██░  10%  Compiling\n\nxong\u001b[0m\n";
  assert.deepEqual(cleanLines(text), ["█░░  5%  Compiling", "██░  10%  Compiling", "xong"]);
});

test("runRenderJob: render lỗi mã 1 -> log chứa ĐỦ cả stdout lẫn stderr, tail bỏ dòng tiến độ, kèm mã thoát", async () => {
  const dir = tmp();
  try {
    const r = await runRenderJob({
      ...node(`
        console.log("[INFO] Pipeline started");
        for (let i = 1; i <= 40; i++) process.stdout.write("  █████░░░  50%  Streaming frame " + i + "/40\\r");
        console.error("Error: Chrome crashed: Target closed");
        console.log("Render aborted at frame 12");
        process.exit(1);
      `),
      cwd: dir, slug: "demo-ja", logDir: path.join(dir, "logs"),
    });
    assert.equal(r.code, 1);
    assert.ok(fs.existsSync(r.logFile));
    assert.match(path.basename(r.logFile), /^demo-ja_.*\.render\.log$/);
    const log = fs.readFileSync(r.logFile, "utf8");
    assert.match(log, /\[INFO\] Pipeline started/);
    assert.match(log, /Streaming frame 40\/40/, "log đầy đủ giữ cả dòng tiến độ");
    assert.match(log, /Error: Chrome crashed: Target closed/, "stderr nằm trong log");
    assert.match(log, /Render aborted at frame 12/);
    assert.match(log, /# kết thúc: mã=1/);
    assert.ok(!r.tail.some((l) => /Streaming frame/.test(l)), "tail không có dòng tiến độ");
    assert.ok(r.tail.includes("[stderr] Error: Chrome crashed: Target closed"));
    assert.ok(r.tail.includes("Render aborted at frame 12"));
    const msg = renderFailureMessage({ slug: "demo-ja", code: r.code, signal: r.signal, tail: r.tail, logFile: r.logFile });
    assert.match(msg, /^Render thất bại: thoát với mã 1\./);
    assert.match(msg, /Vài dòng cuối của log render:/);
    assert.match(msg, /Chrome crashed/);
    assert.ok(msg.includes(r.logFile));
    assert.match(msg, /cd videos\/demo-ja && npm run render/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runRenderJob: render thành công -> mã 0; lệnh không tồn tại -> lỗi rõ ràng, không treo", async () => {
  const dir = tmp();
  try {
    const ok = await runRenderJob({ ...node('console.log("◇  out.mp4")'), cwd: dir, slug: "ok", logDir: dir });
    assert.equal(ok.code, 0);
    assert.deepEqual(ok.tail, ["◇  out.mp4"]);
    const bad = await runRenderJob({ command: path.join(dir, "khong-co-lenh"), args: [], cwd: dir, slug: "bad", logDir: dir });
    assert.equal(bad.code, -1);
    assert.ok(bad.error);
    assert.match(renderFailureMessage({ slug: "bad", ...bad }), /không chạy được lệnh render/);
    assert.match(fs.readFileSync(bad.logFile, "utf8"), /lỗi=/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("renderFailureMessage: bị tín hiệu giết / log trống đều có câu giải thích", () => {
  assert.match(renderFailureMessage({ slug: "x", code: null, signal: "SIGKILL", tail: [], logFile: "a.log" }), /tín hiệu SIGKILL/);
  assert.match(renderFailureMessage({ slug: "x", code: 1, tail: [], logFile: "a.log" }), /không có dòng nào/);
});

test("hàng đợi: chỉ 1 job chạy mỗi lúc, đúng thứ tự vào, job chờ được báo số job phía trước", async () => {
  const q = createJobQueue({ concurrency: 1 });
  const events = [];
  let active = 0;
  let maxActive = 0;
  const job = (name, ms) => () => new Promise((resolve) => {
    active++; maxActive = Math.max(maxActive, active);
    events.push(`start ${name}`);
    setTimeout(() => { active--; events.push(`end ${name}`); resolve(name); }, ms);
  });
  const waits = [];
  const results = await Promise.all([
    q.enqueue(job("A", 40), { onWait: (n) => waits.push(["A", n]) }),
    q.enqueue(job("B", 10), { onWait: (n) => waits.push(["B", n]) }),
    q.enqueue(job("C", 10), { onWait: (n) => waits.push(["C", n]) }),
  ]);
  assert.deepEqual(results, ["A", "B", "C"]);
  assert.equal(maxActive, 1);
  assert.deepEqual(events, ["start A", "end A", "start B", "end B", "start C", "end C"]);
  assert.deepEqual(waits, [["B", 1], ["C", 2]], "A chạy ngay (không báo chờ); B chờ 1 job; C chờ 2 job");
  assert.equal(q.running, 0);
  assert.equal(q.waiting, 0);
});

test("hàng đợi: job lỗi (ném exception) không làm kẹt hàng — job sau vẫn chạy", async () => {
  const q = createJobQueue();
  const bad = q.enqueue(async () => { throw new Error("boom"); });
  const good = q.enqueue(async () => "ok");
  await assert.rejects(bad, /boom/);
  assert.equal(await good, "ok");
});

test("hàng đợi concurrency 2 cho phép 2 job song song (tham số, mặc định là 1)", async () => {
  const q = createJobQueue({ concurrency: 2 });
  let active = 0;
  let maxActive = 0;
  const job = () => new Promise((r) => { active++; maxActive = Math.max(maxActive, active); setTimeout(() => { active--; r(); }, 20); });
  await Promise.all([q.enqueue(job), q.enqueue(job), q.enqueue(job)]);
  assert.equal(maxActive, 2);
});

test("pruneLogs: chỉ giữ N file log mới nhất", () => {
  const dir = tmp();
  try {
    for (let i = 0; i < 5; i++) {
      const f = path.join(dir, `v${i}_x.render.log`);
      fs.writeFileSync(f, "x");
      fs.utimesSync(f, new Date(2026, 0, 1 + i), new Date(2026, 0, 1 + i));
    }
    fs.writeFileSync(path.join(dir, "khac.txt"), "giữ");
    pruneLogs(dir, 2);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["khac.txt", "v3_x.render.log", "v4_x.render.log"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("server.mjs dùng hàng đợi 1 render + render-job (không còn spawn render trực tiếp)", () => {
  const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "server.mjs"), "utf8");
  assert.match(src, /createJobQueue\(\{ concurrency: 1 \}\)/);
  assert.match(src, /renderQueue\.enqueue/);
  assert.match(src, /renderFailureMessage/);
  assert.doesNotMatch(src, /npmCommand\("npm", \["run", "render"\]\);\s*const child = spawn/);
});
