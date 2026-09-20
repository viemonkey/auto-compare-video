# Brief — Đá Spinel vs Đá Topaz

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Đá Spinel vs Đá Topaz.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Đá Spinel và Đá Topaz khác nhau thế nào mà giá lệch cả chục lần?
- **Sinh lúc**: 2026-09-18T08:39:47.061Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Cả hai đều sở hữu sắc tím xanh lung linh, rất dễ gây nhầm lẫn cho người mới chơi đá quý. _(pose: `confused`)_
2. Spinel có độ cứng 8 trên thang Mohs, sở hữu cấu trúc tinh thể lập phương cực kỳ bền bỉ. _(pose: `explain-a`)_
3. Topaz cứng hơn đạt điểm 8 trên thang Mohs, nhưng lại dễ nứt vỡ dọc theo thớ đá khi va đập. _(pose: `explain-b`)_
4. Spinel tự nhiên cực kỳ quý hiếm, đặc biệt là màu xanh cobalt, khiến giá trị của nó rất cao. _(pose: `shocked-a`)_
5. Trong khi đó, Topaz có sản lượng khai thác lớn trong tự nhiên nên mức giá vô cùng dễ chịu. _(pose: `thumbs-up-a`)_
6. Nếu muốn độc lạ và bền bỉ hãy chọn Spinel, còn thích rực rỡ giá mềm thì Topaz là chân ái. _(pose: `point-up-right`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 5 (card `left`): `assets/images/context-5.png` — concept: "cubic crystal lattice structure of spinel gemstone glowing under light"
- point 6 (card `right`): `assets/images/context-6.png` — concept: "topaz crystal showing perfect cleavage plane splitting under pressure"
- point 7 (card `left`): `assets/images/context-7.png` — concept: "rare cobalt blue spinel gemstone sparkling on a dark background"
- point 8 (card `right`): `assets/images/context-8.png` — concept: "large natural topaz crystals being mined in a bright open pit mine"

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
