/** Per-source academic search handlers. */

import { getPrefDynamic } from "../../../utils/prefs";

import { httpJsonGet } from "../../../utils/http";
import { safeDebug } from "../../../utils/logger";
import { ncbiThrottle } from "../../../utils/ncbiThrottle";

export async function searchPubMed(args: {
  query: string;
  maxResults?: number;
  year?: string;
  reviewOnly?: boolean;
}): Promise<any> {
  const maxResults = Math.min(args.maxResults ?? 10, 25);
  const apiKey = getPrefDynamic("apis.pubmed.apiKey") as string;

  try {
    // PubMed publication-type filter is appended to the search term.
    const term = args.reviewOnly
      ? `(${args.query}) AND Review[ptyp]`
      : args.query;
    // Step 1: ESearch - get PMIDs
    let searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmode=json&retmax=${maxResults}&tool=leadero`;
    if (apiKey) searchUrl += `&api_key=${encodeURIComponent(apiKey)}`;
    // E-utilities 日期只认 YYYY[/MM[/DD]]——区间串原样传入即整源报错归零
    // （审计 P0-3）。区间拆成 mindate/maxdate，单年保持旧口径。
    if (args.year) {
      const range = args.year.match(/^(\d{4})\s*-\s*(\d{4})$/);
      if (range) {
        searchUrl += `&mindate=${range[1]}&maxdate=${range[2]}&datetype=pdat`;
      } else {
        searchUrl += `&mindate=${args.year}&maxdate=${args.year}&datetype=pdat`;
      }
    }

    await ncbiThrottle();
    const searchResult = await httpJsonGet(searchUrl, undefined, 15000);

    if (!searchResult.ok) {
      return {
        success: false,
        error: `PubMed ESearch error: ${searchResult.status}`,
        total: 0,
        articles: [],
        source: "pubmed",
      };
    }

    const searchData = JSON.parse(searchResult.body);
    const idList: string[] = searchData.esearchresult?.idlist || [];
    if (idList.length === 0) {
      return { total: 0, returned: 0, source: "pubmed", articles: [] };
    }

    // Step 2: ESummary - get metadata (JSON)
    const pmids = idList.join(",");
    let summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids}&retmode=json&tool=leadero`;
    if (apiKey) summaryUrl += `&api_key=${encodeURIComponent(apiKey)}`;

    await ncbiThrottle();
    const summaryResult = await httpJsonGet(summaryUrl, undefined, 15000);

    if (!summaryResult.ok) {
      return {
        success: false,
        error: `PubMed ESummary error: ${summaryResult.status}`,
        total: 0,
        articles: [],
        source: "pubmed",
      };
    }

    const summaryData = JSON.parse(summaryResult.body);
    const result = summaryData.result || {};

    // Step 3: EFetch - get abstracts and journal info (ESummary doesn't include them)
    const abstractMap = new Map<string, string>();
    const journalInfoMap = new Map<
      string,
      {
        containerTitle?: string;
        journalName?: string;
        issn?: string;
        volume?: string;
        issue?: string;
        pages?: string;
      }
    >();
    try {
      let fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmids}&retmode=xml&tool=leadero`;
      if (apiKey) fetchUrl += `&api_key=${encodeURIComponent(apiKey)}`;

      await ncbiThrottle();
      const fetchResult = await httpJsonGet(
        fetchUrl,
        { Accept: "application/xml" },
        15000,
      );

      if (fetchResult.ok) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(
          fetchResult.body,
          "text/xml",
        ) as XMLDocument;
        const articleEls = doc.getElementsByTagName("PubmedArticle");
        for (let i = 0; i < articleEls.length; i++) {
          const articleEl = articleEls[i];
          const pmidEls = articleEl.getElementsByTagName("PMID");
          const pmid = pmidEls[0]?.textContent || "";
          const abstractEls = articleEl.getElementsByTagName("AbstractText");
          if (abstractEls.length > 0) {
            const parts: string[] = [];
            for (let j = 0; j < abstractEls.length; j++) {
              const label = abstractEls[j].getAttribute("Label");
              const text = abstractEls[j].textContent?.trim() || "";
              parts.push(label ? `${label}: ${text}` : text);
            }
            abstractMap.set(pmid, parts.join(" "));
          }
          const journalEl = articleEl.getElementsByTagName("Journal")[0];
          if (journalEl) {
            const jTitle =
              journalEl.getElementsByTagName("Title")[0]?.textContent || "";
            const jIssn =
              journalEl.getElementsByTagName("ISSN")[0]?.textContent || "";
            const jVolume =
              journalEl.getElementsByTagName("Volume")[0]?.textContent || "";
            const jIssue =
              journalEl.getElementsByTagName("Issue")[0]?.textContent || "";
            const medlinePgn =
              articleEl.getElementsByTagName("MedlinePgn")[0]?.textContent ||
              "";
            if (jTitle || jIssn || jVolume || jIssue || medlinePgn) {
              journalInfoMap.set(pmid, {
                containerTitle: jTitle || undefined,
                journalName: jTitle || undefined,
                issn: jIssn || undefined,
                volume: jVolume || undefined,
                issue: jIssue || undefined,
                pages: medlinePgn || undefined,
              });
            }
          }
        }
      }
    } catch (e) {
      safeDebug("[z-search] pubmed: " + e);
      // Non-critical: abstracts and journal info are supplementary
    }

    const articles = idList
      .map((pmid) => {
        const item = result[pmid];
        if (!item) return null;

        const doiEntry = (item.articleids || []).find(
          (a: any) => a.idtype === "doi",
        );
        const pmcEntry = (item.articleids || []).find(
          (a: any) => a.idtype === "pmc",
        );

        return {
          title: item.title || "",
          authors: (item.authors || []).map((a: any) => a.name).join(", "),
          year: (item.pubdate || "").split(" ")[0] || "",
          abstract: abstractMap.get(pmid) || "",
          doi: doiEntry?.value || "",
          // PMID/PMCID 直出：全文解析（FullTextResolver）直接用 PMCID 走
          // efetch db=pmc，省一次 ID Converter 往返；无 DOI 的老文献靠
          // PMID 反查兜底。
          pmid,
          pmcid: pmcEntry?.value || "",
          url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
          pdfUrl: pmcEntry
            ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcEntry.value}/pdf/`
            : "",
          oaUrl: pmcEntry
            ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcEntry.value}/`
            : "",
          citationCount: 0,
          source: "pubmed" as const,
          ...(journalInfoMap.get(pmid) || {}),
        };
      })
      .filter(Boolean);

    return {
      total: parseInt(searchData.esearchresult?.count || "0", 10),
      returned: articles.length,
      source: "pubmed",
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: `PubMed search failed: ${e.message}`,
      total: 0,
      articles: [],
      source: "pubmed",
    };
  }
}
