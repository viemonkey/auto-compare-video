// Nạp prompt của chế độ "Giới thiệu sản phẩm" (prompts/product-*.md, prompts/product-scenes/*.md) bằng engine template có sẵn.
import fs from "node:fs";
import path from "node:path";
import { loadTemplateFile, renderTemplate } from "../template.mjs";
import { repoPath } from "./config.mjs";

export const productPromptPath = (name) => process.env.PRODUCT_PROMPT_DIR ? path.join(process.env.PRODUCT_PROMPT_DIR, name) : repoPath("prompts", name);

/** Phần `@@@ <name>` của file prompt; thiếu -> ném lỗi chỉ rõ file + phần. */
export function promptSection(file, name) {
  const sections = loadTemplateFile(file);
  if (sections[name] === undefined) throw new Error(`${path.relative(repoPath(), file)} thiếu phần "@@@ ${name}"`);
  return sections[name];
}

export const renderSection = (file, name, vars) => renderTemplate(promptSection(file, name), vars);

export const promptFileExists = (file) => fs.existsSync(file);
