// Chỉ bật no-undef — bắt biến/hàm chưa khai báo (lỗi hay gặp khi refactor/tách module).
import globals from "globals";

const baseRules = { "no-undef": "error" };

export default [
  { ignores: ["node_modules/**", "videos/**", "VieNeu-TTS/**", "output/**", "assets/**", "templates/**", ".claude/**", ".agents/**"] },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
    rules: baseRules,
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: { ...globals.browser } },
    rules: baseRules,
  },
];
