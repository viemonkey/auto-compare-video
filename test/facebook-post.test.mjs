import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { postReelToPage, checkReelStatus, postVideoToPage } from "../scripts/lib/facebook-post.mjs";
import { redactSecrets, inspectPages, isAutoPostEnabled, graphVersion } from "../scripts/lib/fb-config.mjs";

const TOKEN = "EAABsecrettoken1234567890";
const page = { id: "P1", name: "Page 1", accessToken: TOKEN };
const video = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fb-test-")), "v.mp4");
fs.writeFileSync(video, Buffer.alloc(2048));

const realFetch = globalThis.fetch;
let calls;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
function mockFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
}
beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const happy = (url, init) => {
  if (url.includes("/video_reels")) {
    const phase = init.body.get("upload_phase");
    return phase === "start" ? json({ video_id: "V1", upload_url: "https://rupload.example/u" }) : json({ success: true });
  }
  if (url.startsWith("https://rupload.example")) return json({ success: true });
  if (url.includes("/V1?fields=status")) return json({ status: { publishing_phase: { status: "complete" } } });
  throw new Error("URL lạ: " + url);
};

test("đăng Reel thành công; onSubmitted được gọi; token không lọt vào URL poll", async () => {
  mockFetch(happy);
  const submitted = [];
  const r = await postReelToPage(page, video, "cap", { onSubmitted: (id) => submitted.push(id) });
  assert.equal(r.outcome, "complete");
  assert.equal(r.id, "V1");
  assert.deepEqual(submitted, ["V1"]);
  const pollCall = calls.find((c) => c.url.includes("/V1?fields=status"));
  assert.ok(!pollCall.url.includes(TOKEN));
  assert.equal(pollCall.init.headers.Authorization, `Bearer ${TOKEN}`);
});

test("Graph version lấy từ FB_GRAPH_VERSION", async () => {
  process.env.FB_GRAPH_VERSION = "v22.0";
  try {
    mockFetch(happy);
    await postReelToPage(page, video, "cap");
    assert.ok(calls[0].url.startsWith("https://graph.facebook.com/v22.0/P1/video_reels"));
    assert.equal(graphVersion(), "v22.0");
    process.env.FB_GRAPH_VERSION = "rác";
    assert.equal(graphVersion(), "v19.0");
  } finally {
    delete process.env.FB_GRAPH_VERSION;
  }
});

test("start bị rate limit (code 613) -> rateLimited, không permanent", async () => {
  mockFetch(() => json({ error: { type: "OAuthException", code: 613, message: "Calls to this api have exceeded the rate limit." } }, 400));
  await assert.rejects(postReelToPage(page, video, "cap"), (e) => e.rateLimited === true && !e.permanent);
});

test("token hết hạn (190) -> permanent; message đã che token", async () => {
  mockFetch(() => json({ error: { type: "OAuthException", code: 190, message: `Invalid OAuth access token ${TOKEN}` } }, 400));
  await assert.rejects(postReelToPage(page, video, "cap"), (e) => {
    assert.equal(e.permanent, true);
    assert.ok(!e.message.includes("secrettoken"), e.message);
    return true;
  });
});

test("5xx ở bước start -> lỗi tạm thời", async () => {
  mockFetch(() => new Response("Bad gateway", { status: 502 }));
  await assert.rejects(postReelToPage(page, video, "cap"), (e) => !e.permanent && !e.rateLimited);
});

test("finish mơ hồ (lỗi mạng) -> verifying với video_id đã có, không throw", async () => {
  mockFetch((url, init) => {
    if (url.includes("/video_reels") && init.body.get("upload_phase") === "finish") throw new TypeError("fetch failed");
    return happy(url, init);
  });
  const submitted = [];
  const r = await postReelToPage(page, video, "cap", { onSubmitted: (id) => submitted.push(id) });
  assert.deepEqual({ id: r.id, outcome: r.outcome }, { id: "V1", outcome: "verifying" });
  assert.deepEqual(submitted, ["V1"]);
});

