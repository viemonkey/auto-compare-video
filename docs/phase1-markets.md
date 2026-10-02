# Giai đoạn 1 — Đa thị trường (locale): hướng dẫn & tổng kết

Tài liệu này mô tả hệ thống **thị trường (locale)** của web UI (`npm run ui`): cấu trúc file cấu hình, cách thêm thị trường mới,
quy tắc văn phong, Bước 2 song ngữ, model Gemini + fallback, bảng giá, và những gì còn thiếu cho Giai đoạn 2/3.

## 1. Khái niệm

- **Thị trường = 1 file JSON** `config/locales/<code>.json` (vd `ja-JP`). Thêm/bớt/sửa thị trường **chỉ bằng file**, không sửa code.
  File lỗi bị log rõ + tắt thị trường đó lúc khởi động, server vẫn chạy (xem `scripts/lib/locales.mjs` — nơi định nghĩa schema và thông báo lỗi tiếng Việt).
- **Thị trường mặc định**: `DEFAULT_LOCALE` (env hoặc `.env`), không đặt thì `vi-VN`.
- **Thị trường có "nghĩa tiếng Việt"** (mọi thị trường có `language` ≠ `vi`): Gemini viết mỗi dòng hiển thị dưới dạng `{ "text": <chữ đích>, "vi": <nghĩa tiếng Việt sát nghĩa> }`
  để người vận hành không đọc được ngôn ngữ đích vẫn kiểm soát được nội dung. Thị trường tiếng Việt dùng chuỗi phẳng.
- **"Chưa dựng được video"**: thị trường vẫn sinh/sửa/lưu nháp kịch bản bình thường nhưng nút dựng video bị khoá cho tới khi đủ năng lực render (mục 3).

## 2. Cấu trúc file

| Đường dẫn | Vai trò |
|---|---|
| `config/locales/<code>.json` | Định nghĩa thị trường: ngôn ngữ, chữ viết, văn phong, glossary, giới hạn độ dài, cụm cấm, cấu hình prompt |
| `config/hashtags/<code>.json` | Bộ hashtag **có kiểm soát** của thị trường: `topic` (Gemini chỉ được chọn trong đây), `materials` (tên vật liệu → tag), `blocked`; mỗi mục kèm `vi` (nghĩa, hiện ở tooltip) |
| `config/tts-engines/<id>.json` | Mỗi engine giọng đọc khai báo `languages` đọc được, `voices`/`defaultVoices` theo locale, `requires` (env/file cần có) |
| `config/themes/<id>.json` | Mỗi giao diện video khai báo `scripts` (hệ chữ ISO 15924 font hỗ trợ) và `languages` (ngôn ngữ pipeline đã kiểm chứng) |
| `public/flags/<code>.svg` | Cờ hiển thị trên UI (`flagIcon`); thiếu thì rơi về emoji `flag` |
| `prompts/compare-content.md`, `prompts/field-edit.md` | **Toàn bộ chữ của prompt Gemini** (sinh nội dung / viết lại / dịch lại một dòng). Code chỉ điền biến |
| `config/pricing.mjs` | Bảng giá model (mục 6) |

**Năng lực render** do server tính từ khai báo, không có cờ cứng (`scripts/lib/capabilities.mjs`): thị trường dựng được video khi có ≥ 1 engine TTS hỗ trợ `language`
**và** theme hỗ trợ `script` (font) **và** `language`. Thiếu gì UI hiện đúng lý do ("thiếu font", "chưa có giọng đọc"...).

## 3. Thêm thị trường mới (vd `ko-KR`)

1. Tạo `config/locales/ko-KR.json` — copy `ja-JP.json` làm mẫu. Các khoá bắt buộc: `code`, `language`, `script`, `displayName`, `flag`, `enabled`, `slugSuffix`,
   `styleSummary`, `styleGuide`, `glossary`, `limits`, `forbiddenPhrases`, `hashtags`, `hashtagStyle`, `mixedGroup`, `jewelryKeywords`, `prompt`.
2. Tạo `config/hashtags/ko-KR.json` (copy `ja-JP.json`, dịch `topic`/`materials`, giữ `vi` cho từng mục). `hashtagStyle`: `ascii` (bỏ dấu, a-z0-9 — vi, en) hoặc `native` (giữ chữ bản địa — ja, th, ko).
3. Thêm cờ `public/flags/ko-KR.svg` (tuỳ chọn).
4. Khai báo giọng đọc: thêm `"ko"` vào `languages` của engine có hỗ trợ, thêm `defaultVoices`/`voices` cho `ko-KR` trong `config/tts-engines/<engine>.json`.
5. Khi muốn dựng video: theme cần font chứa chữ Hangul + khai báo `"Hang"` trong `scripts` và `"ko"` trong `languages` (việc của Giai đoạn 2 — mục 8).
6. Khởi động lại server: log `[locales]` báo lỗi (nếu có) bằng tiếng Việt. Chạy `npm test` — test kiểm tra **cấu trúc và quy tắc**, không phụ thuộc số lượng thị trường.
7. Sinh thử 1 cặp ảnh, đọc cột "nghĩa tiếng Việt" và các cảnh báo; chỉnh `styleGuide`/`glossary` cho tới khi văn phong ổn (xem mẫu thật ở `docs/verification/m3-real-gemini/`).

