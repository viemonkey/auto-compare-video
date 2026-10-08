// Chạy `npm run render` của 1 video như 1 JOB: ghi ĐẦY ĐỦ stdout + stderr vào file log, trả mã thoát + vài dòng cuối (để báo lỗi
// tiếng Việt kèm ngữ cảnh), và chỉ cho MỘT render chạy tại một thời điểm (job sau xếp hàng chờ).
// Lý do: render dùng Chrome + FFmpeg rất nặng; từng có lần "Render không thành công (mã 1)" mà không còn dấu vết nào
// (log bị lọc mất, và render khác/snapshot đang chạy song song).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
// dòng tiến độ (mỗi frame 1 dòng) làm tail vô dụng — vẫn ghi vào log nhưng không đưa vào tail
const PROGRESS = /Streaming frame|[█░]{3,}|^\s*\d+%/;

/** Bỏ mã màu ANSI, tách dòng theo \n và \r (thanh tiến độ ghi đè dòng bằng \r). */
export function cleanLines(text) {
  return text.replace(ANSI, "").split(/\r?\n|\r/).map((l) => l.trim()).filter((l) => l.trim() !== "");
}

/** Hàng đợi tuần tự (concurrency 1 mặc định). Job lỗi không làm kẹt hàng. */
export function createJobQueue({ concurrency = 1 } = {}) {
  let running = 0;
  const waiting = [];
  const pump = () => {
    while (running < concurrency && waiting.length) {
      const job = waiting.shift();
      running++;
      job.start();
    }
  };
  return {
    get running() { return running; },
    get waiting() { return waiting.length; },
    /**
     * @param {() => Promise<T>} fn
     * @param {{onWait?: (ahead:number) => void, onStart?: () => void}} [o] onWait: gọi 1 lần nếu phải chờ (ahead = số job phía trước, gồm cả job đang chạy)
     * @template T
     */
    enqueue(fn, { onWait, onStart } = {}) {
      return new Promise((resolve, reject) => {
        const job = {
          start: () => {
            if (onStart) onStart();
            Promise.resolve()
              .then(fn)
              .then(resolve, reject)
              .finally(() => { running--; pump(); });
          },
        };
        const ahead = running + waiting.length;
        if (ahead >= concurrency && onWait) onWait(ahead - concurrency + 1);
        waiting.push(job);
        pump();
      });
    },
  };
}

/** Giữ tối đa `keep` file log mới nhất trong thư mục. */
export function pruneLogs(dir, keep = 50) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".render.log"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
  } catch {
    // dọn log không được làm hỏng render
  }
}

/**
 * Chạy lệnh render, ghi log đầy đủ.
 * @returns {Promise<{code:number|null, signal:string|null, logFile:string, tail:string[], error?:string}>}
 */
export function runRenderJob({ command, args, cwd, slug, logDir, tailLines = 15, onLine, spawnFn = spawn, now = () => new Date() }) {
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(logDir, `${slug}_${stamp}.render.log`);
  const out = fs.createWriteStream(logFile, { flags: "a" });
  out.write(`# render ${slug} — ${now().toISOString()}\n# cwd: ${cwd}\n# lệnh: ${command} ${args.join(" ")}\n\n`);
  const recent = [];
  const buffers = { stdout: "", stderr: "" };
  const feed = (stream, chunk) => {
    const text = chunk.toString();
    out.write(text.replace(ANSI, "").replace(/\r(?!\n)/g, "\n"));
    buffers[stream] += text;
    const parts = buffers[stream].split(/\r?\n|\r/);
    buffers[stream] = parts.pop() ?? "";
    for (const raw of parts) {
      const line = raw.replace(ANSI, "").trimEnd();
      if (!line.trim()) continue;
      if (onLine) onLine(line, stream);
      if (!PROGRESS.test(line)) {
        recent.push(stream === "stderr" ? `[stderr] ${line}` : line);
        if (recent.length > 200) recent.shift();
      }
    }
  };
  return new Promise((resolve) => {
    let child;
    let finished = false;
    const finish = (code, signal, error) => {
      if (finished) return; // 'error' rồi 'close' có thể cùng bắn
      finished = true;
      for (const s of ["stdout", "stderr"]) if (buffers[s].trim()) feed(s, "\n");
      out.write(`\n# kết thúc: mã=${code} tín hiệu=${signal ?? "-"}${error ? ` lỗi=${error}` : ""}\n`);
      out.end(() => resolve({ code, signal: signal ?? null, logFile, tail: recent.slice(-tailLines), ...(error ? { error } : {}) }));
    };
    try {
      child = spawnFn(command, args, { cwd });
    } catch (e) {
      finish(-1, null, e.message);
      return;
    }
    child.stdout?.on("data", (b) => feed("stdout", b));
    child.stderr?.on("data", (b) => feed("stderr", b));
    child.on("error", (e) => finish(-1, null, e.message));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/** Thông báo lỗi tiếng Việt: nguyên nhân + vài dòng cuối của log + nơi xem log đầy đủ + cách chạy lại. */
export function renderFailureMessage({ slug, code, signal, tail, logFile, error }) {
  const why = error
    ? `không chạy được lệnh render (${error})`
    : signal
      ? `bị dừng giữa chừng (tín hiệu ${signal})`
      : `thoát với mã ${code}`;
  const lines = [`Render thất bại: ${why}.`];
  if (tail?.length) {
    lines.push("Vài dòng cuối của log render:", ...tail.map((l) => `  │ ${l.slice(0, 220)}`));
  } else {
    lines.push("Log render không có dòng nào (tiến trình chết ngay khi khởi động?).");
  }
  lines.push(`Log đầy đủ: ${logFile}`, `Project đã dựng xong, render lại bằng: cd videos/${slug} && npm run render`);
  return lines.join("\n");
}
