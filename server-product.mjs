// API chế độ "Giới thiệu sản phẩm": /api/product/*. Tách khỏi server.mjs (giống server-market.mjs) để chế độ "So sánh 2 ảnh" không bị đụng tới.
// Dự án nằm ở data/products/<id>/ (project.json + ảnh). Bước 1: upload ảnh + form -> (Mốc 2) phân tích + kịch bản -> Bước 2 duyệt ảnh cảnh -> Bước 3 dựng.
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { loadProductConfig, maxCostVnd, imageSettings, clipSettings, kindFromText } from "./scripts/lib/product/config.mjs";
import { billing } from "./scripts/lib/product/billing.mjs";
import { estimateProductCost } from "./scripts/lib/product/estimate.mjs";
import { createProductStore } from "./scripts/lib/product/store.mjs";
import { inspectHostRefs } from "./scripts/lib/product/host-refs.mjs";
import { probeImage, findContentBox } from "./scripts/lib/product/images.mjs";
import { normalizeForm, validateForm, productKindOfForm, productDisplayName } from "./scripts/lib/product/form.mjs";
import { analyzeProduct } from "./scripts/lib/product/analyze.mjs";
import { writeScript, assembleScript, validateScriptRules, readingEstimate } from "./scripts/lib/product/script.mjs";
import { createBudget } from "./scripts/lib/product/budget.mjs";
import { getLocale, getDefaultLocale } from "./scripts/lib/locales.mjs";
import { checkRenderability } from "./scripts/lib/capabilities.mjs";
import { AbortedError } from "./scripts/lib/gemini-client.mjs";

export const IMAGE_SOURCES = ["pose", "manual", "gemini"];

/** Cảnh báo chất lượng 1 ảnh sản phẩm (tiếng Việt): nhỏ, sản phẩm chiếm ít khung. Không chặn. */
export async function productImageWarnings(file, config = loadProductConfig()) {
  const warnings = [];
  const { width, height } = await probeImage(file);
  const short = Math.min(width, height);
  if (short < config.upload.hardMinPx) warnings.push(`Ảnh quá nhỏ (${width}×${height}px) — cảnh sản phẩm sẽ rất mờ. Hãy dùng ảnh gốc lớn hơn.`);
  else if (short < config.upload.recommendedMinPx) warnings.push(`Ảnh nhỏ (${width}×${height}px, nên ≥ ${config.upload.recommendedMinPx}px) — khi phóng lên khung dọc 1080×1920 sản phẩm sẽ hơi mờ.`);
  try {
    const box = await findContentBox(file);
    if (box) {
      const share = Math.max(box.w, box.h);
      if (share < 0.4) warnings.push(`Sản phẩm chỉ chiếm khoảng ${Math.round(share * 100)}% khung ảnh — nên chụp/cắt sát hơn (nền trắng, sản phẩm chiếm gần hết khung) để cảnh cận rõ nét.`);
    } else {
      warnings.push("Không thấy sản phẩm rõ trên nền — nên dùng ảnh nền trắng đồng màu.");
    }
  } catch {
    // không đo được thì thôi, không phải lỗi người dùng
  }
  return warnings;
}

