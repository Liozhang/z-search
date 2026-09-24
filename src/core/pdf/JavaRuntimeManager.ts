/**
 * JavaRuntimeManager — Manages a bundled Java JRE for OpenDataLoader.
 *
 * When the user's machine has no Java 11+, this downloads an Eclipse Temurin
 * **portable JRE** (not an installer — a .zip on Windows, .tar.gz on
 * macOS/Linux) from Adoptium, extracts it under {DataDir}/leadero/java-runtime/,
 * and exposes the absolute path to its `java` executable. Because it's a
 * portable package extracted into the user's own data directory, it needs no
 * administrator privileges, no UAC elevation, and no system PATH modification —
 * and crucially no Zotero restart: the caller resolves `java` afresh on each
 * invocation, so a freshly-extracted JRE is picked up immediately.
 *
 * Pattern is ported from earlier standalone binary-download logic, adapted for:
 *   - cross-platform (Win + macOS + Linux), not Windows-only
 *   - Adoptium's binary API instead of GitHub Releases
 *   - .tar.gz on Unix (zip handling differs from the legacy Python manager)
 *
 * Adoptium API (verified):
 *   GET https://api.adoptium.net/v3/binary/latest/{feature}/ga/{os}/{arch}/jre/hotspot/normal/eclipse
 *   → 307 → GitHub release asset (e.g. OpenJDK17U-jre_x64_windows_hotspot_17.0.x_x.zip)
 *
 * @module core/pdf/JavaRuntimeManager
 */

import { safeDebug } from "../../utils/logger";
import { getString } from "../../utils/locale";

export interface JavaStatus {
  /** A usable java executable path was resolved (managed JRE or system). */
  ready: boolean;
  version?: string;
  path?: string;
  /** True when the resolved java is the plugin-managed JRE. */
  managed?: boolean;
  error?: string;
}

export interface DownloadProgress {
  /** 0–100 during download; indeterminate phases leave percent unchanged. */
  percent: number;
  phase: "querying" | "downloading" | "extracting" | "verifying" | "done";
  message?: string;
}
export type ProgressCallback = (p: DownloadProgress) => void;

function isWindows(): boolean {
  if (Zotero.isWin) return true;
  if (Zotero.platform === "win32" || Zotero.platform === "win") return true;
  try {
    const appinfo = (Components as any).classes[
      "@mozilla.org/xre/app-info;1"
    ]?.getService?.((Components as any).interfaces?.nsIXULRuntime);
    if (appinfo?.OS === "WINNT") return true;
  } catch (e) {
    safeDebug("[z-search] JavaRuntimeManager: " + e);
    /* ignore */
  }
  return false;
}

function isMac(): boolean {
  if (Zotero.isMac) return true;
  if (Zotero.platform === "macosx" || Zotero.platform === "mac") return true;
  return false;
}

/** Apple Silicon (arm64) vs Intel (x64) on macOS. */
function isMacArm64(): boolean {
  try {
    const sysinfo = (Components as any).classes[
      "@mozilla.org/system-info;1"
    ]?.getService?.((Components as any).interfaces?.nsIPropertyBag2);
    // macOS machine model / arch hints
    const arch = (sysinfo?.get?.("arch") as string) || "";
    if (/aarch64|arm64/i.test(arch)) return true;
  } catch (e) {
    safeDebug("[z-search] JavaRuntimeManager: " + e);
    /* ignore */
  }
  // Fallback: Zotero 7+ may expose isARM
  if ((Zotero as any).isARM) return true;
  return false;
}

function getDataDir(): string {
  return (Zotero as any).DataDirectory?.dir as string;
}

function pathJoin(...parts: string[]): string {
  const { join } = (globalThis as any).PathUtils || {};
  if (join) return join(...parts);
  return parts
    .join(isWindows() ? "\\" : "/")
    .replace(/[/\\]+/g, (_m) => (isWindows() ? "\\" : "/"));
}

/** Managed JRE root: {DataDir}/leadero/java-runtime/ */
export function getJavaRuntimeDir(): string {
  return pathJoin(getDataDir(), "zsearch", "java-runtime");
}

