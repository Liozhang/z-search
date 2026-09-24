import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// ESM 无 __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADDON_ID = "zsearch@z-search.dev";
const BUILD_DIR = ".scaffold/build/addon";
const ZOTERO_PROFILE =
  process.env.APPDATA + "/Zotero/Zotero/Profiles/lel4974k.default";
const TARGET_DIR = path.join(ZOTERO_PROFILE, "extensions", ADDON_ID);
const ZOTERO_LOCAL = process.env.LOCALAPPDATA + "/Zotero/Zotero";
const LOCAL_PROFILE = path.join(ZOTERO_LOCAL, "Profiles", "lel4974k.default");
const ZOTERO_EXE = "D:/zotero10/zotero.exe";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function deploy() {
  console.log("📦 Deploying z-search...");

  // 0. Worktree guard（可选）：非 git 仓库时跳过该检查。
  const allowDirty = process.argv.includes("--allow-dirty");
  let dirty = [];
  try {
    dirty = execSync("git status --porcelain", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    })
      .split("\n")
      .map((l) => l.trimEnd())
      .filter(Boolean);
  } catch {
    console.log("  ℹ Not a git repository — skipping dirty-tree guard.");
  }
  if (dirty.length > 0) {
    console.error(
      `⚠  worktree is dirty: ${dirty.length} path(s) would be compiled into the package:`,
    );
    for (const d of dirty.slice(0, 30)) console.error(`     ${d}`);
    if (!allowDirty) {
      console.error(
        "❌ deploy aborted: commit/stash first, or pass --allow-dirty.",
      );
      process.exit(1);
    }
    console.log("  ⚠ --allow-dirty: deploying the dirty tree listed above.");
  }

  // 1. Pre-flight: refuse to deploy an incomplete build.
  const REQUIRED = ["content/reactBundle.js", "manifest.json"];
  const missing = REQUIRED.filter(
    (rel) => !fs.existsSync(path.join(BUILD_DIR, rel)),
  );
  if (missing.length > 0) {
    console.error(
      `❌ deploy aborted: build incomplete, missing from ${BUILD_DIR}:`,
    );
    for (const m of missing) console.error(`     ${m}`);
    console.error("    → run the full build first (npm run build)");
    process.exit(1);
  }

  // 2. Size guard: reactBundle over 10MB means a dev artifact shipped.
  const bundleSize = fs.statSync(
    path.join(BUILD_DIR, "content/reactBundle.js"),
  ).size;
  if (bundleSize > 10 * 1024 * 1024) {
    console.error(
      `❌ deploy aborted: reactBundle.js is ${(bundleSize / 1024 / 1024).toFixed(1)}MB (>10MB) — looks like a dev artifact (inline source map?).`,
    );
    process.exit(1);
  }

  // 3. Copy build files to extension directory (clean slate).
  console.log("  → Copying build files...");
  if (fs.existsSync(TARGET_DIR)) {
    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  function copyRecursive(srcDir, destDir) {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) copyRecursive(srcPath, destPath);
      else fs.copyFileSync(srcPath, destPath);
    }
  }

  copyRecursive(BUILD_DIR, TARGET_DIR);
  console.log("  ✓ Build files copied");

  // 4. Remove stale locale files (unprefixed names from older scaffold).
  console.log("  → Cleaning stale locale files...");
  const localeDir = path.join(TARGET_DIR, "locale");
  if (fs.existsSync(localeDir)) {
    for (const locale of fs.readdirSync(localeDir)) {
      const localePath = path.join(localeDir, locale);
      if (!fs.statSync(localePath).isDirectory()) continue;
      for (const file of fs.readdirSync(localePath)) {
        if (file.endsWith(".ftl") && !file.startsWith("zsearch-")) {
          try {
            fs.unlinkSync(path.join(localePath, file));
            console.log(`  ✓ Removed stale: locale/${locale}/${file}`);
          } catch {
            /* best-effort */
          }
        }
      }
    }
  }

  // 5. Clear Zotero caches (startup cache + chrome registration cache).
  console.log("  → Clearing Zotero caches...");
  const cacheDirs = [
    path.join(ZOTERO_PROFILE, "startupCache"),
    path.join(ZOTERO_PROFILE, "cache2"),
    path.join(ZOTERO_PROFILE, "xul.cache"),
    path.join(ZOTERO_PROFILE, "addonStartup.json.lz4"),
    path.join(LOCAL_PROFILE, "startupCache"),
    path.join(LOCAL_PROFILE, "chrome_debugger_profile", "startupCache"),
    path.join(ZOTERO_LOCAL, "profile.makefile"),
  ];
  let clearedCount = 0;
  for (const dir of cacheDirs) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        clearedCount++;
      } catch {
        /* best-effort */
      }
    }
  }
  console.log(
    clearedCount === 0
      ? "  ℹ No caches found (already clean)"
      : `  ✓ Cleared ${clearedCount} cache location(s)`,
  );

  // 6. Kill Zotero completely, wait for handles, restart with console.
  console.log("  → Stopping Zotero...");
  try {
    execSync("taskkill /F /IM zotero.exe", { stdio: "ignore" });
    console.log("  ✓ Zotero stopped");
  } catch {
    console.log("  ℹ Zotero was not running");
  }
  await sleep(1500);

  console.log("  → Starting Zotero with console...");
  try {
    execSync(`start "" "${ZOTERO_EXE}" -jsconsole`, { stdio: "ignore" });
    console.log("  ✓ Zotero started");
  } catch (e) {
    console.error(`  ⚠ Could not start Zotero automatically: ${e.message}`);
    console.error(`    → start manually: ${ZOTERO_EXE} -jsconsole`);
  }

  console.log("");
  console.log("✅ Deployment complete! Caches cleared, Zotero restarted.");
}

deploy().catch((err) => {
  console.error("❌ Deployment failed: ", err);
  process.exit(1);
});
