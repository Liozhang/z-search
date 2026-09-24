/**
 * OpenDataLoaderPdfClient — Local PDF → Markdown via opendataloader-pdf CLI (JVM).
 *
 * Uses opendataloader-pdf CLI (JVM) for local PDF parsing.
 * Uses nsIProcess.runwAsync to spawn `java -jar opendataloader-pdf-cli.jar`.
 *
 * Output contract:
 *  - format: `options.format ?? "json"`; parsePdfToMarkdown() pins "markdown"
 *  - imageOutput: `options.imageOutput ?? config.imageOutput`, i.e. pref-driven
 *    ("off" by default; "embedded" base64 data URIs inline when the
 *    pdfParser.opendataloader.returnImages pref is on)
 *  - the .json / .md file is read from the output directory after the JVM exits
 */

import { getPref } from "../../utils/prefs";
import { getCachedManagedJavaExe } from "./JavaRuntimeManager";
import { Semaphore } from "../../utils/Semaphore";
// `log` 是 verboseEnabled() 门后的调试通道（dev 构建或 debug pref 开启才输出）；
// 原先这 14 处诊断走 console.error —— 它们既不在任何 verbose 门后，生产构建里
// 又会被 fix-console.js 的失效正则漏掉、原样打进 Zotero 错误控制台，
// 每次 PDF 解析刷十几行 "[Leadero ODL]"（2026-09-10 审计 G-03）。
import { log, safeDebug } from "../../utils/logger";
import { toErrorMessage } from "../../utils/error";
import { getString } from "../../utils/locale";

/** Limits concurrent JVM processes to prevent OOM under parallel PDF parsing.
 *  Each JVM consumes ~200-400MB RSS; 2 is a safe ceiling for typical machines. */
const JVM_SEMAPHORE = new Semaphore(2);

export interface OpenDataLoaderPdfConfig {
  tableMethod: string;
  readingOrder: string;
  useStructTree: boolean;
  timeout: number; // seconds
  /**
   * Image output mode passed to the jar's `--image-output` flag.
   *   - "off": no images
   *   - "embedded": base64 data URIs inline in JSON (required for the
   *     translate→split pipeline to composite figures back onto the page)
   *   - "external": file references (default; not useful in-process)
   * Default "off" — the pure heuristic engine emits no image elements anyway,
   * so this only matters when a hybrid AI backend is configured.
   */
  imageOutput: "off" | "embedded" | "external";
}

export interface OpenDataLoaderPdfParseOptions {
  startPage?: number;
  endPage?: number;
  format?: "markdown" | "json";
  signal?: AbortSignal;
  /**
   * Override the configured `--image-output` mode for this call. When omitted,
   * the pref-derived default (pdfParser.opendataloader.returnImages) is used.
   * The translate→split pipeline passes "embedded" so figures are composited
   * back onto the translated page regardless of the parser's global setting.
   */
  imageOutput?: "off" | "embedded" | "external";
}

export interface OpenDataLoaderPdfParseResult {
  success: boolean;
  markdown: string;
  json?: any;
  images: Record<string, string>; // filename → data:image/... base64
  source: "opendataloader-pdf";
  taskId?: string;
  error?: string;
}

export interface OpenDataLoaderJsonParseResult {
  success: boolean;
  data: any; // parsed JSON root (schema.json shape)
  source: "opendataloader-pdf";
  taskId?: string;
  error?: string;
}

interface HealthResult {
  healthy: boolean;
  version?: string;
  error?: string;
}

function loadConfig(): OpenDataLoaderPdfConfig {
  const rawTable = getPref("pdfParser.opendataloader.tableEnable");
  let tableMethod: string;
  if (typeof rawTable === "boolean") {
    // backward compatibility: old prefs stored true/false
    tableMethod = rawTable ? "cluster" : "default";
  } else {
    tableMethod = (rawTable as string) === "cluster" ? "cluster" : "default";
  }

  return {
    tableMethod,
    readingOrder: "xycut",
    useStructTree:
      (getPref("pdfParser.opendataloader.useStructTree") as boolean) ?? false,
    timeout: (getPref("pdfParser.opendataloader.timeout") as number) ?? 300,
    // returnImages pref now drives the jar's --image-output flag. When true,
    // emit base64 data URIs inline (so the JSON adapter can pick them up into
    // PdfChartArea.imageDataUri for downstream rendering).
    imageOutput: (getPref("pdfParser.opendataloader.returnImages") as boolean)
      ? "embedded"
      : "off",
  };
}

/**
 * Check whether Java is available on PATH.
 */
