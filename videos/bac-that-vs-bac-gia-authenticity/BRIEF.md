# Brief — Bạc thật vs Bạc giả

## Intent

- **Nguồn gốc**: video này được tạo **tự động** bởi `scripts/scaffold-compare-video.mjs`
  (Auto Compare Video pipeline) từ 2 ảnh người dùng upload, qua Gemini Vision
  (`scripts/generate-compare-content.mjs`) — không phải viết tay theo skill `create-video`.
- **Chủ đề**: So sánh Bạc thật vs Bạc giả.
- **Câu hỏi mở đầu (question beat, = title Gemini)**: Mẹo phân biệt bạc thật và bạc giả cực dễ ai cũng làm được!
- **Sinh lúc**: 2026-09-17T03:37:37.949Z

## Assets

- **Card trái**: ảnh thật, nguồn `C:\auto-compare-video\assets\uploads\1789614963179-dafed5.webp`.
- **Card phải**: ảnh thật, nguồn `C:\auto-compare-video\assets\uploads\1789614963179-ao94rp.jpg`.
- **Host avatar**: ảnh thật host "HuyK" (`assets/actions/`, xem `actions.json` cùng thư mục),
  đổi pose theo `suggested_action` Gemini gợi ý cho từng điểm so sánh + 4 pose cố định
  (hook trái/phải, question, payoff).
- **Giọng đọc**: sinh qua `scripts/generate-vo.mjs` (provider theo `.env` root repo).

## Nội dung tự sinh (Gemini, body beat)

1. Bạc thật thường được khắc các ký hiệu tiêu chuẩn như S925 hoặc 950 ở mặt trong của nhẫn. _(pose: `explain-a`)_
2. Bạc giả hoặc mỹ ký giá rẻ thường không có ký hiệu này, hoặc nét chữ rất mờ và nhòe. _(pose: `explain-b`)_
3. Bạc thật nguyên chất hoàn toàn không bị nam châm hút vì kim loại này không có từ tính. _(pose: `explain-a`)_
4. Bạc giả chứa nhiều sắt hoặc niken bên trong sẽ bị nam châm hút chặt ngay lập tức. _(pose: `shocked-a`)_
5. Khi thả rơi xuống nền gạch, bạc thật phát ra âm thanh trầm đục và không vang xa. _(pose: `explain-b`)_
6. Ngược lại, bạc giả làm từ inox hoặc đồng thau sẽ phát ra tiếng kêu đanh và chói tai. _(pose: `shocked-a`)_
7. Bạc thật dùng lâu sẽ bị xỉn đen do phản ứng hóa học, nhưng đánh bóng lại sáng như mới. _(pose: `explain-a`)_

## Ảnh minh hoạ ngữ cảnh (Giai đoạn 1 — sinh bằng Gemini image gen)

- Không có ảnh nào sinh thành công lần này.

Sinh lỗi/fallback, giữ ảnh sản phẩm gốc (xem log lúc chạy):
- point 6: "Bạc thật nguyên chất hoàn toàn không bị nam châm hút vì kim loại này không có từ tính."

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
