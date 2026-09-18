# Brief — Vàng nhám vs Vàng trơn

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Vàng nhám vs Vàng trơn.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Nên chọn nhẫn vàng nhám cá tính hay vàng trơn truyền thống?
- **Sinh lúc**: 2026-09-17T09:46:57.757Z

## Assets

- **Card trái**: ảnh thật, nguồn `C:\auto-compare-video\assets\uploads\1789637876335-gq56oq.jpg`.
- **Card phải**: ảnh thật, nguồn `C:\auto-compare-video\assets\uploads\1789637876336-wdlifr.jpg`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Vàng nhám có bề mặt được đánh mờ hoặc tạo vân cát li ti, mang phong cách rất hiện đại. _(pose: `explain-a`)_
2. Vàng trơn sở hữu bề mặt nhẵn mịn, phản chiếu ánh sáng lấp lánh mang nét đẹp cổ điển. _(pose: `explain-b`)_
3. Nhẫn vàng nhám giúp che giấu các vết trầy xước nhỏ cực tốt trong quá trình đeo hàng ngày. _(pose: `thumbs-up-a`)_
4. Nhẫn vàng trơn rất dễ lộ vết xước dăm, nhưng bù lại cực kỳ dễ đánh bóng lại như mới. _(pose: `explain-a`)_
5. Tuy nhiên, bề mặt nhám dễ bám bụi bẩn vào các kẽ nhỏ và khó tự vệ sinh hơn. _(pose: `shrug-a`)_
6. Vàng trơn láng mịn nên hầu như không bám bẩn, chỉ cần lau nhẹ là sạch bong. _(pose: `explain-b`)_
7. Thích cá tính hiện đại hãy chọn vàng nhám, chuộng bền bỉ truyền thống thì vàng trơn là chân ái! _(pose: `shrug-a`)_

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