/**
 * Resolve the `java` executable inside the managed JRE dir.
 *
 * Adoptium extracts to a versioned subdir (e.g. `jdk-17.0.19+10-jre/`), so the
 * actual java lives at {runtime-dir}/{jdk-*-jre}/bin/java(.exe). We scan
 * children rather than hard-coding the version. Returns null if not found.
 *
 * A successful resolution is cached in `managedExeCache` so the synchronous
 * resolver in OpenDataLoaderPdfClient can use it without async IO.
 */
let managedExeCache: string | null = null;

/**
 * Synchronous peek at the cached managed-JRE path. Returns null if no managed
 * JRE has been resolved yet (call getManagedJavaExe() async first to populate).
 * Exists so OpenDataLoaderPdfClient.resolveJavaExecutable (which must stay
 * sync) can prefer the managed JRE without async IO.
 */
export function getCachedManagedJavaExe(): string | null {
  return managedExeCache;
}

export async function getManagedJavaExe(): Promise<string | null> {
  if (managedExeCache && (await pathExists(managedExeCache))) {
    return managedExeCache;
  }
  managedExeCache = null;

  const IOUtils = (globalThis as any).IOUtils;
  const dir = getJavaRuntimeDir();
  if (!(await pathExists(dir))) return null;

  const binName = isWindows() ? "java.exe" : "java";
  try {
    const children = await IOUtils.getChildren(dir);
    // Look for a jdk-* (or jre-*) top-level folder containing bin/java.
    for (const child of children) {
      const name = basename(child);
      if (!/^jdk-/i.test(name) && !/^jre-/i.test(name)) continue;
      const candidate = pathJoin(child, "bin", binName);
      if (await pathExists(candidate)) {
        managedExeCache = candidate;
        return candidate;
      }
    }
  } catch (e) {
    safeDebug("[z-search] JavaRuntimeManager: " + e);
    /* ignore — fall through */
  }
  return null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    return await (globalThis as any).IOUtils.exists(p);
  } catch (e) {
    safeDebug("[z-search] JavaRuntimeManager: " + e);
    return false;
  }
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

// ─── nsIProcess execution ──

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run a command capturing stdout/stderr via temp-file redirection.
 * nsIProcess has no pipes, so we redirect to files and read them back.
 */
async function execCommand(
  exePath: string,
  args: string[],
  opts: { timeout?: number } = {},
): Promise<ExecResult> {
  const isWin = isWindows();
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const timeout = opts.timeout ?? 120000;
  const IOUtils = (globalThis as any).IOUtils;

  const tmpDir = (Zotero as any).getTempDirectory();
  const ts = Date.now();
  const stdoutFile = tmpDir.clone();
  stdoutFile.append(`leadero-jre-${ts}-out.txt`);
  const stderrFile = tmpDir.clone();
  stderrFile.append(`leadero-jre-${ts}-err.txt`);

  let wrapperExe: string;
  let wrapperArgs: string[];

  if (isWin) {
    const batLines = [
      `@"${exePath}" ${args.map((a) => `"${a}"`).join(" ")}`,
      `> "${stdoutFile.path}" 2> "${stderrFile.path}"`,
    ].join(" ");
    const batFile = tmpDir.clone();
    batFile.append(`leadero-jre-${ts}.bat`);
    await IOUtils.writeUTF8(batFile.path, batLines);
    wrapperExe = batFile.path;
    wrapperArgs = [];
    try {
      const batNs = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      batNs.initWithPath(wrapperExe);
      const proc0 = Cc["@mozilla.org/process/util;1"].createInstance(
        Ci.nsIProcess,
      );
      proc0.init(batNs);
      // Run bat synchronously-blocking isn't needed; we hand the bat path to
      // the unified promise runner below. But nsIProcess can run .bat directly.
      return runProcessWithObserver(proc0, wrapperArgs, {
        timeout,
        stdoutFile,
        stderrFile,
        cleanupPaths: [batFile.path],
      });
    } catch (e) {
      throw new Error(`Failed to launch extraction: ${e}`, { cause: e });
    }
  } else {
    const cmd = `"${exePath}" ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")} > '${stdoutFile.path}' 2> '${stderrFile.path}'`;
    wrapperExe = "/bin/sh";
    wrapperArgs = ["-c", cmd];
    const shFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    shFile.initWithPath(wrapperExe);
    const proc = Cc["@mozilla.org/process/util;1"].createInstance(
      Ci.nsIProcess,
    );
    proc.init(shFile);
    return runProcessWithObserver(proc, wrapperArgs, {
      timeout,
      stdoutFile,
      stderrFile,
    });
  }
}

