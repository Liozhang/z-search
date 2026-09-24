/**
 * MinerUApiClient — HTTP client for MinerU PDF parsing service.
 *
 * Two deployment modes:
 *   - **cloud** (mineru.net): JSON API, Bearer token, async upload→poll→download.
 *   - **local** (self-hosted `mineru-api`): multipart API, no auth, sync /file_parse.
 *
 * Both modes download a ZIP containing layout.json, content_list.json, full.md,
 * and extracted images — normalized into a unified MinerUParseResult.
 *
 * Quota tracking (cloud only): MinerU has no quota-query endpoint, so we maintain
 * a local per-day page counter (reset at midnight) and surface the -60018
 * "daily limit reached" error code as a MinerUInfraError so the fallback cascade
 * can switch to the other backend.
 */

import { getPrefDynamic } from "../../utils/prefs";
import * as quotaStore from "./MinerUQuotaStore";
import { safeDebug } from "../../utils/logger";
import { getString } from "../../utils/locale";

/** Infrastructure error — auth/network/timeout/quota. Triggers fallback. */
export class MinerUInfraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinerUInfraError";
  }
}

/** Content error — parse succeeded but no usable pages/text. Does NOT fallback. */
export class MinerUContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinerUContentError";
  }
}

export interface MinerUConfig {
  mode: "cloud" | "local";
  apiToken: string;
  serverUrl: string;
  model: string; // "vlm" | "pipeline"
  language: string;
}

const CLOUD_BASE = "https://mineru.net/api/v4";

export function loadMinerUConfig(): MinerUConfig {
  const rawMode =
    (getPrefDynamic("pdfParser.mineru.mode") as string) || "cloud";
  return {
    mode: (rawMode === "local" ? "local" : "cloud") as "cloud" | "local",
    apiToken: (getPrefDynamic("pdfParser.mineru.apiToken") as string) || "",
    serverUrl:
      (getPrefDynamic("pdfParser.mineru.serverUrl") as string) ||
      "http://127.0.0.1:8000",
    model: (getPrefDynamic("pdfParser.mineru.model") as string) || "vlm",
    language: (getPrefDynamic("pdfParser.mineru.language") as string) || "en",
  };
}

export interface MinerUParseResult {
  /** layout.json (middle.json) — hierarchical page→block→line→span with raw PDF bbox */
  layoutJson: any;
  /** content_list.json — flat reading-order block list */
  contentList: any[];
  /** full.md — markdown rendering */
  markdown: string;
  /** filename → base64 data URI (e.g. "data:image/jpeg;base64,...") */
  images: Map<string, string>;
  /** Number of pages parsed (for quota tracking) */
  pageCount: number;
}

export async function parsePdfWithMinerU(
  filePath: string,
  options?: {
    signal?: AbortSignal;
    onProgress?: (msg: string) => void;
  },
): Promise<MinerUParseResult> {
  const config = loadMinerUConfig();

  // Cloud mode requires a token.
  if (config.mode === "cloud" && !config.apiToken) {
    throw new MinerUInfraError(getString("pdf-mineru-token-missing"));
  }

  if (config.mode === "cloud") {
    return parseCloud(filePath, config, options);
  }
  return parseLocal(filePath, config, options);
}

