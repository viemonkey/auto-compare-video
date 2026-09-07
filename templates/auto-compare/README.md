# templates/auto-compare/

Đây là **template nguồn** cho pipeline "Auto Compare Video" — KHÔNG phải một video đã xuất bản,
không xuất hiện trong bảng "Các video hiện có" ở README root, không tự chạy được (`npm run dev`
sẽ lỗi vì thiếu `assets/vo/`, `assets/images/`, `assets/actions/`).

`index.html` ở đây là bộ khung tĩnh + token placeholder (`__TEN_TOKEN__`) và 4 marker khối
(`<!--AUDIO_TAGS-->`, `/*CAPTIONS_OBJECT*/`, `/*VO_OBJECT*/`, `/*TIMELINE_BEATS*/`) — được
`scripts/scaffold-compare-video.mjs` đọc và điền nội dung thật vào mỗi khi tạo 1 video mới ở
`videos/<slug>/`. Không sửa file này bằng cách gõ nội dung thật vào — sửa `index.html` của
video đã tạo ra (`videos/<slug>/index.html`), giữ file template này chỉ chứa placeholder.

`generate-vo.mjs` ở đây là **bản canonical** cho pipeline auto-compare (word boundary →
`assets/vo/words.json` cho caption karaoke + trim silence theo word boundary). Scaffold copy
đè lên bản generic mà skill `create-video` chép sẵn.

Đổi layout/CSS ở đây sẽ ảnh hưởng **mọi video tạo ra sau này** qua pipeline này — không ảnh
hưởng video đã tạo trước đó (đã copy nội dung tĩnh vào `index.html` riêng của chúng).

## Layout — bám video mẫu viesnap.vn (cập nhật 2026-09-04, "v2": tiêu đề trên ảnh + caption karaoke)

Bản trước: nhãn beat 2 dòng NẰM DƯỚI ảnh, không có phụ đề câu. Bản hiện tại (port từ
`videos/nhan-vang-vs-vang-trang-v2/`):

- **Tiêu đề 2 khái niệm CỐ ĐỊNH nằm TRÊN mỗi ảnh** (`#lb-fixed`, 1 cặp tĩnh suốt video,
  chèn thẳng bằng `__LABEL_LEFT__` / `__LABEL_RIGHT__` — không đổi theo beat).
- **Caption karaoke chạy word-by-word ở khe giữa ảnh và host** (`#caption-zone`), timing từ
  `assets/vo/words.json` (Edge TTS word boundary). Đây là nơi tải toàn bộ text theo từng beat
  (kể cả hook / câu hỏi / payoff) — không còn nhãn beat đổi động.

| Zone | Vị trí (khung 1080×1920) | Ghi chú |
| --- | --- | --- |
| Tiêu đề card | `#label-zone` `y 244–350`; `.lb-left left:72` / `.lb-right left:564`, rộng 444 | Dưới vạch crop TikTok (~y230), trên `.card` (y360). `.lb-1` 46px vàng, in nghiêng, uppercase. Cố định — fade in 1 lần cùng card. |
| 2 panel ảnh | `y 360–732`, `#card-left left:96` / `#card-right left:564`, `420×372`, seam 48px, lề ngoài 96px | `object-fit:cover`. `.card-veil` làm tối panel không được nhắc tới — **không** hạ `opacity` của `.card`. |
| Caption karaoke | `#caption-zone` `y 744–840`, rộng `left:40 w:1000` | Cụm ≤4 từ / dòng, hard-swap từng cụm; từ đang đọc → `--cap-active` + scale 1.13. `chunkPhrases` + `showCaption` (tĩnh trong template), object `CAPTIONS` do scaffold sinh từ `words.json`. |
| Host | `#avatar-host` `y 866–1920`, full width | Xem mục dưới. Người đứng chạm mép dưới là bình thường. Pose chỉ tay: chỉ `point-up-left` (trái) / `point-up-right` (phải) — cả 2 vừa khung ở HOST_BASE, `POSE_ADJUST` rỗng. |
| `#eyebrow` | `top:44 left:64` (trong lề 64px) | Giữ nguyên id — `scripts/sync-channel.mjs` sẽ throw nếu không tìm thấy. |

