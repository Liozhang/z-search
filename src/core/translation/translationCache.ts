/**
 * translationCache — persistent, content-addressed translation cache.
 *
 * The in-memory LRU in translationEngines.ts dies with the session. This
 * module adds the disk layer that lets repeated workloads (e.g. re-running a
 * literature search on the same batch of papers, or re-translating a PDF
 * after a restart) reuse translations across sessions instead of spending
 * quota-limited engine calls (AI providers, DeepL) again.
 * （自 z-transplit 搬入，见 docs/optimization-from-siblings-2026-09-30.md 第 5 项）
 *
 * Storage layout: one small JSON file per record, bucketed by the key prefix —
 *   {DataDir}/zsearch/translation-cache/v1/<key[0:2]>/<key>.json
 * One-file-per-record needs no locking, tolerates independent corruption
 * (a broken file is skipped, not fatal) and makes LRU pruning a plain scan.
 *
 * Cache key: sha1 of engine|model|sourceLang|targetLang|normalizedText.
 * Whitespace is normalized so extraction noise (soft line breaks, double
 * spaces) does not cause misses.
 *
 * Everything is defensive: outside Zotero (vitest) there is no DataDirectory,
 * so the base directory is injectable and every operation no-ops (or returns a
 * miss) instead of throwing when the host is unavailable.
 *
 * @module core/translation/translationCache
 */

import { safeDebug } from "../../utils/logger";
import { getPrefDynamic } from "../../utils/prefs";

const CACHE_VERSION = 1;

export interface CacheRecord {
  v: number;
  key: string;
  identity: string;
  sourceLang: string;
  targetLang: string;
  /** Normalized source text. */
  source: string;
  translated: string;
  createdAt: number;
  usedAt: number;
}

/** Injectable base directory (tests). Undefined = derive from Zotero.DataDirectory. */
let overrideBaseDir: string | null | undefined;

/** Override the cache directory (tests; pass null to reset to auto-detect). */
export function setCacheDirForTests(dir: string | null): void {
  overrideBaseDir = dir;
}

function dataRoot(): string | null {
  if (overrideBaseDir !== undefined) return overrideBaseDir;
  try {
    const dir = (globalThis as any)?.Zotero?.DataDirectory?.dir;
    return typeof dir === "string" && dir ? dir : null;
  } catch {
    return null;
  }
}

function cacheRoot(): string | null {
  const root = dataRoot();
  if (!root) return null;
  return joinPath(root, "zsearch", "translation-cache", `v${CACHE_VERSION}`);
}

/**
 * Cross-platform path join. Gecko's IOUtils rejects paths with mixed
 * separators ("D:\data/dir/x" — NS_ERROR_FILE_UNRECOGNIZED_PATH), so use
 * PathUtils (which normalizes for the OS) and only fall back to plain joining
 * under Node tests.
 */
function joinPath(...parts: string[]): string {
  const PathUtils = (globalThis as any).PathUtils;
  if (PathUtils?.join) {
    try {
      return PathUtils.join(...parts);
    } catch {
      /* fall through */
    }
  }
  return parts.join("/");
}

