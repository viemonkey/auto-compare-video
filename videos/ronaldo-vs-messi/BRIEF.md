# Brief — Ronaldo vs Messi

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Ronaldo vs Messi.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Ronaldo và Messi: Ai mới là GOAT thực sự của bóng đá thế giới?
- **Sinh lúc**: 2026-09-04T04:15:04.921Z

## Assets

- **Card trái**: ảnh thật, nguồn `assets/uploads/KEEP-ronaldo-card-left.webp`.
- **Card phải**: ảnh thật, nguồn `assets/uploads/KEEP-ronaldo-card-right.jpeg`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Ronaldo nổi bật với thể hình lý tưởng, sức bật phi thường và khả năng dứt điểm toàn diện. _(pose: `point-up-left`)_
2. Messi lại sở hữu trọng tâm thấp, kỹ thuật rê bóng lắt léo thiên tài và nhãn quan kiến tạo đỉnh cao. _(pose: `point-up-right`)_
3. CR7 là biểu tượng của sự khổ luyện phi thường, duy trì phong độ đỉnh cao nhờ kỷ luật thép. _(pose: `explain-a`)_
4. El Pulga mang vẻ đẹp của tài năng thiên bẩm, chơi bóng thanh thoát và ngẫu hứng như một nghệ sĩ. _(pose: `explain-b`)_
5. Ronaldo sở hữu kỷ lục ghi bàn vĩ đại nhất lịch sử và vô số danh hiệu Champions League. _(pose: `shocked-a`)_
6. Messi đã hoàn tất bộ sưu tập vĩ đại với chức vô địch World Cup và 8 Quả bóng Vàng. _(pose: `thumbs-up-a`)_
7. Cả hai tạo nên kỷ nguyên cạnh tranh vĩ đại nhất, thúc đẩy nhau vượt qua mọi giới hạn. _(pose: `thinking`)_

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
