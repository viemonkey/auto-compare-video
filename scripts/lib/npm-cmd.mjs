// Gọi npm/npx KHÔNG dùng `shell: true` (DEP0190). Trên Windows, npm/npx là .cmd và Node (>=18.20/
// 20.12, CVE-2024-27980) từ chối spawn .cmd không shell (EINVAL) — nên chạy thẳng file JS của npm
// bằng chính node đang chạy. Args luôn là mảng, không nối chuỗi, nên slug có dấu cách/ký tự lạ an toàn.
import fs from "node:fs";
import path from "node:path";

function npmCliJs(name) {
  const candidates = [
    process.env.npm_execpath && path.join(path.dirname(process.env.npm_execpath), `${name}-cli.js`),
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", `${name}-cli.js`),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", `${name}-cli.js`),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** @param {"npm"|"npx"} tool @param {string[]} args @returns {{command:string,args:string[]}} */
export function npmCommand(tool, args) {
  if (process.platform !== "win32") return { command: tool, args };
  const cli = npmCliJs(tool);
  if (!cli) throw new Error(`Không tìm thấy ${tool}-cli.js cạnh node (${process.execPath}).`);
  return { command: process.execPath, args: [cli, ...args] };
}
