/**
 * ModelDownloadManager — 为本地嵌入模型补齐文件下载通道。
 *
 * 背景：embedFrameLogic 强制 `allowRemoteModels = false`（iframe 内 file://
 * 直读本地盘），模型文件必须预先躺在 {DataDir}/zsearch/models 下，但本仓库
 * 既不随包分发模型（体积原因，与 opendataloader jar 同一决策），此前也没有
 * 任何下载器——全新安装的向量功能实际不可用（2026-10-04 修复）。
 *
 * 本模块补上缺失的一环：首次使用时按 transformers.js 的 localModelPath 布局
 * 把模型文件取回本地。默认源 huggingface.co；声明中国大陆区域时默认走
 * hf-mirror.com（与维基域名同一「覆盖 > 按区域推导 > 内置」求值序）；
 * `embedding.local.mirror` 可填自建代理（设置 ▸ 区域限定端点）。
 *
 * 纯函数（文件清单 / URL 拼装 / 模型名校验 / 区域默认）单独导出供 vitest
 * 直接测试——与 embedFrameLogic 同一模式；IO 编排仅在插件运行时执行。
 *
 * @module core/embedding/ModelDownloadManager
 */

import { getPrefDynamic } from "../../utils/prefs";
import { getNetworkRegion, type NetworkRegion } from "../../utils/region";
import { getString } from "../../utils/locale";
import { safeDebug } from "../../utils/logger";

/** 官方模型源。 */
export const DEFAULT_MODEL_ENDPOINT = "https://huggingface.co";
/** 中国大陆区域的可达镜像（hf-mirror.com 是 huggingface.co 的只读镜像）。 */
export const CN_MODEL_ENDPOINT = "https://hf-mirror.com";

/** dtype q8 管线必需的文件（缺失任一即视为未下载完整）。 */
const REQUIRED_MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "onnx/model_quantized.onnx",
] as const;

/** 可选文件：取不到（404）不阻塞——部分模型仓库没有这些文件。 */
const OPTIONAL_MODEL_FILES = [
  "tokenizer_config.json",
  "special_tokens_map.json",
] as const;

/**
 * 校验模型标识。HuggingFace 模型 id 是 org/repo 两段；只放行安全字符，
 * 显式挡住 `..` 等路径穿越——模型名会拼进本地路径与 URL。
 *
 * @returns 合法时返回去掉首尾空白的原值；非法返回 null。
 */
export function sanitizeModelId(modelName: string): string | null {
  const v = String(modelName ?? "").trim();
  const seg = "[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?";
  return new RegExp(`^${seg}(?:/${seg})?$`).test(v) ? v : null;
}

/** 模型在磁盘上的根目录：{DataDir}/zsearch/models。 */
export function getModelRootDir(): string {
  return PathUtils.join(Zotero.DataDirectory.dir, "zsearch", "models");
}

/** 单个模型的目录：{root}/{org}/{repo}（与 transformers localModelPath 布局一致）。 */
export function getModelDir(modelName: string): string {
  return PathUtils.join(getModelRootDir(), ...modelName.split("/"));
}

