// Auto Compare Video Web UI Application Logic
document.addEventListener("DOMContentLoaded", () => {
  // State
  let uploadedLeftPath = null;
  let uploadedRightPath = null;
  let pendingContentSlug = null; // slug tạm gắn ở Bước 1 (/api/generate-content), đổi thành slug thật ở /api/create-video
  let actionCatalog = [];
  let currentEditingPointIndex = null;
  let pointsData = [];

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

  // Slug — must match the kebab-case rule scaffold-compare-video.mjs enforces
  // (/^[a-z0-9]+(-[a-z0-9]+)*$/). Vietnamese needs the NFD pass: plain
  // .replace(/[^a-z0-9]+/g, "-") deletes the accented letter itself, so
  // "Cá voi sát thủ" came out "c-voi-s-t-th-" and the build aborted.
  function slugify(s) {
    return (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // combining tone/diacritic marks
      .replace(/[đĐ]/g, "d") // U+0111 has no NFD decomposition
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

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

  function buildSlugWithAngle(left, right) {
    const base = buildSlug(left, right);
    const suffix = contentAngleSlugSuffix();
    return suffix ? `${base}-${suffix}` : base;
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

  // Tỷ giá ƯỚC TÍNH cố định — không phải tỷ giá thời gian thực, chỉ để hình dung nhanh.
  const USD_TO_VND_RATE = 26000;
  const COST_PAGE_SIZE = 20;

  // -------------------------------------------------------------
  // Initial Setup: Fetch Action Catalog & VieNeu Preset Voices
  // -------------------------------------------------------------
  fetchActionCatalog();
  fetchVieNeuVoices();
  fetchContentAngles();

  async function fetchActionCatalog() {
    try {
      const res = await fetch("/api/actions");
      const data = await res.json();
      actionCatalog = data.actions || [];
    } catch (err) {
      console.error("Failed to load actions catalog:", err);
    }
  }

  async function fetchVieNeuVoices() {
    if (!vieneuPresetSelect) return;
    try {
      const res = await fetch("/api/vieneu-voices");
      const data = await res.json();
      const voices = data.voices || [];
      vieneuPresetSelect.innerHTML = "";
      voices.forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = v.label;
        if (v.id === data.defaultVoice) opt.selected = true;
        vieneuPresetSelect.appendChild(opt);
      });
    } catch (err) {
      console.error("Failed to load VieNeu voices:", err);
    }
  }

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
    ttsProviderSelect.addEventListener("change", () => {
      const val = ttsProviderSelect.value;
      if (val === "vieneu_preset") {
        vieneuPresetContainer.classList.remove("hidden");
        vieneuCloneContainer.classList.add("hidden");
      } else if (val === "vieneu_clone") {
        vieneuPresetContainer.classList.add("hidden");
        vieneuCloneContainer.classList.remove("hidden");
      } else {
        vieneuPresetContainer.classList.add("hidden");
        vieneuCloneContainer.classList.add("hidden");
      }
    });
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
        }),
      });

      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || "Gemini sinh nội dung thất bại.");

      pendingContentSlug = genData.pendingSlug || null;

      // Populate Step 2 Studio with Gemini output
      const content = genData.content;
      scriptTitle.value = content.title || "";
      scriptLabelLeft.value = content.label_left || "";
      scriptLabelRight.value = content.label_right || "";

      // Auto-generate suggested slug — hậu tố theo góc độ nội dung đã chọn ở Bước 1
      scriptSlug.value = buildSlugWithAngle(content.label_left, content.label_right);

      pointsData = content.points || [];
      renderPointsList();

      geminiHashtagMeta = {
        materials: content.materials || [],
        topicTags: content.topicTags || [],
        suggestedTags: content.suggestedTags || [],
      };
      hashtagPlan = genData.hashtags || [];
      hashtagMax = genData.hashtagMax || 4;
      renderHashtagChips();

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
      chip.title = over
        ? `Vượt giới hạn ${hashtagMax} hashtag — sẽ không được đăng`
        : h.tier === "topic" && !h.manual
          ? "Tag chủ đề — mỗi lần đăng có thể đổi sang tag khác cùng nhóm"
          : "Tag cố định";
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
        body: JSON.stringify({ tag: raw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Hashtag không hợp lệ.");
      if (hashtagPlan.some((h) => h.tag === data.tag)) {
        hashtagNote.textContent = `${data.tag} đã có rồi.`;
      } else {
        hashtagPlan.push({ tag: data.tag, tier: data.tier, manual: true });
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
    pointsContainer.innerHTML = "";

    pointsData.forEach((p, idx) => {
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
        <input type="text" class="input-text point-text-input" value="${escapeAttr(p.text)}" data-idx="${idx}" />
        <button type="button" class="action-badge-btn" data-idx="${idx}">
          <img src="/assets/actions/${actionObj.file}" class="action-badge-img" alt="${actionObj.id}" />
          <span>${actionObj.id}</span>
        </button>
        <button type="button" class="btn-del-point" data-idx="${idx}" title="Xóa điểm này">✕</button>
      `;

      // Input change listener
      const input = row.querySelector(".point-text-input");
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

      pointsContainer.appendChild(row);
    });
  }

  btnAddPoint.addEventListener("click", () => {
    // side/tag/sub are required by the scaffold — a point added here without
    // them aborts the build at points[i].side = undefined.
    pointsData.push({
      text: "Điểm so sánh mới...",
      side: pointsData.length % 2 === 0 ? "left" : "right",
      tag: "Nhãn ngắn",
      sub: "",
      suggested_action: DEFAULT_POSE,
    });
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

    const payloadContent = {
      title: scriptTitle.value.trim(),
      label_left: scriptLabelLeft.value.trim(),
      label_right: scriptLabelRight.value.trim(),
      materials: geminiHashtagMeta.materials,
      topicTags: geminiHashtagMeta.topicTags,
      suggestedTags: geminiHashtagMeta.suggestedTags,
      points: pointsData,
    };

    gotoStep(3);
    terminalLogs.textContent = "▶ Đang kết nối tới server để dựng video...\n";
    buildSuccessCard.classList.add("hidden");

    try {
      const rawProvider = ttsProviderSelect ? ttsProviderSelect.value : "vieneu_preset";
      let ttsProvider = "vieneu";
      let vieneuVoice = null;
      let vieneuRefPath = null;

      if (rawProvider === "vieneu_preset") {
        ttsProvider = "vieneu";
        vieneuVoice = vieneuPresetSelect ? vieneuPresetSelect.value : "Adam";
      } else if (rawProvider === "vieneu_clone") {
        ttsProvider = "vieneu";
        if (!uploadedRefAudioPath) {
          alert("Bạn chọn nhái giọng nhưng chưa tải lên file audio 3-5 giây!");
          return;
        }
        vieneuRefPath = uploadedRefAudioPath;
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
          theme: document.getElementById("video-theme") ? document.getElementById("video-theme").value : "paper",
          ttsProvider,
          vieneuVoice,
          vieneuRefPath,
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
      const videos = await res.json();

      videosListGrid.innerHTML = "";
      if (!videos.length) {
        videosListGrid.innerHTML = `<p style="color: var(--fg-dim);">Chưa có video nào được tạo.</p>`;
        return;
      }

      videos.forEach((v) => {
        const card = document.createElement("div");
        card.className = "video-card";
        card.innerHTML = `
          <div>
            <h4>${escapeHtml(v.name)}</h4>
            <span style="font-size: 11px; color: var(--accent-cyan); font-family: monospace;">${escapeHtml(v.location || `videos/${v.slug}/`)}</span>
            ${socialStatusHtml(v.social)}
          </div>
          <div class="video-card-actions">
            <a href="${v.previewUrl}" target="_blank" class="btn btn-small btn-primary">${v.hasIndex ? "🎬 Xem Trước" : "▶ Xem MP4"}</a>
            ${v.renderFile && v.renderFile !== v.previewUrl ? `<a href="${v.renderFile}" target="_blank" class="btn btn-small btn-secondary">⬇ Tải MP4</a>` : ""}
          </div>
        `;
        videosListGrid.appendChild(card);
      });
    } catch (err) {
      videosListGrid.innerHTML = `<p style="color: var(--danger);">Lỗi nạp danh sách: ${err.message}</p>`;
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

  function formatUsd(n) {
    const v = typeof n === "number" ? n : 0;
    // Chi phí mỗi lần gọi rất nhỏ (vài phần nghìn USD) — 2 số thập phân sẽ hiện toàn $0.00,
    // nên hiện 4 số thập phân để còn thấy chênh lệch giữa các video.
    return `$${v.toFixed(4)}`;
  }

  function formatVnd(usdAmount) {
    const vnd = Math.round((usdAmount || 0) * USD_TO_VND_RATE);
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
      costPage = 1;
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

  function renderCostTableRows(pageItems) {
    costVideosTbody.innerHTML = "";
    if (!pageItems.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
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
        <td>${escapeHtml(createdAt)}</td>
        <td class="cost-td-content">${formatUsd(v.contentCost)}</td>
        <td class="cost-td-image">${formatUsd(v.imageCost)}</td>
        <td>${v.imagesGenerated || 0}</td>
        <td class="cost-td-total">
          ${formatUsd(v.totalCost)}
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
    const header = ["slug", "created_at", "content_cost_usd", "image_cost_usd", "images_generated", "total_cost_usd"];
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
          csvEscape(v.createdAt || ""),
          (v.contentCost || 0).toFixed(6),
          (v.imageCost || 0).toFixed(6),
          v.imagesGenerated || 0,
          (v.totalCost || 0).toFixed(6),
        ].join(","),
      );
    });
    lines.push(
      ["TONG", "", totals.content.toFixed(6), totals.image.toFixed(6), totals.images, totals.total.toFixed(6)].join(","),
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
