# Phần dùng chung của prompt ảnh cảnh có HuyK (chế độ "Giới thiệu sản phẩm"). Viết bằng tiếng Anh vì model tạo ảnh hiểu tốt nhất.
Cùng cú pháp với prompts/compare-content.md. Biến: productKind, lockText, outfitText, faceRange, productRange, outfitRef, productShare, instruction, userRequest.

Bài học từ test tay đã đưa vào đây:
 - mô tả sản phẩm do Gemini vision viết (lockText) — KHÔNG tự gõ tay mô tả sản phẩm vào prompt;
 - dùng ngôn ngữ nhiếp ảnh (85mm, f/2, tay cách máy ~40cm, softbox + đèn viền) để ảnh đẹp mà tay không bị phóng to;
 - ảnh khuôn mặt chỉ để giữ mặt + kiểu tóc, không lấy trang phục; trang phục lấy từ cấu hình;
 - luôn có câu khoá sản phẩm và ghi rõ tỉ lệ sản phẩm trong khung.

@@@ photo
Photographic look: shot on an 85mm lens at f/2, camera about 40 cm from the subject's hand so the hand keeps natural proportions (the hand must NOT look enlarged), soft key light from a large softbox plus a subtle rim light, warm neutral background with gentle falloff, natural sparkle and fire on the stones, sharp focus on the jewelry, vertical 9:16 composition, realistic skin texture, no retouching artifacts.

@@@ product
The jewelry is the exact product described below and shown in reference {{productRange}}: {{lockText}}
PRODUCT LOCK: keep this jewelry EXACTLY as in the reference. Do NOT change the metal color. Do NOT change the number of stone rows or the size or shape of the stones. Do NOT add, remove or restyle any detail, motif or stone. Do NOT add any other jewelry. The {{productKind}} occupies about {{productShare}}.

@@@ face
The man in the picture is the host "HuyK". Use reference images {{faceRange}} ONLY for his face and hairstyle: copy the face, facial structure, skin tone and hairstyle exactly from those images. Take ONLY the face from these images — do NOT take their clothes, background or pose.

@@@ outfit
He wears: {{outfitText}}. The outfit is the same in every scene of the video.{{#outfitRef}} Match the outfit shown in reference image {{outfitRef}}.{{/outfitRef}}

@@@ forbid
No text, no captions, no logo, no watermark, no brand names. Natural hands with exactly five fingers each, correct finger count and joints. No extra people. No distortion of the face. No cartoon or illustration style.

@@@ fix-face
This is an image editing task. KEEP EVERYTHING in the first image exactly as it is: the same pose, the same hands, the same jewelry, the same outfit, the same background, the same lighting and the same composition. ONLY fix the face: make the man's face and hairstyle match the host in reference images {{faceRange}} (face and hairstyle only — do not take clothes or background from them). Do not change anything else.{{#userRequest}} Extra request from the operator: {{userRequest}}{{/userRequest}}

@@@ fix-product
This is an image editing task. KEEP EVERYTHING in the first image exactly as it is: the same person, the same face, the same pose, the same hands, the same outfit, the same background, the same lighting and the same composition. ONLY fix the jewelry so that it is IDENTICAL to the product in reference {{productRange}}: {{lockText}} Same metal color, same number of stone rows, same stone size and shape, same setting and details. Do not change anything else.{{#userRequest}} Extra request from the operator: {{userRequest}}{{/userRequest}}

@@@ edit
This is an image editing task. KEEP EVERYTHING in the first image exactly as it is (the same person, face, jewelry, outfit, pose, background, lighting and composition) EXCEPT for the change requested below. Never change the jewelry or the face.
Requested change: {{userRequest}}
