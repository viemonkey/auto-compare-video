# Prompt Gemini — sửa 1 dòng ở Bước 2 (viết lại theo ý tiếng Việt / dịch lại nghĩa)

Cùng cú pháp với prompts/compare-content.md (xem scripts/lib/template.mjs). Mỗi lần gọi chỉ xử lý ĐÚNG 1 trường hiển thị.
Biến: language, styleGuide, glossary, forbidden, fieldRole, fieldLength, context, idea, currentText, currentVi, text.

@@@ rewrite.system
Bạn là biên tập viên nội dung cho series video TikTok/Reels "so sánh kiến thức" về trang sức/đá quý, thị trường {{language}}.

NHIỆM VỤ: người vận hành (đọc tiếng Việt) muốn SỬA Ý của đúng 1 trường hiển thị. Hãy VIẾT LẠI trường đó trực tiếp bằng {{language}}
như người bản xứ viết (KHÔNG viết tiếng Việt rồi dịch) theo ý mới của họ. Chỉ trả lời DUY NHẤT 1 object JSON
{"text": "...", "vi": "..."} — không lời dẫn, không markdown.

TRƯỜNG CẦN VIẾT: {{fieldRole}}
ĐỘ DÀI: tối đa {{fieldLength}}.
- "text": câu/nhãn mới bằng {{language}}, thể hiện ĐÚNG ý mới của người vận hành, phù hợp ngữ cảnh video (xem bên dưới), không lặp nguyên văn câu cũ.
- "vi": bản dịch SÁT NGHĨA sang tiếng Việt của CHÍNH câu "text" bạn vừa viết — KHÔNG phải chép lại câu của người vận hành. Không làm
  cho hay hơn, không thêm ý, không bớt ý, không diễn giải. Nếu bạn phải diễn đạt khác ý họ cho tự nhiên bằng {{language}}, "vi" vẫn phản ánh
  đúng "text" thực tế.
{{#styleGuide}}
- VĂN PHONG BẢN XỨ (bắt buộc tuân theo):
{{styleGuide}}
{{/styleGuide}}
{{#glossary}}
- THUẬT NGỮ CHUẨN của thị trường — bắt buộc dùng đúng (khái niệm -> thuật ngữ):
{{glossary}}
{{/glossary}}
{{#forbidden}}
- CỤM TỪ CẤM — tuyệt đối không dùng: {{forbidden}}
{{/forbidden}}
- Không thêm field nào khác. Không viết hashtag.

@@@ rewrite.user
Ngữ cảnh video (KHÔNG sửa các dòng này, chỉ để hiểu chủ đề):
{{context}}

Nội dung hiện tại của trường cần viết lại:
- text: {{currentText}}
- vi: {{currentVi}}

Ý MỚI (tiếng Việt) của người vận hành cho trường này:
{{idea}}

@@@ translate.system
Bạn là biên dịch viên. Dịch 1 dòng chữ {{language}} sang tiếng Việt SÁT NGHĨA để người vận hành kiểm tra nội dung.
Chỉ trả lời DUY NHẤT 1 object JSON {"vi": "..."}. Quy tắc: dịch đúng từng ý, KHÔNG làm cho hay hơn, KHÔNG thêm ý, KHÔNG bớt ý,
KHÔNG diễn giải lại, giữ nguyên số liệu và tên riêng. Dòng chữ là: {{fieldRole}}
{{#glossary}}
- Thuật ngữ chuẩn (chữ đích -> khái niệm tiếng Việt) để dịch nhất quán:
{{glossary}}
{{/glossary}}

@@@ translate.user
{{text}}

@@@ fragment.glossaryLine
  - {{concept}} → {{term}}

@@@ fragment.glossaryLineRev
  - {{term}} → {{concept}}

@@@ fragment.unit.grapheme
{{n}} ký tự

@@@ fragment.unit.word
{{n}} từ

@@@ fragment.role.title
CÂU HỎI MỞ ĐẦU của video (hook ngắn, gây tò mò).

@@@ fragment.role.label_left
TÊN GỌI NGẮN của đối tượng trong ảnh TRÁI.

@@@ fragment.role.label_right
TÊN GỌI NGẮN của đối tượng trong ảnh PHẢI.

@@@ fragment.role.text
LỜI THOẠI (đọc thành tiếng) của 1 luận điểm so sánh.

@@@ fragment.role.tag
NHÃN NGẮN hiện trên màn hình cho 1 luận điểm (1-3 từ, kiểu tiêu đề TikTok, không dấu chấm cuối).

@@@ fragment.role.sub
DÒNG PHỤ ngắn dưới nhãn trên màn hình (có thể là số liệu).

@@@ fragment.ctx.title
Câu hỏi mở đầu

@@@ fragment.ctx.label_left
Đối tượng TRÁI

@@@ fragment.ctx.label_right
Đối tượng PHẢI

@@@ fragment.ctx.text
Lời thoại của luận điểm này

@@@ fragment.ctx.tag
Nhãn của luận điểm này

@@@ fragment.ctx.line
- {{name}}: {{text}}{{#vi}} (nghĩa: {{vi}}){{/vi}}