/** 拼一个模型文件的下载 URL（镜像基址去尾斜杠，路径段原样）。 */
export function buildModelFileUrl(
  endpoint: string,
  modelName: string,
  relPath: string,
): string {
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/${modelName}/resolve/main/${relPath}`;
}

/**
 * 区域 → 默认模型源。cn 走镜像，其余（含未声明）走官方——
 * 区域声明只是「默认值」，用户填了 mirror pref 就以 pref 为准。
 */
export function defaultModelEndpointFor(region: NetworkRegion): string {
  return region === "cn" ? CN_MODEL_ENDPOINT : DEFAULT_MODEL_ENDPOINT;
}

/** 当前生效的模型源：pref 覆盖 > 按区域推导。 */
export function resolveModelEndpoint(): string {
  const override = String(
    getPrefDynamic("embedding.local.mirror") ?? "",
  ).trim();
  if (/^https?:\/\//i.test(override)) return override.replace(/\/+$/, "");
  return defaultModelEndpointFor(getNetworkRegion());
}

async function hasContent(p: string): Promise<boolean> {
  try {
    const stat = await (globalThis as any).IOUtils.stat(p);
    return typeof stat?.size === "number" && stat.size > 0;
  } catch {
    return false;
  }
}

/** 本会话内已验证齐全的模型——embed 是逐条热路径，免掉每条的磁盘 stat。 */
const downloadedMemo = new Set<string>();

/**
 * 模型必需文件是否齐全（可选文件不计入）。齐全即跳过下载——手动把文件
 * 放进模型目录的离线用户照常工作。结果按模型记忆化（会话内）。
 */
export async function isModelDownloaded(modelName: string): Promise<boolean> {
  const id = sanitizeModelId(modelName);
  if (!id) return false;
  if (downloadedMemo.has(id)) return true;
  const dir = getModelDir(id);
  for (const rel of REQUIRED_MODEL_FILES) {
    if (!(await hasContent(PathUtils.join(dir, ...rel.split("/"))))) {
      return false;
    }
  }
  downloadedMemo.add(id);
  return true;
}

export interface ModelDownloadProgress {
  file: string;
  fileIndex: number;
  fileTotal: number;
}

/**
 * 下载一个模型文件。返回 true = 已存在/下载成功；false = 可选文件取不到
 * （404 类）；网络/写盘失败抛错。
 */
async function fetchModelFile(
  modelName: string,
  relPath: string,
  optional: boolean,
): Promise<boolean> {
  const url = buildModelFileUrl(resolveModelEndpoint(), modelName, relPath);
  const target = PathUtils.join(getModelDir(modelName), ...relPath.split("/"));
  let response: any;
  try {
    response = await (Zotero as any).HTTP.request("GET", url, {
      responseType: "arraybuffer",
      timeout: relPath.endsWith(".onnx") ? 600000 : 60000,
    });
  } catch (e: any) {
    if (optional && (e?.status === 404 || e?.status === 410)) return false;
    throw new Error(`${url} → ${e?.message || String(e)}`, { cause: e });
  }
  if (response.status !== 200 || !response.response) {
    if (optional && (response.status === 404 || response.status === 410)) {
      return false;
    }
    throw new Error(`${url} → HTTP ${response.status}`);
  }
  const data = new Uint8Array(response.response);
  if (data.byteLength === 0) {
    throw new Error(`${url} → empty response`);
  }
  // 目标父目录由 relPath 段数推导（PathUtils.dirname 不在类型声明里）。
  const segs = relPath.split("/");
  const parent =
    segs.length > 1
      ? PathUtils.join(getModelDir(modelName), ...segs.slice(0, -1))
      : getModelDir(modelName);
  await (globalThis as any).IOUtils.makeDirectory(parent, {
    createAncestors: true,
  });
  await (globalThis as any).IOUtils.write(target, data);
  return true;
}

/** 同一模型的下载单飞：并发 embed 调用共享一次下载。 */
const inFlight = new Map<string, Promise<void>>();

/** 失败冷却：60 秒内不重试，让批量索引快速失败而不是逐条撞网络。 */
const FAILURE_COOLDOWN_MS = 60_000;
let lastFailureAt = 0;
let lastFailureModel = "";

/**
 * 下载模型必需文件（非空文件跳过——中断后的重试按文件续传）。
 *
 * @throws 下载/写盘失败时抛错——消息含失败文件与 URL，便于定位镜像问题。
 */
export async function downloadModel(
  modelName: string,
  onProgress?: (p: ModelDownloadProgress) => void,
): Promise<void> {
  const id = sanitizeModelId(modelName);
  if (!id) {
    throw new Error(`Invalid embedding model id: ${modelName}`);
  }
  const pending = inFlight.get(id);
  if (pending) return pending;

  const task = (async () => {
    const files: Array<{ rel: string; optional: boolean }> = [
      ...REQUIRED_MODEL_FILES.map((rel) => ({ rel, optional: false })),
      ...OPTIONAL_MODEL_FILES.map((rel) => ({ rel, optional: true })),
    ];
    const dir = getModelDir(id);
    for (let i = 0; i < files.length; i++) {
      const { rel, optional } = files[i];
      const target = PathUtils.join(dir, ...rel.split("/"));
      if (await hasContent(target)) continue;
      onProgress?.({ file: rel, fileIndex: i, fileTotal: files.length });
      const ok = await fetchModelFile(id, rel, optional);
      safeDebug(
        `[z-search] ModelDownloadManager: ${rel} ${
          ok ? "downloaded" : "skipped (optional, not found)"
        } for ${id}`,
      );
    }
  })();

  inFlight.set(id, task);
  try {
    await task;
  } catch (e) {
    lastFailureAt = Date.now();
    lastFailureModel = id;
    throw e;
  } finally {
    inFlight.delete(id);
  }
}

/**
 * 首次使用通道：模型齐全 → 直接返回；不齐 → 带进度窗下载。
 *
 * 冷却期内的失败快速抛出（不重发网络请求），批量索引把失败记成逐条
 * skip，而不是逐条挂起在不可达的端点上。
 *
 * @throws 下载失败（含冷却期）——消息已本地化，调用方按需包装。
 */
export async function ensureModelDownloaded(modelName: string): Promise<void> {
  if (await isModelDownloaded(modelName)) return;
  if (
    lastFailureModel === modelName &&
    Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS
  ) {
    throw new Error(
      getString("embedding-model-download-failed", {
        args: { detail: "recent attempt failed (cooldown)" },
      }),
    );
  }
  await downloadModelWithProgressWindow(modelName);
}

/** 进度窗包装：每个文件开始时补一行，结束报完成——追加行模型下不刷屏。 */
async function downloadModelWithProgressWindow(
  modelName: string,
): Promise<void> {
  const progressWindowManager = (
    await import("../progress/ProgressWindowManager")
  ).default;
  const windowId = progressWindowManager.create({
    title: getString("embedding-model-window-title"),
  });
  try {
    await downloadModel(modelName, (p) => {
      if (windowId) {
        progressWindowManager.addLines(windowId, [`${p.file} …`]);
      }
    });
    if (windowId) {
      progressWindowManager.addLines(windowId, [
        getString("embedding-model-download-done"),
      ]);
      setTimeout(() => progressWindowManager.close(windowId), 4000);
    }
  } catch (e: any) {
    const msg = getString("embedding-model-download-failed", {
      args: { detail: e?.message || String(e) },
    });
    if (windowId) {
      progressWindowManager.addLines(windowId, [msg]);
    }
    safeDebug("[z-search] ModelDownloadManager: " + msg);
    throw new Error(msg, { cause: e });
  }
}
