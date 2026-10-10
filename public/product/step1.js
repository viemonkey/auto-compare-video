// Bước 1 — ảnh sản phẩm + thông số + thị trường/giọng + nguồn ảnh + clip AI + ước tính chi phí.
import { h, clear, fmtVnd, api, note } from "./dom.js";

const LOCALE_KEY = "acv.product.locale";
const GUIDE =
  "Ảnh sản phẩm: nền trắng đồng màu, sản phẩm chiếm gần hết khung, không logo/chữ/watermark, không có tay hay người. Càng nét càng tốt (cạnh ngắn ≥ 800px). " +
  "Có thể tải 1–3 ảnh (góc khác nhau: chính diện, nghiêng, cận đá). Ảnh đầu tiên là ảnh chính.";

const TEXT_FIELDS = [
  { key: "type", label: "Loại món", placeholder: "nhẫn / dây chuyền / bông tai", list: ["nhẫn", "dây chuyền", "bông tai"], required: true },
  { key: "material", label: "Chất liệu", placeholder: "bạc 925, vàng 18K...", list: ["bạc 925", "vàng 18K", "vàng 14K", "vàng 10K", "bạch kim"], required: true },
  { key: "metalColor", label: "Màu kim loại", placeholder: "trắng, vàng, hồng", list: ["trắng", "vàng", "hồng"] },
  { key: "mainStone", label: "Đá chính", placeholder: "moissanite, kim cương...", list: ["moissanite", "kim cương", "ruby", "sapphire", "emerald"] },
  { key: "carat", label: "Trọng lượng đá (carat)", placeholder: "vd 1 carat (để trống nếu không biết)" },
  { key: "cut", label: "Giác cắt", placeholder: "tròn, oval, công chúa...", list: ["tròn", "oval", "công chúa", "giọt nước", "trái tim"] },
  { key: "sideStones", label: "Đá phụ", placeholder: "vd đá nhỏ đính xung quanh" },
  { key: "price", label: "Giá (tuỳ chọn)", placeholder: "vd 1.290.000đ" },
  { key: "feature", label: "Đặc điểm nổi bật (tuỳ chọn)", placeholder: "vd vòng bánh răng xoay được" },
];

