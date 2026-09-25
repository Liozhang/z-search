/** Per-source academic search handlers. */

import { httpJsonGet } from "../../../utils/http";

export async function searchEuropePMC(args: {
  query: string;
  maxResults?: number;
  reviewOnly?: boolean;
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  try {
    // Europe PMC filters by publication type within the query syntax.
    // pub_type is a single-token field; "Review" is the reliable value that
    // covers both narrative and systematic reviews (avoids quoted-space ambiguity).
    let searchQuery = args.query;
    if (args.reviewOnly) {
      searchQuery = `(${args.query}) AND pub_type:Review`;
    }
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(searchQuery)}&resultType=core&format=json&pageSize=${maxResults}`;

    const result = await httpJsonGet(url);

    if (!result.ok) {
      return {
        success: false,
        error: `Europe PMC API error: ${result.status}`,
        total: 0,
        articles: [],
        source: "europe-pmc",
      };
    }

    const data = JSON.parse(result.body);
    const resultList = data.resultList?.result || [];

    const articles = resultList.map((item: any) => {
      let pdfUrl = "";
      const ftUrls = item.fullTextUrlList?.fullTextUrl || [];
      for (const ft of ftUrls) {
        if (ft.documentStyle === "pdf") {
          pdfUrl = ft.url || "";
          break;
        }
      }
      if (!pdfUrl && item.pmcid) {
        pdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${item.pmcid}/pdf/`;
      }

      return {
        title: item.title || "",
        authors: item.authorString || "",
        year: item.pubYear || "",
        abstract: item.abstractText || "",
        doi: item.doi || "",
        // PMID/PMCID 直出：FullTextResolver 的 PMCID 直取与 PMID 反查入口。
        pmid: item.pmid || "",
        pmcid: item.pmcid || "",
        url: item.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/`
          : item.doi
            ? `https://doi.org/${item.doi}`
            : "",
        pdfUrl,
        // oaUrl 历史上等于 PDF 直链（HTTP 抓不得）——改为 PMC 文章页
        // （服务端渲染、含完整正文），供全文解析的 html 兜底与 UI 展示。
        oaUrl: item.pmcid
          ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${item.pmcid}/`
          : pdfUrl || (item.doi ? `https://doi.org/${item.doi}` : ""),
        citationCount: item.citationCount ?? 0,
        isOpenAccess: item.isOpenAccess === "Y",
        source: "europe-pmc" as const,
        containerTitle: item.journalTitle || undefined,
        journalName: item.journalTitle || undefined,
        // JCR/CASS 富集按 ISSN 查表——journalInfo.issn 可得而此前未映射，
        // Europe PMC 结果的分区/IF 徽章恒缺失（审计 P2-1）
        issn: item.journalInfo?.issn || undefined,
        volume: item.journalVolume || undefined,
        issue: item.journalIssue || undefined,
        pages: item.pageInfo || undefined,
        publicationType: item.pubTypeList?.pubType?.[0] || undefined,
      };
    });

    return {
      total: parseInt(data.hitCount || "0", 10),
      returned: articles.length,
      source: "europe-pmc",
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `Europe PMC search failed: ${e.message}`,
      total: 0,
      articles: [],
      source: "europe-pmc",
    };
  }
}
