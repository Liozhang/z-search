/**
 * JournalSearchService — aggregates local journal DBs + OpenAlex for the
 * Hub "Journal" search tab.
 *
 * Three modes (mirroring the UI segmented control):
 *   - 'metric'   : full quality card for one journal (name or ISSN). Local
 *                  JCR/CASS/Warning/Bealls first; falls back to OpenAlex
 *                  /sources when nothing local matches.
 *   - 'discover' : keyword search over OpenAlex /sources, enriched with any
 *                  local quality signals (JCR/CASS/Warning/Bealls) that match
 *                  by ISSN/name.
 *   - 'library'  : in-Zotero-library journal statistics — counts papers per
 *                  publicationTitle, enriches top-N with local metrics.
 *
 * Reads-only against the four local tables; does not mutate them. Does not
 * depend on the agent-tool layer (analyzeLibraryJournals is unexported, so the
 * library scan is reimplemented inline to avoid coupling).
 *
 * @module core/search/JournalSearchService
 */

import JCRStore from "../data/JCRStore";
import CASSStore from "../data/CASSStore";
import WarningListStore from "../data/WarningListStore";
import BeallsListStore from "../data/BeallsListStore";
import OpenAlexJournalCacheStore from "../data/OpenAlexJournalCacheStore";
import { normalizeJournalName, normalizeISSN } from "../data/utils/normalize";
import {
  searchOpenAlexSources,
  type OpenAlexJournal,
} from "../sources/academic-search";
import type {
  JournalListItem,
  JournalMetric,
  JournalSearchPayload,
  JournalSearchResult,
  JournalSortBy,
} from "../../types/journalSearch";
import { safeDebug } from "../../utils/logger";

/** ISSN pattern: 8 digits with optional dash and X check digit. */
const ISSN_RE = /^\d{4}-?\d{3}[\dXx]$/;

/** JCR 分区清洗：只放行 Q1-Q4——"N/A"（2,085 行）流入模板串会渲染裸
 *  locale key（lit-quartile-jcr-q/A）。 */
function cleanQuartile(q?: string | null): string | undefined {
  return q && /^Q[1-4]$/.test(q) ? q : undefined;
}

/** 预警级别按界面语言取值（审计 P2-5）：en 界面优先 warning_level_en
 *  （High/Medium/Low），中文界面优先 warning_level；缺失回退另一侧，
 *  再缺回退 ⚠（记录存在即告警）。 */
function pickWarningLevel(
  rec: {
    warning_level?: string | null;
    warning_level_en?: string | null;
  } | null,
): string | undefined {
  if (!rec) return undefined;
  const en = String((Zotero as any).locale ?? "")
    .toLowerCase()
    .startsWith("en");
  const primary = en ? rec.warning_level_en : rec.warning_level;
  const secondary = en ? rec.warning_level : rec.warning_level_en;
  return primary ?? secondary ?? "⚠";
}

function isISSN(s: string): boolean {
  return ISSN_RE.test(s.trim());
}

class JournalSearchService {
  /**
   * Dispatch a journal search request to the right mode handler.
   */
  async search(payload: JournalSearchPayload): Promise<JournalSearchResult> {
    switch (payload.mode) {
      case "metric":
        return this.searchMetric(payload);
      case "discover":
        return this.searchDiscover(payload);
      case "library":
        return this.searchLibrary(payload);
      default:
        return { mode: payload.mode, metric: null, list: [] };
    }
  }

  private async searchMetric(
    payload: JournalSearchPayload,
  ): Promise<JournalSearchResult> {
    const raw = (payload.query ?? "").trim();
    if (!raw) return { mode: "metric", metric: null };

    const metric = await this.aggregateJournalMetric(raw);
    return { mode: "metric", metric };
  }