## 4. Quy tắc văn phong (trong file locale)

- `styleGuide`: hướng dẫn **viết như người bản xứ** (không dịch từ tiếng Việt), mức lịch sự, độ dài câu, cách mở đầu, những cách nói cần tránh. Được đưa nguyên văn vào prompt.
- `glossary`: `"<khái niệm tiếng Việt>": "<thuật ngữ đích>"`. Dạng đầy đủ `{ "term", "ambiguous"?, "contexts"? }` cho khái niệm mơ hồ (vd "vàng" là kim loại hay màu):
  `ambiguous: true` → vẫn đưa vào prompt nhưng **không** cảnh báo lệch thuật ngữ; `contexts: [...]` → chỉ kiểm khi nghĩa tiếng Việt chứa một cụm ngữ cảnh.
- `forbiddenPhrases`: cụm bị cấm (khẳng định tuyệt đối, hứa hẹn công dụng tâm linh/đầu tư...). Vi phạm = cảnh báo đỏ ở đúng dòng. Ý nghĩa biểu tượng/văn hoá **được phép** nếu viết dạng "được cho là/tượng trưng cho", **không** được khẳng định công dụng.
- `limits`: `unit` (`grapheme` = đếm ký tự; `word` = đếm từ, cần `charsPerWord`), độ dài tối đa cho `title/label/point/tag/sub/...`, và `readingRate` (đơn vị/giây) để ước tính thời gian đọc từng câu.
- Giữ ranh giới khái niệm quan trọng trong `styleGuide` (vd tiếng Nhật: phân biệt 硬度 độ cứng và 靭性 độ dai khi nói về thang Mohs).
- `prompt.*`: các mảnh chữ điền vào template (tên ngôn ngữ, ví dụ minh hoạ, gợi ý nhóm hashtag...).

## 5. Bước 2 song ngữ — cách dùng

- Mỗi dòng: **ô chữ đích** + 1 dòng **nghĩa tiếng Việt** chữ nhỏ, nhạt ngay dưới. Cùng hàng (căn phải): thời gian đọc ước tính, nút **✎** (viết lại theo ý), **↻** (dịch lại nghĩa, chỉ hiện khi nghĩa đã cũ).
- **3 chế độ xem** (nút trên cùng): *Song ngữ* / *Chỉ ngôn ngữ đích* / *Chỉ tiếng Việt* (xem lại nội dung bằng tiếng Việt thuần). Nhớ lựa chọn của bạn.
- **✎ Viết lại**: gõ ý mới **bằng tiếng Việt** → Gemini viết lại bằng ngôn ngữ đích đúng văn phong/glossary/giới hạn của thị trường (chỉ gọi cho đúng dòng đó). Sau khi xong hiện khung
  *Ý bạn nhập ↔ Nghĩa câu mới* (tự ẩn sau 10 giây hoặc bấm ✕) để thấy có lệch ý không. Nếu câu đích **không đổi** → "Giữ nguyên — câu hiện tại đã thể hiện đúng ý theo văn phong …".
  Lỗi hiện bằng tiếng Việt ngay tại dòng, không dùng `alert`.
