// Chế độ "Giới thiệu sản phẩm": công tắc chế độ, thanh bước, trạng thái chung. Từng bước nằm trong public/product/.
import { h } from "/product/dom.js";
import { api } from "/product/dom.js";
import { createStep1 } from "/product/step1.js";

const STEP_LABELS = {
  product: [["Ảnh và thông số", "Sản phẩm + giọng HuyK"], ["Kịch bản và ảnh cảnh", "Duyệt từng cảnh"], ["Dựng video", "Dựng và kiểm tra"]],
};

document.addEventListener("DOMContentLoaded", () => {
  const container = document.querySelector(".app-container");
  const productApp = document.getElementById("product-app");
  const modeButtons = Array.from(document.querySelectorAll(".mode-btn"));
  const navs = [1, 2, 3].map((n) => document.getElementById(`step-nav-${n}`));
  if (!container || !productApp || navs.some((n) => !n)) return;

  const state = { mode: "compare", files: [], project: null, form: { stoneOrigin: "" }, locale: null, locales: [], engines: [], tts: { engine: "", voice: "" }, source: "pose", aiClip: false, busy: false };
  const ctx = { state, cfg: null, onAnalyzed: null, goto: null };
  const saved = { labels: null, classes: null };
  let steps = null;

  const navText = (nav) => [nav.querySelector(".step-title"), nav.querySelector(".step-desc")];

  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    modeButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === mode)));
    container.classList.toggle("mode-product", mode === "product");
    productApp.classList.toggle("hidden", mode !== "product");
    if (mode === "product") {
      saved.labels = navs.map((n) => navText(n).map((e) => e.textContent));
      saved.classes = navs.map((n) => n.className);
      STEP_LABELS.product.forEach(([title, desc], i) => { const [t, d] = navText(navs[i]); t.textContent = title; d.textContent = desc; });
      gotoStep(state.step || 1);
      ensureInit();
    } else if (saved.labels) {
      saved.labels.forEach((pair, i) => { const [t, d] = navText(navs[i]); t.textContent = pair[0]; d.textContent = pair[1]; navs[i].className = saved.classes[i]; });
    }
  }

  function gotoStep(n) {
    state.step = n;
    navs.forEach((nav, i) => { nav.classList.toggle("active", i + 1 === n); nav.classList.toggle("completed", i + 1 < n); });
    steps?.forEach((s, i) => s.el.classList.toggle("active", i + 1 === n));
  }
  ctx.goto = gotoStep;

  let initPromise = null;
  function ensureInit() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        ctx.cfg = await api("/api/product/config");
        state.source = ctx.cfg.defaultImageSource;
        const step1 = createStep1(ctx);
        steps = [step1, { el: h("section", { class: "step-section" }) }, { el: h("section", { class: "step-section" }) }];
        steps.forEach((s) => productApp.append(s.el));
        ctx.onAnalyzed = () => { /* Bước 2 nối ở Mốc 5 */ };
        await step1.init();
        gotoStep(state.step || 1);
      } catch (err) {
        productApp.append(h("div", { class: "pd-note danger", text: `Không tải được chế độ Giới thiệu sản phẩm: ${err.message}` }));
        initPromise = null;
      }
    })();
    return initPromise;
  }

  modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
});
