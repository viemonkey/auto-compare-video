// Lưới ảnh cảnh của Bước 2: mỗi câu thoại = 1 cảnh. Ghi rõ nguồn (pose / manual / gemini / cắt cận / sản phẩm thật), điểm kiểm + lý do, chi phí,
// và các nút: Đổi pose · Tải ảnh khác · Tạo lại / Sửa khuôn mặt / Sửa sản phẩm / yêu cầu sửa tự do (có phí, hiện chi phí trước) · Dùng ảnh sản phẩm gốc · Duyệt.
import { h, clear, fmtVnd, api, note } from "./dom.js";

const SOURCE_LABEL = { pose: "Ảnh tư thế", manual: "Tự tải ảnh", gemini: "Gemini", crop: "Cắt từ ảnh", product: "Ảnh sản phẩm thật" };
const KIND_LABEL = { pose: "HuyK + sản phẩm", photo: "Ảnh toàn khung có HuyK", macro: "Cận đá", half: "Nửa người", hero: "Sản phẩm thật trên nền tối" };
const BEAT_LABEL = { hook: "Mở đầu", specs: "Thông số", wear: "Lúc đeo", emotion: "Cảm xúc", cta: "Kêu gọi" };
const CRITERIA = { product: "Sản phẩm", face: "Giống mặt", hands: "Tay", outfit: "Trang phục" };
export const POSES = ["thinking", "shrug-a", "confused", "point-up-left", "point-up-right", "explain-a", "explain-b", "shocked-a", "thumbs-up-a"];

