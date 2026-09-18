# Brief — Thép không gỉ vs Titanium

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Thép không gỉ vs Titanium.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Nhẫn thép không gỉ và nhẫn titan khác nhau thế nào?
- **Sinh lúc**: 2026-09-17T09:21:11.033Z

## Assets

- **Card trái**: ảnh thật, nguồn `C:\auto-compare-video\assets\uploads\1789636160040-w7gj7h.jpg`.
- **Card phải**: ảnh thật, nguồn `C:\auto-compare-video\assets\uploads\1789636160041-zhbn1k.jpg`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Thép không gỉ mang lại cảm giác đầm tay, nặng hơn rõ rệt khi bạn đeo trên ngón tay. _(pose: `explain-a`)_
2. Trong khi đó, titanium siêu nhẹ, nhẹ hơn thép tới bốn mươi lăm phần trăm, đeo thoải mái như không. _(pose: `shocked-a`)_
3. Về màu sắc, thép không gỉ có ánh bạc sáng loáng, phản chiếu ánh sáng cực kỳ bắt mắt. _(pose: `explain-b`)_
4. Còn titanium lại sở hữu tông màu xám tối hơn, bề mặt lì mờ mang phong cách cổ điển, mạnh mẽ. _(pose: `explain-a`)_
5. Nhẫn thép có mức giá cực kỳ bình dân, là lựa chọn hoàn hảo để thay đổi phụ kiện hàng ngày. _(pose: `explain-b`)_
6. Titanium tuy đắt hơn nhưng hoàn toàn không gây dị ứng da và chống ăn mòn tuyệt đối, kể cả với nước biển. _(pose: `shocked-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- Không có ảnh nào sinh thành công lần này.

Sinh lỗi/fallback, giữ ảnh sản phẩm gốc (xem log lúc chạy):
- point 9: "Titanium tuy đắt hơn nhưng hoàn toàn không gây dị ứng da và chống ăn mòn tuyệt đối, kể cả với nước biển."

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
