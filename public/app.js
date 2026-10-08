// Auto Compare Video Web UI Application Logic
// (ES module: dùng chung hàm đọc field song ngữ với server — public/shared/bilingual.mjs)
import { flattenContent, textOf, viOf } from "/shared/bilingual.mjs";
import { createFieldEditor } from "/field-editor.js";
import { slugify, baseSlugFromContent } from "/shared/slug-base.mjs";
import { createLatestRunner, STALE } from "/shared/latest-request.mjs";

document.addEventListener("DOMContentLoaded", () => {
  // State
  let uploadedLeftPath = null;
  let uploadedRightPath = null;
  let pendingContentSlug = null; // slug tạm gắn ở Bước 1 (/api/generate-content), đổi thành slug thật ở /api/create-video
  let actionCatalog = [];
  let currentEditingPointIndex = null;
  let pointsData = [];
  let generatedContent = null; // nội dung Gemini nguyên bản (field song ngữ { text, vi } với thị trường ngoài tiếng Việt)
  let generatedWarnings = []; // cảnh báo theo field: [{ path, code, message }]
  let generatedBy = null; // model đã sinh nội dung { model, primary, isFallback } — gửi kèm khi lưu để mở lại còn badge
  // Trình soạn song ngữ: nghĩa tiếng Việt của từng dòng { vi, baseText } (stale = chữ đích hiện tại khác baseText)
  const emptyPair = () => ({ vi: "", baseText: "" });
  const emptyPointBi = () => ({ text: emptyPair(), tag: emptyPair(), sub: emptyPair() });
  let biState = { title: emptyPair(), label_left: emptyPair(), label_right: emptyPair() };

  // DOM Elements - Stepper & Sections
  const stepNav1 = document.getElementById("step-nav-1");
  const stepNav2 = document.getElementById("step-nav-2");
  const stepNav3 = document.getElementById("step-nav-3");
  const step1 = document.getElementById("step-1");
  const step2 = document.getElementById("step-2");
  const step3 = document.getElementById("step-3");

  // DOM Elements - Step 1
  const fileLeft = document.getElementById("file-left");
  const fileRight = document.getElementById("file-right");
  const dropLeft = document.getElementById("dropzone-left");
  const dropRight = document.getElementById("dropzone-right");
  const phLeft = document.getElementById("ph-left");
  const phRight = document.getElementById("ph-right");
  const prevLeftWrap = document.getElementById("prev-left-wrap");
  const prevRightWrap = document.getElementById("prev-right-wrap");
  const prevLeft = document.getElementById("prev-left");
  const prevRight = document.getElementById("prev-right");
  const rmLeft = document.getElementById("rm-left");
  const rmRight = document.getElementById("rm-right");
  const topicHintInput = document.getElementById("topic-hint");
  const btnGenerateContent = document.getElementById("btn-generate-content");
  const spinGen = document.getElementById("spin-gen");
  const contentAngleSelect = document.getElementById("content-angle");
  const contentAngleCustomContainer = document.getElementById("content-angle-custom-container");
  const contentAngleCustomText = document.getElementById("content-angle-custom-text");

  let contentAngles = [];

  // DOM Elements - Step 2
  const scriptLabelLeft = document.getElementById("script-label-left");
  const scriptLabelRight = document.getElementById("script-label-right");
  const scriptTitle = document.getElementById("script-title");
  const scriptSlug = document.getElementById("script-slug");
  const hashtagChips = document.getElementById("hashtag-chips");
  const hashtagAddInput = document.getElementById("hashtag-add-input");
  const btnAddHashtag = document.getElementById("btn-add-hashtag");
  const hashtagNote = document.getElementById("hashtag-note");
  let hashtagPlan = []; // [{tag, tier:"specific"|"topic", manual?}] — server làm sạch lại khi dựng
  let hashtagMax = 4;
  let geminiHashtagMeta = { materials: [], topicTags: [], suggestedTags: [] };
  const pointsContainer = document.getElementById("points-container");
  const btnAddPoint = document.getElementById("btn-add-point");
  const btnBackStep1 = document.getElementById("btn-back-step1");
  const btnApproveBuild = document.getElementById("btn-approve-build");

  // DOM Elements - Step 3
  const terminalLogs = document.getElementById("terminal-logs");
  const buildSuccessCard = document.getElementById("build-success-card");
  const btnOpenPreview = document.getElementById("btn-open-preview");
  const btnCreateAnother = document.getElementById("btn-create-another");

  // DOM Elements - VieNeu TTS
  const ttsProviderSelect = document.getElementById("tts-provider");
  const vieneuPresetContainer = document.getElementById("vieneu-preset-container");
  const vieneuPresetSelect = document.getElementById("vieneu-preset-select");
  const vieneuCloneContainer = document.getElementById("vieneu-clone-container");
  const vieneuRefFile = document.getElementById("vieneu-ref-file");
  const vieneuRefStatus = document.getElementById("vieneu-ref-status");

  let uploadedRefAudioPath = null;

  // Slug — kebab-case a-z0-9 (xem /shared/slug-base.mjs, dùng chung với server): scaffold-compare-video.mjs chỉ nhận /^[a-z0-9]+(-[a-z0-9]+)*$/.
  function buildSlug(left, right) {
    return [slugify(left), slugify(right)].filter(Boolean).join("-vs-");
  }

  // Hậu tố slug theo góc độ nội dung đã chọn ở Bước 1 — cùng 1 cặp ảnh nhưng khác góc độ
  // thì ra khác thư mục videos/<slug>/, không đè lên nhau.
  //   - "auto"   -> không thêm gì, giữ đúng hành vi buildSlug() cũ.
  //   - "custom" -> rút gọn vài từ đầu của mô tả tự gõ (không dùng cố định "custom").
  //   - preset khác -> dùng đúng id (đã kebab-case sẵn trong config/content-angles.mjs).
  function contentAngleSlugSuffix() {
    const id = contentAngleSelect ? contentAngleSelect.value : "auto";
    if (!id || id === "auto") return "";
    if (id === "custom") {
      const words = slugify(contentAngleCustomText ? contentAngleCustomText.value : "")
        .split("-")
        .filter(Boolean)
        .slice(0, 4);
      return words.join("-");
    }
    return id;
  }

  // Slug gợi ý: <trái>-vs-<phải>[-<góc độ>][-<hậu tố thị trường>]. Bản ngoại ngữ sinh từ NGHĨA TIẾNG VIỆT của label (chữ Nhật/Thái
  // ra slug rỗng); không có nghĩa thì trả rỗng để người dùng nhập tay. Thị trường mặc định không có hậu tố.
  function buildSlugWithAngle(left, right) {
    const gloss = typeof isGloss === "function" && isGloss();
    // bản ngoại ngữ: tên tiếng Anh/quốc tế (materials / label Latin) trước, rồi nghĩa tiếng Việt — cùng quy tắc với server (shared/slug-base.mjs)
    const base = gloss
      ? baseSlugFromContent(
          { label_left: { text: left, vi: biState.label_left.vi }, label_right: { text: right, vi: biState.label_right.vi }, materials: geminiHashtagMeta.materials },
          { foreign: true },
        )
      : buildSlug(left, right);
    if (!base || !base.includes("-vs-")) return "";
    const info = typeof currentLocaleInfo === "function" ? currentLocaleInfo() : null;
    const parts = [base, contentAngleSlugSuffix(), info && info.slugSuffix ? info.slugSuffix : ""].filter(Boolean);
    return parts.join("-");
  }

  const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  // Must be frame_class "full" — see assets/actions/actions.json
  // 2026-09-03: idle-confident removed from the catalog.
  const DEFAULT_POSE = "explain-a";

  // Modals
  const actionModal = document.getElementById("action-modal");
  const btnCloseModal = document.getElementById("btn-close-modal");
  const actionGrid = document.getElementById("action-grid");

  const videosModal = document.getElementById("videos-modal");
  const btnExistingVideos = document.getElementById("btn-existing-videos");
  const btnCloseVideosModal = document.getElementById("btn-close-videos-modal");
  const videosListGrid = document.getElementById("videos-list-grid");

  const costStatsModal = document.getElementById("cost-stats-modal");
  const btnCostStats = document.getElementById("btn-cost-stats");
  const btnCloseCostModal = document.getElementById("btn-close-cost-modal");
  const costTotalToday = document.getElementById("cost-total-today");
  const costTotal7d = document.getElementById("cost-total-7d");
  const costTotalAll = document.getElementById("cost-total-all");
  const costTotalTodayVnd = document.getElementById("cost-total-today-vnd");
  const costTotal7dVnd = document.getElementById("cost-total-7d-vnd");
  const costTotalAllVnd = document.getElementById("cost-total-all-vnd");
  const costStateLoading = document.getElementById("cost-state-loading");
  const costStateError = document.getElementById("cost-state-error");
  const costStateEmpty = document.getElementById("cost-state-empty");
  const costContent = document.getElementById("cost-content");
  const costChartWrap = document.getElementById("cost-chart-wrap");
  const costVideosTbody = document.getElementById("cost-videos-tbody");
  const costRangeSelect = document.getElementById("cost-range-select");
  const costCustomRange = document.getElementById("cost-custom-range");
  const costDateFrom = document.getElementById("cost-date-from");
  const costDateTo = document.getElementById("cost-date-to");
  const btnApplyCustomRange = document.getElementById("btn-apply-custom-range");
  const btnExportCsv = document.getElementById("btn-export-csv");
  const costFootContent = document.getElementById("cost-foot-content");
  const costFootImage = document.getElementById("cost-foot-image");
  const costFootImagesCount = document.getElementById("cost-foot-images-count");
  const costFootTotal = document.getElementById("cost-foot-total");
  const costPagePrev = document.getElementById("cost-page-prev");
  const costPageNext = document.getElementById("cost-page-next");
  const costPageLabel = document.getElementById("cost-page-label");
  const costTableHeaders = document.querySelectorAll("#cost-content th[data-sort]");

  // Tỷ giá ƯỚC TÍNH cố định — không phải tỷ giá thời gian thực, chỉ để hình dung nhanh. Server gửi kèm /api/cost-stats (USD_TO_VND trong .env).
  let usdToVndRate = 26000;
  const COST_PAGE_SIZE = 20;

  // -------------------------------------------------------------
  // Initial Setup: Fetch Action Catalog & VieNeu Preset Voices
  // -------------------------------------------------------------
  fetchActionCatalog();
  fetchContentAngles();
  // Chạy sau khi cả handler DOMContentLoaded khai báo xong các const (initMarket dùng chúng).
  Promise.resolve().then(initMarket);

  async function fetchActionCatalog() {
    try {
      const res = await fetch("/api/actions");
      const data = await res.json();
      actionCatalog = data.actions || [];
    } catch (err) {
      console.error("Failed to load actions catalog:", err);
    }
  }

  // -------------------------------------------------------------
  // Target market (locale) and TTS engines — everything below is built from the server registries
  // (GET /api/locales, /api/tts-engines), nothing is hard-coded here.
  // -------------------------------------------------------------
  const LOCALE_STORAGE_KEY = "acv.locale";
  const localeButtons = document.getElementById("locale-buttons");
  const localeStyleLine = document.getElementById("locale-style-line");
  const localeRenderNote = document.getElementById("locale-render-note");
  const ttsNotice = document.getElementById("tts-notice");
  const voiceSelectLabel = document.getElementById("voice-select-label");
  let localesData = []; // [{code, displayName, flag, styleSummary, renderable, blockers, ...}]
  let currentLocale = null; // selected locale code
  let enginesData = []; // engines for the current locale
  let marketRequestId = 0; // ignore stale responses when the user clicks quickly

  function readStoredLocale() {
    try {
      return localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  function storeLocale(code) {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, code);
    } catch {
      // private mode / blocked storage — selection just isn't remembered
    }
  }

  function currentLocaleInfo() {
    return localesData.find((l) => l.code === currentLocale) || null;
  }

  function hasStep2Content() {
    return pointsData.length > 0 || scriptTitle.value.trim() !== "";
  }

  // Wipe Step 2 (generated content belongs to one market) — called after the user confirms a market change.
  function resetStep2Content() {
    pointsData = [];
    pendingContentSlug = null;
    scriptTitle.value = "";
    scriptLabelLeft.value = "";
    scriptLabelRight.value = "";
    scriptSlug.value = "";
    hashtagPlan = [];
    geminiHashtagMeta = { materials: [], topicTags: [], suggestedTags: [] };
    generatedContent = null;
    generatedWarnings = [];
    renderModelBadge(null);
    renderFactNote([]);
    biState = { title: emptyPair(), label_left: emptyPair(), label_right: emptyPair() };
    refreshBiEditors();
    renderHashtagChips();
  }

  function renderLocaleButtons() {
    localeButtons.innerHTML = "";
    localesData.forEach((l) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "locale-btn";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(l.code === currentLocale));
      btn.dataset.code = l.code;
      btn.title = l.renderable ? l.styleSummary : l.blockers.map((b) => b.message).join(" ");
      // Flag: bundled SVG (public/flags, declared as flagIcon in the locale file); emoji only as fallback.
      if (l.flagIcon) {
        const img = document.createElement("img");
        img.className = "locale-flag";
        img.src = l.flagIcon;
        img.alt = "";
        img.width = 24;
        img.height = 16;
        img.addEventListener("error", () => {
          const emoji = document.createElement("span");
          emoji.textContent = l.flag;
          img.replaceWith(emoji);
        });
        btn.appendChild(img);
      } else {
        const emoji = document.createElement("span");
        emoji.textContent = l.flag;
        btn.appendChild(emoji);
      }
      const label = document.createElement("span");
      label.textContent = l.displayName;
      btn.appendChild(label);
      if (!l.renderable) {
        const lock = document.createElement("span");
        lock.className = "locale-lock";
        lock.textContent = "🔒 chưa dựng được";
        btn.appendChild(lock);
      }
      btn.addEventListener("click", () => selectLocale(l.code));
      localeButtons.appendChild(btn);
    });
    const info = currentLocaleInfo();
    localeStyleLine.textContent = info ? `Văn phong: ${info.styleSummary}` : "";
    if (info && !info.renderable) {
      localeRenderNote.textContent =
        "Thị trường này chưa dựng được video — vẫn tạo/sửa/lưu nháp kịch bản bình thường. Lý do: " +
        info.blockers.map((b) => b.message).join(" ");
      localeRenderNote.classList.remove("hidden");
    } else {
      localeRenderNote.classList.add("hidden");
    }
    updateApproveState();
  }

  async function loadLocales() {
    const res = await fetch("/api/locales");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Không tải được danh sách thị trường.");
    return data;
  }

  async function initMarket() {
    if (!localeButtons) return;
    try {
      const data = await loadLocales();
      localesData = data.locales || [];
      const stored = readStoredLocale();
      currentLocale = [stored, data.defaultLocale].find((c) => c && localesData.some((l) => l.code === c)) || (localesData[0] && localesData[0].code) || null;
      renderLocaleButtons();
      await refreshMarketDependents();
    } catch (err) {
      console.error("Failed to load markets:", err);
      localeStyleLine.textContent = "Không tải được danh sách thị trường — kiểm tra server.";
    }
  }

  async function selectLocale(code) {
    if (code === currentLocale) return;
    if (hasStep2Content()) {
      const target = localesData.find((l) => l.code === code);
      const ok = confirm(
        `Đổi thị trường sang ${target ? target.displayName : code} sẽ XOÁ nội dung kịch bản ở Bước 2 (nội dung gắn với thị trường hiện tại) — bạn phải tạo lại. Tiếp tục?`,
      );
      if (!ok) return;
      resetStep2Content();
    }
    currentLocale = code;
    storeLocale(code);
    renderLocaleButtons();
    await refreshMarketDependents();
  }

  // Voice engines and the editor rules depend on the market. (Video theme is not selectable: the pipeline has a single theme, and
  // renderability from /api/locales is computed against it.)
  async function refreshMarketDependents() {
    const requestId = ++marketRequestId;
    await Promise.all([loadEngines(requestId), loadLocaleRules(requestId)]);
  }

  let enginesLocale = null; // thị trường của danh sách giọng đang hiện
  async function loadEngines(requestId) {
    if (!ttsProviderSelect || !currentLocale) return;
    try {
      const res = await fetch(`/api/tts-engines?locale=${encodeURIComponent(currentLocale)}`);
      const data = await res.json();
      if (requestId !== marketRequestId) return;
      if (!res.ok) throw new Error(data.error || "Không tải được danh sách giọng đọc.");
      enginesData = data.engines || [];
      const previous = ttsProviderSelect.value;
      ttsProviderSelect.innerHTML = "";
      enginesData.forEach((e) => {
        (e.modes || []).forEach((m) => {
          const opt = document.createElement("option");
          opt.value = `${e.id}:${m.id}`;
          // Server chỉ trả engine hỗ trợ ngôn ngữ của thị trường; engine thiếu cấu hình vẫn hiện (bị khoá) kèm lý do để biết cần điền gì.
          opt.disabled = !e.ready;
          opt.textContent = e.ready ? m.label : `${m.label} — chưa sẵn sàng: ${e.notReadyReason}`;
          ttsProviderSelect.appendChild(opt);
        });
      });
      const firstUsable = Array.from(ttsProviderSelect.options).find((o) => !o.disabled);
      // Đổi thị trường thì chọn lại mặc định của thị trường đó (không mang lựa chọn của thị trường trước sang); cùng thị trường thì giữ.
      const sameMarket = enginesLocale === currentLocale;
      enginesLocale = currentLocale;
      const keep = sameMarket ? Array.from(ttsProviderSelect.options).find((o) => o.value === previous && !o.disabled) : undefined;
      // Thị trường có thứ tự ưu tiên trong config (ja/en/th): chọn sẵn engine đầu tiên dùng được (Azure nếu có khoá, không thì Edge).
      const preferred = data.defaultEngine && Array.from(ttsProviderSelect.options).find((o) => o.value.startsWith(`${data.defaultEngine}:`) && !o.disabled);
      if (keep) ttsProviderSelect.value = keep.value;
      else if (preferred) ttsProviderSelect.value = preferred.value;
      else if (firstUsable) ttsProviderSelect.value = firstUsable.value;

      if (!enginesData.length || !firstUsable) {
        ttsNotice.textContent = data.message || "Chưa có giọng đọc nào sẵn sàng cho thị trường này.";
        ttsNotice.classList.remove("hidden");
      } else {
        ttsNotice.classList.add("hidden");
      }
      ttsProviderSelect.classList.toggle("hidden", !firstUsable);
      applyTtsSelection();
    } catch (err) {
      console.error("Failed to load TTS engines:", err);
    }
  }

  function selectedEngine() {
    const [engineId, modeId] = (ttsProviderSelect ? ttsProviderSelect.value : "").split(":");
    return { engine: enginesData.find((e) => e.id === engineId) || null, modeId };
  }

  // Show the voice list (or the clone uploader) of the selected engine/mode.
  function applyTtsSelection() {
    const { engine, modeId } = selectedEngine();
    const isClone = modeId === "clone";
    const voices = engine && !isClone ? engine.voices || [] : [];
    vieneuPresetContainer.classList.toggle("hidden", voices.length === 0);
    vieneuCloneContainer.classList.toggle("hidden", !isClone);
    vieneuPresetSelect.innerHTML = "";
    voices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.label;
      if (v.id === engine.defaultVoice) opt.selected = true;
      vieneuPresetSelect.appendChild(opt);
    });
    if (voiceSelectLabel) voiceSelectLabel.textContent = engine ? `🗣️ Chọn giọng ${engine.label}:` : "🗣️ Chọn giọng:";
  }

  // -------------------------------------------------------------
  // Step 2: bilingual editor — rules per market, view modes, render lock, busy state.
  // Per-line widgets live in /field-editor.js; warnings use the same module as the server (/shared/field-warnings.mjs).
  // -------------------------------------------------------------
  const VIEW_MODE_KEY = "acv.biViewMode";
  const VIEW_MODES = [
    { id: "both", label: "Song ngữ" },
    { id: "target", label: "Chỉ ngôn ngữ đích" },
    { id: "vi", label: "Chỉ tiếng Việt" },
  ];
  const biViewModeBox = document.getElementById("bi-view-mode");
  const renderLockNote = document.getElementById("render-lock-note");
  let localeRules = null; // GET /api/locale-rules cho thị trường đang chọn
  let biViewMode = "both";
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (VIEW_MODES.some((m) => m.id === stored)) biViewMode = stored;
  } catch {
    // storage bị chặn — chế độ xem chỉ không được nhớ
  }
  let staticEditors = []; // editor của title + 2 label
  let pointEditors = []; // widget của từng dòng point (dựng lại mỗi lần renderPointsList)
  let busyCount = 0; // số dòng đang chờ AI
  let fitIssues = []; // lỗi chữ-không-vừa-khung-video do server đo (/api/fit-check): [{field, code, message}] — chặn dựng cho tới khi sửa
  const fitRunner = createLatestRunner();
  let fitTimer = null;

  const isGloss = () => !!(localeRules && localeRules.needsGloss);

  function setBusy(delta) {
    busyCount = Math.max(0, busyCount + delta);
    updateApproveState();
  }

  // Nút dựng khoá khi: thị trường chưa render được (kèm lý do cụ thể) hoặc đang chờ AI sửa dòng nào đó.
  function updateApproveState() {
    if (!btnApproveBuild) return;
    const info = currentLocaleInfo();
    const locked = !!info && !info.renderable;
    const busyNow = busyCount > 0;
    const fitBlocked = !locked && fitIssues.length > 0;
    btnApproveBuild.disabled = locked || busyNow || fitBlocked;
    if (btnSaveDraft) btnSaveDraft.disabled = busyNow; // nội dung đang được AI sửa -> chưa lưu bản nửa vời
    btnApproveBuild.title = locked ? "Thị trường này chưa dựng được video" : busyNow ? "Đang chờ AI sửa dòng…" : fitBlocked ? "Có dòng chữ không vừa khung video" : "";
    if (locked) {
      renderLockNote.textContent = `🔒 Chưa dựng được video cho ${info.displayName}: ${info.blockers.map((b) => b.message).join(" ")} Bạn vẫn xem và sửa kịch bản bình thường.`;
    } else if (busyNow) {
      renderLockNote.textContent = "⏳ Đang chờ AI sửa dòng — nút dựng video tạm khoá để không gửi nội dung chưa xong.";
    }
    else if (fitBlocked) {
      renderLockNote.textContent = `🔒 Có ${fitIssues.length} chỗ chữ không vừa khung video (đánh dấu đỏ ở trên) — rút gọn rồi mới dựng được, để video không bị tràn chữ.`;
    }
    renderLockNote.classList.toggle("hidden", !(locked || busyNow || fitBlocked));
  }

  // Kiểm tra chữ vừa khung video: gọi server (đo bằng Chrome + font thật), debounce, chỉ nhận kết quả mới nhất.
  const FIT_DEBOUNCE_MS = 700;
  function editorForField(field) {
    if (field === "title" || field === "label_left" || field === "label_right") {
      const i = ["title", "label_left", "label_right"].indexOf(field);
      return staticEditors[i];
    }
    const m = /^points\.(\d+)\.text$/.exec(field);
    return m ? pointEditors[Number(m[1])] : undefined;
  }
  function applyFitIssues() {
    const byField = new Map();
    for (const issue of fitIssues) byField.set(issue.field, [...(byField.get(issue.field) || []), { code: issue.code, message: issue.message }]);
    for (const editor of [...staticEditors, ...pointEditors]) editor.setFitIssues([]);
    for (const [field, list] of byField) {
      const editor = editorForField(field);
      if (editor) editor.setFitIssues(list);
    }
    updateApproveState();
  }
  function scheduleFitCheck() {
    clearTimeout(fitTimer);
    if (!currentLocale || !hasStep2Content()) {
      fitRunner.cancel();
      fitIssues = [];
      updateApproveState();
      return;
    }
    fitTimer = setTimeout(async () => {
      try {
        const data = await fitRunner.run((signal) =>
          fetch("/api/fit-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locale: currentLocale, content: buildContentPayload() }),
            signal,
          }).then((r) => r.json()),
        );
        if (data === STALE || !Array.isArray(data.issues)) return;
        fitIssues = data.issues;
        applyFitIssues();
      } catch (err) {
        console.warn("fit-check lỗi:", err); // không chặn người dùng nếu không kiểm được; server vẫn kiểm lại lúc dựng
      }
    }, FIT_DEBOUNCE_MS);
  }
  step2.addEventListener("input", scheduleFitCheck);

  function biContext(point) {
    const pair = (input, st) => ({ text: input.value, vi: st.vi });
    return {
      title: pair(scriptTitle, biState.title),
      label_left: pair(scriptLabelLeft, biState.label_left),
      label_right: pair(scriptLabelRight, biState.label_right),
      pointText: point ? { text: point.text, vi: point._bi ? point._bi.text.vi : "" } : undefined,
      pointTag: point ? { text: point.tag || "", vi: point._bi ? point._bi.tag.vi : "" } : undefined,
    };
  }

  function mountEditor(kind, inputEl, state, point, onWarnings) {
    inputEl.classList.add("bi-main");
    return createFieldEditor({
      kind,
      inputEl,
      state,
      getRules: () => localeRules,
      getLocaleCode: () => currentLocale,
      getContext: () => biContext(point),
      getPendingSlug: () => pendingContentSlug,
      onBusy: setBusy,
      onWarnings,
    });
  }

  function mountStaticEditors() {
    staticEditors.forEach((editor) => editor.destroy());
    staticEditors = [];
    [
      ["title", scriptTitle],
      ["label_left", scriptLabelLeft],
      ["label_right", scriptLabelRight],
    ].forEach(([kind, input]) => {
      staticEditors.push(mountEditor(kind, input, biState[kind], null));
    });
  }

  function renderViewModeBar() {
    biViewModeBox.innerHTML = "";
    biViewModeBox.classList.toggle("hidden", !isGloss());
    VIEW_MODES.forEach((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "locale-btn bi-view-btn";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(m.id === biViewMode));
      btn.textContent = m.label;
      btn.addEventListener("click", () => {
        biViewMode = m.id;
        try {
          localStorage.setItem(VIEW_MODE_KEY, m.id);
        } catch {
          // không nhớ được chế độ xem — không sao
        }
        renderViewModeBar();
        applyViewMode();
      });
      biViewModeBox.appendChild(btn);
    });
  }

  function applyViewMode() {
    const mode = isGloss() ? biViewMode : "both";
    step2.classList.remove("bi-view-both", "bi-view-target", "bi-view-vi");
    step2.classList.add(`bi-view-${mode}`);
  }

  // (Re)build every editor widget: called when the market's rules arrive, after content is generated, and on reset.
  function refreshBiEditors() {
    mountStaticEditors();
    renderPointsList();
    renderViewModeBar();
    applyViewMode();
    updateApproveState();
    scheduleFitCheck();
  }

  async function loadLocaleRules(requestId) {
    if (!currentLocale) return;
    try {
      const res = await fetch(`/api/locale-rules?locale=${encodeURIComponent(currentLocale)}`);
      const data = await res.json();
      if (requestId !== marketRequestId) return;
      if (!res.ok) throw new Error(data.error || "Không tải được luật của thị trường.");
      localeRules = data;
      refreshBiEditors();
    } catch (err) {
      console.error("Failed to load locale rules:", err);
    }
  }

  // Content from Gemini -> editor state. Markets with a gloss line keep { vi, baseText } per line; flat markets are unchanged.
  // factWarnings: lệch so với bản gốc đã duyệt (chỉ có ở phiên bản thị trường). Nhãn lệch -> gắn vào đúng dòng, tự mất khi người dùng sửa chữ đó.
  function initBilingualState(content, factWarnings = []) {
    const pairOf = (f, path) => {
      const w = path && factWarnings.find((x) => x.path === path);
      return { vi: viOf(f), baseText: textOf(f), ...(w ? { fact: { message: w.message, forText: textOf(f) } } : {}) };
    };
    biState = { title: pairOf(content.title), label_left: pairOf(content.label_left, "label_left"), label_right: pairOf(content.label_right, "label_right") };
    pointsData = (content.points || []).map((p) => {
      const q = { ...p, text: textOf(p.text), tag: textOf(p.tag), sub: textOf(p.sub) };
      if (isGloss()) q._bi = { text: pairOf(p.text), tag: pairOf(p.tag), sub: pairOf(p.sub) };
      return q;
    });
  }

  // Content for /api/create-video (and, later, drafts): bilingual markets send { text, vi } per line, flat markets unchanged.
  function buildContentPayload() {
    return { ...contentFields(), ...(generatedBy ? { _meta: { generatedBy } } : {}) };
  }

  function contentFields() {
    const hashtagMeta = { materials: geminiHashtagMeta.materials, topicTags: geminiHashtagMeta.topicTags, suggestedTags: geminiHashtagMeta.suggestedTags };
    if (!isGloss()) {
      return {
        title: scriptTitle.value.trim(),
        label_left: scriptLabelLeft.value.trim(),
        label_right: scriptLabelRight.value.trim(),
        ...hashtagMeta,
        points: pointsData,
      };
    }
    const field = (text, st) => ({ text: String(text ?? "").trim(), vi: st.vi || "" });
    return {
      locale: currentLocale,
      title: field(scriptTitle.value, biState.title),
      label_left: field(scriptLabelLeft.value, biState.label_left),
      label_right: field(scriptLabelRight.value, biState.label_right),
      ...hashtagMeta,
      points: pointsData.map(({ _bi, ...p }) => ({ ...p, text: field(p.text, _bi.text), tag: field(p.tag, _bi.tag), sub: field(p.sub, _bi.sub) })),
    };
  }

  // -------------------------------------------------------------
  // Drafts, reopening saved content, and market versions (M4)
  // -------------------------------------------------------------
  const btnSaveDraft = document.getElementById("btn-save-draft");
  const draftNote = document.getElementById("draft-note");
  const videosLocaleFilter = document.getElementById("videos-locale-filter");
  const marketVersionModal = document.getElementById("market-version-modal");
  const marketVersionSource = document.getElementById("market-version-source");
  const marketVersionButtons = document.getElementById("market-version-buttons");
  const marketVersionStatus = document.getElementById("market-version-status");
  const btnCloseMarketVersion = document.getElementById("btn-close-market-version");
  let videosData = [];
  let marketVersionRequestId = 0;

  // Flag badge: bundled SVG (flagIcon from the locale file) with the emoji only as fallback.
  function flagBadgeHtml(item) {
    const icon = item.flagIcon
      ? `<img class="locale-flag" src="${escapeAttr(item.flagIcon)}" alt="" width="24" height="16" />`
      : `<span>${escapeHtml(item.flag || "")}</span>`;
    return `<span class="locale-badge" title="${escapeAttr(item.displayName || item.locale || "")}">${icon}<span>${escapeHtml(item.displayName || item.locale || "")}</span></span>`;
  }

  // Fill Step 2 from a content object (generated or reopened). Slug is suggested unless given.
  // Badge nhỏ: model đã sinh nội dung; "(dự phòng)" nếu là model dự phòng -> nên đọc kỹ hơn.
  function renderModelBadge(generatedBy) {
    const el = document.getElementById("gen-model-badge");
    if (!el) return;
    el.classList.toggle("hidden", !generatedBy);
    el.classList.toggle("is-fallback", !!(generatedBy && generatedBy.isFallback));
    if (!generatedBy) return;
    el.textContent = `Sinh bởi ${generatedBy.model}${generatedBy.isFallback ? " (dự phòng)" : ""}`;
    el.title = generatedBy.isFallback
      ? `Model chính ${generatedBy.primary} đang quá tải nên nội dung do model dự phòng viết — hãy đọc kỹ hơn.`
      : "Model Gemini đã sinh nội dung này.";
  }

  // Khối cảnh báo chung (không gắn được vào 1 dòng): vd số điểm so sánh lệch bản gốc.
  function renderFactNote(factWarnings) {
    const el = document.getElementById("fact-note");
    if (!el) return;
    const general = factWarnings.filter((w) => w.path !== "label_left" && w.path !== "label_right");
    el.classList.toggle("hidden", general.length === 0);
    el.textContent = general.map((w) => `⚠ ${w.message}`).join(" ");
  }

  function populateStep2({ content: raw, hashtags, hashtagMax: max, warnings, slug, generatedBy: gen, factWarnings = [] }) {
    generatedBy = gen || null;
    renderModelBadge(generatedBy);
    renderFactNote(factWarnings);
    generatedContent = raw;
    generatedWarnings = warnings || [];
    const content = flattenContent(raw);
    scriptTitle.value = content.title || "";
    scriptLabelLeft.value = content.label_left || "";
    scriptLabelRight.value = content.label_right || "";
    initBilingualState(generatedContent, factWarnings); // biState first: the slug of a foreign-language version comes from the vi labels
    geminiHashtagMeta = {
      materials: content.materials || [],
      topicTags: content.topicTags || [],
      suggestedTags: content.suggestedTags || [],
    }; // trước khi gợi ý slug: slug bản ngoại ngữ dùng materials
    scriptSlug.value = slug || buildSlugWithAngle(content.label_left, content.label_right);
    refreshBiEditors();
    hashtagPlan = hashtags || [];
    hashtagMax = max || 4;
    renderHashtagChips();
    draftNote.classList.add("hidden");
  }

  // Reopen a saved record (draft or built video) in Step 2, switching the market to the record's market.
  async function loadRecordIntoStep2(slug) {
    const res = await fetch(`/api/content-record?slug=${encodeURIComponent(slug)}`);
    const rec = await res.json();
    if (!res.ok) throw new Error(rec.error || "Không mở được nội dung đã lưu.");
    if (hasStep2Content() && !confirm("Bước 2 đang có nội dung chưa lưu — mở bản này sẽ thay thế nó. Tiếp tục?")) return false;
    resetStep2Content();
    if (rec.locale !== currentLocale) {
      currentLocale = rec.locale;
      storeLocale(rec.locale);
      renderLocaleButtons();
    }
    await refreshMarketDependents(); // luật + giọng đọc của thị trường này phải có TRƯỚC khi dựng trình soạn
    uploadedLeftPath = rec.leftPath;
    uploadedRightPath = rec.rightPath;
    pendingContentSlug = null;
    if (rec.source && rec.source.available) {
      topicHintInput.value = rec.source.topicHint || "";
      if (contentAngleSelect && Array.from(contentAngleSelect.options).some((o) => o.value === rec.source.contentAngleId)) {
        contentAngleSelect.value = rec.source.contentAngleId;
        contentAngleCustomContainer.classList.toggle("hidden", contentAngleSelect.value !== "custom");
        if (contentAngleCustomText) contentAngleCustomText.value = rec.source.customAngleText || "";
      }
    }
    populateStep2({ content: rec.content, hashtags: rec.hashtags, hashtagMax: rec.hashtagMax, warnings: rec.warnings, slug: rec.slug, generatedBy: rec.generatedBy, factWarnings: rec.factWarnings });
    gotoStep(2);
    return true;
  }

  function slugIsValidForMarket(slug) {
    const info = currentLocaleInfo();
    const suffix = info && info.slugSuffix ? info.slugSuffix : "";
    if (!SLUG_RE.test(slug)) return false;
    return !suffix || (slug.endsWith(`-${suffix}`) && slug.length > suffix.length + 1);
  }

  btnSaveDraft.addEventListener("click", async () => {
    if (!pointsData.length) {
      alert("Cần có ít nhất 1 điểm so sánh để lưu nháp!");
      return;
    }
    let slug = scriptSlug.value.trim();
    if (!slugIsValidForMarket(slug)) {
      const suggested = buildSlugWithAngle(scriptLabelLeft.value, scriptLabelRight.value);
      const info = currentLocaleInfo();
      const need = info && info.slugSuffix ? ` và kết thúc bằng "-${info.slugSuffix}" cho thị trường ${info.displayName}` : "";
      if (suggested && slugIsValidForMarket(suggested) && confirm(`Slug "${slug}" chưa hợp lệ (chữ thường a-z, số, gạch ngang${need}).\n\nDùng "${suggested}" thay thế?`)) {
        slug = suggested;
        scriptSlug.value = suggested;
      } else {
        alert(`Sửa lại slug (chữ thường a-z, số, gạch ngang${need}) rồi lưu lại nhé.`);
        return;
      }
    }
    btnSaveDraft.disabled = true;
    draftNote.classList.add("hidden");
    try {
      const res = await fetch("/api/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          locale: currentLocale,
          content: buildContentPayload(),
          hashtags: hashtagPlan,
          topicHint: topicHintInput.value.trim(),
          contentAngleId: contentAngleSelect ? contentAngleSelect.value : "auto",
          customAngleText: contentAngleCustomText ? contentAngleCustomText.value.trim() : "",
          leftPath: uploadedLeftPath,
          rightPath: uploadedRightPath,
          pendingSlug: pendingContentSlug,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lưu nháp thất bại.");
      pendingContentSlug = null; // chi phí Gemini đã gắn vào slug thật
      draftNote.textContent = `✅ Đã lưu nháp "${data.slug}" lúc ${new Date(data.savedAt).toLocaleTimeString("vi-VN")}.`;
      draftNote.classList.remove("hidden");
    } catch (err) {
      draftNote.textContent = `❌ ${err.message}`;
      draftNote.classList.remove("hidden");
    } finally {
      updateApproveState();
    }
  });

  // --- "Tạo phiên bản cho thị trường khác" ---
  function openMarketVersionModal(video) {
    marketVersionStatus.classList.add("hidden");
    marketVersionSource.textContent = `Dùng lại 2 ảnh, gợi ý ngữ cảnh và góc độ đã chọn của "${video.slug}" để Gemini viết nội dung MỚI cho thị trường khác. Kết quả lưu thành bản nháp riêng (slug riêng), không ghi đè bản gốc.`;
    marketVersionButtons.innerHTML = "";
    localesData
      .filter((l) => l.code !== video.locale)
      .forEach((l) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "locale-btn";
        btn.innerHTML = flagBadgeHtml({ flag: l.flag, flagIcon: l.flagIcon, displayName: l.displayName });
        btn.addEventListener("click", () => createMarketVersion(video, l, btn));
        marketVersionButtons.appendChild(btn);
      });
    marketVersionModal.classList.remove("hidden");
  }

  async function createMarketVersion(video, target, btn) {
    const requestId = ++marketVersionRequestId;
    const buttons = marketVersionButtons.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    marketVersionStatus.textContent = `⏳ Gemini đang viết nội dung bản ${target.displayName}… (khoảng 30 giây)`;
    marketVersionStatus.classList.remove("hidden");
    try {
      const res = await fetch("/api/market-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSlug: video.slug, locale: target.code }),
      });
      const data = await res.json();
      if (requestId !== marketVersionRequestId) return; // người dùng đã đóng/gửi yêu cầu khác
      if (!res.ok) throw new Error(data.error || "Tạo phiên bản thất bại.");
      const opened = await loadRecordIntoStep2(data.slug);
      marketVersionModal.classList.add("hidden");
      if (opened) videosModal.classList.add("hidden");
      else alert(`Đã lưu bản nháp "${data.slug}" — mở lại từ danh sách video khi cần.`);
    } catch (err) {
      if (requestId !== marketVersionRequestId) return;
      marketVersionStatus.textContent = `❌ ${err.message}`;
      marketVersionStatus.classList.remove("hidden");
    } finally {
      if (requestId === marketVersionRequestId) buttons.forEach((b) => (b.disabled = false));
    }
  }

  btnCloseMarketVersion.addEventListener("click", () => {
    marketVersionRequestId++; // bỏ kết quả của yêu cầu đang chờ (nếu có)
    marketVersionModal.classList.add("hidden");
  });

  // --- Danh sách video: badge thị trường + bộ lọc + hành động ---
  function renderVideosList() {
    const filter = videosLocaleFilter.value || "all";
    const list = filter === "all" ? videosData : videosData.filter((v) => v.locale === filter);
    videosListGrid.innerHTML = "";
    if (!list.length) {
      videosListGrid.innerHTML = `<p style="color: var(--fg-dim);">${videosData.length ? "Không có video nào thuộc thị trường này." : "Chưa có video nào được tạo."}</p>`;
      return;
    }
    list.forEach((v) => {
      const draft = v.status === "draft";
      const card = document.createElement("div");
      card.className = "video-card";
      const actions = draft
        ? `<button type="button" class="btn btn-small btn-primary btn-open-draft" data-slug="${escapeAttr(v.slug)}">✏ Mở để sửa</button>`
        : `<a href="${v.previewUrl}" target="_blank" class="btn btn-small btn-primary">${v.hasIndex ? "🎬 Xem Trước" : "▶ Xem MP4"}</a>
            ${v.renderFile && v.renderFile !== v.previewUrl ? `<a href="${v.renderFile}" target="_blank" class="btn btn-small btn-secondary">⬇ Tải MP4</a>` : ""}`;
      const versionBtn = v.canMakeVersion
        ? `<button type="button" class="btn btn-small btn-secondary btn-make-version" data-slug="${escapeAttr(v.slug)}" title="Dùng lại 2 ảnh + gợi ý + góc độ để viết nội dung cho thị trường khác">🌏 Tạo phiên bản cho thị trường khác</button>`
        : "";
      card.innerHTML = `
        <div>
          ${
            v.title && v.title.vi
              ? `<h4>${flagBadgeHtml(v)} ${escapeHtml(v.title.text)}${draft ? ' <span class="draft-badge">Bản nháp</span>' : ""}</h4>
          <div class="video-title-vi">${escapeHtml(v.title.vi)}</div>
          <div class="video-slug-dim">${escapeHtml(v.slug)} · ${escapeHtml(v.location || `videos/${v.slug}/`)}</div>`
              : `<h4>${flagBadgeHtml(v)} ${escapeHtml(v.name)}${draft ? ' <span class="draft-badge">Bản nháp</span>' : ""}</h4>
          <span style="font-size: 11px; color: var(--accent-cyan); font-family: monospace;">${escapeHtml(v.location || `videos/${v.slug}/`)}</span>`
          }
          ${v.derivedFrom ? `<div style="font-size: 11px; color: var(--fg-dim); margin-top: 2px;">Phiên bản của ${escapeHtml(v.derivedFrom)}</div>` : ""}
          ${socialStatusHtml(v.social)}
        </div>
        <div class="video-card-actions">${actions}${versionBtn}</div>
      `;
      videosListGrid.appendChild(card);
    });
  }

  // Event delegation (no inline handlers in an ES module)
  videosListGrid.addEventListener("click", async (e) => {
    const open = e.target.closest(".btn-open-draft");
    const make = e.target.closest(".btn-make-version");
    if (open) {
      open.disabled = true;
      try {
        if (await loadRecordIntoStep2(open.dataset.slug)) videosModal.classList.add("hidden");
      } catch (err) {
        alert(err.message);
      } finally {
        open.disabled = false;
      }
    } else if (make) {
      const video = videosData.find((v) => v.slug === make.dataset.slug);
      if (video) openMarketVersionModal(video);
    }
  });
  videosLocaleFilter.addEventListener("change", renderVideosList);

  async function fetchContentAngles() {
    if (!contentAngleSelect) return;
    try {
      const res = await fetch("/api/content-angles");
      const data = await res.json();
      contentAngles = data.angles || [];
    } catch (err) {
      console.error("Failed to load content angles:", err);
      contentAngles = [];
    }

    contentAngleSelect.innerHTML = "";

    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "🤖 Tự động (để AI chọn)";
    autoOpt.selected = true;
    contentAngleSelect.appendChild(autoOpt);

    contentAngles.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.label;
      contentAngleSelect.appendChild(opt);
    });

    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "✏️ Khác (tự mô tả ở bên dưới)";
    contentAngleSelect.appendChild(customOpt);
  }

  if (contentAngleSelect) {
    contentAngleSelect.addEventListener("change", () => {
      const isCustom = contentAngleSelect.value === "custom";
      contentAngleCustomContainer.classList.toggle("hidden", !isCustom);
    });
  }

  // Handle TTS Provider Change
  if (ttsProviderSelect) {
    ttsProviderSelect.addEventListener("change", applyTtsSelection);
  }

  // Handle Voice Cloning Audio Upload
  if (vieneuRefFile) {
    vieneuRefFile.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        vieneuRefStatus.textContent = "⏳ Đang tải file audio mẫu...";
        const formData = new FormData();
        formData.append("refAudio", file);

        const res = await fetch("/api/upload-ref-audio", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Tải audio thất bại.");

        uploadedRefAudioPath = data.refPath;
        vieneuRefStatus.textContent = `✅ Đã tải file mẫu: ${file.name} (Sẵn sàng clone giọng)`;
      } catch (err) {
        vieneuRefStatus.textContent = `❌ Lỗi: ${err.message}`;
        uploadedRefAudioPath = null;
      }
    });
  }

  // -------------------------------------------------------------
  // Step Navigation Helpers
  // -------------------------------------------------------------
  function gotoStep(stepNumber) {
    [step1, step2, step3].forEach((s, idx) => {
      s.classList.toggle("active", idx + 1 === stepNumber);
    });
    [stepNav1, stepNav2, stepNav3].forEach((n, idx) => {
      n.classList.toggle("active", idx + 1 === stepNumber);
      n.classList.toggle("completed", idx + 1 < stepNumber);
    });
  }

  // -------------------------------------------------------------
  // Step 1: Image Upload & Preview Logic
  // -------------------------------------------------------------
  function setupDropzone(dropzone, input, ph, wrap, imgElem, rmBtn, isLeft) {
    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) handleSelectedFile(file, ph, wrap, imgElem, isLeft);
    });

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files.length) {
        input.files = e.dataTransfer.files;
        handleSelectedFile(e.dataTransfer.files[0], ph, wrap, imgElem, isLeft);
      }
    });

    rmBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      input.value = "";
      ph.classList.remove("hidden");
      wrap.classList.add("hidden");
      if (isLeft) uploadedLeftPath = null;
      else uploadedRightPath = null;
    });
  }

  function handleSelectedFile(file, ph, wrap, imgElem, isLeft) {
    const reader = new FileReader();
    reader.onload = (e) => {
      imgElem.src = e.target.result;
      ph.classList.add("hidden");
      wrap.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  }

  setupDropzone(dropLeft, fileLeft, phLeft, prevLeftWrap, prevLeft, rmLeft, true);
  setupDropzone(dropRight, fileRight, phRight, prevRightWrap, prevRight, rmRight, false);

  // -------------------------------------------------------------
  // Step 1 -> Step 2: Upload Files & Call Gemini API
  // -------------------------------------------------------------
  btnGenerateContent.addEventListener("click", async () => {
    if (!fileLeft.files[0] || !fileRight.files[0]) {
      alert("Vui lòng chọn đủ cả 2 ảnh bên trái và bên phải trước khi tiếp tục!");
      return;
    }

    const contentAngleId = contentAngleSelect ? contentAngleSelect.value : "auto";
    const customAngleText = contentAngleCustomText ? contentAngleCustomText.value.trim() : "";
    if (contentAngleId === "custom" && !customAngleText) {
      alert("Bạn chọn \"Khác\" nhưng chưa mô tả góc độ nội dung riêng!");
      return;
    }

    try {
      btnGenerateContent.disabled = true;
      spinGen.classList.remove("hidden");
      btnGenerateContent.querySelector(".btn-text").textContent = "ĐANG TẢI VÀ GỌI GEMINI AI...";

      // 1. Upload images
      const formData = new FormData();
      formData.append("leftImage", fileLeft.files[0]);
      formData.append("rightImage", fileRight.files[0]);

      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();

      if (!uploadRes.ok) throw new Error(uploadData.error || "Tải ảnh thất bại.");
      
      uploadedLeftPath = uploadData.leftPath;
      uploadedRightPath = uploadData.rightPath;

      btnGenerateContent.querySelector(".btn-text").textContent = "GEMINI ĐANG PHÂN TÍCH VÀ SO SÁNH (30s)...";

      // 2. Call Gemini Content Generation API
      const genRes = await fetch("/api/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leftPath: uploadedLeftPath,
          rightPath: uploadedRightPath,
          topicHint: topicHintInput.value.trim(),
          contentAngleId,
          customAngleText,
          locale: currentLocale,
        }),
      });

      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || "Gemini sinh nội dung thất bại.");

      pendingContentSlug = genData.pendingSlug || null;

      // Populate Step 2 Studio with Gemini output (field song ngữ { text, vi } với thị trường ngoài tiếng Việt).
      populateStep2({ content: genData.content, hashtags: genData.hashtags, hashtagMax: genData.hashtagMax, warnings: genData.warnings, generatedBy: genData.generatedBy });

      gotoStep(2);
    } catch (err) {
      alert(`Lỗi: ${err.message}`);
    } finally {
      btnGenerateContent.disabled = false;
      spinGen.classList.add("hidden");
      btnGenerateContent.querySelector(".btn-text").textContent = "✨ TẠO NỘI DUNG VỚI GEMINI AI";
    }
  });

  // -------------------------------------------------------------
  // Step 2: Hashtag chips — xoá/thêm; tag thêm tay đi qua /api/normalize-hashtag (cùng luật chuẩn
  // hoá + danh sách cấm của server). Chip vượt giới hạn FB_MAX_HASHTAGS bị mờ = sẽ không được đăng.
  // -------------------------------------------------------------
  function renderHashtagChips() {
    hashtagChips.innerHTML = "";
    hashtagPlan.forEach((h, idx) => {
      const chip = document.createElement("span");
      const over = idx >= hashtagMax;
      chip.className = `hashtag-chip ${h.tier === "topic" ? "topic" : ""} ${over ? "over-limit" : ""}`;
      chip.title =
        (h.vi ? `${h.vi} — ` : "") +
        (over
          ? `Vượt giới hạn ${hashtagMax} hashtag — sẽ không được đăng`
          : h.tier === "topic" && !h.manual
            ? "Tag chủ đề — mỗi lần đăng có thể đổi sang tag khác cùng nhóm"
            : "Tag cố định");
      chip.innerHTML = `<span>${escapeAttr(h.tag)}</span><button type="button" aria-label="Xoá ${escapeAttr(h.tag)}">✕</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        hashtagPlan.splice(idx, 1);
        renderHashtagChips();
      });
      hashtagChips.appendChild(chip);
    });
    hashtagNote.textContent = hashtagPlan.length
      ? `Caption: câu hỏi mở đầu + tối đa ${hashtagMax} hashtag (thứ tự cụ thể → chủ đề). Viền nét đứt = tag chủ đề, tự đổi ngẫu nhiên cùng nhóm mỗi lần đăng.`
      : "Chưa có hashtag — caption sẽ chỉ có câu hỏi mở đầu.";
  }

  async function addManualHashtag() {
    const raw = hashtagAddInput.value.trim();
    if (!raw) return;
    try {
      const res = await fetch("/api/normalize-hashtag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: raw, locale: currentLocale }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Hashtag không hợp lệ.");
      if (hashtagPlan.some((h) => h.tag === data.tag)) {
        hashtagNote.textContent = `${data.tag} đã có rồi.`;
      } else {
        hashtagPlan.push({ tag: data.tag, tier: data.tier, manual: true, ...(data.vi ? { vi: data.vi } : {}) });
        // giữ thứ tự cụ thể → chủ đề (sort ổn định)
        hashtagPlan = [...hashtagPlan.filter((h) => h.tier !== "topic"), ...hashtagPlan.filter((h) => h.tier === "topic")];
        hashtagAddInput.value = "";
        renderHashtagChips();
      }
    } catch (err) {
      hashtagNote.textContent = err.message;
    }
  }
  // Tính lại chip tự động theo label hiện tại; tag thêm tay được giữ nguyên.
  async function refreshHashtags() {
    try {
      const res = await fetch("/api/plan-hashtags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label_left: scriptLabelLeft.value.trim(),
          label_right: scriptLabelRight.value.trim(),
          topicTags: geminiHashtagMeta.topicTags,
          locale: currentLocale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không tính lại được hashtag.");
      geminiHashtagMeta.topicTags = data.topicTags || geminiHashtagMeta.topicTags;
      const manual = hashtagPlan.filter((h) => h.manual);
      const auto = (data.hashtags || []).filter((h) => !manual.some((m) => m.tag === h.tag));
      const merged = [...manual, ...auto];
      hashtagPlan = [...merged.filter((h) => h.tier !== "topic"), ...merged.filter((h) => h.tier === "topic")];
      renderHashtagChips();
    } catch (err) {
      hashtagNote.textContent = err.message;
    }
  }
  document.getElementById("btn-refresh-hashtags").addEventListener("click", refreshHashtags);
  btnAddHashtag.addEventListener("click", addManualHashtag);
  hashtagAddInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addManualHashtag();
    }
  });

  // -------------------------------------------------------------
  // Step 2: Points List & Action Selector Studio
  // -------------------------------------------------------------
  function renderPointsList() {
    pointEditors.forEach((e) => e.destroy()); // huỷ yêu cầu đang chờ của các dòng sắp bị dựng lại
    pointEditors = [];
    pointsContainer.innerHTML = "";

    pointsData.forEach((p, idx) => {
      const item = document.createElement("div");
      item.className = "point-item";
      const row = document.createElement("div");
      row.className = "point-row";

      // Fallback id must be one the scaffold accepts — a pose with
      // frame.frame_class "full" in assets/actions/actions.json.
      const actionObj = actionCatalog.find((a) => a.id === p.suggested_action) || {
        id: p.suggested_action || DEFAULT_POSE,
        file: `${p.suggested_action || DEFAULT_POSE}.svg`,
      };

      row.innerHTML = `
        <div class="point-num">#${idx + 1}</div>
        <span class="point-row-spacer"></span>
        <button type="button" class="action-badge-btn" data-idx="${idx}">
          <img src="/assets/actions/${actionObj.file}" class="action-badge-img" alt="${actionObj.id}" />
          <span>${actionObj.id}</span>
        </button>
        <button type="button" class="btn-del-point" data-idx="${idx}" title="Xóa điểm này">✕</button>
      `;

      // Số thứ tự, pose, xoá nằm ở hàng đầu của card; ô chữ đích + nghĩa ngay dưới
      const input = document.createElement("input");
      input.type = "text";
      input.className = "input-text point-text-input";
      input.value = p.text;
      input.dataset.idx = String(idx);
      input.addEventListener("input", (e) => {
        pointsData[idx].text = e.target.value;
      });

      // Action picker button listener
      const actionBtn = row.querySelector(".action-badge-btn");
      actionBtn.addEventListener("click", () => {
        currentEditingPointIndex = idx;
        openActionModal(pointsData[idx].suggested_action);
      });

      // Delete button listener
      const delBtn = row.querySelector(".btn-del-point");
      delBtn.addEventListener("click", () => {
        pointsData.splice(idx, 1);
        renderPointsList();
      });

      item.append(row, input);

      // Dưới mỗi dòng: nghĩa tiếng Việt + cảnh báo của lời thoại; thị trường có dòng nghĩa còn sửa được nhãn (tag) và dòng phụ (sub).
      const extra = document.createElement("div");
      extra.className = "point-extra";
      pointEditors.push(mountEditor("text", input, p._bi ? p._bi.text : emptyPair(), p));
      if (isGloss() && p._bi) {
        // tag + sub gập trong 1 khối (mặc định đóng); có cảnh báo thì tự mở + chấm màu ở tiêu đề.
        const details = document.createElement("details");
        details.className = "point-labels";
        const summary = document.createElement("summary");
        const dot = document.createElement("span");
        dot.className = "point-labels-dot";
        summary.append("Nhãn & dòng phụ ", dot);
        const body = document.createElement("div");
        body.className = "point-labels-body";
        details.append(summary, body);
        extra.appendChild(details);
        const levels = { tag: "", sub: "" };
        const onLevel = (kind) => (level) => {
          levels[kind] = level;
          const worst = levels.tag === "danger" || levels.sub === "danger" ? "danger" : levels.tag || levels.sub;
          const had = details.classList.contains("has-warn");
          details.classList.toggle("has-warn", !!worst);
          dot.classList.toggle("is-danger", worst === "danger");
          if (worst && !had) details.open = true;
        };
        [
          ["tag", "Nhãn trên màn hình", "Chữ ngắn hiện phía trên ảnh trái/phải trong video khi câu này đang được đọc."],
          ["sub", "Dòng phụ", "Dòng chữ nhỏ hiện ngay dưới nhãn trên màn hình (có thể để trống)."],
        ].forEach(([kind, label, tip]) => {
          const group = document.createElement("div");
          group.className = "point-subfield";
          const lab = document.createElement("label");
          lab.textContent = label;
          const info = document.createElement("i");
          info.className = "info-tip";
          info.textContent = "i";
          info.title = tip;
          info.setAttribute("aria-label", tip);
          lab.append(info);
          const field = document.createElement("input");
          field.type = "text";
          field.className = "input-text";
          field.value = p[kind] || "";
          field.addEventListener("input", (e) => {
            pointsData[idx][kind] = e.target.value;
          });
          group.append(lab, field);
          body.appendChild(group);
          pointEditors.push(mountEditor(kind, field, p._bi[kind], p, onLevel(kind)));
        });
      }
      item.appendChild(extra);

      pointsContainer.appendChild(item);
    });
  }

  btnAddPoint.addEventListener("click", () => {
    // side/tag/sub are required by the scaffold — a point added here without
    // them aborts the build at points[i].side = undefined.
    const fresh = {
      text: "Điểm so sánh mới...",
      side: pointsData.length % 2 === 0 ? "left" : "right",
      tag: "Nhãn ngắn",
      sub: "",
      suggested_action: DEFAULT_POSE,
    };
    // thị trường có dòng nghĩa: điểm mới do người dùng tự gõ, chưa có nghĩa tiếng Việt (hiện "chưa cập nhật nghĩa" + ↻)
    if (isGloss()) {
      fresh.text = "";
      fresh.tag = "";
      fresh._bi = emptyPointBi();
    }
    pointsData.push(fresh);
    renderPointsList();
  });

  btnBackStep1.addEventListener("click", () => gotoStep(1));

  // -------------------------------------------------------------
  // Action Selector Modal
  // -------------------------------------------------------------
  function openActionModal(selectedId) {
    actionGrid.innerHTML = "";

    actionCatalog.forEach((act) => {
      const card = document.createElement("div");
      card.className = `action-card ${act.id === selectedId ? "selected" : ""}`;
      
      const propBadge = act.prop === "jewelry" ? `<span class="prop-badge">JEWELRY</span>` : "";
      const firstTag = act.tags && act.tags[0] ? act.tags[0] : "";

      card.innerHTML = `
        ${propBadge}
        <img src="/assets/actions/${act.file}" class="action-card-img" alt="${act.id}" />
        <div class="action-card-name">${act.id}</div>
        <div class="action-card-tag">${firstTag}</div>
      `;

      card.addEventListener("click", () => {
        if (currentEditingPointIndex !== null && pointsData[currentEditingPointIndex]) {
          pointsData[currentEditingPointIndex].suggested_action = act.id;
          renderPointsList();
        }
        closeActionModal();
      });

      actionGrid.appendChild(card);
    });

    actionModal.classList.remove("hidden");
  }

  function closeActionModal() {
    actionModal.classList.add("hidden");
    currentEditingPointIndex = null;
  }

  btnCloseModal.addEventListener("click", closeActionModal);
  actionModal.addEventListener("click", (e) => {
    if (e.target === actionModal) closeActionModal();
  });

  // -------------------------------------------------------------
  // Step 2 -> Step 3: Approve Script & Stream Video Generation
  // -------------------------------------------------------------
  btnApproveBuild.addEventListener("click", async () => {
    if (!pointsData.length) {
      alert("Cần có ít nhất 1 điểm so sánh!");
      return;
    }

    // Catch a bad slug here instead of after the upload + Gemini call, when
    // scaffold-compare-video.mjs rejects it and the whole run is wasted.
    const slug = scriptSlug.value.trim();
    if (!SLUG_RE.test(slug)) {
      const suggested = buildSlugWithAngle(scriptLabelLeft.value, scriptLabelRight.value);
      const useSuggested =
        suggested &&
        confirm(
          `Slug "${slug}" không hợp lệ — chỉ được dùng chữ thường a-z, số, và dấu gạch ngang ` +
            `(không dấu tiếng Việt, không gạch ở đầu/cuối).\n\nDùng "${suggested}" thay thế?`,
        );
      if (!useSuggested) {
        alert("Sửa lại slug rồi bấm dựng video lại nhé.");
        return;
      }
      scriptSlug.value = suggested;
    }

    const payloadContent = buildContentPayload();

    gotoStep(3);
    terminalLogs.textContent = "▶ Đang kết nối tới server để dựng video...\n";
    buildSuccessCard.classList.add("hidden");

    try {
      const { engine, modeId } = selectedEngine();
      if (!engine) {
        alert("Chưa có giọng đọc nào sẵn sàng cho thị trường này — không thể dựng video.");
        return;
      }
      const ttsProvider = engine.id;
      let vieneuVoice = null;
      let vieneuRefPath = null;
      let ttsVoice = null;

      if (modeId === "clone") {
        if (!uploadedRefAudioPath) {
          alert("Bạn chọn nhái giọng nhưng chưa tải lên file audio 3-5 giây!");
          return;
        }
        vieneuRefPath = uploadedRefAudioPath;
      } else if (engine.voices && engine.voices.length) {
        const voice = vieneuPresetSelect ? vieneuPresetSelect.value : engine.defaultVoice;
        if (engine.id === "vieneu") vieneuVoice = voice;
        else ttsVoice = voice;
      }

      const response = await fetch("/api/create-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leftPath: uploadedLeftPath,
          rightPath: uploadedRightPath,
          content: payloadContent,
          hashtags: hashtagPlan,
          slug: scriptSlug.value.trim(),
          pendingSlug: pendingContentSlug,
          topicHint: topicHintInput.value.trim(),
          contentAngleId: contentAngleSelect ? contentAngleSelect.value : "auto",
          customAngleText: contentAngleCustomText ? contentAngleCustomText.value.trim() : "",
          ttsProvider,
          ttsVoice,
          vieneuVoice,
          vieneuRefPath,
          locale: currentLocale,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.substring(6));
              
              if (data.message) {
                terminalLogs.textContent += `${data.message}\n`;
                terminalLogs.scrollTop = terminalLogs.scrollHeight;
              }

              if (data.type === "success") {
                buildSuccessCard.classList.remove("hidden");
                btnOpenPreview.href = data.previewUrl;
                document.getElementById("success-desc").textContent = 
                  `Video "videos/${data.slug}/" đã được dựng thành công và sẵn sàng!`;
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      terminalLogs.textContent += `\n✖ Lỗi kết nối: ${err.message}\n`;
    }
  });

  btnCreateAnother.addEventListener("click", () => {
    gotoStep(1);
  });

  // -------------------------------------------------------------
  // Existing Videos Modal
  // -------------------------------------------------------------
  btnExistingVideos.addEventListener("click", async () => {
    videosModal.classList.remove("hidden");
    videosListGrid.innerHTML = `<p style="color: var(--fg-dim);">Đang tải danh sách...</p>`;
    loadSocialAlerts();

    try {
      const res = await fetch("/api/videos");
      videosData = await res.json();
      // bộ lọc thị trường: chỉ liệt kê thị trường đang có trong danh sách (giữ lựa chọn hiện tại nếu còn)
      const previous = videosLocaleFilter.value || "all";
      const seen = new Map();
      videosData.forEach((v) => seen.set(v.locale, v.displayName));
      videosLocaleFilter.innerHTML = "";
      [["all", "Tất cả"], ...seen.entries()].forEach(([code, name]) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = name;
        videosLocaleFilter.appendChild(opt);
      });
      videosLocaleFilter.value = seen.has(previous) ? previous : "all";
      renderVideosList();
    } catch (err) {
      videosListGrid.innerHTML = `<p style="color: var(--danger);">Lỗi nạp danh sách: ${escapeHtml(err.message)}</p>`;
    }
  });

  // Cảnh báo đăng Facebook: page bị tắt vì lỗi token, cấu hình dở dang, ffmpeg hỏng.
  async function loadSocialAlerts() {
    const box = document.getElementById("social-alerts");
    if (!box) return;
    box.innerHTML = "";
    try {
      const st = await (await fetch("/api/social-status")).json();
      const items = [];
      for (const d of st.disabledPages || []) {
        items.push(`<b>Page "${escapeHtml(d.pageName)}" đang bị TẮT</b> vì lỗi token: ${escapeHtml(d.reason || "không rõ")}<br><span style="opacity:.8">${escapeHtml(d.howToEnable)}</span>`);
      }
      for (const p of st.configProblems || []) items.push(escapeHtml(p));
      if (st.autoPost && !(st.configuredPages || []).length) items.push("Đăng tự động đang bật nhưng chưa có page hợp lệ nào trong .env.");
      if (st.autoPost && st.ffmpeg && st.ffmpeg.ok === false) items.push(`ffmpeg lỗi (${escapeHtml(st.ffmpeg.detail)}) — không đặt được ảnh bìa Reel.`);
      box.innerHTML = items
        .map((t) => `<div style="font-size: 12px; color: var(--danger); border: 1px solid var(--danger); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px;">⚠ ${t}</div>`)
        .join("");
    } catch {
      // không lấy được trạng thái -> bỏ qua, danh sách video vẫn hiện bình thường
    }
  }

  btnCloseVideosModal.addEventListener("click", () => videosModal.classList.add("hidden"));
  videosModal.addEventListener("click", (e) => {
    if (e.target === videosModal) videosModal.classList.add("hidden");
  });

  // -------------------------------------------------------------
  // Cost Stats Modal — GET /api/cost-stats (xem output/cost-ledger.jsonl)
  //
  // Kiến trúc: fetch 1 lần khi mở modal (costRawData giữ nguyên response), mọi tương tác sau đó
  // (đổi khoảng ngày, sort cột, đổi trang, xuất CSV) chỉ tính toán lại trên dữ liệu đã có trong
  // trình duyệt — không gọi lại API — vì toàn bộ ledger là 1 file JSONL nhỏ đọc 1 lần là đủ.
  //
  // 3 thẻ tổng hợp (hôm nay/7 ngày/toàn thời gian) CỐ ĐỊNH, không đổi theo bộ lọc khoảng ngày —
  // đó là mốc KPI tham chiếu luôn hiện diện. Bộ lọc khoảng ngày chỉ tác động biểu đồ + bảng chi
  // tiết bên dưới (đúng mẫu "filters scope the content below them", không phải toàn trang).
  // -------------------------------------------------------------
  const DAY_MS = 24 * 60 * 60 * 1000;
  const USD_TO_VND_TOOLTIP = "Tỷ giá ước tính cố định, không phải tỷ giá thời gian thực.";

  let costRawData = null; // response gốc từ /api/cost-stats
  let costFilteredSorted = []; // video list sau filter+sort hiện tại (dùng cho footer + export CSV)
  let costSortKey = "createdAt";
  let costSortDir = "desc";
  let costPage = 1;
  let costLocaleFilter = "all";

  function formatUsd(n) {
    const v = typeof n === "number" ? n : 0;
    // Chi phí mỗi lần gọi rất nhỏ (vài phần nghìn USD) — 2 số thập phân sẽ hiện toàn $0.00,
    // nên hiện 4 số thập phân để còn thấy chênh lệch giữa các video.
    return `$${v.toFixed(4)}`;
  }

  function formatVnd(usdAmount) {
    const vnd = Math.round((usdAmount || 0) * usdToVndRate);
    return `≈ ${vnd.toLocaleString("vi-VN")}₫`;
  }

  function formatDateShort(dateStr) {
    const parts = String(dateStr).split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : dateStr;
  }

  btnCostStats.addEventListener("click", () => {
    costStatsModal.classList.remove("hidden");
    openCostStats();
  });

  async function openCostStats() {
    costStateLoading.classList.remove("hidden");
    costStateError.classList.add("hidden");
    costStateEmpty.classList.add("hidden");
    costContent.classList.add("hidden");
    btnExportCsv.disabled = true;

    try {
      const res = await fetch("/api/cost-stats");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không tải được thống kê chi phí.");

      costRawData = data;
      if (Number.isFinite(data.usdToVnd) && data.usdToVnd > 0) usdToVndRate = data.usdToVnd;
      costPage = 1;
      populateCostLocaleSelect(data);
      costStateLoading.classList.add("hidden");

      // Ledger rỗng hoàn toàn (chưa từng có lần gọi Gemini nào) — khác với "có dữ liệu nhưng
      // khoảng ngày đang lọc không khớp video nào", cái đó xử lý trong renderCostStats().
      if (!data.byDay || !data.byDay.length) {
        costStateEmpty.classList.remove("hidden");
        return;
      }

      renderCostStats();
    } catch (err) {
      costStateLoading.classList.add("hidden");
      costStateError.textContent = `⚠ Lỗi tải thống kê chi phí: ${err.message}`;
      costStateError.classList.remove("hidden");
    }
  }

  // ---- Khoảng ngày hiển thị trên biểu đồ (zero-fill ngày không có chi phí để trục thời gian
  // đúng thực tế — nếu không zero-fill, 2 ngày cách xa nhau sẽ trông như liền kề, đọc sai xu
  // hướng). "Tất cả" bị chặn tối đa 60 cột để biểu đồ còn đọc được (personal tool, không kỳ
  // vọng lịch sử hàng trăm ngày) — bảng chi tiết bên dưới KHÔNG bị chặn theo giới hạn này.
  function getChartDates(rangeValue, byDayMap) {
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);

    if (rangeValue === "custom") {
      const fromStr = costDateFrom.value;
      const toStr = costDateTo.value || todayUtc.toISOString().slice(0, 10);
      if (!fromStr) return [todayUtc.toISOString().slice(0, 10)];
      const fromUtc = new Date(`${fromStr}T00:00:00Z`);
      const toUtc = new Date(`${toStr}T00:00:00Z`);
      if (toUtc < fromUtc) return [fromStr];
      // Chặn khoảng quá dài để biểu đồ không bị nén thành các cột chỉ vài px.
      const days = Math.min(Math.round((toUtc.getTime() - fromUtc.getTime()) / DAY_MS) + 1, 90);
      const dates = [];
      for (let i = 0; i < days; i++) {
        dates.push(new Date(fromUtc.getTime() + i * DAY_MS).toISOString().slice(0, 10));
      }
      return dates;
    }

    let days;
    if (rangeValue === "all") {
      const allDates = Object.keys(byDayMap).sort();
      if (!allDates.length) {
        days = 1;
      } else {
        const earliest = new Date(`${allDates[0]}T00:00:00Z`);
        days = Math.round((todayUtc.getTime() - earliest.getTime()) / DAY_MS) + 1;
      }
      days = Math.min(Math.max(days, 1), 60);
    } else {
      days = parseInt(rangeValue, 10) || 7;
    }
    const dates = [];
    for (let i = days - 1; i >= 0; i--) {
      dates.push(new Date(todayUtc.getTime() - i * DAY_MS).toISOString().slice(0, 10));
    }
    return dates;
  }

  function renderCostChart(dates, byDayMap) {
    costChartWrap.innerHTML = "";

    const values = dates.map((d) => byDayMap[d] || 0);
    const maxVal = Math.max(...values, 0.0001);

    const width = 880;
    const height = 160;
    const paddingBottom = 6;
    const paddingTop = 8;
    const plotHeight = height - paddingBottom - paddingTop;
    const slotWidth = width / dates.length;
    const barWidth = Math.max(2, Math.min(22, slotWidth - 3));

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", String(height));
    svg.setAttribute("preserveAspectRatio", "none");
    svg.classList.add("cost-chart-svg");

    const baseline = document.createElementNS(svgNS, "line");
    baseline.setAttribute("x1", "0");
    baseline.setAttribute("x2", String(width));
    baseline.setAttribute("y1", String(height - paddingBottom));
    baseline.setAttribute("y2", String(height - paddingBottom));
    baseline.setAttribute("class", "cost-chart-baseline");
    svg.appendChild(baseline);

    const tooltip = document.createElement("div");
    tooltip.className = "cost-chart-tooltip hidden";
    costChartWrap.appendChild(tooltip);

    dates.forEach((date, i) => {
      const val = values[i];
      const barHeight = maxVal > 0 ? (val / maxVal) * plotHeight : 0;
      const slotX = i * slotWidth;
      const barX = slotX + (slotWidth - barWidth) / 2;
      const barY = height - paddingBottom - barHeight;

      const bar = document.createElementNS(svgNS, "rect");
      bar.setAttribute("x", String(barX));
      bar.setAttribute("y", String(barY));
      bar.setAttribute("width", String(barWidth));
      bar.setAttribute("height", String(val > 0 ? Math.max(barHeight, 2) : 0));
      bar.setAttribute("rx", "3");
      bar.setAttribute("ry", "3");
      bar.classList.add("cost-chart-bar");

      // Hit area rộng hơn thanh thật (toàn bộ slot) — theo nguyên tắc "hit target lớn hơn mark"
      // vì thanh chi phí thấp/mảnh rất khó trỏ trúng chính xác bằng chuột.
      const hit = document.createElementNS(svgNS, "rect");
      hit.setAttribute("x", String(slotX));
      hit.setAttribute("y", String(paddingTop));
      hit.setAttribute("width", String(slotWidth));
      hit.setAttribute("height", String(height - paddingBottom - paddingTop));
      hit.setAttribute("fill", "transparent");
      hit.setAttribute("tabindex", "0");
      hit.classList.add("cost-chart-hit");

      const showTooltip = () => {
        tooltip.innerHTML = "";
        const strong = document.createElement("strong");
        strong.textContent = formatUsd(val);
        const small = document.createElement("span");
        small.textContent = ` — ${formatDateShort(date)}`;
        tooltip.appendChild(strong);
        tooltip.appendChild(small);
        tooltip.classList.remove("hidden");
        tooltip.style.left = `${((slotX + slotWidth / 2) / width) * 100}%`;
        tooltip.style.top = `${(barY / height) * 100}%`;
        bar.classList.add("cost-chart-bar-hover");
      };
      const hideTooltip = () => {
        tooltip.classList.add("hidden");
        bar.classList.remove("cost-chart-bar-hover");
      };

      hit.addEventListener("pointerenter", showTooltip);
      hit.addEventListener("pointermove", showTooltip);
      hit.addEventListener("pointerleave", hideTooltip);
      hit.addEventListener("focus", showTooltip);
      hit.addEventListener("blur", hideTooltip);

      svg.appendChild(bar);
      svg.appendChild(hit);
    });

    costChartWrap.appendChild(svg);

    // Nhãn chọn lọc — chỉ ngày đầu/cuối, không nhồi nhãn lên từng cột (marks-and-anatomy: label
    // selectively, never a number on every point).
    const labelRow = document.createElement("div");
    labelRow.className = "cost-chart-labels";
    const firstLabel = document.createElement("span");
    firstLabel.textContent = formatDateShort(dates[0]);
    const lastLabel = document.createElement("span");
    lastLabel.textContent = formatDateShort(dates[dates.length - 1]);
    labelRow.appendChild(firstLabel);
    labelRow.appendChild(lastLabel);
    costChartWrap.appendChild(labelRow);
  }

  function sortVideos(list, key, dir) {
    return [...list].sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (typeof av === "string" || typeof bv === "string") {
        av = String(av || "").toLowerCase();
        bv = String(bv || "").toLowerCase();
      } else {
        av = av || 0;
        bv = bv || 0;
      }
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }

  function paginateVideos(list) {
    const totalPages = Math.max(1, Math.ceil(list.length / COST_PAGE_SIZE));
    if (costPage > totalPages) costPage = totalPages;
    const start = (costPage - 1) * COST_PAGE_SIZE;
    return { pageItems: list.slice(start, start + COST_PAGE_SIZE), totalPages };
  }

  // Bộ lọc thị trường của bảng chi phí + dòng tổng theo thị trường (badge cờ). Dữ liệu cũ thiếu locale = thị trường mặc định (server đã gộp).
  function populateCostLocaleSelect(data) {
    const select = document.getElementById("cost-locale-select");
    const box = document.getElementById("cost-by-locale");
    select.innerHTML = "";
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "Tất cả";
    select.appendChild(all);
    (data.locales || []).forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = l.displayName;
      select.appendChild(opt);
    });
    if (!(data.locales || []).some((l) => l.code === costLocaleFilter)) costLocaleFilter = "all";
    select.value = costLocaleFilter;
    box.innerHTML = (data.locales || [])
      .map((l) => `<span class="cost-locale-chip">${flagBadgeHtml({ flag: l.flag, flagIcon: l.flagIcon, displayName: l.displayName })} <b>${formatUsd((data.byLocale || {})[l.code] || 0)}</b></span>`)
      .join("");
  }
  document.getElementById("cost-locale-select").addEventListener("change", (e) => {
    costLocaleFilter = e.target.value;
    costPage = 1;
    renderCostStats();
  });

  function renderCostTableRows(pageItems) {
    costVideosTbody.innerHTML = "";
    if (!pageItems.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "cost-table-empty-row";
      td.textContent = "Không có video nào trong khoảng thời gian đang lọc.";
      tr.appendChild(td);
      costVideosTbody.appendChild(tr);
      return;
    }
    pageItems.forEach((v) => {
      const tr = document.createElement("tr");
      const createdAt = v.createdAt ? new Date(v.createdAt).toLocaleString("vi-VN") : "—";
      tr.innerHTML = `
        <td class="cost-td-slug">${escapeHtml(v.slug)}</td>
        <td>${flagBadgeHtml(v)}</td>
        <td>${escapeHtml(createdAt)}</td>
        <td class="cost-td-content">${formatUsd(v.contentCost)}</td>
        <td class="cost-td-image">${formatUsd(v.imageCost)}</td>
        <td>${v.imagesGenerated || 0}</td>
        <td class="cost-td-total">
          ${formatUsd(v.totalCost)}${v.unpricedCalls ? `<span class="cost-unpriced-tag" title="${v.unpricedCalls} lần gọi dùng model chưa có đơn giá trong config/pricing.mjs — số tiền thật cao hơn số hiện ở đây.">chưa có giá ×${v.unpricedCalls}</span>` : ""}
          <span class="cost-td-total-vnd" title="${USD_TO_VND_TOOLTIP}">${formatVnd(v.totalCost)}</span>
        </td>
      `;
      costVideosTbody.appendChild(tr);
    });
  }

  function renderCostFooterTotals(list) {
    const totals = list.reduce(
      (acc, v) => {
        acc.content += v.contentCost || 0;
        acc.image += v.imageCost || 0;
        acc.images += v.imagesGenerated || 0;
        acc.total += v.totalCost || 0;
        return acc;
      },
      { content: 0, image: 0, images: 0, total: 0 },
    );
    costFootContent.textContent = formatUsd(totals.content);
    costFootImage.textContent = formatUsd(totals.image);
    costFootImagesCount.textContent = String(totals.images);
    costFootTotal.textContent = formatUsd(totals.total);
  }

  function updateSortArrows() {
    costTableHeaders.forEach((th) => {
      const arrow = th.querySelector(".sort-arrow");
      if (!arrow) return;
      arrow.textContent = th.dataset.sort === costSortKey ? (costSortDir === "asc" ? " ▲" : " ▼") : "";
    });
  }

  function renderCostStats() {
    if (!costRawData) return;

    // openCostStats() ẩn #cost-content trước khi fetch (để không loé nội dung cũ trong lúc chờ
    // API) — nhánh "có dữ liệu" phải tự hiện lại nó ở đây. Thiếu dòng này là lý do biểu đồ + bảng
    // được TÍNH TOÁN và ĐIỀN DỮ LIỆU đầy đủ (không lỗi JS, không throw) nhưng người dùng không
    // bao giờ thấy gì cả — div cha vẫn mang class "hidden" (display:none) nên không chiếm chỗ,
    // khiến modal trông như bị cắt cụt sau 3 thẻ tổng và không có gì để cuộn thêm.
    costContent.classList.remove("hidden");

    const rangeValue = costRangeSelect.value;

    // KPI cố định — không đổi theo bộ lọc (xem ghi chú kiến trúc ở đầu section).
    costTotalToday.textContent = formatUsd(costRawData.totalToday);
    costTotalTodayVnd.textContent = formatVnd(costRawData.totalToday);
    costTotal7d.textContent = formatUsd(costRawData.totalLast7Days);
    costTotal7dVnd.textContent = formatVnd(costRawData.totalLast7Days);
    const unpricedNote = document.getElementById("cost-unpriced-note");
    unpricedNote.classList.toggle("hidden", !costRawData.unpricedCalls);
    if (costRawData.unpricedCalls) {
      unpricedNote.textContent = `⚠ ${costRawData.unpricedCalls} lần gọi dùng model chưa có đơn giá (${(costRawData.unpricedModels || []).join(", ")}) — đang tính 0 USD, chi phí thật cao hơn số hiện. Thêm giá vào config/pricing.mjs rồi chạy scripts/reprice-cost-ledger.mjs.`;
    }
    costTotalAll.textContent = formatUsd(costRawData.totalAllTime);
    costTotalAllVnd.textContent = formatVnd(costRawData.totalAllTime);

    const byDayMap = {};
    (costRawData.byDay || []).forEach((d) => {
      byDayMap[d.date] = d.cost;
    });

    const chartDates = getChartDates(rangeValue, byDayMap);
    renderCostChart(chartDates, byDayMap);

    // Bảng chi tiết: lọc theo cùng khoảng ngày với biểu đồ (trừ "Tất cả" — không giới hạn 60
    // ngày như biểu đồ, video cũ hơn 60 ngày vẫn phải hiện đủ trong bảng). "Tùy chọn ngày" cần
    // cả 2 đầu mốc vì "đến ngày" không nhất thiết là hôm nay như 2 preset kia.
    let videos = costRawData.videos || [];
    if (rangeValue !== "all") {
      const cutoffFrom = chartDates[0];
      const cutoffTo = chartDates[chartDates.length - 1];
      videos = videos.filter((v) => {
        if (!v.createdAt) return false;
        const d = v.createdAt.slice(0, 10);
        return d >= cutoffFrom && d <= cutoffTo;
      });
    }

    if (costLocaleFilter !== "all") videos = videos.filter((v) => v.locale === costLocaleFilter);

    const enriched = videos.map((v) => ({
      ...v,
      contentCost: (v.byTask && v.byTask["content-generation"]) || 0,
      imageCost: (v.byTask && v.byTask["context-image"]) || 0,
    }));

    costFilteredSorted = sortVideos(enriched, costSortKey, costSortDir);
    btnExportCsv.disabled = costFilteredSorted.length === 0;

    const { pageItems, totalPages } = paginateVideos(costFilteredSorted);
    renderCostTableRows(pageItems);
    renderCostFooterTotals(costFilteredSorted);
    costPageLabel.textContent = `Trang ${costPage}/${totalPages}`;
    costPagePrev.disabled = costPage <= 1;
    costPageNext.disabled = costPage >= totalPages;
    updateSortArrows();
  }

  costRangeSelect.addEventListener("change", () => {
    const isCustom = costRangeSelect.value === "custom";
    costCustomRange.classList.toggle("hidden", !isCustom);
    if (isCustom) {
      // Mở lần đầu chưa chọn ngày nào: mặc định 7 ngày gần nhất cho có dữ liệu ngay,
      // người dùng chỉnh lại theo ý muốn rồi bấm Áp dụng.
      if (!costDateTo.value) {
        const todayUtc = new Date();
        todayUtc.setUTCHours(0, 0, 0, 0);
        costDateTo.value = todayUtc.toISOString().slice(0, 10);
      }
      if (!costDateFrom.value) {
        const todayUtc = new Date();
        todayUtc.setUTCHours(0, 0, 0, 0);
        costDateFrom.value = new Date(todayUtc.getTime() - 6 * DAY_MS).toISOString().slice(0, 10);
      }
      return; // chờ bấm "Áp dụng" thay vì render ngay với ngày mặc định vừa điền
    }
    costPage = 1;
    renderCostStats();
  });

  btnApplyCustomRange.addEventListener("click", () => {
    if (!costDateFrom.value || !costDateTo.value) return;
    if (costDateFrom.value > costDateTo.value) {
      alert("\"Từ ngày\" phải trước hoặc bằng \"Đến ngày\".");
      return;
    }
    costPage = 1;
    renderCostStats();
  });

  costTableHeaders.forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (costSortKey === key) {
        costSortDir = costSortDir === "asc" ? "desc" : "asc";
      } else {
        costSortKey = key;
        costSortDir = key === "slug" ? "asc" : "desc";
      }
      costPage = 1;
      renderCostStats();
    });
  });

  costPagePrev.addEventListener("click", () => {
    if (costPage > 1) {
      costPage--;
      renderCostStats();
    }
  });
  costPageNext.addEventListener("click", () => {
    costPage++;
    renderCostStats();
  });

  function csvEscape(value) {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function exportCostCsv() {
    if (!costFilteredSorted.length) return;
    const header = ["slug", "locale", "created_at", "content_cost_usd", "image_cost_usd", "images_generated", "total_cost_usd"];
    const lines = [header.join(",")];
    const totals = { content: 0, image: 0, images: 0, total: 0 };

    costFilteredSorted.forEach((v) => {
      totals.content += v.contentCost || 0;
      totals.image += v.imageCost || 0;
      totals.images += v.imagesGenerated || 0;
      totals.total += v.totalCost || 0;
      lines.push(
        [
          csvEscape(v.slug),
          csvEscape(v.locale || ""),
          csvEscape(v.createdAt || ""),
          (v.contentCost || 0).toFixed(6),
          (v.imageCost || 0).toFixed(6),
          v.imagesGenerated || 0,
          (v.totalCost || 0).toFixed(6),
        ].join(","),
      );
    });
    lines.push(
      ["TONG", "", "", totals.content.toFixed(6), totals.image.toFixed(6), totals.images, totals.total.toFixed(6)].join(","),
    );

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cost-stats-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  btnExportCsv.addEventListener("click", exportCostCsv);

  btnCloseCostModal.addEventListener("click", () => costStatsModal.classList.add("hidden"));
  costStatsModal.addEventListener("click", (e) => {
    if (e.target === costStatsModal) costStatsModal.classList.add("hidden");
  });

  // Helper
  function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(str) {
    return String(str || "").replace(/"/g, "&quot;");
  }
  // Dòng trạng thái đăng Facebook trong video-card (v.social đến từ GET /api/videos,
  // gắn ở server.mjs từ data/social-queue.json — xem socialStatusBySlug()).
  function socialStatusHtml(social) {
    if (!social) return "";
    if (social.status === "posted") {
      const when = new Date(social.postedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
      const typeLabel = social.postType === "reel" ? "Reel" : "video thường";
      const fallbackNote = social.fallbackReason
        ? ` <span title="${escapeAttr(social.fallbackReason)}" style="color: var(--fg-dim);">(fallback từ Reel — hover xem lý do)</span>`
        : "";
      return `<div style="font-size: 11px; color: var(--accent-cyan); margin-top: 4px;">✔ Đã đăng ${typeLabel} lên ${escapeHtml(social.pageName)} lúc ${when}${fallbackNote}</div>`;
    }
    if (social.status === "verifying") {
      return `<div style="font-size: 11px; color: var(--fg-dim); margin-top: 4px;">⏳ Reel đã tạo trên ${escapeHtml(social.pageName || "")}, Facebook đang xử lý...</div>`;
    }
    if (social.status === "failed") {
      return `<div style="font-size: 11px; color: var(--danger); margin-top: 4px;" title="${escapeAttr(social.lastError || "")}">✖ Đăng Facebook thất bại</div>`;
    }
    return `<div style="font-size: 11px; color: var(--fg-dim); margin-top: 4px;">⏳ Đang chờ đăng Facebook</div>`;
  }
});
