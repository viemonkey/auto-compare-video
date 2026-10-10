// Mốc 6 — dựng index.html của video giới thiệu sản phẩm từ templates/product-showcase/index.html: nhịp thoại, cảnh, shot, thẻ thông số, lời kêu gọi, phụ đề.
// Mọi toạ độ/ngẫu nhiên tính ở đây (Node, PRNG có hạt giống) rồi nhúng thành số — composition chỉ có GSAP xác định.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadProductConfig, labelsFor } from "./config.mjs";
import { escapeHtml, round3 } from "../compose.mjs";
import { fontFaceCss, fontStack, familiesOfLocale } from "../fonts.mjs";
import { buildCaptionsJs, buildPhrasesJs } from "../compose.mjs";
import { specRows } from "./form.mjs";
import { planShots, sparklePoints, boxToFrame, centerOf, round } from "./shots.mjs";
import { macroZoom } from "./scene-assets.mjs";
import { decodeRgba } from "./images.mjs";
import { fillTemplate } from "../video-lines.mjs";

const fail = (msg) => { throw new Error(msg); };

/** Nhịp thoại: câu đầu bắt đầu sau `startOffset`, cách nhau `gap`, giữ `outroHold` sau câu cuối. */
export function computeProductTiming(lines, durations, config = loadProductConfig()) {
  const { startOffset, gap, outroHold } = config.video;
  const timing = [];
  let start = startOffset;
  lines.forEach((line, i) => {
    const dur = durations[line.id];
    if (dur == null) fail(`Thiếu duration cho "${line.id}" trong assets/vo/durations.json.`);
    if (i > 0) start = timing[i - 1].start + timing[i - 1].dur + gap;
    timing.push({ start: round3(start), dur });
  });
  let last = timing.at(-1);
  let root = last.start + last.dur + outroHold;
  // Lời thoại ngắn làm video dưới `minDuration` (15 giây): giãn đều khoảng nghỉ giữa các câu (tối đa maxPadPerGap mỗi khoảng), phần còn thiếu dồn vào đoạn giữ cuối.
  if (root < config.video.minDuration && timing.length > 1) {
    const gaps = timing.length - 1;
    const pad = Math.min(config.video.maxPadPerGap, (config.video.minDuration - root) / gaps);
    timing.forEach((t, i) => { t.start = round3(t.start + pad * i); });
    last = timing.at(-1);
    root = last.start + last.dur + outroHold;
  }
  root = Math.max(root, config.video.minDuration);
  return { timing, ROOT_DURATION: Math.round(root * 10) / 10 };
}

/** Khoảng thời gian của từng cảnh: cảnh i từ vạch của câu i (trừ chút "dẫn") tới vạch câu i+1; cảnh đầu từ 0, cảnh cuối tới hết video. */
export function sceneWindows(timing, rootDuration, lead = 0.1) {
  return timing.map((t, i) => {
    const at = i === 0 ? 0 : round3(t.start - lead);
    const end = i === timing.length - 1 ? rootDuration : round3(timing[i + 1].start - lead);
    return { at, end, dur: round3(end - at) };
  });
}

/** Từ khoá nổi bật trên phụ đề: chữ trong form (đá chính, chất liệu, màu, giác cắt...) và mọi con số. Chuẩn hoá như trình duyệt (NFKC, bỏ dấu câu). */
export function keywordsFromForm(form, specValues = {}) {
  const norm = (s) => String(s).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const stop = new Set(["đá", "da", "và", "the", "and", "の", "ของ"]);
  const out = new Set();
  const add = (text) => String(text || "").split(/\s+/).forEach((w) => { const n = norm(w); if (n.length >= 3 && !stop.has(n)) out.add(n); else if (/^\d+$/.test(n)) out.add(n); });
  for (const key of ["material", "metalColor", "mainStone", "cut", "carat", "feature"]) { add(form[key]); add(specValues[key]); }
  add(specValues.origin);
  return [...out];
}

const fit = (w, h, maxW, maxH) => { const k = Math.min(maxW / w, maxH / h); return { w: Math.round(w * k), h: Math.round(h * k) }; };

