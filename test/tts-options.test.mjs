// Ô chọn giọng ở Bước 1 lọc theo thị trường.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ttsOptionsForLocale } from "../scripts/lib/tts/options.mjs";
import { listEngines, engineReadiness } from "../scripts/lib/capabilities.mjs";
import { resolveLocale, listLocales } from "../scripts/lib/locales.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const opts = (env = {}) => ({ engines: listEngines(), readiness: (e) => engineReadiness(e, { env, repoRoot: ROOT }), repoRoot: ROOT });
const AZURE = { AZURE_SPEECH_KEY: "k", AZURE_SPEECH_REGION: "eastus" };

test("mỗi thị trường chỉ thấy engine hỗ trợ ngôn ngữ của nó, và chỉ giọng của thị trường đó", () => {
  for (const l of listLocales()) {
    const r = ttsOptionsForLocale(l, opts());
    assert.ok(r.engines.length > 0, l.code);
    for (const e of r.engines) {
      assert.ok(e.languages.includes(l.language), `${l.code}: ${e.id} không hỗ trợ ${l.language}`);
      assert.ok(e.voices.every((v) => v.id.startsWith(`${l.language}-`) || e.id === "vieneu"), `${l.code}/${e.id}: giọng sai ngôn ngữ`);
    }
  }
});

test("ja-JP: có edge (+ azure khi bật), không có vieneu/vbee (chỉ tiếng Việt); giọng mặc định = nam trong config locale", () => {
  const ja = resolveLocale("ja-JP");
  const r = ttsOptionsForLocale(ja, opts());
  assert.deepEqual(r.engines.map((e) => e.id), ["edge", "azure"]);
  assert.equal(r.engines.find((e) => e.id === "azure").ready, false);
  assert.match(r.engines.find((e) => e.id === "azure").notReadyReason, /AZURE_SPEECH_KEY/);
  assert.equal(r.defaultEngine, "edge");
  assert.equal(r.engines.find((e) => e.id === "edge").defaultVoice, "ja-JP-KeitaNeural");
  assert.equal(ttsOptionsForLocale(ja, opts(AZURE)).defaultEngine, "azure");
});

test("en-US / th-TH: giọng nam mặc định", () => {
  assert.equal(ttsOptionsForLocale(resolveLocale("en-US"), opts()).engines.find((e) => e.id === "edge").defaultVoice, "en-US-AndrewNeural");
  assert.equal(ttsOptionsForLocale(resolveLocale("th-TH"), opts()).engines.find((e) => e.id === "edge").defaultVoice, "th-TH-NiwatNeural");
});

test("vi-VN giữ nguyên: vieneu → edge → vbee theo thứ tự cũ, không có engine mới, không ép engine mặc định", () => {
  const vi = resolveLocale("vi-VN");
  const r = ttsOptionsForLocale(vi, opts());
  assert.deepEqual(r.engines.map((e) => e.id), ["vieneu", "edge", "vbee"]);
  assert.equal(r.defaultEngine, null);
  assert.equal(r.engines.find((e) => e.id === "edge").defaultVoice, "vi-VN-NamMinhNeural");
  assert.equal(r.engines.find((e) => e.id === "vieneu").defaultVoice, "Minh Quân");
});

test("đổi giọng chỉ cần sửa config locale (không sửa code)", () => {
  const ja = resolveLocale("ja-JP");
  const custom = { ...ja, tts: { ...ja.tts, voices: { ...ja.tts.voices, edge: "ja-JP-NanamiNeural" } } };
  assert.equal(ttsOptionsForLocale(custom, opts()).engines.find((e) => e.id === "edge").defaultVoice, "ja-JP-NanamiNeural");
});
