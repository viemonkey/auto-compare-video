# Brief — Vàng vàng vs Vàng trắng

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Vàng vàng vs Vàng trắng.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Chọn nhẫn cưới: Vàng vàng truyền thống hay vàng trắng hiện đại?
- **Sinh lúc**: 2026-08-31T09:52:51.175Z

## Assets

- **Card trái**: ảnh thật, nguồn `C:\auto-compare-video\test-images\nhan-vang.jpg`.
- **Card phải**: ảnh thật, nguồn `C:\auto-compare-video\test-images\nhan-kim-cuong.jpg`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Bạn đang phân vân chọn nhẫn cưới vàng vàng hay vàng trắng cho ngày trọng đại? _(pose: `shrug-a`)_
2. Vàng vàng còn có một ưu điểm đặc biệt: rất hợp làm nhẫn cưới truyền đời, gắn kết gia đình qua nhiều thế hệ. _(pose: `point-up-left`)_
3. Còn vàng trắng có một điểm cộng lớn: giúp tôn sáng viên đá chính, khiến kim cương lấp lánh và nổi bật hơn hẳn. _(pose: `point-up-right`)_
4. Vàng vàng mang sắc ấm cổ điển, tượng trưng cho sự thịnh vượng và bền vững. _(pose: `point-up-left`)_
5. Vàng trắng mang vẻ đẹp hiện đại, thanh lịch và cực kỳ dễ phối đồ hàng ngày. _(pose: `point-up-right`)_
6. Nhẫn vàng vàng rất bền màu, hầu như không bị phai hay đổi màu theo thời gian. _(pose: `explain-a`)_
7. Vàng trắng cần xi mạ lại lớp Rhodium sau vài năm để giữ độ sáng bóng như mới. _(pose: `explain-b`)_
8. Thích truyền thống chọn vàng vàng, chuộng hiện đại trẻ trung thì chốt ngay vàng trắng nhé! _(pose: `thumbs-up-a`)_

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
