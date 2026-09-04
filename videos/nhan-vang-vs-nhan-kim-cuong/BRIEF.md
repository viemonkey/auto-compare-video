# Brief — Vàng Vàng vs Vàng Trắng

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Vàng Vàng vs Vàng Trắng.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Nên chọn trang sức Vàng Vàng hay Vàng Trắng?
- **Sinh lúc**: 2026-09-04T04:31:50.732Z

## Assets

- **Card trái**: ảnh thật, nguồn `C:\auto-compare-video\test-images\nhan-vang.jpg`.
- **Card phải**: ảnh thật, nguồn `C:\auto-compare-video\test-images\nhan-kim-cuong.jpg`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Vàng vàng mang sắc ấm tự nhiên, được tạo ra bằng cách pha trộn vàng nguyên chất với đồng và bạc. _(pose: `explain-a`)_
2. Trong khi đó, vàng trắng có màu sáng bạc hiện đại nhờ kết hợp vàng nguyên chất với palladium hoặc niken. _(pose: `explain-b`)_
3. Vàng vàng rất tôn da ngăm hoặc ấm, mang lại vẻ đẹp sang trọng, truyền thống và không sợ lỗi mốt. _(pose: `point-up-left`)_
4. Còn vàng trắng cực kỳ hợp với tông da lạnh, tạo cảm giác trẻ trung, thời thượng và dễ phối đồ. _(pose: `point-up-right`)_
5. Vàng trắng thường được phủ thêm lớp Rhodium để tăng độ sáng bóng, nhưng cần xi mạ lại sau vài năm. _(pose: `thinking`)_
6. Cả hai đều là những lựa chọn tuyệt vời để tôn vinh vẻ đẹp và giá trị bền vững của bạn. _(pose: `thumbs-up-a`)_

## Notes

- Layout 3-zone dùng chung `../../DESIGN.md`. **Nhịp kịch bản riêng cho template
  auto-compare** — KHÔNG theo nhịp 12-dòng cố định của skill `create-video`:
  hook (2 dòng, tự sinh từ label) → question (1 dòng, = title Gemini) → body (N dòng =
  `points`, mỗi dòng 1 `suggested_action` Gemini chọn) → payoff (1 dòng, tự sinh, không
  qua Gemini — giữ deterministic).
- Body/question **không có** từ khoá tô màu `.kw` — schema Gemini hiện tại không sinh field
  "từ khoá cần nhấn mạnh", nên các dòng này hiển thị plain text. Hook/payoff có tô cyan tên
  2 khái niệm (tự sinh cố định, không qua Gemini).
- Card active-emphasis (dim bên không liên quan) theo field `side` của mỗi dòng
  (left / right / both). Pose chỉ tay: `point-up-left` (trái) / `point-up-right` (phải)
  — đây là 2 pose chỉ tay DUY NHẤT, tái dùng lại khi nhiều beat cùng hướng.
- Chưa render MP4 — mới chỉ qua `npm run check`.
