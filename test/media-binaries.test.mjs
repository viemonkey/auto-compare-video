import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { checkMediaBinaries, describeSpawnError, mediaToolsEnv, mediaToolsErrorVi, resolveMediaBinaries } from "../scripts/lib/media-binaries.mjs";

test("media binaries: cấu hình thắng binary đóng gói; mặc định có ffmpeg-static và ffprobe-static", () => {
  assert.deepEqual(
    resolveMediaBinaries({ FFMPEG_PATH: "C:\\tools\\ffmpeg.exe", FFPROBE_PATH: "C:\\tools\\ffprobe.exe" }, { ffmpeg: "/bundle/ffmpeg", ffprobe: "/bundle/ffprobe" }),
    { ffmpeg: "C:\\tools\\ffmpeg.exe", ffprobe: "C:\\tools\\ffprobe.exe" },
  );
  const actual = resolveMediaBinaries({});
  assert.match(actual.ffmpeg, /ffmpeg(?:\.exe)?$/i);
  assert.match(actual.ffprobe, /ffprobe(?:\.exe)?$/i);
});

test("media binaries: kiểm tra đủ hai binary khi server khởi động", () => {
  const calls = [];
  const report = checkMediaBinaries({
    env: {},
    bundled: { ffmpeg: "/bundle/ffmpeg", ffprobe: "/bundle/ffprobe" },
    spawn: (bin, args) => {
      calls.push({ bin, args });
      return { status: 0, stdout: `${bin} version 1\n`, stderr: "" };
    },
  });
  assert.equal(report.ok, true);
  assert.deepEqual(calls.map((c) => c.bin), ["/bundle/ffmpeg", "/bundle/ffprobe"]);
  assert.ok(calls.every((c) => c.args[0] === "-version"));
});

test("media binaries: thiếu ffprobe báo tiếng Việt và giữ mã ENOENT", () => {
  const report = checkMediaBinaries({
    env: {},
    bundled: { ffmpeg: "/bundle/ffmpeg", ffprobe: "/missing/ffprobe" },
    spawn: (bin) => bin.includes("ffprobe")
      ? { error: Object.assign(new Error("spawn /missing/ffprobe ENOENT"), { code: "ENOENT", path: "/missing/ffprobe" }) }
      : { status: 0, stdout: "ffmpeg version 1\n", stderr: "" },
  });
  assert.equal(report.ok, false);
  assert.equal(report.ffprobe.code, "ENOENT");
  assert.match(report.ffprobe.error, /ENOENT/);
  assert.match(mediaToolsErrorVi(report), /FFprobe|ffprobe/i);
  assert.match(mediaToolsErrorVi(report), /npm install|FFPROBE_PATH/);
});

test("spawn error: không biến thành object rỗng, luôn có command + mã lỗi + message", () => {
  const error = Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT", path: "ffprobe" });
  assert.equal(describeSpawnError(error), "Không chạy được ffprobe [ENOENT]: spawn ffprobe ENOENT");
  assert.match(describeSpawnError({}), /UNKNOWN/);
});

test("mediaToolsEnv: thư mục ffmpeg/ffprobe đóng gói đứng đầu PATH để hyperframes render tìm thấy", () => {
  const env = mediaToolsEnv({ PATH: "/usr/bin" }, { ffmpeg: "/bundle/ffmpeg/ffmpeg", ffprobe: "/bundle/ffprobe/ffprobe" });
  assert.equal(env.PATH, ["/bundle/ffmpeg", "/bundle/ffprobe", "/usr/bin"].join(path.delimiter));
  const same = mediaToolsEnv({ PATH: "/usr/bin" }, { ffmpeg: "/bundle/ffmpeg", ffprobe: "/bundle/ffprobe" });
  assert.equal(same.PATH, ["/bundle", "/usr/bin"].join(path.delimiter), "trùng thư mục chỉ thêm một lần");
  const byName = mediaToolsEnv({ PATH: "/usr/bin" }, { ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
  assert.equal(byName.PATH, "/usr/bin", "tên trần (đã có trong PATH) thì không đổi");
});
