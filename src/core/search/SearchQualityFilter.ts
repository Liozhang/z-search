/**
 * SearchQualityFilter — Low-quality source memory for search pipeline
 *
 * Persists records of low-quality domains and terms across sessions.
 * Used by SearchPipeline to build query exclusion operators.
 * Persists via Zotero.Prefs for cross-session storage.
 */

import { getPrefDynamic, setPrefDynamic } from "../../utils/prefs";
import { safeDebug } from "../../utils/logger";

export interface QualityRecord {
  domain: string;
  reason: string;
  score: number;
  timestamp: number;
}

const PREF_KEY = "search.qualityMemory";
const MAX_RECORDS = 100;
const PRUNE_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const PREF_KEY_HIGH = "search.qualityMemory.high";
const MAX_RECORDS_HIGH = 100;

class QualityMemory {
  private cache: QualityRecord[] | null = null;

  private load(): QualityRecord[] {
    if (this.cache) return this.cache;
    try {
      const raw = getPrefDynamic(PREF_KEY) as string;
      this.cache = raw ? JSON.parse(raw) : [];
    } catch (e) {
      safeDebug("[z-search] SearchQualityFilter.load failed: " + e);
      this.cache = [];
    }
    return this.cache!;
  }

  private save(records: QualityRecord[]): void {
    this.cache = records;
    setPrefDynamic(PREF_KEY, JSON.stringify(records));
  }

  /**
   * Record a low-quality domain.
   * Deduplicates by domain, keeping the most recent entry.
   */
  recordLowQuality(domain: string, reason: string, score: number): void {
    if (!domain) return;
    const normalized = domain.toLowerCase().trim();
    const records = this.load();

    const filtered = records.filter((r) => r.domain !== normalized);
    filtered.push({
      domain: normalized,
      reason,
      score,
      timestamp: Date.now(),
    });

    // LRU eviction: keep most recent MAX_RECORDS
    if (filtered.length > MAX_RECORDS) {
      filtered.sort((a, b) => b.timestamp - a.timestamp);
      filtered.length = MAX_RECORDS;
    }

    this.save(filtered);
  }

  /**
   * Record a high-quality domain for future search boosting.
   * Complements recordLowQuality — positive feedback to complement negative feedback.
   */
  private highQualityCache: QualityRecord[] | null = null;

  private loadHigh(): QualityRecord[] {
    if (this.highQualityCache) return this.highQualityCache;
    try {
      const raw = getPrefDynamic(PREF_KEY_HIGH) as string;
      this.highQualityCache = raw ? JSON.parse(raw) : [];
    } catch (e) {
      safeDebug("[z-search] SearchQualityFilter.loadHigh failed: " + e);
      this.highQualityCache = [];
    }
    return this.highQualityCache!;
  }

  private saveHigh(records: QualityRecord[]): void {
    this.highQualityCache = records;
    setPrefDynamic(PREF_KEY_HIGH, JSON.stringify(records));
  }

  recordHighQuality(domain: string, reason: string, score: number): void {
    if (!domain) return;
    const normalized = domain.toLowerCase().trim();
    const records = this.loadHigh();

    const filtered = records.filter((r) => r.domain !== normalized);
    filtered.push({
      domain: normalized,
      reason,
      score,
      timestamp: Date.now(),
    });

    // LRU eviction
    if (filtered.length > MAX_RECORDS_HIGH) {
      filtered.sort((a, b) => b.timestamp - a.timestamp);
      filtered.length = MAX_RECORDS_HIGH;
    }

    this.saveHigh(filtered);
  }

  getHighQualityDomains(): string[] {
    const records = this.loadHigh();
    const cutoff = Date.now() - PRUNE_AGE_MS;
    return records.filter((r) => r.timestamp > cutoff).map((r) => r.domain);
  }

  pruneHigh(): void {
    const records = this.loadHigh();
    const cutoff = Date.now() - PRUNE_AGE_MS;
    const pruned = records.filter((r) => r.timestamp > cutoff);
    if (pruned.length < records.length) {
      this.saveHigh(pruned);
    }
  }

  /**
   * Get all low-quality domain strings.
   */
  getLowQualityDomains(): string[] {
    const records = this.load();
    // Only include records from last 90 days
    const cutoff = Date.now() - PRUNE_AGE_MS;
    return records.filter((r) => r.timestamp > cutoff).map((r) => r.domain);
  }

  /**
   * Build search exclusion operators from low-quality memory.
   * Returns a string like: "-site:spam.com -site:ads.net"
   * Only valid for web search engines — NOT for academic APIs.
   */
  buildWebExclusionOperators(): string {
    const domains = this.getLowQualityDomains();
    if (domains.length === 0) return "";
    // Limit to top 10 to avoid overly long queries
    return domains
      .slice(0, 10)
      .map((d) => `-site:${d}`)
      .join(" ");
  }

  /**
   * Get low-quality domain list for academic API post-filtering.
   * Academic APIs don't support -site: operators, so domains are
   * filtered after results are returned.
   */
  getExcludedDomains(): string[] {
    return this.getLowQualityDomains();
  }

  /**
   * Prune records older than 90 days.
   */
  prune(): void {
    const records = this.load();
    const cutoff = Date.now() - PRUNE_AGE_MS;
    const pruned = records.filter((r) => r.timestamp > cutoff);
    if (pruned.length < records.length) {
      this.save(pruned);
    }
    this.pruneHigh();
  }

  /**
   * Get total record count.
   */
  get count(): number {
    return this.load().length;
  }
}

const qualityMemory = new QualityMemory();
export default qualityMemory;
export { QualityMemory };
