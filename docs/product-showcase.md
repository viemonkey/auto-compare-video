# Chế độ "Giới thiệu sản phẩm"

Tải **1–3 ảnh sản phẩm có sẵn** + nhập thông số thật → tool tạo video dọc **15–20 giây** (1080×1920), host **HuyK** giới thiệu sản phẩm bằng giọng đọc, phụ đề bật từng từ,
ánh sáng chạy qua kim loại, chớp sáng trong vùng sản phẩm, thẻ thông số và cảnh cuối là sản phẩm thật kèm lời kêu gọi. Không cần chụp ảnh hay quay clip.

**Chi phí tối đa mỗi video: 15.000đ** (`PRODUCT_VIDEO_MAX_COST_VND`). Mặc định (nguồn ảnh "pose") video tốn ≈ 1.000đ giá niêm yết cho phần chữ/vision
(thực tế 0đ ở gói miễn phí) và **không gọi API ảnh nào**.

Chọn chế độ ở đầu trang: **So sánh 2 ảnh** (chế độ cũ, không đổi) / **Giới thiệu sản phẩm**.

## 1. Quy trình 3 bước

1. **Ảnh và thông số** — tải ảnh, nhập loại món / chất liệu / màu kim loại / đá chính / carat / giác cắt / đá phụ / giá / nguồn gốc đá (thiên nhiên – nhân tạo – moissanite) / điểm nổi bật,
   chọn thị trường + giọng + nguồn ảnh + clip AI. Màn hình hiện **ước tính chi phí** (dự kiến, tối đa, trần).
2. **Kịch bản và ảnh cảnh** — Gemini nhìn ảnh viết *mô tả khoá sản phẩm* + đo khung bao; viết kịch bản 5–6 câu (Mở đầu → Thông số → Lúc đeo → Cảm xúc → Kêu gọi) kèm 3 phương án câu mở đầu.
   Sửa lời thoại bằng trình soạn song ngữ, xem/duyệt ảnh từng cảnh. Chỉ dựng được khi mọi ảnh đã đạt kiểm hoặc bạn đã tự duyệt.
3. **Dựng video** — khâu: (Clip AI nếu bật) → Sinh giọng → Tính nhịp → Dựng cảnh → Render MP4 → Kiểm tra. Hiện **chi phí thực tế** khi xong; lỗi thì thử lại đúng khâu lỗi.

Quy tắc nội dung bắt buộc (kiểm bằng code, vi phạm thì Gemini phải viết lại):

- Số liệu (carat, giá, độ tinh khiết, số viên đá…) **chỉ lấy từ form**; form không ghi thì không được nói.
- Không nói "thiên nhiên/tự nhiên" nếu form chưa xác nhận. Đá **nhân tạo / moissanite phải được nói rõ** ít nhất 1 câu.
- Tên đá / kim loại (kim cương, vàng, bạch kim…) chỉ được nhắc khi form có. Dùng lại cụm từ cấm và quy tắc đa thị trường của chế độ so sánh.
- Form và ảnh lệch nhau (vd form "vàng", ảnh kim loại trắng) → **cảnh báo ở Bước 2**, không tự sửa form.

## 2. Ba nguồn ảnh cho cảnh có HuyK

| Nguồn | Cần billing? | Hoạt động |
|---|---|---|
| **Ảnh tư thế có sẵn** (`pose`, mặc định) | Không | HuyK (ảnh trong `assets/actions/`) đứng một bên, ảnh sản phẩm thật lớn ở giữa, GSAP làm chuyển động + ánh sáng. Không gọi API ảnh. Đổi pose từng cảnh ở Bước 2. |
| **Tự tải ảnh** (`manual`) | Không | Bước 2 hiện **prompt đã ghép sẵn** + nút "Sao chép prompt" + hướng dẫn đính kèm ảnh. Bạn tạo ảnh trên Google AI Studio rồi tải lên cảnh. Ảnh vẫn qua bước kiểm 4 tiêu chí (Gemini Flash, gói miễn phí); kết quả chỉ để **cảnh báo**, bạn vẫn duyệt được. |
| **Tự động** (`gemini`) | **Có** | Tool tự tạo 2 ảnh AI (cầm sản phẩm gần mặt + đeo lên người) → kiểm 4 tiêu chí → sửa mặt trên chính ảnh → sửa sản phẩm → tạo lại. Hết lượt/ngân sách thì giữ ảnh điểm cao nhất và **đánh dấu đỏ** để bạn duyệt. |

