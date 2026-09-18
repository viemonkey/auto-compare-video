# Brief — Kim cương nhân tạo vs Kim cương tự nhiên

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Kim cương nhân tạo vs Kim cương tự nhiên.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Mẹo phân biệt kim cương tự nhiên và nhân tạo cực dễ bằng mắt thường!
- **Sinh lúc**: 2026-09-17T10:15:18.655Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Nhìn bằng mắt thường, hai viên đá này trông lấp lánh cực kỳ giống nhau đúng không? _(pose: `confused`)_
2. Kim cương nhân tạo hoặc đá giả thường phản chiếu ánh sáng ra sắc cầu vồng rất rực rỡ. _(pose: `explain-a`)_
3. Trong khi kim cương tự nhiên chủ yếu tỏa ra ánh sáng màu xám và trắng cực kỳ tinh tế. _(pose: `explain-b`)_
4. Mẹo nhỏ là hãy hà hơi vào viên đá, loại nhân tạo giữ nhiệt kém nên hơi nước bám lâu. _(pose: `shocked-a`)_
5. Còn kim cương tự nhiên dẫn nhiệt siêu tốt, hơi sương sẽ tan biến ngay lập tức. _(pose: `thumbs-up-a`)_
6. Để chắc chắn nhất, bạn hãy luôn yêu cầu người bán cung cấp giấy kiểm định GIA nhé! _(pose: `explain-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- Không có ảnh nào sinh thành công lần này.

Sinh lỗi/fallback, giữ ảnh sản phẩm gốc (xem log lúc chạy):
- point 7: "Mẹo nhỏ là hãy hà hơi vào viên đá, loại nhân tạo giữ nhiệt kém nên hơi nước bám lâu."

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
