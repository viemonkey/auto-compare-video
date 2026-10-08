#!/usr/bin/env node
// Kiểm tra bố cục chữ của 1 video ĐÃ DỰNG (videos/<slug>/index.html) bằng Chrome thật: chữ có tràn khung không, font có nạp đủ không.
// Khác fit-check (đoán trước khi dựng): đây đo trên chính index.html cuối cùng.
//   node scripts/verify-video-layout.mjs videos/<slug>        (thoát mã 1 nếu có vi phạm)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { findChrome } from "./lib/browser-fit.mjs";

// Chạy trong trang: đo mọi nhãn + mọi cụm caption (đang ẩn vẫn có layout), kiểm font đã nạp.
const PROBE = `
<script>
window.addEventListener("load", async () => {
  const out = document.createElement("pre");
  out.id = "verify-result";
  try {
    await document.fonts.ready;
    const faces = [...document.fonts].map((f) => ({ family: f.family, status: f.status }));
    const rectOfText = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
    const issues = [];
    const stats = { labels: [], phrases: 0, maxPhraseWidth: 0, minLeft: 1e9, maxRight: -1e9 };
    const zone = document.getElementById("caption-zone").getBoundingClientRect();
    for (const el of document.querySelectorAll(".lb-1")) {
      const col = el.parentElement.getBoundingClientRect();
      const t = rectOfText(el);
      stats.labels.push({ text: el.textContent, left: Math.round(t.left), right: Math.round(t.right), colLeft: Math.round(col.left), colRight: Math.round(col.right), height: Math.round(t.height), font: getComputedStyle(el).fontSize });
      if (t.left < col.left - 6 || t.right > col.right + 6) issues.push("Nhãn tràn cột: " + el.textContent);
      if (t.height > 112) issues.push("Nhãn quá cao (" + Math.round(t.height) + "px): " + el.textContent);
    }
    for (const ph of document.querySelectorAll(".cap-phrase")) {
      const spans = [...ph.querySelectorAll(".cap-wd")];
      if (!spans.length) continue;
      stats.phrases++;
      const left = Math.min(...spans.map((s) => s.getBoundingClientRect().left));
      const right = Math.max(...spans.map((s) => s.getBoundingClientRect().right));
      stats.maxPhraseWidth = Math.max(stats.maxPhraseWidth, right - left);
      stats.minLeft = Math.min(stats.minLeft, left);
      stats.maxRight = Math.max(stats.maxRight, right);
      if (left < zone.left + 20 || right > zone.right - 20) issues.push("Caption tràn khung: " + spans.map((s) => s.textContent).join(" "));
    }
    const unloaded = faces.filter((f) => f.status !== "loaded" && f.status !== "unloaded");
    for (const f of unloaded) issues.push("Font chưa nạp được: " + f.family + " (" + f.status + ")");
    out.textContent = JSON.stringify({ ok: true, issues, stats, faces });
  } catch (e) {
    out.textContent = JSON.stringify({ ok: false, error: String(e) });
  }
  document.body.appendChild(out);
});
</script>`;

export async function verifyVideoLayout(videoDir, { chrome = findChrome(), timeoutMs = 60_000 } = {}) {
  if (!chrome) throw new Error("Không tìm thấy Chrome (đặt CHROME_PATH).");
  const index = path.join(videoDir, "index.html");
  const html = fs.readFileSync(index, "utf8");
  // trang kiểm tra nằm CẠNH index.html để đường dẫn assets/ vẫn đúng; xoá ngay sau khi chạy
  const probe = path.join(videoDir, `index.__verify-${process.pid}.html`);
  fs.writeFileSync(probe, html.replace("</body>", () => `${PROBE}</body>`));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "acv-verify-"));
  try {
    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files", `--user-data-dir=${profile}`, "--window-size=1080,1920", "--virtual-time-budget=25000", "--dump-dom", pathToFileURL(probe).href], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      let buf = "";
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout.on("data", (b) => { buf += b; });
      child.on("error", reject);
      child.on("close", () => { clearTimeout(timer); resolve(buf); });
    });
    const m = stdout.match(/<pre id="verify-result">([\s\S]*?)<\/pre>/);
    if (!m) throw new Error("Chrome không trả kết quả kiểm tra.");
    const res = JSON.parse(m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    if (!res.ok) throw new Error(res.error);
    return res;
  } finally {
    fs.rmSync(probe, { force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node scripts/verify-video-layout.mjs videos/<slug>");
    process.exit(2);
  }
  const r = await verifyVideoLayout(path.resolve(dir));
  console.log(JSON.stringify({ stats: r.stats, faces: r.faces, issues: r.issues }, null, 2));
  if (r.issues.length) {
    console.error(`\n✖ ${r.issues.length} vi phạm:\n- ${r.issues.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\n✔ Chữ nằm gọn trong khung, font đã nạp.");
}
