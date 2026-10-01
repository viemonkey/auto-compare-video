// Đọc cấu hình Facebook Page từ .env — FB_PAGE_<n>_ID/NAME/ACCESS_TOKEN (n = 1..16).
// Slot thiếu ID hoặc ACCESS_TOKEN bị bỏ qua (không throw) — xem inspectPages() trong fb-config.mjs.
import { inspectPages } from "./fb-config.mjs";
import { getLocale, getDefaultLocale } from "./locales.mjs";

// Kiểm tra FB_PAGE_n_LOCALE theo registry thị trường (config/locales/); thiếu -> thị trường mặc định (DEFAULT_LOCALE).
const localeResolver = () => ({ defaultCode: getDefaultLocale().code, isValid: (code) => !!getLocale(code) });

/** Như inspectPages() nhưng có locale của từng page. Dùng chỗ này, không gọi inspectPages() trần. */
export function inspectConfiguredPages(env = process.env) {
  return inspectPages(env, { localeResolver: localeResolver() });
}

export function getConfiguredPages() {
  return inspectConfiguredPages().pages;
}