export function createStep1(ctx) {
  const { state } = ctx;
  const root = h("section", { class: "step-section", id: "pd-step-1" });
  let costTimer = null;

  // ---------- upload ----------
  const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, class: "file-input", "aria-label": "Chọn ảnh sản phẩm" });
  const thumbs = h("div", { class: "pd-upload" });
  function renderThumbs() {
    clear(thumbs);
    state.files.forEach((item, index) => {
      thumbs.append(
        h("div", { class: "pd-thumb" },
          h("img", { src: item.url, alt: `Ảnh sản phẩm ${index + 1}` }),
          h("button", { type: "button", class: "btn-remove-img", text: "✕ Xóa", on: { click: () => removeFile(index) } }),
          item.warnings?.length ? h("div", { class: "pd-thumb-warn", text: item.warnings.join(" ") }) : null,
        ),
      );
    });
    if (state.files.length < ctx.cfg.upload.maxImages) {
      const add = h("div", { class: "pd-add", role: "button", tabIndex: 0, "aria-label": "Thêm ảnh sản phẩm" }, h("strong", { text: state.files.length ? "+ Thêm ảnh" : "Chọn ảnh sản phẩm" }), h("span", { text: `Kéo thả hoặc bấm. Tối đa ${ctx.cfg.upload.maxImages} ảnh, ${ctx.cfg.upload.maxMB}MB/ảnh` }));
      add.addEventListener("click", () => fileInput.click());
      add.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
      add.addEventListener("dragover", (e) => { e.preventDefault(); add.classList.add("dragover"); });
      add.addEventListener("dragleave", () => add.classList.remove("dragover"));
      add.addEventListener("drop", (e) => { e.preventDefault(); add.classList.remove("dragover"); addFiles(e.dataTransfer.files); });
      thumbs.append(add);
    }
  }
  function addFiles(list) {
    for (const file of Array.from(list || [])) {
      if (state.files.length >= ctx.cfg.upload.maxImages) break;
      if (!/^image\//.test(file.type)) continue;
      state.files.push({ file, url: URL.createObjectURL(file), warnings: [] });
    }
    state.project = null; // ảnh đổi -> phải tải lại lúc bấm tiếp
    fileInput.value = "";
    renderThumbs();
    refreshSubmit();
  }
  function removeFile(index) {
    const [gone] = state.files.splice(index, 1);
    if (gone) URL.revokeObjectURL(gone.url);
    state.project = null;
    renderThumbs();
    refreshSubmit();
  }
  fileInput.addEventListener("change", () => addFiles(fileInput.files));

  // ---------- form ----------
  const inputs = {};
  const lists = [];
  const formGrid = h("div", { class: "pd-grid" });
  for (const f of TEXT_FIELDS) {
    const id = `pd-f-${f.key}`;
    const input = h("input", { type: "text", id, class: "input-text", placeholder: f.placeholder, maxLength: 120 });
    if (f.list) {
      const dl = h("datalist", { id: `${id}-list` }, f.list.map((v) => h("option", { value: v })));
      input.setAttribute("list", dl.id);
      lists.push(dl);
    }
    input.value = state.form[f.key] || "";
    input.addEventListener("input", () => { state.form[f.key] = input.value; refreshSubmit(); });
    inputs[f.key] = input;
    formGrid.append(h("div", { class: "form-group" }, h("label", { for: id, text: f.required ? `${f.label} *` : f.label }), input));
  }
  const originChips = h("div", { class: "pd-chips", role: "radiogroup", "aria-label": "Nguồn gốc đá" });
  function renderOrigin() {
    clear(originChips);
    const options = [{ id: "", label: "Chưa rõ / không nêu" }, ...ctx.cfg.stoneOrigins];
    for (const o of options) {
      originChips.append(h("button", { type: "button", class: "pd-chip", role: "radio", "aria-checked": String(state.form.stoneOrigin === o.id), text: o.label, on: { click: () => { state.form.stoneOrigin = o.id; renderOrigin(); } } }));
    }
  }

  // ---------- thị trường + giọng ----------
  const localeBox = h("div", { class: "locale-buttons", role: "radiogroup", "aria-label": "Thị trường" });
  const localeNote = h("div", { class: "locale-render-note hidden" });
  const engineSelect = h("select", { class: "input-text", id: "pd-engine", "aria-label": "Công cụ giọng đọc" });
  const voiceSelect = h("select", { class: "input-text", id: "pd-voice", "aria-label": "Giọng" });
  const ttsNote = h("div", { class: "locale-render-note hidden" });
  function renderLocales() {
    clear(localeBox);
    for (const l of state.locales) {
      const btn = h("button", { type: "button", class: "locale-btn", role: "radio", "aria-checked": String(l.code === state.locale), lang: l.language, title: l.renderable ? l.styleSummary : l.blockers.map((b) => b.message).join(" ") },
        l.flagIcon ? h("img", { class: "locale-flag", src: l.flagIcon, alt: "", width: 24, height: 16 }) : h("span", { text: l.flag }),
        h("span", { text: l.displayName }),
        l.renderable ? null : h("span", { class: "locale-lock", text: "Chưa hỗ trợ" }),
      );
      btn.addEventListener("click", () => selectLocale(l.code));
      localeBox.append(btn);
    }
    const info = state.locales.find((l) => l.code === state.locale);
    localeNote.classList.toggle("hidden", !(info && !info.renderable));
    if (info && !info.renderable) localeNote.textContent = `Chưa thể dựng video: ${info.blockers.map((b) => b.message).join(" ")}`;
  }
  async function selectLocale(code) {
    state.locale = code;
    try { localStorage.setItem(LOCALE_KEY, code); } catch { /* bộ nhớ bị chặn: chỉ không nhớ lựa chọn */ }
    renderLocales();
    await loadEngines();
    refreshSubmit();
  }
  async function loadEngines() {
    const data = await api(`/api/tts-engines?locale=${encodeURIComponent(state.locale)}`);
    state.engines = data.engines || [];
    clear(engineSelect);
    for (const e of state.engines) {
      const m = (e.modes || []).find((x) => x.id !== "clone") || e.modes?.[0];
      engineSelect.append(h("option", { value: e.id, disabled: !e.ready, text: e.ready ? e.label : `${e.label} — chưa sẵn sàng: ${e.notReadyReason}` }));
      void m;
    }
    const usable = state.engines.filter((e) => e.ready);
    const preferred = (data.defaultEngine && usable.find((e) => e.id === data.defaultEngine)) || usable[0];
    if (preferred) engineSelect.value = preferred.id;
    ttsNote.textContent = usable.length ? "" : data.message || "Chưa có giọng đọc nào sẵn sàng cho thị trường này.";
    ttsNote.classList.toggle("hidden", usable.length > 0);
    applyEngine();
  }
  function applyEngine() {
    const e = state.engines.find((x) => x.id === engineSelect.value);
    clear(voiceSelect);
    for (const v of e?.voices || []) voiceSelect.append(h("option", { value: v.id, text: v.label, selected: v.id === e.defaultVoice }));
    voiceSelect.closest(".form-group")?.classList.toggle("hidden", !(e?.voices || []).length);
    state.tts = { engine: e?.id || "", voice: voiceSelect.value || "" };
  }
  engineSelect.addEventListener("change", () => { applyEngine(); refreshSubmit(); });
  voiceSelect.addEventListener("change", () => { state.tts.voice = voiceSelect.value; });

  // ---------- nguồn ảnh + clip ----------
  const sourceBox = h("div", { class: "pd-source-cards", role: "radiogroup", "aria-label": "Nguồn ảnh cảnh có HuyK" });
  const sourceNote = h("div");
  function renderSources() {
    clear(sourceBox);
    for (const s of ctx.cfg.imageSources) {
      const btn = h("button", { type: "button", class: "pd-source", role: "radio", "aria-checked": String(state.source === s.id), disabled: !s.enabled, dataset: { source: s.id } },
        h("strong", { text: s.label }), h("small", { text: s.note }));
      btn.addEventListener("click", () => { state.source = s.id; if (s.id !== "gemini" && !ctx.cfg.clip.enabled) state.aiClip = false; renderSources(); renderClip(); renderHostRefs(); refreshCost(); });
      sourceBox.append(btn);
    }
  }
  const clipBox = h("div", { class: "form-group" });
  function renderClip() {
    clear(clipBox);
    const enabled = ctx.cfg.clip.enabled;
    const input = h("input", { type: "checkbox", id: "pd-clip", checked: !!state.aiClip && enabled, disabled: !enabled });
    input.addEventListener("change", () => { state.aiClip = input.checked; refreshCost(); });
    clipBox.append(
      h("label", { class: "pd-toggle", for: "pd-clip" }, input,
        h("span", {}, h("strong", { text: "Clip AI cho cảnh mở đầu" }), h("br"), h("small", { class: "field-help", text: `1 clip ${ctx.cfg.clip.seconds} giây từ ảnh “cầm sản phẩm” (${ctx.cfg.clip.model}). Mặc định tắt; lỗi hoặc vượt trần thì tự lùi về hiệu ứng GSAP.` }))),
      enabled ? null : note(ctx.cfg.clip.reason),
    );
  }
  const hostRefsBox = h("div");
  function renderHostRefs() {
    clear(hostRefsBox);
    if (state.source === "pose") return;
    const refs = ctx.cfg.hostRefs;
    if (refs.warnings.length) for (const w of refs.warnings) hostRefsBox.append(note(w));
    else hostRefsBox.append(note(`Đã có ${refs.faceCount} ảnh khuôn mặt HuyK. Trang phục mọi cảnh: ${refs.outfitText}${refs.outfitImage ? " (kèm ảnh outfit.jpg)" : ""}.`, "info"));
  }

  // ---------- ước tính chi phí ----------
  const costBox = h("div", { class: "pd-cost", "aria-live": "polite" });
  async function refreshCost() {
    clearTimeout(costTimer);
    costTimer = setTimeout(async () => {
      try {
        const e = await api(`/api/product/estimate?source=${state.source}&clip=${state.aiClip ? 1 : 0}`);
        clear(costBox);
        costBox.append(
          h("strong", { text: "Ước tính chi phí video này" }),
          h("table", {}, e.items.map((i) => h("tr", {}, h("td", { text: i.label }), h("td", { text: i.vnd === null ? "chưa có giá" : fmtVnd(i.vnd) }))),
            h("tr", { class: "pd-cost-total" }, h("td", { text: "Dự kiến" }), h("td", { text: fmtVnd(e.expectedVnd) })),
            h("tr", {}, h("td", { text: "Tối đa nếu phải tạo lại/sửa ảnh" }), h("td", { text: fmtVnd(e.maxVnd) })),
            h("tr", {}, h("td", { text: "Trần cho mỗi video" }), h("td", { text: fmtVnd(e.ceilingVnd) }))),
          ...e.notes.map((n) => note(n)),
          h("small", { class: "field-help", text: "Giá niêm yết của Google (config/pricing.mjs). Gọi chữ/vision ở gói miễn phí thực tế 0đ nhưng vẫn tính vào ngân sách để an toàn." }),
        );
      } catch (err) {
        clear(costBox);
        costBox.append(note(`Chưa tính được chi phí: ${err.message}`, "danger"));
      }
    }, 120);
  }

  // ---------- nút chính ----------
  const submit = h("button", { type: "button", class: "btn btn-primary btn-large", id: "pd-submit" }, h("span", { class: "btn-text", text: "Phân tích sản phẩm và viết kịch bản" }), h("div", { class: "spinner hidden", id: "pd-spin" }));
  const submitReason = h("small", { class: "approve-lock-reason", role: "status" });
  const errorBox = h("div");
  function formProblems() {
    const problems = [];
    if (!state.files.length) problems.push("Hãy tải ít nhất 1 ảnh sản phẩm.");
    if (!state.form.type?.trim()) problems.push("Nhập loại món.");
    if (!state.form.material?.trim()) problems.push("Nhập chất liệu.");
    const info = state.locales.find((l) => l.code === state.locale);
    if (info && !info.renderable) problems.push(`${info.displayName} chưa dựng được video.`);
    if (!state.tts?.engine) problems.push("Chưa có giọng đọc sẵn sàng cho thị trường này.");
    return problems;
  }
  function refreshSubmit() {
    const problems = formProblems();
    submit.disabled = state.busy || problems.length > 0;
    submitReason.textContent = problems.join(" ");
    submitReason.classList.toggle("hidden", problems.length === 0);
  }
  submit.addEventListener("click", async () => {
    clear(errorBox);
    state.busy = true;
    submit.disabled = true;
    submit.querySelector(".spinner").classList.remove("hidden");
    submit.querySelector(".btn-text").textContent = "Đang phân tích sản phẩm…";
    try {
      if (!state.project) {
        const fd = new FormData();
        for (const item of state.files) fd.append("images", item.file);
        const uploaded = await api("/api/product/upload", { method: "POST", body: fd });
        state.project = uploaded;
        uploaded.images.forEach((img, i) => { if (state.files[i]) state.files[i].warnings = img.warnings || []; });
        renderThumbs();
      }
      const project = await api(`/api/product/${state.project.id}/analyze`, {
        method: "POST",
        body: { form: state.form, locale: state.locale, settings: { imageSource: state.source, aiClip: state.aiClip, tts: state.tts } },
      });
      state.project = project;
      ctx.onAnalyzed(project);
    } catch (err) {
      errorBox.append(note(err.message, "danger"));
    } finally {
      state.busy = false;
      submit.querySelector(".spinner").classList.add("hidden");
      submit.querySelector(".btn-text").textContent = "Phân tích sản phẩm và viết kịch bản";
      refreshSubmit();
    }
  });

  root.append(
    h("div", { class: "section-card" },
      h("div", { class: "card-header" },
        h("h2", { text: "Bước 1: Ảnh và thông số sản phẩm" }),
        h("p", { text: "Tải ảnh sản phẩm có sẵn và nhập thông số thật. Tool tạo video dọc 15–20 giây, HuyK giới thiệu sản phẩm — không cần chụp ảnh hay quay clip." })),
      h("div", { class: "form-group" }, h("label", { text: "Ảnh sản phẩm (1–3 ảnh)" }), h("p", { class: "pd-guide", text: GUIDE }), thumbs, fileInput),
      formGrid, lists,
      h("div", { class: "form-group" }, h("label", { text: "Nguồn gốc đá" }), originChips),
      h("div", { class: "form-group" }, h("label", { text: "Thị trường mục tiêu" }), localeBox, localeNote),
      h("div", { class: "pd-grid" },
        h("div", { class: "form-group" }, h("label", { for: "pd-engine", text: "Công cụ giọng đọc (giọng HuyK)" }), engineSelect, ttsNote),
        h("div", { class: "form-group" }, h("label", { for: "pd-voice", text: "Chọn giọng" }), voiceSelect)),
      h("div", { class: "form-group" }, h("label", { text: "Nguồn ảnh cho cảnh có HuyK" }), sourceBox, sourceNote, hostRefsBox),
      clipBox,
      costBox,
      errorBox,
      h("div", { class: "card-footer" }, h("div", { class: "approve-action" }, submit, submitReason)),
    ),
  );

  return {
    el: root,
    async init() {
      renderThumbs(); renderOrigin(); renderSources(); renderClip(); renderHostRefs(); refreshCost();
      let stored = null;
      try { stored = localStorage.getItem(LOCALE_KEY); } catch { /* bộ nhớ bị chặn */ }
      const data = await api("/api/locales");
      state.locales = data.locales || [];
      state.locale = [stored, data.defaultLocale].find((c) => c && state.locales.some((l) => l.code === c)) || state.locales[0]?.code;
      renderLocales();
      await loadEngines();
      refreshSubmit();
    },
  };
}
