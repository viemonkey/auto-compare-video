// M4 — chặn đăng nhầm: video chỉ được ghép với page CÙNG thị trường, kiểm ở CẢ lúc enqueue và lúc chọn page để đăng
// (kể cả dữ liệu queue cũ thiếu locale). Test kiểm tra quy tắc, không phụ thuộc số lượng/tên locale cụ thể.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-locale-"));
process.env.SOCIAL_QUEUE_PATH = path.join(dir, "social-queue.json");
const Q = await import("../scripts/lib/social-queue.mjs");
const { inspectPages } = await import("../scripts/lib/fb-config.mjs");
const { inspectConfiguredPages } = await import("../scripts/lib/facebook-pages.mjs");
const { listLocales, getDefaultLocale } = await import("../scripts/lib/locales.mjs");

beforeEach(() => {
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
});

const DEF = getDefaultLocale().code;
const OTHER = listLocales().find((l) => l.code !== DEF).code;
const THIRD = listLocales().find((l) => l.code !== DEF && l.code !== OTHER)?.code ?? "zz-ZZ";
const page = (id, locale) => ({ id, name: `P-${id}`, accessToken: `tok-${id}-aaaaaaaaaaaa`, ...(locale ? { locale } : {}) });
const GAP = [30, 60];

// ---------------------------------------------------------------------------------------------
// cấu hình page
// ---------------------------------------------------------------------------------------------
const env = (extra) => ({ FB_PAGE_1_ID: "1", FB_PAGE_1_ACCESS_TOKEN: "token-1-aaaaaaaaaaaa", FB_PAGE_2_ID: "2", FB_PAGE_2_ACCESS_TOKEN: "token-2-aaaaaaaaaaaa", ...extra });

test("FB_PAGE_n_LOCALE: không đặt -> thị trường mặc định; đặt hợp lệ -> dùng; không hợp lệ -> bỏ page + báo lỗi", () => {
  const { pages, problems } = inspectConfiguredPages(env({ FB_PAGE_2_LOCALE: OTHER }));
  assert.deepEqual(pages.map((p) => [p.id, p.locale]), [["1", DEF], ["2", OTHER]]);
  assert.deepEqual(problems, []);

  const bad = inspectConfiguredPages(env({ FB_PAGE_2_LOCALE: "xx-XX" }));
  assert.deepEqual(bad.pages.map((p) => p.id), ["1"], "page có locale sai bị bỏ qua — đăng nhầm tệ hơn không đăng");
  assert.ok(bad.problems.some((p) => p.includes("FB_PAGE_2_LOCALE") && p.includes("xx-XX")));

  // inspectPages trần (không resolver) vẫn chạy như cũ
  const raw = inspectPages(env({}));
  assert.equal(raw.pages.length, 2);
});

// ---------------------------------------------------------------------------------------------
// ghép video <-> page
// ---------------------------------------------------------------------------------------------
test("pagesForLocale: chỉ page cùng locale (page thiếu locale = mặc định)", () => {
  const pages = [page("a"), page("b", OTHER), page("c", DEF)];
  assert.deepEqual(Q.pagesForLocale(pages, DEF, DEF).map((p) => p.id), ["a", "c"]);
  assert.deepEqual(Q.pagesForLocale(pages, OTHER, DEF).map((p) => p.id), ["b"]);
  assert.deepEqual(Q.pagesForLocale(pages, THIRD, DEF), []);
  assert.deepEqual(Q.pagesForLocale(pages, undefined, DEF).map((p) => p.id), ["a", "c"], "locale video thiếu = mặc định");
  assert.equal(Q.jobLocale({}, DEF), DEF);
  assert.equal(Q.jobLocale({ locale: OTHER }, DEF), OTHER);
});

test("enqueue: không có page cùng locale -> KHÔNG vào queue, có lý do rõ ràng", () => {
  const pages = [page("a", DEF)];
  const r = Q.tryEnqueueVideo({ slug: "x-ja", videoPath: "/v.mp4", caption: "c", locale: OTHER }, { pages, defaultCode: DEF });
  assert.equal(r.status, "no-page-for-locale");
  assert.ok(r.reason.includes(OTHER) && r.reason.includes("x-ja"), r.reason);
  assert.equal(Q.loadQueue().queue.length, 0, "không enqueue");

  const ok = Q.tryEnqueueVideo({ slug: "x", videoPath: "/v.mp4", caption: "c", locale: DEF }, { pages, defaultCode: DEF });
  assert.equal(ok.status, "enqueued");
  assert.equal(ok.item.locale, DEF);
  assert.equal(Q.tryEnqueueVideo({ slug: "x", videoPath: "/v.mp4", caption: "c", locale: DEF }, { pages, defaultCode: DEF }).status, "duplicate");

  // video thiếu locale được coi là mặc định và gắn nhãn locale mặc định vào job
  const noLoc = Q.tryEnqueueVideo({ slug: "y", videoPath: "/v.mp4", caption: "c" }, { pages, defaultCode: DEF });
  assert.equal(noLoc.item.locale, DEF);
});

