# Brief — Đá Tourmaline vs Đá Topaz

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Đá Tourmaline vs Đá Topaz.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Đều đa sắc lấp lánh, làm sao phân biệt Tourmaline và Topaz?
- **Sinh lúc**: 2026-09-18T08:02:28.819Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Cả hai loại đá này đều cực kỳ đa dạng về màu sắc, khiến nhiều người rất dễ nhầm lẫn. _(pose: `confused`)_
2. Tourmaline nổi tiếng với khả năng đa sắc, thậm chí một viên đá có thể chứa nhiều dải màu khác nhau. _(pose: `point-up-left`)_
3. Trong khi đó, Topaz tự nhiên thường đơn sắc, các viên đa sắc thường là do công nghệ phủ màng kim loại. _(pose: `point-up-right`)_
4. Đặc biệt, Tourmaline có tính điện học, có thể hút bụi bẩn hoặc giấy vụn nhỏ khi bị cọ xát hay làm nóng. _(pose: `shocked-a`)_
5. Topaz cứng hơn với độ cứng đạt điểm 8, nhưng lại dễ nứt vỡ theo thớ dọc nếu bị va đập mạnh. _(pose: `explain-a`)_
6. Hãy chọn Tourmaline nếu thích sự độc bản tự nhiên, và chọn Topaz nếu ưu tiên độ cứng và độ trong suốt! _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 5 (card `left`): `assets/images/context-5.png` — concept: "A close-up of a watermelon tourmaline crystal showing distinct green and pink color zones"
- point 6 (card `right`): `assets/images/context-6.png` — concept: "A brilliant cut mystic topaz gemstone reflecting rainbow colors under studio light"
- point 7 (card `left`): `assets/images/context-7.png` — concept: "A tourmaline crystal attracting tiny ash particles or dust due to pyroelectricity"
- point 8 (card `right`): `assets/images/context-8.png` — concept: "A diagram showing the perfect cleavage plane of a topaz crystal structure"

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
