// Dữ kiện ĐÃ DUYỆT của bản gốc, dùng làm "sự thật cố định" khi tạo phiên bản cho thị trường khác.
// Vấn đề đã gặp: cùng 1 cặp ảnh, bản vi Gemini gọi ảnh trái là "kim cương xanh", bản ja lại gọi là アクアマリン — vì mỗi lần sinh đều
// nhận dạng lại ảnh. Người vận hành không đọc được ngôn ngữ đích nên không phát hiện. Nay bản phái sinh chỉ VIẾT LẠI những gì bản gốc đã chốt.
//
// Dữ kiện = nghĩa tiếng Việt của nhãn trái/phải, materials, và (nghĩa + bên + thứ tự) của từng điểm so sánh.
// Nghĩa tiếng Việt: dòng `vi` của field song ngữ; field phẳng (thị trường tiếng Việt) thì chính chữ là tiếng Việt.
import { textOf, viOf } from "../../public/shared/bilingual.mjs";
import { stripDiacritics, nfkcLower } from "../../public/shared/text-fold.mjs";

const meaningOf = (field) => (viOf(field) || textOf(field)).trim();

/**
 * @param {object} record nội dung bản gốc đã lưu (xem content-store.mjs)
 * @returns {{left:string, right:string, materials:string[], points:{side:string, meaning:string}[]}|null} null nếu bản gốc thiếu dữ kiện
 */
export function buildApprovedFacts(record) {
  const left = meaningOf(record?.label_left);
  const right = meaningOf(record?.label_right);
  const points = (Array.isArray(record?.points) ? record.points : [])
    .map((p) => ({ side: p.side, meaning: meaningOf(p.text) }))
    .filter((p) => p.meaning);
  if (!left || !right || points.length === 0) return null;
  const materials = (Array.isArray(record.materials) ? record.materials : []).filter((m) => typeof m === "string" && m.trim()).map((m) => m.trim());
  return { left, right, materials, points };
}

const fold = (s) => stripDiacritics(nfkcLower(s)).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Hai nghĩa nhãn có cùng chỉ 1 đối tượng không (so lỏng: bỏ dấu/viết hoa; chấp nhận cái này chứa cái kia, vd "đá Aquamarine" ~ "Aquamarine"). */
export function labelMeaningMatches(a, b) {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && ` ${long} `.includes(` ${short} `);
}

/**
 * Đối chiếu nội dung vừa sinh với dữ kiện đã duyệt. `content` bị sửa tại chỗ: `side` của từng point được ép về đúng bản gốc
 * (cấu trúc, không phải chữ). Nhãn / số điểm lệch chỉ CẢNH BÁO (người dùng quyết định).
 * @returns {{warnings:{path:string, code:string, message:string}[], corrections:object[]}}
 */
export function checkAgainstApprovedFacts(content, facts) {
  const warnings = [];
  const corrections = [];
  for (const [path, expected] of [["label_left", facts.left], ["label_right", facts.right]]) {
    const got = meaningOf(content[path]);
    if (!labelMeaningMatches(got, expected)) {
      const side = path === "label_left" ? "trái" : "phải";
      warnings.push({
        path,
        code: "fact-mismatch",
        message: `Nhãn ${side} có nghĩa "${got || "(trống)"}" nhưng bản gốc đã duyệt là "${expected}" — có thể đang nói về vật khác. Kiểm tra lại.`,
        expected,
        got,
      });
    }
  }
  const points = Array.isArray(content.points) ? content.points : [];
  if (points.length !== facts.points.length) {
    warnings.push({
      path: "points",
      code: "fact-points-count",
      message: `Bản gốc có ${facts.points.length} điểm so sánh nhưng bản này có ${points.length} — ý có thể bị thêm/bớt so với bản gốc.`,
    });
  } else {
    points.forEach((p, i) => {
      if (p.side !== facts.points[i].side) {
        corrections.push({ path: `points[${i}].side`, from: p.side, to: facts.points[i].side });
        p.side = facts.points[i].side;
      }
    });
  }
  return { warnings, corrections };
}
