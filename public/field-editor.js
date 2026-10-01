// Trình soạn 1 dòng hiển thị ở Bước 2: dòng chính (ô nhập chữ ngôn ngữ đích, do app.js cung cấp) + dòng nghĩa tiếng Việt
// màu nhạt bên dưới + cảnh báo theo dòng. Sửa ý bằng tiếng Việt (✎ -> "Viết lại bằng <ngôn ngữ>") và dịch lại nghĩa (↻) đều chỉ gọi
// Gemini cho ĐÚNG dòng này. Chống race bằng createLatestRunner (requestId + AbortController); nút bị khoá trong lúc chờ.
import { warningsForField, readingSeconds } from "/shared/field-warnings.mjs";
import { createLatestRunner, STALE } from "/shared/latest-request.mjs";

const ICON_CLASS = { "too-long": "warn", "forbidden-phrase": "danger", "glossary-term": "warn", "missing-vi": "info" };

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
 * @param {HTMLElement} o.host                 nơi gắn dòng nghĩa + cảnh báo
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

  const wrap = el("div", "bi-field");
  wrap.dataset.kind = o.kind;
  const viLine = el("div", "bi-vi-line");
  const viTag = el("span", "bi-vi-tag", "VI");
  const viText = el("span", "bi-vi-text");
  const stale = el("span", "bi-stale hidden", "⚠ chưa cập nhật nghĩa");
  const btnEdit = el("button", "bi-btn", "✎");
  btnEdit.type = "button";
  btnEdit.title = "Sửa ý bằng tiếng Việt rồi nhờ AI viết lại";
  const btnRe = el("button", "bi-btn", "↻");
  btnRe.type = "button";
  btnRe.title = "Dịch lại nghĩa tiếng Việt cho dòng này";
  viLine.append(viTag, viText, stale, btnEdit, btnRe);

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
  const reading = el("span", "bi-reading hidden");
  const warnList = el("ul", "bi-warnings");
  const errBox = el("div", "bi-error hidden");
  meta.append(reading, warnList, errBox);

  wrap.append(viLine, editBox, meta);
  o.host.appendChild(wrap);

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

  function refresh() {
    if (destroyed) return;
    const rules = o.getRules();
    const gloss = !!(rules && rules.needsGloss);
    viLine.classList.toggle("hidden", !gloss);
    if (!rules) return;
    const text = o.inputEl.value;
    const staleNow = gloss && text.trim() !== "" && isStale();
    viText.textContent = o.state.vi ? o.state.vi : text.trim() ? "(chưa có nghĩa)" : "";
    viText.classList.toggle("is-stale", staleNow);
    stale.classList.toggle("hidden", !staleNow);
    btnRe.classList.toggle("hidden", !(staleNow || (gloss && text.trim() !== "" && !o.state.vi)));
    btnRewrite.textContent = busy ? "⏳ Đang viết…" : `Viết lại bằng ${rules.languageName || "ngôn ngữ đích"}`;

    // Cảnh báo theo dòng (cùng module với server). Nghĩa đã cũ -> bỏ cảnh báo dựa vào nghĩa (đã có dấu "chưa cập nhật").
    let warnings = warningsForField(o.kind, { text, vi: o.state.vi }, rules);
    if (staleNow) warnings = warnings.filter((w) => w.code !== "glossary-term" && w.code !== "missing-vi");
    warnList.innerHTML = "";
    for (const w of warnings) {
      const li = el("li", `bi-warn bi-warn-${ICON_CLASS[w.code] || "warn"}`, `⚠ ${w.message}`);
      warnList.appendChild(li);
    }
    if (o.kind === "text" && text.trim()) {
      reading.textContent = `⏱ ≈ ${readingSeconds(text, rules).toFixed(1)}s khi đọc`;
      reading.classList.remove("hidden");
    } else {
      reading.classList.add("hidden");
    }
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
      applyField(data.field.text, data.field.vi); // vi = nghĩa của câu MỚI do AI viết, không phải câu người dùng nhập
      editBox.classList.add("hidden");
    } catch (err) {
      showError(err.message);
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
    setBusy(true);
    try {
      const data = await runner.run((signal, requestId) =>
        postJson("/api/translate-field", { locale: o.getLocaleCode(), kind: o.kind, text, pendingSlug: o.getPendingSlug(), requestId }, signal),
      );
      if (data === STALE || destroyed) return;
      o.state.vi = data.vi;
      o.state.baseText = text; // nghĩa này là của `text` lúc gửi; nếu người dùng đã gõ tiếp thì vẫn hiện "chưa cập nhật"
      if (o.onChange) o.onChange();
    } catch (err) {
      showError(err.message);
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
      runner.cancel();
      o.inputEl.removeEventListener("input", onInput);
      if (busy) {
        busy = false;
        o.onBusy(-1);
      }
      o.inputEl.disabled = false;
      wrap.remove();
    },
    hasGloss,
  };
}