// M-19: nsIProcess.kill() only terminates the direct child (.bat host on
// Windows, /bin/sh on Unix). The real JVM becomes an orphan and keeps
// running. Use taskkill /T /F on Windows to take down the whole tree;
// on other platforms fall back to plain kill().
async function killProcessTree(proc: any): Promise<void> {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  try {
    if (!proc?.isRunning) return;
    const pid: number | undefined = proc.pid;
    const isWin = isWindows();
    if (isWin && pid) {
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
            throw (Components as any).results.NS_NOINTERFACE;
          },
        };
        try {
          tkProc.runwAsync(["/T", "/F", "/PID", String(pid)], 4, obs);
        } catch (e) {
          safeDebug("[z-search] JavaRuntimeManager: " + e);
          resolve();
        }
        setTimeout(resolve, 10_000);
      });
      return;
    }
    proc.kill();
  } catch (e) {
    safeDebug("[z-search] JavaRuntimeManager: " + e);
    try {
      proc.kill();
    } catch (e) {
      safeDebug("[z-search] JavaRuntimeManager: " + e); /* already dead */
    }
  }
}

/** Shared promise runner for an already-init'd nsIProcess. */
function runProcessWithObserver(
  proc: any,
  args: string[],
  ctx: {
    timeout: number;
    stdoutFile: any;
    stderrFile: any;
    cleanupPaths?: string[];
  },
): Promise<ExecResult> {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const IOUtils = (globalThis as any).IOUtils;
  const { timeout, stdoutFile, stderrFile, cleanupPaths } = ctx;

  return new Promise<ExecResult>((resolve) => {
    let settled = false;
    const finish = (result: Partial<ExecResult>) => {
      if (settled) return;
      settled = true;
      Promise.all([
        IOUtils.readUTF8(stdoutFile.path).catch(() => ""),
        IOUtils.readUTF8(stderrFile.path).catch(() => ""),
      ]).then(([stdout, stderr]) => {
        for (const p of cleanupPaths || []) {
          IOUtils.remove(p).catch((e: any) => {
            safeDebug(
              "[z-search] JavaRuntimeManager: temp cleanup failed: " + e,
            );
          });
        }
        IOUtils.remove(stdoutFile.path).catch((e: any) => {
          safeDebug("[z-search] JavaRuntimeManager: temp cleanup failed: " + e);
        });
        IOUtils.remove(stderrFile.path).catch((e: any) => {
          safeDebug("[z-search] JavaRuntimeManager: temp cleanup failed: " + e);
        });
        resolve({
          exitCode: result.exitCode ?? -1,
          stdout: stdout || "",
          stderr: stderr || "",
          timedOut: result.timedOut ?? false,
        });
      });
    };

    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(
      {
        notify: () => {
          if (proc.isRunning) {
            // M-19: nsIProcess.kill() only terminates the direct child (.bat
            // host on Windows, /bin/sh on Unix). Use tree-kill so the real
            // JVM doesn't survive as an orphan.
            void (async () => {
              await killProcessTree(proc);
              finish({ exitCode: -1, timedOut: true });
            })();
          }
        },
      },
      timeout,
      Ci.nsITimer.TYPE_ONE_SHOT,
    );

    const observer = {
      observe: (_subject: any, topic: string) => {
        if (topic === "process-finished" || topic === "process-failed") {
          timer.cancel();
          finish({ exitCode: proc.exitValue });
        }
      },
      QueryInterface: (iid: any) => {
        if (iid.equals(Ci.nsIObserver) || iid.equals(Ci.nsISupports))
          return observer;
        throw (Components as any).results.NS_NOINTERFACE;
      },
    };
    proc.runwAsync(args, args.length, observer);
  });
}

interface AdoptiumAsset {
  url: string;
  filename: string;
  /** "zip" or "tar.gz" — drives the extraction command. */
  archive: "zip" | "tar.gz";
}

/**
 * Build the Adoptium binary download URL for the current platform/arch.
 * The API responds 307 → the actual GitHub release asset.
 */
