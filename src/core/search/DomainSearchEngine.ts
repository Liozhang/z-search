/**
 * DomainSearchEngine — 学术子域搜索的统一总线。
 *
 * 五个子域（patent / dataset / researcher / grant / oa-fulltext）共用：
 *  1. 并发扇出：对 DomainDef.sources 中每个源调用 DomainSourceAdapter.search()
 *  2. 统一去重：按 DomainDef.dedupKey 合并跨源命中
 *  3. 域富集：调用 DomainDef.enrich(results)（如专利查同族、数据集补 DataCite）
 *  4. 库内标记：按去重键与 Zotero 库比对（复用 markInLibrary 模式）
 *  5. 失败归因：完全失败的源进 failedSources + failedReasons，缺 key 的进
 *     skippedNoKey——绝不谎报空结果
 *
 * 与 literature.search 的关系：literature.search 仍走 HubLiteratureHandler
 * 的现有路径（逐源并行 RPC）；域搜索走本总线，两者共存，互不影响。
 *
 * @module core/search/DomainSearchEngine
 */

import type {
  DomainResult,
  DomainSearchOptions,
  DomainDef,
  DomainSearchMetadata,
} from "./domainTypes";
import type { DomainSourceAdapter } from "./DomainSourceAdapter";
import { safeDebug } from "../../utils/logger";
import { toErrorMessage } from "../../utils/error";

/** 源适配器注册表（各域模块在注册时填充）。 */
const adapterRegistry = new Map<string, DomainSourceAdapter>();

/** 域定义注册表（DomainRegistry 初始化时填充）。 */
const domainRegistry = new Map<string, DomainDef>();

/** 注册一个源适配器。 */
export function registerDomainAdapter(adapter: DomainSourceAdapter): void {
  adapterRegistry.set(`${adapter.domainId}:${adapter.id}`, adapter);
}

/** 注册一个域定义。 */
export function registerDomain(def: DomainDef): void {
  domainRegistry.set(def.id, def);
}

/** 获取域定义（未注册返回 undefined）。 */
export function getDomainDef(domainId: string): DomainDef | undefined {
  return domainRegistry.get(domainId);
}

/** 获取域下的源适配器（未注册的源 id 跳过）。 */
function getAdaptersForDomain(domainId: string): DomainSourceAdapter[] {
  const def = domainRegistry.get(domainId);
  if (!def) return [];
  return def.sources
    .map((sid) => adapterRegistry.get(`${domainId}:${sid}`))
    .filter((a): a is DomainSourceAdapter => a !== undefined);
}

/** 分类源错误为原因码（对齐 literature.search 的 classifySourceError 口径）。 */
function classifyDomainError(err: unknown): string {
  const msg = toErrorMessage(err);
  if (/timeout|timed out/i.test(msg)) return "timeout";
  if (/429|rate.?limit/i.test(msg)) return "rate-limited";
  if (/401|403|unauthor|forbidden|api key/i.test(msg)) return "auth";
  if (/network|fetch|ECONN|ENOTFOUND/i.test(msg)) return "network";
  return "http";
}

/** 域搜索总入口。 */
export async function searchDomain(
  domainId: string,
  options: DomainSearchOptions,
): Promise<{ results: DomainResult[]; metadata: DomainSearchMetadata }> {
  const def = domainRegistry.get(domainId);
  if (!def) {
    throw new Error(`Domain not registered: ${domainId}`);
  }

  const adapters = getAdaptersForDomain(domainId);
  const maxResults = options.maxResults ?? 20;
  // 均分上限：每源 maxResults/sources.length，与 SearchPipeline.searchRound 同口径
  const perSourceLimit = Math.ceil(maxResults / (adapters.length || 1));

  const failedSources: string[] = [];
  const failedReasons: Record<string, string> = {};
  const skippedNoKey: string[] = [];
  const allResults: DomainResult[] = [];

  // 并发扇出：所有源同时发起（Promise.allSettled 覆盖单源失败）
  const promises = adapters.map(async (adapter) => {
    // 可用性检查：缺 key 的源进 skippedNoKey，不发起请求
    try {
      const avail = await adapter.isAvailable();
      if (!avail.available) {
        skippedNoKey.push(adapter.id);
        return [] as DomainResult[];
      }
    } catch (e) {
      skippedNoKey.push(adapter.id);
      safeDebug(
        `[z-search] DomainSearchEngine: ${domainId}/${adapter.id} availability check failed: ${toErrorMessage(e)}`,
      );
      return [] as DomainResult[];
    }

    try {
      const results = await adapter.search(
        options.query,
        perSourceLimit,
        options.filters,
      );
      return results;
    } catch (e) {
      failedSources.push(adapter.id);
      failedReasons[adapter.id] = classifyDomainError(e);
      safeDebug(
        `[z-search] DomainSearchEngine: ${domainId}/${adapter.id} search failed: ${toErrorMessage(e)}`,
      );
      return [] as DomainResult[];
    }
  });

  const settled = await Promise.allSettled(promises);
  for (const s of settled) {
    if (s.status === "fulfilled") {
      allResults.push(...s.value);
    } else {
      // 理论上已被 per-adapter try/catch 覆盖，防御性兜底
      safeDebug(
        `[z-search] DomainSearchEngine: ${domainId} unexpected rejection: ${toErrorMessage(s.reason)}`,
      );
    }
  }

  // ── 统一去重：按 dedupKey 合并，保留首次出现的源归属 ──
  const seen = new Map<string, DomainResult>();
  for (const r of allResults) {
    const key = def.dedupKey(r);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, r);
    } else {
      // 同键多源命中：合并 sources 数组（复用 ArticleResult 的 sources 语义）
      const existing = seen.get(key)!;
      const mergedSources = new Set([
        existing.source,
        ...(Array.isArray((existing as any).sources)
          ? (existing as any).sources
          : []),
        r.source,
      ]);
      (existing as any).sources = [...mergedSources];
    }
  }
  const deduped = [...seen.values()];

  // ── 域富集（best-effort，吞错不阻断）──
  if (def.enrich) {
    try {
      await def.enrich(deduped);
    } catch (e) {
      safeDebug(
        `[z-search] DomainSearchEngine: ${domainId} enrich failed: ${toErrorMessage(e)}`,
      );
    }
  }

  // ── 库内标记（按去重键比对，复用 markInLibrary 的 DOI 路径）──
  await markInLibraryByDomain(domainId, deduped);

  // 截断到 maxResults
  const page = deduped.slice(0, maxResults);

  return {
    results: page,
    metadata: {
      totalSearched: allResults.length,
      totalReturned: page.length,
      failedSources,
      failedReasons,
      skippedNoKey,
    },
  };
}

