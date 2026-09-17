# Brief — Đá Moissanite vs Kim cương

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Đá Moissanite vs Kim cương.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Làm sao phân biệt đá Moissanite và Kim cương bằng mắt thường?
- **Sinh lúc**: 2026-09-11T17:12:04.110Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Đá Moissanite có độ lấp lánh cực cao, phản chiếu luồng sáng cầu vồng rực rỡ dưới nắng. _(pose: `point-up-left`)_
2. Trong khi đó, Kim cương tỏa ra ánh sáng trắng và xám thanh lịch, ít bị lóe màu sắc sặc sỡ. _(pose: `point-up-right`)_
3. Về độ bền, Moissanite đạt chín phẩy hai mươi lăm điểm Mohs, cực kỳ khó trầy xước khi đeo. _(pose: `explain-a`)_
4. Nhưng kim cương tự nhiên mới là vua độ cứng với điểm mười tuyệt đối, bền bỉ vĩnh cửu. _(pose: `shocked-a`)_
5. Điểm cộng lớn của Moissanite là mức giá cực kỳ dễ chịu, chỉ bằng một phần mười kim cương. _(pose: `thumbs-up-a`)_
6. Còn kim cương tự nhiên lại mang giá trị độc bản cao, giữ giá tốt và thể hiện đẳng cấp. _(pose: `explain-b`)_
7. Nếu thích lấp lánh giá tốt hãy chọn Moissanite, còn muốn giá trị vĩnh cửu thì chọn kim cương nhé! _(pose: `shrug-a`)_

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