async function parseCloud(
  filePath: string,
  config: MinerUConfig,
  options?: { signal?: AbortSignal; onProgress?: (msg: string) => void },
): Promise<MinerUParseResult> {
  const onProgress = options?.onProgress ?? (() => {});
  const signal = options?.signal;

  onProgress(getString("pdf-mineru-requesting-url"));
  const fileName = filePath.split(/[\\/]/).pop() || "document.pdf";

  const batchResp = await fetchJson(`${CLOUD_BASE}/file-urls/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: [fileName],
      model_version: config.model,
      language: config.language,
      enable_formula: true,
      enable_table: true,
    }),
    signal,
  });

  checkCloudError(batchResp);

  const batchId: string = batchResp?.data?.batch_id;
  const uploadUrl: string = batchResp?.data?.file_urls?.[0];
  if (!batchId || !uploadUrl) {
    throw new MinerUInfraError(
      getString("pdf-mineru-no-upload-url", {
        args: { detail: JSON.stringify(batchResp).slice(0, 200) },
      }),
    );
  }

  // M-20: cancellation must NOT be a MinerUInfraError — the backend selector
  // would treat it as infra and re-parse via the fallback backend.
  if (signal?.aborted) {
    throw Object.assign(new Error(getString("pdf-cancelled")), {
      name: "AbortError",
    });
  }
  onProgress(getString("pdf-mineru-uploading"));
  const fileBytes: Uint8Array = await IOUtils.read(filePath);
  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    body: fileBytes,
    signal,
  });
  if (!uploadResp.ok) {
    throw new MinerUInfraError(
      getString("pdf-mineru-upload-failed", {
        args: { status: String(uploadResp.status) },
      }),
    );
  }

  onProgress(getString("pdf-mineru-parsing"));
  const result = await pollBatchResult(
    batchId,
    config.apiToken,
    signal,
    onProgress,
  );

  onProgress(getString("pdf-mineru-downloading"));
  const zipUrl: string | undefined = result?.extract_result?.[0]?.full_zip_url;
  if (!zipUrl) {
    throw new MinerUInfraError(getString("pdf-mineru-no-download-url"));
  }

  const zipResult = await downloadAndExtractZip(zipUrl, signal);

  const pageCount = zipResult.layoutJson?.pdf_info?.length ?? 0;
  trackPagesUsed(pageCount);

  return {
    layoutJson: zipResult.layoutJson,
    contentList: zipResult.contentList,
    markdown: zipResult.markdown,
    images: zipResult.images,
    pageCount,
  };
}

/** Poll batch results with 2s interval, 5min timeout. */
async function pollBatchResult(
  batchId: string,
  token: string,
  signal: AbortSignal | undefined,
  onProgress: (msg: string) => void,
): Promise<any> {
  const url = `${CLOUD_BASE}/extract-results/batch/${batchId}`;
  const maxWaitMs = 5 * 60 * 1000;
  const intervalMs = 2000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    // M-20: cancellation is an AbortError, not an infra error — see parseCloud.
    if (signal?.aborted) {
      throw Object.assign(new Error(getString("pdf-cancelled")), {
        name: "AbortError",
      });
    }

    const resp = await fetchJson(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    checkCloudError(resp);

    const state = resp?.data?.state;
    const elapsed = Math.round((Date.now() - start) / 1000);
    onProgress(getString("pdf-mineru-parsing-elapsed", { args: { elapsed } }));

    if (state === "done" || state === "completed") {
      return resp.data;
    }
    if (state === "fail" || state === "failed") {
      throw new MinerUContentError(
        getString("pdf-mineru-parse-failed", {
          args: {
            detail: JSON.stringify(
              resp?.data?.extract_result?.[0]?.err_msg || "",
            ).slice(0, 200),
          },
        }),
      );
    }

    await sleep(intervalMs);
  }

  throw new MinerUInfraError(
    getString("pdf-mineru-timeout", { args: { minutes: 5 } }),
  );
}

async function parseLocal(
  filePath: string,
  config: MinerUConfig,
  options?: { signal?: AbortSignal; onProgress?: (msg: string) => void },
): Promise<MinerUParseResult> {
  const onProgress = options?.onProgress ?? (() => {});
  const signal = options?.signal;
  const base = config.serverUrl.replace(/\/+$/, "");

  // Health-check the local server first.
  onProgress(getString("pdf-mineru-checking-local"));
  const health = await checkLocalHealth(base);
  if (!health.healthy) {
    throw new MinerUInfraError(
      getString("pdf-mineru-local-unavailable", {
        args: {
          base,
          detail: health.error ?? getString("pdf-mineru-connect-failed"),
        },
      }),
    );
  }

  // Build multipart form.  We use the sync /file_parse endpoint — it blocks
  // until parsing is done and returns the result in the same response.
  onProgress(getString("pdf-mineru-uploading-local"));
  const fileBytes: Uint8Array = await IOUtils.read(filePath);
  const fileName = filePath.split(/[\\/]/).pop() || "document.pdf";

  const formData = new FormData();
  formData.append(
    "files",
    new Blob([fileBytes], { type: "application/pdf" }),
    fileName,
  );
  formData.append(
    "backend",
    config.model === "vlm" ? "vlm-sglang-engine" : "pipeline",
  );
  formData.append("return_middle_json", "true");
  formData.append("return_content_list", "true");
  formData.append("return_images", "true");
  formData.append("response_format_zip", "true");
  formData.append("formula", "true");
  formData.append("table", "true");

  onProgress(getString("pdf-mineru-parsing-local"));
  // L-27: the cloud path polls with a 5-minute ceiling and the health check
  // times out in 5s — the local fetch was the only unbounded wait. A hung
  // local service would leave the request pending forever. AbortSignal.any
  // preserves the caller's cancellation signal.
  const LOCAL_PARSE_TIMEOUT_MS = 5 * 60 * 1000;
  const timeoutSignal = AbortSignal.timeout(LOCAL_PARSE_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const resp = await fetch(`${base}/file_parse`, {
    method: "POST",
    body: formData,
    signal: combinedSignal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new MinerUInfraError(
      getString("pdf-mineru-local-parse-failed", {
        args: { status: String(resp.status), detail: errText.slice(0, 200) },
      }),
    );
  }

  // Response is a ZIP blob.
  const zipBytes = new Uint8Array(await resp.arrayBuffer());
  const zipResult = await extractZipBytes(zipBytes);

  const pageCount = zipResult.layoutJson?.pdf_info?.length ?? 0;
  return {
    layoutJson: zipResult.layoutJson,
    contentList: zipResult.contentList,
    markdown: zipResult.markdown,
    images: zipResult.images,
    pageCount,
  };
}

export interface MinerUHealthResult {
  healthy: boolean;
  mode: "cloud" | "local";
  version?: string;
  quotaUsedToday?: number;
  error?: string;
}

export async function checkMinerUHealth(): Promise<MinerUHealthResult> {
  const config = loadMinerUConfig();

  if (config.mode === "cloud") {
    if (!config.apiToken) {
      return {
        healthy: false,
        mode: "cloud",
        error: getString("pdf-mineru-token-not-set"),
      };
    }
    try {
      const resp = await fetchJson(`${CLOUD_BASE}/file-urls/batch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: [] }),
      });
      if (resp?.code !== 0 && resp?.code !== undefined) {
        return {
          healthy: false,
          mode: "cloud",
          error: getString("pdf-mineru-auth-failed", {
            args: { detail: String(resp.msg ?? resp.msgCode ?? "unknown") },
          }),
        };
      }
      return {
        healthy: true,
        mode: "cloud",
        quotaUsedToday: getPagesUsedToday(),
      };
    } catch (e: any) {
      return {
        healthy: false,
        mode: "cloud",
        error: e?.message ?? String(e),
      };
    }
  }

  // Local mode
  const result = await checkLocalHealth(config.serverUrl);
  return {
    healthy: result.healthy,
    mode: "local",
    version: result.version,
    error: result.error,
  };
}

