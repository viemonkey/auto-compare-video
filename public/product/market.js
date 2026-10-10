// "Tạo phiên bản cho thị trường khác": chọn thị trường, server dùng lại toàn bộ ảnh/cảnh đã duyệt và chỉ viết lại kịch bản (không gọi API ảnh).
import { h, clear, api, note } from "./dom.js";

export function openMarketDialog(ctx, projectId) {
  const { state } = ctx;
  const errorBox = h("div");
  const list = h("div", { class: "locale-buttons", role: "group", "aria-label": "Thị trường" });
  const status = h("p", { class: "field-help", role: "status" });
  const close = () => backdrop.remove();
  const backdrop = h("div", { class: "modal-backdrop", role: "dialog", "aria-modal": "true", "aria-label": "Phiên bản thị trường khác" },
    h("div", { class: "modal-dialog" },
      h("div", { class: "modal-header" }, h("h3", { text: "Tạo phiên bản cho thị trường khác" }), h("button", { type: "button", class: "modal-close", "aria-label": "Đóng", text: "✕", on: { click: close } })),
      h("div", { class: "modal-body" },
        h("p", { class: "modal-subtitle", text: "Dùng lại toàn bộ ảnh sản phẩm, ảnh cảnh và pose đã duyệt — chỉ viết lại kịch bản bằng ngôn ngữ mới và đọc giọng mới. Không gọi lại API ảnh/clip." }),
        list, status, errorBox)));
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);

  for (const l of state.locales) {
    const btn = h("button", { type: "button", class: "locale-btn", disabled: l.code === state.project?.locale || !l.renderable, title: l.renderable ? l.styleSummary : l.blockers.map((b) => b.message).join(" ") },
      l.flagIcon ? h("img", { class: "locale-flag", src: l.flagIcon, alt: "", width: 24, height: 16 }) : h("span", { text: l.flag }), h("span", { text: l.displayName }));
    btn.addEventListener("click", async () => {
      clear(errorBox);
      for (const b of list.querySelectorAll("button")) b.disabled = true;
      status.textContent = `Đang viết lại kịch bản bằng ${l.displayName}…`;
      try {
        const project = await api(`/api/product/${projectId}/market-version`, { method: "POST", body: { locale: l.code } });
        close();
        await ctx.onVersionCreated(project);
      } catch (err) {
        status.textContent = "";
        errorBox.append(note(err.message, "danger"));
        for (const b of list.querySelectorAll("button")) b.disabled = false;
      }
    });
    list.append(btn);
  }
  return close;
}
