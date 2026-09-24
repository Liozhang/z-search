/**
 * Build the embed frame as a standalone IIFE bundle for the off-screen
 * iframe host (EmbedFrameHost).
 *
 * Creates addon/content/scripts/embed-standalone.js. The bundle carries
 * @huggingface/transformers (web build) and exposes
 * `leaderoEmbedFrame.{embed,dispose}` plus a `leaderoEmbedFrameReady` init
 * promise on the frame window — ORT's wasm backend dynamically imports its
 * factory mjs at runtime, which only works inside a window context (the
 * bootstrap subscript sandbox has no script loader; see embed-frame.ts).
 *
 * Run automatically as part of `npm run build` (same group as
 * build-mermaid.cjs / build-ort-assets.cjs).
 */

const esbuild = require("esbuild");
const path = require("path");

const outDir = path.join(__dirname, "..", "addon", "content", "scripts");

esbuild
  .build({
    entryPoints: [
      path.join(__dirname, "..", "src", "core", "embedding", "embed-frame.ts"),
    ],
    bundle: true,
    format: "iife",
    target: "firefox140",
    outfile: path.join(outDir, "embed-standalone.js"),
    write: true,
    minify: true,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  })
  .then(() => {
    const fs = require("fs");
    const stats = fs.statSync(path.join(outDir, "embed-standalone.js"));
    console.log(
      `  ✓ embed-standalone.js built (${(stats.size / 1024).toFixed(1)} KB)`,
    );
  })
  .catch(() => {
    console.error("  ✗ Failed to build embed-standalone.js");
    process.exit(1);
  });
