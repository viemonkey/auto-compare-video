// Đọc duration + width/height thẳng từ box "moov" trong container MP4 — KHÔNG dùng
// ffmpeg/ffprobe: repo không có dependency nào cho việc này, và không nên phụ thuộc 1 binary cài
// sẵn ngoài máy (khác máy/khác môi trường CI có thể không có). Chỉ đọc phần header (moov thường
// vài KB), seek qua "mdat" (phần video encode, chiếm gần hết dung lượng file) thay vì load cả
// file vào RAM.
//
// Dùng để kiểm tra điều kiện Reels (tỉ lệ 9:16, dài 3-90s) TRƯỚC khi gọi postReelToPage() — xem
// reelEligibility() và facebook-post.mjs.
import fs from "node:fs";

function* iterateBoxes(buf, start, end) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    let headerLen = 8;
    if (size === 1) {
      // 64-bit largesize — mvhd/tkhd không bao giờ cần tới kích thước lớn tới mức mất độ chính
      // xác khi ép về Number, chỉ mdat mới có thể to cỡ đó (và ta không parse mdat).
      size = Number(buf.readBigUInt64BE(offset + 8));
      headerLen = 16;
    } else if (size === 0) {
      size = end - offset; // box cuối cùng, kéo dài tới hết parent
    }
    if (size < headerLen) break; // box hỏng — dừng, không đoán bừa phần còn lại
    yield { type, payloadStart: offset + headerLen, payloadEnd: offset + size };
    offset += size;
  }
}

function findBox(buf, start, end, type) {
  for (const box of iterateBoxes(buf, start, end)) {
    if (box.type === type) return box;
  }
  return null;
}

function readFixed16_16(buf, offset) {
  return buf.readUInt32BE(offset) / 65536;
}

function parseMvhdDuration(buf, box) {
  const version = buf.readUInt8(box.payloadStart);
  const timescaleOffset = version === 1 ? box.payloadStart + 4 + 8 + 8 : box.payloadStart + 4 + 4 + 4;
  const timescale = buf.readUInt32BE(timescaleOffset);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(timescaleOffset + 4)) : buf.readUInt32BE(timescaleOffset + 4);
  if (!timescale) throw new Error("mvhd.timescale = 0");
  return duration / timescale;
}

function parseTkhdDimensions(buf, box) {
  // width/height luôn là 8 byte CUỐI của payload tkhd (sau ma trận biến đổi 36 byte), bất kể
  // version (v0 dùng field 32-bit, v1 dùng 64-bit cho các mốc thời gian phía trước) — đọc từ
  // cuối payload lùi lại tránh phải cộng dồn offset qua từng field, dễ sai theo version.
  const width = readFixed16_16(buf, box.payloadEnd - 8);
  const height = readFixed16_16(buf, box.payloadEnd - 4);
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * @param {string} filePath
 * @returns {{durationSeconds: number, width: number, height: number}}
 */
export function probeMp4(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const fileSize = fs.fstatSync(fd).size;
    const header = Buffer.alloc(16);
    let offset = 0;
    let moovBox = null;
    while (offset + 8 <= fileSize) {
      fs.readSync(fd, header, 0, 16, offset);
      let size = header.readUInt32BE(0);
      const type = header.toString("ascii", 4, 8);
      let headerLen = 8;
      if (size === 1) {
        size = Number(header.readBigUInt64BE(8));
        headerLen = 16;
      } else if (size === 0) {
        size = fileSize - offset;
      }
      if (size < headerLen) throw new Error(`Box "${type}" hỏng ở offset ${offset} (size=${size}).`);
      if (type === "moov") {
        moovBox = { payloadStart: offset + headerLen, payloadEnd: offset + size };
        break;
      }
      offset += size;
    }
    if (!moovBox) throw new Error("Không tìm thấy box 'moov' — file có thể không phải MP4/MOV hợp lệ.");

    const moovBuf = Buffer.alloc(moovBox.payloadEnd - moovBox.payloadStart);
    fs.readSync(fd, moovBuf, 0, moovBuf.length, moovBox.payloadStart);

    const mvhd = findBox(moovBuf, 0, moovBuf.length, "mvhd");
    if (!mvhd) throw new Error("Không tìm thấy box 'mvhd' trong 'moov'.");
    const durationSeconds = parseMvhdDuration(moovBuf, mvhd);

    let dimensions = null;
    for (const trak of iterateBoxes(moovBuf, 0, moovBuf.length)) {
      if (trak.type !== "trak") continue;
      const tkhd = findBox(moovBuf, trak.payloadStart, trak.payloadEnd, "tkhd");
      if (!tkhd) continue;
      const dims = parseTkhdDimensions(moovBuf, tkhd);
      // Track audio có tkhd.width/height = 0 theo chuẩn ISO BMFF — bỏ qua, chỉ nhận track có
      // kích thước thật (video track). File nhiều video track (hiếm) thì lấy track đầu tiên.
      if (dims.width > 0 && dims.height > 0) {
        dimensions = dims;
        break;
      }
    }
    if (!dimensions) throw new Error("Không tìm thấy video track (tkhd width/height > 0) trong 'moov'.");

    return { durationSeconds, width: dimensions.width, height: dimensions.height };
  } finally {
    fs.closeSync(fd);
  }
}

const REEL_ASPECT_RATIO = 9 / 16;
const REEL_ASPECT_TOLERANCE = 0.02; // 2% — chừa sai số làm tròn của encoder
const REEL_MIN_DURATION_S = 3;
const REEL_MAX_DURATION_S = 90;

/**
 * @param {{width:number,height:number,durationSeconds:number}} probe
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
export function reelEligibility({ width, height, durationSeconds }) {
  const ratio = width / height;
  if (Math.abs(ratio - REEL_ASPECT_RATIO) / REEL_ASPECT_RATIO > REEL_ASPECT_TOLERANCE) {
    return { ok: false, reason: `Tỉ lệ ${width}x${height} (${ratio.toFixed(3)}) không phải 9:16 (${REEL_ASPECT_RATIO.toFixed(3)}).` };
  }
  if (durationSeconds < REEL_MIN_DURATION_S) {
    return { ok: false, reason: `Video dài ${durationSeconds.toFixed(1)}s — Reels yêu cầu tối thiểu ${REEL_MIN_DURATION_S}s.` };
  }
  if (durationSeconds > REEL_MAX_DURATION_S) {
    return { ok: false, reason: `Video dài ${durationSeconds.toFixed(1)}s — Reels cho phép tối đa ${REEL_MAX_DURATION_S}s.` };
  }
  return { ok: true };
}