function resolveAdoptiumAsset(featureVersion: number): AdoptiumAsset {
  let os: string;
  let arch: string;
  let archive: "zip" | "tar.gz";

  if (isWindows()) {
    os = "windows";
    arch = "x64";
    archive = "zip";
  } else if (isMac()) {
    os = "mac";
    arch = isMacArm64() ? "aarch64" : "x64";
    archive = "tar.gz";
  } else {
    os = "linux";
    arch = "x64";
    archive = "tar.gz";
  }

  const url = `https://api.adoptium.net/v3/binary/latest/${featureVersion}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
  // Filename is best-effort (only used for logging); the server sets it.
  const filename = `temurin-${featureVersion}-jre-${os}-${arch}.${archive}`;
  return { url, filename, archive };
}

/**
 * Extract a downloaded JRE archive into the managed runtime dir.
 * Windows zip → tar.exe (Win10 1803+), fallback PowerShell Expand-Archive.
 * Unix tar.gz → /usr/bin/tar -xzf.
 */
async function extractArchive(
  archivePath: string,
  destDir: string,
  archive: "zip" | "tar.gz",
): Promise<void> {
  const isWin = isWindows();

  // Ensure dest exists. IOUtils' MakeDirectoryOptions only knows
  // `createAncestors`; `recursive`/`createParents` are OS.File-era names that
  // the WebIDL dictionary conversion silently drops, so ancestors were never
  // actually created.
  await (globalThis as any).IOUtils.makeDirectory(destDir, {
    createAncestors: true,
  });

  if (isWin) {
    // tar handles .zip on Windows 10 1803+.
    const tarResult = await execCommand(
      "C:\\Windows\\System32\\tar.exe",
      ["-xf", archivePath, "-C", destDir],
      { timeout: 300000 },
    );
    if (tarResult.exitCode === 0) return;

    // Fallback: PowerShell Expand-Archive.
    const psResult = await execCommand(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`,
      ],
      { timeout: 300000 },
    );
    if (psResult.exitCode !== 0) {
      throw new Error(
        getString("pdf-java-unzip-failed", {
          args: {
            detail: psResult.stderr || tarResult.stderr || "unknown error",
          },
        }),
      );
    }
    return;
  }

  // Unix: tar -xzf works for .tar.gz (and -xf auto-detects on modern tar).
  const flag = archive === "tar.gz" ? "-xzf" : "-xf";
  const result = await execCommand(
    "/usr/bin/tar",
    [flag, archivePath, "-C", destDir],
    {
      timeout: 300000,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      getString("pdf-java-unzip-failed", {
        args: { detail: result.stderr || "unknown error" },
      }),
    );
  }
}

/**
 * Download and extract a portable Temurin JRE. Returns the absolute path to
 * the extracted `java` executable. Idempotent: if a managed JRE already
 * resolves, returns its path without re-downloading.
 */