Mọi nguồn đều có ở mỗi cảnh: *Đổi pose*, *Tải ảnh khác (manual)*, *Dùng ảnh sản phẩm gốc*; và (khi có billing) *Tạo lại*, *Sửa khuôn mặt*, *Sửa sản phẩm*, ô *yêu cầu sửa tự do*
— mọi nút có phí **hiện chi phí trước** và bị khoá nếu vượt trần.

Cảnh phụ **không tốn tiền** (đủ 5–6 cảnh): cận đá (cắt zoom theo khung bao viên đá), nửa người (cắt từ ảnh AI/manual), sản phẩm thật tách nền trên nền tối sang trọng.

### Bước kiểm ảnh 4 tiêu chí (Gemini Flash, mỗi tiêu chí 0–10, đạt khi ≥ `scenes.check.passScore`)
đúng sản phẩm · giống mặt HuyK · tay không lỗi · đúng trang phục — kèm lý do tiếng Việt từng tiêu chí và khung bao sản phẩm trong ảnh.

## 3. Chuẩn ảnh

### Ảnh sản phẩm (Bước 1)
- Nền **trắng đồng màu**, sản phẩm chiếm **gần hết khung**, **không logo / chữ / watermark**, không tay hay người.
- Cạnh ngắn **≥ 800px** (càng nét càng tốt). Ảnh nhỏ vẫn dựng được nhưng cảnh sản phẩm và cảnh cận bị mờ (tool cảnh báo và giới hạn độ zoom cảnh cận theo độ phân giải).
- 1–3 ảnh: chính diện / nghiêng / cận đá. Ảnh đầu là ảnh chính. Tool tự đo khung bao + tách nền đơn giản (nền trắng đồng màu là điều kiện để tách đẹp).

### Ảnh host trong `assets/host-refs/` (chỉ cần cho nguồn `manual` và `gemini`)
| File | Dùng để | Ghi chú |
|---|---|---|
| `face-front.jpg`, `face-left.jpg`, `face-right.jpg`, `face-smile.jpg` (3–4 ảnh) | **CHỈ giữ khuôn mặt + kiểu tóc** | Trang phục trong ảnh này **bất kỳ** — prompt ghi rõ "chỉ lấy khuôn mặt, không lấy trang phục". Rõ nét, đủ sáng, thấy rõ mặt + tóc, không kính râm/khẩu trang, cạnh ngắn **≥ 1024px**. |
| `outfit.jpg` (tuỳ chọn) | Tham chiếu trang phục | Cùng trang phục cho mọi cảnh của 1 video. |

Trang phục lấy từ `config/product-video.json` → `host.outfit.text` (mặc định "áo phông đen, tạp dề da nâu"); bước kiểm có tiêu chí "trang phục đúng cấu hình".
Thiếu ảnh face hoặc ảnh dưới 1024px → tool **cảnh báo bằng tiếng Việt kèm hướng dẫn chọn ảnh**, không chặn nguồn `pose`.
(`*.jpg` bị `.gitignore` — ảnh mặt của bạn không bị commit.)

## 4. Bật billing và chuyển sang "Tự động"

Model tạo ảnh (Nano Banana) và Veo **không có gói miễn phí**; chữ/vision (Gemini Flash) vẫn chạy ở gói miễn phí.

1. Vào Google AI Studio → Billing, gắn thanh toán cho project chứa `GEMINI_API_KEY`.
2. Trong `.env`: `GEMINI_BILLING_ENABLED=1`, khởi động lại server.
3. Bước 1 → mục "Nguồn ảnh" → chọn **Tự động (Gemini)** (và tuỳ chọn **Clip AI cho cảnh mở đầu**, mặc định tắt).

Không có API nào hỏi thẳng "đã bật billing chưa" nên tool dựa vào cờ này. Dù cờ bật, nếu lời gọi thật bị từ chối vì billing/quota 0/model đã ngừng, tool **báo tiếng Việt, tự chuyển sang `pose`, đóng băng nguồn tự động**
cho tới khi khởi động lại — job không bị hỏng.