export async function checkHealth(): Promise<HealthResult> {
  // Refresh the managed-JRE cache first so resolveJavaExecutable() (sync) can
  // pick up a freshly-downloaded JRE without a Zotero restart. Dynamic import
  // to avoid a circular dependency (JavaRuntimeManager imports checkHealth).
  try {
    const { getManagedJavaExe } = await import("./JavaRuntimeManager");
    await getManagedJavaExe();
  } catch (e) {
    safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
    /* best-effort: fall through to system detection */
  }
  const javaExe = resolveJavaExecutable();
  log(`[Leadero ODL] checkHealth: javaExe="${javaExe}"`);
  if (!javaExe) {
    return {
      healthy: false,
      error:
        "Java runtime not found. Please install Java 11+ and add it to PATH.",
    };
  }

  // Run `java -version` directly (NOT through the JAR) to verify Java works.
  // execJava() prepends `-jar <jarPath>` which would pass `-version` to the
  // opendataloader-pdf CLI and cause a non-zero exit.
  const result = await runProcess(javaExe, ["-version"], 10000);
  log(
    `[Leadero ODL] checkHealth: java -version exitCode=${result.exitCode} timedOut=${result.timedOut}`,
  );
  if (result.exitCode !== 0) {
    return { healthy: false, error: result.stderr || "java -version failed" };
  }

  const versionMatch =
    result.stderr.match(/version "([^"]+)"/) ||
    result.stderr.match(/Java\(TM\) SE Runtime Environment.*"([^"]+)"/);
  const version = versionMatch ? versionMatch[1] : undefined;

  // Verify the major version is >= 11. The opendataloader-pdf jar is compiled
  // for Java 11 bytecode; running it on Java 8 crashes with a cryptic
  // UnsupportedClassVersionError instead of a clear "upgrade Java" message.
  // We extract the major version (for 1.x style "1.8" → 8, for modern "17.0.1" → 17).
  if (version) {
    let major: number | undefined;
    const parts = version.split(".");
    const first = parseInt(parts[0], 10);
    if (!Number.isNaN(first)) {
      major = first === 1 && parts.length > 1 ? parseInt(parts[1], 10) : first;
    }
    if (major !== undefined && !Number.isNaN(major) && major < 11) {
      return {
        healthy: false,
        error: getString("pdf-java-too-old", {
          args: { version, url: "https://adoptium.net" },
        }),
      };
    }
  }

  return { healthy: true, version };
}

/**
 * Resolve the `java` executable using the same PATH search as CodeExecutor.
 */
function resolveJavaExecutable(): string | null {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const Services = (globalThis as any).Services as any;

  //    refreshes this cache on each health probe; if a managed JRE exists it
  //    wins over system PATH so the user never needs to touch PATH/restart.
  const managed = getCachedManagedJavaExe();
  if (managed) {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    try {
      file.initWithPath(managed);
      if (file.exists() && file.isExecutable()) return managed;
    } catch (e) {
      safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
      /* bad cached path — fall through */
    }
  }

  const createFile = (path: string) => {
    try {
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(path);
      return file;
    } catch (e) {
      safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
      return null;
    }
  };

  const isWindows = (
    Services.appinfo?.OS?.toUpperCase?.() ||
    (navigator as any)?.platform ||
    ""
  ).startsWith("WIN");
  const extensions = isWindows ? [".exe", ".cmd", ".bat", ""] : [""];
  const separator = isWindows ? ";" : ":";

  // L-22: a developer-machine path ("D:\IGV_2.17.3\jdk-17\bin\java.exe") used
  // to sit FIRST in this list and shadow PATH on any machine that happened to
  // have it — removed; only standard install locations are probed.
  const absoluteCandidates = isWindows
    ? [
        "C:\\Program Files\\Java\\jdk-17\\bin\\java.exe",
        "C:\\Program Files\\Eclipse Adoptium\\jdk-17\\bin\\java.exe",
        "C:\\Program Files\\Eclipse Adoptium\\jdk-11\\bin\\java.exe",
      ]
    : ["/usr/bin/java", "/usr/local/bin/java", "/opt/homebrew/bin/java"];

  for (const candidate of absoluteCandidates) {
    const file = createFile(candidate);
    if (file && file.exists() && file.isExecutable()) return candidate;
  }

  const env = Cc["@mozilla.org/process/environment;1"]?.getService(
    Ci.nsIEnvironment,
  );
  const pathStr = env?.get("PATH") || "";

  for (const dir of pathStr.split(separator)) {
    const dirTrimmed = dir.trim();
    if (!dirTrimmed) continue;

    for (const ext of extensions) {
      const candidate = dirTrimmed + (isWindows ? "\\" : "/") + "java" + ext;
      const file = createFile(candidate);
      if (file && file.exists() && file.isExecutable()) return candidate;
    }
  }

  return null;
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** M-20: set when the caller's AbortSignal (not a timeout) killed the process. */
  aborted?: boolean;
}

