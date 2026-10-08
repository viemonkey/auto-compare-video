# Font cho video

Mọi font ở đây dùng giấy phép **SIL Open Font License 1.1 (OFL)** — được dùng thương mại, nhúng vào video, sửa đổi/subset
(không được bán riêng font, và bản sửa đổi không được dùng "Reserved Font Name" của tác giả). Toàn văn giấy phép nằm trong
`OFL.txt` cạnh mỗi font; scaffold copy cả `OFL.txt` vào `videos/<slug>/assets/fonts/` cùng file font.

**Font lưu LOCAL trong repo — render không tải gì từ CDN.** Danh sách + `unicode-range` nằm ở [fonts.json](fonts.json);
mỗi thị trường chọn chuỗi font trong `config/locales/<code>.json` (`fonts.display`, `fonts.mono`).

| Thư mục | Family | Dùng cho | File | Dung lượng | Nguồn |
| --- | --- | --- | --- | --- | --- |
| `noto-sans-jp/` | Noto Sans JP (Black 900, **subset**) | ja-JP | `NotoSansJP-Black-subset.woff2` | **1,24 MB** (bản gốc 9,6 MB) | google/fonts `ofl/notosansjp` ← notofonts/noto-cjk `Sans2.004` |
| `noto-sans-thai/` | Noto Sans Thai (Black 900) | th-TH | `NotoSansThai-Black.woff2` | 19 KB | google/fonts `ofl/notosansthai` ← notofonts/thai |
| `be-vietnam-pro/` | Be Vietnam Pro (Black 900) | vi-VN, en-US, ký tự Latin của ja/th | `…-latin.woff2` + `…-vietnamese.woff2` | 21 KB + 12 KB | Google Fonts v12 (đúng file mà template cũ nhúng) |
| `jetbrains-mono/` | JetBrains Mono (Bold 700, subset Việt) | thẻ kênh `#eyebrow` | `JetBrainsMono-Bold-vietnamese.woff2` | 4 KB | Google Fonts v24 |

Tổng thêm mới so với trước: **~1,3 MB** (gần hết là Noto Sans JP đã subset). Không file nào vượt 5 MB (test `fonts.test.mjs` kiểm).

## Noto Sans JP — vì sao subset

Bản gốc `NotoSansJP[wght].ttf` nặng 9,6 MB. `scripts/fonts/build_fonts.py` cố định trục độ đậm ở 900 (video chỉ dùng chữ đậm nhất),
rồi subset còn **8.979 ký tự**: ASCII + Latin-1, dấu câu chung, ký hiệu CJK, hiragana, katakana, chữ rộng/nửa độ rộng,
và toàn bộ **JIS X 0208 + JIS X 0213 mặt phẳng 1** (đủ kanji thông dụng, gồm cả 靭 trong "靭性"). Ký tự hiếm ngoài tập này sẽ bị
phát hiện **trước khi dựng** (`uncoveredChars` trong `scripts/lib/fonts.mjs`, đọc `*.coverage.json`) thay vì ra ô vuông trong video.

## Dựng lại / thêm font

```bash
pip install fonttools brotli
# tải 2 file gốc (NotoSansJP[wght].ttf, NotoSansThai[wdth,wght].ttf) từ github.com/google/fonts/tree/main/ofl vào 1 thư mục tạm
python scripts/fonts/build_fonts.py <thư-mục-tạm>
```

Thêm font mới: bỏ file woff2 + `OFL.txt` vào thư mục riêng, thêm mục vào `fonts.json`, sinh `*.coverage.json` (xem cuối
`build_fonts.py`), rồi tham chiếu tên family trong `fonts.display` của locale. `validateLocale` từ chối tên font không có trong registry.
