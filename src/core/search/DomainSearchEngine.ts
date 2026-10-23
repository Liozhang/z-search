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
 * 两个横向机制：
 *  - 跨域源：DomainDef.sources 可引用归属其他域的适配器（经源 id 全局
 *    索引解析）——数据集标签页的学科分组引用 bio/chemistry/geoscience/
 *    social-science 域的 geo/pubchem/pangaea/icpsr
 *  - filters.sources 收敛：前端学科分组显式列出源 id 时，只向这些源扇出；
 *    filters.year 在去重后按结果年份统一收口（覆盖上游不支持日期参数的源）
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
  DomainFilters,
} from "./domainTypes";
import type { DomainSourceAdapter } from "./DomainSourceAdapter";
import { safeDebug } from "../../utils/logger";
import { toErrorMessage } from "../../utils/error";

/** 源适配器注册表（各域模块在注册时填充）。 */
const adapterRegistry = new Map<string, DomainSourceAdapter>();

/**
 * 源 id → 适配器的跨域索引。
 * 一个源只归属一个域（adapter.domainId），但可以被其他域的 sources 列表
 * 引用——数据集标签页的生命科学/化学/地球科学/社会科学学科分组就引用
 * 了归属 bio/chemistry/geoscience/social-science 域的 geo/pubchem/
 * pangaea/icpsr。域内键（domainId:id）优先，此索引兜底。
 */
const adapterBySourceId = new Map<string, DomainSourceAdapter>();

/** 域定义注册表（DomainRegistry 初始化时填充）。 */
const domainRegistry = new Map<string, DomainDef>();

/** 注册一个源适配器。 */
export function registerDomainAdapter(adapter: DomainSourceAdapter): void {
  adapterRegistry.set(`${adapter.domainId}:${adapter.id}`, adapter);
  // 每个源 id 全局只注册一次；重复注册时保留先注册者，后注册者仍可用
  // 域内键（domainId:id）直达
  if (!adapterBySourceId.has(adapter.id)) {
    adapterBySourceId.set(adapter.id, adapter);
  }
}

/** 注册一个域定义。 */
export function registerDomain(def: DomainDef): void {
  domainRegistry.set(def.id, def);
}

/** 获取域定义（未注册返回 undefined）。 */
export function getDomainDef(domainId: string): DomainDef | undefined {
  return domainRegistry.get(domainId);
}

/** 按源 id 反查适配器（跨域；未注册返回 undefined）。 */
export function getAdapterBySourceId(
  sourceId: string,
): DomainSourceAdapter | undefined {
  return adapterBySourceId.get(sourceId);
}

/**
 * 按搜索结果的 source 反查其归属域定义。
 * 跨域源（如数据集标签页里的 geo）的 Extra 字段映射以归属域为准——
 * GEO 的 Accession/Platform/Organism 字段写在 bio 域定义里，用标签页
 * 域（dataset）的 buildExtraFields 会把这些字段丢掉。
 */
export function getDomainDefForResult(
  result: DomainResult,
): DomainDef | undefined {
  const adapter = adapterBySourceId.get(result.source);
  if (!adapter) return undefined;
  return domainRegistry.get(adapter.domainId);
}

