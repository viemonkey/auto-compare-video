// Đo chữ bằng trình duyệt THẬT (chrome-headless-shell mà HyperFrames dùng để render) với font local thật.
// Cách làm: dựng 1 trang đo tạm (nhúng @font-face trỏ file:// tới assets/fonts + dữ liệu cần đo), cho Chrome chạy
// `--dump-dom`, trang tự chạy thuật toán vừa khung (public/shared/text-fit.mjs — module thuần dùng chung với test) bằng
// getBoundingClientRect và ghi kết quả JSON ra DOM. Mỗi lần đo = 1 lần chạy Chrome (~1s) cho CẢ lô, không đo từng dòng.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { loadFontRegistry, fontStack } from "./fonts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = path.join(__dirname, "..", "..", "public", "shared");

/** Tìm Chrome: CHROME_PATH → chrome-headless-shell trong cache HyperFrames (đúng bản dùng render) → Chrome/Edge cài sẵn. */
export function findChrome(env = process.env) {
  if (env.CHROME_PATH && fs.existsSync(env.CHROME_PATH)) return env.CHROME_PATH;
  const home = os.homedir();
  const shellRoot = path.join(home, ".cache", "hyperframes", "chrome", "chrome-headless-shell");
  try {
    for (const ver of fs.readdirSync(shellRoot).sort().reverse()) {
      for (const sub of fs.readdirSync(path.join(shellRoot, ver))) {
        for (const exe of ["chrome-headless-shell.exe", "chrome-headless-shell"]) {
          const p = path.join(shellRoot, ver, sub, exe);
          if (fs.existsSync(p)) return p;
        }
      }
    }
  } catch {
    // chưa có cache HyperFrames -> thử Chrome cài sẵn
  }
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, " ");

/** @font-face tuyệt đối (file://) cho trang đo. */
function absoluteFontCss(families, registry) {
  const out = [];
  for (const family of families) {
    for (const face of registry.families[family].faces) {
      const url = pathToFileURL(path.join(registry.dir, face.file)).href;
      out.push(
        `@font-face{font-family:"${family}";font-style:${face.style};font-weight:${face.weight};font-display:block;src:url(${url}) format("woff2");${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ""}}`,
      );
    }
  }
  return out.join("\n");
}

/**
 * Trang đo. `job`:
 *   { language, fontChain: string[], video:{italic,uppercase}, lineBreak, labelBox, captionBox, frames:{label,caption},
 *     items: [{id, frame:"label", text} | {id, frame:"caption", tokens:string[]}] }
 */
