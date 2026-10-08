// Dựng nội dung video so sánh (dòng thoại, caption, timeline, index.html) từ content + timing + kế hoạch chữ.
// Tách khỏi scripts/scaffold-compare-video.mjs để test được (golden index.html) mà không phải chạy cả quy trình scaffold.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hookText, payoffText, docTitleText } from "./video-lines.mjs";
import { fontFaceCss, fontStack, familiesOfLocale } from "./fonts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
const fail = (msg) => {
  throw new Error(msg);
};

// Fixed poses for the beats the model does not choose. All four must exist in
// assets/actions/actions.json with frame.frame_class "full" (the flag that marks
// a pose usable by this pipeline — the 2026-08 set is a uniform square crop, no
// more camera-distance mixing). 2026-08-31: picked to match each pose's own
// actions.json "use_case" for that beat (an earlier draft used a "point at the
// right card" pose for the hook, which overlapped with what body points do and
// didn't fit hook/payoff).
// 2026-09-03: wave / offer-a removed from the catalog. Hook now points at the
// card being introduced ("đây là X").
// 2026-09-04: bộ ảnh HuyK thay mới (7 pose), offer-b bị gỡ — hook phải giờ
// dùng point-up-right (đối xứng với point-up-left) thay cho cử chỉ xoè hai tay.
export const HOOK_POSE_LEFT = "point-up-left"; // giới thiệu khái niệm bên card trái
export const HOOK_POSE_RIGHT = "point-up-right"; // giới thiệu khái niệm bên card phải (chỉ chéo lên phải)
export const QUESTION_POSE = "thinking"; // use_case: "đặt câu hỏi mở đầu kiểu 'Sự khác nhau là gì?'"
export const PAYOFF_POSE = "thumbs-up-a";

// Timing (2026-09-04, bản v2): generate-vo.mjs đã trim ~0.2s lead + ~0.8s trailing
// silence khỏi mỗi line-*.mp3 theo word boundary, nên KHÔNG cần gap lớn theo beat
// nữa — 1 gap phẳng nhỏ cho ~0.5s speech-to-speech. Xem templates/auto-compare/generate-vo.mjs
// (TL_START1 / TL_GAP / TL_OUTRO) — giữ 3 hằng số này khớp nhau.
export const START_1 = 0.55;
export const GAP_FLAT = 0.14;
export const OUTRO_HOLD = 1.2;

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================
// Xây danh sách dòng thoại (hook -> question -> body -> payoff) từ content
// ============================================================
// `text` is the spoken line (drives the TTS + timing); `side` / `tag` / `sub`
// are what actually appears on screen — the reference clip carries no sentence
// subtitles, only a short tag under each panel.
export function buildLines(content, locale) {
  const { label_left, label_right, title, points } = content;
  const lines = [];

  lines.push({
    n: 1,
    beat: "hook",
    pose: HOOK_POSE_LEFT,
    text: hookText(locale, label_left),
    side: "left",
    tag: label_left,
    sub: "",
  });
  lines.push({
    n: 2,
    beat: "hook",
    pose: HOOK_POSE_RIGHT,
    text: hookText(locale, label_right),
    side: "right",
    tag: label_right,
    sub: "",
  });
  lines.push({
    n: 3,
    beat: "question",
    pose: QUESTION_POSE,
    text: title,
    side: "both",
    tag: title,
    sub: "",
  });
  points.forEach((p, i) => {
    lines.push({
      n: 4 + i,
      beat: "body",
      pose: p.suggested_action,
      text: p.text,
      side: p.side,
      tag: p.tag,
      sub: p.sub || "",
      // Giai đoạn 1 — ảnh minh hoạ ngữ cảnh (đã qua enforceContextImageLimits: side="both" và
      // point vượt cap/liền kề cùng bên đã bị loại từ trước, nên tới đây side chắc chắn là
      // "left"/"right" khi needsContextImage=true). contextImageFile được điền sau, ở
      // generateContextImages() — null nghĩa là chưa sinh/sinh lỗi, giữ ảnh gốc.
      needsContextImage: p.needs_context_image === true,
      imageConcept: p.image_concept || "",
      contextImageFile: null,
    });
  });
  lines.push({
    n: 4 + points.length,
    beat: "payoff",
    pose: PAYOFF_POSE,
    text: payoffText(locale, label_left, label_right),
    side: "both",
    tag: locale.video.payoffTag,
    sub: locale.video.payoffSub,
  });

  return lines.map((l) => ({ ...l, id: `line-${l.n}` }));
}

