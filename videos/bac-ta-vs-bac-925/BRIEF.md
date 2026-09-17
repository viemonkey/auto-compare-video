# Brief — Bạc Ta vs Bạc 925

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Bạc Ta vs Bạc 925.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Bạc ta và Bạc 925: Loại nào dễ xỉn màu và bền hơn?
- **Sinh lúc**: 2026-09-12T01:43:44.320Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Bạn có biết bạc ta và bạc 925 loại nào thực sự bền và ít bị xỉn màu hơn không? _(pose: `confused`)_
2. Bạc ta chứa tới chín mươi chín phẩy chín phần trăm bạc nguyên chất, rất mềm và dễ biến dạng. _(pose: `explain-a`)_
3. Bạc chín hai lăm pha thêm bảy phẩy năm phần trăm kim loại khác giúp tăng độ cứng vượt trội. _(pose: `explain-b`)_
4. Về độ xỉn màu, bạc ta cực kỳ bền màu, khó bị đen hơn nhờ độ tinh khiết cao. _(pose: `point-up-left`)_
5. Ngược lại, bạc chín hai lăm dễ bị xỉn đen hơn do các hợp kim phản ứng với lưu huỳnh. _(pose: `point-up-right`)_
6. Hãy chọn bạc ta để giữ giá trị, và chọn bạc chín hai lăm nếu muốn chế tác tinh xảo nhé! _(pose: `thumbs-up-a`)_

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
