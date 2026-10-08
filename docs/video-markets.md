# Dựng video cho từng thị trường (vi-VN · en-US · ja-JP · th-TH)

Từ Giai đoạn 2, **cả 4 thị trường đều dựng được video** với cùng template, cùng bố cục 3-zone. Tài liệu này nói về phần "cuối đường ống":
font, ngắt dòng, chữ có vừa khung không, và giọng đọc. (Phần sinh nội dung bằng Gemini / Bước 2 song ngữ: [phase1-markets.md](phase1-markets.md).)

## 1. Dựng video cho một thị trường

1. Bước 1: chọn thị trường (cờ trên đầu trang) → tải 2 ảnh → **Sinh nội dung**. Ô **Chọn giọng** chỉ hiện engine và giọng hỗ trợ ngôn ngữ đó.
2. Bước 2: đọc/sửa kịch bản. Dòng nào chữ **không vừa khung video** sẽ có viền đỏ + câu cảnh báo tiếng Việt ("Câu quá dài… hãy rút gọn"),
   và nút **Duyệt & dựng video** bị khoá cho tới khi sửa xong. Server kiểm lại một lần nữa lúc dựng (không tin trình duyệt).
3. Duyệt & dựng: server chạy `scripts/scaffold-compare-video.mjs` → `videos/<slug>/` → render MP4. Slug bản ngoại ngữ **luôn có hậu tố thị trường**
   (`…-ja`, `…-en`, `…-th`; vi-VN không có hậu tố).

Dòng lệnh (không qua UI), ví dụ tiếng Nhật với Edge TTS:

```bash
node scripts/scaffold-compare-video.mjs anh-trai.jpg anh-phai.jpg --content noi-dung.json --slug aquamarine-vs-sapphire-ja --tts-provider edge
cd videos/aquamarine-vs-sapphire-ja && npm run render
```

`noi-dung.json` là file nội dung có `"locale": "ja-JP"` (song ngữ `{text, vi}` hay chuỗi phẳng đều được).

## 2. Đổi giọng

Giọng mặc định của từng thị trường nằm trong **`config/locales/<mã>.json` → `tts`** — sửa file, không sửa code:

```json
"tts": {
  "priority": ["azure", "edge"],
  "voices": { "edge": "ja-JP-KeitaNeural", "azure": "ja-JP-KeitaNeural" },
  "speed": 1.1
}
```

| Thị trường | Giọng nam mặc định (Edge & Azure) |
|---|---|
| ja-JP | `ja-JP-KeitaNeural` |
| en-US | `en-US-AndrewNeural` |
| th-TH | `th-TH-NiwatNeural` |
| vi-VN | không khai báo `tts` → giữ cách cũ (VieNeu → Edge `vi-VN-NamMinhNeural` → Vbee) |

- Danh sách giọng chọn được trong UI: `config/tts-engines/edge.json` / `azure.json` → `voices.<mã thị trường>`.
- Đổi giọng cho 1 video: chọn trong ô **Chọn giọng** ở Bước 1 (UI gửi `--tts-voice`); giọng không đúng ngôn ngữ của video bị bỏ qua có cảnh báo.
- `tts.speed`: tốc độ đọc (mặc định 1.1 = +10%).
- Audio đã đọc được **cache theo hash** (engine + giọng + tốc độ + chữ) trong `output/tts-cache/` (đổi thư mục bằng `TTS_CACHE_DIR`):
  sửa 1 dòng chỉ đọc lại đúng dòng đó; đổi giọng thì đọc lại (khoá khác).

## 3. Bật Azure AI Speech bằng khoá

Edge TTS miễn phí nhưng **không chính thức** (có thể đổi/ngắt không báo trước). Azure là phương án dự phòng chính thức, tính phí theo ký tự.

1. Azure Portal → tạo tài nguyên **Speech** → *Keys and Endpoint* → lấy **KEY** và **REGION** (vd `southeastasia`).
2. Điền vào `.env` ở gốc repo:
   ```
   AZURE_SPEECH_KEY=…
   AZURE_SPEECH_REGION=southeastasia
   ```
3. Khởi động lại server. Engine **Azure AI Speech** hết bị khoá trong ô Chọn giọng.

Thứ tự chọn engine theo `tts.priority` của thị trường:

