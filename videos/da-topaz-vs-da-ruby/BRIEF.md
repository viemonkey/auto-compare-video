# Brief — Đá Topaz vs Đá Ruby

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Đá Topaz vs Đá Ruby.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Đều đỏ hồng lấp lánh, làm sao phân biệt Topaz và Ruby cực chuẩn?
- **Sinh lúc**: 2026-09-18T07:28:03.548Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Nhìn thoáng qua đều đỏ hồng sang trọng, nhưng giá trị và độ quý hiếm lại cực kỳ khác biệt. _(pose: `thinking`)_
2. Topaz có độ cứng đạt 8 trên thang Mohs, rất bền bỉ cho trang sức đeo hàng ngày. _(pose: `explain-a`)_
3. Còn Ruby siêu cứng cáp với điểm 9 vượt trội, chỉ đứng sau duy nhất kim cương. _(pose: `shocked-a`)_
4. Đá Topaz thường có độ tinh khiết cao, rất ít tạp chất và dễ tìm thấy viên kích cỡ lớn. _(pose: `explain-b`)_
5. Trong khi đó, Ruby tự nhiên hầu như luôn có tì vết bên trong và cực hiếm viên lớn hoàn hảo. _(pose: `point-up-right`)_
6. Nếu thích đá to, trong suốt giá hợp lý hãy chọn Topaz; muốn đẳng cấp và giữ giá thì chọn Ruby nhé! _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 5 (card `left`): `assets/images/context-5.png` — concept: "Mohs hardness scale graphic highlighting Topaz at position 8"
- point 6 (card `right`): `assets/images/context-6.png` — concept: "Mohs hardness scale graphic highlighting Corundum Ruby at position 9 next to Diamond"
- point 7 (card `left`): `assets/images/context-7.png` — concept: "A close-up of a flawless, large pink topaz gemstone reflecting light beautifully"
- point 8 (card `right`): `assets/images/context-8.png` — concept: "Microscopic view of natural inclusions inside a genuine red ruby gemstone"

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
