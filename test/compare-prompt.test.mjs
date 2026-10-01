import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildComparePrompt } from "../scripts/lib/compare-prompt.mjs";
import { loadHashtagConfig } from "../scripts/lib/hashtags.mjs";
import { RetryableError, NonRetryableError, isRetryableError, withRetry } from "../scripts/lib/gemini-retry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Catalog thật từ assets/actions/actions.json, dựng cùng hình dạng với loadActionCatalog().
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "actions", "actions.json"), "utf8"));
const actions = raw.actions || raw;
const catalog = {
  actions,
  allIds: actions.map((a) => a.id),
  jewelryIds: actions.filter((a) => a.prop === "jewelry").map((a) => a.id),
  generalIds: actions.filter((a) => a.prop !== "jewelry").map((a) => a.id),
};
const hashtagCfg = loadHashtagConfig(); // config/hashtags.json THẬT

test("buildComparePrompt (config thật): không throw, prompt chứa mọi tag chủ đề kèm nhóm", () => {
  const { systemPrompt, userPrompt, responseSchema } = buildComparePrompt({
    catalog,
    hashtagCfg,
    topicHint: "gợi ý",
    angleInstruction: "góc độ X",
  });
  assert.ok(hashtagCfg.topic.length >= 10);
  for (const t of hashtagCfg.topic) assert.ok(systemPrompt.includes(`${t.tag} (nhóm: ${t.group})`), t.tag);
  assert.ok(!systemPrompt.includes("${"), "không còn placeholder chưa nội suy");
  assert.ok(systemPrompt.includes("(danh sách trống)") === false);
  assert.match(userPrompt, /gợi ý/);
  assert.match(userPrompt, /góc độ X/);
  assert.ok(responseSchema.required.includes("materials"));
});

test("buildComparePrompt: yêu cầu trả materials / topicTags / suggestedTags; schema ép topicTags theo whitelist", () => {
  const { systemPrompt, responseSchema } = buildComparePrompt({ catalog, hashtagCfg });
  for (const f of ["materials", "topicTags", "suggestedTags"]) {
    assert.ok(systemPrompt.includes(`"${f}"`), f);
    assert.ok(responseSchema.required.includes(f), f);
    assert.equal(responseSchema.properties[f].type, "array");
  }
  assert.deepEqual(responseSchema.properties.topicTags.items.enum, hashtagCfg.topic.map((t) => t.tag));
});

test("buildComparePrompt: whitelist rỗng vẫn không throw, schema không có enum rỗng", () => {
  const empty = { topic: [], materials: new Map(), materialGroups: new Map(), blocked: new Set(), groupOf: new Map() };
  const { systemPrompt, responseSchema } = buildComparePrompt({ catalog, hashtagCfg: empty });
  assert.ok(systemPrompt.includes("(danh sách trống)"));
  assert.equal(responseSchema.properties.topicTags.items.enum, undefined);
});

// ---- Phân loại lỗi retry ----------------------------------------------------------------------
const noSleep = async () => {};
const opts = { maxAttempts: 3, baseDelayMs: 1, label: "Gemini call", sleepFn: noSleep };
const silence = (fn) => async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    await fn();
  } finally {
    console.warn = warn;
  }
};

test("isRetryableError: chỉ RetryableError", () => {
  assert.equal(isRetryableError(new RetryableError("503")), true);
  assert.equal(isRetryableError(new NonRetryableError("403")), false);
  for (const E of [ReferenceError, TypeError, SyntaxError, RangeError, Error]) assert.equal(isRetryableError(new E("x")), false, E.name);
});

test("lỗi lập trình (ReferenceError/TypeError/SyntaxError) throw NGAY, không retry", silence(async () => {
  for (const E of [ReferenceError, TypeError, SyntaxError]) {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => { calls++; throw new E("topicLines is not defined"); }, opts),
      (e) => e instanceof E && /topicLines/.test(e.message),
    );
    assert.equal(calls, 1, E.name);
  }
}));

test("NonRetryableError (401/403/400, safety block) throw ngay, không retry", silence(async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new NonRetryableError("HTTP 403"); }, opts), NonRetryableError);
  assert.equal(calls, 1);
}));

test("RetryableError (503/429/timeout/fetch) được retry rồi thành công", silence(async () => {
  let calls = 0;
  const out = await withRetry(async (attempt) => {
    calls++;
    if (attempt < 3) throw new RetryableError(attempt === 1 ? "HTTP 503" : "timeout");
    return "ok";
  }, opts);
  assert.equal(out, "ok");
  assert.equal(calls, 3);
}));

test("RetryableError liên tục -> dừng sau maxAttempts với lỗi cuối", silence(async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new RetryableError("HTTP 429"); }, opts),
    /thất bại sau 3 lần thử.*HTTP 429/,
  );
  assert.equal(calls, 3);
}));

test("lỗi lập trình xuất hiện GIỮA chừng (sau 1 lần 503) vẫn throw ngay, không retry tiếp", silence(async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async (attempt) => {
      calls++;
      if (attempt === 1) throw new RetryableError("HTTP 503");
      throw new ReferenceError("boom");
    }, opts),
    ReferenceError,
  );
  assert.equal(calls, 2);
}));

test("prompt cho phép topicTags = [] khi nội dung ngoài ngành; schema không ép tối thiểu", () => {
  const { systemPrompt, responseSchema } = buildComparePrompt({ catalog, hashtagCfg });
  assert.match(systemPrompt, /KHÔNG thuộc ngành trang sức/);
  assert.match(systemPrompt, /trả mảng rỗng \[\]/);
  assert.equal(responseSchema.properties.topicTags.minItems, undefined);
  assert.ok(responseSchema.required.includes("topicTags")); // vẫn phải có field, nhưng được là []
});
