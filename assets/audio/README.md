# assets/audio — âm thanh cho video giới thiệu sản phẩm

- `sfx/` — hiệu ứng (whoosh chuyển cảnh, lấp lánh). **Tự tổng hợp** bằng `node scripts/generate-sfx.mjs` (ffmpeg lavfi) nên giấy phép CC0, không phụ thuộc bên thứ ba.
- `bgm/` — nhạc nền. **Để trống theo mặc định**: repo không tự tải nhạc không rõ bản quyền. Muốn có nhạc nền: bỏ file mp3/wav (có giấy phép cho phép dùng thương mại) vào đây và
  khai báo trong `audio.json` → `bgm` với đủ `id`, `file`, `license`, `source` (đường dẫn trang gốc/giấy phép), vd:

  ```json
  { "id": "ambient-1", "file": "bgm/ambient-1.mp3", "title": "Tên bài", "license": "CC0-1.0", "source": "https://..." }
  ```
  Mục thiếu `license`/`source` hoặc thiếu file sẽ bị bỏ qua kèm cảnh báo. Chọn bài: biến `PRODUCT_BGM=<id>` trong `.env` (mặc định bài đầu tiên).
- Khi video có giọng, nhạc tự hạ (sidechain) và toàn bộ âm thanh được chuẩn hoá -14 LUFS.
