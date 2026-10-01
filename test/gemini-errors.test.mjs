import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RetryableError,
  NonRetryableError,
  DailyQuotaError,
  RETRY_DELAY_PADDING_MS,
  parseGeminiError,
  parseRetryDelay,
  classifyGeminiHttpError,
  describeGeminiErrorForLog,
  extractFailureMessage,
  redactKey,
  retryWaitMs,
  runWithModelFallback,
  withRetry,
} from "../scripts/lib/gemini-retry.mjs";

const MODEL = "gemini-3.5-flash";
const FAKE_KEY = "AIzaSyFAKEKEYFORTESTING1234567890abcd";

// ---- Response mẫu ---------------------------------------------------------------------------
const body429Minute = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota, please check your plan and billing details.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.Help", links: [{ description: "Learn more", url: "https://ai.google.dev/gemini-api/docs/rate-limits" }] },
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
            quotaDimensions: { location: "global", model: MODEL },
            quotaValue: "5",
          },
        ],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "10s" },
    ],
  },
});

const body429Day = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          {
            quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
            quotaDimensions: { location: "global", model: MODEL },
            quotaValue: "20",
          },
        ],
      },
      // Có RetryInfo nhưng quota NGÀY thì vẫn không được retry
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "40s" },
    ],
  },
});

const body429Bare = JSON.stringify({ error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } });

const body503 = JSON.stringify({
  error: {
    code: 503,
    message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
    status: "UNAVAILABLE",
  },
});

const noJson = (msg) => {
  assert.ok(!/[{}]|RESOURCE_EXHAUSTED|UNAVAILABLE|"error"|@type/.test(msg), `thông báo còn lộ JSON: ${msg}`);
};

// ---- Parse ------------------------------------------------------------------------------------
test("parseRetryDelay: '10s', '10.5s', số; không hợp lệ -> null", () => {
  assert.equal(parseRetryDelay("10s"), 10000);
  assert.equal(parseRetryDelay("10.5s"), 10500);
  assert.equal(parseRetryDelay("2"), 2000);
  assert.equal(parseRetryDelay(3), 3000);
  assert.equal(parseRetryDelay("abc"), null);
  assert.equal(parseRetryDelay(undefined), null);
});

test("parseGeminiError: đọc RetryInfo + QuotaFailure (PerMinute)", () => {
  const i = parseGeminiError(429, body429Minute);
  assert.equal(i.code, 429);
  assert.equal(i.status, "RESOURCE_EXHAUSTED");
  assert.equal(i.retryDelayMs, 10000);
  assert.equal(i.quotaId, "GenerateRequestsPerMinutePerProjectPerModel-FreeTier");
  assert.match(i.quotaMetric, /generate_content_free_tier_requests/);
  assert.equal(i.quotaScope, "minute");
});

test("parseGeminiError: PerDay -> scope day; body không phải JSON không throw", () => {
  assert.equal(parseGeminiError(429, body429Day).quotaScope, "day");
  const bad = parseGeminiError(502, "<html>Bad gateway</html>");
  assert.equal(bad.httpStatus, 502);
  assert.equal(bad.retryDelayMs, null);
  assert.equal(parseGeminiError(429, "").quotaScope, null);
});

// ---- 429 theo phút / RetryInfo -----------------------------------------------------------------
test("429 có RetryInfo: RetryableError, retryAfterMs=10000, thông báo tiếng Việt 'sau 10 giây', không lộ JSON", () => {
  const err = classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Minute, model: MODEL });
  assert.ok(err instanceof RetryableError);
  assert.ok(!(err instanceof DailyQuotaError));
  assert.equal(err.retryAfterMs, 10000);
  assert.equal(err.userMessage, "Gemini đang giới hạn tốc độ, vui lòng thử lại sau 10 giây.");
  noJson(err.userMessage);
  noJson(err.message);
});

test("429 không có RetryInfo/QuotaFailure: retryable, retryAfterMs null, báo mặc định 60 giây", () => {
  const err = classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Bare, model: MODEL });
  assert.ok(err instanceof RetryableError);
  assert.equal(err.retryAfterMs, null);
  assert.equal(err.userMessage, "Gemini đang giới hạn tốc độ, vui lòng thử lại sau 60 giây.");
});

test("retry 429: đợi ĐÚNG retryDelay + padding, không dùng backoff cố định", async () => {
  const waits = [];
  const err = classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Minute, model: MODEL });
  assert.equal(retryWaitMs(err, 1, 1500), 10000 + RETRY_DELAY_PADDING_MS);
  assert.ok(RETRY_DELAY_PADDING_MS >= 1000 && RETRY_DELAY_PADDING_MS <= 2000);

  const out = await withRetry(
    async (attempt) => {
      if (attempt < 3) throw classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Minute, model: MODEL });
      return "ok";
    },
    { maxAttempts: 3, baseDelayMs: 1500, sleepFn: async (ms) => waits.push(ms), onRetryableError: () => {} },
  );
  assert.equal(out, "ok");
  assert.deepEqual(waits, [11500, 11500]);
});