export async function downloadJRE(
  featureVersion: number = 17,
  onProgress?: ProgressCallback,
): Promise<string> {
  // Fast path: already installed.
  const existing = await getManagedJavaExe();
  if (existing) {
    onProgress?.({ percent: 100, phase: "done", message: "already installed" });
    return existing;
  }

  const IOUtils = (globalThis as any).IOUtils;
  const asset = resolveAdoptiumAsset(featureVersion);
  const runtimeDir = getJavaRuntimeDir();

  // Temp archive path next to the runtime dir.
  const tmpArchive = pathJoin(
    getDataDir(),
    "zsearch",
    `java-runtime.tmp.${asset.archive.split(".").pop()}`,
  );

  onProgress?.({ percent: 0, phase: "querying", message: asset.url });

  // Download (XHR follows the 307 redirect to GitHub automatically).
  onProgress?.({
    percent: 0,
    phase: "downloading",
    message: getString("pdf-java-downloading", {
      args: {
        version: String(featureVersion),
        archive: asset.archive,
      },
    }),
  });

  let response: any;
  try {
    response = await (Zotero as any).HTTP.request("GET", asset.url, {
      responseType: "arraybuffer",
      timeout: 600000, // 10 min for ~40-50MB
      requestObserver: (xhr: XMLHttpRequest) => {
        xhr.addEventListener("progress", (e: ProgressEvent) => {
          if (e.lengthComputable && e.total > 0) {
            const percent = Math.round((e.loaded / e.total) * 100);
            onProgress?.({
              percent,
              phase: "downloading",
              message: getString("pdf-java-downloading-percent", {
                args: { percent: String(percent) },
              }),
            });
          }
        });
      },
    } as any);
  } catch (e: any) {
    throw new Error(
      getString("pdf-java-download-failed", {
        args: { detail: e?.message || String(e) },
      }),
      { cause: e },
    );
  }

  if (response.status !== 200 || !response.response) {
    throw new Error(
      getString("pdf-java-download-failed", {
        args: { detail: `HTTP ${response.status}` },
      }),
    );
  }

  await IOUtils.write(tmpArchive, new Uint8Array(response.response));

  onProgress?.({
    percent: 100,
    phase: "extracting",
    message: getString("pdf-java-extracting"),
  });
  try {
    await extractArchive(tmpArchive, runtimeDir, asset.archive);
  } finally {
    try {
      await IOUtils.remove(tmpArchive);
    } catch (e) {
      safeDebug("[z-search] JavaRuntimeManager: " + e);
      /* best-effort */
    }
  }

  // Verify and locate the java executable.
  onProgress?.({
    percent: 100,
    phase: "verifying",
    message: getString("pdf-java-verifying"),
  });
  const javaExe = await getManagedJavaExe();
  if (!javaExe) {
    throw new Error(
      getString("pdf-java-not-found-after-unzip", {
        args: { dir: runtimeDir, url: "https://adoptium.net" },
      }),
    );
  }

  // Sanity-check it actually runs.
  const probe = await execCommand(javaExe, ["-version"], { timeout: 30000 });
  if (probe.exitCode !== 0) {
    throw new Error(
      getString("pdf-java-unrunnable", {
        args: { detail: probe.stderr || "java -version failed" },
      }),
    );
  }

  onProgress?.({
    percent: 100,
    phase: "done",
    message: getString("pdf-java-done"),
  });
  return javaExe;
}

/**
 * Search system PATH for a `java` executable (does NOT check managed JRE).
 * Mirrors the PATH-search logic in OpenDataLoaderPdfClient.resolveJavaExecutable
 * so getJavaStatus() can fall back without importing that module.
 */
function findSystemJava(): string | null {
  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const Services = (globalThis as any).Services as any;

  const isWindows = (
    Services.appinfo?.OS?.toUpperCase?.() ||
    (navigator as any)?.platform ||
    ""
  ).startsWith("WIN");
  const extensions = isWindows ? [".exe", ".cmd", ".bat", ""] : [""];
  const separator = isWindows ? ";" : ":";

  const env = Cc["@mozilla.org/process/environment;1"]?.getService?.(
    Ci.nsIEnvironment,
  );
  const pathStr = env?.get("PATH") || "";

  const createFile = (p: string) => {
    try {
      const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      f.initWithPath(p);
      return f;
    } catch (e) {
      safeDebug("[z-search] JavaRuntimeManager: " + e);
      return null;
    }
  };

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

/**
 * Resolve a usable java, preferring the managed JRE. Returns a status object
 * suitable for UI display.
 */
export async function getJavaStatus(): Promise<JavaStatus> {
  const managed = await getManagedJavaExe();
  if (managed) {
    const probe = await execCommand(managed, ["-version"], { timeout: 15000 });
    if (probe.exitCode === 0) {
      const vMatch = probe.stderr.match(/version "([^"]+)"/);
      return {
        ready: true,
        version: vMatch ? vMatch[1] : undefined,
        path: managed,
        managed: true,
      };
    }
  }
  // System PATH fallback (avoids circular import of OpenDataLoaderPdfClient).
  const systemJava = findSystemJava();
  if (systemJava) {
    const probe = await execCommand(systemJava, ["-version"], {
      timeout: 10000,
    });
    if (probe.exitCode === 0) {
      const vMatch =
        probe.stderr.match(/version "([^"]+)"/) ||
        probe.stderr.match(/Java\(TM\) SE Runtime Environment.*"([^"]+)"/);
      return {
        ready: true,
        version: vMatch ? vMatch[1] : undefined,
        path: systemJava,
        managed: false,
      };
    }
  }

  return {
    ready: false,
    error:
      "Java runtime not found. Please install Java 11+ and add it to PATH.",
  };
}

const JavaRuntimeManager = {
  getJavaRuntimeDir,
  getManagedJavaExe,
  downloadJRE,
  getJavaStatus,
};
export default JavaRuntimeManager;
