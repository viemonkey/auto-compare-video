// Thị trường (locale) ở tầng server: lưu nháp, mở lại bản ghi để sửa, tạo phiên bản cho thị trường khác, và thông tin thị trường của
// từng video (danh sách video + thống kê chi phí). Tách khỏi server.mjs để file chính không phình thêm.
import fs from "node:fs";
import path from "node:path";
import { getLocale, getDefaultLocale } from "./scripts/lib/locales.mjs";
import { effectiveSlugSuffix, hasLocaleSuffix, stripLocaleSuffix, uniqueSlugForLocale, SLUG_RE } from "./scripts/lib/market-slug.mjs";
import { readRecord, writeRecord, listRecords, copySourceImages, resolveSource } from "./scripts/lib/content-store.mjs";
import { loadHashtagConfig, planHashtags, sanitizePlan, maxHashtags, withMeanings } from "./scripts/lib/hashtags.mjs";
import { collectContentWarnings } from "./scripts/lib/compare-content.mjs";
import { renameCostLedgerSlug } from "./scripts/lib/cost-ledger.mjs";
import { textOf, viOf } from "./public/shared/bilingual.mjs";
import { buildApprovedFacts, checkAgainstApprovedFacts } from "./scripts/lib/approved-facts.mjs";

/** Dựng bản ghi bền vững (xem scripts/lib/content-store.mjs). */
export function buildRecord({ content, locale, hashtagPlan, status, source = null, derivedFrom = null, savedAt = new Date().toISOString() }) {
  const { _meta: genMeta, hashtagPlan: _plan, locale: _loc, ...rest } = content;
  const generatedBy = generatedByOf(genMeta);
  return { ...rest, locale: locale.code, hashtagPlan, _meta: { status, savedAt, source, derivedFrom, ...(generatedBy ? { generatedBy } : {}) } };
}

/** Model đã sinh nội dung (từ _meta của generate-compare-content hoặc đã lưu) -> { model, primary, isFallback } | null. */
export function generatedByOf(meta) {
  if (meta?.generatedBy?.model) return meta.generatedBy;
  if (!meta?.model) return null;
  const primary = meta.primary_model || meta.model;
  return { model: meta.model, primary, isFallback: meta.used_fallback === true || meta.model !== primary };
}

/**
 * Caption đăng Facebook: title (câu hook Gemini, chuỗi phẳng hoặc { text, vi } -> luôn lấy CHỮ ĐÍCH) + plan hashtag của ĐÚNG thị trường của
 * video (bản ghi ghi rõ locale; bản ghi cũ thiếu locale = mặc định). `livePlan` (plan vừa chốt) ưu tiên hơn bản lưu.
 */
export function resolveSocialPost({ dir, slug, fallbackName, livePlan = null, localeCode = null }) {
  const pick = (code) => (code && getLocale(code)) || getDefaultLocale();
  let cfg = loadHashtagConfig(pick(localeCode));
  let title = "";
  let plan = livePlan;
  try {
    const content = readRecord(dir, slug);
    if (content) {
      cfg = loadHashtagConfig(pick(content.locale));
      const t = textOf(content.title).trim();
      if (t) title = t;
      if (!plan) plan = sanitizePlan(content.hashtagPlan, cfg) ?? planHashtags(content, cfg).plan;
    }
  } catch {
    // rơi về fallback bên dưới
  }
  return { title: title || fallbackName || slug, hashtags: plan && plan.length ? plan : null };
}

/**
 * @param {object} ctx
 * @param {import("express").Express} ctx.app
 * @param {{UPLOAD_DIR:string, CONTENT_ARCHIVE_DIR:string, VIDEOS_DIR:string, OUTPUT_DIR:string}} ctx.dirs
 * @param {(p:string, label:string)=>string} ctx.assertInsideUploads
 * @param {Function} ctx.runGenerateContent
 * @param {(code:string)=>object|null|undefined} ctx.localeFromCode
 */
