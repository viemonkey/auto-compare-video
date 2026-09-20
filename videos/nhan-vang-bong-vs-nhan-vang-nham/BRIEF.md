# Brief — Nhẫn vàng bóng vs Nhẫn vàng nhám

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Nhẫn vàng bóng vs Nhẫn vàng nhám.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Chọn nhẫn cưới bóng hay nhám để đeo cả đời không chán?
- **Sinh lúc**: 2026-09-18T10:02:13.184Z

## Assets

- **Card trái**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Card phải**: ảnh thật, nguồn `(không rõ — đã dùng --content, xem log lúc chạy)`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Nhẫn vàng bóng có bề mặt nhẵn mịn, phản chiếu ánh sáng lấp lánh cực kỳ sang trọng. _(pose: `explain-a`)_
2. Còn nhẫn vàng nhám được xử lý tạo vân mờ, mang lại vẻ đẹp hiện đại, tinh tế và ít đụng hàng. _(pose: `explain-b`)_
3. Tuy nhiên, nhẫn bóng rất dễ lộ các vết trầy xước nhỏ sau một thời gian đeo hàng ngày. _(pose: `confused`)_
4. Nhẫn nhám thì giấu vết xước cực tốt, nhưng đeo lâu ngày có thể bị mòn và bóng nhẹ trở lại. _(pose: `shocked-a`)_
5. Cả hai đều có thể dễ dàng đánh bóng hoặc làm nhám lại như mới tại các tiệm kim hoàn. _(pose: `thumbs-up-a`)_
6. Thích truyền thống nổi bật chọn bóng, thích cá tính thanh lịch chọn nhám nha! _(pose: `shrug-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- point 4 (card `left`): `assets/images/context-4.png` — concept: "macro shot of a highly polished gold ring reflecting bright studio lights"
- point 5 (card `right`): `assets/images/context-5.png` — concept: "close-up texture of brushed matte gold surface with fine satin lines"
- point 6 (card `left`): `assets/images/context-6.png` — concept: "macro photo of a worn gold ring with tiny scratches on its surface"
- point 7 (card `right`): `assets/images/context-7.png` — concept: "a matte gold ring showing slight wear where the texture has smoothed out"

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
