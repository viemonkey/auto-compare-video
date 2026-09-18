# Brief — Đồng thau vs Vàng thật

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Đồng thau vs Vàng thật.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Làm sao phân biệt nhẫn đồng thau và nhẫn vàng thật?
- **Sinh lúc**: 2026-09-17T11:16:42.171Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Nhìn bề ngoài hai chiếc nhẫn này giống hệt nhau, nhưng giá trị lại chênh lệch cả ngàn lần. _(pose: `thinking`)_
2. Đồng thau thực chất là hợp kim của đồng và kẽm, có màu vàng sáng bóng rất đẹp. _(pose: `explain-a`)_
3. Còn vàng thật là kim loại quý hiếm, có độ bền hóa học cực cao và không bị oxy hóa. _(pose: `explain-b`)_
4. Đồng thau sau một thời gian đeo sẽ bị xỉn màu, hóa xanh do phản ứng với mồ hôi. _(pose: `shocked-a`)_
5. Vàng thật thì vĩnh cửu, không bao giờ bị đen hay gỉ sét dù đeo hàng chục năm. _(pose: `thumbs-up-a`)_
6. Để phân biệt nhanh, bạn có thể dùng nam châm hoặc thử bằng axit nitric để xem phản ứng. _(pose: `point-up-right`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- Không có ảnh nào sinh thành công lần này.

Sinh lỗi/fallback, giữ ảnh sản phẩm gốc (xem log lúc chạy):
- point 7: "Đồng thau sau một thời gian đeo sẽ bị xỉn màu, hóa xanh do phản ứng với mồ hôi."

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
