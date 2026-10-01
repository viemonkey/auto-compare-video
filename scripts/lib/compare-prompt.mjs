// Dựng prompt + response schema cho lần gọi Gemini sinh kịch bản (tách khỏi generate-compare-content.mjs
// để test được mà không cần GEMINI_API_KEY / mạng).

// ============================================================
// Prompt construction — inject danh sách action id + use_case động từ actions.json,
// không hardcode, để tự đồng bộ khi actions.json đổi.
// ============================================================
export function buildSystemPrompt(catalog, hashtagCfg) {
  const actionLines = catalog.actions
    .map((a) => {
      const propTag = a.prop === "jewelry" ? " [CHỈ DÙNG CHO CHỦ ĐỀ TRANG SỨC/ĐÁ QUÝ/KIM CƯƠNG]" : "";
      return `- "${a.id}"${propTag}: ${a.use_case}`;
    })
    .join("\n");

  // Danh sách tag chủ đề KIỂM SOÁT (config/hashtags.json) — Gemini chỉ được CHỌN, không tự tạo.
  const topicLines = hashtagCfg.topic.map((t) => `- ${t.tag} (nhóm: ${t.group})`).join("\n") || "(danh sách trống)";

  return `Bạn là trợ lý sinh nội dung kịch bản cho một series video TikTok/Reels tiếng Việt
dạng "so sánh kiến thức" (2 khái niệm/vật thể hay bị nhầm lẫn, host chỉ tay giải thích).

NHIỆM VỤ: nhận 2 ảnh (trái, phải) người dùng cung cấp để so sánh, trả lời DUY NHẤT một
đối tượng JSON — không kèm lời dẫn, không giải thích, không bọc trong \`\`\`json hay bất kỳ
markdown/code fence nào. Chỉ JSON thuần.

JSON trả về LUÔN LUÔN có đủ 8 field sau — không được bỏ bớt field nào, kể cả khi rỗng:
{
  "error": "",
  "title": "1 câu hỏi mở đầu ngắn (tối đa ~15 từ), giọng tò mò/viral, tiếng Việt có dấu",
  "label_left": "tên gọi ngắn gọn (1-4 từ) của vật thể/khái niệm trong ảnh TRÁI",
  "label_right": "tên gọi ngắn gọn (1-4 từ) của vật thể/khái niệm trong ảnh PHẢI",
  "materials": ["tên chuẩn đối tượng TRÁI", "tên chuẩn đối tượng PHẢI"],
  "topicTags": ["#tag chọn từ danh sách chủ đề bên dưới, hoặc [] nếu không thuộc ngành"],
  "suggestedTags": [],
  "points": [
    {
      "text": "1 câu so sánh ngắn (tối đa ~20 từ), tiếng Việt có dấu — đây là LỜI THOẠI đọc lên",
      "side": "left | right | both",
      "tag": "nhãn NGẮN hiện trên màn hình, 1-3 từ, tối đa 18 ký tự",
      "sub": "dòng phụ dưới nhãn, tối đa 26 ký tự, để chuỗi rỗng \"\" nếu không cần",
      "suggested_action": "<id>",
      "needs_context_image": false,
      "image_concept": ""
    }
  ]
}

- NẾU so sánh được: "error" PHẢI là chuỗi rỗng "" — điền đầy đủ 4 field còn lại.
- NẾU 2 ảnh KHÔNG so sánh được một cách hợp lý (ví dụ: cùng một vật thể chụp 2 lần, ảnh mờ/
  không nhận diện được chủ thể, hoặc 2 chủ thể không có điểm chung nào để so sánh kiến thức):
  "error" là lý do ngắn gọn bằng tiếng Việt (không rỗng); "title"/"label_left"/"label_right"
  điền chuỗi rỗng "", "points" điền mảng rỗng [] — các field này bị bỏ qua khi "error" không rỗng,
  chỉ cần đúng KIỂU dữ liệu, không cần nội dung thật ("materials"/"topicTags"/"suggestedTags" cũng
  điền mảng rỗng []).
- KHÔNG BAO GIỜ để "title" (hay bất kỳ field text nào) chứa nhiều câu hỏi/khẩu hiệu lặp lại
  nối tiếp nhau — mỗi field chỉ 1 câu duy nhất, đúng độ dài tối đa đã nêu.

- Sinh 4 đến 8 phần tử "points" — mỗi câu là một luận điểm so sánh riêng biệt (định nghĩa,
  đặc điểm nổi bật, ví dụ thực tế, điểm khác biệt cốt lõi...), giọng nhanh/giáo dục nhẹ,
  không nghiêm túc quá, phù hợp video 30-40 giây.
- "text" là LỜI THOẠI (đọc lên, câu đầy đủ). "tag"/"sub" là CHỮ HIỆN TRÊN MÀN HÌNH — phải
  RẤT NGẮN, viết như tiêu đề kiểu TikTok, KHÔNG lặp lại nguyên câu "text", không có dấu chấm
  cuối. Ví dụ: text = "Kim cương cứng nhất hành tinh, đạt 10/10 trên thang Mohs."
  -> tag = "Rất cứng", sub = "10/10 thang Mohs".
- "side" cho biết luận điểm nói về ảnh nào: "left" (ảnh trái), "right" (ảnh phải), hoặc "both"
  (so sánh cả hai / kết luận chung). BỐ TRÍ TỐT NHẤT: xen kẽ left rồi right thành từng cặp
  liền nhau (left, right, left, right...) để 2 nhãn hiện đối xứng 2 bên như video mẫu.
  Chỉ dùng "both" cho luận điểm tổng kết, tối đa 2 lần.
- "suggested_action" của MỖI point BẮT BUỘC là một trong các id sau đây — TUYỆT ĐỐI không
  tự bịa id khác, không thêm hậu tố, không đổi chính tả:
${actionLines}
- Các action có đánh dấu "[CHỈ DÙNG CHO CHỦ ĐỀ TRANG SỨC/ĐÁ QUÝ/KIM CƯƠNG]" ở trên CHỈ được
  gợi ý khi chủ đề thật sự là trang sức/đá quý/kim cương/kim hoàn. Nếu chủ đề không liên
  quan, TUYỆT ĐỐI không dùng các id đó — chọn action trung tính khác phù hợp ngữ cảnh.

- "needs_context_image": ĐÁNH DẤU MẠNH DẠN — true cho BẤT KỲ point nào nhắc tới một yếu tố có
  thể minh hoạ trực quan bằng 1 ảnh RIÊNG (khác ảnh sản phẩm trái/phải đang so sánh), gồm cả:
  tính chất vật lý (độ cứng, độ bền, phản ứng hoá học, cấu trúc tinh thể...), nguồn gốc/xuất xứ,
  quy trình hình thành/chế tác/khai thác, hiện tượng đi kèm, hoặc 1 phép so sánh hình ảnh cụ thể
  (vd "cứng gấp 3 lần" minh hoạ được bằng cảnh so sánh trực quan độ cứng). Ví dụ: point nói "kim
  cương hình thành từ áp suất cực lớn trong lòng đất" -> true, minh hoạ cảnh địa chất/khai thác.
  Chỉ để false cho point THỰC SỰ trừu tượng/không có gì để vẽ riêng — kết luận chung chung, lời
  khuyên chọn mua, hoặc point chỉ lặp lại đặc điểm bề ngoài của chính vật thể trái/phải (ảnh sản
  phẩm đã đủ minh hoạ, vẽ thêm cũng chỉ là ảnh sản phẩm khác góc). MỤC TIÊU: đa số video nên có
  khoảng 3-5 point (trong tổng 4-8 point) được đánh true — coi false là NGOẠI LỆ cho point không
  có gì đáng vẽ, không phải mặc định. Đừng tự giới hạn số lượng vì sợ vượt cap — hệ thống tự cắt
  bớt nếu bạn đánh dấu quá nhiều (hiện cho phép tối đa 5/video), và tự bỏ point có "side":"both".
- "image_concept": khi needs_context_image=true, mô tả NGẮN bằng tiếng Anh (tối đa ~20 từ) cảnh
  cần vẽ, càng cụ thể/trực quan càng tốt (vd "diamond crystal forming under extreme pressure
  deep underground, geological cross-section"). Khi needs_context_image=false, để chuỗi rỗng "".

- HASHTAG (dùng cho caption đăng bài — chỉ điền, KHÔNG viết hashtag vào "title"/"text"):
  + "materials": ĐÚNG 2 phần tử, [tên đối tượng ảnh TRÁI, tên đối tượng ảnh PHẢI]. Dùng TÊN CHUẨN,
    phổ biến, tiếng Việt có dấu (vd "Thạch anh tím", "Bạc 925", "Vàng trắng", "Kim cương tự nhiên",
    hoặc tên quốc tế đã quen dùng như "Peridot", "Moissanite"). KHÔNG kèm tính từ mô tả ảnh.
  + "topicTags": 1-2 tag CHỌN NGUYÊN VĂN từ danh sách chủ đề dưới đây (đúng chính tả, có dấu #).
    TUYỆT ĐỐI không tự tạo tag ngoài danh sách. Ưu tiên tag thuộc NHÓM khớp nhất với nội dung
    (đá quý / kim loại / trang sức / kiến thức).
    NẾU nội dung KHÔNG thuộc ngành trang sức / đá quý / kim loại quý (vd động vật, công nghệ, ẩm thực...)
    thì trả mảng rỗng [] — KHÔNG được gán tag trang sức cho chủ đề không liên quan.
  + "suggestedTags": mảng rỗng [] trong đa số trường hợp. CHỈ khi vật liệu trong "materials" là loại
    hiếm/ít phổ biến, có thể đề xuất tối đa 2 tag viết thường không dấu (vd "#alexandrite") để người
    duyệt bổ sung sau — các tag này KHÔNG được đăng tự động.
  Danh sách tag chủ đề được phép cho "topicTags":
${topicLines}
- Không thêm field nào ngoài schema trên. Không thêm text trước/sau JSON.`;
}