async function execJava(
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal, // M-20: thread cancellation into the process runner
): Promise<ExecResult> {
  // Refresh the managed-JRE cache before the sync resolver runs — on a cold
  // session (no prior checkHealth) resolveJavaExecutable() misses the managed
  // JRE entirely and every parse fast-fails "java executable not found"
  // (2026-09-08: full-text build skipped 9/9 items in <20s this way, while
  // translation worked because its UI runs checkHealth first). Same dynamic
  // import as checkHealth — JavaRuntimeManager imports checkHealth.
  try {
    const { getManagedJavaExe } = await import("./JavaRuntimeManager");
    await getManagedJavaExe();
  } catch (e) {
    safeDebug("[z-search] OpenDataLoaderPdfClient.execJava: " + e);
    /* best-effort: fall through to system detection */
  }
  const javaExe = resolveJavaExecutable();
  if (!javaExe) {
    return {
      exitCode: -1,
      stdout: "",
      stderr: "java executable not found",
      timedOut: false,
    };
  }

  const jarPath = await getJarPath();
  const commandArgs = [
    "-Djava.awt.headless=true",
    "-Dapple.awt.UIElement=true",
    "-jar",
    jarPath,
    ...args,
  ];

  const release = await JVM_SEMAPHORE.acquire();
  try {
    // M-20: pass the caller's AbortSignal down so user cancellation kills the
    // JVM immediately instead of waiting out the hard timeout.
    return await runProcess(javaExe, commandArgs, timeoutMs, signal);
  } finally {
    release();
  }
}

async function getJarPath(): Promise<string> {
  // Resolve relative to this file: src/core/pdf/lib/opendataloader-pdf-cli.jar
  // Note: zotero-plugin-scaffold strips the leading `src/` from build output,
  // so in the deployed extension the JAR lives at `core/pdf/lib/...`.
  const { join } = (globalThis as any).PathUtils || {};
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const addonID =
    (globalThis as any).addon?.data?.config?.addonID || "zsearch@z-search.dev";

  // ── Resolve the addon's install root ──────────────────────────────────────
  // Priority:
  //  1. Zotero.getAddonDirectory(addonID) / addon.getInstallPath() — legacy APIs,
  //                                               may be absent on Zotero 9;
  //                                               non-filesystem results
  //                                               (nsIURI/jar:/XPI) discarded
  //  2. bootstrap `rootURI` free variable       — file: URI converted to a dir
  //  3. ProfD/extensions scan for "<addonID>" (dir) or "<addonID>.xpi"
  //  4. relative fallbacks under baseDir / the scaffold build tree
  let rawDir =
    (Zotero as any).getAddonDirectory?.(addonID) ||
    (Zotero as any).getAddon?.(addonID)?.getInstallPath?.() ||
    null;

  // M-22e-2: getInstallPath() on Zotero 9 may return a nsIURI whose .path is
  // empty (e.g. resource://leadero@leadero.dev/) or a "jar:..." string. Both
  // look truthy but carry no usable filesystem path. Discard them so the
  // profile-scan fallback below actually runs.
  if (rawDir) {
    const pathStr =
      typeof rawDir === "string"
        ? rawDir
        : typeof rawDir === "object" && "path" in rawDir
          ? String((rawDir as any).path)
          : String(rawDir);
    if (
      !pathStr ||
      pathStr.startsWith("resource://") ||
      pathStr.startsWith("jar:")
    ) {
      rawDir = null;
    } else if (
      typeof rawDir !== "string" &&
      typeof (rawDir as any).isFile === "function" &&
      (rawDir as any).isFile()
    ) {
      // An XPI file is not a directory — downstream code expects a directory
      // tree containing `core/pdf/lib/...`.
      rawDir = null;
    }
  }

  // M-22e: getAddonDirectory is removed in Zotero 9 (Gecko 115+). Resolve the
  // install root from the bootstrap-provided rootURI instead. NOTE: rootURI is
  // a free variable on the bootstrap scope object (see typings/global.d.ts and
  // DataLoader.ts) — globalThis.addon has NO rootURI property, so reading
  // `addon?.rootURI` always yields undefined and must not gate this block.
  if (!rawDir) {
    //    "file:///C:/.../extensions/<addonID>/" — convert directly via
    //    nsIFileURL to the addon directory.
    try {
      const uriStr = typeof rootURI !== "undefined" ? rootURI : "";
      log(`[Leadero ODL] getJarPath: rootURI="${uriStr}"`);
      if (uriStr.startsWith("file:")) {
        const uriFile = (
          (globalThis as any).Services.io
            .newURI(uriStr)
            .QueryInterface(Ci.nsIFileURL) as any
        ).file;
        if (uriFile?.path) rawDir = uriFile;
      }
    } catch (e) {
      safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
      /* not a file: URI — fall through to the profile scan */
    }
    //    named "<addonID>" (dir) or "<addonID>.xpi". ProfD is the real profile
    //    root (Zotero.DataDirectory.dir is the <profile>/zotero data subdir);
    //    nsIFile.append() keeps platform-native separators — string concat
    //    would produce mixed-slash paths that initWithPath rejects on Windows.
    if (!rawDir) {
      try {
        const dirService = Cc[
          "@mozilla.org/file/directory-service;1"
        ].getService((Components.interfaces as any).nsIProperties);
        const profileFile = dirService.get(
          "ProfD",
          (Components.interfaces as any).nsIFile,
        ) as nsIFile;
        const extDir = profileFile.clone();
        extDir.append("extensions");
        log(`[Leadero ODL] getJarPath: extDir="${extDir.path}"`);
        if (extDir.exists() && extDir.isDirectory()) {
          const entries = extDir.directoryEntries;
          while (entries.hasMoreElements()) {
            const rawEntry = entries.getNext();
            const entry = rawEntry?.QueryInterface?.(
              Ci.nsIFile,
            ) as nsIFile | null;
            if (!entry) continue;
            const leaf = entry.leafName;
            // Match "<addonID>" dir or "<addonID>.xpi"
            if (leaf === addonID || leaf === `${addonID}.xpi`) {
              rawDir = entry;
              break;
            }
          }
        }
      } catch (e) {
        safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
        /* profile scan failed — fall through to relative-path candidates */
      }
    }
  }

  const baseDir = rawDir ? String(rawDir.path ?? rawDir) : "";

  log(
    `[Leadero ODL] getJarPath: baseDir="${baseDir}" PathUtils.join=${!!join}`,
  );

  const relative = ["core", "pdf", "lib", "opendataloader-pdf-cli.jar"];

  // PathUtils.join does not accept an empty first segment.
  if (baseDir && join) {
    const joined = join(baseDir, ...relative);
    // M-22b: validate the joined path before returning — in dev environments
    // getAddonDirectory may return a path whose layout doesn't match the
    // source tree (e.g. the JAR lives under `src/` which is stripped in the
    // built XPI). Fall through to the existence-check loop when missing.
    try {
      if (await IOUtils.exists(joined)) return joined;
    } catch (e) {
      safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
      /* fall through */
    }
  }

  // M-22: nsIFile.initWithPath on Windows rejects mixed or forward-slash paths.
  const isWin = (Zotero as any).isWin;
  const normalize = (p: string) =>
    isWin ? p.replace(/[/\\]+/g, "\\") : p.replace(/[/\\]+/g, "/");

  // Absolute fallbacks for development / test environments where the addon
  // directory API is unavailable or returns empty.
  // L-22: the developer-machine path ("D:\github_code\leadero\...") was
  // removed — only scaffold-relative fallbacks remain.
  const candidates: string[] = [];
  if (baseDir) {
    // M-22c: in dev installs getAddonDirectory may return the project root
    // while the JAR lives under `src/`. Try both layouts.
    candidates.push(normalize(baseDir + "/" + relative.join("/")));
    candidates.push(normalize(baseDir + "/src/" + relative.join("/")));
  }
  candidates.push(
    normalize(".scaffold/build/addon/core/pdf/lib/opendataloader-pdf-cli.jar"),
    normalize("core/pdf/lib/opendataloader-pdf-cli.jar"),
  );

  for (const candidate of candidates) {
    try {
      let exists = false;
      if (typeof IOUtils !== "undefined" && IOUtils.exists) {
        exists = await IOUtils.exists(candidate);
      } else if (typeof Zotero.File !== "undefined" && Zotero.File.exists) {
        exists = await Zotero.File.exists(candidate);
      }
      log(
        `[Leadero ODL] getJarPath candidate: ${candidate} → ${exists ? "FOUND" : "not found"}`,
      );
      if (exists) return candidate;
    } catch (e) {
      safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
      log(`[Leadero ODL] getJarPath candidate: ${candidate} → ERROR`);
      // ignore and try next candidate
    }
  }

  // Last resort: return the relative path under baseDir and let the caller
  // surface the resulting file-not-found error.
  const fallback = normalize(
    baseDir
      ? `${baseDir}/${relative.join("/")}`
      : `./core/pdf/lib/opendataloader-pdf-cli.jar`,
  );
  log(`[Leadero ODL] getJarPath fallback: ${fallback}`);
  return fallback;
}

