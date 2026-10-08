#!/usr/bin/env python3
"""Dựng lại các file font trong assets/fonts/ từ bản gốc OFL (xem assets/fonts/README.md).

Cần: pip install fonttools brotli
Dùng:  python scripts/fonts/build_fonts.py <thư-mục-chứa-bản-gốc>
  <thư-mục> chứa NotoSansJP[wght].ttf (hoặc NotoSansJP.ttf) và NotoSansThai[wdth,wght].ttf (hoặc NotoSansThai.ttf)

Mỗi font: cố định trục biến thiên ở wght=900 (bản dựng video chỉ dùng chữ đậm nhất), subset đúng tập ký tự cần,
xuất woff2 + <tên>.coverage.json (danh sách đoạn codepoint font có glyph) để kiểm tra "ô vuông" (tofu) mà không cần trình duyệt.
"""
import json
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts")


def find(*names):
    for n in names:
        p = os.path.join(SRC, n)
        if os.path.exists(p):
            return p
    raise SystemExit("Không thấy file gốc: " + " / ".join(names))


def jis_chars():
    """Mọi ký tự JIS X 0208 + JIS X 0213 mặt phẳng 1 (kanji thường dùng, kể cả 靭 ở mức 3) qua codec của Python."""
    out = set()
    for b1 in range(0xA1, 0xFF):
        for b2 in range(0xA1, 0xFF):
            try:
                out.add(bytes([b1, b2]).decode("euc_jisx0213"))
            except UnicodeDecodeError:
                pass
    return {ord(c) for c in out if len(c) == 1}


def ranges(codepoints):
    cps = sorted(codepoints)
    runs, start, prev = [], None, None
    for c in cps:
        if start is None:
            start = prev = c
        elif c == prev + 1:
            prev = c
        else:
            runs.append([start, prev])
            start = prev = c
    if start is not None:
        runs.append([start, prev])
    return runs


def build(src, dst_base, axes, unicodes=None, layout_features=None):
    font = TTFont(src)
    font = instancer.instantiateVariableFont(font, axes)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = layout_features or ["*"]
    opts.notdef_outline = True
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]  # giữ bản quyền + giấy phép
    opts.hinting = False
    sub = subset.Subsetter(opts)
    if unicodes is not None:
        sub.populate(unicodes=unicodes)
    else:
        sub.populate(unicodes=list(font.getBestCmap().keys()))
    sub.subset(font)
    path = dst_base + ".woff2"
    font.flavor = "woff2"
    font.save(path)
    cps = set(TTFont(path).getBestCmap().keys())
    with open(dst_base + ".coverage.json", "w", encoding="utf8") as f:
        json.dump({"ranges": ranges(cps), "count": len(cps)}, f)
    print(os.path.basename(path), os.path.getsize(path), "bytes,", len(cps), "codepoints")


os.makedirs(os.path.join(OUT, "noto-sans-jp"), exist_ok=True)
os.makedirs(os.path.join(OUT, "noto-sans-thai"), exist_ok=True)

jp = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100))      # ASCII + Latin-1
jp |= set(range(0x2000, 0x2070))                             # dấu câu chung (—, …, “ ”)
jp |= set(range(0x3000, 0x3100))                             # ký hiệu CJK, hiragana, katakana (、。「」ー・…)
jp |= set(range(0xFF00, 0xFFF0))                             # chữ rộng / nửa độ rộng (！？（）０-９ Ａ-Ｚ)
jp |= set(range(0x2190, 0x21A0)) | set(range(0x25A0, 0x2600)) | set(range(0x2460, 0x2500))  # mũi tên, hình, số khoanh
jp |= jis_chars()
build(find("NotoSansJP[wght].ttf", "NotoSansJP.ttf"), os.path.join(OUT, "noto-sans-jp", "NotoSansJP-Black-subset"),
      {"wght": 900}, unicodes=sorted(jp))

build(find("NotoSansThai[wdth,wght].ttf", "NotoSansThai.ttf"), os.path.join(OUT, "noto-sans-thai", "NotoSansThai-Black"),
      {"wght": 900, "wdth": 100})


# --- Be Vietnam Pro / JetBrains Mono: file woff2 tải nguyên bản từ Google Fonts (đúng URL mà template cũ từng nhúng) ---
# Chỉ sinh coverage = (glyph có trong file) ∩ (unicode-range khai báo trong assets/fonts/fonts.json cho file đó).
def parse_urange(s):
    out = set()
    for part in s.replace("U+", "").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-")
            out |= set(range(int(a, 16), int(b, 16) + 1))
        else:
            out.add(int(part, 16))
    return out


reg = json.load(open(os.path.join(OUT, "fonts.json"), encoding="utf8"))
for fam in ("Be Vietnam Pro", "JetBrains Mono"):
    for face in reg["families"][fam]["faces"]:
        woff = os.path.join(OUT, face["file"])
        have = set(TTFont(woff).getBestCmap().keys())
        if face.get("unicodeRange"):
            have &= parse_urange(face["unicodeRange"])
        with open(woff.replace(".woff2", ".coverage.json"), "w", encoding="utf8") as f:
            json.dump({"ranges": ranges(have), "count": len(have)}, f)
        print(face["file"], "coverage", len(have))