  /**
   * Build a full JournalMetric for a name or ISSN. Probes all four local
   * tables in parallel; if any hits, returns a local-sourced metric. If all
   * miss, falls back to OpenAlex /sources by ISSN (preferred) or name search.
   */
  private async aggregateJournalMetric(
    query: string,
  ): Promise<JournalMetric | null> {
    const input = query.trim();
    const inputIsISSN = isISSN(input);

    // First pass: JCR/CASS by ISSN-or-name, plus Warning/Bealls by name.
    // (Warning table has no ISSN column; Bealls matches by title — so when the
    //  user typed an ISSN, we can't probe them until JCR/CASS gives us a name.)
    const [jcr, cass] = await Promise.all([
      JCRStore.lookup({
        issn: inputIsISSN ? input : undefined,
        eissn: inputIsISSN ? input : undefined,
        journalName: inputIsISSN ? undefined : input,
      }),
      CASSStore.lookup({
        issn: inputIsISSN ? input : undefined,
        eissn: inputIsISSN ? input : undefined,
        journalName: inputIsISSN ? undefined : input,
      }),
    ]);

    // Resolve the journal name to use for Warning/Bealls: the typed name, or
    // (for ISSN input) the name from the matched JCR/CASS record.
    const nameForRiskLookup = inputIsISSN
      ? jcr?.journal_name || cass?.journal_name || null
      : input;

    let warning:
      Awaited<ReturnType<typeof WarningListStore.lookup>>[number] | null = null;
    let bealls: Awaited<ReturnType<typeof BeallsListStore.checkItem>> | null =
      null;
    if (nameForRiskLookup) {
      [warning, bealls] = await Promise.all([
        WarningListStore.lookup(nameForRiskLookup).then((r) => r[0] ?? null),
        // 断言型面板只认 L1 域名 / L2 精确名（置信 1.0）——缩写(0.9)/关键词
        // 重叠(0.7)模糊层误报率高，不足以给单本期刊定罪（审计 P1-6）
        BeallsListStore.checkItem(nameForRiskLookup).then((r) =>
          r.isPredatory && (r.bestLayer === "url" || r.bestLayer === "exact")
            ? r
            : null,
        ),
      ]);
    }

    const hasLocalHit = !!(jcr || cass || warning || bealls);

    // ISSN for OpenAlex lookup: prefer the local record's issn/eissn so we
    // resolve the exact source even when the user typed a name.
    const issnForLookup = inputIsISSN
      ? input
      : jcr?.issn || jcr?.eissn || cass?.issn || cass?.eissn || undefined;

    // OpenAlex is the ONLY source for topics / country / APC / OA / academic
    // indices, so we always fetch it (best-effort) to enrich the metric card —
    // even when local tables hit. Falls back to name search when no ISSN.
    //
    // Cache-first: when we have an ISSN, read from zsearch_openalex_journal_cache
    // (30-day TTL) before hitting the network. Only ISSN lookups are cached —
    // name searches are dynamic and low-hit, so they always go live.
    let oaSrc: OpenAlexJournal | null = null;
    if (issnForLookup) {
      const cached = await OpenAlexJournalCacheStore.get(issnForLookup);
      if (cached) {
        oaSrc = cached;
      }
    }
    if (!oaSrc) {
      const fetchOa = searchOpenAlexSources({
        issn: issnForLookup,
        search: issnForLookup ? undefined : input,
        limit: 1,
        sortBy: "relevance",
      });
      if (hasLocalHit) {
        // 本地四表已命中时 OpenAlex 仅是增强（topics/h5 等独占字段）——
        // 8s 竞速上限，网络不可达环境不得让纯本地查证卡满 30s HTTP 超时
        // （2026-09-25 审计 P1-4）。落空的增强数据下次查询走缓存路径。
        oaSrc = await Promise.race([
          fetchOa.then((r) =>
            !r.error && r.journals.length > 0 ? r.journals[0] : null,
          ),
          new Promise<null>((res) => setTimeout(() => res(null), 8000)),
        ]);
        if (oaSrc && (oaSrc.issn || oaSrc.issnL)) {
          void OpenAlexJournalCacheStore.upsert(oaSrc);
        }
      } else {
        // 本地全 miss：OpenAlex 是唯一数据源，等满其自身超时
        const openalex = await fetchOa;
        oaSrc =
          !openalex.error && openalex.journals.length > 0
            ? openalex.journals[0]
            : null;
        if (oaSrc && (oaSrc.issn || oaSrc.issnL)) {
          void OpenAlexJournalCacheStore.upsert(oaSrc);
        }
      }
    }

    // No data from either local or OpenAlex — nothing to show.
    if (!hasLocalHit && !oaSrc) return null;

    // If local missed (or only warning/bealls hit — ISSN 维度仍空), re-probe
    // local by the ISSN / name OpenAlex returned (handles name-spelling
    // mismatches). 已命中的维度不复探——首 pass 结果不会被覆盖为 null
    // （审计 P2-6：warning/bealls-only 命中此前阻断了 JCR/CASS 复探）。
    let finalJcr = jcr,
      finalCass = cass,
      finalWarn = warning,
      finalBealls = bealls;
    if (oaSrc) {
      const oaIssn = oaSrc.issn || oaSrc.issnL;
      const probes: Promise<unknown>[] = [];
      if (!jcr && !cass && oaIssn) {
        probes.push(
          JCRStore.lookup({ issn: oaIssn, eissn: oaIssn }).then((r) => {
            finalJcr = r;
          }),
          CASSStore.lookup({ issn: oaIssn, eissn: oaIssn }).then((r) => {
            finalCass = r;
          }),
        );
      }
      if (!warning && !bealls) {
        probes.push(
          WarningListStore.lookup(oaSrc.displayName).then((r) => {
            finalWarn = r[0] ?? null;
          }),
          BeallsListStore.checkItem(oaSrc.displayName).then((r) => {
            finalBealls =
              r.isPredatory &&
              (r.bestLayer === "url" || r.bestLayer === "exact")
                ? r
                : null;
          }),
        );
      }
      if (probes.length > 0) await Promise.all(probes);
    }

    return this.composeMetric({
      query: input,
      jcr: finalJcr,
      cass: finalCass,
      warning: finalWarn,
      bealls: finalBealls,
      issnForLookup,
      oaSrc,
    });
  }

