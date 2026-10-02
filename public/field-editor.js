// Trình soạn 1 dòng hiển thị ở Bước 2: dòng chính (ô nhập chữ ngôn ngữ đích, do app.js cung cấp) + dòng nghĩa tiếng Việt
// màu nhạt bên dưới + cảnh báo theo dòng. Sửa ý bằng tiếng Việt (✎ -> "Viết lại bằng <ngôn ngữ>") và dịch lại nghĩa (↻) đều chỉ gọi
// Gemini cho ĐÚNG dòng này. Chống race bằng createLatestRunner (requestId + AbortController); nút bị khoá trong lúc chờ.
import { warningsForField, readingSeconds } from "/shared/field-warnings.mjs";
import { createLatestRunner, STALE } from "/shared/latest-request.mjs";
import { rewriteFeedback, translateFeedback, friendlyError } from "/shared/edit-feedback.mjs";

const NOTICE_MS = 10_000; // so sánh ý / thông báo tự ẩn sau chừng này (hoặc người dùng đóng)

const ICON_CLASS = { "too-long": "warn", "forbidden-phrase": "danger", "glossary-term": "warn", "missing-vi": "info", "fact-mismatch": "danger" };

async function postJson(url, body, signal) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * @param {object} o
 * @param {"title"|"label_left"|"label_right"|"text"|"tag"|"sub"} o.kind
 * @param {HTMLInputElement} o.inputEl         ô nhập chữ ngôn ngữ đích (đã có trong DOM)
 * @param {{vi:string, baseText:string}} o.state  nghĩa tiếng Việt hiện có + chữ đích tại thời điểm nghĩa đó đúng (stale = text != baseText)
 * @param {() => object|null} o.getRules       luật của thị trường (GET /api/locale-rules) — null: chưa tải
 * @param {() => string} o.getLocaleCode
 * @param {() => object} o.getContext          ngữ cảnh gửi kèm khi viết lại (các dòng khác của video)
 * @param {() => string|null} o.getPendingSlug
 * @param {(delta:number) => void} o.onBusy    +1 khi bắt đầu chờ AI, -1 khi xong (app dùng để khoá nút dựng)
 * @param {() => void} [o.onChange]
 */