/** 获取域下的源适配器（未注册的源 id 跳过；跨域注册的源经全局索引解析）。 */
function getAdaptersForDomain(domainId: string): DomainSourceAdapter[] {
  const def = domainRegistry.get(domainId);
  if (!def) return [];
  return def.sources
    .map(
      (sid) =>
        adapterRegistry.get(`${domainId}:${sid}`) ?? adapterBySourceId.get(sid),
    )
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

/** 解析 "2020-2024" / "2020" 形式的年份范围；无法解析返回 null（不过滤）。 */
function parseYearRange(
  year: string | undefined,
): { start: number; end: number } | null {
  if (!year) return null;
  const parts = year
    .split("-")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { start: parts[0], end: parts[0] };
  return { start: Math.min(...parts), end: Math.max(...parts) };
}

/** 结果年份是否落在范围内；年份缺失或不可解析视为不在范围内。 */
function isYearInRange(
  year: string | undefined,
  range: { start: number; end: number },
): boolean {
  if (!year) return false;
  const m = /(\d{4})/.exec(year);
  if (!m) return false;
  const y = parseInt(m[1], 10);
  return y >= range.start && y <= range.end;
}

/** 高级筛选键（capability 闸与后过滤共用的名单；年份除外）。 */
const ADVANCED_FILTER_KEYS = [
  "license",
  "oaType",
  "taskTags",
  "country",
] as const;

/** 许可证原始字符串 → 规范键（与前端学科选项 value 同一词汇表）。 */
function normalizeLicenseKey(raw: string | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "other";
  if (/cc0|public.?domain|\bzero\b/.test(s)) return "cc0";
  // 变体从长到短判：by-nc-sa 先于 by-nc / by-sa，避免子串误判
  if (/by-nc-sa/.test(s)) return "cc-by-nc-sa";
  if (/by-nc/.test(s)) return "cc-by-nc";
  if (/by-sa/.test(s)) return "cc-by-sa";
  if (/by/.test(s)) return "cc-by";
  return "other";
}

/**
 * 高级筛选后过滤：license（规范化后精确匹配）、oaType（精确）、
 * taskTags（任一命中即保留——多选并集口径）、country（子串包含）。
 * 能力闸保证被查询的源都产出相应字段；此处是统一的语义收口点。
 */
function createAdvancedFilterPredicates(
  filters: DomainFilters | undefined,
): Array<(r: DomainResult) => boolean> {
  const predicates: Array<(r: DomainResult) => boolean> = [];
  if (filters?.license) {
    const wanted = filters.license;
    predicates.push((r) => normalizeLicenseKey(r.extra?.license) === wanted);
  }
  if (filters?.oaType) {
    const wanted = filters.oaType.toLowerCase();
    predicates.push((r) => (r.extra?.oaType ?? "").toLowerCase() === wanted);
  }
  const wantedTaskTags = filters?.taskTags;
  if (Array.isArray(wantedTaskTags) && wantedTaskTags.length > 0) {
    const wanted = wantedTaskTags.map((t: string) => t.toLowerCase());
    predicates.push((r) => {
      const tags = (
        Array.isArray(r.extra?.taskTags) ? r.extra.taskTags : []
      ).map((t: unknown) => String(t).toLowerCase());
      return wanted.some((w: string) => tags.some((t) => t.includes(w)));
    });
  }
  if (filters?.country) {
    const wanted = filters.country.toLowerCase();
    predicates.push((r) =>
      (r.extra?.geographicCoverage ?? "").toLowerCase().includes(wanted),
    );
  }
  return predicates;
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

  // 学科收敛：前端按学科分组显式带来 sources 时，只扇出到这些源——
  // 未列出源不发起请求（学科选择器的承诺在这里落地）。
  const allowedSources = options.filters?.sources;
  const narrowed =
    Array.isArray(allowedSources) && allowedSources.length > 0
      ? adapters.filter((a) => allowedSources.includes(a.id))
      : adapters;

  // 高级筛选能力闸：激活了 license/oaType/taskTags/country 之一而源不支持
  // 时跳过该源（显式归因），不让无法应用筛选的源把未过滤结果混进列表。
  const activeAdvanced = ADVANCED_FILTER_KEYS.filter((k) => {
    const v = (options.filters as Record<string, unknown> | undefined)?.[k];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });
  const skippedNoFilter: string[] = [];
  const fanout =
    activeAdvanced.length === 0
      ? narrowed
      : narrowed.filter((a) => {
          const supported = a.supportedFilters ?? [];
          if (activeAdvanced.every((k) => supported.includes(k))) return true;
          skippedNoFilter.push(a.id);
          return false;
        });

  // 均分上限：每源 maxResults/sources.length，与 SearchPipeline.searchRound 同口径
  const perSourceLimit = Math.ceil(maxResults / (fanout.length || 1));

  const failedSources: string[] = [];
  const failedReasons: Record<string, string> = {};
  const skippedNoKey: string[] = [];
  const allResults: DomainResult[] = [];

  // 并发扇出：所有源同时发起（Promise.allSettled 覆盖单源失败）
  const promises = fanout.map(async (adapter) => {
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

  // 后过滤：年份（所有源统一收口）+ 高级筛选（license/oaType/taskTags/
  // country，语义见 createAdvancedFilterPredicates）。服务端已过滤的源
  // 在此为无操作。
  const yearRange = parseYearRange(options.filters?.year);
  const advancedPredicates = createAdvancedFilterPredicates(options.filters);
  const passes = (r: DomainResult): boolean =>
    (!yearRange || isYearInRange(r.year, yearRange)) &&
    advancedPredicates.every((p) => p(r));
  const filtered = deduped.filter(passes);

  // ── 域富集（best-effort，吞错不阻断）──
  if (def.enrich) {
    try {
      await def.enrich(filtered);
    } catch (e) {
      safeDebug(
        `[z-search] DomainSearchEngine: ${domainId} enrich failed: ${toErrorMessage(e)}`,
      );
    }
  }

  // ── 库内标记（按去重键比对，复用 markInLibrary 的 DOI 路径）──
  await markInLibraryByDomain(domainId, filtered);

  // 截断到 maxResults
  const page = filtered.slice(0, maxResults);

  return {
    results: page,
    metadata: {
      totalSearched: allResults.length,
      totalReturned: page.length,
      failedSources,
      failedReasons,
      skippedNoKey,
      skippedNoFilter,
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
  const adapter =
    adapterRegistry.get(`${domainId}:${sourceId}`) ??
    adapterBySourceId.get(sourceId);
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
