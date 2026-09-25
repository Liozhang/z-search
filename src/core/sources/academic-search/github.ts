/** Per-source academic search handlers. */

import { getPrefDynamic } from "../../../utils/prefs";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

export async function searchGithub(
  query: string,
  year?: string,
  limit?: number,
): Promise<any> {
  const maxResults = limit ?? 10;
  let q = query;
  if (year) {
    // created: 过滤器只认完整日期——区间串 "2017-2026" 原样拼入会 422
    // 整源归零（审计 P0-3）。区间展开为 lo-01-01..hi-12-31。
    const range = year.match(/^(\d{4})\s*-\s*(\d{4})$/);
    if (range) {
      q += ` created:${range[1]}-01-01..${range[2]}-12-31`;
    } else {
      q += ` created:${year}-01-01..${year}-12-31`;
    }
  }

  const url =
    `https://api.github.com/search/repositories` +
    `?q=${encodeURIComponent(q)}` +
    `&sort=stars&order=desc` +
    `&per_page=${maxResults}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    ...ZSEARCH_HTTP_HEADERS,
  };

  const token = getPrefDynamic("apis.github.token") as string;
  if (token) headers["Authorization"] = `token ${token}`;

  try {
    // request() rejects on non-2xx — read status from the exception
    let response: any;
    try {
      response = await Zotero.HTTP.request("GET", url, {
        headers,
        timeout: 15000,
      } as any);
    } catch (e: any) {
      const status = (e as any)?.status ?? 0;
      if (status === 429 || status === 403) {
        return {
          success: false,
          error: "GitHub rate limit reached",
          total: 0,
          source: "github",
          articles: [],
        };
      }
      if (status >= 400) {
        return {
          success: false,
          error: `GitHub API error: ${status}`,
          total: 0,
          source: "github",
          articles: [],
        };
      }
      return {
        success: false,
        error: toErrorMessage(e, "GitHub search failed"),
        total: 0,
        source: "github",
        articles: [],
      };
    }

    const data = JSON.parse(response.responseText ?? "");
    const items = data.items || [];

    const articles = items.map((repo: any) => ({
      title: repo.full_name || repo.name,
      authors: repo.owner?.login || "",
      year: repo.created_at?.substring(0, 4) || "",
      abstract: repo.description || "",
      doi: "",
      url: repo.html_url,
      pdfUrl: undefined as string | undefined,
      citationCount: repo.stargazers_count ?? 0,
      source: "github" as const,
      containerTitle: repo.language || "",
    }));

    return {
      total: data.total_count || articles.length,
      returned: articles.length,
      source: "github",
      articles,
    };
  } catch (e: any) {
    return {
      success: false,
      error: toErrorMessage(e, "GitHub search failed"),
      total: 0,
      source: "github",
      articles: [],
    };
  }
}
