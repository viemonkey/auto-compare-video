# Brief — Aquamarine vs Sapphire

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Aquamarine vs Sapphire.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Đều là đá quý màu xanh, làm sao để phân biệt Aquamarine và Sapphire?
- **Sinh lúc**: 2026-09-18T06:50:39.769Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Aquamarine thuộc họ Beryl, mang sắc xanh nước biển nhạt, trong trẻo như làn nước mát. _(pose: `explain-a`)_
2. Còn Sapphire thuộc họ Corundum, sở hữu màu xanh lam đậm, hoàng gia và vô cùng sâu thẳm. _(pose: `explain-b`)_
3. Về độ cứng, Aquamarine đạt 7.5 đến 8 trên thang Mohs, rất bền nhưng vẫn cần giữ gìn. _(pose: `point-up-left`)_
4. Trong khi đó, Sapphire cực kỳ cứng cáp với điểm số 9, chỉ đứng sau kim cương. _(pose: `shocked-a`)_
5. Aquamarine là biểu tượng của sự bình an, can đảm và tình yêu vĩnh cửu của biển cả. _(pose: `explain-a`)_
6. Sapphire lại đại diện cho lòng trung thành, sự khôn ngoan và quyền lực hoàng gia. _(pose: `explain-b`)_
7. Chọn Aquamarine nếu thích vẻ nhẹ nhàng thanh lịch, chọn Sapphire nếu muốn sự sang trọng đẳng cấp! _(pose: `thumbs-up-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 4 (card `left`): `assets/images/context-4.png` — concept: "clear light blue beryl crystal in natural rock"
- point 5 (card `right`): `assets/images/context-5.png` — concept: "deep royal blue sapphire crystal rough on dark rock"
- point 7 (card `right`): `assets/images/context-7.png` — concept: "hardness scale illustration showing sapphire below diamond"

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
