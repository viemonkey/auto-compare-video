# Brief — Phô mai kem vs Phô mai tươi

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Phô mai kem vs Phô mai tươi.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Phô mai kem và phô mai tươi khác nhau thế nào?
- **Sinh lúc**: 2026-09-11T03:10:33.700Z

## Assets

- **Card trái**: ảnh thật, nguồn `assets/uploads/1789094494656-z65255.jpg`.
- **Card phải**: ảnh thật, nguồn `assets/uploads/1789094494657-uk6maj.jpeg`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Phô mai kem được làm từ sữa và kem tươi, vị chua béo ngậy đặc trưng. _(pose: `explain-a`)_
2. Phô mai tươi như Burrata làm từ sữa đông, cực kỳ mọng nước và thanh mát. _(pose: `explain-b`)_
3. Cream cheese có kết cấu đặc mịn, dễ tán, là linh hồn của bánh cheesecake. _(pose: `explain-a`)_
4. Phô mai tươi có lớp vỏ dai nhẹ, bên trong là kem béo ngậy tan chảy. _(pose: `explain-b`)_
5. Hàm lượng béo của phô mai kem rất cao, thường chiếm trên ba mươi phần trăm. _(pose: `shocked-a`)_
6. Phô mai tươi vị nhẹ nhàng hơn, cực hợp khi ăn kèm salad và dầu ô-liu. _(pose: `explain-b`)_
7. Cả hai đều là phô mai không ủ chín, nên ăn ngay để giữ vị ngon nhất! _(pose: `thumbs-up-a`)_

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
