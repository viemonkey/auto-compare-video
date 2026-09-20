# Brief — Đá Emerald vs Đá Tourmaline

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Đá Emerald vs Đá Tourmaline.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Cùng là đá xanh lục bảo, làm sao phân biệt Emerald và Tourmaline?
- **Sinh lúc**: 2026-09-19T02:29:54.816Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Cả hai đều có màu xanh lục tuyệt đẹp, nhưng giá trị và bản chất lại hoàn toàn khác nhau đấy! _(pose: `confused`)_
2. Emerald hay Ngọc lục bảo thuộc nhóm Beryl, là một trong bốn loại đá quý đắt đỏ nhất thế giới. _(pose: `point-up-left`)_
3. Còn Tourmaline xanh là đá bán quý, thuộc nhóm khoáng chất Silicat phức tạp với dải màu cực kỳ rộng. _(pose: `point-up-right`)_
4. Emerald tự nhiên hầu như luôn có tạp chất bên trong, tạo nên hiệu ứng 'vườn hoa' đặc trưng. _(pose: `explain-a`)_
5. Ngược lại, Tourmaline xanh thường rất trong suốt, ít tạp chất và có các đường sọc dọc thân đá. _(pose: `explain-b`)_
6. Emerald cứng hơn nhưng giòn dễ nứt, còn Tourmaline dẻo dai hơn, rất thích hợp để đeo hàng ngày. _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 5 (card `left`): `assets/images/context-5.png` — concept: "A luxurious emerald ring sparkling under jewelry store lights"
- point 6 (card `right`): `assets/images/context-6.png` — concept: "A spectrum of colorful raw tourmaline crystals in pink, green, and blue"
- point 7 (card `left`): `assets/images/context-7.png` — concept: "Extreme close-up macro shot of inclusions inside a green emerald crystal looking like tiny plants"

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
