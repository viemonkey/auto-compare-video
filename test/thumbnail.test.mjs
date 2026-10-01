import { test } from "node:test";
import assert from "node:assert/strict";
import { pickThumbnailTime, extractPoseTimeline } from "../scripts/lib/reel-thumbnail.mjs";

const segs = [
  { pose: "a", start: 0.5, end: 2.5 },
  { pose: "b", start: 2.5, end: 8 },
  { pose: "c", start: 8, end: 20 },
  { pose: "d", start: 20, end: 39 },
];

test("chọn điểm giữa segment trong khoảng [3, duration-2]", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const r = pickThumbnailTime(40, segs, {});
    assert.equal(r.source, "segment-midpoint");
    assert.ok(r.timeSec >= 3 && r.timeSec <= 38, `t=${r.timeSec}`);
    seen.add(r.pose);
    // b bị cắt còn [3,8] -> 5.5; c -> 14; d bị cắt còn [20,38] -> 29
    assert.equal(r.timeSec, { b: 5.5, c: 14, d: 29 }[r.pose]);
  }
  assert.ok(!seen.has("a"));
});

test("không có segments -> random trong khoảng; env ghi đè", () => {
  for (let i = 0; i < 100; i++) {
    const r = pickThumbnailTime(30, null, { FB_THUMB_START_SEC: "5", FB_THUMB_END_OFFSET_SEC: "4" });
    assert.equal(r.source, "random");
    assert.ok(r.timeSec >= 5 && r.timeSec <= 26);
  }
});

test("video quá ngắn -> lấy giữa video", () => {
  assert.equal(pickThumbnailTime(4, segs, {}).timeSec, 2);
});

test("extractPoseTimeline đọc changePose + VO từ index.html", () => {
  const html = `const VO = {
    1: { start: 0.55, dur: 1.12 },
    2: { start: 1.81, dur: 1.36 },
    3: { start: 3.31, dur: 3.12 },
  };
  changePose("point-up-left", VO[1].start);
  changePose("thinking", VO[3].start);
  changePose("wave", VO[2].start);`;
  assert.deepEqual(extractPoseTimeline(html), [
    { pose: "point-up-left", start: 0.55, end: 1.81 },
    { pose: "wave", start: 1.81, end: 3.31 },
    { pose: "thinking", start: 3.31, end: 6.43 },
  ]);
  assert.equal(extractPoseTimeline("khong co gi"), null);
});
