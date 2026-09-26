/** Citation/reference handlers — DOI lookup helpers. */

import { ZSEARCH_HTTP_HEADERS } from "../../../../../../utils/httpHeaders";

import { SQLITE_MAX_VARIABLES } from "../../../../../../utils/constants";
import { safeDebug } from "../../../../../../utils/logger";

export function normalizeDOI(doi: string): string {
  return doi
    .replace(/^https?:\/\/doi\.org\//i, "")
    .trim()
    .toLowerCase();
}

/** 标题→DOI 匹配的相关度门槛（2026-09-26 实机审计）：Crossref
 *  bibliographic 检索对任何查询都返回"最接近"条目——乱码/碎片标题也会
 *  命中一条不相关论文并被导入错误元数据。归一化后按字符二元组 Dice 系数
 *  判定：错误案例「Deep learning」→「What's Deep About Deep Learning?」
 *  约 0.667 被拒；精确/近改写（副标题、大小写、标点差异）≥0.8 通过。 */
export const TITLE_MATCH_MIN_SIMILARITY = 0.7;

export function normalizeTitleForMatch(title: string): string {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitleForMatch(a);
  const nb = normalizeTitleForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(na);
  const gb = grams(nb);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return (2 * inter) / (ga.size + gb.size);
}

/** 从标题候选中选出足够相似的 DOI：先按相似度门槛过滤，再优先年份
 *  吻合、其后取相似度最高者。无候选过线 → null（诚实失败，宁可不导入
 *  也不导入错误论文）。 */
export function pickBestTitleMatch(
  queryTitle: string,
  candidates: Array<{ title?: string; doi?: string; year?: number }>,
  wantYear?: number,
): string | null {
  const scored = candidates
    .filter((c) => c.doi)
    .map((c) => ({
      doi: c.doi as string,
      sim: titleSimilarity(queryTitle, c.title || ""),
      year: c.year ?? NaN,
    }))
    .filter((c) => c.sim >= TITLE_MATCH_MIN_SIMILARITY);
  if (scored.length === 0) return null;
  if (wantYear != null && !isNaN(wantYear)) {
    const yearHit = scored.find((c) => c.year === wantYear);
    if (yearHit) return yearHit.doi;
  }
  scored.sort((a, b) => b.sim - a.sim);
  return scored[0].doi;
}

/**
 * DOI SQL batch query — returns Map<normalizedDoi, itemId>.
 * Respects SQLite IN clause limit (≤ 999).
 */
export async function batchQueryDois(
  dois: string[],
): Promise<Map<string, number>> {
  const doiToItemId = new Map<string, number>();
  const uniqueDois = [...new Set(dois.map(normalizeDOI))];
  for (let i = 0; i < uniqueDois.length; i += SQLITE_MAX_VARIABLES) {
    const batch = uniqueDois.slice(i, i + SQLITE_MAX_VARIABLES);
    const ph = batch.map(() => "?").join(",");
    try {
      const rows = await Zotero.DB.queryAsync(
        `SELECT I.itemID, LOWER(IDV.value) AS doi FROM itemData ID
         JOIN itemDataValues IDV ON ID.valueID = IDV.valueID
         JOIN items I ON I.itemID = ID.itemID
         JOIN fields F ON ID.fieldID = F.fieldID
         WHERE F.fieldName = 'DOI' AND LOWER(IDV.value) IN (${ph})`,
        batch,
      );
      for (const row of rows as unknown[]) {
        doiToItemId.set((row as any).doi, (row as any).itemID);
      }
    } catch (e) {
      safeDebug("[z-search] doiLookup: " + e);
      // SQL not available — skip
    }
  }
  return doiToItemId;
}

/**
 * CrossRef title→DOI search with 2 retries + exponential backoff.
 * Returns DOI string or null.
 *
 * year（审计 P2-7）：已知发表年时取前 5 候选，优先选年份吻合者——纯
 * relevance 第一条在同名/改版/译本文献上会导错论文。
 * 相关度门槛（2026-09-26）：候选标题与查询标题相似度必须过
 * TITLE_MATCH_MIN_SIMILARITY——bibliographic 检索对乱码/碎片标题也会
 * 返回"最接近"条目，无条件取第一条会导入错误论文。
 */
export async function crossrefTitleToDoi(
  title: string,
  year?: string,
): Promise<string | null> {
  const maxRetries = 2;
  const wantYear = year ? parseInt(year, 10) : NaN;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const cxUrl = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=5&sort=relevance`;
      const cxResp = await Zotero.HTTP.request("GET", cxUrl, {
        headers: {
          Accept: "application/json",
          ...ZSEARCH_HTTP_HEADERS,
        },
        timeout: 15000,
        errorDelayMax: 0,
      } as any);
      const cxData = JSON.parse(cxResp.responseText ?? "");
      const cxItems: any[] = cxData.message?.items || [];
      if (cxItems.length === 0) return null;
      return pickBestTitleMatch(
        title,
        cxItems.map((it) => ({
          title: Array.isArray(it.title) ? it.title[0] : it.title,
          doi: it.DOI,
          year: it.published?.["date-parts"]?.[0]?.[0],
        })),
        isNaN(wantYear) ? undefined : wantYear,
      );
    } catch (e) {
      safeDebug("[z-search] doiLookup: " + e);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  return null;
}

/**
 * Semantic Scholar title→DOI fallback.
 * Returns DOI string or null.
 *
 * 相关度门槛与 crossrefTitleToDoi 同一配方（见 pickBestTitleMatch）——
 * S2 的 search 同样对任意查询返回"最接近"论文。
 */
export async function s2TitleToDoi(
  title: string,
  year?: string,
): Promise<string | null> {
  try {
    const { getPref } = await import("../../../../../../utils/prefs");
    const ssKey = getPref("apis.semanticScholar.apiKey") as string;
    const url =
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=5&fields=externalIds,title,year` +
      (year ? `&year=${encodeURIComponent(year)}` : "");
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...ZSEARCH_HTTP_HEADERS,
    };
    if (ssKey) headers["x-api-key"] = ssKey;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers,
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    const data = JSON.parse(resp.responseText ?? "");
    const papers = data.data || [];
    return pickBestTitleMatch(
      title,
      papers.map((p: any) => ({
        title: p.title,
        doi: p.externalIds?.DOI,
        year: p.year,
      })),
      year ? parseInt(year, 10) : undefined,
    );
  } catch (e) {
    safeDebug("[z-search] doiLookup: " + e);
    return null;
  }
}
