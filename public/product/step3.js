// Bước 3 — dựng video: danh sách khâu, log, lỗi (thử lại / dựng lại / quay lại Bước 2), thành công + chi phí THỰC TẾ + cờ AI + phiên bản thị trường khác.
import { buildErrorHint } from "/shared/build-error-hints.mjs";
import { h, clear, fmtVnd, api, note } from "./dom.js";

const STATE_LABEL = { pending: "Chưa chạy", running: "Đang chạy", done: "Xong", error: "Lỗi" };
const STATE_MARK = { pending: "", running: "", done: "✓", error: "!" };
const TASK_LABEL = { "content-generation:product-analysis": "Phân tích sản phẩm (Gemini nhìn ảnh)", "content-generation:product-script": "Viết kịch bản", "content-generation:product-check": "Kiểm ảnh cảnh", "product-image": "Ảnh AI (tạo/sửa)", "product-clip": "Clip AI mở đầu", tts: "Giọng đọc", "product-scene": "Quyết định miễn phí (pose/cắt/sản phẩm)" };
const KEY = "acv.product.activeJob";

export function createStep3(ctx) {
  const { state } = ctx;
  const root = h("section", { class: "step-section", id: "pd-step-3" });
  const stages = h("ol", { class: "build-stages", "aria-label": "Các khâu dựng video" });
  const conn = h("p", { class: "build-connection-note hidden", role: "status" });
  const log = h("pre", { class: "terminal-body", id: "pd-log" });
  const errorCard = h("div", { class: "build-error-card hidden", role: "alert" });
  const successCard = h("div", { class: "success-card hidden" });
  let job = null;
  let timer = null;
  let busyAction = false;

  const btn = (label, cls, on) => h("button", { type: "button", class: `btn ${cls}`, text: label, on: { click: on } });

  function renderErrors() {
    clear(errorCard);
    const failed = job.stages.find((s) => s.status === "error") || job.stages[0];
    const err = failed.error || { message: "Lỗi không xác định." };
    errorCard.append(
      h("h3", { text: `Lỗi ở khâu “${failed.label}”` }), h("p", { text: err.message }), h("p", { class: "build-error-hint", text: err.hint || buildErrorHint(failed.id, err) }),
      h("details", { class: "build-error-tech" }, h("summary", { text: "Log kỹ thuật" }), h("pre", { text: [err.technical || err.message, "", "--- Log dựng (200 dòng cuối) ---", ...(job.log || []).slice(-200).map((l) => `${l.at} ${l.message}`)].join("\n") })),
      h("div", { class: "build-error-actions" },
        btn(`Thử lại từ khâu “${failed.label}”`, "btn-primary", () => act("retry")),
        btn("Quay lại Bước 2", "btn-secondary", () => { stop(); ctx.goto(2); }),
        btn("Dựng lại từ đầu", "btn-secondary", () => { if (confirm("Dựng lại từ đầu sẽ xoá project dựng dở và sinh lại giọng đọc. Kịch bản và ảnh cảnh giữ nguyên. Tiếp tục?")) act("restart"); })),
    );
  }

  async function renderSuccess() {
    clear(successCard);
    const r = job.result || {};
    const rows = Object.entries(r.cost?.byTask || {}).filter(([, v]) => v > 0);
    successCard.append(...[
      h("h3", { text: "ĐÃ DỰNG VIDEO THÀNH CÔNG!" }),
      h("p", { text: `Video “${r.slug}” đã được dựng và kiểm tra xong.` }),
      r.renderUrl ? h("video", { class: "pd-final", src: r.renderUrl, controls: true, playsInline: true, preload: "metadata" }) : null,
      r.aiGenerated ? note("Video có dùng ảnh/clip AI (nguồn gemini/tự tải) — đã gắn cờ ai_generated. Khi đăng bài, hãy bật nhãn nội dung AI.", "info") : null,
      h("div", { class: "pd-cost" },
        h("strong", { text: "Chi phí thực tế của video này" }),
        h("table", {}, rows.map(([k, v]) => h("tr", {}, h("td", { text: TASK_LABEL[k] || k }), h("td", { text: fmtVnd(v) }))),
          h("tr", { class: "pd-cost-total" }, h("td", { text: "Tổng" }), h("td", { text: fmtVnd(r.cost?.totalVnd || 0) })),
          h("tr", {}, h("td", { text: "Trần mỗi video" }), h("td", { text: fmtVnd(r.cost?.maxVnd || 0) }))),
        h("small", { class: "field-help", text: "Tính theo giá niêm yết trong sổ chi phí; gọi chữ/vision ở gói miễn phí thực tế 0đ." })),
      h("div", { class: "success-actions" },
        r.renderUrl ? h("a", { class: "btn btn-primary btn-large", href: r.renderUrl, target: "_blank", rel: "noopener", text: "Mở video" }) : null,
        btn("Tạo phiên bản cho thị trường khác", "btn-secondary", () => ctx.openMarketVersion(r.projectId)),
        btn("Tạo video mới", "btn-secondary", () => { forget(); ctx.reset(); })),
    ].filter(Boolean));
  }

  function render() {
    clear(stages);
    for (const s of job.stages) {
      stages.append(h("li", { class: "build-stage", dataset: { status: s.status }, "aria-current": s.status === "running" ? "step" : null },
        h("span", { class: "build-stage-mark", "aria-hidden": "true", text: STATE_MARK[s.status] || "" }),
        h("span", { class: "build-stage-text" }, h("span", { class: "build-stage-name", text: s.label }), h("span", { class: "build-stage-state", text: STATE_LABEL[s.status] || "" }))));
    }
    const text = (job.log || []).map((l) => l.message).join("\n") || "▶ Đang chờ khâu đầu tiên...";
    if (log.textContent !== `${text}\n`) { log.textContent = `${text}\n`; log.scrollTop = log.scrollHeight; }
    errorCard.classList.toggle("hidden", job.status !== "error");
    successCard.classList.toggle("hidden", job.status !== "success");
    if (job.status === "error") renderErrors();
    if (job.status === "success") renderSuccess();
  }

  const stop = () => clearTimeout(timer);
  const forget = () => { try { localStorage.removeItem(KEY); } catch { /* bộ nhớ bị chặn */ } };
  async function poll(id) {
    stop();
    try {
      job = await api(`/api/build-jobs/${encodeURIComponent(id)}`);
      conn.classList.add("hidden");
      render();
      if (job.status === "running" || job.status === "pending") timer = setTimeout(() => poll(id), 1000);
    } catch (err) {
      if (err.status === 404) { forget(); conn.textContent = "Không còn tìm thấy job dựng này trên server."; conn.classList.remove("hidden"); return; }
      conn.textContent = "Mất kết nối tới server — đang tự thử lại, việc dựng (nếu đang chạy) không bị mất.";
      conn.classList.remove("hidden");
      timer = setTimeout(() => poll(id), 2000);
    }
  }
  async function act(action) {
    if (!job || busyAction) return;
    busyAction = true;
    try {
      job = await api(`/api/build-jobs/${encodeURIComponent(job.id)}/${action}`, { method: "POST" });
      render();
      poll(job.id);
    } catch (err) {
      conn.textContent = `Chưa thực hiện được: ${err.message}`;
      conn.classList.remove("hidden");
    } finally { busyAction = false; }
  }

  root.append(h("div", { class: "section-card" },
    h("div", { class: "card-header" }, h("h2", { text: "Bước 3: Dựng video" }), h("p", { text: "Sinh giọng HuyK, tách nền sản phẩm, ghép âm thanh -14 LUFS, dựng cảnh GSAP, render MP4 và kiểm tra." })),
    stages, conn, errorCard,
    h("div", { class: "terminal-box" }, h("div", { class: "terminal-header" }, h("div", { class: "terminal-dots" }, h("span", { class: "dot red" }), h("span", { class: "dot yellow" }), h("span", { class: "dot green" })), h("span", { class: "terminal-title", text: "BUILD LOG CONSOLE" })), log),
    successCard));

  return {
    el: root,
    watch(j) {
      try { localStorage.setItem(KEY, j.id); } catch { /* bộ nhớ bị chặn */ }
      job = j;
      render();
      poll(j.id);
    },
    stop,
    remembered() { try { return localStorage.getItem(KEY); } catch { return null; } },
  };
}
