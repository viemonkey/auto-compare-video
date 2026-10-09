import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const BUILD_STAGES = Object.freeze([
  { id: "voice", label: "Sinh giọng" },
  { id: "timing", label: "Tính nhịp" },
  { id: "scene", label: "Dựng cảnh" },
  { id: "render", label: "Render MP4" },
  { id: "check", label: "Kiểm tra" },
]);

const nowIso = (now = Date.now) => new Date(now()).toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));

export function errorDetails(error) {
  const message = String(error?.userMessage || error?.message || error || "Lỗi không xác định.").trim();
  const code = error?.code || error?.cause?.code || null;
  const technical = [code ? `[${code}]` : "", String(error?.technical || error?.stack || error?.message || error || "")].filter(Boolean).join(" ").trim();
  return { message, code, technical };
}

export function createBuildJob({ id = crypto.randomUUID(), slug, request, now = Date.now }) {
  const at = nowIso(now);
  return {
    version: 1,
    id,
    slug,
    status: "pending",
    activeStage: null,
    createdAt: at,
    updatedAt: at,
    request: clone(request),
    stages: BUILD_STAGES.map((stage) => ({ ...stage, status: "pending", startedAt: null, finishedAt: null, error: null })),
    log: [],
    result: null,
  };
}

export class FileBuildJobStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(id) {
    if (!/^[a-f0-9-]{20,}$/i.test(String(id))) throw new Error("Mã job không hợp lệ.");
    return path.join(this.dir, `${id}.json`);
  }

  write(job) {
    const file = this.file(job.id);
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(job, null, 2)}\n`);
    fs.renameSync(temp, file);
    return job;
  }

  read(id) {
    const file = this.file(id);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  list() {
    return fs.readdirSync(this.dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => this.read(file.slice(0, -5)))
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
}

export function appendJobLog(job, message, now = Date.now) {
  const line = { at: nowIso(now), message: String(message) };
  job.log = [...(job.log || []), line].slice(-2000);
  job.updatedAt = line.at;
  return job;
}

export function resetJobForRetry(job, now = Date.now) {
  const failedIndex = job.stages.findIndex((stage) => stage.status === "error");
  const firstPending = job.stages.findIndex((stage) => stage.status !== "done");
  const from = failedIndex >= 0 ? failedIndex : firstPending;
  if (from < 0) return job;
  for (let i = from; i < job.stages.length; i++) {
    job.stages[i] = { ...job.stages[i], status: "pending", startedAt: null, finishedAt: null, error: null };
  }
  job.status = "pending";
  job.activeStage = null;
  job.result = null;
  job.updatedAt = nowIso(now);
  return job;
}

export function resetJobFromStart(job, now = Date.now) {
  for (let i = 0; i < job.stages.length; i++) {
    job.stages[i] = { ...job.stages[i], status: "pending", startedAt: null, finishedAt: null, error: null };
  }
  job.status = "pending";
  job.activeStage = null;
  job.result = null;
  job.updatedAt = nowIso(now);
  return job;
}

export async function runBuildJob(jobId, { store, handlers, now = Date.now, onUpdate = () => {} }) {
  let job = store.read(jobId);
  if (!job) throw new Error(`Không tìm thấy job ${jobId}.`);
  if (job.status === "running") return job;

  job.status = "running";
  job.updatedAt = nowIso(now);
  store.write(job);
  onUpdate(clone(job));

  for (const stage of job.stages) {
    if (stage.status === "done") continue;
    const handler = handlers[stage.id];
    if (typeof handler !== "function") throw new Error(`Thiếu handler cho khâu "${stage.id}".`);

    stage.status = "running";
    stage.startedAt = nowIso(now);
    stage.finishedAt = null;
    stage.error = null;
    job.activeStage = stage.id;
    job.updatedAt = stage.startedAt;
    store.write(job);
    onUpdate(clone(job));

    try {
      const result = await handler({ job: clone(job), stage: clone(stage), log: (message) => {
        appendJobLog(job, message, now);
        store.write(job);
        onUpdate(clone(job));
      } });
      if (result !== undefined) {
        stage.output = result;
        if (stage.id === "check") job.result = result;
      }
      stage.status = "done";
      stage.finishedAt = nowIso(now);
      job.updatedAt = stage.finishedAt;
      store.write(job);
      onUpdate(clone(job));
    } catch (error) {
      stage.status = "error";
      stage.finishedAt = nowIso(now);
      stage.error = errorDetails(error);
      job.status = "error";
      job.activeStage = stage.id;
      job.updatedAt = stage.finishedAt;
      appendJobLog(job, `✖ ${stage.error.message}`, now);
      store.write(job);
      onUpdate(clone(job));
      return job;
    }
  }

  job.status = "success";
  job.activeStage = null;
  job.updatedAt = nowIso(now);
  store.write(job);
  onUpdate(clone(job));
  return job;
}
