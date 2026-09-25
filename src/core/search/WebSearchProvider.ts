/**
 * Web Search Provider - Unified web search across multiple engines
 *
 * Supports: SerpAPI, Brave Search, Tavily, DuckDuckGo, Google Custom Search,
 *           Serper.dev, Perplexity, Exa.ai, Bing, SearXNG, Wikipedia, archive.org
 * All providers return a normalized WebSearchResult shape.
 */

import { getPrefDynamic } from "../../utils/prefs";
import providerHealthChecker from "./ProviderHealthChecker";
import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";
import { getString } from "../../utils/locale";
import { safeDebug } from "../../utils/logger";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface WebSearchOptions {
  query: string;
  provider?: string;
  maxResults?: number;
}

interface WebSearchOutcome {
  total?: number;
  returned: number;
  source: string;
  results: WebSearchResult[];
  error?: string;
}

class WebSearchProvider {
  private getDefaultProvider(): string {
    // 启用清单参与选择（审计 P2-2）：管理面勾选的 addedSources 应实际
    // 生效——默认源不在启用集时不硬用；自动选择也只在启用集内取。
    // pref 存 JSON 串（HubSearchSourceHandler.writeAddedList），读侧解包。
    const addedRaw = getPrefDynamic("search.web.addedSources");
    let added: string[] = [];
    if (typeof addedRaw === "string" && addedRaw.trim()) {
      try {
        const parsed = JSON.parse(addedRaw);
        if (Array.isArray(parsed)) added = parsed.map(String);
      } catch {
        /* 非法 JSON 按未配置处理 */
      }
    }
    const inAdded = (id: string) => added.length === 0 || added.includes(id);

    const configured = getPrefDynamic("search.web.defaultProvider") as string;
    // 跳过运行时检测失效的 configured provider —— 不能硬用已知的失效 provider
    // (例如 serper credits 耗尽被 healthCheck 标 unreachable)。
    if (
      configured &&
      inAdded(configured) &&
      providerHealthChecker.getStatus(configured) !== "unreachable"
    ) {
      return configured;
    }
    // Auto-select first available provider if user hasn't explicitly chosen one
    // (or the chosen one is unreachable / disabled)
    const available = providerHealthChecker
      .getAvailableWebProviders()
      .filter(inAdded);
    if (available.length > 0) return available[0];
    // duckduckgo 不在 PROVIDER_TESTS (无 key 免费 scrape)，getStatus 返 "untested"，
    // 不会被 search() 的 unreachable 拦截挡住 —— 作为最终兜底。
    return "duckduckgo";
  }

  /** provider → 搜索器直查表；未知 provider 与 duckduckgo 同走 searchDuckDuckGo。 */
  private readonly searchers: Readonly<
    Record<
      string,
      (query: string, maxResults: number) => Promise<WebSearchOutcome>
    >
  > = {
    serpapi: (q, n) => this.searchSerpAPI(q, n),
    serper: (q, n) => this.searchSerper(q, n),
    brave: (q, n) => this.searchBrave(q, n),
    tavily: (q, n) => this.searchTavily(q, n),
    google: (q, n) => this.searchGoogleCustom(q, n),
    perplexity: (q, n) => this.searchPerplexity(q, n),
    exa: (q, n) => this.searchExa(q, n),
    bing: (q, n) => this.searchBing(q, n),
    "bing-html": (q, n) => this.searchBingHTML(q, n),
    searxng: (q, n) => this.searchSearXNG(q, n),
    wikipedia: (q, n) => this.searchWikipedia(q, n),
    archive: (q, n) => this.searchArchive(q, n),
    duckduckgo: (q, n) => this.searchDuckDuckGo(q, n),
  };

  async search(options: WebSearchOptions): Promise<WebSearchOutcome> {
    const provider = options.provider || this.getDefaultProvider();
    const maxResults = Math.min(options.maxResults ?? 10, 20);

    // Defense-in-depth: reject providers that failed connectivity test
    if (providerHealthChecker.getStatus(provider) === "unreachable") {
      return {
        error: `Provider "${provider}" is unreachable (connectivity test failed at startup). Try another provider.`,
        returned: 0,
        source: provider,
        results: [] as WebSearchResult[],
      };
    }

    try {
      const search =
        this.searchers[provider] ?? this.searchDuckDuckGo.bind(this);
      return await search(options.query, maxResults);
    } catch (e: any) {
      return {
        error: `Web search failed (${provider}): ${e.message}`,
        returned: 0,
        source: provider,
        results: [] as WebSearchResult[],
      };
    }
  }

