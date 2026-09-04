# pose-calibration/

Reference tooling for placing the host poses (`assets/actions/*.svg`) in the
template. Not part of the render.

## Current strategy — SHARED PLACEMENT (v5, 2026-08-31)

Every pose renders at **one shared `{ x, y, scale }`** (`const HOST_BASE` in
`templates/auto-compare/index.html`). The 24 source photos are all
bottom-aligned (person reaches the frame bottom), so a single `y` keeps every
waist planted and the body does **not** grow/shrink between beats when the video
plays. Heads land ~50–75px apart in height / ~15% in size, following each
photo — an accepted trade for a still body in motion.

`POSE_ADJUST` holds **x/y nudges only** (never scale) for any pose whose body
sits far off-centre or whose reach clips. As of 2026-09-01 it is **empty** — the
only two poses that needed it (`point-left-far` / `point-right-far`) were
removed. Add an entry only if a new pose clips at `HOST_BASE`.

### To retune

1. Edit `HOST_BASE` / `POSE_ADJUST` directly in `index.html`.
2. Screenshot a spread of poses (or diff against `motion-preview/v5-contact-sheet.png`).
3. Mirror the values into `assets/actions/actions.json` → `pose_adjust`.
4. `motion-preview/v4-vs-v5.mp4` — side-by-side of the old per-pose-scale (v4)
   vs shared (v5) placement, hard-cut through a 10-pose sequence, to feel the
   motion difference. Regenerate by screenshotting both and `hstack`-ing.

## Files

| file | what |
| --- | --- |
| `measure-grid.html` | browser → 24 cells, each SVG on a viewBox-300 coord grid. Read `head_top` (crown), `chin`, `cx` (head centre) per pose — reference only now. |
| `norm.mjs` | **v4 head-anchor calculator — SUPERSEDED.** Kept for the measured `M` head-box table + as a record of the per-pose-scale approach that caused the motion pulse. Do not wire its output back in. |
| `normsheet.html` | v4 verification contact sheet — static-comparison only, misleading for motion. |
| `pose_adjust.json` | last v4 output (stale). |
| `motion-preview/` | v5 contact sheet + the v4-vs-v5 motion clip. |

## Why v4 was dropped

v4 scaled each pose by `88 / head_h` (0.85–1.22) to lock head size + crown Y.
Side-by-side stills looked perfectly uniform, but in continuous playback the
**whole body ballooned/shrank** on every pose change (e.g. `shrug-a` → ×1.22,
`explain-a` → ×0.9). A moving "zoom" on the host reads worse than a head that bobs a
little over a planted body. v5 fixes scale for everyone and accepts the head
variance.