- **↻ Dịch lại nghĩa**: khi bạn tự sửa chữ đích, dòng nghĩa bị đánh dấu "chưa cập nhật"; bấm ↻ để dịch lại nghĩa cho chữ mới.
- **Nhãn & dòng phụ** (`tag`, `sub` của từng điểm) nằm trong khối gập mặc định đóng; có cảnh báo thì tự mở và có chấm màu ở tiêu đề. Nhãn = chữ ngắn hiện phía trên ảnh trái/phải khi câu đang được đọc; dòng phụ = chữ nhỏ ngay dưới nhãn.
- **Cảnh báo** chỉ hiện khi có: viền màu ở ô + 1 dòng chữ nhỏ (vượt giới hạn, cụm cấm, thiếu nghĩa, lệch thuật ngữ glossary, lệch dữ kiện bản gốc). Cảnh báo **không chặn** — người dùng quyết định.
- **Slug bản ngoại ngữ**: chỉ chữ Latin không dấu + gạch ngang + `slugSuffix` (vd `aquamarine-vs-sapphire-ja`), **không bao giờ** chứa chữ Nhật/Thái. Mỗi bên ưu tiên tên tiếng Anh/quốc tế: `materials` (nếu Latin) → chữ label (nếu Latin) → nghĩa tiếng Việt; không sinh được thì để trống cho bạn nhập tay. Quy tắc ở `public/shared/slug-base.mjs` (dùng chung server + trình duyệt). Slug của dữ liệu đã có không bị đổi.
- **Lưu nháp** (kể cả thị trường chưa dựng được video) → `output/content/<slug>.compare-content.json`; mở lại từ "Danh sách video" → "✏ Mở để sửa". Danh sách video của thị trường ngoại ngữ hiện tiêu đề chữ đích làm tên chính, nghĩa tiếng Việt nhỏ bên dưới, slug mờ hơn.
- **Tạo phiên bản thị trường khác** (từ 1 video/nháp đã có): dùng lại 2 ảnh + gợi ý + góc độ. **Dữ kiện đã duyệt của bản gốc là sự thật cố định**: nhãn trái/phải (nghĩa tiếng Việt), `materials`, và nội dung + thứ tự + bên (`side`) của từng điểm
  được gửi cho Gemini; Gemini chỉ **viết lại** bằng ngôn ngữ đích, **không nhận dạng lại ảnh**, không thêm/bớt ý (schema khoá đúng số điểm). Sau khi sinh, server đối chiếu nghĩa nhãn mới với nhãn bản gốc —
  lệch (vd "kim cương xanh" ≠ "Aquamarine") thì cảnh báo đỏ ngay ở ô nhãn. Đối chiếu chạy lại mỗi lần mở bản nháp nên luôn khớp nội dung hiện tại.
  Mẹo Bước 1: ghi rõ tên 2 đối tượng vào ô gợi ý ngữ cảnh ("ảnh trái là aquamarine, ảnh phải là sapphire") để Gemini không nhận dạng nhầm ngay từ bản gốc.

## 6. Model Gemini, fallback và bảng giá

**Biến môi trường** (`.env`, xem `.env.example`): `GEMINI_MODEL` (chính), `GEMINI_FALLBACK_MODEL` (dự phòng), `IMAGE_GEN_MODEL` (ảnh minh hoạ).

**Cơ chế chuyển model** (`runWithModelFallback` trong `scripts/lib/gemini-retry.mjs`, dùng cho **mọi** lời gọi: sinh nội dung, viết lại, dịch lại, tạo phiên bản thị trường):

- Mỗi model được retry tối đa 3 lần (lỗi tạm thời: backoff / `retryDelay` Google yêu cầu).
- Model chính hết lượt retry vì **503 / 5xx / 429 theo phút / timeout / lỗi mạng**, hoặc **hết quota theo ngày** → chuyển sang `GEMINI_FALLBACK_MODEL` (nếu có và khác model chính), retry bình thường. Log: `[gemini] model chính <A> quá tải → chuyển sang <B>`.
- Chỉ chuyển **1 lần**; fallback cũng hỏng thì báo lỗi tiếng Việt. Lỗi 400/401/403, safety block, response sai hình dạng **không** kích hoạt chuyển model.
- Lúc khởi động server gọi *list models* để kiểm tra tên `GEMINI_MODEL`/`GEMINI_FALLBACK_MODEL`/`IMAGE_GEN_MODEL`; tên sai hoặc chưa đặt fallback → log cảnh báo (không chặn khởi động).
- Bước 2 hiện badge **"Sinh bởi <model>"**, có **"(dự phòng)"** màu vàng khi do model dự phòng viết → nên đọc kỹ hơn. Badge được lưu cùng bản nháp.

**Bảng giá** `config/pricing.mjs`: nguồn `https://ai.google.dev/gemini-api/docs/pricing` (Paid Tier, Standard), có ngày cập nhật cho từng model. Chi phí text = token input × giá + (token output + token thinking) × giá.
Model chưa có giá: vẫn chạy, log cảnh báo 1 lần, ledger ghi 0 USD, nhưng **UI Thống kê chi phí đánh dấu "chưa có giá"** (thẻ cảnh báo + nhãn ở từng video) thay vì hiện 0 như thật.
Sau khi thêm giá: `node scripts/reprice-cost-ledger.mjs [--dry-run] [--all]` tính lại `output/cost-ledger.jsonl` theo token đã lưu (mặc định chỉ sửa dòng 0 USD do thiếu giá; `--all` tính lại mọi dòng thành công). Luôn sao lưu `cost-ledger.jsonl.bak-<thời điểm>` trước khi ghi.

## 7. Dọn thư mục sau render