export function createMarketApi(ctx) {
  const { app, dirs, assertInsideUploads, runGenerateContent, localeFromCode } = ctx;
  const { UPLOAD_DIR, CONTENT_ARCHIVE_DIR: STORE, VIDEOS_DIR, OUTPUT_DIR } = dirs;
  const defaultCode = () => getDefaultLocale().code;

  const recordLocale = (record) => (record && localeFromCode(record.locale)) || getDefaultLocale(); // bản ghi cũ thiếu locale = mặc định

  /** Slug đã bị chiếm bởi video / MP4 / bản ghi nào chưa. */
  const slugTaken = (slug) =>
    fs.existsSync(path.join(VIDEOS_DIR, slug)) || fs.existsSync(path.join(OUTPUT_DIR, `${slug}.mp4`)) || !!readRecord(STORE, slug);

  /** Thông tin thị trường của 1 slug (cho danh sách video / thống kê chi phí). */
  function recordInfo(slug, record = readRecord(STORE, slug)) {
    const locale = recordLocale(record);
    return {
      locale: locale.code,
      flag: locale.flag,
      flagIcon: locale.flagIcon,
      displayName: locale.displayName,
      status: record?._meta?.status || "built",
      derivedFrom: record?._meta?.derivedFrom || null,
    };
  }

  // Copy ảnh nguồn vào assets/uploads để client dùng lại làm leftPath/rightPath (create-video chỉ nhận file trong uploads).
  function copyToUploads(abs) {
    const ext = path.extname(abs).toLowerCase();
    const dest = path.join(UPLOAD_DIR, `reuse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    fs.copyFileSync(abs, dest);
    return dest;
  }

  function sourceOf({ slug, record }) {
    return resolveSource({ dir: STORE, videosDir: VIDEOS_DIR, slug, record });
  }

  // Phiên bản phái sinh: đối chiếu LẠI với bản gốc mỗi lần mở (nên luôn đúng với nội dung hiện tại, không lưu cảnh báo cũ).
  function factWarningsFor(derivedFrom, content) {
    if (!derivedFrom) return [];
    const base = readRecord(STORE, derivedFrom);
    const facts = base ? buildApprovedFacts(base) : null;
    return facts ? checkAgainstApprovedFacts(structuredClone(content), facts).warnings : [];
  }

  function draftName(record) {
    const label = (f) => viOf(f) || textOf(f);
    return `${label(record.label_left)} vs ${label(record.label_right)}`;
  }

  // ---------------------------------------------------------------------------------------------
  // Danh sách bản nháp (cho /api/videos) — video đã dựng do server.mjs liệt kê như cũ.
  // ---------------------------------------------------------------------------------------------
  function listDrafts() {
    return listRecords(STORE)
      .filter(({ record }) => record?._meta?.status === "draft")
      .map(({ slug, record }) => ({
        slug,
        name: draftName(record),
        hasIndex: false,
        hasBrief: false,
        renderFile: null,
        previewUrl: null,
        location: "output/content/ (bản nháp)",
        ...recordInfo(slug, record),
        canMakeVersion: !!sourceOf({ slug, record }),
      }));
  }

  function canMakeVersion(slug) {
    return !!sourceOf({ slug, record: readRecord(STORE, slug) });
  }

  // ---------------------------------------------------------------------------------------------
  // POST /api/save-draft
  // ---------------------------------------------------------------------------------------------
  app.post("/api/save-draft", (req, res) => {
    try {
      const b = req.body || {};
      const content = b.content;
      if (!content || !Array.isArray(content.points) || content.points.length === 0) {
        return res.status(400).json({ error: "Thiếu nội dung kịch bản (content.points rỗng)." });
      }
      const locale = localeFromCode(content.locale || b.locale);
      if (!locale) return res.status(400).json({ error: "Thị trường không tồn tại hoặc đang bị tắt." });
      if (content.locale && b.locale && content.locale !== b.locale) {
        return res.status(400).json({ error: `Nội dung thuộc thị trường "${content.locale}" nhưng yêu cầu lưu cho "${b.locale}".` });
      }
      const slug = String(b.slug || "").trim();
      if (!SLUG_RE.test(slug)) return res.status(400).json({ error: `Slug "${slug}" không hợp lệ — chỉ a-z, 0-9 và dấu gạch ngang.` });
      if (!hasLocaleSuffix(slug, locale, defaultCode())) {
        return res.status(400).json({ error: `Slug của thị trường ${locale.displayName} phải kết thúc bằng "-${effectiveSlugSuffix(locale, defaultCode())}".` });
      }

      const existing = readRecord(STORE, slug);
      const isVideo = fs.existsSync(path.join(VIDEOS_DIR, slug)) || fs.existsSync(path.join(OUTPUT_DIR, `${slug}.mp4`)) || existing?._meta?.status === "built" || (existing && !existing._meta);
      if (isVideo) {
        return res.status(409).json({ error: `Slug "${slug}" đã là 1 video đã dựng — không ghi đè. Đổi slug khác để lưu bản nháp.` });
      }
      if (existing && recordLocale(existing).code !== locale.code) {
        return res.status(409).json({ error: `Slug "${slug}" đang là bản nháp của thị trường ${existing.locale} — không ghi đè.` });
      }

      const cfg = loadHashtagConfig(locale);
      const hashtagPlan = sanitizePlan(b.hashtags, cfg) ?? planHashtags(content, cfg).plan;

      // ảnh nguồn: ảnh vừa tải (uploads) -> copy bền; không có thì giữ nguồn của bản nháp cũ
      let source = existing?._meta?.source || null;
      if (b.leftPath && b.rightPath) {
        try {
          const copied = copySourceImages(STORE, slug, assertInsideUploads(b.leftPath, "leftPath"), assertInsideUploads(b.rightPath, "rightPath"));
          source = { ...copied, topicHint: String(b.topicHint || ""), contentAngleId: String(b.contentAngleId || "auto"), customAngleText: String(b.customAngleText || "") };
        } catch (e) {
          console.warn(`[save-draft] không lưu được ảnh nguồn: ${e.message}`);
        }
      } else if (source) {
        source = { ...source, topicHint: String(b.topicHint ?? source.topicHint ?? ""), contentAngleId: String(b.contentAngleId || source.contentAngleId || "auto"), customAngleText: String(b.customAngleText ?? source.customAngleText ?? "") };
      }

      writeRecord(STORE, slug, buildRecord({ content, locale, hashtagPlan, status: "draft", source, derivedFrom: existing?._meta?.derivedFrom || null }));
      if (b.pendingSlug && String(b.pendingSlug).startsWith("_pending-")) renameCostLedgerSlug(b.pendingSlug, slug);
      res.json({ slug, locale: locale.code, savedAt: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ error: `Không lưu được bản nháp: ${e.message}` });
    }
  });

  // ---------------------------------------------------------------------------------------------
  // GET /api/content-record?slug=  — mở lại 1 bản ghi (nháp hoặc video đã dựng) vào Bước 2.
  // ---------------------------------------------------------------------------------------------
  app.get("/api/content-record", (req, res) => {
    const slug = String(req.query.slug || "");
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: "Slug không hợp lệ." });
    const record = readRecord(STORE, slug);
    if (!record) return res.status(404).json({ error: "Không tìm thấy nội dung đã lưu cho slug này." });
    const locale = recordLocale(record);
    const { _meta, hashtagPlan, locale: _l, ...content } = record;
    content.locale = locale.code;
    const cfg = loadHashtagConfig(locale);
    const plan = sanitizePlan(hashtagPlan, cfg) ?? planHashtags(content, cfg).plan;
    const src = sourceOf({ slug, record });
    let leftPath = null;
    let rightPath = null;
    if (src) {
      try {
        leftPath = copyToUploads(src.left);
        rightPath = copyToUploads(src.right);
      } catch (e) {
        console.warn(`[content-record] không copy được ảnh nguồn: ${e.message}`);
      }
    }
    res.json({
      slug,
      status: _meta?.status || "built",
      locale: locale.code,
      derivedFrom: _meta?.derivedFrom || null,
      generatedBy: _meta?.generatedBy || null,
      factWarnings: factWarningsFor(_meta?.derivedFrom, content),
      content,
      hashtags: withMeanings(plan, cfg),
      hashtagMax: maxHashtags(),
      warnings: collectContentWarnings(content, locale),
      source: src ? { available: true, from: src.from, topicHint: src.topicHint, contentAngleId: src.contentAngleId, customAngleText: src.customAngleText } : { available: false },
      leftPath,
      rightPath,
    });
  });

  // ---------------------------------------------------------------------------------------------
  // POST /api/market-versions { sourceSlug, locale } — sinh nội dung mới cho thị trường khác từ cùng 2 ảnh / gợi ý / góc độ.
  // Lưu thành bản NHÁP riêng (slug riêng, hậu tố thị trường), KHÔNG ghi đè bản gốc.
  // ---------------------------------------------------------------------------------------------
  app.post("/api/market-versions", async (req, res) => {
    const sourceSlug = String(req.body?.sourceSlug || "");
    if (!SLUG_RE.test(sourceSlug)) return res.status(400).json({ error: "Slug nguồn không hợp lệ." });
    const target = localeFromCode(req.body?.locale);
    if (!target) return res.status(400).json({ error: "Thị trường đích không tồn tại hoặc đang bị tắt." });

    const sourceRecord = readRecord(STORE, sourceSlug);
    if (!sourceRecord) return res.status(404).json({ error: "Không tìm thấy nội dung gốc đã lưu để tạo phiên bản." });
    const sourceLocale = recordLocale(sourceRecord);
    if (sourceLocale.code === target.code) return res.status(400).json({ error: `Nội dung gốc đã thuộc thị trường ${target.displayName} — chọn thị trường khác.` });
    const src = sourceOf({ slug: sourceSlug, record: sourceRecord });
    if (!src) {
      return res.status(409).json({ error: "Không dùng lại được ảnh gốc: video này dựng trước khi tool lưu ảnh nguồn và project đã bị dọn. Hãy tạo mới từ Bước 1." });
    }

    const gen = await runGenerateContent({
      leftPath: src.left,
      rightPath: src.right,
      hint: src.topicHint,
      localeCode: target.code,
      contentAngleId: src.contentAngleId,
      customAngleText: src.customAngleText,
      // Bản gốc đã duyệt là sự thật cố định: Gemini chỉ viết lại bằng ngôn ngữ đích, KHÔNG nhận dạng lại ảnh. Bản gốc thiếu dữ kiện (null) thì sinh như cũ.
      approvedFacts: buildApprovedFacts(sourceRecord),
    });
    if (!gen.ok) return res.status(gen.status).json({ error: gen.error });

    try {
      const baseSlug = stripLocaleSuffix(sourceSlug, sourceLocale, defaultCode());
      const slug = uniqueSlugForLocale(baseSlug, target, slugTaken, defaultCode());
      const cfg = loadHashtagConfig(target);
      const hashtagPlan = planHashtags(gen.content, cfg).plan;
      const copied = copySourceImages(STORE, slug, src.left, src.right);
      const source = { ...copied, topicHint: src.topicHint, contentAngleId: src.contentAngleId, customAngleText: src.customAngleText };
      writeRecord(STORE, slug, buildRecord({ content: gen.content, locale: target, hashtagPlan, status: "draft", source, derivedFrom: sourceSlug }));
      renameCostLedgerSlug(gen.pendingSlug, slug);
      res.json({ slug, locale: target.code, derivedFrom: sourceSlug });
    } catch (e) {
      res.status(500).json({ error: `Không lưu được phiên bản mới: ${e.message}` });
    }
  });

  return { recordInfo, listDrafts, canMakeVersion, recordLocale, slugTaken, getLocale };
}
