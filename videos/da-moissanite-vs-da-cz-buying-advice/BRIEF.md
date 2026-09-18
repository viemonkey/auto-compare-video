# Brief — Đá Moissanite vs Đá CZ

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Đá Moissanite vs Đá CZ.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Nên chọn đá Moissanite hay đá CZ để làm trang sức?
- **Sinh lúc**: 2026-09-17T11:00:04.268Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Bạn đang phân vân giữa Moissanite lấp lánh và đá CZ giá rẻ để đính lên trang sức? _(pose: `thinking`)_
2. Moissanite cực kỳ cứng, đạt chín phẩy hai lăm điểm, hầu như không bao giờ bị trầy xước hay mờ đục. _(pose: `explain-a`)_
3. Trong khi đó, đá CZ mềm hơn, dễ bị xước và sẽ mờ dần, mất độ bóng sau một thời gian đeo. _(pose: `explain-b`)_
4. Moissanite sở hữu độ khúc xạ cực cao, tạo ra luồng ánh sáng cầu vồng rực rỡ vô cùng bắt mắt. _(pose: `point-up-left`)_
5. Đá CZ thì cho ánh sáng trắng trẻo, thanh lịch và có vẻ ngoài giống với kim cương tự nhiên hơn. _(pose: `point-up-right`)_
6. Nếu bạn muốn đeo hàng ngày lâu dài, hãy đầu tư Moissanite vì độ bền vĩnh cửu của nó. _(pose: `thumbs-up-a`)_
7. Còn nếu chỉ cần phụ kiện đeo đi tiệc vài lần với ngân sách tiết kiệm, đá CZ là lựa chọn tối ưu. _(pose: `shrug-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- Không có ảnh nào sinh thành công lần này.

Sinh lỗi/fallback, giữ ảnh sản phẩm gốc (xem log lúc chạy):
- point 7: "Moissanite sở hữu độ khúc xạ cực cao, tạo ra luồng ánh sáng cầu vồng rực rỡ vô cùng bắt mắt."

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