export function createProductApi({ app, dataDir, hostRefsRoot, store: injectedStore, log = console, deps = {} }) {
  const config = loadProductConfig();
  const analyze = deps.analyzeProduct || analyzeProduct;
  const scriptWriter = deps.writeScript || writeScript;
  const store = injectedStore || createProductStore({ dir: path.join(dataDir, "products") });
  const router = express.Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.upload.maxBytes, files: config.upload.maxImages },
    fileFilter: (_req, file, cb) => {
      const ok = config.upload.extensions.includes(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : new Error(`Chỉ nhận ảnh ${config.upload.extensions.join(", ")} — nhận được "${file.originalname}".`), ok);
    },
  }).array("images", config.upload.maxImages);

  const fileUrl = (id, name) => `/api/product/${id}/file/${encodeURIComponent(name)}`;
  const getProject = (req, res) => {
    let project = null;
    try {
      project = store.read(req.params.id);
    } catch {
      project = null;
    }
    if (!project) res.status(404).json({ error: "Không tìm thấy dự án sản phẩm này." });
    return project;
  };

  /** Dự án cho client: thêm URL ảnh, bỏ đường dẫn tuyệt đối. */
  const publicProject = (project) => ({
    ...project,
    images: (project.images || []).map((img) => ({ ...img, url: fileUrl(project.id, img.file) })),
  });

  router.get("/config", async (_req, res) => {
    const billingStatus = billing.status();
    const refs = await inspectHostRefs({ config, root: hostRefsRoot }).catch(() => ({ faces: [], ready: false, warnings: [], guide: "" }));
    const image = imageSettings();
    const clip = clipSettings();
    res.json({
      maxCostVnd: maxCostVnd(),
      billing: billingStatus,
      imageSources: [
        { id: "pose", label: "Ảnh tư thế có sẵn", enabled: true, note: "Miễn phí — HuyK đứng cạnh ảnh sản phẩm thật của bạn." },
        { id: "manual", label: "Tự tải ảnh", enabled: true, note: "Tự tạo ảnh trên Google AI Studio rồi tải lên; kiểm ảnh bằng Gemini Flash." },
        { id: "gemini", label: "Tự động (Gemini)", enabled: billingStatus.enabled, note: billingStatus.enabled ? "Tool tự tạo ảnh AI (có phí, tôn trọng trần ngân sách)." : billingStatus.reason },
      ],
      defaultImageSource: "pose",
      clip: { enabled: billingStatus.enabled, reason: billingStatus.enabled ? "" : billingStatus.reason, seconds: clip.seconds, model: clip.id },
      models: { image: image.id, imageSize: image.size, clip: clip.id },
      upload: { maxImages: config.upload.maxImages, maxMB: Math.round(config.upload.maxBytes / 1048576), recommendedMinPx: config.upload.recommendedMinPx },
      hostRefs: { faceCount: refs.faces.length, minCount: config.host.faceRefs.minCount, ready: refs.ready, warnings: refs.warnings, guide: refs.guide, outfitText: config.host.outfit.text, outfitImage: !!refs.outfit?.file },
      productKinds: Object.keys(config.productKinds),
      stoneOrigins: Object.entries(config.stoneOrigins).map(([id, o]) => ({ id, label: o.label })),
    });
  });

  router.get("/estimate", (req, res) => {
    const imageSource = IMAGE_SOURCES.includes(req.query.source) ? req.query.source : "pose";
    const aiClip = req.query.clip === "1" || req.query.clip === "true";
    res.json(estimateProductCost({ imageSource, aiClip }));
  });

  router.post("/upload", (req, res) => {
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: `Cần tải 1–${config.upload.maxImages} ảnh sản phẩm.` });
      const project = store.create({ images: [] });
      try {
        const images = [];
        for (const [i, f] of files.entries()) {
          const ext = path.extname(f.originalname).toLowerCase() === ".jpeg" ? ".jpg" : path.extname(f.originalname).toLowerCase();
          const name = `product-${i + 1}${ext}`;
          const abs = store.saveBuffer(project.id, name, f.buffer);
          const { width, height } = await probeImage(abs);
          images.push({ id: `product-${i + 1}`, file: name, width, height, warnings: await productImageWarnings(abs, config) });
        }
        project.images = images;
        store.write(project);
        res.json(publicProject(project));
      } catch (e) {
        store.remove(project.id);
        log.warn?.(`[product] upload lỗi: ${e.message}`);
        res.status(400).json({ error: `Không đọc được ảnh: ${e.message}` });
      }
    });
  });

  const localeOf = (code) => (String(code || "").trim() ? getLocale(String(code).trim()) : getDefaultLocale());
  const budgetOf = (project) => createBudget({ slugs: () => [project.ledgerSlug, project.slug] });
  const kindsWithTemplates = ["ring", "necklace", "earring"];
  const fail = (res, e, fallback = "Không xử lý được yêu cầu.") => {
    log.warn?.(`[product] ${e.message}`);
    res.status(e.status || (e.userMessage ? 502 : 500)).json({ error: e.userMessage || e.message || fallback });
  };

  /**
   * Bước 1 -> 2: phân tích ảnh (Gemini nhìn ảnh -> mô tả khoá + khung bao) rồi viết kịch bản (+3 câu mở đầu, đối chiếu form).
   * Chạy lại được: ghi đè phân tích + kịch bản cũ (ảnh cảnh đã duyệt — nếu có — bị xoá vì sản phẩm/kịch bản đổi).
   */
  router.post("/:id/analyze", async (req, res) => {
    const project = getProject(req, res);
    if (!project) return;
    const locale = localeOf(req.body?.locale);
    if (!locale) return res.status(400).json({ error: "Thị trường không tồn tại hoặc đang bị tắt." });
    const renderability = checkRenderability(locale);
    if (!renderability.renderable) return res.status(400).json({ error: `Thị trường ${locale.displayName} chưa dựng được video: ${renderability.blockers.map((b) => b.message).join(" ")}` });
    const form = normalizeForm(req.body?.form, config);
    const errors = validateForm(form);
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });
    const requested = req.body?.settings || {};
    const notes = [];
    let imageSource = IMAGE_SOURCES.includes(requested.imageSource) ? requested.imageSource : "pose";
    let aiClip = requested.aiClip === true;
    const kind = productKindOfForm(form, config);
    if (imageSource === "gemini" && !billing.isEnabled()) {
      imageSource = "pose";
      notes.push(`Nguồn "Tự động" cần billing — ${billing.status().reason} Đã dùng ảnh tư thế có sẵn.`);
    }
    if (imageSource !== "pose" && !kindsWithTemplates.includes(kind)) {
      imageSource = "pose";
      notes.push(`Chưa có mẫu cảnh AI cho loại món "${form.type}" (mới có nhẫn, dây chuyền, bông tai) — dùng ảnh tư thế có sẵn.`);
    }
    if (aiClip && (!billing.isEnabled() || imageSource === "pose")) {
      aiClip = false;
      notes.push("Clip AI cần billing và ảnh cảnh “cầm sản phẩm” — đã tắt clip AI (dùng hiệu ứng GSAP).");
    }
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      await store.withLock(project.id, async () => {
        const fresh = store.read(project.id);
        const imageFiles = fresh.images.map((img) => store.fileAbs(fresh.id, img.file));
        const analysis = await analyze({ imageFiles, ledgerSlug: fresh.ledgerSlug, locale: locale.code, signal: controller.signal });
        const script = await scriptWriter({ form, analysis, locale, ledgerSlug: fresh.ledgerSlug, signal: controller.signal });
        Object.assign(fresh, {
          locale: locale.code,
          form,
          settings: { imageSource, aiClip, tts: requested.tts || {}, notes },
          analysis,
          script: { openers: script.openers, openerIndex: 0, lines: script.lines, mismatches: script.mismatches, warnings: script.warnings, model: script.model, rulesIssues: [] },
          scenes: [],
          status: "scripted",
          aiGenerated: false,
        });
        fresh.displayName = productDisplayName(form);
        store.write(fresh);
      });
      res.json(publicProject(store.read(project.id)));
    } catch (e) {
      if (e instanceof AbortedError || controller.signal.aborted) return;
      fail(res, e, "Gemini xử lý thất bại, vui lòng thử lại.");
    }
  });

  /** Người dùng chọn câu mở đầu / sửa câu thoại ở Bước 2. Luật nội dung chỉ CẢNH BÁO (người dùng được quyết), không chặn. */
  router.put("/:id/script", async (req, res) => {
    const project = getProject(req, res);
    if (!project?.script) return project ? res.status(409).json({ error: "Dự án chưa có kịch bản." }) : undefined;
    const locale = localeOf(project.locale);
    const incoming = req.body || {};
    await store.withLock(project.id, async () => {
      const fresh = store.read(project.id);
      const script = fresh.script;
      if (Number.isInteger(incoming.openerIndex) && incoming.openerIndex >= 0 && incoming.openerIndex < script.openers.length) script.openerIndex = incoming.openerIndex;
      if (Array.isArray(incoming.openers)) script.openers = script.openers.map((o, i) => ({ text: String(incoming.openers[i]?.text ?? o.text).slice(0, 400), vi: String(incoming.openers[i]?.vi ?? o.vi).slice(0, 600) }));
      if (Array.isArray(incoming.lines)) {
        script.lines = script.lines.map((l, i) => (i === 0 ? l : { ...l, text: String(incoming.lines[i]?.text ?? l.text).slice(0, 400), vi: String(incoming.lines[i]?.vi ?? l.vi).slice(0, 600) }));
      }
      const opener = script.openers[script.openerIndex];
      script.lines[0] = { ...script.lines[0], text: opener.text, vi: opener.vi };
      script.rulesIssues = validateScriptRules({ lines: script.lines }, { form: fresh.form, locale, config });
      script.warnings = readingEstimate(script.lines, locale, config).warnings;
      if (typeof incoming.slug === "string") fresh.slugDraft = incoming.slug.trim().slice(0, 80);
      store.write(fresh);
    });
    res.json(publicProject(store.read(project.id)));
  });

  router.get("/:id/budget", (req, res) => {
    const project = getProject(req, res);
    if (!project) return;
    const b = budgetOf(project);
    res.json({ maxVnd: b.maxVnd(), spentVnd: b.spentVnd(), remainingVnd: b.remainingVnd(), byTask: b.spent().byTask });
  });

  router.get("/:id", (req, res) => {
    const project = getProject(req, res);
    if (project) res.json(publicProject(project));
  });

  router.get("/:id/file/:name", (req, res) => {
    const project = getProject(req, res);
    if (!project) return;
    let abs;
    try {
      abs = store.fileAbs(project.id, req.params.name);
    } catch {
      return res.status(400).json({ error: "Tên file không hợp lệ." });
    }
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "Không có file này." });
    res.sendFile(abs);
  });

  app.use("/api/product", router);
  return { store, publicProject, getProject, router, normalizeForm, validateForm, kindFromText, fileUrl };
}
