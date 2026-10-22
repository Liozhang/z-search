/**
 * UnpaywallAdapter — Unpaywall API 检索源（需 email 参数）。
 *
 * Unpaywall 是全球最大的开放获取全文数据库，免费 API（需 email 参数）。
 * 端点：/v2/<doi>?email=<email>
 *
 * 与现有 FullTextResolver 的关系：FullTextResolver 走 PMC/OA 网页抓取；
 * Unpaywall 专门返回 OA 状态和最佳 PDF 直链，两者互补。
 *
 * 返回 DomainResult：
 *  - sourceId = DOI
 *  - dedupKey = DOI
 *  - extra 含 oaStatus、license、bestPdfUrl、repository
 *
 * @module core/sources/oa-fulltext-search/unpaywall
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { normalizeDoi } from "../../search/literatureSearchHelpers";
import { getPrefDynamic } from "../../../utils/prefs";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

const UNPAYWALL_API = "https://api.unpaywall.org/v2";

export class UnpaywallAdapter extends DomainSourceAdapter {
  readonly id = "unpaywall";
  readonly domainId = "oa-fulltext";
  readonly label = "Unpaywall";
  readonly noKey = true;

  async isAvailable() {
    // Unpaywall 需要 email 参数（免费，无需注册 key）
    // 使用插件维护的公共 email 或用户配置的 email
    return { available: true };
  }

  async search(
    query: string,
    _maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    // Unpaywall 只支持 DOI 查询，不支持关键词搜索
    // 如果 query 看起来像 DOI，直接查；否则返回空
    const doi = normalizeDoi(query);
    if (!doi) {
      throw new Error(
        "Unpaywall requires a DOI as query (not a keyword search). " +
          "Use literature.search for keyword queries, then check OA status per result.",
      );
    }

    const email =
      (getPrefDynamic("search.oa.unpaywallEmail") as string) ||
      "zotero-plugin@example.org";

    const url = `${UNPAYWALL_API}/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`Unpaywall API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`Unpaywall API invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    if (!data?.doi) return [];

    const result: DomainResult = {
      title: data.title || data.doi,
      url: `https://doi.org/${data.doi}`,
      snippet: "",
      source: "unpaywall",
      sourceId: data.doi,
      doi: data.doi,
      dedupKey: data.doi,
      extra: {
        oaStatus: data.is_oa ? data.oa_status : "closed",
        license: data.best_oa_location?.license || "",
        bestPdfUrl: data.best_oa_location?.url_for_pdf || "",
        publisherPage: data.best_oa_location?.url_for_landing_page || "",
        repository: data.best_oa_location?.host_type || "",
        genre: data.genre || "",
        publishedDate: data.published_date || "",
      },
    };

    return [result];
  }
}
