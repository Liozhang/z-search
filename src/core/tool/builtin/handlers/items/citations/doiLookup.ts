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
 */
export async function crossrefTitleToDoi(
  title: string,
): Promise<string | null> {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const cxUrl = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=1&sort=relevance`;
      const cxResp = await Zotero.HTTP.request("GET", cxUrl, {
        headers: {
          Accept: "application/json",
          ...ZSEARCH_HTTP_HEADERS,
        },
        timeout: 15000,
        errorDelayMax: 0,
      } as any);
      const cxData = JSON.parse(cxResp.responseText ?? "");
      const cxItems = cxData.message?.items || [];
      if (cxItems.length > 0 && cxItems[0].DOI) {
        return cxItems[0].DOI;
      }
      return null;
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
 */
export async function s2TitleToDoi(
  title: string,
  year?: string,
): Promise<string | null> {
  try {
    const { getPref } = await import("../../../../../../utils/prefs");
    const ssKey = getPref("apis.semanticScholar.apiKey") as string;
    let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=1&fields=externalIds`;
    if (year) url += `&year=${encodeURIComponent(year)}`;
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
    if (papers.length > 0 && papers[0].externalIds?.DOI) {
      return papers[0].externalIds.DOI;
    }
    return null;
  } catch (e) {
    safeDebug("[z-search] doiLookup: " + e);
    return null;
  }
}