  /**
   * Compose a JournalMetric by merging local-table records with an optional
   * OpenAlex source. Local values win for JCR/CASS/Warning/Bealls (they are
   * authoritative); OpenAlex fills in everything local can't provide
   * (topics, country, APC, OA, h-index, i10, works_count, h5).
   *
   * `source` is 'local' when any local table hit, else 'openalex'.
   */
  private composeMetric(args: {
    query: string;
    jcr: Awaited<ReturnType<typeof JCRStore.lookup>>;
    cass: Awaited<ReturnType<typeof CASSStore.lookup>>;
    warning: {
      warning_level?: string | null;
      warning_level_en?: string | null;
      warning_reason?: string | null;
      warning_reason_en?: string | null;
    } | null;
    bealls: Awaited<ReturnType<typeof BeallsListStore.checkItem>> | null;
    issnForLookup?: string;
    oaSrc?: OpenAlexJournal | null;
  }): JournalMetric {
    const { jcr, cass, warning, bealls, oaSrc } = args;
    const hasLocal = !!(jcr || cass || warning || bealls);
    return {
      source: hasLocal ? "local" : "openalex",
      name:
        jcr?.journal_name ||
        cass?.journal_name ||
        oaSrc?.displayName ||
        args.query,
      issn:
        jcr?.issn ||
        cass?.issn ||
        args.issnForLookup ||
        oaSrc?.issn ||
        oaSrc?.issnL ||
        undefined,
      eissn: jcr?.eissn || cass?.eissn || undefined,
      publisher: jcr?.publisher ?? undefined,
      // JCR metrics — local only. "N/A" 分区（2,085/18,871 行）不能进模板串
      // ——卡片会拼出 lit-quartile-jcr-q/A 这类裸 locale key（审计 P1-5）
      jif: jcr?.jif ?? undefined,
      fiveYearJif: jcr?.five_year_jif ?? undefined,
      jci: jcr?.jci ?? undefined,
      jifQuartile: cleanQuartile(jcr?.jif_quartile),
      jifRank: jcr?.jif_rank ?? undefined,
      totalCites: jcr?.total_cites ?? undefined,
      totalArticles: jcr?.total_articles ?? undefined,
      // CAS quartile — local only.
      cassQuartile: cass?.major_quartile,
      cassCategory: cass?.major_category,
      cassCategoryEn: cass?.major_category_en ?? undefined,
      cassIsTop: cass?.is_top,
      cassMinorCategories: cass?.minor_categories?.map((m) => ({
        name: m.n,
        nameCn: m.nc,
        quartile: m.q,
      })),
      // Risk flags — local only. 2024/2025 版预警名单（论文工厂类）不带
      // 级别字段（warning_level=null 占 29/29）——记录存在即告警，级别按
      // 界面语言取值、全缺时 ⚠ 兜底（审计 P0-3 / P2-5）
      warningLevel: pickWarningLevel(warning),
      warningReason:
        warning?.warning_reason_en ?? warning?.warning_reason ?? undefined,
      isPredatory: bealls?.isPredatory || undefined,
      predatoryCategory: bealls?.journals[0]?.category,
      // OpenAlex supplementary — always from OpenAlex when available.
      openalexWorksCount: oaSrc?.worksCount,
      openalexH5Index: oaSrc?.h5Index,
      hIndex: oaSrc?.hIndex,
      i10Index: oaSrc?.i10Index,
      twoYearMeanCitedness: oaSrc?.twoYearMeanCitedness,
      homepageUrl: oaSrc?.homepageUrl,
      countryCode: oaSrc?.countryCode,
      apcUsd: oaSrc?.apcUsd,
      isOpenAccess: oaSrc?.isOpenAccess,
      isInDoaj: oaSrc?.isInDoaj,
      firstPublicationYear: oaSrc?.firstPublicationYear,
      topics: oaSrc?.topics?.map((t) => ({
        displayName: t.displayName,
        field: t.field,
        count: t.count,
      })),
    };
  }

