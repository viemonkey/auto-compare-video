// Cấu hình + log dùng chung cho toàn bộ luồng đăng Facebook.
// Graph API version CHỈ khai báo ở đây (đổi qua FB_GRAPH_VERSION trong .env).

export function graphVersion() {
  const v = String(process.env.FB_GRAPH_VERSION || "v19.0").trim();
  return /^v\d+\.\d+$/.test(v) ? v : "v19.0";
}
export const graphBase = () => `https://graph.facebook.com/${graphVersion()}`;
export const graphVideoBase = () => `https://graph-video.facebook.com/${graphVersion()}`;

const OFF = new Set(["0", "false", "off", "no"]);
export function isAutoPostEnabled(env = process.env) {
  const v = env.FB_AUTO_POST;
  return v === undefined ? true : !OFF.has(String(v).trim().toLowerCase());
}

// ---- Che token/secret ---------------------------------------------------------------------
function knownSecrets() {
  const out = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (v && v.length >= 12 && /^FB_PAGE_\d+_ACCESS_TOKEN$|^FB_APP_SECRET$|^FB_.*(TOKEN|SECRET)$/.test(k)) out.push(v);
  }
  return out;
}

/** "EAABxxxxxxx…xyz" -> "EAAB****". Che cả token đã biết trong env lẫn dạng chung của token Facebook. */
export function redactSecrets(input) {
  let s = typeof input === "string" ? input : String(input ?? "");
  for (const secret of knownSecrets()) s = s.split(secret).join(`${secret.slice(0, 4)}****`);
  s = s.replace(/(access_token=|client_secret=|appsecret_proof=)[^&\s"']+/gi, "$1****");
  s = s.replace(/\b(Bearer|OAuth)\s+[A-Za-z0-9_\-]{8,}/g, "$1 ****");
  s = s.replace(/\bEAA[A-Za-z0-9]{8,}/g, (m) => `${m.slice(0, 4)}****`);
  return s;
}

// ---- Logger có timestamp + prefix ---------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
export const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export function makeLogger(prefix) {
  const fmt = (level, msg) => `${stamp()} [${prefix}]${level} ${redactSecrets(msg)}`;
  return {
    info: (msg) => console.log(fmt("", msg)),
    warn: (msg) => console.warn(fmt(" WARN", msg)),
    error: (msg) => console.error(fmt(" ERROR", msg)),
  };
}

// ---- Validate cấu hình page ---------------------------------------------------------------
const MAX_SLOTS = 16;

/** Trả các page hợp lệ + danh sách cảnh báo cho slot cấu hình dở dang. */
export function inspectPages(env = process.env) {
  const pages = [];
  const problems = [];
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const id = (env[`FB_PAGE_${i}_ID`] || "").trim();
    const accessToken = (env[`FB_PAGE_${i}_ACCESS_TOKEN`] || "").trim();
    const name = (env[`FB_PAGE_${i}_NAME`] || "").trim();
    if (!id && !accessToken) continue; // slot trống — bình thường
    if (!id) problems.push(`FB_PAGE_${i}: có token nhưng thiếu FB_PAGE_${i}_ID — bỏ qua page này.`);
    else if (!accessToken) problems.push(`FB_PAGE_${i} (${id}): thiếu FB_PAGE_${i}_ACCESS_TOKEN — bỏ qua page này.`);
    else pages.push({ id, name: name || `Page ${i}`, accessToken });
  }
  return { pages, problems };
}
