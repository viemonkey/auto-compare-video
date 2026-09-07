// Auto Compare Video Web UI Application Logic
document.addEventListener("DOMContentLoaded", () => {
  // State
  let uploadedLeftPath = null;
  let uploadedRightPath = null;
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

  // DOM Elements - Step 2
  const scriptLabelLeft = document.getElementById("script-label-left");
  const scriptLabelRight = document.getElementById("script-label-right");
  const scriptTitle = document.getElementById("script-title");
  const scriptSlug = document.getElementById("script-slug");
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

  // -------------------------------------------------------------
  // Initial Setup: Fetch Action Catalog & VieNeu Preset Voices
  // -------------------------------------------------------------
  fetchActionCatalog();
  fetchVieNeuVoices();

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
        }),
      });

      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error || "Gemini sinh nội dung thất bại.");

      // Populate Step 2 Studio with Gemini output
      const content = genData.content;
      scriptTitle.value = content.title || "";
      scriptLabelLeft.value = content.label_left || "";
      scriptLabelRight.value = content.label_right || "";
      
      // Auto-generate suggested slug
      scriptSlug.value = buildSlug(content.label_left, content.label_right);

      pointsData = content.points || [];
      renderPointsList();

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
      const suggested = buildSlug(scriptLabelLeft.value, scriptLabelRight.value);
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
          slug: scriptSlug.value.trim(),
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

  btnCloseVideosModal.addEventListener("click", () => videosModal.classList.add("hidden"));
  videosModal.addEventListener("click", (e) => {
    if (e.target === videosModal) videosModal.classList.add("hidden");
  });

  // Helper
  function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(str) {
    return String(str || "").replace(/"/g, "&quot;");
  }
});