export function createScenesGrid(ctx, { onChange }) {
  const root = h("div", { class: "pd-scenes" });
  const requestDrafts = new Map(); // sceneId -> chữ đang gõ ở ô yêu cầu sửa (giữ qua lần dựng lại khi hỏi trạng thái)
  const promptCache = new Map();
  let project = null;
  let actionError = "";

  const post = async (url, body) => {
    actionError = "";
    try {
      const p = await api(url, { method: "POST", body: body ?? {} });
      onChange(p);
    } catch (err) {
      actionError = err.message;
      render();
    }
  };

  function sceneImage(scene) {
    const box = h("div", { class: `pd-scene-img kind-${scene.kind}` });
    if (scene.imageUrl) box.append(h("img", { src: scene.imageUrl, alt: `Ảnh cảnh ${scene.line}` }));
    else if (scene.kind === "pose") {
      const prod = project.images[scene.productImage ?? 0];
      box.append(h("div", { class: `pd-prev-pose side-${scene.hostSide || "right"}` },
        prod ? h("img", { class: "pd-prev-prod", src: prod.url, alt: "Sản phẩm" }) : null,
        h("img", { class: "pd-prev-host", src: `/assets/actions/${scene.pose}.svg`, alt: scene.pose })));
    } else if (scene.kind === "photo") box.append(h("div", { class: "pd-scene-empty", text: scene.source === "manual" ? "Chưa có ảnh — tải ảnh lên" : "Chưa tạo ảnh" }));
    else {
      const src = scene.kind === "half" ? project.scenes.find((s) => s.id === scene.from)?.imageUrl : project.images[scene.productImage ?? 0]?.url;
      if (src) box.append(h("img", { class: `pd-prev-${scene.kind}`, src, alt: KIND_LABEL[scene.kind] }));
      else box.append(h("div", { class: "pd-scene-empty", text: "Chưa có ảnh nguồn" }));
    }
    return box;
  }

  function checkBlock(scene) {
    if (!scene.check) return null;
    const c = scene.check;
    return h("div", { class: "pd-check" },
      h("div", { class: "pd-scores" }, Object.keys(CRITERIA).map((k) => {
        const v = c.scores?.[k];
        const bad = typeof v === "number" && v < 7;
        return h("span", { class: `pd-score${bad ? " bad" : v === null ? " na" : ""}`, title: c.reasons?.[k] || "", text: `${CRITERIA[k]} ${v === null || v === undefined ? "—" : `${v}/10`}` });
      })),
      h("ul", { class: "pd-reasons" }, Object.keys(CRITERIA).filter((k) => c.reasons?.[k]).map((k) => h("li", { class: c.scores?.[k] !== null && c.scores?.[k] < 7 ? "bad" : "", text: `${CRITERIA[k]}: ${c.reasons[k]}` }))),
    );
  }

  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch {
      const area = h("textarea", { value: text });
      document.body.append(area); area.select(); document.execCommand("copy"); area.remove();
    }
    const old = btn.textContent;
    btn.textContent = "Đã sao chép";
    setTimeout(() => { btn.textContent = old; }, 1600);
  }

  function manualBox(scene) {
    const details = h("details", { class: "pd-manual" }, h("summary", { text: "Prompt cho Google AI Studio (nguồn tự tải)" }));
    const body = h("div", { class: "pd-manual-body" });
    details.append(body);
    details.addEventListener("toggle", async () => {
      if (!details.open || body.childElementCount) return;
      try {
        let data = promptCache.get(scene.id);
        if (!data) { data = await api(`/api/product/${project.id}/scenes/${scene.id}/prompt`); promptCache.set(scene.id, data); }
        const area = h("textarea", { class: "input-text pd-prompt", readOnly: true, rows: 8, value: data.prompt });
        const copy = h("button", { type: "button", class: "btn btn-small btn-secondary", text: "Sao chép prompt" });
        copy.addEventListener("click", () => copyText(data.prompt, copy));
        body.append(h("p", { class: "field-help", text: data.note }), h("strong", { text: "Đính kèm khi dán vào Google AI Studio (đúng thứ tự):" }), h("ol", {}, data.attach.map((l) => h("li", { text: l }))), area, copy);
      } catch (err) { body.append(note(err.message, "danger")); }
    });
    return details;
  }

  function actions(scene) {
    const wrap = h("div", { class: "pd-scene-actions" });
    const busy = !!scene.busy || project.busy;
    const btn = (label, onClick, { cls = "btn-secondary", title = "", disabled = false } = {}) => {
      const b = h("button", { type: "button", class: `btn btn-small ${cls}`, text: label, title, disabled: disabled || busy });
      b.addEventListener("click", onClick);
      return b;
    };
    const sceneUrl = (p) => `/api/product/${project.id}/scenes/${scene.id}/${p}`;
    const upload = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", class: "hidden", "aria-label": `Tải ảnh cho cảnh ${scene.line}` });
    upload.addEventListener("change", async () => {
      const file = upload.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("image", file);
      actionError = "";
      try { onChange(await api(sceneUrl("upload"), { method: "POST", body: fd })); } catch (err) { actionError = err.message; render(); }
    });
    wrap.append(btn("Tải ảnh khác (manual)", () => upload.click(), { title: "Ảnh tự tạo trên Google AI Studio — vẫn được kiểm 4 tiêu chí (miễn phí)" }), upload);

    const posePick = h("select", { class: "input-text pd-pose-select", "aria-label": `Đổi pose cảnh ${scene.line}`, disabled: busy },
      h("option", { value: "", text: "Đổi pose…" }), POSES.map((p) => h("option", { value: p, text: p, selected: p === scene.pose })));
    posePick.addEventListener("change", () => { if (posePick.value) post(sceneUrl("pose"), { pose: posePick.value }); });
    wrap.append(posePick);

    if (["photo", "half", "pose", "macro"].includes(scene.kind)) wrap.append(btn("Dùng ảnh sản phẩm gốc", () => post(sceneUrl("use-original")), { title: "Cảnh chỉ dùng ảnh sản phẩm thật của bạn trên nền tối" }));
    if (scene.kind === "photo" && scene.image && !scene.approved) wrap.append(btn("Duyệt ảnh này", () => post(sceneUrl("approve")), { cls: "btn-primary" }));

    if (scene.actions) {
      const a = scene.actions;
      const cost = `≈${fmtVnd(a.costVnd)}`;
      const paid = (label, action, extra = {}) => btn(`${label} (${cost})`, () => post(sceneUrl("action"), { action, ...extra }), { cls: "btn-primary", title: a.allowed ? `Gọi API ảnh có phí ${cost}` : a.reason, disabled: !a.allowed || (action !== "regenerate" && !a.canEdit) });
      wrap.append(paid("Tạo lại", "regenerate"), paid("Sửa khuôn mặt", "fix-face"), paid("Sửa sản phẩm", "fix-product"));
      const req = h("input", { type: "text", class: "input-text", placeholder: "Yêu cầu sửa tự do (vd: nền sáng hơn)…", maxLength: 300, value: requestDrafts.get(scene.id) || "", disabled: !a.allowed || !a.canEdit || busy, "aria-label": `Yêu cầu sửa cảnh ${scene.line}` });
      req.addEventListener("input", () => requestDrafts.set(scene.id, req.value));
      const send = btn(`Gửi (${cost})`, () => { const text = req.value.trim(); if (!text) return; requestDrafts.delete(scene.id); post(sceneUrl("action"), { action: "edit", userRequest: text }); }, { cls: "btn-primary", disabled: !a.allowed || !a.canEdit, title: a.allowed ? "" : a.reason });
      wrap.append(h("div", { class: "pd-edit-free" }, req, send));
      if (!a.allowed && a.reason) wrap.append(h("small", { class: "pd-reason", text: a.reason }));
    }
    return wrap;
  }

  function card(scene) {
    const state = scene.busy ? "busy" : scene.status === "needs-review" && !scene.approved ? "review" : scene.status === "error" ? "error" : "ok";
    const el = h("article", { class: `pd-scene state-${state}`, dataset: { scene: scene.id } },
      h("header", {},
        h("strong", { text: `Cảnh ${scene.line} · ${BEAT_LABEL[scene.beat] || scene.beat}` }),
        h("span", { class: `pd-badge src-${scene.source}`, text: SOURCE_LABEL[scene.source] || scene.source })),
      sceneImage(scene),
      h("div", { class: "pd-scene-kind", text: KIND_LABEL[scene.kind] || scene.kind }),
      scene.busy ? h("div", { class: "pd-busy", role: "status" }, h("span", { class: "spinner" }), scene.busy.text || "Đang xử lý…") : null,
      scene.note ? note(scene.note, state === "review" || state === "error" ? "danger" : "info") : null,
      scene.kind === "photo" && scene.status === "needs-review" && !scene.approved ? h("div", { class: "pd-flag", text: "Cần bạn duyệt" }) : null,
      checkBlock(scene),
      scene.source === "manual" || scene.kind === "photo" ? manualBox(scene) : null,
      actions(scene),
    );
    return el;
  }

  function render() {
    clear(root);
    if (!project) return;
    const photosMissing = project.scenes.filter((s) => s.kind === "photo" && s.source === "gemini" && !s.image && !s.busy);
    if (photosMissing.length) {
      const a = project.scenes.find((s) => s.actions)?.actions;
      const cost = a ? photosMissing.length * a.costVnd : 0;
      const b = h("button", { type: "button", class: "btn btn-primary", disabled: !a?.allowed || project.busy, title: a?.allowed ? "" : a?.reason, text: `Tạo ảnh AI cho ${photosMissing.length} cảnh (≈${fmtVnd(cost)} chưa gồm sửa/tạo lại)` });
      b.addEventListener("click", () => post(`/api/product/${project.id}/scenes/generate`));
      root.append(h("div", { class: "pd-generate" }, b, a && !a.allowed ? note(a.reason) : null));
    }
    if (actionError) root.append(note(actionError, "danger"));
    root.append(h("div", { class: "pd-scene-grid" }, project.scenes.map(card)));
  }

  return {
    el: root,
    set(p) { project = p; render(); },
  };
}
