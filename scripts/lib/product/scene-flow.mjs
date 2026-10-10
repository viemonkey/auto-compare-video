// Luồng ảnh cảnh có HuyK. Ba nguồn:
//   "gemini": tự tạo ảnh -> kiểm 4 tiêu chí -> mặt lệch: sửa mặt trên chính ảnh -> sản phẩm sai: sửa sản phẩm, vẫn sai thì tạo lại -> hết lượt/ngân sách thì giữ ảnh điểm cao nhất, đánh dấu đỏ.
//   "manual": người dùng tải ảnh (tự tạo ở Google AI Studio) -> vẫn kiểm 4 tiêu chí, kết quả chỉ để cảnh báo.
//   "pose"  : ảnh tư thế có sẵn — không gọi API ảnh.
// Trước MỖI lời gọi có phí: tra cache -> kiểm billing -> ước tính + cộng chi phí đã dùng với trần (giữ chỗ cho clip AI). Lỗi billing/quota/model: báo tiếng Việt
// và tự lùi về "pose", KHÔNG làm hỏng job.
import fs from "node:fs";
import path from "node:path";
import { calcImageCost } from "../../../config/pricing.mjs";
import { appendCostEntry } from "../cost-ledger.mjs";
import { loadProductConfig, imageSettings, repoPath } from "./config.mjs";
import { createBudget, textCallUsd, clipCallUsd, usdToVndRounded, fmtVnd } from "./budget.mjs";
import { textModels } from "./estimate.mjs";
import { BillingRequiredError, ModelUnavailableError } from "./billing.mjs";
import { generateImage as realGenerateImage } from "./image-gen.mjs";
import { generateImagesBatch as realBatch } from "./image-batch.mjs";
import { checkSceneImage as realCheck, rankScores } from "./scene-check.mjs";
import { buildScenePrompt, buildEditPrompt, referenceLayout } from "./scene-prompts.mjs";
import { imageCacheKey, hashRefs, createSceneCache } from "./scene-cache.mjs";
import { listHostRefFiles } from "./host-refs.mjs";
import { toJpegBase64 } from "./images.mjs";
import { SCENE_KINDS, pickPose, hostSideFor, slotLabelOf } from "./scenes.mjs";

/** Tín hiệu "không gọi/không gọi tiếp được" — nơi gọi chuyển sang phương án rẻ hơn (không phải lỗi). */
export class ImageDowngrade extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason; // "billing" | "budget" | "model"
  }
}

/** Người dùng gửi yêu cầu sai (HTTP 400), khác lỗi hệ thống. */
export class SceneInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export const AI_SOURCES = ["gemini", "manual"];