  private async searchDiscover(
    payload: JournalSearchPayload,
  ): Promise<JournalSearchResult> {
    const keyword = (payload.query ?? "").trim();
    if (!keyword) return { mode: "discover", list: [], total: 0 };

    const limit = Math.min(Math.max(payload.limit ?? 25, 1), 25);
    const sortBy = payload.sortBy ?? "relevance";
    const oaSortMap: Record<JournalSortBy, "relevance" | "works" | "h5"> = {
      relevance: "relevance",
      jif: "works", // OpenAlex has no JIF; 'works' as a sensible default for IF sort
      works: "works",
      h5: "h5",
      library: "works",
    };

    // JIF 排序的取样放宽（审计 P2-4）：OpenAlex 排不了 JIF，若只取按
    // works_count 的前 25 再客户端重排，呈现的「JIF 榜」实为 works 榜的
    // 顺序扰动。取 50 条富集后按 JIF 排序再截 25——仍是 JCR 本地命中的
    // 子集内排序（诚实上限），但显著降低排序失真。
    const fetchLimit = sortBy === "jif" ? Math.min(limit * 2, 50) : limit;

    const oa = await searchOpenAlexSources({
      search: keyword,
      limit: fetchLimit,
      sortBy: oaSortMap[sortBy],
    });
    // 错误上抛（审计 P1-8）：断网时的空结果会被 UI 当「无数据」空态展示
    if (oa.error) {
      return { mode: "discover", list: [], total: 0, error: oa.error };
    }

    let items: JournalListItem[] = oa.journals.map((j) => ({
      source: "openalex" as const,
      name: j.displayName,
      issn: j.issn || j.issnL,
      worksCount: j.worksCount,
      h5Index: j.h5Index,
    }));

    await this.batchEnrichLocalMetrics(items);

    // Client-side re-sort if the user asked for JIF (OpenAlex can't sort by it).
    if (sortBy === "jif") {
      items.sort((a, b) => (b.jif ?? -1) - (a.jif ?? -1));
      items = items.slice(0, limit);
    }

    // 计数诚实化（审计 P2-3）：OpenAlex 只取一页（fetchLimit），total 是
    // 远端全量——展示层用 list.length 与 total 中较小者，防「N 条结果」
    // 实示 25 的落差（分页 UI 俟后续）。
    return {
      mode: "discover",
      list: items,
      total: Math.min(oa.total ?? items.length, items.length) || items.length,
    };
  }

