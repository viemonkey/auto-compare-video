# Brief — Vàng vs Bạc

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Vàng vs Bạc.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Nên mua trang sức Vàng hay Bạc để vừa đẹp vừa giữ giá?
- **Sinh lúc**: 2026-09-17T08:20:01.627Z

## Assets

- **Card trái**: ảnh thật, nguồn `C:\auto-compare-video\assets\uploads\1789632371619-m7ywoq.jpg`.
- **Card phải**: ảnh thật, nguồn `C:\auto-compare-video\assets\uploads\1789632371620-zmier2.jpg`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Vàng là kim loại quý hiếm, biểu tượng cho sự sang trọng và cực kỳ bền màu. _(pose: `explain-a`)_
2. Bạc mang vẻ đẹp trẻ trung nhưng dễ bị xỉn màu khi tiếp xúc với mồ hôi. _(pose: `explain-b`)_
3. Vàng có khả năng tích trữ giá trị cực tốt, là kênh trú ẩn tài sản an toàn. _(pose: `explain-a`)_
4. Bạc có giá thành mềm hơn nhiều, giúp bạn dễ dàng thay đổi theo xu hướng. _(pose: `explain-b`)_
5. Hãy chọn vàng nếu muốn tích lũy, và chọn bạc để thoải mái phối đồ thời trang. _(pose: `explain-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- Không có ảnh nào sinh thành công lần này.

Sinh lỗi/fallback, giữ ảnh sản phẩm gốc (xem log lúc chạy):
- point 5: "Bạc mang vẻ đẹp trẻ trung nhưng dễ bị xỉn màu khi tiếp xúc với mồ hôi."

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
