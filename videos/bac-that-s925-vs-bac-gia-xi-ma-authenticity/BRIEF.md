# Brief — Bạc thật (S925) vs Bạc giả / Xi mạ

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Bạc thật (S925) vs Bạc giả / Xi mạ.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Mẹo phân biệt bạc thật và bạc giả cực dễ tại nhà!
- **Sinh lúc**: 2026-09-17T10:39:37.966Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Bạc thật thường có khắc ký hiệu tiêu chuẩn như S925 hoặc 925 ở mặt trong. _(pose: `point-up-left`)_
2. Bạc giả hoặc trang sức mỹ ký giá rẻ thường trơn láng, không có bất kỳ ký hiệu kiểm định nào. _(pose: `point-up-right`)_
3. Bạn có thể thử bằng nam châm, bạc thật nguyên chất hoàn toàn không bị hút. _(pose: `explain-a`)_
4. Ngược lại, bạc giả pha nhiều sắt hoặc kim loại nặng sẽ bị nam châm hút chặt ngay lập tức. _(pose: `shocked-a`)_
5. Khi thả rơi xuống nền gạch, bạc thật phát ra âm thanh trầm, đục và không vang xa. _(pose: `explain-b`)_
6. Còn các loại inox, sắt giả bạc khi rơi sẽ kêu 'loảng xoảng' rất đanh và vang. _(pose: `confused`)_
7. Để chắc chắn nhất, bạn hãy mang ra tiệm dùng nước phổ hoặc máy đo quang phổ nhé! _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- Không có ảnh nào sinh thành công lần này.

Sinh lỗi/fallback, giữ ảnh sản phẩm gốc (xem log lúc chạy):
- point 6: "Bạn có thể thử bằng nam châm, bạc thật nguyên chất hoàn toàn không bị hút."
- point 7: "Ngược lại, bạc giả pha nhiều sắt hoặc kim loại nặng sẽ bị nam châm hút chặt ngay lập tức."

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