test("chọn page để đăng: video thị trường khác KHÔNG BAO GIỜ gán cho page thị trường mặc định (kể cả khi page kia rảnh hơn)", () => {
  const queue = [{ id: "j1", slug: "v-other", status: "pending", locale: OTHER }];
  const pages = [page("def-1", DEF), page("def-2"), page("oth", OTHER)];
  const now = Date.parse("2026-01-01T12:00:00Z");
  // page cùng locale vừa đăng (đang nghỉ), page mặc định thì rảnh -> vẫn không được dùng
  const hist = { oth: { lastPostedAt: new Date(now - 1000).toISOString() } };
  for (let i = 0; i < 50; i++) {
    const sel = Q.selectJobAndPage(queue, pages, hist, ...GAP, {}, DEF, now);
    assert.equal(sel.job, null);
    assert.equal(sel.page, null);
  }
  // khi page cùng locale rảnh: chọn đúng nó
  for (let i = 0; i < 20; i++) {
    const sel = Q.selectJobAndPage(queue, pages, {}, ...GAP, {}, DEF, now);
    assert.equal(sel.page.id, "oth");
    assert.equal(sel.job.id, "j1");
  }
});

test("dữ liệu queue CŨ (thiếu locale) = thị trường mặc định: chỉ được gán cho page mặc định, không bao giờ cho page thị trường khác", () => {
  const queue = [{ id: "old", slug: "video-cu", status: "pending" }]; // job cũ, không có locale
  const pages = [page("oth", OTHER), page("def", DEF)];
  for (let i = 0; i < 30; i++) {
    const sel = Q.selectJobAndPage(queue, pages, {}, ...GAP, {}, DEF);
    assert.equal(sel.page.id, "def");
  }
  // chỉ còn page thị trường khác -> job cũ không có chỗ đăng, không đăng nhầm
  const onlyOther = Q.selectJobAndPage(queue, [page("oth", OTHER)], {}, ...GAP, {}, DEF);
  assert.equal(onlyOther.page, null);
  assert.deepEqual(onlyOther.orphaned.map((j) => j.id), ["old"]);
});

test("job mà thị trường không có page nào: báo orphaned và KHÔNG chặn job phía sau", () => {
  const queue = [
    { id: "j-orphan", slug: "a", status: "pending", locale: THIRD },
    { id: "j-ok", slug: "b", status: "pending", locale: DEF },
    { id: "j-done", slug: "c", status: "posted", locale: DEF },
  ];
  const sel = Q.selectJobAndPage(queue, [page("def", DEF)], {}, ...GAP, {}, DEF);
  assert.equal(sel.job.id, "j-ok");
  assert.equal(sel.page.id, "def");
  assert.deepEqual(sel.orphaned.map((j) => j.id), ["j-orphan"]);
});

test("job đang chờ retry (nextAttemptAt tương lai) bị bỏ qua; page bị tắt không được chọn", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const queue = [
    { id: "wait", slug: "a", status: "pending", locale: DEF, nextAttemptAt: new Date(now + 60_000).toISOString() },
    { id: "go", slug: "b", status: "pending", locale: DEF },
  ];
  const sel = Q.selectJobAndPage(queue, [page("def", DEF)], {}, ...GAP, {}, DEF, now);
  assert.equal(sel.job.id, "go");
  const disabled = { def: { tokenFingerprint: Q.fingerprintToken("tok-def-aaaaaaaaaaaa") } };
  assert.equal(Q.selectJobAndPage(queue, [page("def", DEF)], {}, ...GAP, disabled, DEF, now).page, null);
});

test("assertPageMatchesJob: chốt chặn cuối ném lỗi khi page khác thị trường với video", () => {
  assert.doesNotThrow(() => Q.assertPageMatchesJob(page("a", OTHER), { slug: "s", locale: OTHER }, DEF));
  assert.doesNotThrow(() => Q.assertPageMatchesJob(page("a"), { slug: "s" }, DEF), "cả hai thiếu locale = mặc định");
  assert.throws(() => Q.assertPageMatchesJob(page("a", DEF), { slug: "s", locale: OTHER }, DEF), /Chặn đăng nhầm/);
  assert.throws(() => Q.assertPageMatchesJob(page("a", OTHER), { slug: "s" }, DEF), /Chặn đăng nhầm/);
});