/** Thẻ thông số theo từng câu "specs": câu 1 = chất liệu/màu/đá chính/nguồn gốc; câu 2 = đá phụ/điểm nổi bật; chỉ 1 câu specs thì dồn hết (trừ giá — giá ở cảnh kêu gọi). */
export function chipsPerSpecLine(project, labels, config = loadProductConfig()) {
  const sv = project.script?.specValues || {};
  const form = { ...project.form };
  for (const k of ["material", "metalColor", "mainStone", "carat", "cut", "sideStones", "feature"]) if (sv[k]) form[k] = sv[k];
  const rows = specRows(form, labels, config).filter((r) => r.key !== "price");
  const origin = rows.find((r) => r.key === "origin");
  if (origin && sv.origin) origin.value = sv.origin;
  const firstKeys = ["material", "metalColor", "mainStone", "origin"];
  const specLines = project.script.lines.filter((l) => l.beat === "specs");
  const groups = specLines.length >= 2 ? [rows.filter((r) => firstKeys.includes(r.key)), rows.filter((r) => !firstKeys.includes(r.key))] : [rows];
  // nhóm 2 rỗng (form không có đá phụ/điểm nổi bật) -> câu 2 vẫn hiện lại vài thông số quan trọng nhất để cảnh không trống
  if (groups[1] && !groups[1].length) groups[1] = rows.filter((r) => ["material", "mainStone"].includes(r.key)).slice(0, 2);
  return groups.map((g) => g.map((r) => ({ label: r.label, value: r.value })));
}

async function alphaSampler(file) {
  const img = await decodeRgba(file, { maxDim: 500 });
  return (x, y) => {
    const px = Math.min(img.width - 1, Math.max(0, Math.floor((x) * img.width)));
    const py = Math.min(img.height - 1, Math.max(0, Math.floor((y) * img.height)));
    return img.data[(py * img.width + px) * 4 + 3];
  };
}

const chipsHtml = (n, chips, cls, top) =>
  `<div class="chips ${cls}" style="top:${top}px">${chips.map((c, k) => `<div class="chip" id="chip-${n}-${k}"><span class="k">${escapeHtml(c.label)}</span><span class="v">${escapeHtml(c.value)}</span></div>`).join("")}</div>`;

/**
 * Dữ liệu + HTML của từng cảnh.
 * @returns {Promise<{html:string, scenes:Array<object>}>}
 */
