// Mốc 4 — cảnh phụ KHÔNG TỐN TIỀN. Chuẩn bị file ảnh cho video từ ảnh sản phẩm gốc + ảnh cảnh (nếu có):
//   - cảnh sản phẩm thật: ảnh gốc tách nền đơn giản -> PNG trong suốt (đặt lên nền tối sang trọng bằng CSS)
//   - cảnh cận đá: cắt zoom theo khung bao viên đá (áp bằng GSAP trên chính PNG đã tách nền — toạ độ khung bao quy đổi sang hệ toạ độ PNG)
//   - cảnh nửa người: cắt từ ảnh "đeo lên người"/"cầm sản phẩm" (chỉ khi có ảnh AI/tự tải) theo khung bao sản phẩm
// Không gọi API nào.
import fs from "node:fs";
import path from "node:path";
import { loadProductConfig } from "./config.mjs";
import { cutoutBackground, probeImage } from "./images.mjs";
import { round } from "./shots.mjs";

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Quy đổi khung chuẩn hoá trong ẢNH GỐC sang khung chuẩn hoá trong vùng đã cắt `crop` (kẹp 0–1); nằm ngoài vùng cắt -> null. */
export function boxIntoCrop(box, crop) {
  if (!box || !crop) return null;
  const x0 = clamp01((box.x - crop.x) / crop.w);
  const y0 = clamp01((box.y - crop.y) / crop.h);
  const x1 = clamp01((box.x + box.w - crop.x) / crop.w);
  const y1 = clamp01((box.y + box.h - crop.y) / crop.h);
  return x1 - x0 >= 0.02 && y1 - y0 >= 0.02 ? { x: round(x0, 4), y: round(y0, 4), w: round(x1 - x0, 4), h: round(y1 - y0, 4) } : null;
}

/** Zoom để viên đá (khung `box` chuẩn hoá trong PNG hiển thị rộng `shownW`) chiếm ~zoomToBox bề ngang khung video; kẹp trong [minZoom, maxZoom]. */
export function macroZoom(box, shownW, frameW, macroCfg, { sourcePx = 0 } = {}) {
  const want = box ? (frameW * macroCfg.zoomToBox) / Math.max(1, box.w * shownW) : macroCfg.fallbackZoom;
  let zoom = Math.min(macroCfg.maxZoom, Math.max(macroCfg.minZoom, want));
  // Ảnh sản phẩm nhỏ (vd 300px): sản phẩm đã bị phóng nhiều lần chỉ để vừa khung, zoom thêm là vỡ ô -> giới hạn tổng độ phóng đại (px màn hình / px ảnh gốc).
  if (sourcePx > 0 && macroCfg.maxUpscale) zoom = Math.max(1, Math.min(zoom, macroCfg.maxUpscale / (shownW / sourcePx)));
  return zoom;
}

/**
 * @param {{project:object, store:object, targetDir:string, config?:object, cutout?:Function, probe?:Function}} o
 * @returns {Promise<{products:Object<number,object>, photos:Object<string,object>}>}
 */
export async function prepareSceneAssets({ project, store, targetDir, config = loadProductConfig(), cutout = cutoutBackground, probe = probeImage }) {
  const imgDir = path.join(targetDir, "assets", "images");
  fs.mkdirSync(imgDir, { recursive: true });
  const products = {};
  const need = new Set(project.scenes.filter((s) => ["pose", "macro", "hero"].includes(s.kind)).map((s) => s.productImage ?? 0));
  for (const index of [...need].sort()) {
    const info = project.images[index];
    if (!info) throw new Error(`Cảnh dùng ảnh sản phẩm số ${index + 1} nhưng dự án không có ảnh đó.`);
    const src = store.fileAbs(project.id, info.file);
    const ext = path.extname(info.file).toLowerCase();
    const original = `assets/images/product-${index + 1}${ext}`;
    fs.copyFileSync(src, path.join(targetDir, original));
    const cutFile = `assets/images/product-${index + 1}-cut.png`;
    const cut = await cutout(src, path.join(targetDir, cutFile), { ...config.video.cutout });
    const analysisImg = project.analysis?.images?.[index];
    products[index] = {
      index, original, cut: cutFile, cutW: cut.width, cutH: cut.height, box: cut.box,
      stoneBox: boxIntoCrop(analysisImg?.stoneBbox, cut.crop), // viên đá trong hệ toạ độ PNG đã cắt
      origW: info.width, origH: info.height, sourcePx: Math.round(cut.box.w * info.width), // chiều ngang sản phẩm trong ảnh gốc (px)
    };
  }
  const photos = {};
  for (const s of project.scenes.filter((x) => x.kind === "photo" && x.image)) {
    const ext = path.extname(s.image).toLowerCase();
    const file = `assets/images/scene-${s.id}${ext}`;
    fs.copyFileSync(store.fileAbs(project.id, s.image), path.join(targetDir, file));
    const { width, height } = await probe(path.join(targetDir, file));
    const slotBox = config.scenes.slots[s.slot]?.defaultBox || { x: 0.3, y: 0.4, w: 0.4, h: 0.2 };
    photos[s.id] = { file, w: width, h: height, box: s.productBox || slotBox, boxSource: s.productBox ? "ai" : "default" };
  }
  return { products, photos };
}