Render xong, MP4 được chuyển sang `output/<slug>.mp4` rồi xoá `videos/<slug>/` (trừ khi `KEEP_PROJECT=1`). Nếu Windows báo EPERM (antivirus/Chrome còn giữ file):
thử lại sau 1s, 3s, 5s → vẫn lỗi thì ghi vào `data/pending-cleanup.json` (log `[cleanup] đang chờ dọn: <thư mục>`), server thử lại **mỗi phút** và **lúc khởi động**.
An toàn: chỉ xoá khi thư mục nằm trong `videos/` **và** `output/<slug>.mp4` còn tồn tại. `videoPath` trong hàng đợi đăng Facebook luôn trỏ tới file đang tồn tại (`output/` trước, rồi `renders/`).

## 8. Giới hạn hiện tại & lộ trình

**Đã có (Giai đoạn 1):** hệ thống locale bằng file JSON; sinh nội dung song ngữ + glossary + cụm cấm + giới hạn độ dài theo thị trường; Bước 2 song ngữ (3 chế độ xem, viết lại/dịch lại từng dòng, cảnh báo, khoá render);
hashtag theo thị trường + caption đăng Facebook đúng thị trường (page gắn `FB_PAGE_n_LOCALE`); bản nháp, mở lại, tạo phiên bản thị trường khác với dữ kiện cố định; fallback model; bảng giá/chi phí theo thị trường.

**Giới hạn:** chỉ thị trường `vi-VN` **dựng được video** (theme "Giấy Kẻ Ô" chỉ có font Latin/Việt, TTS Edge đã khai báo giọng ja/en/th nhưng pipeline chưa kiểm chứng). Nghĩa tiếng Việt do Gemini viết — là **công cụ kiểm tra**, không phải đảm bảo tuyệt đối.
Đối chiếu dữ kiện bản gốc so nhãn bằng so khớp chữ lỏng (bỏ dấu/hoa thường/chứa nhau), không so ngữ nghĩa; lệch ý ở các điểm so sánh chỉ phát hiện được qua số điểm + khung "ý nhập ↔ nghĩa mới" khi viết lại.
Tỷ giá USD→VND ở thống kê chi phí là hằng số ước tính (26.000đ) trong `public/app.js`.

### Giai đoạn 2 — dựng được video cho ja / en / th (ước lượng ~6–9 người-ngày)

| Việc | Nội dung | Ước lượng |
|---|---|---|
| Font CJK / Thái | Nhúng Noto Sans JP / Noto Sans Thai (subset, `@font-face` + `unicode-range`) vào template; khai báo `scripts` ("Jpan", "Thai") + `languages` trong theme → mở khoá nút dựng. Dung lượng font và thời gian render tăng | 1–1.5 ngày |
| Ngắt dòng | CJK không có khoảng trắng: `line-break: strict` + `word-break` phù hợp, cấm ngắt trước dấu 、。」; Thái cần tách từ (`Intl.Segmenter('th')` hoặc chèn `<wbr>`); caption karaoke hiện chạy theo **từ** (khoảng trắng) nên cần chuyển sang theo cụm/ký tự cho ja/th | 2–3 ngày |
| Kiểm tra tràn chữ | Đo hộp chữ tag/sub/caption trong trình duyệt headless trước khi render (đo `scrollWidth/Height` so với khung), báo tràn ở Bước 2 thay vì phát hiện sau render; hiệu chỉnh `limits` từng locale theo số đo thật | 2–3 ngày |
| Kiểm chứng | Render thử mỗi thị trường, chỉnh theme (cỡ chữ, bề rộng thẻ), thêm snapshot test | 1–1.5 ngày |

### Giai đoạn 3 — giọng đọc đa ngôn ngữ (ước lượng ~5–8 người-ngày)

- **Edge TTS không phải API chính thức** (thư viện `edge-tts-universal` dùng endpoint của trình duyệt Edge): có thể bị chặn/đổi bất cứ lúc nào, điều khoản không cho phép dùng thương mại rõ ràng. Với video đăng kênh kiếm tiền nên cân nhắc **Azure AI Speech (TTS)** — cùng họ giọng Neural, có SLA, giá theo ký tự (có gói miễn phí hàng tháng), trả **word boundary** (cần cho karaoke caption) và hỗ trợ SSML (ngắt nghỉ, tốc độ, đọc số/ngày đúng ngôn ngữ).
- Việc: viết engine `config/tts-engines/azure.json` + bước sinh VO tương ứng (~2 ngày); mapping giọng theo locale; chuẩn hoá cách đọc (số, đơn vị, tên khoáng vật, tiếng Nhật kanji đa âm — dùng SSML `<sub>`/`<phoneme>`) (~2 ngày); cắt lặng/đồng bộ thời lượng từng câu theo ngôn ngữ (xem ghi chú pacing: đệm mp3 mới là thứ làm khoảng nghỉ kéo dài) (~1 ngày); kiểm chứng nghe thử + chi phí (~1 ngày).
- Cần quyết định trước: Azure hay giữ Edge cho bản thử; tài khoản + key Azure; ngân sách/ký tự mỗi video.