export async function buildScenes({ project, lines, timing, rootDuration, assets, locale, clip, targetDir, config = loadProductConfig() }) {
  const labels = labelsFor(locale.code, config);
  const v = config.video;
  const wins = sceneWindows(timing, rootDuration);
  const chipGroups = chipsPerSpecLine(project, labels, config);
  const price = project.form.price;
  const html = [];
  const data = [];
  let specIdx = 0;
  for (const [i, scene] of project.scenes.entries()) {
    const win = wins[i];
    const n = scene.line;
    const entry = { n, kind: scene.kind, at: win.at, end: win.end, origin: null, host: false, chips: null, cta: false, clipHook: false };
    const seed = `${project.id}:${scene.id}`;
    let box = null;
    let inner = "";
    let sceneStyle = "";
    let wrapStyle = "";
    let wrapBox = null; // khung của .kb trong khung video
    let stoneForZoom = null;
    const sweepMask = (file) => `-webkit-mask-image:url(${file});mask-image:url(${file})`;

    if (scene.kind === "pose" || scene.kind === "macro" || scene.kind === "hero") {
      const prod = assets.products[scene.productImage ?? 0];
      if (!prod) fail(`Cảnh ${n} thiếu ảnh sản phẩm đã tách nền.`);
      let size;
      let cx;
      let cy;
      if (scene.kind === "pose") {
        const side = scene.hostSide || "right";
        size = fit(prod.cutW, prod.cutH, v.pose.productWidth, v.pose.productMaxHeight);
        cx = v.pose.productCx + (side === "right" ? -40 : 40);
        cy = v.pose.productCy;
      } else {
        size = fit(prod.cutW, prod.cutH, v.hero.width, v.hero.maxHeight);
        cx = v.hero.cx;
        cy = v.hero.cy;
      }
      wrapBox = { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h };
      wrapStyle = `left:${Math.round(wrapBox.x)}px;top:${Math.round(wrapBox.y)}px;width:${size.w}px;height:${size.h}px`;
      const sampler = await alphaSampler(path.join(targetDir, prod.cut));
      const sparkBox = scene.kind === "macro" && prod.stoneBox ? { x: prod.stoneBox.x * size.w, y: prod.stoneBox.y * size.h, w: prod.stoneBox.w * size.w, h: prod.stoneBox.h * size.h } : { x: size.w * 0.05, y: size.h * 0.05, w: size.w * 0.9, h: size.h * 0.9 };
      box = { box: sparkBox, size, accept: (x, y) => sampler(x / size.w, y / size.h) > 160 };
      if (scene.kind === "macro") {
        const focus = prod.stoneBox || { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
        entry.origin = { x: round((focus.x + focus.w / 2) * size.w, 1), y: round((focus.y + focus.h / 2) * size.h, 1) };
        stoneForZoom = macroZoom(prod.stoneBox, size.w, 1080, v.macro, { sourcePx: prod.sourcePx });
      }
      inner = `<div class="kb" id="kb-${n}" style="${wrapStyle}"><img class="prod" src="${prod.cut}" alt=""><div class="sweep" id="sw-${n}" style="${sweepMask(prod.cut)}"></div></div>`;
      if (scene.kind === "pose") {
        const side = scene.hostSide || "right";
        const hostW = Math.round(1080 * v.pose.hostScale);
        const left = side === "right" ? 1080 - hostW + v.pose.hostShiftPx - 40 : -v.pose.hostShiftPx + 40;
        inner += `<img class="host" id="host-${n}" src="assets/actions/${scene.pose}.svg" alt="" style="width:${hostW}px;height:${hostW}px;left:${left}px;bottom:${v.pose.hostBottom}px;opacity:0">`;
        entry.host = true;
      }
    } else if (scene.kind === "photo" || scene.kind === "half") {
      const src = scene.kind === "half" ? assets.photos[scene.from] : assets.photos[scene.id];
      if (!src) fail(`Cảnh ${n} thiếu ảnh nguồn.`);
      const frameBox = boxToFrame(src.box, src.w, src.h);
      wrapBox = { x: 0, y: 0, w: 1080, h: 1920 };
      wrapStyle = "left:0;top:0;width:1080px;height:1920px";
      box = { box: frameBox, size: { w: 1080, h: 1920 }, accept: null };
      const c = centerOf(frameBox);
      entry.origin = scene.kind === "half" ? { x: c.x, y: Math.max(0, c.y - 160) } : c;
      const useClip = !!clip && i === 0 && scene.kind === "photo";
      entry.clipHook = useClip;
      inner = `<div class="kb" id="kb-${n}" style="${wrapStyle}">${useClip ? "" : `<img class="full" src="${src.file}" alt="" style="width:1080px;height:1920px">`}<div class="sweep box" id="sw-${n}" style="left:${Math.round(frameBox.x)}px;top:${Math.round(frameBox.y)}px;width:${Math.round(frameBox.w)}px;height:${Math.round(frameBox.h)}px"></div></div>`;
      if (useClip) box = null;
    }

    const shots = planShots({ start: win.at, dur: win.dur, kind: scene.beat === "cta" ? "cta" : scene.kind, seed, box: null, config });
    for (const shot of shots) {
      if (scene.kind === "half") shot.zoom = shot.zoom.map((z) => round(z * v.half.zoom, 3));
      if (scene.kind === "macro") shot.zoom = shot.zoom.map((z) => round(z * Math.max(1, stoneForZoom || 1), 3));
      if (box) shot.sparkles = sparklePoints(box.box, v.sparklesPerShot, `${seed}:${shot.index}`, { shotDur: shot.dur, accept: box.accept });
    }
    entry.shots = shots;

    // thẻ thông số (câu "specs") / lời kêu gọi (câu "cta")
    if (scene.beat === "specs") {
      const chips = chipGroups[Math.min(specIdx, chipGroups.length - 1)] || [];
      specIdx++;
      if (chips.length) {
        const side = scene.kind === "pose" ? (scene.hostSide === "right" ? "left" : "right") : "center";
        inner += chipsHtml(n, chips, side, scene.kind === "pose" ? v.layout.poseChipsTop : v.layout.chipsTop);
        entry.chips = chips;
      }
    }
    if (scene.beat === "cta") {
      const t = escapeHtml(labels.cta);
      const p = price ? `<div class="p"><small>${escapeHtml(labels.ctaPrice)}</small><span>${escapeHtml(price)}</span></div>` : "";
      inner += `<div class="cta" id="cta-${n}" style="top:${v.layout.ctaTop}px"><div class="t">${t}</div>${p}</div>`;
      entry.cta = true;
    }
    html.push(`        <div class="sc sc-${scene.kind}" id="sc-${n}" data-kind="${scene.kind}"${sceneStyle ? ` style="${sceneStyle}"` : ""}>${inner}</div>`);
    data.push(entry);
  }
  return { html: html.join("\n"), scenes: data };
}

/**
 * @param {{target:string, project:object, locale:object, lines:Array, timing:{timing:Array,ROOT_DURATION:number}, words:object, textPlan:{phrases:object}, assets:object,
 *   clip:{file:string,seconds:number}|null, audio:{file:string}|null, config?:object}} o
 */
export async function buildProductIndexHtml({ target, project, locale, lines, timing, words, textPlan, assets, clip, audio, config = loadProductConfig() }) {
  const v = config.video;
  const root = timing.ROOT_DURATION;
  const labels = labelsFor(locale.code, config);
  const scenes = await buildScenes({ project, lines, timing: timing.timing, rootDuration: root, assets, locale, clip, targetDir: target, config });
  const name = project.displayName || project.form.type;
  const keywords = keywordsFromForm(project.form, project.script?.specValues);
  const clipTag = clip ? `      <video id="ai-clip" class="clip" src="${clip.file}" muted playsinline data-start="0" data-duration="${round3(Math.min(clip.seconds, scenes.scenes[0].end + 0.2))}" data-track-index="2"></video>` : "";
  const audioTag = audio ? `      <audio id="mix" src="${audio.file}" data-start="0" data-duration="${root}" data-track-index="20"></audio>` : "";
  const vo = lines.map((l, i) => `        ${l.n}: { start: ${timing.timing[i].start}, dur: ${timing.timing[i].dur} },`).join("\n");
  const data = { duration: root, sweepSeconds: v.sweepSeconds, scenes: scenes.scenes };

  const html0 = fs.readFileSync(path.join(REPO_ROOT, "templates", "product-showcase", "index.html"), "utf8");
  const html = html0
    .replace(/__HTML_LANG__/g, locale.video.htmlLang)
    .replace("/*FONT_FACES*/", () => fontFaceCss(familiesOfLocale(locale)))
    .replace(/__FONT_DISPLAY__/g, () => fontStack(locale.fonts.display, "sans-serif"))
    .replace(/__FONT_MONO__/g, () => fontStack(locale.fonts.mono, "monospace"))
    .replace(/__DOC_TITLE__/g, () => escapeHtml(fillTemplate(labels.docTitle, { name })))
    .replace(/__CAP_PX__/g, String(locale.layout.caption.fontPx))
    .replace(/__CAP_GAP__/g, String(locale.layout.caption.wordGapPx))
    .replace(/__CAP_JOINER__/g, locale.layout.caption.joiner)
    .replace(/__CAP_ACTIVE_SCALE__/g, String(locale.layout.caption.activeScale))
    .replace(/__CAP_TOP__/g, String(v.layout.captionTop))
    .replace(/__BG_TOP__/g, v.background.top)
    .replace(/__BG_MID__/g, v.background.mid)
    .replace(/__BG_BOTTOM__/g, v.background.bottom)
    .replace(/__BG_GLOW__/g, v.background.glow)
    .replace(/__ROOT_DURATION__/g, String(root))
    .replace(/__DEFAULT_EYEBROW__/g, () => escapeHtml(labels.eyebrow))
    .replace("<!--CLIP_TAG-->", () => clipTag)
    .replace("<!--SCENES_HTML-->", () => scenes.html)
    .replace("<!--AUDIO_TAG-->", () => audioTag)
    .replace("/*DATA_OBJECT*/", () => JSON.stringify(data))
    .replace("/*CAPTIONS_OBJECT*/", () => buildCaptionsJs(lines, words))
    .replace("/*PHRASES_OBJECT*/", () => buildPhrasesJs(lines, textPlan.phrases))
    .replace("/*VO_OBJECT*/", () => vo)
    .replace("/*KEYWORDS_ARRAY*/", () => JSON.stringify(keywords));
  const leftover = html.match(/__[A-Z_]+__|\/\*(?:DATA_OBJECT|CAPTIONS_OBJECT|PHRASES_OBJECT|VO_OBJECT|KEYWORDS_ARRAY)\*\/|<!--(?:CLIP_TAG|SCENES_HTML|AUDIO_TAG)-->/);
  if (leftover) fail(`Template còn placeholder chưa thay: ${leftover[0]}.`);
  fs.writeFileSync(path.join(target, "index.html"), html);
  return { scenes: scenes.scenes, keywords };
}
