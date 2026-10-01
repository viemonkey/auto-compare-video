// Sinh dữ liệu MẪU (giả lập) cho output/cost-ledger.jsonl — dùng để xem thử giao diện
// "Thống kê chi phí" (tab mới trong web UI, xem public/index.html § Cost Stats Modal) khi CHƯA
// có credit Gemini để dựng video thật và tạo dữ liệu chi phí thật.
//
// Mỗi dòng seed được đánh dấu thêm field "seed": true (KHÔNG có trong schema thật do
// scripts/lib/cost-ledger.mjs ghi — server.mjs/api/cost-stats bỏ qua field lạ khi tổng hợp) để
// sau này xoá lại được CHÍNH XÁC các dòng giả này, không đụng tới dữ liệu thật xen kẽ.
//
// ============================================================
// CÁCH DÙNG
// ============================================================
//   node scripts/seed-fake-cost-data.mjs            Thêm ~8 dòng mẫu vào output/cost-ledger.jsonl
//   node scripts/seed-fake-cost-data.mjs --clear     Xoá lại TẤT CẢ dòng mẫu (seed:true),
//                                                     giữ nguyên mọi dòng chi phí thật khác
//
// ⚠ QUAN TRỌNG: khi có credit Gemini trở lại và bắt đầu dựng video thật, hãy chạy
//   node scripts/seed-fake-cost-data.mjs --clear
// TRƯỚC để dọn sạch dữ liệu giả, tránh số liệu thống kê thật bị lẫn với số liệu demo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calcContentCost, calcImageCost } from "../config/pricing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "output");
const LEDGER_PATH = path.join(OUTPUT_DIR, "cost-ledger.jsonl");

const CONTENT_MODEL = "gemini-3.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image";

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function row(partial) {
  return {
    timestamp: partial.timestamp,
    slug: partial.slug ?? null,
    task: partial.task,
    model: partial.model,
    input_tokens: partial.inputTokens ?? null,
    output_tokens: partial.outputTokens ?? null,
    image_count: partial.imageCount ?? null,
    cost_usd: partial.status === "success" ? partial.costUsd || 0 : 0,
    status: partial.status,
    http_status: partial.httpStatus ?? null,
    error_message: partial.status === "error" ? partial.errorMessage || null : null,
    attempt: partial.attempt ?? 1,
    seed: true, // đánh dấu dòng giả lập — xem --clear ở đầu file
  };
}

