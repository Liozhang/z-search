/**
 * LRU cache for AI analysis and document processing results
 *
 * Performance optimization through intelligent caching of AI analysis results
 */

import { safeDebug } from "../../utils/logger";

interface CacheEntry<T = any> {
  key: string;
  value: T;
  timestamp: number;
  ttl?: number; // Time to live in milliseconds
  size: number; // Estimated size in bytes
  accessCount: number;
  lastAccess: number;
  /** Doubly-linked list node for O(1) LRU ordering. head = MRU, tail = LRU. */
  lruNode?: LRUNode;
}

/**
 * Doubly-linked list node for O(1) LRU eviction.
 * The list is ordered most-recently-used (head) → least-recently-used (tail).
 */
interface LRUNode {
  key: string;
  prev: LRUNode | null;
  next: LRUNode | null;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  count: number;
}

interface CacheConfig {
  maxSize: number; // Maximum cache size in bytes
  maxEntries: number; // Maximum number of entries
  defaultTTL: number; // Default TTL in milliseconds
  compressionEnabled: boolean; // Enable compression for large values
}

class AICacheManager {
  public cache: Map<string, CacheEntry> = new Map();
  /** LRU doubly-linked list sentinels. head.next = MRU, tail.prev = LRU victim. */
  private lruHead: LRUNode = { key: "__head__", prev: null, next: null };
  private lruTail: LRUNode = { key: "__tail__", prev: null, next: null };
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
    count: 0,
  };
  private config: CacheConfig = {
    maxSize: 50 * 1024 * 1024, // 50MB default
    maxEntries: 1000,
    defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
    compressionEnabled: true,
  };
  private initialized = false;
  private periodicSaveTimer: number | null = null;
  private cacheFilePath = "";
  /** Deduplicates concurrent saveToStorage calls — only one write is in flight at a time. */
  private savePromise: Promise<void> | null = null;
  /** Monotonic counter bumped by clear(); lets an in-flight save detect that its
   *  data was invalidated mid-write and clean up the stale file. */
  private writeGeneration = 0;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Wire up the LRU sentinel list (empty: head <-> tail).
    this.lruHead.next = this.lruTail;
    this.lruTail.prev = this.lruHead;

    try {
      // Use file-based storage instead of Zotero.Prefs
      // (Zotero warns when >4KB is written to prefs)
      this.cacheFilePath = PathUtils.join(
        Zotero.DataDirectory.dir,
        "zsearch-ai-cache.json",
      );

      // One-time migration: move data from old pref to file
      await this.migrateFromPrefs();

      // Load cache from file if available
      await this.loadFromStorage();

      this.startPeriodicSave();

      this.initialized = true;
    } catch (e) {
      safeDebug("[z-search] AICache init error: " + e);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.delete(key); // also detaches the LRU node
      this.stats.misses++;
      this.stats.evictions++;
      return null;
    }

    entry.accessCount++;
    entry.lastAccess = Date.now();
    if (entry.lruNode) this.lruTouch(entry.lruNode);

    this.stats.hits++;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const size = this.estimateSize(value);

    // If updating an existing key, account for the size delta and reuse its
    // existing LRU node (touched below) instead of leaking a detached one.
    // Note: entry COUNT is unchanged on update, so the maxEntries check in
    // ensureCapacity is skipped (only maxSize/byte-budget matters here).
    const existing = this.cache.get(key);
    if (existing) {
      const sizeDelta = size - existing.size;
      if (sizeDelta > 0) {
        while (
          this.stats.size + sizeDelta > this.config.maxSize &&
          this.cache.size > 0
        ) {
          await this.evictOne();
        }
      }
      // H-4: keep byte accounting in sync when overwriting an existing
      // entry — without this, repeated set()s on the same key drift
      // stats.size (under-count on growth → cache exceeds maxSize).
      this.stats.size += sizeDelta;
      existing.value = value;
      existing.size = size;
      existing.timestamp = Date.now();
      // M-23: an update without an explicit ttl must not SHORTEN the existing
      // entry's ttl (a 24h-default refresh used to downgrade AutoAnalyzer's
      // 7-day full-text cache). Passing an explicit ttl still applies.
      existing.ttl = ttl ?? existing.ttl ?? this.config.defaultTTL;
      existing.lastAccess = Date.now();
      if (existing.lruNode) this.lruTouch(existing.lruNode);
      return;
    }

    // New entry: enforce both byte-budget and entry-count capacity.
    await this.ensureCapacity(size);

    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      ttl: ttl || this.config.defaultTTL,
      size,
      accessCount: 0,
      lastAccess: Date.now(),
    };
    const node: LRUNode = { key, prev: null, next: null };
    entry.lruNode = node;
    this.lruPushFront(node);

    this.cache.set(key, entry as CacheEntry);
    this.stats.size += size;
    this.stats.count = this.cache.size;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.stats.size -= entry.size;
      this.stats.count = this.cache.size - 1;
      if (entry.lruNode) this.lruDetach(entry.lruNode);
    }

    return this.cache.delete(key);
  }

  clear(): void {
    this.stopPeriodicSave();
    // Invalidate any in-flight save so it doesn't resurrect old data.
    this.writeGeneration++;
    this.savePromise = null;
    this.cache.clear();
    this.stats.size = 0;
    this.stats.count = 0;

    // Reset the LRU list to empty (head <-> tail).
    this.lruHead.next = this.lruTail;
    this.lruTail.prev = this.lruHead;

    // Delete cache file
    if (this.cacheFilePath) {
      IOUtils.remove(this.cacheFilePath).catch((e) => {
        safeDebug("[z-search] AICache: cache file removal failed: " + e);
      });
    }

    // Migrate: clear old pref data if present
    try {
      Zotero.Prefs.clear("extensions.zotero.zsearch.aiCache");
    } catch (_) {
      safeDebug("[z-search] AICache: clear old pref data failed: " + _);
    }

    // Restart periodic save so new entries are persisted.
    // Without this, clear() permanently stopped the timer and all subsequent
    // writes lived only in memory until shutdown.
    if (this.initialized) {
      this.startPeriodicSave();
    }
  }

  // head.next = most-recently-used, tail.prev = least-recently-used (victim).

  /** Detach a node from the list (does not touch the Map). */
  private lruDetach(node: LRUNode): void {
    // Defensive: a node can be detached twice if it was reaped by an alternate
    // path (e.g. TTL expiry in get/has). Guard against null prev/next.
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    node.prev = null;
    node.next = null;
  }

  /** Insert a node right after head (mark most-recently-used). */
  private lruPushFront(node: LRUNode): void {
    node.prev = this.lruHead;
    node.next = this.lruHead.next;
    this.lruHead.next!.prev = node;
    this.lruHead.next = node;
  }

  /** Move an existing node to the front (most-recently-used). */
  private lruTouch(node: LRUNode): void {
    if (this.lruHead.next === node) return; // already MRU
    this.lruDetach(node);
    this.lruPushFront(node);
  }

  private estimateSize(value: any): number {
    if (typeof value === "string") {
      return value.length * 2; // UTF-16
    }
    if (typeof value === "number") {
      return 8;
    }
    if (typeof value === "boolean") {
      return 1;
    }
    if (Array.isArray(value)) {
      return value.reduce((sum, item) => sum + this.estimateSize(item), 0);
    }
    if (typeof value === "object" && value !== null) {
      return Object.keys(value).reduce(
        (sum, key) =>
          sum + this.estimateSize(key) + this.estimateSize(value[key]),
        0,
      );
    }
    return 0;
  }

  private async ensureCapacity(requiredSize: number): Promise<void> {
    while (
      this.stats.size + requiredSize > this.config.maxSize &&
      this.cache.size > 0
    ) {
      await this.evictOne();
    }

    while (this.cache.size >= this.config.maxEntries) {
      await this.evictOne();
    }
  }

  private async evictOne(): Promise<void> {
    // O(1) eviction: the tail sentinel's prev is the least-recently-used entry.
    // Replaces the former O(N) full scan for the smallest lastAccess.
    const lruNode = this.lruTail.prev;
    if (!lruNode || lruNode === this.lruHead) return; // empty list

    this.delete(lruNode.key);
    this.stats.evictions++;
  }

  /**
   * One-time migration from Zotero.Prefs to file-based storage.
   */
  private async migrateFromPrefs(): Promise<void> {
    try {
      const oldData = Zotero.Prefs.get(
        "extensions.zotero.zsearch.aiCache",
      ) as string;
      if (oldData && !(await IOUtils.exists(this.cacheFilePath))) {
        await IOUtils.writeUTF8(this.cacheFilePath, oldData);
        Zotero.Prefs.clear("extensions.zotero.zsearch.aiCache");
      }
    } catch (_) {
      safeDebug("[z-search] AICache: migrateFromPrefs failed: " + _);
    }
  }

  private async loadFromStorage(): Promise<void> {
    try {
      if (!this.cacheFilePath || !(await IOUtils.exists(this.cacheFilePath)))
        return;

      const cachedJSON = await IOUtils.readUTF8(this.cacheFilePath);
      if (cachedJSON) {
        const cached = JSON.parse(cachedJSON);
        const now = Date.now();
        const loaded: CacheEntry[] = [];

        for (const [key, entry] of Object.entries(cached)) {
          const e = entry as CacheEntry;
          if (!e.ttl || now - e.timestamp < e.ttl) {
            this.cache.set(key, e);
            this.stats.size += e.size;
            loaded.push(e);
          }
        }

        // Rebuild the LRU list from persisted lastAccess timestamps
        // (most-recent first), so eviction order survives restart.
        loaded.sort((a, b) => b.lastAccess - a.lastAccess);
        for (const e of loaded) {
          const node: LRUNode = { key: e.key, prev: null, next: null };
          e.lruNode = node;
          this.lruPushFront(node);
        }

        this.stats.count = this.cache.size;
      }
    } catch (e) {
      safeDebug("[z-search] AICache load error: " + e);
    }
  }

  private async saveToStorage(): Promise<void> {
    // Deduplicate: concurrent calls piggyback on the in-flight save.
    // The periodic timer fires every 5 min, so at most one extra save is queued.
    if (this.savePromise) return this.savePromise;
    this.savePromise = this._persistCache();
    try {
      await this.savePromise;
    } finally {
      this.savePromise = null;
    }
  }

  private async _persistCache(): Promise<void> {
    const gen = ++this.writeGeneration;
    try {
      if (!this.cacheFilePath) return;
      // Strip the non-serializable LRU node pointers before persisting.
      // (lruNode has circular prev/next refs that would break JSON.stringify.)
      const cacheObj: Record<string, any> = {};
      for (const [key, entry] of this.cache.entries()) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { lruNode, ...serializable } = entry;
        cacheObj[key] = serializable;
      }
      const cacheJSON = JSON.stringify(cacheObj);
      await IOUtils.writeUTF8(this.cacheFilePath, cacheJSON);
      // If clear() bumped the generation during the async write, the file we
      // just wrote contains stale data — remove it to prevent "resurrection".
      if (gen !== this.writeGeneration) {
        try {
          await IOUtils.remove(this.cacheFilePath);
        } catch (e) {
          safeDebug(
            "[z-search] AICache: stale cache file removal failed: " + e,
          );
        }
      }
    } catch (e) {
      safeDebug("[z-search] AICache save error: " + e);
    }
  }

  private startPeriodicSave(): void {
    this.periodicSaveTimer = setInterval(
      () => {
        this.saveToStorage();
      },
      5 * 60 * 1000,
    ) as any;
  }

  stopPeriodicSave(): void {
    if (this.periodicSaveTimer !== null) {
      clearInterval(this.periodicSaveTimer);
      this.periodicSaveTimer = null;
    }
  }

  /**
   * Flush the in-memory cache to storage immediately. Used on quit (the
   * APP_SHUTDOWN path skips the normal shutdown, so the periodic timer would
   * otherwise be killed without a final write).
   */
  async flushNow(): Promise<void> {
    this.stopPeriodicSave();
    // Wait for any in-flight periodic save, then do a fresh save to capture
    // the latest state (the in-flight save may have serialized before recent writes).
    if (this.savePromise) await this.savePromise;
    await this._persistCache();
  }
}