  private async searchLibrary(
    payload: JournalSearchPayload,
  ): Promise<JournalSearchResult> {
    const limit = Math.min(Math.max(payload.limit ?? 50, 1), 200);

    const counts = await this.computeLibraryJournalCounts();
    const top = counts.slice(0, limit);

    const items: JournalListItem[] = top.map(([name, count]) => ({
      source: "local" as const,
      name,
      libraryCount: count,
    }));

    await this.batchEnrichLocalMetrics(items);

    // Re-sort if requested.
    const sortBy = payload.sortBy ?? "library";
    if (sortBy === "jif") {
      // library 条目无 ISSN，batchEnrich 的 ISSN 路径全空——按刊名补全 JIF
      // （名称精确查 JCR 表，前 50 条），让 JIF 排序真正有数可排（审计 P2-4）
      await Promise.all(
        items.slice(0, 50).map(async (it) => {
          if (it.jif != null) return;
          try {
            const rec = await JCRStore.lookup({ journalName: it.name });
            if (rec) {
              it.jif = rec.jif ?? undefined;
              it.jifQuartile = cleanQuartile(rec.jif_quartile);
            }
          } catch {
            /* 单条失败不阻断 */
          }
        }),
      );
      items.sort((a, b) => (b.jif ?? -1) - (a.jif ?? -1));
    }
    // 'library' sort is already the default order from computeLibraryJournalCounts.
    // 'works'/'h5'/'relevance' don't apply to library mode meaningfully — keep as-is.

    return { mode: "library", list: items, total: counts.length };
  }