/**
 * 域详情查询（profile 用）。
 * 对 DomainDef.sources 中每个支持 profile() 的适配器依次尝试，返回首个非空。
 */
export async function getDomainProfile(
  domainId: string,
  sourceId: string,
): Promise<DomainResult | null> {
  const adapter = adapterRegistry.get(`${domainId}:${sourceId}`);
  if (!adapter) return null;
  try {
    const avail = await adapter.isAvailable();
    if (!avail.available) return null;
    return await adapter.profile(sourceId);
  } catch (e) {
    safeDebug(
      `[z-search] DomainSearchEngine: ${domainId}/${adapter.id} profile failed: ${toErrorMessage(e)}`,
    );
    return null;
  }
}

/**
 * 库内标记：按去重键与 Zotero 库比对。
 * patent → Zotero.Search by patentNumber
 * dataset/grant → Zotero.Search by DOI（有则）
 * researcher → Zotero.Search by Extra ORCID（不直接支持，走 title 兜底）
 * oa-fulltext → Zotero.Search by DOI
 * best-effort——任何异常整段跳过。
 */
async function markInLibraryByDomain(
  domainId: string,
  results: DomainResult[],
): Promise<void> {
  try {
    if (domainId === "patent") {
      const numbers = [
        ...new Set(
          results
            .map((r) => r.patentNumber?.toLowerCase().trim())
            .filter((n): n is string => !!n),
        ),
      ];
      if (numbers.length === 0) return;
      const found = new Set<string>();
      const CONCURRENCY = 8;
      for (let i = 0; i < numbers.length; i += CONCURRENCY) {
        const chunk = numbers.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (num) => {
            try {
              const s = new Zotero.Search();
              s.addCondition("patentNumber", "is", num);
              const ids = await s.search();
              if (ids?.length) found.add(num);
            } catch {
              /* 单条失败不影响其余 */
            }
          }),
        );
      }
      for (const r of results) {
        const n = r.patentNumber?.toLowerCase().trim();
        if (n && found.has(n)) r.inLibrary = true;
      }
      return;
    }

    // dataset / grant / oa-fulltext：DOI 路径（复用文献检索的 markInLibrary 口径）
    const dois = [
      ...new Set(
        results
          .map((r) => r.doi?.toLowerCase().trim())
          .filter((d): d is string => !!d),
      ),
    ];
    if (dois.length === 0) return;
    const found = new Set<string>();
    const CONCURRENCY = 8;
    for (let i = 0; i < dois.length; i += CONCURRENCY) {
      const chunk = dois.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (doi) => {
          try {
            const s = new Zotero.Search();
            s.addCondition("DOI", "is", doi);
            const ids = await s.search();
            if (ids?.length) found.add(doi);
          } catch {
            /* 单条失败不影响其余 */
          }
        }),
      );
    }
    for (const r of results) {
      const d = r.doi?.toLowerCase().trim();
      if (d && found.has(d)) r.inLibrary = true;
    }
  } catch (e) {
    safeDebug(`[z-search] DomainSearchEngine.markInLibrary failed: ${e}`);
    /* best-effort */
  }
}
