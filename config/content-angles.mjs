// Danh mục "góc độ nội dung" cho phép người dùng chọn TRƯỚC khi Gemini viết kịch bản —
// cùng 1 cặp ảnh sản phẩm có thể sinh ra nhiều video khai thác góc độ khác nhau.
//
// Nguồn dữ liệu DUY NHẤT cho cả 3 nơi dùng tới:
//   - server.mjs (GET /api/content-angles -> public/app.js load dropdown Bước 1)
//   - scripts/generate-compare-content.mjs (resolve promptInstruction theo id)
//   - id dùng làm hậu tố slug trong app.js / scripts/scaffold-compare-video.mjs
//
// id: chữ thường, kebab-case, KHÔNG đổi id sau khi đã có video dùng id đó (video cũ ghép
// id vào tên thư mục videos/<slug>/, đổi id ở đây không ảnh hưởng thư mục đã tạo nhưng làm
// mất liên kết ngữ nghĩa).
export const CONTENT_ANGLES = [
  {
    id: "difference",
    label: "So sánh sự khác nhau cơ bản",
    promptInstruction:
      "Tập trung làm rõ những điểm khác biệt cơ bản, dễ hiểu nhất giữa 2 đối tượng, phù hợp người mới bắt đầu tìm hiểu.",
  },
  {
    id: "pros-cons",
    label: "So sánh ưu điểm / nhược điểm",
    promptInstruction:
      "Phân tích rõ ưu điểm và nhược điểm của từng bên, giúp người xem cân nhắc được-mất trước khi chọn.",
  },
  {
    id: "authenticity",
    label: "Cách nhận biết thật - giả",
    promptInstruction:
      "Tập trung vào các dấu hiệu, mẹo thực tế để phân biệt hàng thật và hàng giả/kém chất lượng, ưu tiên tính thực dụng.",
  },
  {
    id: "buying-advice",
    label: "Nên chọn mua loại nào",
    promptInstruction:
      "Đưa ra lời khuyên cụ thể nên chọn loại nào theo từng nhu cầu/đối tượng khác nhau (ngân sách, mục đích sử dụng...).",
  },
];