  /**
   * Count journalArticle items per normalized publicationTitle.
   * Reimplements the small scan loop locally (analyzeLibraryJournals in
   * analysis/metadata.ts is unexported and capped at top-10).
   */
  private async computeLibraryJournalCounts(): Promise<
    Array<[string, number]>
  > {
    try {
      const s = new (Zotero as any).Search();
      s.addCondition("itemType", "is", "journalArticle");
      const ids: number[] = await s.search();
      if (!ids || ids.length === 0) return [];

      const counts = new Map<string, number>();
      const items = await (Zotero as any).Items.getAsync(ids);
      for (const item of items) {
        if (!item) continue;
        const title = item.getField("publicationTitle");
        if (!title) continue;
        const key = normalizeJournalName(title);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      // Preserve the first-seen original-casing name for display.
      const firstSeen = new Map<string, string>();
      for (const item of items) {
        if (!item) continue;
        const title = item.getField("publicationTitle");
        if (!title) continue;
        const key = normalizeJournalName(title);
        if (!firstSeen.has(key)) firstSeen.set(key, title);
      }

      return Array.from(counts.entries())
        .map(
          ([key, count]) =>
            [firstSeen.get(key) ?? key, count] as [string, number],
        )
        .sort((a, b) => b[1] - a[1]);
    } catch (e) {
      safeDebug(
        "[z-search] JournalSearchService.processJournalItem failed: " + e,
      );
      return [];
    }
  }

  /**
   * Mutate a list of journal items in place, attaching any local quality
   * signals (JCR/CASS/Warning/Bealls) matched by ISSN or name.
   *
   * Uses batch lookups for JCR/CASS/Warning; Bealls has no batch API so it
   * falls back to per-item checkItem (its in-memory index makes this cheap).
   */
  private async batchEnrichLocalMetrics(
    items: JournalListItem[],
  ): Promise<void> {
    if (items.length === 0) return;

    const issns = items.map((i) => i.issn).filter((x): x is string => !!x);
    const names = items.map((i) => i.name).filter(Boolean);

    const [jcrMap, cassMap, warnMap, jcrQuartileByName, cassQuartileByName] =
      await Promise.all([
        issns.length
          ? JCRStore.batchLookupByIssn(issns)
          : Promise.resolve(new Map()),
        issns.length
          ? CASSStore.batchLookupByIssn(issns)
          : Promise.resolve(new Map()),
        names.length
          ? WarningListStore.batchLookupWarnings(names)
          : Promise.resolve(new Map()),
        // E3（2026-09-04）：库内期刊条目只有刊名没有 ISSN，ISSN 路径恒
        // 不命中 → Q 徽章恒缺失、与分区分布并置显矛盾。补按名批量查询。
        names.length
          ? JCRStore.batchLookupQuartiles(names)
          : Promise.resolve(new Map()),
        names.length
          ? CASSStore.batchLookupQuartiles(names)
          : Promise.resolve(new Map()),
      ]);

    // Bealls: per-item (no batch API). Run after the batch lookups to overlap
    // the awaits with the name->warning map build. 断言只认精确层（同 metric
    // 路径的裁决，审计 P1-6）。
    const beallsPromises = items.map(async (i) => {
      if (!i.name) return undefined;
      const r = await BeallsListStore.checkItem(i.name);
      return r.isPredatory && (r.bestLayer === "url" || r.bestLayer === "exact")
        ? r
        : undefined;
    });
    const beallsResults = await Promise.all(beallsPromises);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const issn = item.issn;
      // Map 键 = normalizeISSN（无连字符大写）——OpenAlex 的 issn 带连字符
      // （"0028-0836"），裸 get 恒 miss（审计 P0-2）
      const jcr = issn ? jcrMap.get(normalizeISSN(issn)) : undefined;
      const cass = issn ? cassMap.get(normalizeISSN(issn)) : undefined;
      const warn = item.name
        ? warnMap.get(normalizeJournalName(item.name))
        : undefined;
      const bealls = beallsResults[i];

      if (jcr) {
        item.jif = jcr.jif ?? undefined;
        item.jifQuartile = cleanQuartile(jcr.jif_quartile);
      }
      if (cass) {
        item.cassQuartile = cass.major_quartile;
        item.cassIsTop = cass.is_top;
      }
      // E3：ISSN 未命中时按名兜底。批量查询的结果键 = 库内存储刊名的
      // 大写形式，与输入刊名的大小写/规范化形式可能有别——用候选键组试查。
      if (!jcr && item.name) {
        const q =
          jcrQuartileByName.get(item.name.toUpperCase()) ??
          jcrQuartileByName.get(normalizeJournalName(item.name).toUpperCase());
        if (q) item.jifQuartile = q;
      }
      if (!cass && item.name) {
        const cq =
          cassQuartileByName.get(item.name.toUpperCase()) ??
          cassQuartileByName.get(normalizeJournalName(item.name).toUpperCase());
        if (cq) {
          item.cassQuartile = cq.quartile;
          item.cassIsTop = cq.isTop;
        }
      }
      if (warn) {
        // 2024/2025 版预警无级别（null）——记录存在即告警；级别按界面
        // 语言取值（同 composeMetric 口径，审计 P0-3 / P2-5）
        item.warningLevel = pickWarningLevel(warn);
      }
      if (bealls) {
        item.isPredatory = true;
      }
    }
  }
}

/** Singleton instance used by HubWindowBridge. */
export default new JournalSearchService();