/**
 * Run an external process via nsIProcess.runwAsync + observer pattern.
 * Mirrors CodeExecutor.runProcess but simplified for single-shot Java calls.
 */
function runProcess(
  resolvedExe: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal, // M-20: cooperative cancellation
): Promise<ExecResult> {
  return new Promise((resolve) => {
    // Lifted to outer scope so the timeout callback can kill the process,
    // and the catch block can resolve safely.
    let proc: any = null;
    let settled = false;
    // M-20: detach the abort listener on every settle path so a never-fired
    // listener doesn't stay attached to a long-lived caller signal.
    let onAbort: (() => void) | null = null;
    const safeResolve = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      if (onAbort) {
        try {
          signal?.removeEventListener("abort", onAbort);
        } catch (e) {
          safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
          /* ignore */
        }
        onAbort = null;
      }
      resolve(result);
    };

    // M-20: already cancelled before spawn — don't even start the JVM.
    if (signal?.aborted) {
      resolve({
        exitCode: -1,
        stdout: "",
        stderr: "aborted",
        timedOut: false,
        aborted: true,
      });
      return;
    }

    try {
      const Cc = (Components as any).classes;
      const Ci = (Components as any).interfaces;
      const Services = (globalThis as any).Services as any;

      const isWindows = (
        Services.appinfo?.OS?.toUpperCase?.() ||
        (navigator as any)?.platform ||
        ""
      ).startsWith("WIN");

      // Temp files for stdout/stderr capture
      const tmpDir =
        (Zotero as any).getTempDirectory?.() ||
        Cc["@mozilla.org/file/directory-service;1"]
          .getService(Ci.nsProperties)
          .get("TmpD", Ci.nsIFile);

      const ts = Date.now();
      const makeFile = (suffix: string) => {
        const f = tmpDir.clone();
        f.append(`leadero-odl-${ts}-${suffix}.txt`);
        return f.path;
      };

      const stdoutPath = makeFile("out");
      const stderrPath = makeFile("err");

      let batPath: string | null = null;
      // L-28: hard-timeout handle, cleared whenever the run settles early.
      let hardTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const clearHardTimeout = () => {
        if (hardTimeoutId !== null) {
          clearTimeout(hardTimeoutId);
          hardTimeoutId = null;
        }
      };

      const cleanup = () => {
        clearHardTimeout();
        if (batPath) {
          try {
            const batFile = Cc["@mozilla.org/file/local;1"].createInstance(
              Ci.nsIFile,
            );
            batFile.initWithPath(batPath);
            if (batFile.exists()) batFile.remove(false);
          } catch (e) {
            safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
            /* ignore */
          }
          batPath = null;
        }
        // Also remove the stdout/stderr capture files — previously these leaked
        // on every jar invocation, accumulating in the temp dir over time.
        for (const p of [stdoutPath, stderrPath]) {
          try {
            const f = Cc["@mozilla.org/file/local;1"].createInstance(
              Ci.nsIFile,
            );
            f.initWithPath(p);
            if (f.exists()) f.remove(false);
          } catch (e) {
            safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
            /* ignore */
          }
        }
      };

      const finish = (timedOut: boolean, exitValue = 0) => {
        if (timedOut) {
          cleanup();
          safeResolve({
            exitCode: -1,
            stdout: "",
            stderr: "Process timed out",
            timedOut: true,
          });
          return;
        }

        let stdout = "";
        let stderr = "";
        try {
          const Z = (globalThis as any).Zotero;
          if (Z?.File?.getContents) {
            const outFile = Cc["@mozilla.org/file/local;1"].createInstance(
              Ci.nsIFile,
            );
            outFile.initWithPath(stdoutPath);
            if (outFile.exists()) stdout = Z.File.getContents(outFile) || "";

            const errFile = Cc["@mozilla.org/file/local;1"].createInstance(
              Ci.nsIFile,
            );
            errFile.initWithPath(stderrPath);
            if (errFile.exists()) stderr = Z.File.getContents(errFile) || "";
          }
        } catch (e) {
          safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
          // ignore read errors
        }

        cleanup();
        // H-1: propagate the REAL exit code. nsIProcess observers receive the
        // process as `subject`; its `exitValue` reflects the actual exit status
        // (on Windows, cmd /c forwards the batch child's exit code). Hard-coding
        // 0 here previously masked JVM crashes (OOM, UnsupportedClassVersion…)
        // as "success", deferring the failure to a misleading "no output found".
        safeResolve({ exitCode: exitValue, stdout, stderr, timedOut: false });
      };

      // Observer
      const observer = {
        observe: (subject: any, topic: string) => {
          if (topic === "process-finished") {
            finish(false, Number(subject?.exitValue ?? 0));
          } else {
            // process-failed
            cleanup();
            safeResolve({
              exitCode: -1,
              stdout: "",
              stderr: "Process failed to launch",
              timedOut: false,
            });
          }
        },
        QueryInterface: (iid: any) => {
          if (iid.equals(Ci.nsIObserver) || iid.equals(Ci.nsISupports))
            return observer;
          throw Components.results.NS_NOINTERFACE;
        },
      };

      if (isWindows) {
        const batContent = buildBatContent(
          resolvedExe,
          args,
          stdoutPath,
          stderrPath,
        );
        batPath = writeTempFile(batContent, "bat");

        const batFile = Cc["@mozilla.org/file/local;1"].createInstance(
          Ci.nsIFile,
        );
        batFile.initWithPath(batPath);
        proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
        proc.init(batFile);
        try {
          proc.startHidden = true;
        } catch (e) {
          safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
          /* older runtime */
        }
        proc.runwAsync([], 0, observer);
      } else {
        // Unix: shell wrapper with redirection
        const shPath = "/bin/sh";
        const cmd = buildUnixCommand(resolvedExe, args, stdoutPath, stderrPath);

        const shellFile = Cc["@mozilla.org/file/local;1"].createInstance(
          Ci.nsIFile,
        );
        shellFile.initWithPath(shPath);
        proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
        proc.init(shellFile);
        proc.runwAsync(["-c", cmd], 2, observer);
      }

      // Hard timeout: kill the process and resolve after timeoutMs.
      // Without proc.kill(), orphan JVMs accumulate when the process is
      // stuck or killed externally (OOM), wasting hundreds of MB each.
      // L-28: captured so finish()/failure paths can clearTimeout — a
      // settled promise kept the callback (and its proc/file closures)
      // alive until the full timeout elapsed.
      hardTimeoutId = setTimeout(() => {
        // M-19: await the tree-kill BEFORE resolving — the old fire-and-forget
        // kill let execJava's finally release the JVM semaphore while the
        // (orphaned) JVM was still alive, defeating the 2-slot limit.
        void (async () => {
          await killProcessTree(proc);
          cleanup();
          safeResolve({
            exitCode: -1,
            stdout: "",
            stderr: "Process timed out",
            timedOut: true,
          });
        })();
      }, timeoutMs);

      // M-20: cooperative cancellation — mirror the hard-timeout path (tree
      // kill + cleanup + resolve) when the caller's signal fires. The caller
      // (runOpenDataLoader) also post-checks signal.aborted as a backstop.
      if (signal) {
        onAbort = () => {
          void (async () => {
            await killProcessTree(proc);
            cleanup();
            safeResolve({
              exitCode: -1,
              stdout: "",
              stderr: "aborted",
              timedOut: false,
              aborted: true,
            });
          })();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    } catch (e: any) {
      safeResolve({
        exitCode: -1,
        stdout: "",
        stderr: toErrorMessage(e),
        timedOut: false,
      });
    }
  });
}

function buildBatContent(
  command: string,
  args: string[],
  stdoutPath: string,
  stderrPath: string,
): string {
  const q = (s: string) => `"${s}"`;
  let lines = "@echo off\r\n";
  lines += `${q(command)} ${args.map((a) => q(a)).join(" ")} > ${q(stdoutPath)} 2> ${q(stderrPath)}\r\n`;
  return lines;
}

function buildUnixCommand(
  command: string,
  args: string[],
  stdoutPath: string,
  stderrPath: string,
): string {
  const esc = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
  // M-19: `exec` makes sh REPLACE itself with the target process, so
  // proc.pid is the JVM itself and proc.kill() cannot orphan it (previously
  // kill only hit /bin/sh, leaving java.exe running with 200-400MB).
  return `exec ${esc(command)} ${args.map((a) => esc(a)).join(" ")} > ${esc(stdoutPath)} 2> ${esc(stderrPath)}`;
}

/**
 * M-19 (Windows half): nsIProcess.kill() only terminates the immediate child
 * (cmd.exe running the .bat), orphaning the JVM. taskkill /T /F takes down
 * the whole process tree. Best-effort — falls back to a plain kill().
 */
async function killProcessTree(proc: any): Promise<void> {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  try {
    if (!proc?.isRunning) return;
    const pid: number | undefined = proc.pid;
    const isWindows = Zotero.isWin;
    if (isWindows && pid) {
      const env = Cc["@mozilla.org/process/environment;1"]?.getService(
        Ci.nsIEnvironment,
      );
      const sysRoot = env?.get("SystemRoot") || "C:\\Windows";
      const taskkillPath = `${sysRoot}\\System32\\taskkill.exe`;
      const tkFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      tkFile.initWithPath(taskkillPath);
      if (!tkFile.exists()) {
        proc.kill();
        return;
      }
      const tkProc = Cc["@mozilla.org/process/util;1"].createInstance(
        Ci.nsIProcess,
      );
      tkProc.init(tkFile);
      await new Promise<void>((resolve) => {
        const obs = {
          observe: () => resolve(),
          QueryInterface: (iid: any) => {
            if (iid.equals(Ci.nsIObserver) || iid.equals(Ci.nsISupports))
              return obs;
            throw Components.results.NS_NOINTERFACE;
          },
        };
        try {
          tkProc.runwAsync(["/T", "/F", "/PID", String(pid)], 4, obs);
        } catch (e) {
          safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
          resolve();
        }
        // Never hang the timeout path on taskkill itself.
        setTimeout(resolve, 10_000);
      });
      return;
    }
    proc.kill();
  } catch (e) {
    safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
    try {
      proc.kill();
    } catch (e) {
      safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
      /* already dead */
    }
  }
}

function writeTempFile(content: string, ext: string): string {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;

  const tmpDir =
    (Zotero as any).getTempDirectory?.() ||
    Cc["@mozilla.org/file/directory-service;1"]
      .getService(Ci.nsIProperties)
      .get("TmpD", Ci.nsIFile);

  const file = tmpDir.clone();
  file.append(`leadero-odl-${Date.now()}.${ext}`);

  const stream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(
    Ci.nsIFileOutputStream,
  );
  stream.init(file, -1, -1, 0);
  const converter = Cc[
    "@mozilla.org/intl/converter-output-stream;1"
  ].createInstance(Ci.nsIConverterOutputStream);
  converter.init(stream, "UTF-8", 0, 0);
  converter.writeString(content);
  converter.close();

  return file.path;
}

function createTempDir(): string {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const tmpDir =
    (Zotero as any).getTempDirectory?.() ||
    Cc["@mozilla.org/file/directory-service;1"]
      .getService(Ci.nsIProperties)
      .get("TmpD", Ci.nsIFile);

  const dir = tmpDir.clone();
  dir.append(`leadero-odl-${Date.now()}`);
  dir.createUnique(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
  return dir.path;
}

function readFile(path: string): Promise<string> {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const Z = (globalThis as any).Zotero;

  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);

  if (Z?.File?.getContents) {
    return Promise.resolve(Z.File.getContents(file) || "");
  }

  return new Promise((resolve) => {
    const stream = Cc[
      "@mozilla.org/network/file-input-stream;1"
    ].createInstance(Ci.nsIFileInputStream);
    stream.init(file, -1, -1, 0);
    const converter = Cc[
      "@mozilla.org/intl/converter-input-stream;1"
    ].createInstance(Ci.nsIConverterInputStream);
    converter.init(stream, "UTF-8", 0, 0);
    const parts: string[] = [];
    let out: any;
    while (converter.readString(4096, (out = {}))) {
      parts.push(out.value);
    }
    converter.close();
    resolve(parts.join(""));
  });
}

function removePath(path: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const Cc = (Components as any).classes;
      const Ci = (Components as any).interfaces;
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(path);
      if (file.exists()) {
        file.remove(true);
      }
    } catch (e) {
      safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
      // best-effort
    }
    resolve();
  });
}