test("retry không có retryDelay (429 trơn, 503): dùng backoff hiện tại base*attempt", async () => {
  const waits = [];
  await assert.rejects(
    withRetry(
      async () => {
        throw classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Bare, model: MODEL });
      },
      { maxAttempts: 3, baseDelayMs: 1500, sleepFn: async (ms) => waits.push(ms), onRetryableError: () => {} },
    ),
  );
  assert.deepEqual(waits, [1500, 3000]); // lần cuối không đợi
});

test("hết lượt retry 429: lỗi cuối giữ thông báo tiếng Việt (userMessage), message không lộ JSON", async () => {
  await assert.rejects(
    withRetry(
      async () => {
        throw classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Minute, model: MODEL });
      },
      { maxAttempts: 2, baseDelayMs: 1, sleepFn: async () => {}, onRetryableError: () => {} },
    ),
    (e) => {
      assert.equal(e.userMessage, "Gemini đang giới hạn tốc độ, vui lòng thử lại sau 10 giây.");
      noJson(e.message);
      return true;
    },
  );
});

// ---- 429 hết quota ngày ------------------------------------------------------------------------
test("429 PerDay: DailyQuotaError, KHÔNG retry (kể cả có RetryInfo), thông báo đúng mẫu + tên model", async () => {
  const err = classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Day, model: MODEL });
  assert.ok(err instanceof DailyQuotaError);
  assert.ok(err instanceof NonRetryableError);
  assert.ok(!(err instanceof RetryableError));
  assert.equal(
    err.userMessage,
    `Đã hết lượt gọi Gemini trong ngày của model ${MODEL}. Thử lại vào ngày mai hoặc đổi model/nâng gói.`,
  );
  noJson(err.userMessage);
  noJson(err.message);

  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw err;
      },
      { maxAttempts: 3, baseDelayMs: 1, sleepFn: async () => {} },
    ),
    DailyQuotaError,
  );
  assert.equal(calls, 1);
});

test("quota ngày: chuyển GEMINI_FALLBACK_MODEL nếu có, dùng model dự phòng đó", async () => {
  const used = [];
  const logs = [];
  const out = await runWithModelFallback({
    primaryModel: "gemini-a",
    fallbackModel: "gemini-b",
    run: async (model) => {
      used.push(model);
      if (model === "gemini-a") throw classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Day, model });
      return { model, content: "ok" };
    },
    log: (m) => logs.push(m),
  });
  assert.deepEqual(used, ["gemini-a", "gemini-b"]);
  assert.equal(out.model, "gemini-b");
  assert.match(logs[0], /gemini-a.*gemini-b/);
});

test("quota ngày: không có fallback (hoặc trùng model chính) -> báo lỗi ngay, không gọi thêm", async () => {
  for (const fallbackModel of ["", undefined, "gemini-a"]) {
    const used = [];
    await assert.rejects(
      runWithModelFallback({
        primaryModel: "gemini-a",
        fallbackModel,
        run: async (model) => {
          used.push(model);
          throw classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Day, model });
        },
      }),
      (e) => e instanceof DailyQuotaError && /Đã hết lượt gọi Gemini trong ngày của model gemini-a/.test(e.userMessage),
    );
    assert.deepEqual(used, ["gemini-a"]);
  }
});

test("quota ngày: fallback cũng hết quota ngày -> lỗi của model dự phòng, không lặp vô hạn", async () => {
  const used = [];
  await assert.rejects(
    runWithModelFallback({
      primaryModel: "gemini-a",
      fallbackModel: "gemini-b",
      run: async (model) => {
        used.push(model);
        throw classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Day, model });
      },
    }),
    (e) => e instanceof DailyQuotaError && e.userMessage.includes("gemini-b"),
  );
  assert.deepEqual(used, ["gemini-a", "gemini-b"]);
});

test("lỗi khác quota ngày (429 phút, 503, lỗi lập trình) KHÔNG kích hoạt model dự phòng", async () => {
  const errors = [
    classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Minute, model: "gemini-a" }),
    classifyGeminiHttpError({ httpStatus: 503, bodyText: body503, model: "gemini-a" }),
    new ReferenceError("x is not defined"),
  ];
  for (const e of errors) {
    const used = [];
    await assert.rejects(
      runWithModelFallback({
        primaryModel: "gemini-a",
        fallbackModel: "gemini-b",
        run: async (model) => {
          used.push(model);
          throw e;
        },
      }),
      (thrown) => thrown === e,
    );
    assert.deepEqual(used, ["gemini-a"]);
  }
});