async function checkLocalHealth(
  serverUrl: string,
): Promise<{ healthy: boolean; version?: string; error?: string }> {
  const base = serverUrl.replace(/\/+$/, "");
  try {
    const resp = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return { healthy: false, error: `HTTP ${resp.status}` };
    }
    const data: any = await resp.json();
    return {
      healthy: true,
      version: data.version ?? data.protocol_version,
    };
  } catch (e: any) {
    return {
      healthy: false,
      error: e?.message ?? getString("pdf-mineru-connect-failed"),
    };
  }
}

// Counter lives in MinerUQuotaStore (JSON state file under the data dir) —
// internal runtime state, deliberately out of the user pref system.

export function getPagesUsedToday(): number {
  return quotaStore.getPagesUsedToday();
}

function trackPagesUsed(pageCount: number): void {
  void quotaStore.trackPagesUsed(pageCount); // write-through, failure-tolerant
}

interface ExtractedZip {
  layoutJson: any;
  contentList: any[];
  markdown: string;
  images: Map<string, string>;
}

/**
 * Download a ZIP from a URL, save to temp, extract using nsIZipReader.
 */
async function downloadAndExtractZip(
  zipUrl: string,
  signal: AbortSignal | undefined,
): Promise<ExtractedZip> {
  const resp = await fetch(zipUrl, { signal });
  if (!resp.ok) {
    throw new MinerUInfraError(
      getString("pdf-mineru-download-failed", {
        args: { status: String(resp.status) },
      }),
    );
  }
  const zipBytes = new Uint8Array(await resp.arrayBuffer());
  return await extractZipBytes(zipBytes);
}

/**
 * Extract a ZIP byte array into MinerU result components.
 * Uses nsIZipReader (Mozilla XPCOM) — same pattern as WebDAVBackupManager.
 */
