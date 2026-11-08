import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Copy asset Piper/ONNX từ node_modules vào public/ để đóng gói vào extension.
 * Chạy tự động trước mỗi lần build; không tải mạng.
 */
const root = process.cwd();
const publicDir = join(root, "public");
const piperOut = join(publicDir, "piper");
const ortOut = join(publicDir, "ort");

const piperSrc = join(root, "node_modules", "@diffusionstudio", "piper-wasm", "build");
const ortSrc = join(root, "node_modules", "onnxruntime-web", "dist");

const ORT_FILES = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd.wasm",
];

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function copyIfNeeded(from, to) {
  if (!existsSync(from)) {
    console.error(`thiếu file: ${from}`);
    process.exitCode = 1;
    return;
  }
  if (existsSync(to) && statSync(to).size === statSync(from).size) return;
  cpSync(from, to);
}

ensureDir(piperOut);
ensureDir(ortOut);

for (const name of ["piper_phonemize.js", "piper_phonemize.wasm", "piper_phonemize.data"]) {
  copyIfNeeded(join(piperSrc, name), join(piperOut, name));
}

for (const name of ORT_FILES) {
  copyIfNeeded(join(ortSrc, name), join(ortOut, name));
}

for (const dir of [piperOut, ortOut]) {
  const files = readdirSync(dir).map((name) => {
    const size = statSync(join(dir, name)).size;
    return `${name} ${(size / 1024 / 1024).toFixed(1)} MB`;
  });
  console.log(`${dir}: ${files.join(", ")}`);
}
