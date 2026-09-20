# Brief — Nhẫn Titanium vs Nhẫn Thép Không Gỉ

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Nhẫn Titanium vs Nhẫn Thép Không Gỉ.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Nhìn giống hệt nhau nhưng sao giá và độ bền lại lệch trời vực?
- **Sinh lúc**: 2026-09-18T02:37:37.979Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Cùng là nhẫn bạc, nhưng một bên là Titanium siêu bền, bên kia là Thép không gỉ giá rẻ. _(pose: `thinking`)_
2. Titanium cực kỳ nhẹ, chỉ bằng khoảng 60% trọng lượng của thép nhưng độ bền lực lại vượt trội. _(pose: `explain-a`)_
3. Thép không gỉ nặng tay hơn hẳn, tuy cứng cáp nhưng dễ bị trầy xước hơn khi va đập mạnh. _(pose: `explain-b`)_
4. Titanium hoàn toàn không gây dị ứng da và chống ăn mòn tuyệt đối, kể cả trong nước biển. _(pose: `point-up-left`)_
5. Thép không gỉ thông thường vẫn có thể chứa niken gây ngứa da và dễ bị xỉn màu theo thời gian. _(pose: `point-up-right`)_
6. Muốn bền bỉ trọn đời hãy chọn Titanium, còn muốn tiết kiệm đổi mẫu thì chọn Thép không gỉ. _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 7 (card `left`): `assets/images/context-7.png` — concept: "titanium ring submerged in salty ocean water without rusting"

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
