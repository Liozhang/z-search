/**
 * Shared HTTP headers constant for z-search outbound requests.
 * Used by all HTTP request calls (web search, academic sources, etc.).
 */

export const ZSEARCH_HTTP_HEADERS: Record<string, string> = {
  "X-Plugin-Name": "z-search",
  "X-Plugin-Version":
    typeof __buildVersion__ !== "undefined" ? __buildVersion__ : "",
  "X-Addon-ID": "zsearch@z-search.dev",
};