export function createFieldEditor(o) {
  const runner = createLatestRunner();
  let destroyed = false;
  let busy = false;

  // 1 khối (card) liền mạch: câu chính (ô nhập) ở trên, đường kẻ 1px, dòng nghĩa tiếng Việt ngay dưới; thời gian đọc + ✎ ↻ ở góc phải dưới.
  // Cảnh báo / lỗi / so sánh ý nằm DƯỚI card. `wrap` thay chỗ ô nhập trong DOM (app.js không phải tạo host).
  const wrap = el("div", "bi-field");
  wrap.dataset.kind = o.kind;
  const card = el("div", "bi-card");
  const viLine = el("div", "bi-gloss");
  const viLabel = el("span", "bi-gloss-label", "VI");
  viLabel.title = "Nghĩa tiếng Việt";
  const viText = el("span", "bi-vi-text");
  const stale = el("span", "bi-stale hidden", "Nghĩa chưa cập nhật");
  const viActions = el("span", "bi-vi-actions");
  const reading = el("span", "bi-reading hidden");
  const btnEdit = el("button", "bi-btn", "✎");
  btnEdit.type = "button";
  btnEdit.title = "Sửa ý bằng tiếng Việt rồi nhờ AI viết lại";
  const btnRe = el("button", "bi-btn", "↻");
  btnRe.type = "button";
  btnRe.title = "Dịch lại nghĩa tiếng Việt cho dòng này";
  viActions.append(stale, reading, btnEdit, btnRe);
  viLine.append(viLabel, viText);

  const editBox = el("div", "bi-edit hidden");
  const editText = el("textarea", "input-text bi-edit-text");
  editText.rows = 2;
  editText.placeholder = "Nhập ý mới bằng tiếng Việt…";
  const btnRewrite = el("button", "btn btn-small btn-primary");
  btnRewrite.type = "button";
  const btnCancel = el("button", "btn btn-small btn-secondary", "Huỷ");
  btnCancel.type = "button";
  editBox.append(editText, btnRewrite, btnCancel);

  const meta = el("div", "bi-meta");
  const warnLine = el("div", "bi-warn-line hidden"); // cảnh báo chỉ hiện khi có: viền màu ở ô + 1 dòng chữ nhỏ
  const errBox = el("div", "bi-error hidden");
  const notice = el("div", "bi-notice hidden");
  const noticeText = el("div", "bi-notice-text");
  const noticeCmp = el("div", "bi-notice-cmp");
  const btnNoticeClose = el("button", "bi-notice-close", "✕");
  btnNoticeClose.type = "button";
  btnNoticeClose.title = "Đóng";
  notice.append(noticeText, noticeCmp, btnNoticeClose);
  meta.append(warnLine, errBox, notice);

  const below = el("div", "bi-below");
  below.append(editBox, meta);
  o.inputEl.before(wrap);
  card.append(o.inputEl, viLine, viActions);
  wrap.append(card, below);

  const hasGloss = () => !!(o.getRules() && o.getRules().needsGloss);
  const isStale = () => o.inputEl.value.trim() !== (o.state.baseText || "").trim();

  function setBusy(v) {
    if (busy === v) return;
    busy = v;
    wrap.classList.toggle("is-busy", v);
    for (const b of [btnEdit, btnRe, btnRewrite, btnCancel]) b.disabled = v;
    editText.disabled = v;
    o.inputEl.disabled = v; // đang chờ AI ghi đè dòng này -> không cho gõ chen vào
    btnRewrite.textContent = v ? "⏳ Đang viết…" : `Viết lại bằng ${(o.getRules() || {}).languageName || "ngôn ngữ đích"}`;
    o.onBusy(v ? 1 : -1);
  }

  function showError(msg) {
    errBox.textContent = msg || "";
    errBox.classList.toggle("hidden", !msg);
  }

  let noticeTimer = null;
  function hideNotice() {
    clearTimeout(noticeTimer);
    notice.classList.add("hidden");
  }
  btnNoticeClose.addEventListener("click", hideNotice);
  /** @param {{message?:string, idea?:string, meaning?:string}} n */
  function showNotice({ message = "", idea = "", meaning = "" }) {
    clearTimeout(noticeTimer);
    noticeText.textContent = message;
    noticeText.classList.toggle("hidden", !message);
    noticeCmp.innerHTML = "";
    if (idea || meaning) {
      const row = (label, value) => {
        const r = el("div", "bi-cmp-row");
        r.append(el("span", "bi-cmp-label", label), el("span", "bi-cmp-value", value || "—"));
        return r;
      };
      noticeCmp.append(row("Ý bạn nhập", idea), row("Nghĩa câu mới", meaning));
    }
    notice.classList.remove("hidden");
    noticeTimer = setTimeout(hideNotice, NOTICE_MS);
  }

  function refresh() {
    if (destroyed) return;
    const rules = o.getRules();
    const gloss = !!(rules && rules.needsGloss);
    // Thị trường không có dòng nghĩa (tiếng Việt): chỉ giữ thời gian đọc của câu thoại, ẩn nghĩa + nút ✎.
    viLine.classList.toggle("hidden", !gloss);
    btnEdit.classList.toggle("hidden", !gloss);
    card.classList.toggle("no-gloss", !gloss);
    if (!rules) return;
    const text = o.inputEl.value;
    const staleNow = gloss && text.trim() !== "" && isStale();
    viText.textContent = o.state.vi ? o.state.vi : text.trim() ? "(chưa có nghĩa)" : "";
    viText.classList.toggle("is-stale", staleNow);
    card.classList.toggle("is-stale", staleNow);
    stale.classList.toggle("hidden", !staleNow);
    btnRe.classList.toggle("hidden", !(staleNow || (gloss && text.trim() !== "" && !o.state.vi)));
    btnRewrite.textContent = busy ? "⏳ Đang viết…" : `Viết lại bằng ${rules.languageName || "ngôn ngữ đích"}`;

    // Cảnh báo theo dòng (cùng module với server). Nghĩa đã cũ -> bỏ cảnh báo dựa vào nghĩa (đã có dấu "chưa cập nhật").
    let warnings = warningsForField(o.kind, { text, vi: o.state.vi }, rules);
    if (staleNow) warnings = warnings.filter((w) => w.code !== "glossary-term" && w.code !== "missing-vi");
    // Lệch dữ kiện đã duyệt của bản gốc (phiên bản thị trường): còn hiệu lực chừng nào người dùng chưa sửa chữ dòng này.
    if (o.state.fact && text === o.state.fact.forText) warnings.push({ code: "fact-mismatch", message: o.state.fact.message });
    const level = warnings.some((w) => ICON_CLASS[w.code] === "danger") ? "danger" : warnings.some((w) => ICON_CLASS[w.code] !== "info") ? "warn" : warnings.length ? "info" : "";
    warnLine.textContent = warnings.map((w) => w.message).join(" · ");
    warnLine.className = `bi-warn-line${level ? ` bi-warn-${level}` : " hidden"}`;
    card.classList.toggle("has-warn", level === "warn" || level === "info");
    card.classList.toggle("has-danger", level === "danger");
    if (o.onWarnings) o.onWarnings(level);
    if (o.kind === "text" && text.trim()) {
      reading.textContent = `⏱ ${readingSeconds(text, rules).toFixed(1)}s`;
      reading.title = "Thời gian đọc ước tính";
      reading.classList.remove("hidden");
    } else {
      reading.classList.add("hidden");
    }
    // thị trường không có dòng nghĩa: chỉ còn thời gian đọc của câu thoại, ẩn hẳn khối thao tác nếu không có gì để hiện
    viActions.classList.toggle("hidden", !gloss && reading.classList.contains("hidden"));
  }

  function applyField(text, vi) {
    o.state.vi = vi;
    o.state.baseText = text;
    o.inputEl.value = text;
    o.inputEl.dispatchEvent(new Event("input", { bubbles: true })); // để app.js đồng bộ dữ liệu + cảnh báo
    if (o.onChange) o.onChange();
  }

  const onInput = () => {
    refresh();
    if (o.onChange) o.onChange();
  };
  o.inputEl.addEventListener("input", onInput);

  btnEdit.addEventListener("click", () => {
    showError("");
    editText.value = o.state.vi || "";
    editBox.classList.remove("hidden");
    editText.focus();
  });
  btnCancel.addEventListener("click", () => {
    showError("");
    editBox.classList.add("hidden");
  });

  btnRewrite.addEventListener("click", async () => {
    const idea = editText.value.trim();
    if (!idea) {
      showError("Hãy nhập ý mới bằng tiếng Việt.");
      return;
    }
    showError("");
    hideNotice();
    setBusy(true);
    try {
      const data = await runner.run((signal, requestId) =>
        postJson(
          "/api/rewrite-field",
          {
            locale: o.getLocaleCode(),
            kind: o.kind,
            idea,
            current: { text: o.inputEl.value, vi: o.state.vi },
            context: o.getContext(),
            pendingSlug: o.getPendingSlug(),
            requestId,
          },
          signal,
        ),
      );
      if (data === STALE || destroyed) return;
      const fb = rewriteFeedback({ idea, beforeText: o.inputEl.value, afterField: data.field, languageName: (o.getRules() || {}).languageName });
      applyField(data.field.text, data.field.vi); // vi = nghĩa của câu MỚI do AI viết, không phải câu người dùng nhập
      editBox.classList.add("hidden");
      showNotice({ message: fb.notice, idea: fb.idea, meaning: fb.meaning }); // luôn cho thấy ý bạn nhập ↔ nghĩa câu mới, kể cả khi chữ đích không đổi
    } catch (err) {
      showError(friendlyError(err));
    } finally {
      if (!destroyed) setBusy(false);
      else if (busy) {
        busy = false;
        o.onBusy(-1);
      }
      refresh();
    }
  });

  btnRe.addEventListener("click", async () => {
    const text = o.inputEl.value;
    showError("");
    hideNotice();
    setBusy(true);
    try {
      const data = await runner.run((signal, requestId) =>
        postJson("/api/translate-field", { locale: o.getLocaleCode(), kind: o.kind, text, pendingSlug: o.getPendingSlug(), requestId }, signal),
      );
      if (data === STALE || destroyed) return;
      const tf = translateFeedback({ beforeVi: o.state.vi, afterVi: data.vi });
      o.state.vi = data.vi;
      o.state.baseText = text; // nghĩa này là của `text` lúc gửi; nếu người dùng đã gõ tiếp thì vẫn hiện "chưa cập nhật"
      if (o.onChange) o.onChange();
      showNotice({ message: tf.message });
    } catch (err) {
      showError(friendlyError(err));
    } finally {
      if (!destroyed) setBusy(false);
      else if (busy) {
        busy = false;
        o.onBusy(-1);
      }
      refresh();
    }
  });

  refresh();

  return {
    refresh,
    /** Gỡ khỏi DOM, huỷ yêu cầu đang chờ, trả lại ô nhập. */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(noticeTimer);
      runner.cancel();
      o.inputEl.removeEventListener("input", onInput);

      if (busy) {
        busy = false;
        o.onBusy(-1);
      }
      o.inputEl.disabled = false;
      wrap.before(o.inputEl); // trả ô nhập về chỗ cũ rồi gỡ card
      wrap.remove();
    },
    hasGloss,
  };
}
