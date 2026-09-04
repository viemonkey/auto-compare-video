# DESIGN.md — "So Sánh Kiến Thức" template

> ## ⚠️ Cập nhật 2026-09-04 — pipeline `auto-compare` KHÔNG còn theo tài liệu này
>
> Video sinh qua `scripts/scaffold-compare-video.mjs` + `templates/auto-compare/` giờ bám bố
> cục "v2": tiêu đề 2 khái niệm cố định TRÊN 2 ảnh, caption karaoke word-by-word ở khe giữa
> ảnh và host. **Nguồn sự thật cho bố cục đó là `templates/auto-compare/README.md`**, không
> phải các mục bên dưới.
>
> Các mục dưới đây đã LỖI THỜI với pipeline `auto-compare` (vẫn đúng cho 3 video cũ
> `thien-thach-vs-sao-bang`, `dev-vs-devops`, `kim-cuong-vs-than-da`):
>
> | Mục | Lỗi thời ở chỗ |
> | --- | --- |
> | Colors | Bảng màu nền indigo đậm `#0D0A1A` + pink/cyan đã đổi sang nền giấy `#f4f0e8` + vàng `#ffe600`, viền chữ đen. |
> | Layout (1080×1920) | Không còn badge VS, card không bo góc/không margin. Zone (bản "v2" 2026-09-04): **tiêu đề 2 khái niệm CỐ ĐỊNH `y 244–350` NẰM TRÊN** → 2 panel ảnh `y 360–732` (`420×372`) → **caption karaoke `y 744–840`** (chạy word-by-word, giữa ảnh và host) → host `y 866–1920`. Xem `templates/auto-compare/README.md`. |
> | Avatar asset pipeline | `object-fit: contain` trong khung 420×520 là SAI — làm host bé đi ~4 lần. Pose được đặt bằng transform tính từ kích thước đầu đã đo (`actions.json` field `frame`). Chỉ dùng `frame_class: "full"`. |
> | Background layer | Không còn glow pink/cyan hay ghost word — nền là marble jewelry-stand (`assets/backgrounds/marble-jewelry-stand.png`). |
> | Motion → Caption lines / Active-side emphasis | `.caption-line`/`.kw` cũ thay bằng caption karaoke `#caption-zone` (word boundary từ `assets/vo/words.json`, Edge TTS). Nhãn beat đổi động cũng bỏ — text theo beat do caption lo. Dim panel dùng `.card-veil` (đè đen), KHÔNG hạ opacity của `.card`. |
> | Rhythm | Không còn nhịp cố định 12 dòng; số dòng body do Gemini quyết (4–8 points). |
>
> Vẫn còn hiệu lực cho mọi video: Typography, Safe zone, và nguyên tắc "chỉ đổi nội dung,
> không đổi bố cục giữa các topic".

**Concept angle:** A fast-paced myth-busting showdown — two icons face off in a top-frame
split, a bold pink-accented caption calls the verdict line by line, and a host
physically points the answer home. Motion reads as a game-show buzzer round, not a lecture.

> **Avatar identity — three mechanisms exist today, pick by video name, not by date.** (There is
> no clean date boundary — see why below.)
> - **`thien-thach-vs-sao-bang`, `dev-vs-devops`:** a **flat 2D CSS/SVG robot host** —
>   `#avatar-host` built from plain `<div>`s, poses driven by GSAP `rotation`/`scale` tweens on
>   the arm divs, no image assets. This is what this document's `#avatar-host` 420×520 box
>   describes by default below.
> - **`kim-cuong-vs-than-da`:** a **pre-existing one-off exception**, built and rendered
>   2026-08-28 — already uses a real photo host (the "HuyK" jewelry-brand MC, same person whose
>   photos were later cropped into `assets/actions/`), but with its own bespoke full-bleed
>   `#avatar-host` (`top:720px; left:0; width:1080px; height:1200px` — **not** the 420×520 box,
>   overlaps into the caption zone) and direct `<img src>` swap (no crossfade). It predates and
>   diverges from this contract's avatar-zone geometry — **do not copy its layout into new
>   videos**, and don't read it as "the photo-host reference implementation."
> - **New videos** (using the `assets/actions/actions.json` pipeline introduced below): a
>   real-photo host swapped by pose inside the *standard* 420×520 `#avatar-host` box at
>   `top=1280,left=330` — see "Bottom — avatar zone" and "Avatar pose" under Motion.
>
> Everything else in this contract (3-zone layout, colors, typography, caption rhythm, safe zone)
> applies identically to all three. `kim-cuong-vs-than-da` is the one existing video whose avatar
> geometry doesn't match this document — it is not being retrofitted.

