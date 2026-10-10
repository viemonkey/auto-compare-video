// Kế hoạch cảnh của video: mỗi câu thoại = 1 cảnh. Loại cảnh:
//   pose    : HuyK (ảnh tư thế có sẵn) đứng 1 bên, ảnh sản phẩm thật lớn ở giữa — GSAP, không gọi API ảnh
//   photo   : ảnh toàn khung có HuyK (Gemini/tự tải) — cầm sản phẩm / đeo lên người
//   macro   : cắt zoom cận đá từ ảnh sản phẩm gốc
//   half    : cắt nửa người từ ảnh photo (chỉ khi có ảnh AI/tự tải)
//   hero    : sản phẩm thật tách nền trên nền tối sang trọng (+ thẻ thông số / lời kêu gọi ở cảnh cuối)
import { loadProductConfig } from "./config.mjs";

export const SCENE_KINDS = ["pose", "photo", "macro", "half", "hero"];

export function slotLabelOf(slot, config = loadProductConfig()) {
  return config.scenes.slots[slot]?.label || slot;
}

/** Chọn ảnh sản phẩm cho cảnh cận (ưu tiên góc "detail"/"front") và cảnh hero (ưu tiên "front"). */
export function pickProductImage(analysisImages = [], purpose = "hero", used = 0) {
  if (!analysisImages.length) return 0;
  const prefer = purpose === "macro" ? ["detail", "front", "top", "side"] : ["front", "top", "side", "detail"];
  const ranked = analysisImages.map((img, i) => ({ i, rank: prefer.indexOf(img.view) === -1 ? 9 : prefer.indexOf(img.view) })).sort((a, b) => a.rank - b.rank || a.i - b.i);
  return ranked[used % ranked.length].i;
}

/** Chọn pose theo beat, xoay vòng để các cảnh liền nhau không trùng pose. */
export function pickPose(beat, taken, config = loadProductConfig()) {
  const list = config.poses.byBeat[beat] || [config.poses.defaultPose];
  const last = taken.at(-1);
  return list.find((p) => p !== last && !taken.includes(p)) || list.find((p) => p !== last) || list[0];
}

export function hostSideFor(pose, index, config = loadProductConfig()) {
  return config.poses.hostSideByPose[pose] || (index % 2 === 0 ? "right" : "left");
}

/**
 * @param {{lines:Array<{n:number,beat:string}>, imageSource:"pose"|"manual"|"gemini", kind:string, analysis?:object, config?:object}} o
 * @returns {Array<object>} cảnh: { id, line, beat, kind, source, slot, pose, hostSide, productImage, from, image, status, approved, ... }
 */
export function planScenes({ lines, imageSource, kind, analysis = null, config = loadProductConfig() }) {
  const useAi = imageSource !== "pose";
  const plan = config.scenes.plan[useAi ? "ai" : "pose"];
  const imgs = analysis?.images || [];
  const scenes = [];
  const poses = [];
  let specsSeen = 0;
  let macroSeen = 0;
  let heroSeen = 0;
  lines.forEach((l, i) => {
    let rule = plan[l.beat];
    if (Array.isArray(rule)) rule = rule[Math.min(specsSeen, rule.length - 1)];
    if (l.beat === "specs") specsSeen++;
    let [type, slot = null] = String(rule || "pose").split(":");
    // cảnh "nửa người" cần ảnh photo có sẵn trong video; không có thì lùi về cận đá
    if (type === "half" && !scenes.some((s) => s.kind === "photo")) type = "macro";
    const scene = { id: `s${l.n}`, line: l.n, beat: l.beat, kind: type, source: "product", slot: null, pose: null, hostSide: null, productImage: 0, from: null, image: null, status: "ok", approved: true, check: null, attempts: [], note: "", busy: null };
    if (type === "photo") {
      Object.assign(scene, { slot, source: imageSource, status: "pending", approved: false, note: imageSource === "manual" ? "Tự tải ảnh cho cảnh này (hoặc dùng ảnh tư thế)." : "" });
    } else if (type === "pose") {
      const pose = pickPose(l.beat, poses, config);
      poses.push(pose);
      Object.assign(scene, { source: "pose", pose, hostSide: hostSideFor(pose, i, config), productImage: pickProductImage(imgs, "hero", heroSeen++) });
    } else if (type === "macro") {
      Object.assign(scene, { source: "crop", productImage: pickProductImage(imgs, "macro", macroSeen++) });
    } else if (type === "half") {
      const src = scenes.filter((s) => s.kind === "photo").at(-1);
      Object.assign(scene, { source: "crop", from: src.id });
    } else {
      Object.assign(scene, { source: "product", productImage: pickProductImage(imgs, "hero", heroSeen++) });
    }
    scenes.push(scene);
  });
  void kind;
  return scenes;
}

/** Cảnh nào còn chặn việc dựng: ảnh AI chưa đạt và chưa được người dùng duyệt / cảnh đang xử lý. */
export function buildBlockers(scenes) {
  const out = [];
  for (const s of scenes) {
    if (s.busy) out.push({ scene: s.id, message: `Cảnh ${s.line} đang xử lý.` });
    else if (s.kind === "photo" && !s.image) out.push({ scene: s.id, message: `Cảnh ${s.line} chưa có ảnh — tạo ảnh, tải ảnh lên hoặc đổi sang ảnh tư thế / ảnh sản phẩm gốc.` });
    else if (s.status === "needs-review" && !s.approved) out.push({ scene: s.id, message: `Cảnh ${s.line} chưa đạt kiểm — hãy xem rồi bấm “Duyệt ảnh này” hoặc đổi ảnh.` });
    else if (s.status === "error") out.push({ scene: s.id, message: `Cảnh ${s.line} bị lỗi: ${s.note || "xem chi tiết"}.` });
  }
  return out;
}
