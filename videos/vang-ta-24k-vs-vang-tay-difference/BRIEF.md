# Brief — Vàng Ta (24K) vs Vàng Tây

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Vàng Ta (24K) vs Vàng Tây.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Phân biệt Vàng Tây và Vàng Ta cực dễ cho người mới!
- **Sinh lúc**: 2026-09-16T09:38:52.887Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Vàng ta là vàng tinh khiết đến chín mươi chín phẩy chín mươi chín phần trăm. _(pose: `explain-a`)_
2. Vàng tây là hợp kim của vàng nguyên chất pha trộn với các kim loại khác. _(pose: `explain-b`)_
3. Vì quá nguyên chất nên vàng ta rất mềm, dễ bị móp méo khi va đập. _(pose: `point-up-left`)_
4. Vàng tây cứng cáp hơn nhiều, giúp giữ form tốt và dễ đính đá quý. _(pose: `point-up-right`)_
5. Vàng ta thường được đúc thành miếng hoặc nhẫn tròn trơn để tích trữ sinh lời. _(pose: `explain-a`)_
6. Vàng tây đa dạng màu sắc, cực kỳ phù hợp để làm trang sức đeo hàng ngày. _(pose: `explain-b`)_
7. Tóm lại, mua tích trữ thì chọn vàng ta, còn đeo thời trang thì chọn vàng tây nhé! _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 8 (card `left`): `assets/images/context-8.png` — concept: "gold bars and gold coins stacked on a dark wooden table"

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
