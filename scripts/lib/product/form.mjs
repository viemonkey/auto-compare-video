// Form thông số sản phẩm (Bước 1). Số liệu trong video CHỈ lấy từ form này — không bao giờ do AI tự thêm.
import { loadProductConfig, kindFromText } from "./config.mjs";

export const FORM_FIELDS = ["type", "material", "metalColor", "mainStone", "carat", "cut", "sideStones", "price", "feature"];
const MAX_LEN = 120;

const clean = (v) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);

/** Chuẩn hoá form từ client: cắt khoảng trắng/độ dài, nguồn gốc đá chỉ nhận giá trị trong config ("" = chưa rõ). */
export function normalizeForm(raw = {}, config = loadProductConfig()) {
  const form = {};
  for (const key of FORM_FIELDS) form[key] = clean(raw[key]);
  const origin = String(raw.stoneOrigin ?? "").trim();
  form.stoneOrigin = origin && config.stoneOrigins[origin] ? origin : "";
  return form;
}

/** Lỗi bắt buộc của form (tiếng Việt). Tối thiểu: loại món + chất liệu. */
export function validateForm(form) {
  const errors = [];
  if (!form.type) errors.push("Chọn hoặc nhập loại món (nhẫn, dây chuyền, bông tai...).");
  if (!form.material) errors.push("Nhập chất liệu (vd bạc 925, vàng 18K).");
  return errors;
}

/** Loại món chuẩn (ring | necklace | earring | null) từ form. */
export const productKindOfForm = (form, config) => kindFromText(form.type, config);

/** Tên hiển thị gọn của sản phẩm (dùng cho slug/tiêu đề), vd "nhẫn bạc 925 đá moissanite". */
export function productDisplayName(form) {
  return [form.type, form.material, form.mainStone].filter(Boolean).join(" ").trim();
}

/** Các dòng thông số hiển thị (thẻ thông số + prompt) — chỉ field có giá trị. Nhãn theo thị trường (config labels). */
export function specRows(form, labels, config = loadProductConfig()) {
  const rows = [];
  const push = (key, value) => value && rows.push({ key, label: labels[key], value });
  push("material", form.material);
  push("metalColor", form.metalColor);
  push("mainStone", [form.mainStone, form.carat, form.cut].filter(Boolean).join(" · "));
  push("sideStones", form.sideStones);
  if (form.stoneOrigin) rows.push({ key: "origin", label: labels.origin, value: config.stoneOrigins[form.stoneOrigin].label });
  push("feature", form.feature);
  push("price", form.price);
  return rows;
}