/** SHA-1 hex via the SubtleCrypto available in Gecko and Node 16+. */
async function sha1Hex(text: string): Promise<string> {
  const subtle = (globalThis as any)?.crypto?.subtle;
  if (!subtle) return "";
  const data = new TextEncoder().encode(text);
  const digest = await subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Normalize source text for keying: collapse whitespace runs, trim. */
export function normalizeForCache(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

/**
 * Build the cache key. Returns null when the environment has no SubtleCrypto —
 * callers must treat null as "cache unavailable" and always translate.
 *
 * `identity` is the caller's engine-configuration fingerprint (see
 * translationEngines.ts#engineCacheIdentity) — the cache module stays dumb
 * about engine internals.
 */
export async function cacheKey(
  identity: string,
  sourceLang: string,
  targetLang: string,
  text: string,
): Promise<string | null> {
  const normalized = normalizeForCache(text);
  if (!normalized) return null;
  const hash = await sha1Hex(
    `${CACHE_VERSION}|${identity}|${sourceLang || "auto"}|${targetLang}|${normalized}`,
  );
  if (!hash) return null;
  return hash;
}

function recordPath(key: string): string | null {
  const root = cacheRoot();
  if (!root) return null;
  // Defensive: key comes from our own sha1 hex, but never let odd characters
  // near the filesystem.
  if (!/^[0-9a-f]{8,64}$/.test(key)) return null;
  return joinPath(root, key.slice(0, 2), `${key}.json`);
}

/** Whether the persistent cache is enabled and usable in this environment. */
export function cacheAvailable(): boolean {
  try {
    if (getPrefDynamic("translate.cache.enabled") === false) return false;
  } catch {
    /* pref read failed — default to enabled */
  }
  return recordPath("0".repeat(40)) !== null;
}

async function readRecord(key: string): Promise<CacheRecord | null> {
  const path = recordPath(key);
  if (!path) return null;
  try {
    const IOUtils = (globalThis as any).IOUtils;
    if (!IOUtils?.read) return null;
    const bytes = await IOUtils.read(path);
    const text = new TextDecoder().decode(bytes);
    const rec = JSON.parse(text) as CacheRecord;
    if (
      rec?.v !== CACHE_VERSION ||
      rec.key !== key ||
      typeof rec.translated !== "string"
    ) {
      return null;
    }
    return rec;
  } catch {
    // Missing file (the common miss) or corrupt content — both are plain misses.
    return null;
  }
}

async function writeRecord(rec: CacheRecord): Promise<void> {
  const path = recordPath(rec.key);
  if (!path) return;
  try {
    const IOUtils = (globalThis as any).IOUtils;
    if (!IOUtils?.write || !IOUtils?.makeDirectory) return;
    const bucket = path.slice(0, path.lastIndexOf("/"));
    // makeDirectory with createDirs creates intermediate directories.
    await IOUtils.makeDirectory(bucket, {
      createDirs: true,
      ignoreExisting: true,
    });
    await IOUtils.write(path, new TextEncoder().encode(JSON.stringify(rec)));
  } catch (e) {
    safeDebug("[z-search] translationCache write failed: " + e);
  }
}

/** Look up cached translations for many keys at once. Missing keys are absent from the map. */
export async function getCachedTranslations(
  keys: Array<string | null>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(keys.filter((k): k is string => !!k)));
  for (const key of unique) {
    const rec = await readRecord(key);
    if (rec) out.set(key, rec.translated);
  }
  return out;
}

/** Store one translation. Never throws. */
export async function putCachedTranslation(
  identity: string,
  sourceLang: string,
  targetLang: string,
  sourceText: string,
  translated: string,
): Promise<void> {
  if (!translated || !translated.trim()) return;
  const key = await cacheKey(identity, sourceLang, targetLang, sourceText);
  if (!key) return;
  const normalized = normalizeForCache(sourceText);
  const now = Date.now();
  // Preserve the original createdAt when overwriting an existing entry.
  const existing = await readRecord(key);
  await writeRecord({
    v: CACHE_VERSION,
    key,
    identity,
    sourceLang: sourceLang || "auto",
    targetLang,
    source: normalized,
    translated,
    createdAt: existing?.createdAt ?? now,
    usedAt: now,
  });
}

/**
 * Normalize one IOUtils.getChildren result. Gecko's contract changed across
 * versions: Zotero 7 returns FileSystemEntry objects ({path, isDirectory,
 * size}); newer builds return plain path STRINGS whose stat() reports
 * type:"directory" instead of an isDirectory flag. Handle both.
 */
async function statChildren(
  dir: string,
): Promise<Array<{ path: string; isDirectory: boolean; size: number }>> {
  const IOUtils = (globalThis as any).IOUtils;
  if (!IOUtils?.getChildren) return [];
  const children = await IOUtils.getChildren(dir);
  const isDir = (s: any) =>
    !!s && (s.type === "directory" || s.isDirectory === true);
  const out: Array<{ path: string; isDirectory: boolean; size: number }> = [];
  for (const child of children as any[]) {
    if (typeof child === "string") {
      try {
        const stat = await IOUtils.stat(child);
        out.push({
          path: child,
          isDirectory: isDir(stat),
          size: Number(stat?.size) || 0,
        });
      } catch {
        /* vanished between listing and stat — skip */
      }
    } else if (child && typeof child === "object" && child.path) {
      out.push({
        path: child.path,
        isDirectory: isDir(child),
        size: Number(child.size) || 0,
      });
    }
  }
  return out;
}

interface Entry {
  path: string;
  size: number;
  usedAt: number;
}

/**
 * Prune the cache down to `maxBytes` (LRU by usedAt).
 *
 * @returns Number of files removed. Never throws.
 */
export async function pruneCache(maxBytes: number): Promise<number> {
  const root = cacheRoot();
  if (!root || !(maxBytes > 0)) return 0;
  try {
    const IOUtils = (globalThis as any).IOUtils;
    if (!IOUtils?.hasChildren) return 0;
    // hasChildren throws on a missing directory — treat as empty cache.
    if (IOUtils.exists && !(await IOUtils.exists(root))) return 0;
    if (!(await IOUtils.hasChildren(root))) return 0;

    // Collect every record file with its size and usedAt.
    const entries: Entry[] = [];
    let total = 0;
    for (const bucket of await statChildren(root)) {
      if (!bucket.isDirectory) continue;
      for (const f of await statChildren(bucket.path)) {
        if (f.isDirectory) continue;
        let usedAt = 0;
        try {
          const bytes = await IOUtils.read(f.path);
          const rec = JSON.parse(
            new TextDecoder().decode(bytes),
          ) as CacheRecord;
          usedAt = Number(rec?.usedAt) || 0;
        } catch {
          // Corrupt file: usedAt 0 makes it a prune priority.
        }
        entries.push({ path: f.path, size: f.size, usedAt });
        total += f.size;
      }
    }
    if (total <= maxBytes) return 0;

    entries.sort((a, b) => a.usedAt - b.usedAt); // oldest first
    let removed = 0;
    for (const entry of entries) {
      if (total <= maxBytes * 0.7) break; // prune to 70% of the cap
      try {
        await IOUtils.remove(entry.path);
        total -= entry.size;
        removed++;
      } catch {
        /* best-effort */
      }
    }
    return removed;
  } catch (e) {
    safeDebug("[z-search] translationCache prune failed: " + e);
    return 0;
  }
}

/** Best-effort full removal of the cache directory (uninstall). Never throws. */
export async function clearCacheDirectory(): Promise<void> {
  const root = cacheRoot();
  if (!root) return;
  try {
    const IOUtils = (globalThis as any).IOUtils;
    if (IOUtils?.remove) {
      await IOUtils.remove(root, { recursive: true });
    }
  } catch (e) {
    safeDebug("[z-search] translationCache clear failed: " + e);
  }
}