test("finish trả lỗi rõ ràng -> throw (chưa publish, retry an toàn), onSubmitted không gọi", async () => {
  mockFetch((url, init) => {
    if (url.includes("/video_reels") && init.body.get("upload_phase") === "finish") {
      return json({ error: { code: 100, message: "Invalid parameter" } }, 400);
    }
    return happy(url, init);
  });
  const submitted = [];
  await assert.rejects(postReelToPage(page, video, "cap", { onSubmitted: (id) => submitted.push(id) }));
  assert.deepEqual(submitted, []);
});

test("checkReelStatus: complete / error / pending", async () => {
  const phase = (processing, publishing) => json({ status: { processing_phase: processing, publishing_phase: publishing } });
  mockFetch(() => phase({ status: "complete" }, { status: "complete" }));
  assert.equal((await checkReelStatus("V1", page)).state, "complete");
  mockFetch(() => phase({ status: "error", errors: [{ message: "bad codec" }] }, {}));
  assert.deepEqual(await checkReelStatus("V1", page), { state: "error", reason: "bad codec" });
  mockFetch(() => phase({ status: "not_started" }, { status: "not_started" }));
  assert.equal((await checkReelStatus("V1", page)).state, "pending");
});

test("checkReelStatus: rate limit được gắn cờ", async () => {
  mockFetch(() => json({ error: { type: "OAuthException", code: 4, message: "limit" } }, 400));
  await assert.rejects(checkReelStatus("V1", page), (e) => e.rateLimited === true && !e.permanent);
});

test("postVideoToPage: lỗi Graph gắn cờ rate limit", async () => {
  mockFetch(() => json({ error: { code: 17, message: "User request limit reached" } }, 400));
  await assert.rejects(postVideoToPage(page, video, "cap"), (e) => e.rateLimited === true);
});

test("redactSecrets che token trong env, access_token=, Bearer và chuỗi EAA…", () => {
  process.env.FB_PAGE_9_ACCESS_TOKEN = "custom-token-value-123456";
  try {
    const out = redactSecrets("x custom-token-value-123456 y access_token=abc123def456 Bearer zzzzzzzzzzzz EAABqwertyuiop12345");
    for (const leak of ["custom-token-value-123456", "abc123def456", "zzzzzzzzzzzz", "qwertyuiop"]) {
      assert.ok(!out.includes(leak), `${leak} còn trong: ${out}`);
    }
    assert.ok(out.includes("EAAB****"));
  } finally {
    delete process.env.FB_PAGE_9_ACCESS_TOKEN;
  }
});

test("inspectPages: bỏ qua slot thiếu ID/token và báo rõ; isAutoPostEnabled", () => {
  const env = {
    FB_PAGE_1_ID: "1",
    FB_PAGE_1_ACCESS_TOKEN: "t1",
    FB_PAGE_1_NAME: "Một",
    FB_PAGE_2_ID: "2",
    FB_PAGE_3_ACCESS_TOKEN: "t3",
  };
  const { pages, problems } = inspectPages(env);
  assert.deepEqual(pages.map((p) => p.id), ["1"]);
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes("FB_PAGE_2")));
  assert.ok(problems.some((p) => p.includes("FB_PAGE_3")));
  assert.equal(isAutoPostEnabled({ FB_AUTO_POST: "0" }), false);
  assert.equal(isAutoPostEnabled({ FB_AUTO_POST: "false" }), false);
  assert.equal(isAutoPostEnabled({ FB_AUTO_POST: "true" }), true);
  assert.equal(isAutoPostEnabled({}), true);
});

test("stamp log dùng giờ local, không phải UTC", async () => {
  const { stamp } = await import("../scripts/lib/fb-config.mjs");
  const d = new Date(2026, 8, 30, 11, 31, 5); // 11:31:05 giờ local
  assert.equal(stamp(d), "2026-09-30 11:31:05");
});
