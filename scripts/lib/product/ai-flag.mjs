// Video có dùng ảnh AI (gemini/manual) hoặc clip AI thì phải gắn cờ ai_generated (bước đăng bài bật nhãn nội dung AI).
export function usesAiImages(project) {
  const sceneAi = (project.scenes || []).some((s) => (s.kind === "photo" && s.image && (s.source === "gemini" || s.source === "manual")) || (s.kind === "half" && (project.scenes.find((x) => x.id === s.from)?.image)));
  return sceneAi || project.clip?.status === "ok";
}