  // --- SerpAPI (Google results) ---
  private async searchSerpAPI(query: string, maxResults: number) {
    const apiKey = getPrefDynamic("search.web.serpapi.apiKey") as string;
    if (!apiKey) {
      return {
        error: "SerpAPI requires an API key. Set it in preferences.",
        returned: 0,
        source: "serpapi",
        results: [] as WebSearchResult[],
      };
    }

    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(apiKey)}&num=${maxResults}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
    } as any);

    if (resp.status >= 400) {
      return {
        error: `SerpAPI error: ${resp.status}`,
        returned: 0,
        source: "serpapi",
        results: [] as WebSearchResult[],
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const organic = data.organic_results || [];

    return {
      total: data.search_information?.total_results || organic.length,
      returned: organic.length,
      source: "serpapi",
      results: organic.slice(0, maxResults).map((item: any) => ({
        title: item.title || "",
        url: item.link || "",
        snippet: item.snippet || "",
        source: "serpapi",
      })),
    };
  }

  // --- Brave Search ---
  private async searchBrave(query: string, maxResults: number) {
    const apiKey = getPrefDynamic("search.web.brave.apiKey") as string;
    if (!apiKey) {
      return {
        error: "Brave Search requires an API key.",
        returned: 0,
        source: "brave",
        results: [] as WebSearchResult[],
      };
    }

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
    } as any);

    if (resp.status >= 400) {
      return {
        error: `Brave Search error: ${resp.status}`,
        returned: 0,
        source: "brave",
        results: [] as WebSearchResult[],
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const web = data.web?.results || [];

    return {
      total: data.web?.total_results || web.length,
      returned: web.length,
      source: "brave",
      results: web.slice(0, maxResults).map((item: any) => ({
        title: item.title || "",
        url: item.url || "",
        snippet: item.description || item.extra_snippets?.[0] || "",
        source: "brave",
      })),
    };
  }

  // --- Tavily ---
  private async searchTavily(query: string, maxResults: number) {
    const apiKey = getPrefDynamic("search.web.tavily.apiKey") as string;
    if (!apiKey) {
      return {
        error: "Tavily requires an API key.",
        returned: 0,
        source: "tavily",
        results: [] as WebSearchResult[],
      };
    }

    const url = "https://api.tavily.com/search";
    const body = JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
    });

    const resp = await Zotero.HTTP.request("POST", url, {
      headers: {
        "Content-Type": "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      body,
      timeout: 15000,
    } as any);

    if (resp.status >= 400) {
      return {
        error: `Tavily error: ${resp.status}`,
        returned: 0,
        source: "tavily",
        results: [] as WebSearchResult[],
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const tavilyResults = data.results || [];

    return {
      total: tavilyResults.length,
      returned: tavilyResults.length,
      source: "tavily",
      results: tavilyResults.slice(0, maxResults).map((item: any) => ({
        title: item.title || "",
        url: item.url || "",
        snippet: item.content || "",
        source: "tavily",
      })),
    };
  }

  // --- Google Custom Search ---
  private async searchGoogleCustom(query: string, maxResults: number) {
    const apiKey = getPrefDynamic("search.web.google.apiKey") as string;
    const cx = getPrefDynamic("search.web.google.cx") as string;
    if (!apiKey || !cx) {
      return {
        error:
          "Google Custom Search requires both API Key and Search Engine ID (cx).",
        returned: 0,
        source: "google",
        results: [] as WebSearchResult[],
      };
    }

    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${maxResults}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
    } as any);

    if (resp.status >= 400) {
      return {
        error: `Google Custom Search error: ${resp.status}`,
        returned: 0,
        source: "google",
        results: [] as WebSearchResult[],
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const items = data.items || [];

    return {
      total: data.searchInformation?.totalResults || items.length,
      returned: items.length,
      source: "google",
      results: items.slice(0, maxResults).map((item: any) => ({
        title: item.title || "",
        url: item.link || "",
        snippet: item.snippet || "",
        source: "google",
      })),
    };
  }

  // --- Serper.dev (Google results via API) ---
  private async searchSerper(query: string, maxResults: number) {
    const apiKey = getPrefDynamic("search.web.serper.apiKey") as string;
    if (!apiKey) {
      return {
        error: "Serper.dev requires an API key. Set it in preferences.",
        returned: 0,
        source: "serper",
        results: [] as WebSearchResult[],
      };
    }

    const url = "https://google.serper.dev/search";
    const body = JSON.stringify({
      q: query,
      gl: "us",
      hl: "en",
      num: maxResults,
    });

    const resp = await Zotero.HTTP.request("POST", url, {
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        ...ZSEARCH_HTTP_HEADERS,
      },
      body,
      timeout: 15000,
    } as any);

    if (resp.status >= 400) {
      // 解析 body，让 credits/quota 耗尽这类可操作错误明确告诉用户
      // (之前只返 "error: 400"，用户不知道是 credits 还是网络)。
      let detail = "";
      try {
        const parsed = JSON.parse(resp.responseText || "");
        detail = parsed?.message || parsed?.error || "";
      } catch (e) {
        safeDebug(
          "[z-search] WebSearchProvider.serper error parse failed: " + e,
        ); /* non-JSON error body */
      }
      const isQuota = /credit|quota|limit|exceed|insufficient/i.test(detail);
      const hint = isQuota
        ? ` — ${getString("search-error-serper-quota")}`
        : "";
      return {
        error: `Serper.dev error ${resp.status}${hint}${detail ? `: ${detail}` : ""}`,
        returned: 0,
        source: "serper",
        results: [] as WebSearchResult[],
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const organic = data.organic_results || [];

    return {
      total: organic.length,
      returned: organic.length,
      source: "serper",
      results: organic.slice(0, maxResults).map((item: any) => ({
        title: item.title || "",
        url: item.link || "",
        snippet: item.snippet || "",
        source: "serper",
      })),
    };
  }

  // --- Perplexity (AI-powered search with synthesized answer) ---
  private async searchPerplexity(query: string, maxResults: number) {
    const apiKey = getPrefDynamic("search.web.perplexity.apiKey") as string;
    if (!apiKey) {
      return {
        error: "Perplexity requires an API key.",
        returned: 0,
        source: "perplexity",
        results: [] as WebSearchResult[],
      };
    }

    const url = "https://api.perplexity.ai/chat/completions";
    const body = JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: query }],
      return_citations: true,
      temperature: 0.2,
      max_tokens: 300,
      search_context_size: "medium",
    });

    const resp = await Zotero.HTTP.request("POST", url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...ZSEARCH_HTTP_HEADERS,
      },
      body,
      timeout: 30000,
    } as any);

    if (resp.status >= 400) {
      return {
        error: `Perplexity error: ${resp.status}`,
        returned: 0,
        source: "perplexity",
        results: [] as WebSearchResult[],
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const choice = data.choices?.[0];
    const aiAnswer = choice?.message?.content || "";
    const citations: Array<{ url?: string; title?: string }> =
      choice?.citations || [];

    const results: WebSearchResult[] = [];
    // First result: AI answer
    results.push({
      title: query,
      url: "",
      snippet: aiAnswer,
      source: "perplexity",
    });
    // Remaining: citations
    for (const cit of citations.slice(0, maxResults - 1)) {
      results.push({
        title: cit.title || "",
        url: cit.url || "",
        snippet: "",
        source: "perplexity",
      });
    }

    return {
      total: results.length,
      returned: results.length,
      source: "perplexity",
      results,
      answer: aiAnswer,
    };
  }

  // --- Exa.ai (neural/semantic search) ---
  private async searchExa(query: string, maxResults: number) {
    const apiKey = getPrefDynamic("search.web.exa.apiKey") as string;
    if (!apiKey) {
      return {
        error: "Exa.ai requires an API key.",
        returned: 0,
        source: "exa",
        results: [] as WebSearchResult[],
      };
    }

    const url = "https://api.exa.ai/search";
    const body = JSON.stringify({
      query,
      numResults: Math.min(maxResults, 10),
      type: "auto",
      contents: { text: true, maxCharacters: 500 },
    });

    const resp = await Zotero.HTTP.request("POST", url, {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        ...ZSEARCH_HTTP_HEADERS,
      },
      body,
      timeout: 15000,
    } as any);

    if (resp.status >= 400) {
      return {
        error: `Exa.ai error: ${resp.status}`,
        returned: 0,
        source: "exa",
        results: [] as WebSearchResult[],
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const exaResults = data.results || [];

    return {
      total: exaResults.length,
      returned: exaResults.length,
      source: "exa",
      results: exaResults.slice(0, maxResults).map((item: any) => ({
        title: item.title || "",
        url: item.url || "",
        snippet:
          (item.highlights && item.highlights.length > 0
            ? item.highlights.join(" ")
            : item.text?.slice(0, 500)) || "",
        source: "exa",
      })),
    };
  }

  // --- Bing Search API ---
  private async searchBing(query: string, maxResults: number) {
    const apiKey = getPrefDynamic("search.web.bing.apiKey") as string;
    if (!apiKey) {
      return {
        error: "Bing Search requires an API key.",
        returned: 0,
        source: "bing",
        results: [] as WebSearchResult[],
      };
    }

    const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${maxResults}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        "Ocp-Apim-Subscription-Key": apiKey,
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
    } as any);

    if (resp.status >= 400) {
      return {
        error: `Bing Search error: ${resp.status}`,
        returned: 0,
        source: "bing",
        results: [] as WebSearchResult[],
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const items = data.webPages?.value || [];

    return {
      total: data.webPages?.totalEstimatedMatches || items.length,
      returned: items.length,
      source: "bing",
      results: items.slice(0, maxResults).map((item: any) => ({
        title: item.name || "",
        url: item.url || "",
        snippet: (item.snippet || "").replace(/[\u200B\uFEFF]/g, "").trim(),
        source: "bing",
      })),
    };
  }

  // --- SearXNG (self-hosted meta search engine) ---
  private async searchSearXNG(query: string, maxResults: number) {
    let instanceUrl = (
      getPrefDynamic("search.web.searxng.instanceUrl") as string
    )?.trim();
    if (!instanceUrl) {
      return {
        error: "SearXNG requires an instance URL. Set it in preferences.",
        returned: 0,
        source: "searxng",
        results: [] as WebSearchResult[],
      };
    }

    instanceUrl = instanceUrl.replace(/\/+$/, "");
    if (!instanceUrl.endsWith("/search")) instanceUrl += "/search";
    if (!/^https?:\/\//.test(instanceUrl)) {
      return {
        error: "SearXNG instance URL must start with http:// or https://.",
        returned: 0,
        source: "searxng",
        results: [] as WebSearchResult[],
      };
    }

    const url = `${instanceUrl}?q=${encodeURIComponent(query)}&format=json&categories=general&s=max_results`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: { ...ZSEARCH_HTTP_HEADERS },
      timeout: 15000,
    } as any);

    if (resp.status >= 400) {
      return {
        error: `SearXNG error: ${resp.status}`,
        returned: 0,
        source: "searxng",
        results: [] as WebSearchResult[],
      };
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText ?? "");
    } catch (e) {
      safeDebug("[z-search] WebSearchProvider.searxng JSON parse failed: " + e);
      return {
        error: "SearXNG returned invalid JSON.",
        returned: 0,
        source: "searxng",
        results: [] as WebSearchResult[],
      };
    }

    // Different SearXNG instances may use "results" or "data" key
    const items = data.results || data.data || [];

    return {
      total: items.length,
      returned: items.length,
      source: "searxng",
      results: items.slice(0, maxResults).map((item: any) => ({
        title: item.title || "",
        url: item.url || "",
        snippet: item.content || "",
        source: "searxng",
      })),
    };
  }

  // --- Wikipedia (free encyclopedia search) ---
  private async searchWikipedia(query: string, maxResults: number) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${maxResults}&format=json`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: { ...ZSEARCH_HTTP_HEADERS },
      timeout: 15000,
    } as any);

    if (resp.status >= 400) {
      return {
        error: `Wikipedia error: ${resp.status}`,
        returned: 0,
        source: "wikipedia",
        results: [] as WebSearchResult[],
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const items = data.query?.search || [];

    return {
      total: data.query?.searchinfo?.totalhits || items.length,
      returned: items.length,
      source: "wikipedia",
      results: items.slice(0, maxResults).map((item: any) => ({
        title: item.title || "",
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title || "")}`,
        snippet: (item.snippet || "").replace(/<[^>]+>/g, ""),
        source: "wikipedia",
      })),
    };
  }

  // --- archive.org (web archive search) ---
  private async searchArchive(query: string, maxResults: number) {
    const safeQuery = query.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, "\\$1");
    const fields = "identifier,title,description,year,mediatype";
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(safeQuery)}&fl=${fields}&output=json&rows=${maxResults}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: { ...ZSEARCH_HTTP_HEADERS },
      timeout: 15000,
    } as any);

    if (resp.status >= 400) {
      return {
        error: `archive.org error: ${resp.status}`,
        returned: 0,
        source: "archive",
        results: [] as WebSearchResult[],
      };
    }

    const data = JSON.parse(resp.responseText ?? "");
    const docs = data.response?.docs || [];

    return {
      total: data.response?.numFound || docs.length,
      returned: docs.length,
      source: "archive",
      results: docs.slice(0, maxResults).map((item: any) => ({
        title: item.title || item.identifier || "",
        url: `https://archive.org/details/${item.identifier || ""}`,
        snippet: item.description || "",
        source: "archive",
      })),
    };
  }

  // --- DuckDuckGo (no API key, HTML parsing) ---
  private async searchDuckDuckGo(query: string, maxResults: number) {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: { ...ZSEARCH_HTTP_HEADERS },
      timeout: 15000,
    } as any);

    if (resp.status >= 400 || !resp.responseText) {
      return {
        error: `DuckDuckGo error: ${resp.status}`,
        returned: 0,
        source: "duckduckgo",
        results: [] as WebSearchResult[],
      };
    }

    const results: WebSearchResult[] = [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(resp.responseText, "text/html");

      // Strategy 1: Parse table rows with result links
      const rows = doc.querySelectorAll("tr");
      for (const row of rows) {
        if (results.length >= maxResults) break;

        const linkEl = row.querySelector(
          "a.result-link, td.result-link a, a[class*='result']",
        );
        if (linkEl) {
          const href = linkEl.getAttribute("href") || "";
          const title = linkEl.textContent?.trim() || "";
          if (href.startsWith("http") && title.length > 5) {
            const cells = row.querySelectorAll("td");
            let snippet = "";
            for (const cell of cells) {
              const text = cell.textContent?.trim() || "";
              if (text.length > 20 && !text.startsWith("http")) {
                snippet = text;
                break;
              }
            }
            results.push({ title, url: href, snippet, source: "duckduckgo" });
          }
        }
      }

      // Strategy 2: Fallback - find all external links
      if (results.length === 0) {
        const allLinks = doc.querySelectorAll("a[href]");
        for (const link of allLinks) {
          if (results.length >= maxResults) break;
          const href = link.getAttribute("href") || "";
          if (href.startsWith("/") || href.includes("duckduckgo.com")) continue;
          const title = link.textContent?.trim() || "";
          if (href.startsWith("http") && title.length > 10) {
            results.push({
              title,
              url: href,
              snippet: "",
              source: "duckduckgo",
            });
          }
        }
      }
    } catch (e) {
      safeDebug("[z-search] WebSearchProvider.duckduckgoHTML failed: " + e);
      // HTML parsing failed, return empty
    }

    return {
      total: results.length,
      returned: results.length,
      source: "duckduckgo",
      results,
    };
  }

  // --- Bing HTML (no API key, HTML parsing) ---
  private async searchBingHTML(query: string, maxResults: number) {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        ...ZSEARCH_HTTP_HEADERS,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      timeout: 15000,
    } as any);

    if (resp.status >= 400 || !resp.responseText) {
      return {
        error: `Bing HTML error: ${resp.status}`,
        returned: 0,
        source: "bing-html",
        results: [] as WebSearchResult[],
      };
    }

    const results: WebSearchResult[] = [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(resp.responseText, "text/html");

      // Strategy 1: Standard Bing result containers
      const algoItems = doc.querySelectorAll("li.b_algo");
      for (const item of algoItems) {
        if (results.length >= maxResults) break;

        const linkEl = item.querySelector("h2 a");
        if (!linkEl) continue;

        const href = linkEl.getAttribute("href") || "";
        const title = linkEl.textContent?.trim() || "";
        if (!href.startsWith("http") || title.length < 3) continue;

        const snippet =
          item.querySelector(".b_caption p")?.textContent?.trim() ||
          item.querySelector(".b_snippet")?.textContent?.trim() ||
          "";

        results.push({ title, url: href, snippet, source: "bing-html" });
      }

      // Strategy 2: Relaxed — any link inside .b_algo
      if (results.length === 0) {
        const links = doc.querySelectorAll(".b_algo a[href^='http']");
        for (const link of links) {
          if (results.length >= maxResults) break;
          const href = link.getAttribute("href") || "";
          const title = link.textContent?.trim() || "";
          if (href && title.length > 5) {
            results.push({
              title,
              url: href,
              snippet: "",
              source: "bing-html",
            });
          }
        }
      }

      // Strategy 3: Last resort — all external links
      if (results.length === 0) {
        const allLinks = doc.querySelectorAll("a[href^='http']");
        for (const link of allLinks) {
          if (results.length >= maxResults) break;
          const href = link.getAttribute("href") || "";
          if (href.includes("bing.com") || href.includes("microsoft.com"))
            continue;
          const title = link.textContent?.trim() || "";
          if (title.length > 10) {
            results.push({
              title,
              url: href,
              snippet: "",
              source: "bing-html",
            });
          }
        }
      }
    } catch (e) {
      safeDebug("[z-search] WebSearchProvider.bingHTML failed: " + e);
      // HTML parsing failed
    }

    return {
      total: results.length,
      returned: results.length,
      source: "bing-html",
      results,
    };
  }
}

const webSearchProvider = new WebSearchProvider();

export default webSearchProvider;
export { WebSearchProvider };
