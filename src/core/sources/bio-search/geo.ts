/**
 * GeoAdapter — GEO (Gene Expression Omnibus) 检索源（免 key）。
 *
 * GEO 是 NCBI 运营的基因表达数据库，通过 NCBI E-utilities API 访问。
 * 端点：/entrez/eutils/esearch.fcgi?db=gds&term=<query>&retmode=json
 *      /entrez/eutils/esummary.fcgi?db=gds&id=<id>&retmode=json
 *
 * 返回 DomainResult：
 *  - sourceId = GEO accession（如 "GSE123456"）
 *  - dedupKey = "geo:" + sourceId
 *  - extra 含 summary、platform、samples、organism、seriesType
 *
 * @module core/sources/bio-search/geo
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const NCBI_EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export class GeoAdapter extends DomainSourceAdapter {
  readonly id = "geo";
  readonly domainId = "bio";
  readonly label = "GEO (Gene Expression Omnibus)";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 100);

    // Step 1: esearch 获取 GEO DataSets 的 UID 列表
    const searchUrl = `${NCBI_EUTILS}/esearch.fcgi?db=gds&term=${encodeURIComponent(query)}&retmax=${limit}&retmode=json`;
    const searchResp = await Zotero.HTTP.request("GET", searchUrl, {
      headers: { ...ZSEARCH_HTTP_HEADERS },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (searchResp.status >= 400) {
      throw new Error(`GEO esearch error: HTTP ${searchResp.status}`);
    }

    let searchData: any;
    try {
      searchData = JSON.parse(searchResp.responseText || "{}");
    } catch (e) {
      throw new Error(`GEO esearch invalid JSON: ${toErrorMessage(e)}`);
    }

    const ids: string[] = searchData?.esearchresult?.idlist || [];
    if (ids.length === 0) return [];

    // Step 2: esummary 批量获取元数据
    const idStr = ids.slice(0, limit).join(",");
    const summaryUrl = `${NCBI_EUTILS}/esummary.fcgi?db=gds&id=${idStr}&retmode=json`;
    const summaryResp = await Zotero.HTTP.request("GET", summaryUrl, {
      headers: { ...ZSEARCH_HTTP_HEADERS },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (summaryResp.status >= 400) {
      throw new Error(`GEO esummary error: HTTP ${summaryResp.status}`);
    }

    let summaryData: any;
    try {
      summaryData = JSON.parse(summaryResp.responseText || "{}");
    } catch (e) {
      throw new Error(`GEO esummary invalid JSON: ${toErrorMessage(e)}`);
    }

    const result = summaryData?.result || {};
    const uids: string[] = result.uids || [];
    const results: DomainResult[] = [];

    for (const uid of uids.slice(0, maxResults)) {
      const entry = result[uid];
      if (!entry) continue;

      const accession = entry.accession || "";
      if (!accession) continue;

      const title = entry.title || "";
      if (!title) continue;

      // 摘要
      const summary = entry.summary || "";

      // 平台
      const platform = entry.platform || "";

      // 样本数
      const samples = entry.n_samples ?? 0;

      // 物种
      const organism = entry.taxon || "";

      // 数据类型（Series/DataSet）
      const entryType = entry.entrytype || "";

      const url = `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`;

      results.push({
        title,
        url,
        snippet: summary.slice(0, 300),
        source: "geo",
        sourceId: accession,
        year: entry.pdat
          ? entry.pdat.slice(0, 4)
          : entry.PDate
            ? entry.PDate.slice(0, 4)
            : undefined,
        dedupKey: `geo:${accession}`,
        metrics: {
          samples,
        },
        extra: {
          accession,
          summary,
          platform,
          organism,
          entryType,
          gpl: entry.gpl || "",
        },
      });
    }

    return results;
  }
}