// ---- 503 ---------------------------------------------------------------------------------------
test("503: RetryableError, backoff cố định (không retryDelay), thông báo 'quá tải' tiếng Việt không lộ JSON", () => {
  const err = classifyGeminiHttpError({ httpStatus: 503, bodyText: body503, model: MODEL });
  assert.ok(err instanceof RetryableError);
  assert.equal(err.retryAfterMs, null);
  assert.equal(err.userMessage, "Gemini đang quá tải, vui lòng thử lại sau vài phút.");
  noJson(err.userMessage);
  noJson(err.message);
});

test("hết lượt retry 503: lỗi cuối giữ thông báo 'quá tải'", async () => {
  await assert.rejects(
    withRetry(
      async () => {
        throw classifyGeminiHttpError({ httpStatus: 503, bodyText: body503, model: MODEL });
      },
      { maxAttempts: 3, baseDelayMs: 1, sleepFn: async () => {}, onRetryableError: () => {} },
    ),
    (e) => e.userMessage === "Gemini đang quá tải, vui lòng thử lại sau vài phút." && !/[{}]/.test(e.message),
  );
});

test("400 / 401 / 403: NonRetryable, thông báo tiếng Việt không kèm body gốc", () => {
  for (const status of [400, 401, 403]) {
    const err = classifyGeminiHttpError({ httpStatus: status, bodyText: `{"error":{"code":${status},"message":"API key not valid"}}`, model: MODEL });
    assert.ok(err instanceof NonRetryableError, String(status));
    assert.ok(!(err instanceof RetryableError));
    assert.ok(!err.userMessage.includes("API key not valid"));
    noJson(err.userMessage);
  }
});

test("5xx khác (500/502/504): retryable, thông báo tiếng Việt", () => {
  const err = classifyGeminiHttpError({ httpStatus: 502, bodyText: "<html>Bad gateway</html>", model: MODEL });
  assert.ok(err instanceof RetryableError);
  assert.match(err.userMessage, /HTTP 502/);
  assert.ok(!err.userMessage.includes("<html>"));
});

// ---- Log server ---------------------------------------------------------------------------------
test("log server: ghi model, mã lỗi, quotaId, retryDelay, body gốc; KHÔNG lộ API key", () => {
  const err = classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Minute, model: MODEL });
  const line = describeGeminiErrorForLog(err, { bodyText: body429Minute, apiKey: FAKE_KEY });
  assert.ok(!line.includes("\n"), "log 1 dòng");
  assert.match(line, /model=gemini-3\.5-flash/);
  assert.match(line, /http=429/);
  assert.match(line, /status=RESOURCE_EXHAUSTED/);
  assert.match(line, /quotaId=GenerateRequestsPerMinutePerProjectPerModel-FreeTier/);
  assert.match(line, /retryDelay=10s/);
  assert.match(line, /scope=minute/);
  assert.match(line, /raw=/); // JSON gốc CHỈ nằm ở log

  const leaky = describeGeminiErrorForLog(err, {
    bodyText: JSON.stringify({ error: { message: `bad url https://x/v1beta/models/m:generateContent?key=${FAKE_KEY}` } }),
    apiKey: FAKE_KEY,
  });
  assert.ok(!leaky.includes(FAKE_KEY));
});

test("redactKey: che chuỗi AIza... và key truyền vào", () => {
  assert.ok(!redactKey(`url?key=${FAKE_KEY}`).includes(FAKE_KEY));
  assert.equal(redactKey("token=abcdefgh12345", "abcdefgh12345"), "token=****");
  assert.equal(redactKey(undefined), "");
});

// ---- Thông báo cho UI ---------------------------------------------------------------------------
test("extractFailureMessage: UI chỉ nhận dòng 'THẤT BẠI:' tiếng Việt, không nhận JSON/log kỹ thuật", () => {
  const err = classifyGeminiHttpError({ httpStatus: 429, bodyText: body429Minute, model: MODEL });
  const out = [
    "Gemini model: gemini-3.5-flash",
    `[gemini-error] ${describeGeminiErrorForLog(err, { bodyText: body429Minute })}`,
    "[attempt 1/3] Gemini API lỗi HTTP 429: rate limit — thử lại sau 11.5s",
    "",
    `THẤT BẠI: ${err.userMessage}`,
    "",
  ].join("\n");
  const msg = extractFailureMessage(out);
  assert.equal(msg, "Gemini đang giới hạn tốc độ, vui lòng thử lại sau 10 giây.");
  noJson(msg);
});

test("extractFailureMessage: không có dòng THẤT BẠI -> vài dòng cuối; rỗng -> thông báo mặc định", () => {
  assert.equal(extractFailureMessage("a\nb\nc"), "a\nb\nc");
  assert.equal(extractFailureMessage(""), "Gemini thất bại.");
  assert.equal(extractFailureMessage(undefined), "Gemini thất bại.");
});