export function buildCaptionsJs(lines, words) {
  return lines
    .map((l) => {
      const w = words[l.id];
      const pairs = w.map((x) => `[${JSON.stringify(String(x.t))},${round3(x.s)}]`).join(",");
      return `        ${l.n}: [${pairs}],`;
    })
    .join("\n");
}

// PHRASES = { <n>: [[số từ, cỡ chữ | 0], ...] } — cụm caption từng dòng thoại do fit-check.mjs tính (đo bằng font thật).
export function buildPhrasesJs(lines, phrases) {
  return lines.map((l) => `        ${l.n}: ${JSON.stringify(phrases[l.n])},`).join("\n");
}

// ============================================================
// Timing — công thức gap của script-and-timing.md, áp cho N dòng linh hoạt
// ============================================================
export function round3(n) {
  return Math.round(n * 1000) / 1000;
}

export function computeTiming(lines, durations) {
  const timing = [];
  let start = START_1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dur = durations[line.id];
    if (dur == null) fail(`Thiếu duration cho "${line.id}" trong assets/vo/durations.json.`);
    if (i > 0) {
      start = timing[i - 1].start + timing[i - 1].dur + GAP_FLAT;
    }
    timing.push({ start: round3(start), dur });
  }
  const last = timing[timing.length - 1];
  const ROOT_DURATION = Math.round((last.start + last.dur + OUTRO_HOLD) * 10) / 10;
  return { timing, ROOT_DURATION };
}

// ============================================================
// Sinh khối JS timeline: pose swap + card active-emphasis theo từng beat.
// (Nhãn 2 khái niệm cố định; text theo beat do caption karaoke lo — xem
//  buildCaptionsJs + template.)
// ============================================================
export function buildTimelineBeatsJs(lines, cardExts) {
  const chunks = [];
  const BEAT_TITLE = {
    hook: "HOOK",
    question: "QUESTION",
    body: `BODY (${lines.filter((l) => l.beat === "body").length} điểm so sánh, từ Gemini)`,
    payoff: "PAYOFF",
  };

  chunks.push(
    "      // Pose set: khung vuông cố định, không transform per-pose — xem",
    "      // .host-avatar-img + const POSE_ADJUST trong index.html.",
    `      tl.set("#host-img", poseFor("${lines[0].pose}"), 0);`,
    "",
  );

  let lastBeat = null;
  let lastFocus = null;
  lines.forEach((line, i) => {
    if (line.beat !== lastBeat) {
      if (i > 0) chunks.push("");
      chunks.push(`      // ---------- BEAT: ${BEAT_TITLE[line.beat]} ----------`);
      lastBeat = line.beat;
    }
    const at = `VO[${line.n}].start`;
    chunks.push(`      changePose("${line.pose}", ${at});`);

    if (line.side !== lastFocus) {
      chunks.push(`      focus("${line.side}", ${at});`);
      lastFocus = line.side;
    }

    if (line.beat === "payoff") {
      chunks.push(
        `      tl.fromTo("#avatar-host", { scale: 1 }, { scale: 1.03, duration: 0.3, ease: "power2.out", yoyo: true, repeat: 1 }, ${at});`,
      );
    }

    // Giai đoạn 1 — swap tạm ảnh card sang ảnh minh hoạ ngữ cảnh, rồi đổi lại ảnh sản phẩm gốc
    // ngay khi sang dòng kế tiếp (luôn tồn tại — payoff luôn là dòng cuối cùng, không tự sinh
    // bởi Gemini). enforceContextImageLimits đã đảm bảo side ở đây chỉ có thể là left/right.
    if (line.contextImageFile) {
      const revertFile = `card-${line.side}${cardExts[line.side]}`;
      chunks.push(`      setCardImage("${line.side}", "${line.contextImageFile}", ${at});`);
      const next = lines[i + 1];
      if (next) {
        chunks.push(`      setCardImage("${line.side}", "${revertFile}", VO[${next.n}].start);`);
      }
    }

    chunks.push("");
  });

  return chunks.join("\n").replace(/\n+$/, "");
}

