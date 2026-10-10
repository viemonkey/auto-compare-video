// Các bước cơ học dựng project HyperFrames cho video sản phẩm (chép từ scripts/scaffold-compare-video.mjs để chế độ so sánh giữ nguyên 100%).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./config.mjs";
import { describeSpawnError } from "../media-binaries.mjs";
import { fitItems } from "../fit-check.mjs";
import { overflowMessage } from "../../../public/shared/text-fit.mjs";

export function run(command, args, cwd, label) {
  console.log(`\n[${label}] ${command} ${args.join(" ")}  (cwd: ${cwd})`);
  const res = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (res.error) throw new Error(`${label}: ${describeSpawnError(res.error, command)}`);
  if (res.status !== 0) throw new Error(`${label} thất bại (exit ${res.status}).`);
}

export function runScaffoldMjs(slug) {
  const script = path.join(REPO_ROOT, ".claude", "skills", "create-video", "scripts", "scaffold.mjs");
  if (!fs.existsSync(script)) throw new Error(`Không tìm thấy ${script} — cần script scaffold.mjs của skill create-video.`);
  run(process.execPath, [script, slug], REPO_ROOT, "scaffold.mjs (create-video skill)");
}

const editPkg = (target, fn) => {
  const pkgPath = path.join(target, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  fn(pkg);
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
};

/** check cần --timeout dài vì composition nạp nhiều ảnh; render --workers=1 vì ảnh pose là raster-in-SVG (xem scaffold-compare-video.mjs). */
export function patchPackageScripts(target) {
  editPkg(target, (pkg) => {
    if (pkg.scripts?.check) pkg.scripts.check = pkg.scripts.check.replace(/npx --yes hyperframes@([\d.]+) check$/, "npx --yes hyperframes@$1 check --timeout=20000");
    if (pkg.scripts?.render && !/--workers=/.test(pkg.scripts.render)) pkg.scripts.render = pkg.scripts.render.replace(/(npx --yes hyperframes@[\d.]+ render)/, "$1 --workers=1");
  });
}

export function overrideFromTemplates(target) {
  for (const f of ["sync-channel.mjs", "generate-vo.mjs"]) {
    const src = path.join(REPO_ROOT, "templates", "auto-compare", f);
    if (!fs.existsSync(src)) throw new Error(`Không tìm thấy ${src}.`);
    fs.copyFileSync(src, path.join(target, "scripts", f));
  }
}

export function patchGenerateVoLines(target, lines) {
  const voPath = path.join(target, "scripts", "generate-vo.mjs");
  const src = fs.readFileSync(voPath, "utf8");
  const entries = lines.map((l) => `  { id: "${l.id}", text: ${JSON.stringify(l.text)} },`).join("\n");
  const patched = src.replace(/const LINES = \[[\s\S]*?\n\];/, `const LINES = [\n${entries}\n];`);
  if (patched === src) throw new Error(`Không tìm thấy khối "const LINES = [...]" trong ${voPath}.`);
  fs.writeFileSync(voPath, patched);
}

/**
 * Kế hoạch chữ phụ đề: gom cụm + cỡ chữ (đo bằng Chrome + font thật). Không có nhãn 2 ảnh như video so sánh nên chỉ đo caption.
 * @returns {Promise<{ok:boolean, measuredBy:string, phrases:Record<number,Array<[number,number]>>, issues:Array<{where:string,message:string}>}>}
 */
export async function planCaptions(lines, words, locale) {
  const items = lines.map((l) => ({ id: `line-${l.n}`, frame: "caption", tokens: words[l.id].map((w) => String(w.t)) }));
  const { measuredBy, results } = await fitItems(items, locale, {});
  const issues = [];
  const phrases = {};
  for (const l of lines) {
    const r = results[`line-${l.n}`];
    if (!r.ok) issues.push({ where: `câu ${l.n} “${l.text.slice(0, 40)}”`, message: overflowMessage("caption") });
    phrases[l.n] = r.groups.map((g) => [g.indices.length, g.fontPx === locale.layout.caption.fontPx ? 0 : g.fontPx]);
  }
  return { ok: issues.length === 0, measuredBy, phrases, issues };
}

/** Chép ảnh pose HuyK đã dùng vào video (renderer chỉ nạp file nằm trong thư mục video). */
export function copyUsedPoses(target, scenes) {
  const srcDir = path.join(REPO_ROOT, "assets", "actions");
  const dstDir = path.join(target, "assets", "actions");
  fs.mkdirSync(dstDir, { recursive: true });
  const used = [...new Set(scenes.filter((s) => s.kind === "pose" && s.pose).map((s) => s.pose))];
  for (const id of used) {
    const src = path.join(srcDir, `${id}.svg`);
    if (!fs.existsSync(src)) throw new Error(`Không có ảnh pose "${id}" trong assets/actions/.`);
    fs.copyFileSync(src, path.join(dstDir, `${id}.svg`));
  }
  return used;
}