> `.lb-wide` / `.lb-2` / `.lb-tight*` trong CSS là di sản của bản cũ, giờ không dùng — giữ lại
> phòng khi cần khối tiêu đề rộng.

## Chuẩn hoá pose host — đọc trước khi đụng vào (cập nhật 2026-08-31, SHARED PLACEMENT v5)

Bộ `assets/actions/*.svg` (thay mới 2026-08-30): raster nhúng trong SVG **canvas VUÔNG 300×300
(1:1)**, crop waist-up, **cả 24 ảnh đều bottom-aligned** (silhouette chạm đáy khung). Các ảnh
chụp cự ly hơi khác nhau: `head_h` (đỉnh đầu→cằm) trải ~72–103 vb-unit, đỉnh đầu trải ~10–33.

**v4 đã thử chuẩn hoá theo đầu** (scale riêng mỗi pose = 88/head_h → 0.85–1.22) — đầu đứng yên
tuyệt đối khi so ẢNH TĨNH, NHƯNG khi xem VIDEO chạy thì THÂN nhân vật phồng/co mỗi lần đổi pose
→ giật rất khó chịu. **v5 đổi chiến lược: ưu tiên thân ổn định khi chuyển động.**

- `.host-avatar-img` nền = **`1080×1080`** (2026-09-04: đúng bề ngang khung để host chạm viền
  dưới), canh giữa (`left:50%; margin-left:-540px`), `top:-26px` (đáy ảnh trùng mép dưới khung,
  `#avatar-host{overflow:hidden}` cắt 26px tràn lên). `transform-origin: 50% 0`. Giữ
  `width === height` (SVG 1:1, méo nếu lệch).
- `const HOST_BASE` (trong `index.html`) = **1 giá trị `{ x, y, scale }` DUY NHẤT** áp cho MỌI
  pose (hiện `{ x:20, y:0, scale:1.0 }`). Vì 24 ảnh đều bottom-aligned, 1 giá trị y giữ eo mọi
  pose ở cùng chỗ → thân KHÔNG "nhảy" giữa các beat khi video chạy.
- **Đánh đổi:** đầu cao/thấp lệch ~50–75px + kích thước lệch ~15% giữa các pose (theo khung
  hình gốc từng ảnh). Chấp nhận — người xem nhìn thân "đứng yên" tự nhiên hơn là đầu khoá cứng
  mà thân co giãn. KHÔNG re-introduce scale riêng theo pose.
- `const POSE_ADJUST` = **CHỈ nudge x/y (không bao giờ scale)** cho pose lệch tâm nặng / bị cắt
  tay ở HOST_BASE. **Từ 2026-09-01: RỖNG** — 2 pose từng cần (`point-left-far` / `point-right-far`)
  đã bị bỏ, mọi pose giờ dùng thẳng HOST_BASE. `poseFor()` khoá scale = `HOST_BASE.scale`.
- `assets/actions/actions.json` → `frame` (head-box đo tay) giờ chỉ để THAM KHẢO khi cân nhắc
  ngoại lệ; `pose_adjust` phản ánh HOST_BASE + 2 ngoại lệ.
- Preview chuyển động (so v4 vs v5): `pose-calibration/motion-preview/v4-vs-v5.mp4`.
- Đo lại: `pose-calibration/README.md` (`measure-grid.html` để đọc head-box; `botcheck` xác
  nhận bottom-aligned). Chỉnh HOST_BASE/POSE_ADJUST trực tiếp trong `index.html` rồi đồng bộ
  `actions.json`.
- Pipeline auto-compare **chỉ dùng pose có `frame.frame_class: "full"`** trong `actions.json` —
  cờ này chỉ còn nghĩa "pose dùng được", KHÔNG còn nghĩa "cữ toàn thân". Biến thể
  phụ `*-alt` cố tình bỏ cờ để đứng ngoài. Bộ lọc ở `loadActionCatalog()` trong
  `scripts/generate-compare-content.mjs` + `/api/actions` trong `server.mjs`.
