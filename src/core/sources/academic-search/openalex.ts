/** Per-source academic search handlers. */

import { withOpenalexAuth } from "../../../utils/openalexAuth";
import { httpJsonGet, HttpGetResult } from "../../../utils/http";
import { safeDebug } from "../../../utils/logger";
import { openalexThrottle } from "../../../utils/openalexThrottle";

function mapOpenAlexWork(work: any): any {
  const authors = (work.authorships || [])
    .map((a: any) => a.author?.display_name || a.author?.name || "")
    .filter(Boolean)
    .join(", ");

  let abstract = "";
  if (work.abstract_inverted_index) {
    const words: { word: string; pos: number }[] = [];
    for (const [word, positions] of Object.entries(
      work.abstract_inverted_index,
    ) as [string, number[]][]) {
      for (const pos of positions) words.push({ word, pos });
    }
    words.sort((a, b) => a.pos - b.pos);
    abstract = words.map((w) => w.word).join(" ");
  }

  return {
    title: work.title || "",
    authors,
    year: work.publication_year || "",
    abstract,
    doi: work.doi || "",
    url: work.id
      ? `https://openalex.org/works/${work.id.replace("https://openalex.org/", "")}`
      : "",
    oaUrl: work.open_access?.oa_url || "",
    pdfUrl: work.open_access?.oa_url || "",
    citationCount: work.cited_by_count ?? 0,
    // OA 徽章数据（审计 P2-2）：openalex 系（含 biorxiv/medrxiv 代理）此前
    // 不映射 is_oa，三席默认源的 OA 徽章恒缺失
    isOpenAccess: work.open_access?.is_oa === true,
    source: "openalex" as const,
    containerTitle: work.primary_location?.source?.display_name || undefined,
    journalName: work.primary_location?.source?.display_name || undefined,
    issn: (work.primary_location?.source?.issn || [])[0] || undefined,
    volume: work.biblio?.volume || undefined,
    issue: work.biblio?.issue || undefined,
    pages: work.biblio?.first_page
      ? work.biblio?.last_page
        ? `${work.biblio.first_page}-${work.biblio.last_page}`
        : work.biblio.first_page
      : undefined,
    publicationType: work.type || undefined,
  };
}

/**
 * OpenAlex works search scoped to a single source id (preprint server etc.).
 *
 * Shared by OpenAlex-backed sources (biorxiv / medrxiv) — they have no own
 * search API, so they filter OpenAlex by `primary_location.source.id` and
 * remap the `source` field of each article to their own id.
 */
