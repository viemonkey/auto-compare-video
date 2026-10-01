// Đọc cấu hình Facebook Page từ .env — FB_PAGE_<n>_ID/NAME/ACCESS_TOKEN (n = 1..16).
// Slot thiếu ID hoặc ACCESS_TOKEN bị bỏ qua (không throw) — xem inspectPages() trong fb-config.mjs.
import { inspectPages } from "./fb-config.mjs";

export function getConfiguredPages() {
  return inspectPages().pages;
}