## 5. Ngân sách (15.000đ/video)

- Trước **mỗi** lời gọi có phí: tra cache → kiểm billing → ước tính chi phí + cộng chi phí đã dùng của video (đọc từ `output/cost-ledger.jsonl` theo slug) → vượt trần thì **không gọi** và hạ cấp:
  - clip AI → hiệu ứng GSAP;
  - không tạo lại ảnh nữa → dùng ảnh tốt nhất hoặc ảnh pose, đánh dấu để bạn duyệt.
- Bật clip AI thì phần clip (≈5.200đ) được **giữ chỗ trước**, ảnh không ăn mất ngân sách của clip.
- Mọi lời gọi đều ghi vào cost-ledger kèm slug video (quyết định miễn phí — pose, cắt, dùng ảnh gốc, dùng cache — ghi 0đ). Tỷ giá lấy từ `USD_TO_VND`.
- Cache theo hash đầu vào (model, kích thước, prompt, byte mọi ảnh tham chiếu, lần thử thứ mấy) ở `data/products/_cache/`: dựng lại y hệt không gọi lại API; bấm "Tạo lại" cố ý vẫn ra ảnh mới.
- Batch API (chậm, rẻ ~50%): `PRODUCT_IMAGE_BATCH=1`, mặc định tắt. Chỉ dùng cho lượt tạo ảnh đầu của các cảnh.

Phân bổ dự kiến khi có billing (giá niêm yết 2026-10-10, `config/pricing.mjs`): phân tích + kịch bản + kiểm ảnh ≈ 1.000–3.500đ · 2 ảnh AI `gemini-3.1-flash-image` 1K ($0.067) ≈ 3.500đ (+ sửa/tạo lại) · clip Veo 3.1 Lite 720p 4 giây ($0.20) ≈ 5.200đ.

## 6. Đổi model, prompt, thông số

| Muốn đổi | Sửa ở |
|---|---|
| Trần chi phí, model ảnh/clip, kích thước ảnh, Batch | `.env`: `PRODUCT_VIDEO_MAX_COST_VND`, `PRODUCT_IMAGE_MODEL`, `PRODUCT_IMAGE_SIZE`, `PRODUCT_IMAGE_BATCH`, `PRODUCT_CLIP_MODEL`, `PRODUCT_CHECK_MODEL` |
| Giá model | `config/pricing.mjs` (ghi nguồn + ngày; model thiếu giá thì tool **không gọi** API có phí) |
| Số lần thử, ngưỡng đạt, tỷ lệ cảnh, pose theo beat, nhịp cắt, âm thanh, nhãn thông số theo thị trường | `config/product-video.json` |
| Prompt phân tích / kịch bản / kiểm ảnh / clip | `prompts/product-analysis.md`, `product-script.md`, `product-scene-check.md`, `product-clip.md` |
| **Prompt cảnh ảnh** (cầm sản phẩm, đeo lên người; riêng nhẫn / dây chuyền / bông tai) | `prompts/product-scenes/hold-close.<loại>.md`, `wear-hand.<loại>.md`; phần dùng chung (nhiếp ảnh, khoá sản phẩm, khoá mặt/trang phục, câu cấm, sửa mặt/sản phẩm) ở `common.md` |
| Trang phục host | `host.outfit` trong `config/product-video.json` (+ `assets/host-refs/outfit.jpg`) |

Model mặc định: `gemini-3.1-flash-image` (Nano Banana 2). **`gemini-2.5-flash-image` đã ngừng từ 2026-10-02** — đừng dùng. Rẻ hơn: `gemini-3.1-flash-lite-image` ($0.0336/ảnh, chỉ 1K).
Đắt/giữ mặt tốt hơn: `gemini-3-pro-image` ($0.134/ảnh). Đổi xong chạy thử trên 1 cảnh trước khi dùng thật.