// 3 video giả lập trải trong ~6 ngày gần đây, đủ đa dạng: thành công thẳng, có 1 lần 429 rồi
// retry thành công, và 1 lần content-generation lỗi hẳn (400, không sinh được video).
function buildFakeRows() {
  const rows = [];

  // --- Video 1: "kim-cuong-vs-than-da" — 6 ngày trước, chạy trơn tru ---
  {
    const slug = "kim-cuong-vs-than-da";
    const inTok = 1850;
    const outTok = 620;
    rows.push(
      row({
        timestamp: hoursAgo(6 * 24 + 2),
        slug,
        task: "content-generation",
        model: CONTENT_MODEL,
        status: "success",
        httpStatus: 200,
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: calcContentCost(CONTENT_MODEL, inTok, outTok),
        attempt: 1,
      }),
    );
    for (let i = 0; i < 3; i++) {
      rows.push(
        row({
          timestamp: hoursAgo(6 * 24 + 1),
          slug,
          task: "context-image",
          model: IMAGE_MODEL,
          status: "success",
          httpStatus: 200,
          imageCount: 1,
          costUsd: calcImageCost(IMAGE_MODEL, 1),
          attempt: 1,
        }),
      );
    }
  }

  // --- Video 2: "vang-24k-vs-vang-tay" — 2 ngày trước, có 1 lần 429 rồi retry thành công ---
  {
    const slug = "vang-24k-vs-vang-tay";
    const inTok = 2100;
    const outTok = 705;
    rows.push(
      row({
        timestamp: hoursAgo(2 * 24 + 3),
        slug,
        task: "content-generation",
        model: CONTENT_MODEL,
        status: "success",
        httpStatus: 200,
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: calcContentCost(CONTENT_MODEL, inTok, outTok),
        attempt: 1,
      }),
    );
    // lần 1 bị rate-limit — KHÔNG tính phí
    rows.push(
      row({
        timestamp: hoursAgo(2 * 24 + 2.05),
        slug,
        task: "context-image",
        model: IMAGE_MODEL,
        status: "error",
        httpStatus: 429,
        errorMessage: "HTTP 429 — Resource has been exhausted (check quota).",
        attempt: 1,
      }),
    );
    // lần 2 (retry) thành công — tính phí bình thường
    rows.push(
      row({
        timestamp: hoursAgo(2 * 24 + 2),
        slug,
        task: "context-image",
        model: IMAGE_MODEL,
        status: "success",
        httpStatus: 200,
        imageCount: 1,
        costUsd: calcImageCost(IMAGE_MODEL, 1),
        attempt: 2,
      }),
    );
    rows.push(
      row({
        timestamp: hoursAgo(2 * 24 + 1.5),
        slug,
        task: "context-image",
        model: IMAGE_MODEL,
        status: "success",
        httpStatus: 200,
        imageCount: 1,
        costUsd: calcImageCost(IMAGE_MODEL, 1),
        attempt: 1,
      }),
    );
  }

  // --- Video 3 (thất bại hẳn): "meo-anh-long-ngan-vs-meo-ba-tu" — hôm nay, request 400 ---
  // Gemini báo request không hợp lệ (vd ảnh hỏng) — dừng ngay, không retry, không tính phí, và
  // KHÔNG có video nào được tạo ra (không xuất hiện trong bảng "chi phí theo từng video" vì
  // slug=null — mô phỏng đúng luồng thật: content-generation ở Bước 1 UI chạy TRƯỚC khi slug
  // được chọn ở Bước 2, xem scripts/generate-compare-content.mjs).
  rows.push(
    row({
      timestamp: hoursAgo(3),
      slug: null,
      task: "content-generation",
      model: CONTENT_MODEL,
      status: "error",
      httpStatus: 400,
      errorMessage: "Gemini API báo request không hợp lệ (HTTP 400): ảnh không đọc được.",
      attempt: 1,
    }),
  );

  // --- Video 1 (bổ sung) có thêm 1 content-generation hôm nay để test "Hôm nay" > 0 ---
  {
    const slug = "kim-cuong-vs-than-da";
    const inTok = 1900;
    const outTok = 640;
    rows.push(
      row({
        timestamp: hoursAgo(1),
        slug,
        task: "content-generation",
        model: CONTENT_MODEL,
        status: "success",
        httpStatus: 200,
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: calcContentCost(CONTENT_MODEL, inTok, outTok),
        attempt: 1,
      }),
    );
  }

  return rows;
}

function seed() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const rows = buildFakeRows();
  const lines = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.appendFileSync(LEDGER_PATH, lines);
  console.log(`OK — đã thêm ${rows.length} dòng dữ liệu mẫu vào ${LEDGER_PATH}`);
  console.log(`Mở web UI (npm run ui) rồi bấm "💰 Thống kê chi phí" để xem.`);
  console.log(`Xoá dữ liệu mẫu sau khi test xong: node scripts/seed-fake-cost-data.mjs --clear`);
}

function clear() {
  if (!fs.existsSync(LEDGER_PATH)) {
    console.log("Chưa có output/cost-ledger.jsonl — không có gì để xoá.");
    return;
  }
  const raw = fs.readFileSync(LEDGER_PATH, "utf8");
  const kept = [];
  let removed = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.seed === true) {
        removed++;
        continue;
      }
      kept.push(trimmed);
    } catch {
      kept.push(trimmed); // dòng hỏng — giữ nguyên, không đoán bừa là seed hay không
    }
  }
  fs.writeFileSync(LEDGER_PATH, kept.length ? kept.join("\n") + "\n" : "");
  console.log(`OK — đã xoá ${removed} dòng dữ liệu mẫu. Còn lại ${kept.length} dòng (dữ liệu thật, nếu có).`);
}

const args = process.argv.slice(2);
if (args.includes("--clear")) {
  clear();
} else {
  seed();
}
