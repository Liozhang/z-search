/**
 * ModelDownloadManager — 为本地嵌入模型补齐文件下载通道。
 *
 * 背景：embedFrameLogic 强制 `allowRemoteModels = false`（iframe 内 file://
 * 直读本地盘），模型文件必须预先躺在 {DataDir}/zsearch/models 下，但本仓库
 * 既不随包分发模型（体积原因，与 opendataloader jar 同一决策），此前也没有
 * 任何下载器——全新安装的向量功能实际不可用（2026-10-04 修复）。
 *
 * 本模块补上缺失的一环：首次使用时按 transformers.js 的 localModelPath 布局
 * 把模型文件取回本地。端点求值序「覆盖 > 检测 > 区域推导 > 内置」：用户填的
 * `embedding.local.mirror`（设置 ▸ 区域限定端点）最优先；未覆盖时下载前并发
 * 探测三个内置源（huggingface.co / hf-mirror.com / modelscope.cn），可达者
 * （都可达时更快者）当选，结果记 24 小时缓存——区域声明只是静态猜测，实际
 * 以跑通为准；选中的源下载失败再沿其余内置源逐个回落。全部不可达时按区域
 * 默认收尾并如实报错。
 *
 * 纯函数（文件清单 / URL 拼装 / 模型名校验 / 区域默认 / 探测结果选源）单独
 * 导出供 vitest 直接测试——与 embedFrameLogic 同一模式；IO 编排仅在插件运行
 * 时执行。
 *
 * @module core/embedding/ModelDownloadManager
 */

import { getPrefDynamic, setPrefDynamic } from "../../utils/prefs";
import { getNetworkRegion, type NetworkRegion } from "../../utils/region";
import { getString } from "../../utils/locale";
import { safeDebug } from "../../utils/logger";

/** 官方模型源。 */
export const DEFAULT_MODEL_ENDPOINT = "https://huggingface.co";
/** 中国大陆区域的可达镜像（hf-mirror.com 是 huggingface.co 的只读镜像）。 */
export const CN_MODEL_ENDPOINT = "https://hf-mirror.com";
/**
 * 魔搭社区（ModelScope，阿里云旗下）模型源：国内免代理直连，实测响应常快于
 * hf-mirror；托管同一批 Xenova ONNX 模型（四个内置模型 2026-10-11 全部实测
 * 可达）。文件布局多一段 /models、分支用 master（见 buildModelFileUrl）。
 */
export const MODELSCOPE_ENDPOINT = "https://www.modelscope.cn";

/** 内置模型源全集——并发探测与下载回落链按此展开；用户镜像 pref 不在其中。 */
export const BUILTIN_MODEL_ENDPOINTS: readonly string[] = [
  DEFAULT_MODEL_ENDPOINT,
  CN_MODEL_ENDPOINT,
  MODELSCOPE_ENDPOINT,
];

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