export function buildMeasurePage(job, registry = loadFontRegistry()) {
  const families = [...new Set(job.fontChain)];
  const stack = fontStack(job.fontChain, "sans-serif");
  const fit = pathToFileURL(path.join(SHARED_DIR, "text-fit.mjs")).href;
  return `<!doctype html><html lang="${esc(job.language)}"><head><meta charset="utf-8"><style>
${absoluteFontCss(families, registry)}
html,body{margin:0;padding:0;font-family:${stack};}
</style></head><body>
<pre id="result">pending</pre>
<script type="application/json" id="job">${jsonForScript({ ...job, stack })}</script>
<script type="module">
import { fitLabel, fitCaption } from ${JSON.stringify(fit)};
const out = document.getElementById("result");
(async () => {
  try {
    const job = JSON.parse(document.getElementById("job").textContent);
    const { stack, video, frames } = job;
    // nạp font cho đúng các ký tự sẽ đo rồi mới đo (font-display: block -> không đo nhầm chữ dự phòng)
    const sample = job.items.map((i) => (i.text ?? (i.tokens || []).join(" "))).join(" ");
    await Promise.all([900, 700].map((w) => document.fonts.load(w + " 44px " + stack, sample)));
    await document.fonts.ready;
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;left:-99999px;top:0;white-space:nowrap;visibility:hidden";
    document.body.append(probe);
    const labelMeasureAt = (px) => (line) => {
      probe.textContent = "";
      const s = document.createElement("span");
      s.lang = job.language;
      s.style.cssText = "display:inline-block;white-space:nowrap;font:" + (video.italic ? "italic " : "") + "900 " + px + "px/" + frames.label.lineHeight + " " + stack +
        ";letter-spacing:" + (frames.label.letterSpacingEm || 0) + "em;text-transform:" + (video.uppercase ? "uppercase" : "none");
      s.textContent = line;
      probe.append(s);
      return s.getBoundingClientRect().width + (frames.label.strokePx || 0);
    };
    const captionMeasureAt = (px) => (group) => {
      probe.textContent = "";
      const d = document.createElement("div");
      d.lang = job.language;
      d.style.cssText = "display:inline-block;white-space:nowrap;font-family:" + stack; // cha .cap-phrase: cỡ mặc định 16px của trang
      let maxW = 0;
      group.forEach((tok, i) => {
        const s = document.createElement("span");
        s.style.cssText = "display:inline-block;font:900 " + px + "px/" + (frames.caption.lineHeight || 1.1) + " " + stack + ";margin:0 " + job.captionBox.wordGapPx + "px";
        s.textContent = tok;
        d.append(s);
        if (i < group.length - 1 && job.captionBox.joiner) d.append(document.createTextNode(job.captionBox.joiner));
      });
      probe.append(d);
      for (const s of d.children) maxW = Math.max(maxW, s.getBoundingClientRect().width);
      // + viền chữ và phần phình ra của từ đang đọc (scale)
      return d.getBoundingClientRect().width + (frames.caption.strokePx || 0) + (job.captionBox.activeScale - 1) * maxW;
    };
    const results = {};
    for (const item of job.items) {
      if (item.frame === "label") {
        results[item.id] = fitLabel(item.text, { box: job.labelBox, frame: frames.label, lineBreak: job.lineBreak, language: job.language, measureAt: labelMeasureAt });
      } else {
        results[item.id] = fitCaption(item.tokens, { box: job.captionBox, frame: frames.caption, kinsoku: job.lineBreak.kinsoku, measureAt: captionMeasureAt });
      }
    }
    out.textContent = JSON.stringify({ ok: true, results });
  } catch (e) {
    out.textContent = JSON.stringify({ ok: false, error: String(e && e.stack || e) });
  }
})();
</script></body></html>`;
}

function decodeEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

/** Chạy Chrome trên trang đo và trả kết quả. Throw (message tiếng Việt) nếu không chạy được. */
export function runMeasurePage(html, { chrome = findChrome(), timeoutMs = 45_000 } = {}) {
  if (!chrome) return Promise.reject(new Error("Không tìm thấy Chrome để đo chữ (đặt CHROME_PATH hoặc chạy `npx hyperframes browser ensure`)."));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acv-fit-"));
  const page = path.join(dir, "measure.html");
  fs.writeFileSync(page, html);
  const args = [
    "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files",
    `--user-data-dir=${path.join(dir, "profile")}`, "--virtual-time-budget=20000", "--dump-dom", pathToFileURL(page).href,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    const timer = setTimeout(() => { child.kill(); }, timeoutMs);
    child.stdout.on("data", (b) => { stdout += b; });
    child.stderr.on("data", (b) => { stderr += b; });
    child.on("error", (e) => { clearTimeout(timer); cleanup(); reject(new Error(`Không chạy được Chrome để đo chữ: ${e.message}`)); });
    child.on("close", () => {
      clearTimeout(timer);
      cleanup();
      const m = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
      if (!m) return reject(new Error(`Chrome không trả kết quả đo chữ.${stderr ? ` ${stderr.slice(0, 200)}` : ""}`));
      let parsed;
      try { parsed = JSON.parse(decodeEntities(m[1])); } catch { return reject(new Error(`Kết quả đo chữ không đọc được: ${m[1].slice(0, 80)}`)); }
      if (!parsed.ok) return reject(new Error(`Đo chữ thất bại: ${parsed.error}`));
      resolve(parsed.results);
    });
  });
}
