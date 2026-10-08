import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadFontRegistry, validateRegistry, fontFaceCss, fontStack, fontFilesFor, copyFontsToVideo, uncoveredChars,
  familiesOfLocale, unknownFamilies, MAX_FONT_BYTES,
} from "../scripts/lib/fonts.mjs";
import { validateLocale, listLocales } from "../scripts/lib/locales.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadFontRegistry();
const locale = (code) => listLocales().find((l) => l.code === code);

test("fonts: registry hợp lệ, file tồn tại, mỗi file <= 5MB, mỗi family có OFL.txt", () => {
  assert.deepEqual(validateRegistry(JSON.parse(fs.readFileSync(path.join(registry.dir, "fonts.json"), "utf8")), registry.dir), []);
  for (const [family, def] of Object.entries(registry.families)) {
    assert.equal(def.license, "OFL-1.1", family);
    for (const face of def.faces) {
      const abs = path.join(registry.dir, face.file);
      assert.ok(fs.statSync(abs).size <= MAX_FONT_BYTES, `${face.file} quá 5MB`);
      assert.ok(fs.existsSync(path.join(path.dirname(abs), "OFL.txt")), `${family}: thiếu OFL.txt`);
      assert.ok(fs.existsSync(abs.replace(/\.woff2$/, ".coverage.json")), `${face.file}: thiếu coverage`);
    }
  }
});

test("fonts: validateRegistry bắt file thiếu / sai kiểu", () => {
  assert.ok(validateRegistry({}).length);
  assert.ok(validateRegistry({ families: { X: { license: "OFL-1.1", faces: [{ file: "nope.woff2", weight: 400, style: "normal" }] } } }, registry.dir).some((p) => /không thấy file/.test(p)));
  assert.ok(validateRegistry({ families: { X: { faces: [] } } }).length);
});

test("fonts: mọi locale khai báo chuỗi font có trong registry; chuỗi sai bị validateLocale từ chối", () => {
  for (const l of listLocales()) {
    assert.deepEqual(unknownFamilies([...l.fonts.display, ...l.fonts.mono], registry), [], l.code);
  }
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "locales", "ja-JP.json"), "utf8"));
  raw.fonts.display = ["Font Không Tồn Tại"];
  const { problems } = validateLocale(raw);
  assert.ok(problems.some((p) => /fonts\.display/.test(p) && /Font Không Tồn Tại/.test(p)), problems.join("|"));
  delete raw.fonts;
  assert.ok(validateLocale(raw).problems.some((p) => /"fonts"/.test(p)));
});

test("fonts: @font-face dùng đường dẫn local, không CDN; unicode-range giữ nguyên cho Be Vietnam Pro", () => {
  const css = fontFaceCss(familiesOfLocale(locale("ja-JP")), { registry });
  assert.match(css, /font-family: "Noto Sans JP"/);
  assert.match(css, /url\(assets\/fonts\/noto-sans-jp\/NotoSansJP-Black-subset\.woff2\) format\("woff2"\)/);
  assert.doesNotMatch(css, /https?:/);
  assert.match(css, /font-display: block/);
  const vi = fontFaceCss(familiesOfLocale(locale("vi-VN")), { registry });
  assert.match(vi, /unicode-range: U\+0102-0103/);
});

test("fonts: fontStack có generic cuối", () => {
  assert.equal(fontStack(["Noto Sans JP", "Be Vietnam Pro"], "sans-serif"), '"Noto Sans JP", "Be Vietnam Pro", sans-serif');
});

test("fonts: copyFontsToVideo chép woff2 + OFL.txt vào assets/fonts của project video", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fonts-"));
  try {
    const copied = copyFontsToVideo(dir, ["Noto Sans Thai"], registry);
    assert.ok(copied.includes("noto-sans-thai/NotoSansThai-Black.woff2"));
    assert.ok(fs.existsSync(path.join(dir, "assets", "fonts", "noto-sans-thai", "NotoSansThai-Black.woff2")));
    assert.ok(fs.existsSync(path.join(dir, "assets", "fonts", "noto-sans-thai", "OFL.txt")));
    assert.deepEqual(fontFilesFor(["Noto Sans Thai"], registry).sort(), copied.sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fonts: uncoveredChars phát hiện ký tự sẽ thành ô vuông (tofu)", () => {
  const ja = locale("ja-JP").fonts.display;
  const th = locale("th-TH").fonts.display;
  const vi = locale("vi-VN").fonts.display;
  assert.deepEqual(uncoveredChars("ダイヤモンドは、靭性ではなく硬度！「Mohs 10」ー・（）", ja, registry), []);
  assert.deepEqual(uncoveredChars("เพชรเป็นอัญมณีที่แข็งที่สุด 10", th, registry), []);
  assert.deepEqual(uncoveredChars("Kim cương cứng nhất — đạt 10/10 trên thang Mohs.", vi, registry), []);
  assert.deepEqual(uncoveredChars("日本😀", ja, registry), ["😀"]);
  assert.deepEqual(uncoveredChars("ダイヤ", vi, registry).sort(), ["ダ", "ヤ", "イ"].sort()); // font Việt không có kana
  assert.deepEqual(uncoveredChars("", ja, registry), []);
});

test("template: không còn @font-face CDN; có đủ chỗ điền font", () => {
  const tpl = fs.readFileSync(path.join(ROOT, "templates", "auto-compare", "index.html"), "utf8");
  assert.doesNotMatch(tpl, /fonts\.gstatic\.com|fonts\.googleapis\.com/);
  for (const marker of ["/*FONT_FACES*/", "__FONT_DISPLAY__", "__FONT_MONO__", "__HTML_LANG__"]) assert.ok(tpl.includes(marker), marker);
});
