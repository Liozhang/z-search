/**
 * Runtime loader for externalized data JSON files.
 *
 * Replaces the previous pattern of importing large data arrays directly from
 * `src/core/data/*-data.ts` modules (which esbuild bundled into the main
 * zsearch.js). Those four data sets (~8.6 MB of TS literals → ~5.2 MB of
 * JSON) now ship as `addon/data/*.json` and are read on first import only.
 *
 * Path resolution (2026-10-13 重写)：`rootURI`（bootstrap 注入的插件根）在
 * 不同安装形态下的值不同，而宿主 `Zotero.File.getContentsAsync` 对字符串
 * 只认 `file:` 前缀（转成本地路径走 IOUtils）；其余任何带协议的字符串
 * （`jar:`/`resource:`）都会被转交 `Zotero.HTTP.request`（XHR）——jar: 经
 * XHR 立即失败。这曾使打包 xpi 安装的内置数据集四阶段全部在读文件时
 * 瞬间失败（dev 的 file: 根不受影响，故实机探针从未暴露）。这里按形态
 * 分层读取，不再依赖那个未声明的行为：
 *
 *   1. `file:` 根（dev 未打包目录 / 解压安装）→ 解析为本地路径，IOUtils 直读；
 *   2. `resource:` 根（Zotero 9/10 的资源映射）→ 经 nsIResProtocolHandler
 *      换算成实际 `file:`/`jar:` spec 后落到 1 或 3；
 *   3. `jar:` 根（打包 xpi 安装）→ 从 spec 提取 xpi 路径，nsIZipReader 直读
 *      包内 entry（流交给宿主 getContentsAsync 的流分支，走 NetUtil）；
 *   4. 兜底：XHR（宿主对 URI 输入的既有去向，保留为最后手段并带错误详情）。
 *
 * Files are written once at build time by `scripts/export-data-json.cjs`.
 */

/** Envelope shared by cass-2025.json / jcr-2024.json / warning.json. */
export interface YearedDataFile<T = unknown> {
  year: number;
  data: T[];
}

/** Envelope for warning.json (no year field). */
export interface WarningDataFile {
  data: (string | number | null)[][];
}

/** Envelope for bealls.json. */
export interface BeallsDataFile {
  standalone: (string | null)[][];
  publishers: (string | null)[][];
  hijacked: (string | null)[][];
  misleading: (string | null)[][];
}

const loadedFiles = new Map<string, unknown>();

/**
 * Read and JSON.parse a file under `addon/data/`.
 *
 * Results are memoized for the lifetime of the process — the underlying JSON
 * never changes between releases, so re-reading on every call would be wasted
 * work. Callers receive the same object reference on subsequent calls. 失败
 * 不缓存：下次导入（如期刊页「立即导入」）仍会重试。
 */
export async function loadDataFile<T>(filename: string): Promise<T> {
  const cached = loadedFiles.get(filename);
  if (cached !== undefined) {
    return cached as T;
  }

  const text = await readAddonFileText(`data/${filename}`);
  const parsed = JSON.parse(text) as T;
  loadedFiles.set(filename, parsed);
  return parsed;
}

/** 读取插件安装根下的相对路径文本文件，按 rootURI 形态分层（见模块头注）。 */
async function readAddonFileText(relPath: string): Promise<string> {
  const root = typeof rootURI === "string" ? rootURI : "";
  if (!root) {
    throw new Error(
      `Failed to read ${relPath}: rootURI is unavailable outside the plugin runtime`,
    );
  }

  const Cc = (Components as any).classes;
  const Ci = (Components as any).interfaces;
  const ServicesIo = (globalThis as any).Services?.io;

  try {
    // 1) file: 根 → 本地目录直读（dev 未打包目录与解压安装）
    if (root.startsWith("file:")) {
      const dir = ServicesIo.newURI(root).QueryInterface(Ci.nsIFileURL).file
        .path as string;
      return await IOUtils.readUTF8(PathUtils.join(dir, ...relPath.split("/")));
    }

    // 2) resource: 根（Zotero 9/10 资源映射）→ 换算实际 spec 后走 1 或 3
    let spec = root;
    if (spec.startsWith("resource:")) {
      const rph = ServicesIo.getProtocolHandler("resource").QueryInterface(
        Ci.nsIResProtocolHandler,
      ) as {
        resolveURI: (uri: unknown) => string | null;
      };
      spec = rph.resolveURI(ServicesIo.newURI(spec)) || spec;
    }

    // 3) jar: 根（打包 xpi 安装）→ nsIZipReader 直读包内 entry
    const jarMatch = /^(jar:(file:[^!]+)!\/?)/.exec(
      spec.startsWith("jar:") ? spec : root,
    );
    if (jarMatch) {
      const xpiPath = ServicesIo.newURI(jarMatch[2]).QueryInterface(
        Ci.nsIFileURL,
      ).file.path as string;
      const zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
        Ci.nsIZipReader,
      ) as {
        open: (file: unknown) => void;
        getInputStream: (entry: string) => unknown;
        close: () => void;
      };
      zipReader.open(Zotero.File.pathToFile(xpiPath));
      try {
        const stream = zipReader.getInputStream(relPath) as unknown;
        try {
          // 传流给宿主 → 走 NetUtil.asyncFetch 分支（nsIInputStream 受支持）
          return (await Zotero.File.getContentsAsync(stream as any)) as string;
        } finally {
          (stream as any)?.close?.();
        }
      } finally {
        zipReader.close();
      }
    }

    // 4) 兜底：XHR（宿主对 URI 字符串的既有去向；resource:/file: 在特权
    // 上下文可行，jar: 不保证——因此只作为最后手段保留）
    const resp = (await Zotero.HTTP.request("GET", `${root}${relPath}`, {
      responseType: "text",
    })) as { response?: unknown };
    if (typeof resp.response !== "string") {
      throw new Error("non-text response");
    }
    return resp.response;
  } catch (e) {
    // 统一附上读取目标与 rootURI 形态——失败详情经导入 stage 的 detail
    // 透出到期刊页横幅，是定位安装形态问题的关键线索。
    throw new Error(
      `Failed to read ${relPath} from addon root (${root.slice(0, 80)}): ${String(
        (e as any)?.message ?? e,
      )}`,
      { cause: e },
    );
  }
}
