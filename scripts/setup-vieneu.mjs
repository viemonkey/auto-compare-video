// Dựng môi trường Python cho VieNeu-TTS (TTS_PROVIDER=vieneu).
//
// Source của VieNeu-TTS được vendor thẳng vào repo (upstream pnnbao97/VieNeu-TTS
// @ v3.6.4, Apache-2.0), nhưng .venv (~980MB) và model weights (~580MB) thì không
// — script này dựng lại phần đó trên máy người dùng.
//
// KHÔNG dùng `uv sync` / `make setup` của upstream: pyproject.toml ở đây đã được
// patch thêm `sys_platform == 'darwin' and platform_machine == 'x86_64'` vào
// required-environments, mà extra `gpu` lại ghim torch 2.8.0 — bản này không có
// wheel cho macOS x86_64, nên `uv lock` kết luận "requirements are unsatisfiable"
// và sync fail. `uv pip install -e .` bỏ qua required-environments + các extra,
// chỉ cài core (torch-free, chạy bằng ONNX Runtime) — đúng thứ infer_cli.py cần.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const VIENEU_DIR = path.join(REPO_ROOT, "VieNeu-TTS");
const VENV_DIR = path.join(VIENEU_DIR, ".venv");
// Python 3.10, KHÔNG phải 3.12 như VieNeu-TTS/.python-version gợi ý. pyproject chỉ
// yêu cầu >=3.10, và 3.10 là bộ đã được kiểm chứng chạy thật (numba 0.59.1 /
// llvmlite 0.42.0 / librosa 0.11.0 / onnxruntime 1.23.2).
const PYTHON_VERSION = "3.10";

// Ghim numba: bản mới nhất (0.67.x) kéo theo llvmlite 0.49, mà llvmlite 0.49 KHÔNG
// còn phát hành wheel cho macOS x86_64 (Intel Mac) — uv rơi về build từ source và
// fail vì thiếu LLVM. numba <0.60 (0.59.1 + llvmlite 0.42.0) còn wheel dựng sẵn cho
// cả macOS x86_64/arm64, Linux và Windows trên Python 3.10, nên ghim cho mọi nền
// tảng để ai pull về cũng ra đúng một môi trường.
const EXTRA_CONSTRAINTS = ["numba<0.60"];

const isWindows = process.platform === "win32";
const venvPython = path.join(VENV_DIR, isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.error) die(`Không chạy được \`${cmd}\`: ${r.error.message}`);
  if (r.status !== 0) die(`\`${cmd} ${args.join(" ")}\` thoát với mã ${r.status}.`);
}

// --- 1. Source đã có chưa ---
if (!fs.existsSync(path.join(VIENEU_DIR, "pyproject.toml"))) {
  die(
    `Không thấy ${path.relative(REPO_ROOT, VIENEU_DIR)}/pyproject.toml.\n` +
      "  Source VieNeu-TTS được commit trong repo — thử `git pull` lại,\n" +
      `  hoặc clone lại repo nếu thư mục này rỗng.`,
  );
}

// --- 2. uv ---
let uvVersion;
try {
  uvVersion = execFileSync("uv", ["--version"], { encoding: "utf8" }).trim();
} catch {
  die(
    "Chưa cài `uv` (trình quản lý gói Python). Cài rồi chạy lại:\n" +
      "    macOS/Linux:  curl -LsSf https://astral.sh/uv/install.sh | sh\n" +
      "    Windows:      powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\"",
  );
}
console.log(`✓ ${uvVersion}`);

// --- 3. Tạo venv (uv tự tải Python nếu máy chưa có bản đúng) ---
if (fs.existsSync(venvPython)) {
  console.log(`✓ venv đã có: ${path.relative(REPO_ROOT, VENV_DIR)}`);
} else {
  console.log(`\n>> Tạo venv Python ${PYTHON_VERSION} tại ${path.relative(REPO_ROOT, VENV_DIR)} ...`);
  run("uv", ["venv", "--python", PYTHON_VERSION, VENV_DIR]);
}

// --- 4. Cài vieneu (editable, chỉ core — không extra) ---
console.log("\n>> Cài dependencies (core torch-free, chạy bằng ONNX Runtime) ...");
run("uv", ["pip", "install", "--python", venvPython, "-e", VIENEU_DIR, ...EXTRA_CONSTRAINTS]);

// --- 5. Kiểm tra thật: import được và infer_cli.py nhận đúng tham số ---
console.log("\n>> Kiểm tra ...");
const check = spawnSync(venvPython, ["-c", "import vieneu, soundfile; print(vieneu.__name__, 'OK')"], {
  encoding: "utf8",
});
if (check.status !== 0) {
  die(`venv dựng xong nhưng \`import vieneu\` fail:\n${check.stderr}`);
}
console.log(`✓ ${check.stdout.trim()}`);

const cli = path.join(VIENEU_DIR, "infer_cli.py");
if (!fs.existsSync(cli)) {
  die(`Thiếu ${path.relative(REPO_ROOT, cli)} — file cầu nối mà generate-vo.mjs gọi.`);
}
const cliHelp = spawnSync(venvPython, [cli, "--help"], { encoding: "utf8" });
if (cliHelp.status !== 0) {
  die(`\`infer_cli.py --help\` fail:\n${cliHelp.stderr}`);
}
console.log("✓ infer_cli.py chạy được");

console.log(
  "\n✓ Xong. Đặt TTS_PROVIDER=vieneu trong .env ở gốc repo để dùng.\n" +
    "  Lần sinh voiceover ĐẦU TIÊN sẽ tải ~580MB model về ~/.cache/huggingface\n" +
    "  (tự động, chỉ một lần) nên sẽ chậm hơn hẳn các lần sau.\n" +
    "  Không muốn cài Python: để TTS_PROVIDER=edge — Edge TTS miễn phí, thuần Node.js.",
);