export const CacheKeys = {
  fulltext: (itemID: number) => `content:fulltext:${itemID}`,
  // M-23: scope suffix — the same itemId previously shared ONE key between
  // "first 50 pages" (context budget / structure tools, 24h) and "full text"
  // (AutoAnalyzer, 7 days) writers, so readers got whichever semantics
  // happened to land first (truncated results fed full-text consumers).
  odlMarkdown: (itemID: number, scope: "full" | "50p") =>
    `content:odl:${itemID}:${scope}`,
  paperStructure: (itemID: number, mode: string) =>
    `analysis:structure:${itemID}:${mode}`,
  // P1-D：结构化全文 XML（TEI/JATS）正负缓存（source: 'pmc' | 'openalex'）
  structuredXml: (source: string, doi: string) =>
    `content:structured-xml:${source}:${doi}`,
  // DecisionService（System 1/JEV 类）：键入参为问题集+状态的规范化哈希
  decision: (stateHash: string) => `ai:decision:${stateHash}`,
};

export async function invalidateItem(itemID: number): Promise<void> {
  // Old-format keys (model-less) — delete exact matches for backward compat.
  cache.delete(`ai:analysis:${itemID}`);
  cache.delete(`ai:summary:${itemID}`);
  cache.delete(`ai:keywords:${itemID}`);
  cache.delete(`ai:related:${itemID}`);
  cache.delete(CacheKeys.fulltext(itemID));
  // M-23: both scope variants, plus the legacy un-suffixed key until its
  // entries TTL out.
  cache.delete(CacheKeys.odlMarkdown(itemID, "full"));
  cache.delete(CacheKeys.odlMarkdown(itemID, "50p"));
  cache.delete(`content:odl:${itemID}`);
  // Legacy key from the removed native converter — clean up old entries.
  cache.delete(`content:nativemd:${itemID}`);
  cache.delete(CacheKeys.paperStructure(itemID, "heading"));
  cache.delete(CacheKeys.paperStructure(itemID, "ai"));

  // New-format keys (with model dimension) — delete all model variants.
  for (const key of cache.cache.keys()) {
    if (
      key.startsWith(`ai:analysis:${itemID}:`) ||
      key.startsWith(`ai:summary:${itemID}:`) ||
      key.startsWith(`ai:keywords:${itemID}:`) ||
      key.startsWith(`ai:related:${itemID}:`)
    ) {
      cache.delete(key);
    }
  }

  // Invalidate embeddings (multiple models)
  for (const key of cache.cache.keys()) {
    if (key.startsWith(`ai:embedding:${itemID}:`)) {
      cache.delete(key);
    }
  }
}

const cache = new AICacheManager();

export default cache;
export { AICacheManager };