/** 拼一个模型文件的下载 URL（基址去尾斜杠，路径段原样）。 */
export function buildModelFileUrl(
  endpoint: string,
  modelName: string,
  relPath: string,
): string {
  const base = endpoint.replace(/\/+$/, "");
  // ModelScope 的 HF 兼容布局是 /models/{org}/{repo}/resolve/master/{path}——
  // 多一段 /models、分支叫 master。其余源（含用户自填镜像）统一 HF 的
  // resolve/main 布局；自建 ModelScope 反代不在此识别范围，按 HF 布局拼。
  if (base === MODELSCOPE_ENDPOINT) {
    return `${base}/models/${modelName}/resolve/master/${relPath}`;
  }
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

/** 用户是否显式配置了镜像覆盖（决定下载失败时是否允许在两内置源间回落）。 */
export function hasMirrorOverride(): boolean {
  const override = String(
    getPrefDynamic("embedding.local.mirror") ?? "",
  ).trim();
  return /^https?:\/\//i.test(override);
}

// ── 端点自动检测 ──────────────────────────────────────────────────────────
// 区域声明只是静态默认值，救不了「声明了 auto 的大陆机器撞不上官方源」——
// 下载前并发探测两个内置源，谁可达（都可达时谁快）用谁。结果会话内记忆并
// 落 pref（24 小时有效），避免每次下载都付探测开销。

export interface EndpointProbeResult {
  endpoint: string;
  /** 探测耗时（毫秒）；网络层失败（超时/DNS/拒绝）为 null。 */
  latencyMs: number | null;
  /** HTTP 状态码（可达但非 200 时保留，如 404 = 该源没有此模型文件）。 */
  status?: number;
  error?: string;
}

/** 探测超时：两端点并发探测，最坏情况下载前的固定等待。 */
export const ENDPOINT_PROBE_TIMEOUT_MS = 8_000;
/** 自动检测结果的有效期：过期后重新探测（网络环境会变）。 */
const DETECTION_TTL_MS = 24 * 60 * 60 * 1000;
/** 检测结果持久化的 pref（JSON：{endpoint, at}；只认两个内置源白名单）。 */
const DETECTED_ENDPOINT_PREF = "embedding.local.detectedEndpoint";

/** 下载前探测用的最小文件——各模型仓库必有，体积小（<2KB）。 */
const PROBE_FILE = "config.json";

/** 拼端点探测 URL（复用下载 URL 布局，探测的正是要下载的路径）。 */
export function buildEndpointProbeUrl(
  endpoint: string,
  modelName: string,
): string {
  return buildModelFileUrl(endpoint, modelName, PROBE_FILE);
}

/**
 * 探测一个端点：取探测文件，200 记为成功（latencyMs = 耗时）。
 * 永不抛错——失败以 latencyMs:null + error 返回，编排侧并发等待两端点。
 */
export async function probeEndpoint(
  modelName: string,
  endpoint: string,
): Promise<EndpointProbeResult> {
  const url = buildEndpointProbeUrl(endpoint, modelName);
  const started = Date.now();
  try {
    const response: any = await (Zotero as any).HTTP.request("GET", url, {
      responseType: "text",
      timeout: ENDPOINT_PROBE_TIMEOUT_MS,
    });
    const latencyMs = Date.now() - started;
    if (response.status !== 200) {
      return { endpoint, latencyMs: null, status: response.status };
    }
    return { endpoint, latencyMs, status: 200 };
  } catch (e: any) {
    return {
      endpoint,
      latencyMs: null,
      error: String(e?.message || e).slice(0, 200),
    };
  }
}

/**
 * 纯函数：从探测结果选端点——只有探测成功（200）的候选可入选，取最快；
 * 全部失败返回 null（调用方回落区域默认）。
 */
export function selectEndpointFromProbes(
  probes: EndpointProbeResult[],
): EndpointProbeResult | null {
  const ok = probes.filter((p) => p.latencyMs !== null);
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => ((b.latencyMs ?? 0) < (a.latencyMs ?? 0) ? b : a));
}

/** 会话内检测缓存（首个 embed 前 probe 一次，后续直读）。 */
let sessionDetected: { endpoint: string; at: number } | null = null;

function readDetectedEndpointCache(): string | null {
  const read = (raw: unknown): string | null => {
    try {
      const parsed = JSON.parse(String(raw ?? "")) as {
        endpoint?: unknown;
        at?: unknown;
      };
      const endpoint = String(parsed.endpoint ?? "");
      const at = Number(parsed.at ?? 0);
      if (
        (BUILTIN_MODEL_ENDPOINTS as readonly string[]).includes(endpoint) &&
        at > 0 &&
        Date.now() - at < DETECTION_TTL_MS
      ) {
        return endpoint;
      }
    } catch {
      /* 空/损坏的缓存值按未检测处理 */
    }
    return null;
  };
  if (sessionDetected) {
    const fromSession = read(JSON.stringify(sessionDetected));
    if (fromSession) return fromSession;
    sessionDetected = null;
  }
  const fromPref = read(getPrefDynamic(DETECTED_ENDPOINT_PREF));
  if (fromPref) {
    sessionDetected = { endpoint: fromPref, at: Date.now() };
  }
  return fromPref;
}

function rememberDetectedEndpoint(endpoint: string): void {
  if (!(BUILTIN_MODEL_ENDPOINTS as readonly string[]).includes(endpoint)) {
    return;
  }
  sessionDetected = { endpoint, at: Date.now() };
  try {
    setPrefDynamic(
      DETECTED_ENDPOINT_PREF,
      JSON.stringify({ endpoint, at: Date.now() }),
    );
  } catch (e) {
    safeDebug(
      `[z-search] ModelDownloadManager: persist detected endpoint failed: ${e}`,
    );
  }
}

/**
 * 并发探测全部内置源并记忆结果。手动「检测镜像」与下载前自动选择共用；
 * 全部不可达返回 null——调用方回落区域默认端点。
 */
export async function detectModelEndpoint(
  modelName: string,
): Promise<EndpointProbeResult | null> {
  const results = await Promise.all(
    BUILTIN_MODEL_ENDPOINTS.map((endpoint) =>
      probeEndpoint(modelName, endpoint),
    ),
  );
  const best = selectEndpointFromProbes(results);
  if (best) {
    rememberDetectedEndpoint(best.endpoint);
  } else {
    safeDebug(
      `[z-search] ModelDownloadManager: both endpoints unreachable for ${modelName}`,
    );
  }
  return best;
}

/**
 * 下载用的端点求值序：显式镜像覆盖 > 新鲜的检测结果 > 现场探测 > 区域默认。
 * 同步版 resolveModelEndpoint 保留作展示与非关键路径兜底。
 */
