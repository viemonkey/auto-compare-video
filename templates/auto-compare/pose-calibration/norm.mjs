import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const OUT = path.dirname(fileURLToPath(import.meta.url)); // writes pose_adjust.json next to this file

// Visual measurements from the coordinate-grid contact sheet (viewBox 300 units).
// head_top = crown Y, chin = chin Y, cx = head centre X.
// 2026-09-04: HuyK photo set re-drawn (7 poses), offer-b dropped -> 9 poses.
// The re-drawn poses' numbers below are eyeball estimates (actions.json "measured": false) —
// regenerate the coordinate-grid contact sheet from the new SVGs and re-measure before trusting.
const M = {
  "confused":        { top: 6,  chin: 92,  cx: 150 },
  "explain-a":       { top: 13, chin: 98,  cx: 150 },
  "explain-b":       { top: 12, chin: 96,  cx: 148 },
  "point-up-left":   { top: 18, chin: 110, cx: 141 },
  "point-up-right":  { top: 18, chin: 108, cx: 126 },
  "shocked-a":       { top: 8,  chin: 92,  cx: 138 },
  "shrug-a":         { top: 8,  chin: 90,  cx: 140 },
  "thinking":        { top: 12, chin: 96,  cx: 140 },
  "thumbs-up-a":     { top: 5,  chin: 92,  cx: 132 },
};

// ---- template geometry ----
const IMG_PX = 1080;             // .host-avatar-img width/height (2026-09-04: full frame width so host chạm viền dưới)
const VB = 300;                  // svg viewBox
const U = IMG_PX / VB;           // px per viewBox unit  (3.6)
const IMG_LEFT_LOCAL = (1080 - IMG_PX) / 2; // 0  (#host-fx local x of img left edge)
const IMG_TOP_LOCAL = -26;       // .host-avatar-img top (đáy ảnh trùng mép dưới khung)
const ORIGIN_X = IMG_LEFT_LOCAL + IMG_PX / 2; // 540  (transform-origin 50%)
const ORIGIN_Y = IMG_TOP_LOCAL;              // 8    (transform-origin 0)

// ---- normalization targets ----
const TARGET_HEAD_H_VB = 88;     // crown->chin, viewBox units (median) -> on screen ~ 88*U = 267px
const TARGET_CROWN_LOCAL = 46;   // #host-fx-local y of the crown after transform
const TARGET_CX_VB = 150;        // head centre -> canvas centre
const CX_OVERRIDE = {            // poses where a fully-centred head throws the gesture off-frame
};
const SCALE_OVERRIDE = {
};
// small manual y correction (px, +down) for poses whose crown estimate ran low
const Y_NUDGE = {
  "thinking": -10, "explain-b": -4,
};

const out = {};
for (const [id, m] of Object.entries(M)) {
  const headH_vb = m.chin - m.top;
  const scale = +(SCALE_OVERRIDE[id] ?? (TARGET_HEAD_H_VB / headH_vb)).toFixed(4);
  const cy0 = IMG_TOP_LOCAL + m.top * U;                 // native crown, host-fx-local
  const cx0 = IMG_LEFT_LOCAL + m.cx * U;                 // native head centre X, host-fx-local
  const targetCx = (CX_OVERRIDE[id] ?? TARGET_CX_VB);
  // py' = ORIGIN_Y + (py-ORIGIN_Y)*scale + y   ->  solve y for py=cy0, py'=TARGET_CROWN_LOCAL
  const y = Math.round(TARGET_CROWN_LOCAL - (ORIGIN_Y + (cy0 - ORIGIN_Y) * scale) + (Y_NUDGE[id] ?? 0));
  // px' = ORIGIN_X + (px-ORIGIN_X)*scale + x  ->  want head centre at canvas-x = IMG_LEFT_LOCAL + targetCx*U
  const wantCx = IMG_LEFT_LOCAL + targetCx * U;
  const x = Math.round(wantCx - (ORIGIN_X + (cx0 - ORIGIN_X) * scale));
  out[id] = { x, y, scale: +scale.toFixed(3) };
}

fs.writeFileSync(OUT + "/pose_adjust.json", JSON.stringify(out, null, 2));

// pretty print + JS block
console.log("pose".padEnd(17), "x     y     scale   (headH_vb -> scale)");
const js = ["      const POSE_ADJUST = {"];
for (const [id, a] of Object.entries(out)) {
  const hh = M[id].chin - M[id].top;
  console.log(id.padEnd(17), String(a.x).padStart(5), String(a.y).padStart(5), String(a.scale).padStart(6), `   (${hh} -> ${a.scale})`);
  js.push(`        ${JSON.stringify(id + ":").padEnd(20)} { x: ${String(a.x).padStart(4)}, y: ${String(a.y).padStart(4)}, scale: ${a.scale.toFixed(3)} },`);
}
js.push("      };");
fs.writeFileSync(OUT + "/pose_adjust_block.txt", js.join("\n"));
console.log("\n" + js.join("\n"));

// ready-to-open verification sheet with the JSON injected
try {
  const tpl = fs.readFileSync(OUT + "/normsheet.html", "utf8");
  fs.writeFileSync(OUT + "/normsheet_r.html", tpl.replace("JSON_PLACEHOLDER", JSON.stringify(out)));
  console.log("\nopen pose-calibration/normsheet_r.html to verify");
} catch {}
