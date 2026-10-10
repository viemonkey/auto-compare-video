// Tạo clip AI 4 giây cho cảnh mở đầu từ ảnh "cầm sản phẩm" (hold-close), prompt chỉ cho cử động nhẹ. Mọi lỗi / vượt trần / chưa billing -> lùi về GSAP (không phải lỗi job).
import path from "node:path";
import { loadProductConfig, clipSettings, repoPath } from "./config.mjs";
import { createBudget } from "./budget.mjs";
import { getClipAdapter } from "./clip-adapters.mjs";
import { BillingRequiredError, ModelUnavailableError } from "./billing.mjs";
import { renderSection } from "./prompts.mjs";
import { toJpegBase64 } from "./images.mjs";
import { usdToVndRounded } from "./budget.mjs";

export const CLIP_FILE = "clip-hook.mp4";

/**
 * @returns {Promise<object>} project đã cập nhật: project.clip = { status:"ok"|"fallback"|"off", file?, seconds?, costVnd?, note }
 */
export async function ensureOpeningClip({ projectId, store, billing, config = loadProductConfig(), env = process.env, signal, log = () => {} }) {
  const settings = clipSettings(env, config);
  const write = (clip) => store.withLock(projectId, async () => { const p = store.read(projectId); p.clip = clip; p.updatedAt = new Date().toISOString(); store.write(p); return p; });
  const project = store.read(projectId);
  if (!project.settings?.aiClip) return write({ status: "off", note: "" });
  if (project.clip?.status === "ok" && project.clip.file) return project;
  const fallback = (note) => { log(`ℹ Clip AI: ${note} → dùng hiệu ứng GSAP.`); return write({ status: "fallback", note }); };

  const hook = project.scenes.find((s) => s.kind === "photo" && s.slot === "hold-close" && s.image);
  if (!hook) return fallback("cảnh mở đầu không có ảnh “cầm sản phẩm” (đã dùng pose/ảnh gốc).");
  if (!billing.isEnabled()) return fallback(billing.status().reason);
  const adapter = getClipAdapter(config.clip.adapter);
  if (!adapter) return fallback(`chưa có adapter clip "${config.clip.adapter}".`);

  const est = adapter.estimateUsd({ ...settings, model: settings.id });
  const budget = createBudget({ slugs: () => [project.ledgerSlug, project.slug], env, config });
  const verdict = budget.check(est);
  if (!verdict.ok) return fallback(verdict.message);

  try {
    const promptFile = path.isAbsolute(config.clip.promptFile) ? config.clip.promptFile : repoPath(config.clip.promptFile);
    const prompt = renderSection(promptFile, "clip", { productKind: project.analysis?.kind || "jewelry" });
    const image = await toJpegBase64(store.fileAbs(projectId, hook.image), { maxPx: 1280 });
    log(`▶ Clip AI: đang tạo clip ${settings.seconds}s (${settings.id}) — có thể mất vài phút…`);
    const out = await adapter.generate({ image: { mimeType: image.mimeType, data: image.data }, prompt, ...settings, model: settings.id, slug: project.ledgerSlug, subtask: "hook-clip", locale: project.locale, signal });
    store.saveBuffer(projectId, CLIP_FILE, out.buffer);
    log("✔ Clip AI đã tạo xong.");
    return write({ status: "ok", file: CLIP_FILE, seconds: settings.seconds, model: settings.id, costVnd: usdToVndRounded(out.costUsd, env), note: "" });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof BillingRequiredError) billing.block(e.userMessage);
    const note = (e instanceof BillingRequiredError || e instanceof ModelUnavailableError ? e.userMessage : e.userMessage || e.message) || "lỗi không rõ";
    return fallback(note);
  }
}