export async function resolveModelEndpointAsync(
  modelName: string,
): Promise<string> {
  const override = getMirrorOverrideValue();
  if (override) return override;
  const cached = readDetectedEndpointCache();
  if (cached) return cached;
  const best = await detectModelEndpoint(modelName);
  if (best) return best.endpoint;
  return defaultModelEndpointFor(getNetworkRegion());
}

function getMirrorOverrideValue(): string | null {
  const override = String(
    getPrefDynamic("embedding.local.mirror") ?? "",
  ).trim();
  return /^https?:\/\//i.test(override) ? override.replace(/\/+$/, "") : null;
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
 * 从 transformers.js 模型配置提取向量维度（纯函数，供单测）。各架构的键名
 * 不一：hidden_size（BERT/E5/MiniLM 系）、d_model（部分变体）。取不到或不
 * 合法返回 null，由调用方走静态表与默认值回退。
 */
export function extractModelDimension(config: unknown): number | null {
  const raw = (config as any)?.hidden_size ?? (config as any)?.d_model;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.round(raw)
    : null;
}

/** 维度记录的动态 pref：JSON 映射 { 模型id: 维度 }，按模型覆盖静态表。 */
const DIMENSION_MAP_PREF = "embedding.local.dimensions";

function readDimensionMap(): Record<string, number> {
  try {
    const map = JSON.parse(String(getPrefDynamic(DIMENSION_MAP_PREF) ?? "{}"));
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

/**
 * 读已下载模型的 config.json，把真实维度记入维度映射 pref。失败静默——
 * 维度记录是增益，不是依赖；查询侧另有三级回退（静态表 → 映射 → 384）。
 * 此前未知模型一律按 384 处理，768/1024 维的自定义模型会在 IVF 索引处以
 * 「维度不匹配」炸掉（2026-10-11 审计）。
 */
export async function refreshModelDimension(modelName: string): Promise<void> {
  const id = sanitizeModelId(modelName);
  if (!id) return;
  try {
    const configPath = PathUtils.join(getModelDir(id), "config.json");
    const text = (await Zotero.File.getContentsAsync(configPath)) as string;
    const dim = extractModelDimension(JSON.parse(String(text)));
    if (dim === null || readDimensionMap()[id] === dim) return;
    setPrefDynamic(
      DIMENSION_MAP_PREF,
      JSON.stringify({ ...readDimensionMap(), [id]: dim }),
    );
    safeDebug(
      `[z-search] ModelDownloadManager: recorded dimension ${dim} for ${id}`,
    );
  } catch (e) {
    safeDebug(
      `[z-search] ModelDownloadManager: dimension refresh skipped for ${id}: ${e}`,
    );
  }
}

/**
 * 模型必需文件是否齐全（可选文件不计入）。齐全即跳过下载——手动把文件
 * 放进模型目录的离线用户照常工作。结果按模型记忆化（会话内）；记忆化
 * 落笔时顺带刷新一次维度记录（每模型每会话至多一次小文件读取）。
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
  // 存量污染治理：旧版本曾把「HTTP 200 且非空」的 HTML 错误页写进模型
  // 目录，hasContent 只看文件大小，垃圾文件永远通过检查。下载校验只护
  // 新下载——这里对 config.json 做一次廉价解析，解析失败按未下载处理，
  // ensureModelDownloaded 会触发重下（自愈），而不是留到加载时才炸。
  try {
    const configText = (await Zotero.File.getContentsAsync(
      PathUtils.join(dir, "config.json"),
    )) as string;
    JSON.parse(String(configText));
  } catch (e) {
    safeDebug(
      `[z-search] ModelDownloadManager: ${id} config.json invalid, treating as not downloaded: ${e}`,
    );
    return false;
  }
  downloadedMemo.add(id);
  void refreshModelDimension(id);
  return true;
}

export interface ModelDownloadProgress {
  file: string;
  fileIndex: number;
  fileTotal: number;
}

/**
 * 下载内容校验（纯函数，供单测）：完整性与端点无关的最后一道闸——此前唯一
 * 的判据是「HTTP 200 且非空」，一个返回 200 + HTML 错误页的反代足以把垃圾
 * 字节写进模型目录并通过 hasContent 检查，在 transformers.js 加载时才以晦涩
 * 错误暴露（2026-10-11 审计）。两条规则：
 *   1. 一切文件：去首部空白后以 `<` 开头按 HTML 错误页拒绝（JSON/ONNX 的
 *      首字节分别为 `{` 与 protobuf 0x08，永不冲突）；
 *   2. .json 文件：必须整体可解析（config.json 损坏 = 模型不可用）。
 *
 * @returns 合法返回 null；非法返回一句可直接拼进错误消息的原因。
 */
export function validateModelFileContent(
  relPath: string,
  bytes: Uint8Array,
): string | null {
  let start = 0;
  while (
    start < bytes.length &&
    (bytes[start] === 0x20 ||
      bytes[start] === 0x09 ||
      bytes[start] === 0x0a ||
      bytes[start] === 0x0d)
  ) {
    start++;
  }
  if (start < bytes.length && bytes[start] === 0x3c /* '<' */) {
    return "response looks like an HTML error page, not a model file";
  }
  if (relPath.endsWith(".json") && typeof TextDecoder === "function") {
    try {
      JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return "response is not valid JSON";
    }
  }
  return null;
}

/**
 * 下载一个模型文件。返回 true = 已存在/下载成功；false = 可选文件取不到
 * （404 类）；网络/写盘/内容校验失败抛错。端点由调用方显式传入——
 * downloadModel 负责端点选择与失败回落，本函数不做任何决策。
 */
async function fetchModelFile(
  modelName: string,
  relPath: string,
  optional: boolean,
  endpoint: string,
): Promise<boolean> {
  const url = buildModelFileUrl(endpoint, modelName, relPath);
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
  const invalidReason = validateModelFileContent(relPath, data);
  if (invalidReason) {
    throw new Error(`${url} → ${invalidReason}`);
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

/** 跑一遍文件清单：已在盘上的文件跳过（中断重试按文件续传）。 */
async function runFileLoop(
  modelName: string,
  files: Array<{ rel: string; optional: boolean }>,
  onProgress?: (p: ModelDownloadProgress) => void,
  endpoint: string = resolveModelEndpoint(),
): Promise<void> {
  const dir = getModelDir(modelName);
  for (let i = 0; i < files.length; i++) {
    const { rel, optional } = files[i];
    const target = PathUtils.join(dir, ...rel.split("/"));
    if (await hasContent(target)) continue;
    onProgress?.({ file: rel, fileIndex: i, fileTotal: files.length });
    const ok = await fetchModelFile(modelName, rel, optional, endpoint);
    safeDebug(
      `[z-search] ModelDownloadManager: ${rel} ${
        ok ? "downloaded" : "skipped (optional, not found)"
      } for ${modelName}`,
    );
  }
}

/**
 * 下载模型必需文件（非空文件跳过——中断后的重试按文件续传）。
 *
 * 端点选择走 resolveModelEndpointAsync（显式镜像 > 自动检测 > 区域默认）；
 * 检测/推导出的端点下载失败时，在两个内置源间自动回落重试一次（用户显式
 * 配置的镜像不偷换）——区域声明是静态猜测，网络实况以跑通为准。已下载的
 * 文件按盘跳过，回落重试不做重复工作。成功端点记入检测缓存，后续下载与
 * 探测直接复用。
 *
 * @throws 下载/写盘失败时抛错——消息含失败文件与 URL（含回落端点的失败），
 *         便于定位镜像问题。
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
    const primary = await resolveModelEndpointAsync(id);
    try {
      await runFileLoop(id, files, onProgress, primary);
      rememberDetectedEndpoint(primary);
      return;
    } catch (primaryError) {
      // 用户显式配置的镜像失败——如实上抛，不静默换源。
      if (hasMirrorOverride()) throw primaryError;
      // 内置源回落链：主源失败后逐个尝试其余内置源（已在盘上的文件按盘
      // 跳过，换源不做重复工作）。全部失败时合并各源的错误详情上抛。
      const alternates = BUILTIN_MODEL_ENDPOINTS.filter((e) => e !== primary);
      const attempts: string[] = [
        `${primary} → ${String((primaryError as any)?.message || primaryError).slice(0, 220)}`,
      ];
      for (const alternate of alternates) {
        safeDebug(
          `[z-search] ModelDownloadManager: download via previous endpoint failed, trying ${alternate}: ${primaryError}`,
        );
        try {
          await runFileLoop(id, files, onProgress, alternate);
          rememberDetectedEndpoint(alternate);
          return;
        } catch (alternateError) {
          attempts.push(
            `${alternate} → ${String((alternateError as any)?.message || alternateError).slice(0, 220)}`,
          );
        }
      }
      throw new Error(attempts.join("；"), { cause: primaryError });
    }
  })();

  inFlight.set(id, task);
  try {
    await task;
    // 新下载完成 → 记录真实维度（未知模型此前盲按 384 处理，见
    // refreshModelDimension 注释）。fire-and-forget，失败不影响下载结果。
    void refreshModelDimension(id);
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

/** 进度窗包装：每个文件开始时补一行，结束报完成——追加行模型下不刷屏。
 *  导出供设置/面板的「下载模型」按钮直接调用：用户显式触发不受失败冷却
 *  限制（ensureModelDownloaded 的冷却只管 embed 热路径的自动下载）。 */
export async function downloadModelWithProgressWindow(
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
