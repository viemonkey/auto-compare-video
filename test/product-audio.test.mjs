// Âm thanh: ghép giọng + SFX + nhạc (nếu có), nhạc tự hạ khi có giọng, chuẩn hoá -14 LUFS; manifest chỉ nhận âm thanh có giấy phép.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveMediaBinaries } from "../scripts/lib/media-binaries.mjs";
import { loadProductConfig } from "../scripts/lib/product/config.mjs";
import { buildMixGraph, mixAudio, measureLufs, loadAudioManifest, pickBgm, parseLoudnorm } from "../scripts/lib/product/audio-mix.mjs";
import { tmpDir } from "./helpers/product-fixtures.mjs";

const config = loadProductConfig();
const { ffmpeg } = resolveMediaBinaries();
function tone(file, { freq = 440, dur = 1.5, vol = 0.1 } = {}) {
  const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=f=${freq}:d=${dur}:r=44100`, "-af", `volume=${vol}`, "-ac", "1", file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return file;
}

test("đồ thị ghép: mỗi giọng đặt đúng mốc (adelay ms), có sidechain hạ nhạc khi có nhạc, SFX có gain riêng, không nhạc thì không có sidechain", () => {
  const voices = [{ file: "a.mp3", startSec: 0.35 }, { file: "b.mp3", startSec: 3.1 }];
  const cues = [{ file: "w.wav", at: 3.0, gainDb: -14 }];
  const withBgm = buildMixGraph({ voices, cues, bgm: { file: "m.mp3" }, duration: 15, config });
  assert.match(withBgm.graph, /adelay=350\|350/);
  assert.match(withBgm.graph, /adelay=3100\|3100/);
  assert.match(withBgm.graph, /sidechaincompress=threshold=0\.03:ratio=8/);
  assert.match(withBgm.graph, /volume=-17dB/);
  assert.match(withBgm.graph, /volume=-14dB,adelay=3000\|3000/);
  assert.match(withBgm.graph, /atrim=0:15/);
  assert.deepEqual(withBgm.inputs, ["a.mp3", "b.mp3", "m.mp3", "w.wav"]);
  const noBgm = buildMixGraph({ voices, cues: [], bgm: null, duration: 15, config });
  assert.doesNotMatch(noBgm.graph, /sidechaincompress/);
  assert.deepEqual(noBgm.inputs, ["a.mp3", "b.mp3"]);
});

test("ghép thật: kết quả đạt -14 LUFS (±1), đúng độ dài video; có nhạc nền + SFX vẫn đạt", async () => {
  const dir = tmpDir();
  const v1 = tone(path.join(dir, "v1.wav"), { freq: 300, vol: 0.05 });
  const v2 = tone(path.join(dir, "v2.wav"), { freq: 500, vol: 0.2 });
  const sfx = tone(path.join(dir, "s.wav"), { freq: 2000, dur: 0.3, vol: 0.3 });
  const music = tone(path.join(dir, "m.wav"), { freq: 220, dur: 4, vol: 0.5 });
  const plain = await mixAudio({ voices: [{ file: v1, startSec: 0.3 }, { file: v2, startSec: 2.2 }], duration: 6, outFile: path.join(dir, "plain.mp3"), config });
  const lufs = await measureLufs(plain.file);
  assert.ok(Math.abs(lufs - -14) <= 1, `LUFS ${lufs}`);
  const full = await mixAudio({ voices: [{ file: v1, startSec: 0.3 }, { file: v2, startSec: 2.2 }], cues: [{ file: sfx, at: 2.1, gainDb: -14 }], bgm: { file: music }, duration: 6, outFile: path.join(dir, "full.mp3"), config });
  assert.ok(Math.abs(await measureLufs(full.file) - -14) <= 1);
  const probe = spawnSync(resolveMediaBinaries().ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", full.file], { encoding: "utf8" });
  assert.ok(Math.abs(Number(probe.stdout) - 6) < 0.25, `độ dài ${probe.stdout}`);
  assert.ok(full.measured.i < 0);
  await assert.rejects(() => mixAudio({ voices: [], duration: 5, outFile: path.join(dir, "x.mp3"), config }), /Không có giọng/);
});

test("manifest âm thanh: SFX tự tổng hợp có license CC0 + file thật; không có nhạc nền thì để trống; mục thiếu giấy phép/file bị bỏ kèm cảnh báo", () => {
  const real = loadAudioManifest(config);
  assert.ok(real.sfx.whoosh && real.sfx.sparkle, "whoosh + sparkle có sẵn");
  assert.equal(real.sfx.whoosh.license, "CC0-1.0");
  assert.deepEqual(real.bgm, [], "không tự tải nhạc không rõ bản quyền");
  assert.equal(pickBgm(real), null);
  const root = tmpDir();
  fs.mkdirSync(path.join(root, "assets", "audio", "bgm"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "audio", "bgm", "a.mp3"), "x");
  fs.writeFileSync(path.join(root, "assets", "audio", "bgm", "b.mp3"), "x");
  fs.writeFileSync(path.join(root, "assets", "audio", "audio.json"), JSON.stringify({ bgm: [{ id: "ok", file: "bgm/a.mp3", license: "CC0-1.0", source: "https://x" }, { id: "nolicense", file: "bgm/b.mp3", source: "https://x" }, { id: "nofile", file: "bgm/zz.mp3", license: "CC0", source: "s" }], sfx: [] }));
  const m = loadAudioManifest(config, root);
  assert.deepEqual(m.bgm.map((b) => b.id), ["ok"]);
  assert.ok(m.warnings.some((w) => /nolicense/.test(w) && /KHÔNG dùng/.test(w)));
  assert.ok(m.warnings.some((w) => /nofile/.test(w)));
  assert.equal(pickBgm(m, "ok").id, "ok");
  assert.equal(pickBgm(m, "khac").id, "ok", "id lạ -> bài đầu tiên");
  assert.throws(() => parseLoudnorm("không có json"), /Không đo được/);
});