/**
 * Extract embedded base64 images from markdown.
 * Returns a map of filename → data:image/... URI.
 */
function extractImagesFromMarkdown(markdown: string): Record<string, string> {
  const images: Record<string, string> = {};

  // L-25: images with the same alt text used to overwrite each other (map is
  // keyed by filename, so only the last duplicate survived). De-dup by
  // appending -2/-3… suffixes. The markdown itself keeps inline data URIs, so
  // no body-text reference needs rewriting.
  const uniqueName = (base: string) => {
    let name = `${base}.png`;
    let n = 2;
    while (Object.prototype.hasOwnProperty.call(images, name)) {
      name = `${base}-${n++}.png`;
    }
    return name;
  };

  // Match Markdown image syntax: ![alt](data:image/png;base64,....)
  // Also match HTML <img src="data:image/..."> as fallback.
  const mdRegex =
    /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/g;
  let match;
  while ((match = mdRegex.exec(markdown)) !== null) {
    const alt = match[1] || `image-${Object.keys(images).length + 1}`;
    const dataUri = match[2];
    images[uniqueName(alt)] = dataUri;
  }

  // HTML img fallback
  const htmlRegex = /<img[^>]+src="(data:image\/[^"]+)"[^>]*>/g;
  while ((match = htmlRegex.exec(markdown)) !== null) {
    const dataUri = match[1];
    const base = `image-${Object.keys(images).length + 1}`;
    images[uniqueName(base)] = dataUri;
  }

  return images;
}

