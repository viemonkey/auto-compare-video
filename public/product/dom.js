// Tiện ích DOM nhỏ cho chế độ "Giới thiệu sản phẩm" (không dùng innerHTML với dữ liệu người dùng; sự kiện gắn bằng addEventListener).
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "on") for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn);
    else if (key in node && key !== "list" && key !== "type" && key !== "for") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clear = (node) => {
  node.replaceChildren();
  return node;
};

export const fmtVnd = (n) => `${Math.round(Number(n) || 0).toLocaleString("vi-VN")}đ`;

export async function api(url, { method = "GET", body, signal } = {}) {
  const init = { method, signal };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Server trả lỗi ${res.status}.`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Ô ghi chú (vàng/xanh/đỏ) — role="status" để trình đọc màn hình đọc khi đổi. */
export const note = (text, kind = "") => h("div", { class: `pd-note ${kind}`.trim(), role: "status", text });
