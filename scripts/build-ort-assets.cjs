/**
 * build-ort-assets — 把 ONNX Runtime 的 wasm 资产从 node_modules 拷进插件
 * 源树 addon/content/ort/（随后由 zotero-plugin.config.ts 的 build.assets
 * 全量拷贝打进构建产物与 xpi）。
 *
 * 为什么必须有：embedFrameLogic 的 env.backends.onnx.wasm.wasmPaths 指向
 * {rootURI}content/ort/（见 LocalEmbeddingProvider.ts ortBaseUri）——这组
 * 文件缺失时 ORT wasm 后端动态 import 失败，本地 ONNX 嵌入逐条目报错
 * （实机测试 2026-09-26：buildIndex errors=N、metadataCount 恒 0）。
 * 本脚本曾在 leadero 期存在、移植时被误删，此处按同设计重建。
 *
 * 资产生成而非入库（.gitignore：addon/content/ort/）——wasm 28MB，随
 * postinstall / build / test:zotero 自动就位。
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(
  __dirname,
  "..",
  "node_modules",
  "onnxruntime-web",
  "dist",
);
const DEST = path.join(__dirname, "..", "addon", "content", "ort");
const FILES = [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

for (const f of FILES) {
  const from = path.join(SRC, f);
  if (!fs.existsSync(from)) {
    console.error(`✗ ORT asset missing in node_modules: ${f}`);
    process.exit(1);
  }
}
fs.mkdirSync(DEST, { recursive: true });
for (const f of FILES) {
  fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
}
console.log(`  ✓ ORT assets → ${path.relative(process.cwd(), DEST)}`);
