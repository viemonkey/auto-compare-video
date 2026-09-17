# Brief — Bạc 925 vs Bạch kim

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Bạc 925 vs Bạch kim.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Nhìn giống nhau nhưng Bạc 925 và Bạch kim khác xa thế này đây!
- **Sinh lúc**: 2026-09-16T16:02:57.599Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Bạc 925 chứa 92.5% bạc nguyên chất, pha thêm hợp kim để tăng độ cứng. _(pose: `explain-a`)_
2. Bạch kim hay Platinum là kim loại quý hiếm nguyên chất tới 95%, cực kỳ bền bỉ. _(pose: `explain-b`)_
3. Bạc 925 rất dễ bị xỉn đen, hóa mờ sau một thời gian đeo do phản ứng với lưu huỳnh. _(pose: `shrug-a`)_
4. Bạch kim hoàn toàn không bị oxy hóa, giữ nguyên độ sáng bóng vĩnh cửu bất chấp thời gian. _(pose: `shocked-a`)_
5. Khi đeo, bạc 925 cho cảm giác rất nhẹ nhàng, thoải mái vì mật độ kim loại thấp. _(pose: `explain-a`)_
6. Bạch kim nặng và đầm tay hơn hẳn, mang lại cảm giác sang trọng, cao cấp rõ rệt. _(pose: `point-up-right`)_
7. Bạc 925 có giá học sinh sinh viên, còn bạch kim là dòng trang sức xa xỉ đắt đỏ bậc nhất. _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 6 (card `left`): `assets/images/context-6.png` — concept: "tarnished silver ring with dark spots and loss of shine"

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