export function createSceneService({ store, billing, config = loadProductConfig(), cache = null, deps = {}, env = process.env, hostRefsRoot = repoPath(), ledger = appendCostEntry, log = console }) {
  const generateImage = deps.generateImage || realGenerateImage;
  const checkScene = deps.checkSceneImage || realCheck;
  const generateBatch = deps.generateImagesBatch || realBatch;
  const sceneCache = cache || createSceneCache(path.resolve(repoPath(), config.scenes.cacheDir));
  const settings = () => imageSettings(env, config);

  const budgetOf = (p) => createBudget({ slugs: () => [p.ledgerSlug, p.slug], env, config });
  const clipReserveVnd = (p) => (p.settings?.aiClip && !p.clip?.file ? usdToVndRounded(clipCallUsd(env, config) ?? 0, env) : 0);
  const logZero = (p, sceneId, subtask) => ledger({ slug: p.ledgerSlug, locale: p.locale, task: "product-scene", subtask: `${subtask}:${sceneId}`, engine: "local", status: "success", costUsd: 0 });

  /** Đọc-sửa-ghi ngắn, tuần tự theo dự án (thao tác dài KHÔNG giữ khoá). */
  const update = (id, fn) => store.withLock(id, async () => {
    const p = store.read(id);
    if (!p) throw new Error("Dự án không còn tồn tại.");
    const out = await fn(p);
    store.write(p);
    return out ?? p;
  });
  const sceneOf = (p, sceneId) => {
    const s = p.scenes.find((x) => x.id === sceneId);
    if (!s) throw new SceneInputError(`Không có cảnh "${sceneId}".`);
    return s;
  };

  async function loadRefs(project, { needProducts = true, needFaces = true } = {}) {
    const { maxPx, maxProductRefs, maxFaceRefs } = config.scenes.reference;
    const products = [];
    if (needProducts) for (const img of project.images.slice(0, maxProductRefs)) products.push(await toJpegBase64(store.fileAbs(project.id, img.file), { maxPx }));
    const files = listHostRefFiles(config, hostRefsRoot);
    const faces = [];
    if (needFaces) for (const f of files.faces.slice(0, maxFaceRefs)) faces.push(await toJpegBase64(f, { maxPx }));
    const outfit = files.outfit && needFaces ? await toJpegBase64(files.outfit, { maxPx }) : null;
    return { products, faces, outfit };
  }

  const kindOf = (p) => p.analysis?.kind || "ring";
  const lockOf = (p) => p.analysis?.lockText || "";

  /** Gọi sinh/sửa ảnh CÓ PHÍ với đủ cổng: cache -> billing -> ngân sách. Ném ImageDowngrade khi không được gọi. */
  async function paidImage({ project, scene, action, prompt, references, subtask, signal }) {
    const s = settings();
    const variant = (project.scenes.find((x) => x.id === scene.id)?.attempts || []).filter((a) => a.action === action).length;
    const key = imageCacheKey({ model: s.id, size: s.size, aspectRatio: s.aspectRatio, action, prompt, refHashes: hashRefs(references), variant });
    const hit = sceneCache.getImage(key);
    if (hit) {
      ledger({ slug: project.ledgerSlug, locale: project.locale, task: "product-scene", subtask: `cache:${scene.id}:${action}`, engine: "cache", status: "success", costUsd: 0 });
      return { buffer: hit.buffer, ext: hit.ext || ".png", mimeType: hit.mimeType, costUsd: 0, cached: true, model: hit.model || s.id };
    }
    if (!billing.isEnabled()) throw new ImageDowngrade("billing", billing.status().reason);
    const est = calcImageCost(s.id, 1, { size: s.size, batch: s.batch });
    const verdict = budgetOf(project).check(est, { reserveVnd: action === "clip" ? 0 : clipReserveVnd(project) });
    if (!verdict.ok) throw new ImageDowngrade("budget", verdict.message);
    try {
      const img = await generateImage({ prompt, references, slug: project.ledgerSlug, subtask, locale: project.locale, signal, config, env });
      sceneCache.putImage(key, { buffer: img.buffer, mimeType: img.mimeType, ext: img.ext, model: img.model });
      return { ...img, cached: false };
    } catch (e) {
      if (e instanceof BillingRequiredError) {
        billing.block(e.userMessage);
        throw new ImageDowngrade("billing", e.userMessage);
      }
      if (e instanceof ModelUnavailableError) throw new ImageDowngrade("model", e.userMessage);
      throw e;
    }
  }

  /** Kiểm ảnh; không kiểm được (lỗi/ vượt trần) -> null kèm ghi chú, không chặn. Kiểm ảnh dùng model chữ rẻ nên chỉ tính vào ngân sách, không chặn nặng. */
  async function runCheck({ project, scene, imageBuffer, refs, signal }) {
    const budget = budgetOf(project);
    const est = textCallUsd(textModels(env, config).check, "check", config);
    const verdict = budget.check(est, { reserveVnd: 0 });
    if (!verdict.ok) return { check: null, note: `Chưa kiểm được ảnh vì ${verdict.message}` };
    try {
      const check = await checkScene({ image: { mimeType: "image/jpeg", data: (await toJpegBufferB64(imageBuffer, config)).data }, slot: scene.slot, lockText: lockOf(project), refs, ledgerSlug: project.ledgerSlug, locale: project.locale, cache: sceneCache, config, env, signal });
      return { check, note: "" };
    } catch (e) {
      if (signal?.aborted) throw e;
      return { check: null, note: `Chưa kiểm được ảnh: ${e.userMessage || e.message}` };
    }
  }

  /** Ghi 1 phiên bản ảnh của cảnh vào thư mục dự án; trả tên file. */
  function saveVersion(project, scene, img, tag) {
    const n = (scene.attempts?.length || 0) + 1;
    const name = `scene-${scene.id}-v${n}${tag ? `-${tag}` : ""}${img.ext || ".png"}`;
    store.saveBuffer(project.id, name, img.buffer);
    return name;
  }

  const passScore = () => config.scenes.check.passScore;
  const summarize = (check) => (check ? { scores: check.scores, reasons: check.reasons, issues: check.issues, pass: check.pass, failed: check.failed, model: check.model } : null);

  /** Lùi cảnh về ảnh tư thế (không gọi API ảnh), kèm lý do tiếng Việt. */
  function fallbackToPose(project, scene, message) {
    const taken = project.scenes.filter((s) => s.kind === "pose" && s.id !== scene.id).map((s) => s.pose);
    const pose = scene.pose || pickPose(scene.beat, taken, config);
    Object.assign(scene, { kind: "pose", source: "pose", slot: null, pose, hostSide: hostSideFor(pose, project.scenes.indexOf(scene), config), image: null, status: "ok", approved: true, check: null, busy: null, note: message });
    logZero(project, scene.id, "pose");
  }

  /**
   * Quy trình tự động cho 1 cảnh photo: tạo -> kiểm -> sửa mặt / sửa sản phẩm / tạo lại (số lần theo config, luôn trong trần).
   * Không ném lỗi billing/ngân sách: lùi về pose hoặc giữ ảnh tốt nhất. Chỉ ném lỗi bất ngờ (lỗi lập trình, huỷ).
   */
  async function generateScene({ projectId, sceneId, signal }) {
    const caps = config.scenes.maxAttempts;
    const counters = { generate: 0, fixFace: 0, fixProduct: 0, calls: 0 };
    const project0 = store.read(projectId);
    const refs = await loadRefs(project0);
    const scene0 = sceneOf(project0, sceneId);
    const kind = kindOf(project0);
    const layoutGen = referenceLayout({ products: refs.products.length, faces: refs.faces.length, outfit: !!refs.outfit });
    let current = null; // { buffer, ext, file, check }
    let best = null;
    let stop = null; // ImageDowngrade
    const progress = (text) => update(projectId, (p) => { sceneOf(p, sceneId).busy = { action: "generate", text, at: new Date().toISOString() }; });

    const record = (p, action, file, check, cost, extra = {}) => {
      const s = sceneOf(p, sceneId);
      s.attempts.push({ n: s.attempts.length + 1, action, file, cost, check: summarize(check), at: new Date().toISOString(), ...extra });
    };

    const evaluate = async (img, action, costUsd, cached) => {
      let file;
      await update(projectId, (p) => { const s = sceneOf(p, sceneId); file = saveVersion(p, s, img, action === "generate" ? "" : action); });
      await progress("Gemini Flash đang kiểm ảnh…");
      const { check, note } = await runCheck({ project: store.read(projectId), scene: scene0, imageBuffer: img.buffer, refs, signal });
      await update(projectId, (p) => record(p, action, file, check, costUsd, { cached: !!cached, note }));
      const entry = { buffer: img.buffer, ext: img.ext, file, check, rank: rankScores(check, passScore()) };
      if (!best || entry.rank > best.rank) best = entry;
      return entry;
    };

    try {
      // 1) tạo ảnh đầu tiên
      for (;;) {
        if (current === null) {
          if (counters.generate >= caps.generate || counters.calls >= caps.totalImageCalls) break;
          await progress(counters.generate === 0 ? "Đang tạo ảnh…" : "Đang tạo lại ảnh…");
          const prompt = buildScenePrompt({ slot: scene0.slot, kind, lockText: lockOf(project0), layout: layoutGen, config });
          const img = await paidImage({ project: store.read(projectId), scene: scene0, action: "generate", prompt, references: [...refs.products, ...refs.faces, ...(refs.outfit ? [refs.outfit] : [])], subtask: `${scene0.id}:generate`, signal });
          counters.generate++;
          if (!img.cached) counters.calls++;
          current = await evaluate(img, "generate", img.costUsd, img.cached);
        }
        const check = current.check;
        if (check?.pass) break;
        if (!check) break; // không kiểm được -> dừng ở ảnh này (người dùng duyệt)
        const failed = check.failed;
        const faceOnly = failed.length > 0 && failed.every((k) => k === "face");
        if (failed.includes("face") && counters.fixFace < caps.fixFace && counters.calls < caps.totalImageCalls && (faceOnly || !failed.includes("product"))) {
          counters.fixFace++;
          await progress("Đang sửa khuôn mặt trên chính ảnh…");
          const layout = referenceLayout({ products: 0, faces: refs.faces.length, outfit: false, lead: 1 });
          const prompt = buildEditPrompt({ action: "fix-face", kind, slot: scene0.slot, lockText: lockOf(project0), layout, config });
          const img = await paidImage({ project: store.read(projectId), scene: scene0, action: "fix-face", prompt, references: [{ mimeType: "image/jpeg", data: current.buffer.toString("base64") }, ...refs.faces], subtask: `${scene0.id}:fix-face`, signal });
          if (!img.cached) counters.calls++;
          current = await evaluate(img, "fix-face", img.costUsd, img.cached);
          continue;
        }
        if (failed.includes("product") && counters.fixProduct < caps.fixProduct && counters.calls < caps.totalImageCalls) {
          counters.fixProduct++;
          await progress("Đang sửa sản phẩm cho giống ảnh gốc…");
          const layout = referenceLayout({ products: refs.products.length, faces: 0, outfit: false, lead: 1 });
          const prompt = buildEditPrompt({ action: "fix-product", kind, slot: scene0.slot, lockText: lockOf(project0), layout, config });
          const img = await paidImage({ project: store.read(projectId), scene: scene0, action: "fix-product", prompt, references: [{ mimeType: "image/jpeg", data: current.buffer.toString("base64") }, ...refs.products], subtask: `${scene0.id}:fix-product`, signal });
          if (!img.cached) counters.calls++;
          current = await evaluate(img, "fix-product", img.costUsd, img.cached);
          continue;
        }
        // còn lại (tay/trang phục lỗi, hoặc sửa xong vẫn sai) -> tạo lại nếu còn lượt
        if (counters.generate < caps.generate && counters.calls < caps.totalImageCalls) {
          current = null;
          continue;
        }
        break;
      }
    } catch (e) {
      if (e instanceof ImageDowngrade) stop = e;
      else {
        await update(projectId, (p) => { const s = sceneOf(p, sceneId); s.busy = null; s.status = best ? "needs-review" : "error"; s.note = `Lỗi khi tạo ảnh: ${e.userMessage || e.message}`; });
        throw e;
      }
    }

    // 2) chốt kết quả: ảnh tốt nhất, hoặc pose nếu chưa có ảnh nào
    await update(projectId, (p) => {
      const s = sceneOf(p, sceneId);
      s.busy = null;
      if (!best) {
        fallbackToPose(p, s, stop ? `${stop.message}${stop.reason === "budget" ? " Đã dùng ảnh tư thế có sẵn." : " Đã chuyển sang ảnh tư thế có sẵn."}` : "Chưa tạo được ảnh — dùng ảnh tư thế có sẵn.");
        return;
      }
      s.image = best.file;
      s.source = "gemini";
      s.check = summarize(best.check);
      const pass = !!best.check?.pass;
      s.status = pass ? "ok" : "needs-review";
      s.approved = pass;
      s.note = pass ? "" : stop ? `${stop.message} Giữ ảnh điểm cao nhất — hãy xem và duyệt hoặc đổi ảnh.` : best.check ? "Chưa đạt đủ 4 tiêu chí sau số lần thử cho phép — giữ ảnh điểm cao nhất, cần bạn duyệt." : "Chưa kiểm được ảnh — hãy xem rồi duyệt.";
    });
    return store.read(projectId);
  }

  /**
   * Batch API (tuỳ chọn, mặc định tắt): gửi lượt tạo ảnh ĐẦU của mọi cảnh chưa có ảnh trong 1 batch (~50% giá, chậm) và ghi kết quả vào cache theo khoá chuẩn;
   * sau đó generateScene chạy bình thường (trúng cache ở lượt đầu rồi kiểm/sửa bằng lời gọi thường). Mọi lỗi -> trả về, luồng thường tự tạo ảnh.
   */
  async function prefillWithBatch({ projectId, ids, signal }) {
    const s = settings();
    const project = store.read(projectId);
    if (!billing.isEnabled() || ids.length < 1) return { used: false };
    const refs = await loadRefs(project);
    const references = [...refs.products, ...refs.faces, ...(refs.outfit ? [refs.outfit] : [])];
    const layout = referenceLayout({ products: refs.products.length, faces: refs.faces.length, outfit: !!refs.outfit });
    const requests = [];
    for (const id of ids) {
      const scene = sceneOf(project, id);
      const prompt = buildScenePrompt({ slot: scene.slot, kind: kindOf(project), lockText: lockOf(project), layout, config });
      const key = imageCacheKey({ model: s.id, size: s.size, aspectRatio: s.aspectRatio, action: "generate", prompt, refHashes: hashRefs(references), variant: 0 });
      if (!sceneCache.getImage(key)) requests.push({ key, prompt, references, sceneId: id });
    }
    if (!requests.length) return { used: false };
    const est = calcImageCost(s.id, requests.length, { size: s.size, batch: true });
    const verdict = budgetOf(project).check(est, { reserveVnd: clipReserveVnd(project) });
    if (!verdict.ok) return { used: false, reason: verdict.message };
    try {
      const results = await generateBatch({ requests, model: s.id, size: s.size, aspectRatio: s.aspectRatio, slug: project.ledgerSlug, locale: project.locale, subtask: "batch", pollIntervalMs: config.batch.pollIntervalMs, timeoutMs: config.batch.timeoutMs, signal });
      let saved = 0;
      for (const r of requests) {
        const got = results.get(r.key);
        if (got && !got.error) { sceneCache.putImage(r.key, { buffer: got.buffer, mimeType: got.mimeType, ext: got.ext, model: s.id }); saved++; }
      }
      return { used: true, saved };
    } catch (e) {
      if (e instanceof BillingRequiredError) billing.block(e.userMessage);
      return { used: false, reason: e.userMessage || e.message };
    }
  }

  /** Tạo ảnh cho mọi cảnh photo của dự án (tuần tự). Billing đã bị từ chối ở cảnh trước thì cảnh sau lùi thẳng về pose, không gọi thêm. */
  async function generateAllScenes({ projectId, signal }) {
    const p0 = store.read(projectId);
    const ids = p0.scenes.filter((s) => s.kind === "photo" && s.source === "gemini" && !s.image).map((s) => s.id);
    if (settings().batch && ids.length) {
      for (const id of ids) await update(projectId, (p) => { sceneOf(p, id).busy = { action: "generate", text: "Đang chờ Batch API (chậm, rẻ ~50%)…", at: new Date().toISOString() }; });
      const r = await prefillWithBatch({ projectId, ids, signal });
      if (!r.used && r.reason) log.warn?.(`[product] batch không dùng được: ${r.reason}`);
    }
    for (const id of ids) {
      await update(projectId, (p) => { sceneOf(p, id).busy = { action: "generate", text: "Đang chuẩn bị…", at: new Date().toISOString() }; });
      try {
        await generateScene({ projectId, sceneId: id, signal });
      } catch (e) {
        if (signal?.aborted) throw e;
        log.warn?.(`[product] cảnh ${id} lỗi: ${e.message}`);
      }
    }
    return store.read(projectId);
  }

  /** Hành động có phí do người dùng bấm trên 1 cảnh photo. userRequest: yêu cầu sửa tự do (action "edit"). */
  async function runAction({ projectId, sceneId, action, userRequest = "", signal }) {
    if (!["regenerate", "fix-face", "fix-product", "edit"].includes(action)) throw new SceneInputError(`Hành động "${action}" không hợp lệ.`);
    const project = store.read(projectId);
    const scene = sceneOf(project, sceneId);
    if (scene.kind !== "photo" || !scene.slot) throw new SceneInputError("Chỉ cảnh có ảnh AI/tự tải mới tạo lại hoặc sửa được.");
    if (scene.busy) throw new SceneInputError("Cảnh này đang được xử lý.");
    if (action !== "regenerate" && !scene.image) throw new SceneInputError("Cảnh chưa có ảnh để sửa — hãy tạo ảnh trước.");
    await update(projectId, (p) => { sceneOf(p, sceneId).busy = { action, text: "Đang xử lý…", at: new Date().toISOString() }; });
    const kind = kindOf(project);
    try {
      const refs = await loadRefs(project); // dùng cho cả tạo/sửa lẫn kiểm
      const edit = (kindOfEdit, layout, extra = {}) => buildEditPrompt({ action: kindOfEdit, kind, slot: scene.slot, lockText: lockOf(project), layout, config, ...extra });
      let prompt;
      let references;
      if (action === "regenerate") {
        prompt = buildScenePrompt({ slot: scene.slot, kind, lockText: lockOf(project), layout: referenceLayout({ products: refs.products.length, faces: refs.faces.length, outfit: !!refs.outfit }), config });
        references = [...refs.products, ...refs.faces, ...(refs.outfit ? [refs.outfit] : [])];
      } else {
        // sửa trên CHÍNH ảnh hiện tại: ảnh đang sửa luôn là ảnh tham chiếu số 1
        const currentB64 = { mimeType: "image/jpeg", data: (await toJpegBase64(store.fileAbs(projectId, scene.image), { maxPx: config.scenes.reference.maxPx })).data };
        if (action === "fix-face") {
          prompt = edit("fix-face", referenceLayout({ products: 0, faces: refs.faces.length, outfit: false, lead: 1 }));
          references = [currentB64, ...refs.faces];
        } else if (action === "fix-product") {
          prompt = edit("fix-product", referenceLayout({ products: refs.products.length, faces: 0, outfit: false, lead: 1 }));
          references = [currentB64, ...refs.products];
        } else {
          if (!String(userRequest || "").trim()) throw new SceneInputError("Hãy nhập yêu cầu sửa.");
          prompt = edit("edit", referenceLayout({ products: 0, faces: 0, outfit: false, lead: 1 }), { userRequest });
          references = [currentB64];
        }
      }
      const checkRefs = refs;
      const img = await paidImage({ project: store.read(projectId), scene, action, prompt, references, subtask: `${scene.id}:${action}`, signal });
      let file;
      await update(projectId, (p) => { file = saveVersion(p, sceneOf(p, sceneId), img, action); });
      const { check, note } = await runCheck({ project: store.read(projectId), scene, imageBuffer: img.buffer, refs: checkRefs, signal });
      await update(projectId, (p) => {
        const s = sceneOf(p, sceneId);
        s.attempts.push({ n: s.attempts.length + 1, action, file, cost: img.costUsd, check: summarize(check), at: new Date().toISOString(), cached: !!img.cached, note, userRequest: userRequest || undefined });
        s.image = file;
        s.source = "gemini";
        s.check = summarize(check);
        s.busy = null;
        s.status = check?.pass ? "ok" : "needs-review";
        s.approved = !!check?.pass;
        s.note = check?.pass ? "" : check ? "Chưa đạt đủ 4 tiêu chí — xem lý do bên dưới rồi duyệt hoặc sửa tiếp." : note || "Chưa kiểm được ảnh — hãy xem rồi duyệt.";
      });
    } catch (e) {
      if (e instanceof ImageDowngrade) {
        await update(projectId, (p) => {
          const s = sceneOf(p, sceneId);
          s.busy = null;
          // giữ ảnh hiện có (nếu có) và nói rõ vì sao không gọi; không có ảnh thì lùi về pose
          if (s.image) { s.note = e.message; if (s.status === "ok" && e.reason === "budget") s.note = `${e.message} Giữ ảnh hiện tại.`; } else fallbackToPose(p, s, `${e.message} Đã chuyển sang ảnh tư thế có sẵn.`);
        });
      } else {
        await update(projectId, (p) => { const s = sceneOf(p, sceneId); s.busy = null; s.note = `Lỗi: ${e.userMessage || e.message}`; });
        throw e;
      }
    }
    return store.read(projectId);
  }

  /** Nguồn "manual": ảnh người dùng tải lên cho 1 cảnh photo -> kiểm 4 tiêu chí (miễn phí, chỉ cảnh báo). */
  async function adoptUpload({ projectId, sceneId, buffer, ext, signal }) {
    const project = store.read(projectId);
    const scene = sceneOf(project, sceneId);
    if (!scene.slot && scene.kind !== "photo") {
      // cảnh pose/hero/... đổi sang ảnh tự tải: gán khe theo beat
      const slot = scene.beat === "wear" ? "wear-hand" : "hold-close";
      await update(projectId, (p) => { Object.assign(sceneOf(p, sceneId), { kind: "photo", slot, source: "manual", pose: null, from: null }); });
    }
    await update(projectId, (p) => { sceneOf(p, sceneId).busy = { action: "upload", text: "Gemini Flash đang kiểm ảnh…", at: new Date().toISOString() }; });
    const refs = await loadRefs(project);
    let file;
    await update(projectId, (p) => { file = saveVersion(p, sceneOf(p, sceneId), { buffer, ext }, "manual"); });
    const fresh = store.read(projectId);
    const { check, note } = await runCheck({ project: fresh, scene: sceneOf(fresh, sceneId), imageBuffer: buffer, refs, signal });
    await update(projectId, (p) => {
      const s = sceneOf(p, sceneId);
      s.attempts.push({ n: s.attempts.length + 1, action: "upload", file, cost: 0, check: summarize(check), at: new Date().toISOString(), note });
      s.image = file;
      s.source = "manual";
      s.check = summarize(check);
      s.busy = null;
      s.status = check?.pass ? "ok" : "needs-review";
      s.approved = !!check?.pass;
      s.note = check?.pass ? "" : check ? "Kết quả kiểm chỉ để cảnh báo — bạn vẫn duyệt được nếu thấy ảnh ổn." : note || "Chưa kiểm được ảnh — hãy xem rồi duyệt.";
      logZero(p, s.id, "manual-upload");
    });
    return store.read(projectId);
  }

  const useOriginal = (projectId, sceneId) => update(projectId, (p) => {
    const s = sceneOf(p, sceneId);
    Object.assign(s, { kind: "hero", source: "product", slot: null, pose: null, from: null, image: null, check: null, status: "ok", approved: true, busy: null, note: "Dùng ảnh sản phẩm gốc." });
    logZero(p, s.id, "product");
  });

  const changePose = (projectId, sceneId, pose) => update(projectId, (p) => {
    const s = sceneOf(p, sceneId);
    const known = Object.values(config.poses.byBeat).flat().concat(config.poses.defaultPose);
    if (!known.includes(pose)) throw new SceneInputError(`Pose "${pose}" không có trong cấu hình.`);
    Object.assign(s, { kind: "pose", source: "pose", slot: null, pose, from: null, image: null, check: null, status: "ok", approved: true, busy: null, hostSide: hostSideFor(pose, p.scenes.indexOf(s), config), note: "" });
    logZero(p, s.id, "pose");
  });

  const approve = (projectId, sceneId) => update(projectId, (p) => {
    const s = sceneOf(p, sceneId);
    if (!s.image && s.kind === "photo") throw new SceneInputError("Cảnh chưa có ảnh để duyệt.");
    s.approved = true;
    s.status = "ok";
    s.note = s.note ? `${s.note} (đã duyệt tay)` : "";
  });

  return { generateScene, generateAllScenes, prefillWithBatch, runAction, adoptUpload, useOriginal, changePose, approve, update, sceneOf, loadRefs, fmtVnd, slotLabelOf, SCENE_KINDS };
}

async function toJpegBufferB64(buffer, config) {
  // ảnh tạo ra có thể rất lớn: thu về cạnh dài <= reference.maxPx trước khi gửi kiểm
  const { default: os } = await import("node:os");
  const tmp = path.join(os.tmpdir(), `pd-chk-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.bin`);
  fs.writeFileSync(tmp, buffer);
  try {
    return await toJpegBase64(tmp, { maxPx: config.scenes.reference.maxPx });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
