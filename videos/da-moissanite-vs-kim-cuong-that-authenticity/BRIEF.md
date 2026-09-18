# Brief — Đá Moissanite vs Kim cương thật

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Đá Moissanite vs Kim cương thật.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Làm sao phân biệt kim cương thật và đá giả Moissanite chỉ bằng mắt thường?
- **Sinh lúc**: 2026-09-17T10:04:56.184Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Moissanite phản chiếu ánh sáng cực mạnh, tạo ra luồng lửa cầu vồng rực rỡ dưới ánh nắng. _(pose: `explain-a`)_
2. Trong khi kim cương thật tỏa ra ánh sáng lấp lánh thiên về tông trắng và xám thanh lịch. _(pose: `explain-b`)_
3. Nhìn qua kính lúp, Moissanite có hiện tượng khúc xạ kép khiến các đường cạnh giác cắt bị nhân đôi. _(pose: `point-up-left`)_
4. Kim cương chỉ có khúc xạ đơn, nên các đường cạnh bên trong luôn sắc nét, không bao giờ bị bóng đôi. _(pose: `point-up-right`)_
5. Mẹo nhanh: Hà hơi vào đá, kim cương thật tản nhiệt siêu nhanh sẽ bay hơi ngay, còn đá giả bị mờ lâu hơn. _(pose: `shocked-a`)_
6. Để chắc chắn nhất, hãy dùng bút thử độ dẫn nhiệt hoặc yêu cầu giấy kiểm định GIA chuẩn quốc tế nhé! _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- Không có ảnh nào sinh thành công lần này.

Sinh lỗi/fallback, giữ ảnh sản phẩm gốc (xem log lúc chạy):
- point 6: "Nhìn qua kính lúp, Moissanite có hiện tượng khúc xạ kép khiến các đường cạnh giác cắt bị nhân đôi."

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
