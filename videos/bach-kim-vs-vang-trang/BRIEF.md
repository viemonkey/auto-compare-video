# Brief — Bạch kim vs Vàng trắng

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Bạch kim vs Vàng trắng.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Bạch kim và Vàng trắng khác nhau thế nào mà giá lệch cả chục triệu?
- **Sinh lúc**: 2026-09-18T10:32:00.629Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Bạch kim là kim loại quý nguyên chất, sở hữu sắc trắng tự nhiên vô cùng sang trọng và đẳng cấp. _(pose: `explain-a`)_
2. Vàng trắng là hợp kim của vàng nguyên chất pha với kim loại khác, rồi phủ lớp Rhodium để tạo độ sáng bóng. _(pose: `explain-b`)_
3. Bạch kim có mật độ kim loại rất cao nên cầm cực kỳ đầm tay, nặng hơn vàng trắng khoảng ba mươi phần trăm. _(pose: `shocked-a`)_
4. Vàng trắng tuy nhẹ hơn nhưng lại có độ cứng cao hơn nhờ các kim loại pha trộn, giúp giữ form nhẫn rất tốt. _(pose: `point-up-right`)_
5. Bạch kim có độ bền vĩnh cửu, không bao giờ bị phai màu hay ố vàng theo thời gian sử dụng. _(pose: `thumbs-up-a`)_
6. Vàng trắng sau một thời gian đeo sẽ bị mòn lớp xi mạ và ngả sang màu vàng nhẹ, cần đi xi lại. _(pose: `confused`)_
7. Nếu muốn đeo bền trọn đời không cần bảo dưỡng thì chọn Bạch kim, còn muốn tiết kiệm chi phí thì chọn Vàng trắng nhé! _(pose: `thinking`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 4 (card `left`): `assets/images/context-4.png` — concept: "raw platinum nugget with a bright silvery-white metallic sheen"
- point 5 (card `right`): `assets/images/context-5.png` — concept: "molten gold being mixed with white metals in a jewelry workshop"
- point 6 (card `left`): `assets/images/context-6.png` — concept: "a scale showing a platinum ring weighing more than a white gold ring of identical size"
- point 8 (card `left`): `assets/images/context-8.png` — concept: "a shiny platinum wedding ring looking brand new after years of wear"
- point 9 (card `right`): `assets/images/context-9.png` — concept: "a white gold ring showing a slight yellowish tint on its edges"

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