// ============================================================
// Ghi index.html từ templates/auto-compare/index.html
// ============================================================
export function buildIndexHtml(target, content, lines, timingResult, cardExts, locale, words, textPlan) {
  const templatePath = path.join(REPO_ROOT, "templates", "auto-compare", "index.html");
  let html = fs.readFileSync(templatePath, "utf8");

  const docTitle = escapeHtml(docTitleText(locale, content.label_left, content.label_right));
  const eLabelLeft = escapeHtml(content.label_left);
  const eLabelRight = escapeHtml(content.label_right);

  const captionsJs = buildCaptionsJs(lines, words);
  const phrasesJs = buildPhrasesJs(lines, textPlan.phrases);

  const audioTagsHtml = lines
    .map((l, i) => {
      const t = timingResult.timing[i];
      return `      <audio id="vo-${l.n}" src="assets/vo/${l.id}.mp3" data-start="${t.start}" data-duration="${t.dur}" data-track-index="20"></audio>`;
    })
    .join("\n");

  const voObjectJs = lines
    .map((l, i) => {
      const t = timingResult.timing[i];
      return `        ${l.n}: { start: ${t.start}, dur: ${t.dur} },`;
    })
    .join("\n");

  const timelineBeatsJs = buildTimelineBeatsJs(lines, cardExts);

  html = html
    .replace(/__HTML_LANG__/g, locale.video.htmlLang)
    .replace("/*FONT_FACES*/", () => fontFaceCss(familiesOfLocale(locale)))
    .replace(/__FONT_DISPLAY__/g, () => fontStack(locale.fonts.display, "sans-serif"))
    .replace(/__FONT_MONO__/g, () => fontStack(locale.fonts.mono, "monospace"))
    .replace(/__DOC_TITLE__/g, docTitle)
    .replace(/__LABEL_LEFT_HTML__/g, () => labelHtml(textPlan.label.left))
    .replace(/__LABEL_RIGHT_HTML__/g, () => labelHtml(textPlan.label.right))
    .replace(/__LABEL_PX__/g, String(textPlan.label.fontPx))
    .replace(/__LABEL_STYLE__/g, locale.video.italic ? "italic" : "normal")
    .replace(/__LABEL_TRANSFORM__/g, locale.video.uppercase ? "uppercase" : "none")
    .replace(/__CAP_PX__/g, String(locale.layout.caption.fontPx))
    .replace(/__CAP_GAP__/g, String(locale.layout.caption.wordGapPx))
    .replace(/__CAP_JOINER__/g, locale.layout.caption.joiner)
    .replace(/__CAP_ACTIVE_SCALE__/g, String(locale.layout.caption.activeScale))
    .replace("/*PHRASES_OBJECT*/", () => phrasesJs)
    .replace(/__LABEL_LEFT__/g, eLabelLeft)
    .replace(/__LABEL_RIGHT__/g, eLabelRight)
    .replace(/__CARD_LEFT_SRC__/g, `assets/images/card-left${cardExts.left}`)
    .replace(/__CARD_RIGHT_SRC__/g, `assets/images/card-right${cardExts.right}`)
    .replace(/__AVATAR_INITIAL_SRC__/g, `assets/actions/${lines[0].pose}.svg`)
    .replace(/__ROOT_DURATION__/g, String(timingResult.ROOT_DURATION))
    .replace(/__DEFAULT_EYEBROW__/g, () => escapeHtml(locale.video.eyebrow))
    .replace("<!--AUDIO_TAGS-->", audioTagsHtml)
    .replace("/*CAPTIONS_OBJECT*/", () => captionsJs)
    .replace("/*VO_OBJECT*/", voObjectJs)
    .replace("/*TIMELINE_BEATS*/", timelineBeatsJs);

  const leftover = html.match(/__[A-Z_]+__|\/\*(?:CAPTIONS_OBJECT|VO_OBJECT|TIMELINE_BEATS)\*\/|<!--AUDIO_TAGS-->/);
  if (leftover) fail(`Template còn placeholder chưa thay: ${leftover[0]} — kiểm tra templates/auto-compare/index.html.`);

  fs.writeFileSync(path.join(target, "index.html"), html);
}

// Nhãn 2 ảnh: dòng đã xuống sẵn (theo thị trường), ghép bằng <br>.
export const labelHtml = (lines) => lines.map(escapeHtml).join("<br>");