- **Chỉ tay trái/phải — chuẩn 2026-09-01**: chỉ `point-up-left` / `point-up-right`. Đã bỏ
  `point-up-a/b`, `point-left-far/point-right-far`. Nhiều beat cùng hướng thì tái dùng lại,
  không giữ pose gần giống để đa dạng.
- Id cũ mất ảnh (`point-left-far`, `point-right-far`, `point-up-a`, `point-up-b`,
  `point-right-near`, `walk`, `inspect-gem`, `present-ring`, `show-item`, `present-clipboard`)
  → xem `assets/actions/actions.json` § `removed_actions`. `scaffold-compare-video.mjs` có
  `POSE_DOWNGRADE` map các id đó cho `--content` cũ (pose chỉ tay → `point-up-left/right`).

## Nền (`#root` backdrop) — cập nhật 2026-09-07

Ảnh marble trưng nhẫn (`marble-jewelry-stand.png`) đã thay bằng
`assets/backgrounds/paper-crumpled.webp` — giấy trắng nhàu, nền **sáng**, trung tính về chủ
đề. Vẫn vẽ trực tiếp trên `#root` (`background-size: cover`). Ảnh đã là 1080×1920, đúng bằng
khung, nên `cover` hiển thị 1:1 không crop/letterbox.

- Nguồn: `assets/backgrounds/pexels-photo-20818860.avif` (2480×3508, tỉ lệ A4). Chuyển bằng
  `ffmpeg -i pexels-photo-20818860.avif -vf "crop=1972:3508,scale=1080:1920:flags=lanczos" \
  -quality 88 paper-crumpled.webp` — crop giữa về 9:16 rồi hạ cỡ (~154 KB). Giữ WebP thay vì
  dùng thẳng AVIF cho nhẹ và chắc chắn Chromium headless của renderer đọc được.
- **Không đổi vị trí** card/label/host — chỉ đổi backdrop. Backdrop này SÁNG (góc trên đọc ra
  ~`#f5f4f6`, đó cũng là `--bg-fallback` mới): tiêu đề/label/caption đều đã có
  `-webkit-text-stroke` đen dày nên vẫn đọc được, nhưng `#eyebrow` phải đổi từ `#f2ead8` (màu
  cho nền navy đậm của ảnh marble) về mực đậm `#2f2b26` + quầng trắng nhẹ.
- `scripts/scaffold-compare-video.mjs` có `copyBackground()` copy file này vào
  `videos/<slug>/assets/backgrounds/` mỗi lần dựng video mới (giống cách `assets/actions/` /
  `assets/images/` được copy) — **đổi tên/đường dẫn ảnh thì phải sửa cả `BACKGROUND_FILE`
  trong scaffold lẫn `url(...)` trong `index.html`**, không chỉ 1 chỗ.
- Đây vẫn là **1 backdrop cố định dùng chung cho MỌI topic** qua pipeline này. Ảnh giấy trung
  tính hơn ảnh trang sức cũ nên hợp mọi chủ đề (công nghệ, thiên văn, thể thao…); cơ chế chọn
  ảnh nền theo topic vẫn chưa làm.
- Các video đã dựng trước 2026-09-07 (`nhan-vang-vs-nhan-kim-cuong`, `nhan-vang-vs-vang-trang-v2`,
  `ronaldo-vs-messi`, `vang-vang-vs-vang-trang-v3`) giữ nguyên bản marble trong
  `assets/backgrounds/` của chúng — thay đổi này chỉ áp cho template và video dựng mới.

## Player xem thử

`#hf-standalone-player` bị `display:none` và chỉ bật khi URL có `?preview`
(vd `videos/<slug>/index.html?preview=1`). Không có cổng này thì thanh player bị chụp thẳng
vào từng frame của MP4 — đã xảy ra với các bản render trước 2026-08-30. Renderer luôn nạp file
trần nên không bao giờ dính. Nếu UI web sinh `previewUrl`, nhớ nối thêm `?preview=1`.

Xem `DESIGN.md` ở root repo cho hợp đồng màu/font đầy đủ.
