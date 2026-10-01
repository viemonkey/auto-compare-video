# Đăng Reels lên Facebook tự động

Video render xong (`output/<slug>.mp4`) tự vào hàng đợi `data/social-queue.json`. Mỗi phút server
xét hàng đợi và đăng **mỗi video lên đúng 1 page**, chọn ngẫu nhiên trong các page đã nghỉ đủ
`FB_POST_MIN_GAP_MINUTES`–`FB_POST_MAX_GAP_MINUTES` kể từ lần đăng gần nhất của chính page đó.
Sau khi Facebook báo Reel publish xong, server đặt ảnh bìa (frame ngẫu nhiên giữa một segment pose).

## 1. Lấy Page Access Token không hết hạn

1. Vào [Graph API Explorer](https://developers.facebook.com/tools/explorer/), chọn Facebook App
   (loại Business) của bạn.
2. **User or Page** → User → **Get User Access Token**, tick `pages_show_list`,
   `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement` → Generate.
3. Đổi sang long-lived user token: mở
   [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/) → dán token →
   **Extend Access Token**.
4. Trong Explorer, dùng token vừa extend, gọi `GET /me/accounts`. Mỗi page trả về `id` và
   `access_token` riêng. **Page token sinh từ long-lived user token không có hạn** (kiểm tra ở
   Access Token Debugger: "Expires: Never").
5. Điền vào `.env`: `FB_PAGE_n_ID`, `FB_PAGE_n_NAME`, `FB_PAGE_n_ACCESS_TOKEN`, rồi restart server.

Cách thay thế: Business Settings → System Users → tạo System User, gán quyền các page, generate
token (không hết hạn).

## 2. Biến `.env`

Xem chú thích từng biến trong [`.env.example`](../.env.example) (mục "Facebook auto-post").
Các biến chính: `FB_AUTO_POST`, `FB_GRAPH_VERSION`, `FB_POST_TYPE`, `FB_POST_MIN_GAP_MINUTES`,
`FB_POST_MAX_GAP_MINUTES`, `FB_RATE_LIMIT_BACKOFF_MINUTES`, `FB_VERIFY_TIMEOUT_MINUTES`,
`FB_PAGE_n_*`, `FB_THUMB_START_SEC`, `FB_THUMB_END_OFFSET_SEC`, `FFMPEG_PATH`.

Khi khởi động, server log page nào thiếu ID/token (bị bỏ qua) và cảnh báo nếu `FB_AUTO_POST` bật
mà không có page hợp lệ. `.env` và `data/` đã nằm trong `.gitignore`; token không bao giờ được
ghi vào log, `social-queue.json` hay API response (chuỗi giống token bị che thành `EAAB****`).

## 3. Xem trạng thái hàng đợi

- UI: nút **Danh sách video đã dựng** — mỗi video có dòng trạng thái đăng; đầu modal hiện cảnh báo
  đỏ nếu có page bị tắt, cấu hình dở dang hoặc ffmpeg hỏng.
- `GET /api/social-queue` — toàn bộ queue/posts (đã che token). `GET /api/social-status` — page bị
  tắt, lỗi cấu hình, trạng thái ffmpeg.
- File `data/social-queue.json`. Trạng thái job: `pending` (chờ/đang retry), `verifying` (Reel đã
  tạo, chờ Facebook xử lý), `failed` (dừng, không tự retry). Job đã đăng nằm ở `posts[]`, kèm
  `thumbnail.timeSec` (giây của frame ảnh bìa) để debug.
- Log có dạng `2026-09-30 04:12:31 [facebook] ...` (giờ local của máy), prefix `[facebook]`, `[queue]`,
  `[thumbnail]`.

## 4. Bật lại page bị tắt

Lỗi token vĩnh viễn (code 190/OAuthException) làm page bị **tắt**; job vẫn giữ `pending` và được
thử trên page khác. Để bật lại: tạo lại token đúng (mục 1), sửa `FB_PAGE_n_ACCESS_TOKEN` trong
`.env`, **restart server** — token đổi thì page tự được chọn lại. Muốn ép bật mà không đổi token:
xoá entry `disabledPages["<pageId>"]` trong `data/social-queue.json` khi server đang tắt.

## 5. Cách server xử lý lỗi

| Loại lỗi | Ví dụ | Xử lý |
|---|---|---|
| Token hỏng | code 190, OAuthException | tắt page, job thử page khác |
| Rate limit | code 4, 17, 32, 613, 341, 80xxx, HTTP 429 | hoãn job ≥15 phút (`FB_RATE_LIMIT_BACKOFF_MINUTES`), **không** tính vào số lần thử |
| Tạm thời | 5xx, mất mạng, timeout ở start/upload | retry backoff 2, 4, 8… tối đa 30 phút, tối đa 5 lần rồi `failed` |
| File mất | `output/<slug>.mp4` bị xoá | `failed` ngay, không retry |
| Sau khi Reel đã tồn tại | Facebook từ chối lúc xử lý; hết `FB_VERIFY_TIMEOUT_MINUTES` | `failed`, **không** đăng lại (tránh Reel trùng) |

Lỗi đặt ảnh bìa chỉ log cảnh báo, không làm job thất bại.

## 6. Tắt server an toàn

`Ctrl+C` (SIGINT) hoặc SIGTERM: ngừng nhận tick mới, đợi lần đăng đang chạy tối đa 60 giây. Ngay
khi bước `finish` của Reel tới Facebook, job được lưu `verifying` kèm `video_id`, nên tắt giữa
chừng không gây đăng trùng. Job upload dở (chưa `finish`) vẫn `pending` và sẽ đăng lại từ đầu.

## 7. Lỗi thường gặp

- **`Invalid OAuth access token` / page bị tắt** → mục 4.
- **`(#10) ... permission`** → token thiếu quyền `pages_manage_posts`; tạo lại token với đủ quyền.
- **Reel bị đăng dạng video thường** → video không đạt 9:16 / 3–90s (lý do ghi ở `fallbackReason`).
- **Không có ảnh bìa** → xem log `[thumbnail]`; kiểm tra ffmpeg (`GET /api/social-status`). ffmpeg
  mặc định là gói `ffmpeg-static`; nếu thiếu binary, chạy lại `npm install` hoặc đặt `FFMPEG_PATH`.
- **`social-queue.corrupt-<time>.json` xuất hiện trong `data/`** → file queue bị hỏng và đã được
  backup, server khởi tạo queue rỗng; mở bản backup để khôi phục job cần thiết.
- **Không thấy đăng gì** → kiểm tra log khởi động (page thiếu token, `FB_AUTO_POST`), và khoảng nghỉ
  giữa các lần đăng của từng page.

## 8. Chạy test

`npm test` (dùng `node:test`, mock `fetch`, không gọi Facebook thật).
