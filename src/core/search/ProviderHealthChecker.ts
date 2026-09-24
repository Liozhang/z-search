/**
 * Provider Health Checker
 *
 * Tests connectivity of API-key-required search providers when the chat window opens.
 * Results are stored in-memory (not persisted) and read synchronously by ToolManager
 * when building the tool list for the AI.
 *
 * Constraints:
 * - Uses Zotero.HTTP.request (not fetch) — SpiderMonkey sandbox
 * - Uses timeout parameter (not AbortController) — not available in SpiderMonkey
 * - Synchronous reads from in-memory Map — toAITools() must remain sync
 */

import { getPrefDynamic } from "../../utils/prefs";
import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";
import { safeDebug } from "../../utils/logger";

type HealthStatus = "ok" | "unreachable" | "untested" | "testing";

interface ProviderTestConfig {
  id: string;
  category: "web" | "academic" | "patent";
  prefKeys: string[];
  /** Human-readable name for UI display. */
  label: string;
  test: (keys: Record<string, string>) => Promise<boolean>;
}

const PROVIDER_TESTS: ProviderTestConfig[] = [
  // ── Web Search (API key required) ──
  {
    id: "serpapi",
    category: "web",
    label: "SerpAPI",
    prefKeys: ["search.web.serpapi.apiKey"],
    test: async (keys) => {
      const url = `https://serpapi.com/search.json?engine=google&q=test&api_key=${encodeURIComponent(keys["search.web.serpapi.apiKey"])}&num=1`;
      const resp = await Zotero.HTTP.request("GET", url, {
        headers: {
          Accept: "application/json",
          ...ZSEARCH_HTTP_HEADERS,
        },
        timeout: 8000,
        responseType: "text",
      } as any);
      return resp.status < 400;
    },
  },
  {
    id: "serper",
    category: "web",
    label: "Serper",
    prefKeys: ["search.web.serper.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "POST",
        "https://google.serper.dev/search",
        {
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": keys["search.web.serper.apiKey"],
            ...ZSEARCH_HTTP_HEADERS,
          },
          body: JSON.stringify({ q: "test", num: 1 }),
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "brave",
    category: "web",
    label: "Brave",
    prefKeys: ["search.web.brave.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "GET",
        "https://api.search.brave.com/res/v1/web/search?q=test&count=1",
        {
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": keys["search.web.brave.apiKey"],
            ...ZSEARCH_HTTP_HEADERS,
          },
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "tavily",
    category: "web",
    label: "Tavily",
    prefKeys: ["search.web.tavily.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "POST",
        "https://api.tavily.com/search",
        {
          headers: {
            "Content-Type": "application/json",
            ...ZSEARCH_HTTP_HEADERS,
          },
          body: JSON.stringify({
            api_key: keys["search.web.tavily.apiKey"],
            query: "test",
            max_results: 1,
          }),
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "google",
    category: "web",
    label: "Google CSE",
    prefKeys: ["search.web.google.apiKey", "search.web.google.cx"],
    test: async (keys) => {
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(keys["search.web.google.apiKey"])}&cx=${encodeURIComponent(keys["search.web.google.cx"])}&q=test&num=1`;
      const resp = await Zotero.HTTP.request("GET", url, {
        headers: {
          Accept: "application/json",
          ...ZSEARCH_HTTP_HEADERS,
        },
        timeout: 8000,
        responseType: "text",
      } as any);
      return resp.status < 400;
    },
  },
  {
    id: "perplexity",
    category: "web",
    label: "Perplexity",
    prefKeys: ["search.web.perplexity.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "POST",
        "https://api.perplexity.ai/chat/completions",
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${keys["search.web.perplexity.apiKey"]}`,
            ...ZSEARCH_HTTP_HEADERS,
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "exa",
    category: "web",
    label: "Exa",
    prefKeys: ["search.web.exa.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "POST",
        "https://api.exa.ai/search",
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": keys["search.web.exa.apiKey"],
            ...ZSEARCH_HTTP_HEADERS,
          },
          body: JSON.stringify({ query: "test", numResults: 1, type: "auto" }),
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "bing",
    category: "web",
    label: "Bing",
    prefKeys: ["search.web.bing.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "GET",
        "https://api.bing.microsoft.com/v7.0/search?q=test&count=1",
        {
          headers: {
            Accept: "application/json",
            "Ocp-Apim-Subscription-Key": keys["search.web.bing.apiKey"],
            ...ZSEARCH_HTTP_HEADERS,
          },
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "searxng",
    category: "web",
    label: "SearXNG",
    prefKeys: ["search.web.searxng.instanceUrl"],
    test: async (keys) => {
      let instanceUrl = (keys["search.web.searxng.instanceUrl"] || "")
        .trim()
        .replace(/\/+$/, "");
      if (!instanceUrl.endsWith("/search")) instanceUrl += "/search";
      if (!/^https?:\/\//.test(instanceUrl)) return false;
      const resp = await Zotero.HTTP.request(
        "GET",
        `${instanceUrl}?q=test&format=json`,
        {
          headers: {
            ...ZSEARCH_HTTP_HEADERS,
          },
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  // ── Academic (API key required) ──
  {
    id: "dimensions",
    category: "academic",
    label: "Dimensions",
    prefKeys: ["apis.dimensions.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "POST",
        "https://api.dimensions.ai/dsl/v2",
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${keys["apis.dimensions.apiKey"]}`,
            ...ZSEARCH_HTTP_HEADERS,
          },
          body: JSON.stringify({
            type: "documents",
            limit: 1,
            search_documents: "test",
          }),
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },

  // ── Academic (API key optional — only test when key is configured) ──
  {
    id: "semantic-scholar",
    category: "academic",
    label: "Semantic Scholar",
    prefKeys: ["apis.semanticScholar.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "GET",
        "https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1&fields=paperId",
        {
          headers: {
            Accept: "application/json",
            "x-api-key": keys["apis.semanticScholar.apiKey"],
            ...ZSEARCH_HTTP_HEADERS,
          },
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "core",
    category: "academic",
    label: "CORE",
    prefKeys: ["apis.core.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "GET",
        "https://api.core.ac.uk/v3/search/works?q=test&limit=1",
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${keys["apis.core.apiKey"]}`,
            ...ZSEARCH_HTTP_HEADERS,
          },
          timeout: 15000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "pubmed",
    category: "academic",
    label: "PubMed",
    prefKeys: ["apis.pubmed.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "GET",
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?db=pubmed&api_key=${encodeURIComponent(keys["apis.pubmed.apiKey"])}`,
        {
          headers: { ...ZSEARCH_HTTP_HEADERS },
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "github",
    category: "academic",
    label: "GitHub",
    prefKeys: ["apis.github.token"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "GET",
        "https://api.github.com/rate_limit",
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `token ${keys["apis.github.token"]}`,
            ...ZSEARCH_HTTP_HEADERS,
          },
          timeout: 8000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },

  // ── Patent (API key required) ──
  {
    id: "uspto-odp",
    category: "patent",
    label: "USPTO ODP",
    prefKeys: ["apis.uspto.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "GET",
        `https://api.uspto.gov/api/v1/patent/applications/search?query=test&start=0&rows=1`,
        {
          headers: {
            Accept: "application/json",
            "X-Api-Key": keys["apis.uspto.apiKey"],
            ...ZSEARCH_HTTP_HEADERS,
          },
          timeout: 15000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "epo-ops",
    category: "patent",
    label: "EPO OPS",
    prefKeys: ["apis.epo.consumerKey", "apis.epo.consumerSecret"],
    test: async (_keys) => {
      // Test = OAuth token exchange + minimal search
      const { getEpoAccessToken } = await import("../patent/EpoOAuthClient");
      const token = await getEpoAccessToken();
      const resp = await Zotero.HTTP.request(
        "GET",
        "https://ops.epo.org/3.2/rest-services/published-data/search?q=ti%3D%22test%22&range=1-1",
        {
          headers: {
            Accept: "application/xml",
            Authorization: `Bearer ${token}`,
            ...ZSEARCH_HTTP_HEADERS,
          },
          timeout: 15000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "lens",
    category: "patent",
    label: "Lens.org",
    prefKeys: ["apis.lens.token"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "POST",
        "https://api.lens.org/patent/search",
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${keys["apis.lens.token"]}`,
            ...ZSEARCH_HTTP_HEADERS,
          },
          body: JSON.stringify({
            query: { bool: { must: [{ match_all: {} }] } },
            size: 1,
          }),
          timeout: 15000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "pqai",
    category: "patent",
    label: "PQAI",
    prefKeys: ["apis.pqai.token"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "GET",
        `https://api.projectpq.ai/search/102/?q=test&n=1&type=patent&token=${encodeURIComponent(keys["apis.pqai.token"])}`,
        {
          headers: { Accept: "application/json", ...ZSEARCH_HTTP_HEADERS },
          timeout: 15000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
  {
    id: "kipris",
    category: "patent",
    label: "KIPRIS",
    prefKeys: ["apis.kipris.apiKey"],
    test: async (keys) => {
      const resp = await Zotero.HTTP.request(
        "GET",
        `https://plus.kipris.or.kr/openapi/rest/patentntcl/patentBiblioSummaryInfoSearchQuery?accesskey=${encodeURIComponent(keys["apis.kipris.apiKey"])}&query=test&docsStart=1&docsCount=1&sortSpec=AD`,
        {
          headers: { Accept: "application/xml", ...ZSEARCH_HTTP_HEADERS },
          timeout: 15000,
          responseType: "text",
        } as any,
      );
      return resp.status < 400;
    },
  },
];

const providerHealthChecker = {
  status: new Map<string, HealthStatus>(),
  /** 防止 runAllTests 并发执行的标志位。 */
  _allTestsRunning: false,

  async runAllTests(): Promise<void> {
    // 如果已有测试在运行，跳过本次调用（避免并发覆盖结果）
    if (this._allTestsRunning) return;
    this._allTestsRunning = true;

    try {
      // Reset all statuses to untested before re-testing
      for (const config of PROVIDER_TESTS) {
        this.status.set(config.id, "untested");
      }

      const tests = PROVIDER_TESTS.map(async (config) => {
        const keys: Record<string, string> = {};
        for (const prefKey of config.prefKeys) {
          const val = (getPrefDynamic(prefKey) as string)?.trim();
          if (!val) return; // skip — no key configured
          keys[prefKey] = val;
        }

        try {
          const ok = await config.test(keys);
          this.status.set(config.id, ok ? "ok" : "unreachable");
        } catch (e) {
          safeDebug(
            "[z-search] ProviderHealthChecker.testHealth(" +
              config.id +
              ") failed: " +
              e,
          );
          this.status.set(config.id, "unreachable");
        }
      });

      await Promise.allSettled(tests);
    } finally {
      this._allTestsRunning = false;
    }
  },

  /** Invalidate status when user changes a key. */
  invalidateStatus(id: string): void {
    this.status.set(id, "untested");
  },

  getStatus(id: string): HealthStatus {
    return this.status.get(id) || "untested";
  },

  getUnavailableWebProviders(): string[] {
    const result: string[] = [];
    for (const config of PROVIDER_TESTS) {
      if (
        config.category === "web" &&
        this.status.get(config.id) === "unreachable"
      ) {
        result.push(config.id);
      }
    }
    return result;
  },

  getUnavailableProviders(): string[] {
    const result: string[] = [];
    for (const config of PROVIDER_TESTS) {
      if (this.status.get(config.id) === "unreachable") {
        result.push(config.id);
      }
    }
    return result;
  },

  getAvailableWebProviders(): string[] {
    const result: string[] = [];
    for (const config of PROVIDER_TESTS) {
      if (config.category === "web" && this.status.get(config.id) === "ok") {
        result.push(config.id);
      }
    }
    return result;
  },

  getAvailablePatentProviders(): string[] {
    const result: string[] = [];
    for (const config of PROVIDER_TESTS) {
      if (config.category === "patent" && this.status.get(config.id) === "ok") {
        result.push(config.id);
      }
    }
    return result;
  },

  getUnavailablePatentProviders(): string[] {
    const result: string[] = [];
    for (const config of PROVIDER_TESTS) {
      if (
        config.category === "patent" &&
        this.status.get(config.id) === "unreachable"
      ) {
        result.push(config.id);
      }
    }
    return result;
  },

  getAvailableAcademicProviders(): string[] {
    const result: string[] = [];
    for (const config of PROVIDER_TESTS) {
      if (
        config.category === "academic" &&
        this.status.get(config.id) === "ok"
      ) {
        result.push(config.id);
      }
    }
    return result;
  },

  getUnavailableAcademicProviders(): string[] {
    const result: string[] = [];
    for (const config of PROVIDER_TESTS) {
      if (
        config.category === "academic" &&
        this.status.get(config.id) === "unreachable"
      ) {
        result.push(config.id);
      }
    }
    return result;
  },
};

export default providerHealthChecker;
