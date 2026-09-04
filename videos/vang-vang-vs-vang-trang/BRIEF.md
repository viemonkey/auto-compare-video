# Brief — Vàng Vàng vs Vàng Trắng

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Vàng Vàng vs Vàng Trắng.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Nên chọn nhẫn Vàng Vàng hay Vàng Trắng?
- **Sinh lúc**: 2026-08-29T19:35:59.798Z

## Assets

- **Card trái**: ảnh thật, nguồn `C:\auto-compare-video\test-images\nhan-vang.jpg`.
- **Card phải**: ảnh thật, nguồn `C:\auto-compare-video\test-images\nhan-kim-cuong.jpg`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Cùng là vàng nhưng sắc thái mang lại phong cách hoàn toàn khác biệt! _(pose: `offer-a`)_
2. Vàng vàng mang vẻ đẹp cổ điển, ấm áp và cực kỳ tôn da ấm châu Á. _(pose: `point-left-far`)_
3. Vàng trắng lại hiện đại, thời thượng và tôn lên độ lấp lánh của đá. _(pose: `point-right-near`)_
4. Vàng vàng rất bền màu, không cần xi mạ lại sau thời gian dài đeo. _(pose: `explain-a`)_
5. Vàng trắng cần xi mạ Rhodium định kỳ để giữ vẻ sáng bóng nguyên bản. _(pose: `explain-b`)_
6. Nếu thích kim cương nổi bật nhất, vàng trắng là sự kết hợp tuyệt vời. _(pose: `inspect-gem`)_
7. Bạn sẽ chọn nét truyền thống ấm áp hay sự hiện đại kiêu sa này? _(pose: `present-ring`)_

## Notes

- Layout 3-zone dùng chung `../../DESIGN.md`. **Nhịp kịch bản riêng cho template
  auto-compare** — KHÔNG theo nhịp 12-dòng cố định của skill `create-video`:
  hook (2 dòng, tự sinh từ label) → question (1 dòng, = title Gemini) → body (N dòng =
  `points`, mỗi dòng 1 `suggested_action` Gemini chọn) → payoff (1 dòng, tự sinh, không
  qua Gemini — giữ deterministic).
- Body/question **không có** từ khoá tô màu `.kw` — schema Gemini hiện tại không sinh field
  "từ khoá cần nhấn mạnh", nên các dòng này hiển thị plain text. Hook/payoff có tô cyan tên
  2 khái niệm (tự sinh cố định, không qua Gemini).
- Card active-emphasis (dim bên không liên quan) suy ra tự động từ tên pose
  (`point-left-*` / `point-right-*`) — dòng nào pose trung tính thì giữ nguyên trạng thái
  emphasis trước đó.
- Chưa render MP4 — mới chỉ qua `npm run check`.
