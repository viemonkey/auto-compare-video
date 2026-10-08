// Tên kênh hiển thị ở thẻ #eyebrow (góc trên trái video): theo thị trường.
//   config/locales/<code>.json → video.channel  (có khai báo thì thắng)
//   không khai báo (vi-VN) → CHANNEL trong .env — hành vi cũ, dùng chung cho mọi video
export function resolveChannel({ locale, env }) {
  const fromLocale = typeof locale?.video?.channel === "string" ? locale.video.channel.trim() : "";
  if (fromLocale) return { channel: fromLocale, source: `config/locales/${locale.code}.json (video.channel)` };
  const fromEnv = String(env?.CHANNEL ?? "").trim();
  if (fromEnv) return { channel: fromEnv, source: ".env (CHANNEL)" };
  return { channel: "", source: "" };
}

/** Thay nội dung thẻ #eyebrow trong index.html. Trả { html, changed, found }. Tên kênh được escape HTML. */
export function applyChannelToHtml(html, channel) {
  const esc = String(channel).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const re = /(<div[^>]*\bid="eyebrow"[^>]*>)([^<]*)(<\/div>)/;
  const m = re.exec(html);
  if (!m) return { html, changed: false, found: false };
  if (m[2] === esc) return { html, changed: false, found: true };
  return { html: html.replace(re, (_x, a, _b, c) => `${a}${esc}${c}`), changed: true, found: true };
}