## Colors

| Token           | Value     | Use                                              |
| --------------- | --------- | ------------------------------------------------- |
| `--bg`          | `#0D0A1A` | Root background (deep indigo-black)              |
| `--panel`       | `#17122C` | Image card surface                               |
| `--panel-edge`  | `#2B2350` | Card border / hairline                            |
| `--fg`          | `#F3F1FF` | Primary text                                      |
| `--fg-dim`      | `#9089B0` | Secondary / inactive text                         |
| `--accent-pink` | `#FF4FA3` | Keyword highlight — the "difference" word         |
| `--accent-cyan` | `#37E6C4` | Topic names, VS badge accent, avatar zone ambient glow |

Dark, saturated background: tech/knowledge content stays legible, and the deep indigo bed makes
the pink keyword pop hardest against the cool cyan identity color. Two accent hues sit opposite
on the wheel (pink for emphasis, cyan for identity) — chosen as a deliberate departure from the
series' original red/gold palette so this generation of videos reads as visually distinct from
earlier public uploads of the same topics.

## Typography

- **Be Vietnam Pro, 900** — captions, topic names, VS badge. Geometric sans, heavy weight only
  (extreme weight contrast per house style), not on the banned-monoculture list. Replaces
  Montserrat: the compiler's pre-bundled embed for Montserrat only covers the "latin" unicode
  range, which drops Vietnamese tone-mark glyphs (U+1EA0-1EF9) and renders diacritics broken.
  Be Vietnam Pro is purpose-built for Vietnamese and must be embedded via explicit `@font-face`
  + `unicode-range` (vietnamese + latin subsets) in `<head>` — **not** a Google Fonts `<link>`
  (trips the `google_fonts_import` lint warning) and **not** left as a bare `font-family` name
  (silently falls back to the incomplete pre-bundled embed). See either video's `index.html`
  `<head>` for the exact `@font-face` block to copy.
- **JetBrains Mono, 700** — eyebrow tag (`#eyebrow`, text sourced from `CHANNEL` in the
  repo-root `.env` — see the `create-video` skill's `scripts/sync-channel.mjs`; default
  "SO SÁNH KIẾN THỨC"), small labels. Crosses the
  sans→mono boundary against Be Vietnam Pro (never pair two sans-serifs). Same embedding rule
  applies — JetBrains Mono also needs its "vietnamese" subset explicitly `@font-face`-embedded
  when it renders Vietnamese text (e.g. the eyebrow tag).
- Caption line size: 64px (well above the 20px in-feed floor — this is a 9:16 in-feed video).
  Topic name in cards: 44px. Eyebrow tag: 22px, uppercase, tracked +0.12em.

## Layout (1080×1920)

Three fixed horizontal zones — this split is the template's contract; only content inside
each zone changes between topics. All zone content is horizontally centered on the **canvas
center** (x=540) with symmetric left/right padding — see Safe zone below.

- **Top — comparison zone** (`y 64–824`, 760px): two image cards, 400×680 each, 40px gap,
  card-left at x=120, card-right at x=560 (right edge 960, symmetric 120px margins). A round
  VS badge (110px, left=485) sits centered on the seam, overlapping each card ~35px so it
  reads as attached, not floating.
- **Middle — caption zone** (`y 840–1300`, 460px): one caption line visible at a time,
  centered, max-width 860px, left=110 (symmetric 110px margins). Keyword spans get
  `--accent-pink`.
- **Bottom — avatar zone** (`y 1280–1920`, 640px): `#avatar-host` (top=1280, left=330,
  horizontally centered like every other zone), frame **420×520**. Top raised from the original
  y=1360 so the host's head/face clears the platform caption/username band — see Safe zone. Two
  mechanisms use this box (see "Avatar identity" note above — `kim-cuong-vs-than-da` uses
  neither, it has its own bespoke full-bleed geometry instead):
  - **New videos** (`assets/actions/actions.json` pipeline): a single `<img>` inside
    `#avatar-host` showing a real-photo host cutout (transparent background), one beat = one pose
    image swapped in from the shared `assets/actions/` library (see "Avatar asset pipeline"
    below) — no CSS body parts. `object-fit: contain` (not `cover`) — the source photos are a
    taller 2:3 crop than the 420×520 frame (~0.667 vs ~0.808 width/height), so `cover` crops the
    head or feet.
  - **`thien-thach-vs-sao-bang` / `dev-vs-devops`** (unchanged, historical): a flat CSS/SVG 2D
    robot host — rounded-rect head with a glowing antenna tip, an LED-style visor with two square
    eyes, a speaker-bar mouth, rectangular mechanical arms, and a glowing chest light on the
    torso. Arms swap rotation per beat (point-left / point-right / shrug / explain / neutral-hold).

