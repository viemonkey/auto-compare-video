# Brief — Đá Moissanite vs Kim cương

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Đá Moissanite vs Kim cương.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Nên chọn Moissanite hay Kim cương để không lãng phí tiền?
- **Sinh lúc**: 2026-09-17T00:43:29.181Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Moissanite có giá cực kỳ dễ chịu, chỉ bằng khoảng một phần mười so với kim cương. _(pose: `explain-a`)_
2. Kim cương có độ cứng tuyệt đối mười trên mười, bền bỉ truyền đời không lo trầy xước. _(pose: `point-up-right`)_
3. Moissanite phản xạ ánh sáng mạnh hơn, tạo ra luồng lửa cầu vồng cực kỳ rực rỡ. _(pose: `shocked-a`)_
4. Ngược lại, kim cương có ánh sáng trắng thanh lịch, sang trọng và không bị quá chói. _(pose: `explain-b`)_
5. Nhược điểm của Moissanite là dễ bám dầu mỡ từ mồ hôi tay, nhanh mờ nếu không lau chùi. _(pose: `thinking`)_
6. Tóm lại, chọn Moissanite để tối ưu chi phí, chọn kim cương để giữ giá trị đầu tư lâu dài. _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 5 (card `right`): `assets/images/context-5.png` — concept: "A close-up of a diamond scratching a hard surface without any damage, showing extreme durability"

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
