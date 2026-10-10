// Bước 2 — kịch bản (chọn câu mở đầu, sửa song ngữ bằng trình soạn có sẵn), cảnh báo đối chiếu form, lưới ảnh cảnh, rồi duyệt để dựng.
import { createFieldEditor } from "/field-editor.js";
import { slugify } from "/shared/slug-base.mjs";
import { h, clear, fmtVnd, api, note } from "./dom.js";
import { createScenesGrid } from "./scenes.js";

const BEAT_LABEL = { hook: "Mở đầu", specs: "Thông số", wear: "Lúc đeo", emotion: "Cảm xúc", cta: "Kêu gọi" };
const FIELD_LABEL_VI = { type: "Loại món", metalColor: "Màu kim loại", mainStone: "Đá chính", sideStones: "Đá phụ" };

export function createStep2(ctx) {
  const { state } = ctx;
  const root = h("section", { class: "step-section", id: "pd-step-2" });
  const body = h("div", { class: "section-card" });
  root.append(body);
  let project = null;
  let rules = null;
  let editors = [];
  let busyCount = 0;
  let saveTimer = null;
  let slugInput = null;
  let buildBtn = null;
  let buildReason = null;
  let scenesGrid = null;
  const lineStates = []; // { vi, baseText } theo dòng

  const setProject = (p) => {
    project = p;
    state.project = p;
    renderDynamic();
  };

  // ---- hỏi lại trạng thái khi còn việc nền (tạo ảnh, kiểm, sửa) ----
  let pollTimer = null;
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!project || !(project.busy || project.scenes.some((s) => s.busy))) return;
    pollTimer = setTimeout(async () => {
      try {
        const fresh = await api(`/api/product/${project.id}`);
        // chỉ làm mới lưới cảnh + trạng thái; không dựng lại ô soạn kịch bản đang gõ
        project = { ...project, scenes: fresh.scenes, blockers: fresh.blockers, budget: fresh.budget, billing: fresh.billing, busy: fresh.busy };
        state.project = project;
        scenesGrid.set(project);
        renderStatus();
        refreshBuild();
      } catch { /* mất kết nối tạm thời: thử lại ở lần sau */ }
      schedulePoll();
    }, 1500);
  }

  // ---- phần tĩnh theo dự án ----
  const statusBox = h("div", { class: "pd-status" });
  const notesBox = h("div");
  const lockBox = h("div");
  const scriptBox = h("div");
  const scenesBox = h("div");
  scenesGrid = createScenesGrid(ctx, { onChange: (p) => { project = { ...project, ...p, script: project.script }; state.project = project; scenesGrid.set(project); renderStatus(); refreshBuild(); schedulePoll(); } });
  scenesBox.append(h("h3", { text: "Ảnh từng cảnh" }), h("p", { class: "field-help", text: "Mỗi câu thoại là một cảnh. Nguồn ảnh ghi trên từng cảnh; ảnh chưa đạt kiểm hiện đỏ và cần bạn duyệt." }), scenesGrid.el);

  const btnBack = h("button", { type: "button", class: "btn btn-secondary", text: "← Quay lại Bước 1", on: { click: () => ctx.goto(1) } });
  buildBtn = h("button", { type: "button", class: "btn btn-primary btn-large glow-pink", id: "pd-build" }, h("span", { class: "btn-text", text: "Duyệt và dựng video" }));
  buildReason = h("small", { class: "approve-lock-reason", role: "status" });
  const slugWrap = h("div", { class: "form-group" }, h("label", { for: "pd-slug", text: "Mã thư mục video" }));
  body.append(
    h("div", { class: "card-header" }, h("h2", { text: "Bước 2: Kịch bản và ảnh cảnh" }), h("p", { text: "Chọn câu mở đầu, sửa lời thoại, xem từng cảnh. Chỉ dựng được khi mọi ảnh đã đạt kiểm hoặc bạn đã tự duyệt." })),
    statusBox, notesBox, lockBox, scriptBox, scenesBox,
    h("div", { class: "card-footer space-between" }, btnBack, h("div", { class: "approve-action" }, slugWrap, buildBtn, buildReason)),
  );

  function renderStatus() {
    if (!project) return;
    clear(statusBox);
    const b = project.budget;
    statusBox.append(...[
      h("span", { class: "pd-pill", text: `Đã dùng ${fmtVnd(b.spentVnd)} / trần ${fmtVnd(b.maxVnd)}` }),
      h("span", { class: "pd-pill", text: `Nguồn ảnh: ${({ pose: "Ảnh tư thế có sẵn", manual: "Tự tải ảnh", gemini: "Tự động (Gemini)" })[project.settings.imageSource]}` }),
      project.settings.aiClip ? h("span", { class: "pd-pill", text: "Clip AI mở đầu: bật" }) : null,
      h("span", { class: "pd-pill", text: `${project.script.lines.length} câu · ${project.scenes.length} cảnh` }),
    ].filter(Boolean));
  }

  function renderNotes() {
    clear(notesBox);
    for (const n of project.settings.notes || []) notesBox.append(note(n));
    if (project.script.mismatches?.length) {
      notesBox.append(note("Form và ảnh có điểm lệch — tool KHÔNG tự sửa form, hãy kiểm tra lại (kịch bản vẫn theo form):", "danger"));
      for (const m of project.script.mismatches) notesBox.append(note(`${FIELD_LABEL_VI[m.field] || m.field}: ${m.message} (form: “${m.formValue}” · ảnh: “${m.observed}”)`, "danger"));
    }
    for (const w of project.script.warnings || []) notesBox.append(note(w));
    for (const img of project.images) for (const w of img.warnings || []) notesBox.append(note(`Ảnh ${img.id.replace("product-", "")}: ${w}`));
    if (project.settings.imageSource !== "pose" && !project.hostRefsReady) notesBox.append(note("Chưa có ảnh khuôn mặt HuyK trong assets/host-refs/ — ảnh AI/tự tải sẽ khó giống mặt. Xem hướng dẫn chọn ảnh ở docs/product-showcase.md."));
  }

  function renderLock() {
    clear(lockBox);
    const a = project.analysis;
    lockBox.append(h("details", { class: "pd-lock" }, h("summary", { text: "Mô tả khoá sản phẩm (Gemini nhìn ảnh tự viết)" }),
      h("p", { text: a.lockTextVi || "(không có bản tiếng Việt)" }), h("p", { class: "field-help", lang: "en", text: a.lockText }),
      h("small", { class: "field-help", text: `Model: ${a.model}. Mô tả này được dán nguyên văn vào prompt tạo ảnh/clip để khoá sản phẩm.` })));
  }

  function collect() {
    const lines = editors.map((e) => ({ text: e.input.value, vi: e.state.vi }));
    return lines;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const lines = collect();
        const saved = await api(`/api/product/${project.id}/script`, { method: "PUT", body: { lines: [{}, ...lines.map((l) => ({ text: l.text, vi: l.vi }))].slice(0, project.script.lines.length) } });
        project = { ...project, script: saved.script };
        state.project = project;
        renderIssues();
      } catch { /* lưu lại ở lần sửa sau */ }
    }, 600);
  }

  const issuesBox = h("div");
  function renderIssues() {
    clear(issuesBox);
    for (const i of project.script.rulesIssues || []) issuesBox.append(note(i, "danger"));
  }

  function renderScript() {
    editors.forEach((e) => e.editor.destroy());
    editors = [];
    clear(scriptBox);
    const gloss = !!rules?.needsGloss;
    const openers = h("div", { class: "pd-openers", role: "radiogroup", "aria-label": "Câu mở đầu" });
    const drawOpeners = () => {
      clear(openers);
      project.script.openers.forEach((o, i) => {
        const b = h("button", { type: "button", class: "pd-source", role: "radio", "aria-checked": String(project.script.openerIndex === i), dataset: { opener: i } },
          h("strong", { text: `Phương án ${i + 1}` }), h("span", { lang: rules?.code ? undefined : undefined, text: o.text }), gloss && o.vi ? h("small", { text: o.vi }) : null);
        b.addEventListener("click", async () => {
          try {
            const saved = await api(`/api/product/${project.id}/script`, { method: "PUT", body: { openerIndex: i } });
            project = { ...project, script: saved.script };
            state.project = project;
            renderScript();
          } catch (err) { issuesBox.prepend(note(err.message, "danger")); }
        });
        openers.append(b);
      });
    };
    drawOpeners();
    scriptBox.append(h("h3", { text: "Câu mở đầu (chọn 1 trong 3)" }), openers, h("h3", { text: "Lời thoại" }));
    const list = h("div", { class: "pd-lines" });
    scriptBox.append(list);
    project.script.lines.forEach((line, i) => {
      const row = h("div", { class: "pd-line" }, h("span", { class: "pd-line-n", text: `${line.n}` }), h("span", { class: "pd-line-beat", text: BEAT_LABEL[line.beat] || line.beat }));
      const input = h("input", { type: "text", class: "input-text point-text-input", value: line.text, maxLength: 300, "aria-label": `Câu ${line.n}` });
      input.lang = rules?.code ? project.locale.split("-")[0] : "vi";
      row.append(input);
      list.append(row);
      if (i === 0) { // câu 1 = phương án mở đầu đã chọn; đổi bằng thẻ ở trên
        input.readOnly = true;
        input.title = "Câu mở đầu — đổi bằng cách chọn phương án ở trên";
        return;
      }
      const st = lineStates[i] = { vi: line.vi || "", baseText: line.text };
      const editor = createFieldEditor({
        kind: "text", inputEl: input, state: st, getRules: () => rules, getLocaleCode: () => project.locale,
        getContext: () => ({ title: project.script.lines[0]?.text ? { text: project.script.lines[0].text, vi: project.script.lines[0].vi || "" } : "" }),
        getPendingSlug: () => project.ledgerSlug,
        onBusy: (d) => { busyCount = Math.max(0, busyCount + d); refreshBuild(); },
        onChange: scheduleSave,
      });
      editors.push({ editor, input, state: st });
    });
    scriptBox.append(issuesBox);
    renderIssues();
  }

  function renderDynamic() {
    if (!project) return;
    renderStatus(); renderNotes(); renderLock(); renderScript();
    scenesGrid.set(project);
    if (!slugInput) {
      slugInput = h("input", { type: "text", id: "pd-slug", class: "input-text", placeholder: "tự sinh từ tên sản phẩm" });
      slugWrap.append(slugInput);
    }
    slugInput.value = project.slugDraft || slugify(project.displayName || "") || "";
    refreshBuild();
    schedulePoll();
  }

  function refreshBuild() {
    if (!project) return;
    const blockers = [...(project.blockers || [])];
    if (busyCount > 0) blockers.push({ message: "Đang chờ AI sửa lời thoại…" });
    const locked = blockers.length > 0 || state.building;
    buildBtn.disabled = locked;
    buildReason.textContent = blockers.length ? blockers.map((b) => b.message).join(" ") : "";
    buildReason.classList.toggle("hidden", !blockers.length);
  }

  buildBtn.addEventListener("click", async () => {
    const slug = (slugInput.value || "").trim();
    buildBtn.disabled = true;
    try {
      await api(`/api/product/${project.id}/script`, { method: "PUT", body: { slug } });
      const job = await api(`/api/product/${project.id}/build`, { method: "POST", body: { slug, tts: state.tts } });
      ctx.onBuildStarted(job);
    } catch (err) {
      buildReason.textContent = err.message;
      buildReason.classList.remove("hidden");
      refreshBuild();
    }
  });

  return {
    el: root,
    async show(p) {
      if (!rules || rules.code !== p.locale) rules = await api(`/api/locale-rules?locale=${encodeURIComponent(p.locale)}`).catch(() => null);
      setProject(p);
    },
    stop() { clearTimeout(pollTimer); },
  };
}