### Avatar asset pipeline (new videos)

- Pose images live in the **shared, repo-root** `assets/actions/` — not per-video — because
  they're reused across every new video's host. Each video's scaffold step copies the poses it
  needs into `videos/<slug>/assets/` (same pattern as `scripts/sync-channel.mjs` /
  `scripts/generate-vo.mjs` being copied from a reference project, per `AGENTS.md`).
- `assets/actions/actions.json` is the label index — one entry per pose file: `id`, `file`,
  `emotion`, `tags`, `use_case`, and for pose pairs shot back-to-back at a near-identical angle,
  `variant_of` (pick either — they're interchangeable). Some poses carry `"prop": "jewelry"` —
  restricted to jewelry/gem-themed topics (e.g. `kim-cuong-vs-than-da` and future ones), not for
  general use. Consult `use_case` before wiring a pose to a beat.
- Files are `.svg` in name only — each is a raster photo (PNG) wrapped in an SVG `<mask>`
  container (no vector paths), ~46–108KB. They render fine as `<img src="...svg">` but carry no
  recolorable strokes/fills — don't expect them to pick up `--accent-*` via CSS.
- `assets/backgrounds/` (shared, repo-root, currently empty) is reserved for background theme
  variants (dark space / gradient / minimal…) — not yet wired into any video.

## Safe zone (platform UI overlays)

TikTok/Reels/FB in-feed chrome overlays the raw 1080×1920 frame: an engagement-icon rail near
the right edge and a caption/username/progress-bar band at the bottom. Fix this with symmetric
padding and vertical clearance, not by shifting the composition's horizontal center — an
off-center layout reads as broken on any device/platform that *doesn't* show that overlay.

| Constant        | Value  | Meaning                                                          |
| ---------------- | ------ | ------------------------------------------------------------------ |
| `SAFE_MARGIN`     | 120px  | Minimum clearance from both the left and right edge (symmetric)    |
| `SAFE_BOTTOM`     | 380px  | Clearance from the bottom edge (caption/username/progress band)    |
| horizontal center | 540    | Raw canvas center — every zone stays centered here                 |

Only the avatar's head/upper body must clear `SAFE_BOTTOM` (y ≥ 1540 is unsafe) — the lower
torso/hands may bleed under the platform band since they carry no readable information. Card
icon internals that use fixed pixel offsets (not `%`/`translateX(-50%)` centering) must be
re-checked for overflow whenever card width changes; icons built via grid `place-items:center`
with no `top`/`left` adapt automatically.

## Background layer

- Soft `--accent-pink` radial glow behind the VS badge, low opacity, gentle breathing pulse
  (finite repeat).
- Ghost eyebrow word ("SO SÁNH") oversized at 4% opacity behind the caption zone, static.
- Soft `--accent-cyan` glow behind the avatar's head, gentle breathing pulse, phase-opposed
  to the top glow (per `sine-wave-loop` phase-opposition rule).

## Motion

- **Image cards**: `spring-pop-entrance` (scale 0→1, `power3.out`, ~0.5s), staggered ~0.15s
  left-then-right. VS badge pops ~0.3s after on `spring-pop-entrance` (small hero pop).
- **Caption lines**: one line visible per beat window; each enters with `spring-pop-entrance`
  (y:24→0 + fade, `power3.out`, 0.35s) and exits with a fast fade+lift
  (`power2.in`, 0.2s) before the next line pops. Keyword spans get a quick color-set +
  scale-punch (1→1.15→1, 0.25s) timed to the line's entrance — a simplified,
  line-level cousin of `asr-keyword-glow` (no continuous per-word envelope; this is a
  30-40s fast-cut format, not a lyric-video read).
- **Avatar pose** — mechanism depends on the video (see "Avatar identity" note at top):
  - **Photo host (new videos, `assets/actions/actions.json` pipeline):** one pose per beat,
    swapped by changing the `<img src>` on a fixed 0.15–0.2s crossfade (`power1.inOut`) timed to
    the beat's VO start — no rotation/scale tween on the image itself (source photos aren't
    rigged for that). Pick the pose id from `assets/actions/actions.json` whose `use_case`
    matches the beat (hook → `point-up-left`/`point-up-right`, nút thắt → `shrug-a`/`thinking`, reveal →
    `point-up-left`/`point-up-right`/`explain-a`, payoff → `thumbs-up-a`). Pointing at a
    card is **only** `point-up-left` (left) / `point-up-right` (right) — reuse them across
    beats rather than adding near-duplicate point variants. (2026-09-04: HuyK photo set
    re-drawn, `offer-b` dropped — catalog is 9 poses: `confused, explain-a, explain-b,
    point-up-left, point-up-right, shocked-a, shrug-a, thinking, thumbs-up-a`.)
  - **CSS robot (`thien-thach-vs-sao-bang` / `dev-vs-devops`, unchanged):** discrete rotation
    tweens per beat, `power3.out`, ~0.3s — point-left, point-right, shrug (both arms up+out),
    explain (one arm lower, open palm), neutral (arms at rest) for the outro hold.
  - `kim-cuong-vs-than-da` uses a third, bespoke mechanism (direct `<img src>` swap, no
    crossfade, full-bleed frame) predating this pipeline — not documented here as a reusable
    pattern.
