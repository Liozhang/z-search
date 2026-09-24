/** Per-source academic search handlers. */

import { openalexSourceSearch } from "./openalex";

/** bioRxiv 的 OpenAlex source id（bioRxiv 无自有搜索 API）。 */
const BIORXIV_SOURCE = "https://openalex.org/S4306402567";

export async function searchBiorxiv(args: {
  query: string;
  maxResults?: number;
}): Promise<any> {
  return openalexSourceSearch({
    sourceId: BIORXIV_SOURCE,
    query: args.query,
    maxResults: args.maxResults,
    landingBase: "https://www.biorxiv.org",
    source: "biorxiv",
  });
}