export function buildUserPrompt(topicHint, angleInstruction) {
  const hint = topicHint ? `\n\nGợi ý ngữ cảnh thêm từ người dùng: ${topicHint}` : "";
  const angle = angleInstruction ? `\n\nGóc độ nội dung yêu cầu cho video này: ${angleInstruction}` : "";
  return `Ảnh 1 (bên trái) và ảnh 2 (bên phải) đính kèm là 2 chủ thể cần so sánh cho video.${hint}${angle}`;
}

// ============================================================
// Gemini call
// ============================================================
export function buildResponseSchema(allIds, hashtagCfg) {
  // Lowercase JSON Schema type strings — the REST generateContent body wants "object"/"string"/
  // "array", NOT the SDK's Type.OBJECT/Type.STRING enum constants (which serialize uppercase).
  // Sending uppercase here is accepted without an HTTP error but silently fails to constrain the
  // model — confirmed by testing: the model rambled instead of returning schema-shaped JSON.
  // maxLength/maxItems bound every open-ended field — without them the model (observed 3/3
  // times on gemini-3.6-flash, both thinkingLevel "low" and default) degenerates into a
  // repeating-phrase loop while generating "title" and never reaches the rest of the schema.
  //
  // ALL 5 top-level fields are `required`. Gemini's responseSchema subset has no oneOf/anyOf,
  // so a schema that makes title/label_left/label_right/points optional (to allow an
  // error-only response) was silently exploited by the model: without `required`, it returned
  // valid-but-incomplete JSON containing only "title" and stopped (finishReason STOP) — this
  // was the actual root cause of every earlier failed test, confirmed via DEBUG_GEMINI logging.
  // Fix: every field is required; "error" is "" (empty string) in the success case, and when
  // non-empty the other 4 fields are meaningless placeholders (empty string / empty array) —
  // see parseAndValidate, which branches on `error` first and ignores the placeholders.
  const topicItems = { type: "string", maxLength: 24 };
  if (hashtagCfg.topic.length) topicItems.enum = hashtagCfg.topic.map((t) => t.tag);
  return {
    type: "object",
    required: ["error", "title", "label_left", "label_right", "materials", "topicTags", "suggestedTags", "points"],
    properties: {
      error: { type: "string", maxLength: 200 },
      title: { type: "string", maxLength: 120 },
      label_left: { type: "string", maxLength: 40 },
      label_right: { type: "string", maxLength: 40 },
      materials: { type: "array", maxItems: 2, items: { type: "string", maxLength: 40 } },
      // enum = whitelist config/hashtags.json: Gemini không thể trả tag ngoài danh sách. Không có
      // minItems -> mảng rỗng hợp lệ (nội dung ngoài ngành trang sức: caption chỉ có tag cụ thể).
      topicTags: { type: "array", maxItems: 2, items: topicItems },
      suggestedTags: { type: "array", maxItems: 2, items: { type: "string", maxLength: 24 } },
      points: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          // Every field required, for the same reason the top-level ones are:
          // without `required` the model returns partial objects and stops.
          required: ["text", "side", "tag", "sub", "suggested_action", "needs_context_image", "image_concept"],
          properties: {
            text: { type: "string", maxLength: 160 },
            side: { type: "string", enum: ["left", "right", "both"] },
            // maxLength is what keeps the on-screen tag from turning back into
            // a sentence — the label zone fits ~18 / ~26 characters per line.
            tag: { type: "string", maxLength: 18 },
            sub: { type: "string", maxLength: 26 },
            suggested_action: { type: "string", enum: allIds },
            // Giai đoạn 1 — ảnh minh hoạ ngữ cảnh (xem enforceContextImageLimits): model tự đề
            // xuất, code hậu kiểm/cắt bớt sau, không tin tưởng tuyệt đối vào việc model tự giác
            // giới hạn số lượng — cùng triết lý với enforceJewelryGating ở trên.
            needs_context_image: { type: "boolean" },
            image_concept: { type: "string", maxLength: 200 },
          },
        },
      },
    },
  };
}

/**
 * Dựng TOÀN BỘ input của 1 lần gọi Gemini — hàm thuần (không đọc env/file/mạng), dễ test.
 * @returns {{systemPrompt:string, userPrompt:string, responseSchema:object}}
 */
export function buildComparePrompt({ catalog, hashtagCfg, topicHint, angleInstruction }) {
  return {
    systemPrompt: buildSystemPrompt(catalog, hashtagCfg),
    userPrompt: buildUserPrompt(topicHint, angleInstruction),
    responseSchema: buildResponseSchema(catalog.allIds, hashtagCfg),
  };
}
