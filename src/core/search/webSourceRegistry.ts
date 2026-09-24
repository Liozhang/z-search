/**
 * Web source registry — 网页搜索源的元数据注册表（搜索源管理批）。
 *
 * 13 家 provider 的 id 与 WebSearchProvider 的 options.provider 一一对应；
 * fields 描述各源的配置项（完整相对 pref 键，typed/dynamic 同键空间）。
 * label 为品牌名，不进 FTL。本表是搜索源管理 UI 与测试 RPC 的单一事实源。
 *
 * @module core/search/webSourceRegistry
 */

export interface WebSourceFieldDef {
  /** 字段语义键：apiKey / cx / instanceUrl */
  key: string;
  /** 完整相对 pref 键（defaults.ts + addon/prefs.js 已镜像） */
  prefKey: string;
  /** 字段 label（技术性字段名，品牌/协议词，不翻译） */
  label: string;
  /** 密钥型字段（UI 用 password 输入） */
  secret?: boolean;
}

export interface WebSourceDef {
  /** provider id（WebSearchProvider options.provider 值） */
  id: string;
  /** 品牌名（不翻译，不进 FTL） */
  label: string;
  /** 免 key 源：只需可达性，无需配置 */
  noKey?: boolean;
  fields: WebSourceFieldDef[];
}

export const WEB_SOURCE_DEFS: WebSourceDef[] = [
  // ── 免 key 源 ──
  { id: "duckduckgo", label: "DuckDuckGo", noKey: true, fields: [] },
  { id: "bing-html", label: "Bing (web)", noKey: true, fields: [] },
  { id: "wikipedia", label: "Wikipedia", noKey: true, fields: [] },
  { id: "archive", label: "Archive.org", noKey: true, fields: [] },
  {
    id: "searxng",
    label: "SearXNG (self-hosted)",
    fields: [
      {
        key: "instanceUrl",
        prefKey: "search.web.searxng.instanceUrl",
        label: "Instance URL",
      },
    ],
  },
  // ── key 源 ──
  {
    id: "tavily",
    label: "Tavily",
    fields: [
      {
        key: "apiKey",
        prefKey: "search.web.tavily.apiKey",
        label: "API Key",
        secret: true,
      },
    ],
  },
  {
    id: "brave",
    label: "Brave Search",
    fields: [
      {
        key: "apiKey",
        prefKey: "search.web.brave.apiKey",
        label: "API Key",
        secret: true,
      },
    ],
  },
  {
    id: "exa",
    label: "Exa",
    fields: [
      {
        key: "apiKey",
        prefKey: "search.web.exa.apiKey",
        label: "API Key",
        secret: true,
      },
    ],
  },
  {
    id: "serper",
    label: "Serper (Google)",
    fields: [
      {
        key: "apiKey",
        prefKey: "search.web.serper.apiKey",
        label: "API Key",
        secret: true,
      },
    ],
  },
  {
    id: "serpapi",
    label: "SerpAPI (Google)",
    fields: [
      {
        key: "apiKey",
        prefKey: "search.web.serpapi.apiKey",
        label: "API Key",
        secret: true,
      },
    ],
  },
  {
    id: "google",
    label: "Google Custom Search",
    fields: [
      {
        key: "apiKey",
        prefKey: "search.web.google.apiKey",
        label: "API Key",
        secret: true,
      },
      { key: "cx", prefKey: "search.web.google.cx", label: "Engine ID (cx)" },
    ],
  },
  {
    id: "perplexity",
    label: "Perplexity",
    fields: [
      {
        key: "apiKey",
        prefKey: "search.web.perplexity.apiKey",
        label: "API Key",
        secret: true,
      },
    ],
  },
  {
    id: "bing",
    label: "Bing (API)",
    fields: [
      {
        key: "apiKey",
        prefKey: "search.web.bing.apiKey",
        label: "API Key",
        secret: true,
      },
    ],
  },
];

export function findWebSource(id: string): WebSourceDef | undefined {
  return WEB_SOURCE_DEFS.find((s) => s.id === id);
}