export async function openalexSourceSearch(args: {
  sourceId: string; // full URL form, e.g. "https://openalex.org/S4306402567"
  query: string;
  maxResults?: number;
  landingBase?: string; // preprint server base for pdf fallback, e.g. "https://www.medrxiv.org"
  source: string; // article.source to stamp ("biorxiv" / "medrxiv")
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  try {
    let url = `https://api.openalex.org/works?search=${encodeURIComponent(args.query)}&filter=primary_location.source.id:${args.sourceId}&per_page=${maxResults}&select=id,doi,title,authorships,publication_year,abstract_inverted_index,primary_location,cited_by_count,open_access,biblio,type&sort=relevance_score:desc`;

    url = withOpenalexAuth(url);

    // Throttle + 429 retry-after policy lives in openalexRequest (single source;
    // this endpoint is api.openalex.org, same rate budget as openalex.ts).
    const result = await openalexRequest(url);

    if (!result.ok) {
      return {
        success: false,
        error: `OpenAlex source search error: ${result.status}`,
        total: 0,
        articles: [],
        source: args.source,
      };
    }

    const data = JSON.parse(result.body);
    const results = data.results || [];

    const articles = results.map((work: any) => {
      const article = mapOpenAlexWork(work);
      article.source = args.source;
      // 与旧 biorxiv.ts 相同的 DOI 前缀剥离（mapOpenAlexWork 保留
      // OpenAlex 原样 URL 形态，落地页拼接需要裸 DOI）。
      if (typeof article.doi === "string") {
        article.doi = article.doi.replace("https://doi.org/", "");
      }
      // OpenAlex 的 oa_url 对预印本服务器通常已直指 full.pdf；缺省时按
      // DOI 拼落地页 PDF 回退（biorxiv/medrxiv 的 URL 约定相同）。
      if (!article.pdfUrl && args.landingBase && article.doi) {
        article.pdfUrl = `${args.landingBase}/content/${article.doi}full.pdf`;
      }
      return article;
    });

    return {
      total: data.meta?.count || articles.length,
      returned: articles.length,
      source: args.source,
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `OpenAlex source search failed: ${e.message}`,
      total: 0,
      articles: [],
      source: args.source,
    };
  }
}

/**
 * OpenAlex HTTP GET with per-request throttle + 429 retry-after respect.
 *
 * - Every call waits for the module-level throttle gate (500 ms since last request).
 * - On HTTP 429, parses `retryAfter` from the JSON body; if ≤ 300 s, sleeps and retries once.
 *   ≥ 300 s means budget exhaustion (resets at midnight UTC); returns immediately.
 * - Non-429 HTTP errors are returned as-is.
 *
 * Exported for sibling OpenAlex-backed sources (biorxiv.ts) so they inherit the
 * same throttle + 429 policy instead of keeping a divergent private copy.
 */
export async function openalexRequest(url: string): Promise<HttpGetResult> {
  await openalexThrottle();
  const result = await httpJsonGet(url);
  if (result.ok || result.status !== 429) return result;

  // 429: try to parse retryAfter from response body.
  let retryAfter = 300; // default fallback (conservative).
  if (result.body) {
    try {
      const parsed = JSON.parse(result.body);
      const ra = Number(
        parsed?.retryAfter ?? parsed?.meta?.headers?.["retry-after"],
      );
      if (Number.isFinite(ra) && ra > 0) retryAfter = Math.min(ra, 600);
    } catch {
      /* ignore malformed body */
    }
  }
  if (retryAfter > 300) return result;

  await new Promise((r) => setTimeout(r, retryAfter * 1000));
  await openalexThrottle();
  return httpJsonGet(url);
}

export async function searchOpenAlex(args: {
  query: string;
  year?: string;
  maxResults?: number;
  author?: string;
  journal?: string;
  sort?: string;
  reviewOnly?: boolean;
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  try {
    const filterParts: string[] = [];
    if (args.year) {
      // 区间优先：parseInt("2017-2026")=2017 会让区间分支永不可达（审计 P0-1）。
      // OpenAlex 原生支持 publication_year:2017-2026 区间语法。
      const range = args.year.match(/^(\d{4})\s*-\s*(\d{4})$/);
      if (range) {
        filterParts.push(`publication_year:${range[1]}-${range[2]}`);
      } else {
        const yearNum = parseInt(args.year, 10);
        if (!isNaN(yearNum)) {
          filterParts.push(`publication_year:${yearNum}`);
        }
      }
    }
    if (args.journal) {
      // filter 值编码：刊名含空格/逗号会拆坏逗号连接的 filter 串
      filterParts.push(
        `primary_location.source.display_name:${encodeURIComponent(args.journal)}`,
      );
    }
    if (args.author) {
      filterParts.push(
        `authorships.author.display_name:${encodeURIComponent(args.author)}`,
      );
    }
    // OpenAlex work type "review" covers review articles.
    if (args.reviewOnly) {
      filterParts.push(`type:review`);
    }

    const sortMap: Record<string, string> = {
      relevance: "relevance_score:desc",
      cited: "cited_by_count:desc",
      published: "publication_date:desc",
    };

    let url = `https://api.openalex.org/works?search=${encodeURIComponent(args.query)}&per_page=${maxResults}&select=id,doi,title,authorships,publication_year,abstract_inverted_index,primary_location,cited_by_count,open_access,biblio,type`;

    if (filterParts.length > 0) {
      url += `&filter=${filterParts.join(",")}`;
    }
    if (args.sort && sortMap[args.sort]) {
      url += `&sort=${sortMap[args.sort]}`;
    }

    url = withOpenalexAuth(url);

    const result = await openalexRequest(url);

    if (!result.ok) {
      return {
        success: false,
        error: `OpenAlex API error: ${result.status}`,
        total: 0,
        articles: [],
        source: "openalex",
      };
    }

    const data = JSON.parse(result.body);
    const results = data.results || [];

    const articles = results.map((work: any) => mapOpenAlexWork(work));

    return {
      total: data.meta?.count || results.length,
      returned: articles.length,
      source: "openalex",
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `OpenAlex search failed: ${e.message}`,
      total: 0,
      articles: [],
      source: "openalex",
    };
  }
}

export async function searchOpenAlexByAuthor(args: {
  authorId: string;
  since?: Date;
  maxResults?: number;
}): Promise<{
  articles: any[];
  total: number;
  source: string;
  error?: string;
  success?: boolean;
}> {
  const maxResults = Math.min(args.maxResults ?? 25, 25);
  try {
    const filterParts: string[] = [`author.id:${args.authorId}`];
    if (args.since) {
      filterParts.push(
        `from_publication_date:${args.since.toISOString().slice(0, 10)}`,
      );
    }

    let url = `https://api.openalex.org/works?filter=${filterParts.join(",")}&per_page=${maxResults}&select=id,doi,title,authorships,publication_year,abstract_inverted_index,primary_location,cited_by_count,open_access,biblio,type`;

    url = withOpenalexAuth(url);

    const result = await openalexRequest(url);
    if (!result.ok) {
      // (2026-08 audit): distinguish HTTP failure from genuine empty result.
      // A bare empty array made outages look like "no new papers", defeating
      // the tracking scheduler's failure detection.
      return {
        success: false,
        articles: [],
        total: 0,
        source: "openalex",
        error: `http_${result.status ?? "error"}`,
      };
    }

    const data = JSON.parse(result.body);
    const results = data.results || [];

    const articles = results.map((work: any) => mapOpenAlexWork(work));
    return {
      articles,
      total: data.meta?.count || results.length,
      source: "openalex",
    };
  } catch (e: any) {
    return {
      success: false,
      articles: [],
      total: 0,
      source: "openalex",
      error: `exception_${e?.message?.slice(0, 40) ?? "unknown"}`,
    };
  }
}

export async function searchOpenAlexWorksByInstitution(args: {
  institutionId: string;
  since?: Date;
  maxResults?: number;
}): Promise<{
  articles: any[];
  total: number;
  source: string;
  error?: string;
  success?: boolean;
}> {
  const maxResults = Math.min(args.maxResults ?? 25, 25);
  try {
    const filterParts: string[] = [
      `author_institutions.id:${args.institutionId}`,
    ];
    if (args.since) {
      filterParts.push(
        `from_publication_date:${args.since.toISOString().slice(0, 10)}`,
      );
    }

    let url = `https://api.openalex.org/works?filter=${filterParts.join(",")}&per_page=${maxResults}&select=id,doi,title,authorships,publication_year,abstract_inverted_index,primary_location,cited_by_count,open_access,biblio,type`;

    url = withOpenalexAuth(url);

    const result = await openalexRequest(url);
    if (!result.ok) {
      return {
        success: false,
        articles: [],
        total: 0,
        source: "openalex",
        error: `http_${result.status ?? "error"}`,
      };
    }

    const data = JSON.parse(result.body);
    const results = data.results || [];

    const articles = results.map((work: any) => mapOpenAlexWork(work));
    return {
      articles,
      total: data.meta?.count || results.length,
      source: "openalex",
    };
  } catch (e: any) {
    return {
      success: false,
      articles: [],
      total: 0,
      source: "openalex",
      error: `exception_${e?.message?.slice(0, 40) ?? "unknown"}`,
    };
  }
}

/** Minimal institution shape for tracking resolvers (small select). */
export interface OpenAlexInstitutionCandidate {
  id: string; // "I123..." (URL prefix stripped)
  displayName: string;
  countryCode?: string;
  worksCount?: number;
}

export async function searchOpenAlexInstitutions(args: {
  search: string;
  maxResults?: number;
}): Promise<{
  institutions: OpenAlexInstitutionCandidate[];
  error?: string;
  success?: boolean;
}> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  if (!args.search?.trim()) return { institutions: [] };
  try {
    let url =
      `https://api.openalex.org/institutions?search=${encodeURIComponent(args.search)}` +
      `&per_page=${maxResults}&select=id,display_name,country_code,works_count`;

    url = withOpenalexAuth(url);

    const result = await openalexRequest(url);
    if (!result.ok) {
      return {
        success: false,
        institutions: [],
        error: `http_${result.status ?? "error"}`,
      };
    }
    const data = JSON.parse(result.body);
    const rows: any[] = data?.results ?? [];
    return {
      institutions: rows.map((r) => ({
        id: String(r.id ?? "").replace("https://openalex.org/", ""),
        displayName: String(r.display_name ?? ""),
        countryCode: r.country_code,
        worksCount: r.works_count,
      })),
    };
  } catch (e: any) {
    return {
      success: false,
      institutions: [],
      error: `exception_${e?.message?.slice(0, 40) ?? "unknown"}`,
    };
  }
}

export async function searchOpenAlexWorksBySource(args: {
  sourceId: string; // OpenAlex source id, e.g. "S137030680"
  since?: Date;
  maxResults?: number;
}): Promise<{
  articles: any[];
  total: number;
  source: string;
  error?: string;
  success?: boolean;
}> {
  const maxResults = Math.min(args.maxResults ?? 25, 25);
  try {
    const filterParts: string[] = [
      `primary_location.source.id:${args.sourceId}`,
    ];
    if (args.since) {
      filterParts.push(
        `from_publication_date:${args.since.toISOString().slice(0, 10)}`,
      );
    }

    let url = `https://api.openalex.org/works?filter=${filterParts.join(",")}&per_page=${maxResults}&select=id,doi,title,authorships,publication_year,abstract_inverted_index,primary_location,cited_by_count,open_access,biblio,type`;

    url = withOpenalexAuth(url);

    const result = await openalexRequest(url);
    if (!result.ok) {
      return {
        success: false,
        articles: [],
        total: 0,
        source: "openalex",
        error: `http_${result.status ?? "error"}`,
      };
    }

    const data = JSON.parse(result.body);
    const results = data.results || [];
    return {
      articles: results.map((work: any) => mapOpenAlexWork(work)),
      total: data.meta?.count || results.length,
      source: "openalex",
    };
  } catch (e: any) {
    return {
      success: false,
      articles: [],
      total: 0,
      source: "openalex",
      error: `exception_${e?.message?.slice(0, 40) ?? "unknown"}`,
    };
  }
}

export async function searchOpenAlexByDoi(args: {
  doi: string;
}): Promise<any | null> {
  try {
    let url = `https://api.openalex.org/works/doi:${encodeURIComponent(args.doi)}?select=id,doi,title,authorships,publication_year,abstract_inverted_index,primary_location,cited_by_count,open_access,biblio,type`;

    url = withOpenalexAuth(url);

    const result = await openalexRequest(url);
    if (!result.ok) {
      // (2026-09 audit): log the HTTP failure with status/DOI context. A bare
      // null makes callers treat API outages as "DOI not indexed".
      safeDebug(
        `[z-search] openalex: searchOpenAlexByDoi http_${result.status ?? "error"} doi=${args.doi}`,
      );
      return null;
    }

    const data = JSON.parse(result.body);
    return mapOpenAlexWork(data);
  } catch (e) {
    safeDebug("[z-search] openalex: " + e);
    return null;
  }
}

// Unlike searchOpenAlex above (which hits /works for articles), this hits the
// /sources endpoint to retrieve journal-level metadata. Used by the Journal
// Search feature (mode 'discover' and the 'metric' fallback).

export interface OpenAlexJournalTopic {
  displayName: string;
  field?: string;
  count?: number;
}

export interface OpenAlexJournal {
  id: string;
  displayName: string;
  issn?: string;
  issnL?: string;
  type?: string;
  worksCount?: number;
  citedByCount?: number;
  h5Index?: number;
  homepageUrl?: string;
  // Summary stats (academic indices).
  hIndex?: number;
  i10Index?: number;
  twoYearMeanCitedness?: number;
  // Publishing metadata.
  countryCode?: string;
  apcUsd?: number;
  isOpenAccess?: boolean;
  isInDoaj?: boolean;
  firstPublicationYear?: number;
  // Top research topics the journal publishes (its "scope").
  topics?: OpenAlexJournalTopic[];
}

/**
 * Search OpenAlex /sources by keyword (mode 'discover') or look up a single
 * source by ISSN (mode 'metric' fallback).
 *
 * @param opts.search   Free-text search over source display names / topics.
 * @param opts.issn     Exact ISSN lookup (takes precedence over search).
 * @param opts.limit    Max results (capped at 25 by OpenAlex per_page).
 * @param opts.sortBy   Sort key; 'relevance' is only valid with `search`.
 */
export async function searchOpenAlexSources(args: {
  search?: string;
  issn?: string;
  limit?: number;
  sortBy?: "relevance" | "works" | "cited" | "h5";
}): Promise<{
  total: number;
  returned: number;
  source: "openalex";
  journals: OpenAlexJournal[];
  error?: string;
  success?: boolean;
}> {
  const perPage = Math.min(args.limit ?? 10, 25);
  try {
    const sortMap: Record<string, string> = {
      relevance: "relevance_score:desc",
      works: "works_count:desc",
      cited: "cited_by_count:desc",
      h5: "summary_stats.h5_index:desc",
    };
    const sortBy = args.sortBy ?? (args.search ? "relevance" : "works");

    let url = "https://api.openalex.org/sources?";
    const params: string[] = [
      `per_page=${perPage}`,
      `select=id,display_name,issn,issn_l,type,works_count,cited_by_count,homepage_url,summary_stats,country_code,apc_usd,is_oa,is_in_doaj,first_publication_year,topics`,
    ];

    if (args.issn) {
      // OpenAlex 的 issn: filter 只匹配带连字符形态（实测 issn:00280836 →
      // 0 结果，0028-0836 → 命中）——本地 JCR/CASS 表存的是无连字符形态，
      // 此处统一规整为 XXXX-XXXX（审计 P0-1）
      const hyphenIssn = args.issn.replace(
        /^(\d{4})-?(\d{3}[\dXx])$/i,
        "$1-$2",
      );
      params.push(`filter=issn:${encodeURIComponent(hyphenIssn)}`);
    } else if (args.search) {
      params.push(`search=${encodeURIComponent(args.search)}`);
    } else {
      return {
        success: false,
        total: 0,
        returned: 0,
        source: "openalex",
        journals: [],
        error: "search or issn required",
      };
    }

    // sort=relevance_score is only valid with `search`; for issn filter use works_count.
    const effectiveSort =
      args.issn && sortBy === "relevance" ? "works" : sortBy;
    if (sortMap[effectiveSort]) {
      params.push(`sort=${sortMap[effectiveSort]}`);
    }

    url += params.join("&");

    url = withOpenalexAuth(url);

    const result = await openalexRequest(url);
    if (!result.ok) {
      return {
        success: false,
        total: 0,
        returned: 0,
        source: "openalex",
        journals: [],
        error: `OpenAlex /sources error: ${result.status}`,
      };
    }

    const data = JSON.parse(result.body);
    const results: any[] = data.results || [];

    const journals: OpenAlexJournal[] = results.map((s: any) => {
      const issns: string[] = Array.isArray(s.issn) ? s.issn : [];
      const summaryStats = s.summary_stats || {};
      const rawTopics: any[] = Array.isArray(s.topics) ? s.topics : [];
      return {
        id: s.id || "",
        displayName: s.display_name || "",
        issn: issns[0],
        issnL: s.issn_l,
        type: s.type,
        worksCount:
          typeof s.works_count === "number" ? s.works_count : undefined,
        citedByCount:
          typeof s.cited_by_count === "number" ? s.cited_by_count : undefined,
        // h5_index lives under summary_stats in current OpenAlex responses.
        h5Index:
          typeof summaryStats.h5_index === "number"
            ? summaryStats.h5_index
            : undefined,
        homepageUrl: s.homepage_url || undefined,
        // Academic indices from summary_stats.
        hIndex:
          typeof summaryStats.h_index === "number"
            ? summaryStats.h_index
            : undefined,
        i10Index:
          typeof summaryStats.i10_index === "number"
            ? summaryStats.i10_index
            : undefined,
        twoYearMeanCitedness:
          typeof summaryStats["2yr_mean_citedness"] === "number"
            ? summaryStats["2yr_mean_citedness"]
            : undefined,
        // Publishing metadata.
        countryCode: s.country_code || undefined,
        apcUsd: typeof s.apc_usd === "number" ? s.apc_usd : undefined,
        isOpenAccess: typeof s.is_oa === "boolean" ? s.is_oa : undefined,
        isInDoaj: typeof s.is_in_doaj === "boolean" ? s.is_in_doaj : undefined,
        firstPublicationYear:
          typeof s.first_publication_year === "number"
            ? s.first_publication_year
            : undefined,
        // Top topics (journal scope). Keep top 5 by count.
        topics: rawTopics
          .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
          .slice(0, 5)
          .map((t: any) => ({
            displayName: t.display_name || "",
            field:
              t.field?.display_name || t.subfield?.display_name || undefined,
            count: typeof t.count === "number" ? t.count : undefined,
          })),
      };
    });

    return {
      total: data.meta?.count || journals.length,
      returned: journals.length,
      source: "openalex",
      journals,
    };
  } catch (e: any) {
    return {
      success: false,
      total: 0,
      returned: 0,
      source: "openalex",
      journals: [],
      error: `OpenAlex /sources failed: ${e.message}`,
    };
  }
}