- **Active-side emphasis**: during Giải A / Giải B, the inactive card dims to 55% opacity +
  scales to 0.96; the active card stays at full opacity/scale — directs the eye without a
  camera move (`camera-static` — the split symmetry is the subject early, but attention
  shifts once the verdict starts).

## Rhythm

Target total: **30–40s** per video (raised from the original 15-20s demo — more room per
concept). Timing is VO-driven (real TTS clip durations, not fixed beat-seconds — see the
`create-video` skill's timing-gap formula), but the beat *order* and *line budget* are fixed:

`hook(2 dòng) → question(1 dòng) → reveal-A(3 dòng) → reveal-B(3 dòng) → so-sánh-trực-tiếp(2 dòng) → payoff-hold(1 dòng)`
≈ 12 dòng thoại. `reveal-A`/`reveal-B` each grew from 2 lines to 3 (definition, key trait, one
concrete example/analogy per side) and a new side-by-side contrast beat (`so-sánh-trực-tiếp`)
sits right before the verdict — that's where the extra 15-20s of runtime goes, not into slower
pacing. Energy: punchy open, a beat of pause at the question, two deeper reveal holds, a settled
payoff dwell (≥1s per the climax-dwell rule). If the natural total falls short of 30s, add
another sentence or example line — never stretch inter-line gaps to pad time (that breaks the
fast-cut house style). No shader transitions — this is one continuous scene, not scene cuts;
all beats are internal phase changes on one timeline.

## Do's and don'ts

- Do keep the 3-zone layout byte-for-byte identical across topics — only text, image
  content, and the two card images change when this becomes a real template instance.
- Do keep keyword-pink reserved for the *difference*, not the topic names (topic names use
  cyan) — the color coding itself teaches the viewer where to look.
- Do keep every zone's content within the safe zone (above) — centered on x=540 with symmetric
  `SAFE_MARGIN` on both sides, avatar head clear of `SAFE_BOTTOM`.
- Don't add a 4th zone or reorder the three zones — the format's recognizability depends on
  the fixed vertical stacking (top comparison → middle caption → bottom avatar). Raising the
  avatar zone's top offset to respect `SAFE_BOTTOM` is a safe-zone fit, not a reorder.
- Don't animate more than one caption line at a time — line-by-line, never word-by-word
  (this is a fast format, not a karaoke lyric video).
- Do pick photo-host poses by `use_case` in `assets/actions/actions.json`, not by filename guess
  — some poses are visually similar (the `*-a`/`*-b` variant pairs). For pointing at a card
  there is exactly one option per side: `point-up-left` / `point-up-right`.
- Don't retrofit the `assets/actions/actions.json` photo-host pipeline onto
  `thien-thach-vs-sao-bang`, `dev-vs-devops`, or `kim-cuong-vs-than-da`, and don't add CSS-robot
  poses to new videos — avatar mechanisms don't mix within one video.
- Don't copy `kim-cuong-vs-than-da`'s avatar geometry (full-bleed `#avatar-host`, direct `<img
  src>` swap) into new videos — it's a pre-existing exception built 2026-08-28, before this
  pipeline existed, not a second reference implementation.