async function extractZipBytes(zipBytes: Uint8Array): Promise<ExtractedZip> {
  const Cc = (globalThis as any).Cc;
  const Ci = (globalThis as any).Ci;

  // Write bytes to a temp file for nsIZipReader to open.
  const tmpDir = PathUtils.join(
    (Zotero as any).DataDirectory?.dir ?? PathUtils.tempDir,
    "leadero-mineru",
  );
  // H-2: IOUtils is a fully async API — mkdir/write MUST be awaited. The old
  // fire-and-forget calls raced the synchronous zipReader.open() below, which
  // intermittently opened a missing/half-written zip (NS_ERROR_FILE_NOT_FOUND,
  // corrupt archive). The try/catch also only guards the sync rejection path.
  // IOUtils has no `mkdir` — the method is `makeDirectory`, and IOUtils.write
  // does not create parent directories, so this must succeed.
  await (IOUtils as any).makeDirectory(tmpDir, { createAncestors: true });
  const tmpZip = PathUtils.join(tmpDir, `result-${Date.now()}.zip`);
  await IOUtils.write(tmpZip, zipBytes);

  let layoutJson: any = null;
  let contentList: any[] = [];
  let markdown = "";
  const images = new Map<string, string>();

  try {
    const zipFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    zipFile.initWithPath(tmpZip);

    const zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
      Ci.nsIZipReader,
    );
    zipReader.open(zipFile);

    try {
      const entries = zipReader.findEntries("*");
      while (entries.hasMore()) {
        const entryName = entries.getNext();

        if (entryName.endsWith("/")) continue;

        const content = readZipEntry(zipReader, entryName);

        if (entryName === "layout.json" || entryName.endsWith("_layout.json")) {
          layoutJson = JSON.parse(content);
        } else if (
          entryName.endsWith("content_list.json") &&
          !entryName.endsWith("_content_list_v2.json")
        ) {
          try {
            const parsed = JSON.parse(content);
            contentList = Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            safeDebug("[z-search] MinerUApiClient: " + e); /* malformed */
          }
        } else if (entryName === "full.md" || entryName.endsWith(".md")) {
          markdown = content;
        } else if (
          entryName.startsWith("images/") ||
          entryName.includes("/images/")
        ) {
          const imgName = entryName.split("/").pop() || entryName;
          // Read as binary for base64 encoding.
          const imgBytes = readZipEntryBytes(zipReader, entryName);
          const ext = imgName.split(".").pop()?.toLowerCase() || "jpeg";
          const mime = ext === "png" ? "image/png" : "image/jpeg";
          const b64 = bytesToBase64(imgBytes);
          images.set(imgName, `data:${mime};base64,${b64}`);
        }
      }
    } finally {
      zipReader.close();
    }
  } finally {
    // Cleanup temp file.
    IOUtils.remove(tmpZip).catch((e) => {
      safeDebug("[z-search] MinerUApiClient: tmp zip cleanup failed: " + e);
    });
  }

  if (!layoutJson) {
    throw new MinerUContentError(getString("pdf-mineru-no-layout-json"));
  }

  return { layoutJson, contentList, markdown, images };
}

function readZipEntry(zipReader: any, entryName: string): string {
  const Cc = (globalThis as any).Cc;
  const Ci = (globalThis as any).Ci;
  const inputStream = zipReader.getInputStream(entryName);
  const bis = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
    Ci.nsIBinaryInputStream,
  );
  bis.setInputStream(inputStream);
  const available = bis.available();
  // For text files, read as UTF-8 string.
  const str = bis.readBytes(available);
  bis.close();
  // H-3: nsIBinaryInputStream.readBytes returns a Latin-1 binary string (one
  // char per byte) — it is NOT decoded text. MinerU's JSON/Markdown entries
  // are UTF-8, so recover the raw bytes and decode; without this every CJK
  // character comes back as two mojibake chars.
  const bytes = new Uint8Array(available);
  for (let i = 0; i < available; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return new TextDecoder("utf-8").decode(bytes);
}

function readZipEntryBytes(zipReader: any, entryName: string): Uint8Array {
  const Cc = (globalThis as any).Cc;
  const Ci = (globalThis as any).Ci;
  const inputStream = zipReader.getInputStream(entryName);
  const bis = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
    Ci.nsIBinaryInputStream,
  );
  bis.setInputStream(inputStream);
  const available = bis.available();
  const str = bis.readByteArray(available);
  bis.close();
  return new Uint8Array(str);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fetchJson(
  url: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<any> {
  const resp = await fetch(url, init);
  if (!resp.ok && resp.status !== 202) {
    const text = await resp.text().catch(() => "");
    throw new MinerUInfraError(
      `MinerU API HTTP ${resp.status}: ${text.slice(0, 200)}`,
    );
  }
  return resp.json();
}

function checkCloudError(resp: any): void {
  if (!resp) {
    throw new MinerUInfraError(getString("pdf-mineru-empty-response"));
  }
  const code = resp.code;
  if (code === undefined || code === 0) return; // success

  const msg = resp.msg ?? resp.msgCode ?? `error code ${code}`;

  // -60018: daily extract limit reached  → infra error (can fallback)
  // -60019: HTML quota exhausted         → infra error
  if (code === -60018 || code === -60019) {
    throw new MinerUInfraError(
      getString("pdf-mineru-quota-exhausted", { args: { detail: msg } }),
    );
  }

  // Auth errors → infra
  if (resp.msgCode === "A0202" || resp.msgCode === "A0211") {
    throw new MinerUInfraError(
      getString("pdf-mineru-auth-rejected", { args: { detail: msg } }),
    );
  }

  throw new MinerUInfraError(
    getString("pdf-mineru-api-error", {
      args: { detail: msg, code: String(code) },
    }),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
