// Kho dự án "Giới thiệu sản phẩm": data/products/<id>/project.json + ảnh trong cùng thư mục. Ghi nguyên tử (tmp + rename) như build-jobs.
// Có khoá theo dự án để 2 thao tác tốn tiền (bấm đúp, 2 tab) không chạy chồng và cùng đọc "ngân sách còn lại" cũ.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const PROJECT_ID_RE = /^p-[a-z0-9]{6,12}-[a-z0-9]{4,8}$/;
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export const newProjectId = () => `p-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
/** Slug dùng trong sổ chi phí cho tới khi video có slug thật (cùng cơ chế "_pending-" của chế độ so sánh). */
export const pendingLedgerSlug = (id) => `_pending-product-${id}`;

export function assertSafeName(name) {
  if (!SAFE_NAME_RE.test(String(name))) throw new Error(`Tên file không hợp lệ: "${name}".`);
  return name;
}

export function createProductStore({ dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const locks = new Map();

  const projectDir = (id) => {
    if (!PROJECT_ID_RE.test(String(id))) throw new Error("Mã dự án không hợp lệ.");
    return path.join(dir, id);
  };
  const projectFile = (id) => path.join(projectDir(id), "project.json");

  const store = {
    dir,
    projectDir,
    fileAbs(id, name) {
      return path.join(projectDir(id), assertSafeName(name));
    },
    create(initial = {}) {
      const id = newProjectId();
      fs.mkdirSync(projectDir(id), { recursive: true });
      const now = new Date().toISOString();
      const project = { version: 1, id, createdAt: now, updatedAt: now, ledgerSlug: pendingLedgerSlug(id), slug: null, status: "draft", images: [], scenes: [], ...initial };
      return store.write(project);
    },
    read(id) {
      const file = projectFile(id);
      if (!fs.existsSync(file)) return null;
      try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        return null;
      }
    },
    write(project) {
      const file = projectFile(project.id);
      project.updatedAt = new Date().toISOString();
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(project, null, 2)}\n`);
      fs.renameSync(tmp, file);
      return project;
    },
    list() {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && PROJECT_ID_RE.test(d.name))
        .map((d) => store.read(d.name))
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    saveBuffer(id, name, buffer) {
      const file = store.fileAbs(id, name);
      fs.writeFileSync(file, buffer);
      return file;
    },
    remove(id) {
      fs.rmSync(projectDir(id), { recursive: true, force: true });
    },
    /** Chạy `fn` độc quyền theo dự án (hàng đợi theo thứ tự gọi). */
    async withLock(id, fn) {
      const prev = locks.get(id) || Promise.resolve();
      let release;
      const gate = new Promise((r) => { release = r; });
      const tail = prev.then(() => gate);
      locks.set(id, tail);
      await prev;
      try {
        return await fn();
      } finally {
        release();
        if (locks.get(id) === tail) locks.delete(id);
      }
    },
  };
  return store;
}