/**
 * Shared runner: invoke the OpenDataLoader JAR and return the raw output
 * string regardless of format.
 */
async function runOpenDataLoader(
  filePath: string,
  options?: OpenDataLoaderPdfParseOptions,
): Promise<{ success: true; raw: string } | { success: false; error: string }> {
  const jarPath = await getJarPath();
  log(`[Leadero ODL] runOpenDataLoader: jarPath="${jarPath}"`);
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const jarFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  try {
    jarFile.initWithPath(jarPath);
  } catch (e: any) {
    return {
      success: false,
      error: getString("pdf-jar-load-failed", {
        args: { path: jarPath, detail: e.message },
      }),
    };
  }
  const exists = jarFile.exists();
  log(`[Leadero ODL] runOpenDataLoader: jarFile.exists() = ${exists}`);
  if (!exists) {
    return {
      success: false,
      error: `JAR file not found at ${jarPath}. Please ensure opendataloader-pdf-cli.jar is present.`,
    };
  }

  const config = loadConfig();
  const outputDir = createTempDir();

  try {
    if (options?.signal?.aborted) {
      return { success: false, error: "OpenDataLoader parsing aborted" };
    }

    const format = options?.format ?? "json";
    const args: string[] = [
      "--format",
      format,
      "--output-dir",
      outputDir,
      "--reading-order",
      config.readingOrder,
      "--table-method",
      config.tableMethod,
      // Control raster image embedding. "embedded" puts base64 data URIs in the
      // JSON so the translate pipeline can composite figures back; "off" skips
      // them (the default — the heuristic engine emits no image elements).
      "--image-output",
      // Caller can override the pref-derived default (e.g. the translate
      // pipeline always wants "embedded" so figures are recovered).
      options?.imageOutput ?? config.imageOutput,
    ];

    if (config.useStructTree) {
      args.push("--use-struct-tree");
    }

    if (options?.startPage != null || options?.endPage != null) {
      const start = options?.startPage ?? 1;
      const end = options?.endPage ?? start;
      // L-26: an inverted range used to fall through silently and parse the
      // WHOLE document while the caller believed it got a page slice.
      if (end < start) {
        return {
          success: false,
          error: `Invalid page range: start (${start}) > end (${end})`,
        };
      }
      args.push("--pages", `${start}-${end}`);
    }

    args.push(filePath);

    safeDebug(
      `[Leadero ODL] spawning JVM: java -jar "${jarPath}" ${args.map((a) => JSON.stringify(a)).join(" ")}`,
    );

    const result = await execJava(args, config.timeout * 1000, options?.signal); // M-20

    safeDebug(
      `[Leadero ODL] JVM exited: code=${result.exitCode} timedOut=${result.timedOut} aborted=${result.aborted || false}`,
    );
    if (result.stderr) {
      log(`[Leadero ODL] JVM stderr: ${result.stderr.slice(0, 2000)}`);
    }
    if (result.stdout) {
      log(`[Leadero ODL] JVM stdout: ${result.stdout.slice(0, 2000)}`);
    }

    if (options?.signal?.aborted) {
      return { success: false, error: "OpenDataLoader parsing aborted" };
    }

    if (result.timedOut) {
      return { success: false, error: `Parse timed out (${config.timeout}s)` };
    }

    if (result.exitCode !== 0) {
      const errorMsg =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `java exited with code ${result.exitCode}`;
      return { success: false, error: errorMsg };
    }

    const inputBaseName =
      filePath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") || "document";
    const ext = format === "markdown" ? ".md" : ".json";
    // outputDir 来自 nsIFile.path（Windows 原生反斜杠）；字符串拼 "/" 会造出
    // mixed-slash 路径，nsIFile.initWithPath 直接拒（NS_ERROR_FILE_UNRECOGNIZED_PATH，
    // M-22 同类教训）。必须用 PathUtils.join 保持平台分隔符。
    const outputPath = PathUtils.join(outputDir, `${inputBaseName}${ext}`);

    let raw: string;
    try {
      raw = await readFile(outputPath);
    } catch (e) {
      safeDebug("[z-search] OpenDataLoaderPdfClient: " + e);
      const dirFile = Cc["@mozilla.org/file/local;1"].createInstance(
        Ci.nsIFile,
      );
      dirFile.initWithPath(outputDir);
      const entries = dirFile.directoryEntries;
      let found = "";
      while (entries.hasMoreElements()) {
        const entry = entries.getNext().QueryInterface(Ci.nsIFile);
        if (entry.leafName.endsWith(ext)) {
          found = entry.path;
          break;
        }
      }
      if (!found) {
        // List all files in the output dir for diagnosis.
        const allFiles: string[] = [];
        while (entries.hasMoreElements()) {
          const entry = entries.getNext().QueryInterface(Ci.nsIFile);
          allFiles.push(entry.leafName);
        }
        safeDebug(
          `[Leadero ODL] no ${ext} in ${outputDir}; files: ${allFiles.join(", ") || "(empty)"}`,
        );
        return {
          success: false,
          error: `No ${ext} output found in ${outputDir}`,
        };
      }
      log(`[Leadero ODL] using alternate output: ${found}`);
      raw = await readFile(found);
    }

    if (!raw || !raw.trim()) {
      return { success: false, error: `Conversion produced no ${ext} output` };
    }

    log(`[Leadero ODL] parse succeeded: ${raw.length} chars`);

    return { success: true, raw };
  } finally {
    await removePath(outputDir);
  }
}

