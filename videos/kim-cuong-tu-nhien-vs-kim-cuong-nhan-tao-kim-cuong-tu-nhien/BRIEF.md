# Brief — Kim cương tự nhiên vs Kim cương nhân tạo

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Kim cương tự nhiên vs Kim cương nhân tạo.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Kim cương hoàn hảo không tì vết: Coi chừng là đồ nhân tạo!
- **Sinh lúc**: 2026-09-18T03:17:44.393Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Nhìn bằng mắt thường, đố bạn phân biệt được đâu là kim cương tự nhiên, đâu là nhân tạo đấy! _(pose: `confused`)_
2. Kim cương tự nhiên mất hàng tỷ năm hình thành sâu trong lòng đất, luôn mang những tạp chất và tì vết độc bản. _(pose: `explain-a`)_
3. Trong khi đó, kim cương nhân tạo được nuôi trong phòng thí nghiệm chỉ mất vài tuần với độ tinh khiết tuyệt đối. _(pose: `explain-b`)_
4. Chính những vết xước, bọt khí li ti bên trong mới là giấy khai sinh chứng minh nguồn gốc tự nhiên của nó. _(pose: `point-up-left`)_
5. Vì thế, một viên kim cương sạch tinh khiết không một tì vết thường là sản phẩm hoàn hảo từ máy móc. _(pose: `shocked-a`)_
6. Vậy nên, trong thế giới đá quý, đôi khi hoàn hảo quá lại chính là điểm đáng nghi nhất đấy nhé! _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 5 (card `left`): `assets/images/context-5.png` — concept: "diamond forming deep inside the earth mantle under extreme heat and pressure geological cross section"
- point 6 (card `right`): `assets/images/context-6.png` — concept: "advanced laboratory plasma reactor chamber growing synthetic diamonds with glowing blue light"
- point 7 (card `left`): `assets/images/context-7.png` — concept: "extreme macro close up of natural diamond inclusions tiny mineral crystals and feathers inside"

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
