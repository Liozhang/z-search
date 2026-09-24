/** Per-source academic search handlers. */

import { openalexSourceSearch } from "./openalex";

/** medRxiv 的 OpenAlex source id（medRxiv 无自有搜索 API）。 */
const MEDRXIV_SOURCE = "https://openalex.org/S3005729997";

export async function searchMedrxiv(args: {
  query: string;
  maxResults?: number;
}): Promise<any> {
  return openalexSourceSearch({
    sourceId: MEDRXIV_SOURCE,
    query: args.query,
    maxResults: args.maxResults,
    landingBase: "https://www.medrxiv.org",
    source: "medrxiv",
  });
}