| Tình huống | Kết quả |
|---|---|
| Có khoá Azure, `priority` bắt đầu bằng `azure` | dùng Azure, Edge là dự phòng |
| Không có khoá | dùng Edge |
| Edge lỗi liên tục (hết 8 lần thử lại ở một dòng) mà có khoá Azure | **tự chuyển sang Azure**, đọc lại cả video bằng Azure để cùng một giọng, ghi log |
| Muốn Edge trước, Azure dự phòng | đổi `priority` thành `["edge","azure"]` |

Chi phí: bảng giá ở `config/pricing.mjs` → `TTS_PRICING` (kèm nguồn + ngày). Mỗi lần đọc thật ghi 1 dòng vào `output/cost-ledger.jsonl`
(`task: "tts"`, `engine`, `characters`, `voice`; Edge = 0 USD, Azure = số ký tự × đơn giá). Dòng lấy từ cache không ghi (không tốn gì).

## 4. Giới hạn chữ theo thị trường

Giới hạn **nội dung** (số chữ khi Gemini viết, cảnh báo ở Bước 2) — `config/locales/<mã>.json` → `limits`:

| | vi-VN | en-US | ja-JP | th-TH |
|---|---|---|---|---|
| đơn vị đếm | ký tự | từ | ký tự | ký tự |
| tiêu đề (title) | 120 | 14 | 60 | 70 |
| tên bên trái/phải (label) | 40 | 4 | 20 | 24 |
| mỗi điểm so sánh (point) | 160 | 20 | 70 | 85 |

Giới hạn **khung hình** (video thật) — `layout` trong cùng file, hình học khung trong `config/themes/paper.json` → `frames`:

| Khung | Tham số | Ý nghĩa |
|---|---|---|
| Tên 2 bên (`label`) | `fontPx` / `minFontPx` / `stepPx` / `maxLines` | bắt đầu ở `fontPx`, **giảm từng `stepPx` tới `minFontPx`** cho tới khi vừa khung 444px × tối đa `maxLines` dòng (ja/th: 2 dòng) |
| Caption karaoke (`caption`) | `maxTokens`, `hardMaxTokens`, `maxUnits`, `clauseEnders`, `weakStartPattern` | gom từ thành cụm 1 dòng; mỗi cụm đo vừa khung 960px, cụm nào vẫn tràn thì giảm cỡ riêng tới `minFontPx` |
| Ngắt dòng | `lineBreak.mode` (`space` / `segmenter`), `kinsoku`, `balance` | vi/en theo khoảng trắng; ja/th theo từ (`Intl.Segmenter`); ja thêm luật kinsoku (không bắt đầu dòng bằng `。、」）ー・`, không kết thúc bằng `「（`) |

Đo bằng **Chrome thật + font thật** (cùng `chrome-headless-shell` mà HyperFrames render). Vẫn tràn ở cỡ nhỏ nhất ⇒ **chặn dựng** và báo đúng dòng. Không có Chrome thì ước lượng theo số ký tự (nói rõ trong log).
Ký tự mà font không có (kanji hiếm → sẽ thành ô vuông) cũng bị chặn trước khi dựng.

Ghi chú: ô "Nhãn" (`tag`) và "Dòng phụ" (`sub`) của từng điểm hiện chưa được vẽ lên video ở giao diện `paper` (layout v2 chỉ có tên 2 bên + caption), nên chúng không bị kiểm tràn.

## 5. Font

Mọi font OFL, **lưu local** (`assets/fonts/`, nguồn + giấy phép + dung lượng: [assets/fonts/README.md](../assets/fonts/README.md)), copy vào `videos/<slug>/assets/fonts/` lúc dựng — render không tải CDN.
Mỗi thị trường khai báo chuỗi font (có fallback) ở `config/locales/<mã>.json` → `fonts.display` / `fonts.mono`:
ja = Noto Sans JP → Be Vietnam Pro; th = Noto Sans Thai → Be Vietnam Pro; vi/en = Be Vietnam Pro.
Ja/th không in nghiêng/in hoa (`video.italic` / `video.uppercase` = false).

## 6. Chữ cố định trên màn hình theo thị trường

Câu mở đầu ("Đây là X."), câu chốt, thẻ kênh, tiêu đề tài liệu nằm ở `config/locales/<mã>.json` → `video` (`hookLine`, `payoffLine`, `payoffTag`, `payoffSub`, `eyebrow`, `docTitle`, `htmlLang`).
Lưu ý: thẻ kênh `#eyebrow` bị `scripts/sync-channel.mjs` ghi đè bằng `CHANNEL` trong `.env` lúc render (dùng chung mọi thị trường).