Prompt tạo ảnh được ghép từ: **mẫu cảnh** + **mô tả khoá sản phẩm do Gemini vision tự viết từ ảnh** (không bao giờ gõ tay — mô tả mâu thuẫn với ảnh thì model làm theo chữ và ra sai hàng đá) +
câu khoá sản phẩm (KHÔNG đổi màu kim loại / số hàng đá / cỡ đá / chi tiết) + khoá khuôn mặt (nhiều ảnh tham chiếu, "chỉ lấy khuôn mặt") + trang phục + câu cấm. Ngôn ngữ nhiếp ảnh
(85mm, f/2, tay cách máy ~40cm, softbox + đèn viền) giữ tay không bị phóng to; tỉ lệ sản phẩm trong khung ghi rõ (nhẫn ≈ 1/4 chiều ngang).

## 7. Âm thanh

Giọng HuyK: VieNeu (tiếng Việt, nếu đã `npm run setup:vieneu`) hoặc engine theo thị trường (Edge/Azure) — dùng lại cơ chế chọn giọng của chế độ so sánh.
Mỗi video có **một file âm thanh** ghép từ giọng + hiệu ứng (whoosh khi cắt cảnh, lấp lánh khi ánh sáng chạy) + nhạc nền (nếu có): nhạc **tự hạ khi có giọng** (sidechain), chuẩn hoá **-14 LUFS** (loudnorm 2 lượt).

- `assets/audio/sfx/*.wav` do repo **tự tổng hợp** bằng `node scripts/generate-sfx.mjs` (CC0, không dùng mẫu của bên thứ ba).
- `assets/audio/bgm/` **để trống** — repo không tự tải nhạc không rõ bản quyền. Thêm nhạc: bỏ file vào đó và khai báo `id`, `file`, `license`, `source` trong `assets/audio/audio.json`
  (thiếu `license`/`source` thì bị bỏ qua kèm cảnh báo). Chọn bài bằng `PRODUCT_BGM=<id>`.

## 8. Cờ nội dung AI

Video có dùng ảnh AI (`gemini`/`manual`) hoặc clip AI được gắn `ai_generated: true` ở `output/content/<slug>.product.json` và trong job hàng đợi đăng (`data/social-queue.json` → `aiGenerated`)
để bước đăng bài bật **nhãn nội dung AI**. Video chỉ dùng pose/cắt/ảnh gốc không có cờ.

## 9. Phiên bản cho thị trường khác

Ở Bước 3 (hoặc sau khi dựng xong): **Tạo phiên bản cho thị trường khác** → chọn thị trường. Tool tạo dự án mới ở Bước 2, **dùng lại toàn bộ ảnh sản phẩm, ảnh cảnh đã duyệt, pose và clip AI**;
chỉ viết lại kịch bản (giữ đúng cấu trúc beat, bám ý bản gốc, dịch cả giá trị thẻ thông số) và đọc giọng theo thị trường mới. **Không gọi lại API ảnh/clip.**

## 10. Kiến trúc tóm tắt

- `server-product.mjs` — API `/api/product/*`; dự án ở `data/products/<id>/` (gitignored). Việc dài (tạo/kiểm/sửa ảnh, clip) chạy nền, giao diện hỏi lại trạng thái.
- `scripts/lib/product/` — `config`, `billing`, `budget`, `estimate`, `analyze`, `script`, `scene-prompts`, `image-gen`, `image-batch`, `scene-check`, `scene-flow`, `scene-cache`, `scenes`, `shots`, `scene-assets`, `images` (ffmpeg, không thư viện native), `clip-adapters` (registry) + `clip-flow`, `audio-mix`, `compose-product`.
- `templates/product-showcase/index.html` + `scripts/scaffold-product-video.mjs` — dựng project HyperFrames theo khâu, dùng lại hạ tầng build job của chế độ so sánh.
- Chế độ so sánh không bị đổi (golden test vẫn chạy). `npm test && npm run lint`.

## 11. Giới hạn đã biết
- Cần nền ảnh sản phẩm đồng màu để tách nền đẹp; nền phức tạp thì dùng ảnh khác hoặc nguồn `manual`.
- Veo / Nano Banana chưa kiểm được trên tài khoản chưa billing: code đầy đủ, test bằng mock. Cấu trúc request Veo theo tài liệu chính thức ngày 2026-10-10 — nếu Google đổi, sửa `scripts/lib/product/clip-adapters.mjs`.
- Chưa có: khớp khẩu hình, chạy hàng loạt từ catalog, đăng Facebook (chỉ gắn cờ AI).