/**
 * Parse a PDF to structured JSON via OpenDataLoader.
 */
export async function parsePdfToJson(
  filePath: string,
  options?: OpenDataLoaderPdfParseOptions,
): Promise<OpenDataLoaderJsonParseResult> {
  const runResult = await runOpenDataLoader(filePath, options);

  if (!runResult.success) {
    return {
      success: false,
      data: null,
      source: "opendataloader-pdf",
      error: runResult.error,
    };
  }

  try {
    return {
      success: true,
      data: JSON.parse(runResult.raw),
      source: "opendataloader-pdf",
    };
  } catch (e: any) {
    return {
      success: false,
      data: null,
      source: "opendataloader-pdf",
      error: `Failed to parse JSON output: ${e.message}`,
    };
  }
}

/**
 * Parse a PDF to Markdown via OpenDataLoader.
 */
export async function parsePdfToMarkdown(
  filePath: string,
  options?: OpenDataLoaderPdfParseOptions,
): Promise<OpenDataLoaderPdfParseResult> {
  const runResult = await runOpenDataLoader(filePath, {
    ...options,
    format: "markdown",
  });

  if (!runResult.success) {
    return {
      success: false,
      markdown: "",
      images: {},
      source: "opendataloader-pdf",
      error: runResult.error,
    };
  }

  const images = extractImagesFromMarkdown(runResult.raw);

  return {
    success: true,
    markdown: runResult.raw,
    images,
    source: "opendataloader-pdf",
  };
}
