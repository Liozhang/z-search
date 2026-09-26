/**
 * API key schema — shared single source of truth.
 *
 * Used by:
 *  - host 侧 prefApiKeys.ts(绑定 Zotero 原生偏好面板的 input)
 *  - Hub React 端 settings/ApiKeysSection.tsx(渲染 Hub 设置页字段)
 *
 * 添加新字段：只需在此追加一行，两端自动生效。字段文案 / placeholder key
 * 约定见各 locale 目录下的 preferences.ftl(pref-api-key-<service>、
 * pref-api-key-<service>-placeholder)。
 *
 * 注意：此文件是纯数据 schema，**不**做 i18n 解析(避免循环依赖 React 端的
 * locale 模块)。i18n 由消费方各自调 getString()。
 */

/** A single API key field. */
export interface ApiKeyField {
  /**
   * Unique id within the group. Used as:
   *  - host 端：XHTML element id(加 PREFIX 前缀)
   *  - React 端：React key
   */
  fieldId: string;
  /** Dynamic pref key(不含 prefsPrefix；运行时由 getPrefDynamic 加前缀)。 */
  prefKey: string;
  /** Fluent message id for the field label(pref-api-key-<service>)。 */
  labelKey: string;
  /** Fluent message id for the placeholder(含外链提示)。 */
  placeholderKey: string;
  /** input type：password 默认；少数(google-cx / searxng)用 text。openalex 早年收 mailto 邮箱故曾是 text，其 mailto 池 2026 年初已废、现为 API Key，回归掩码。 */
  type?: "password" | "text";
}

export interface ApiKeyFieldGroup {
  /** Group identifier used in collapsedApiGroups state and count badges. */
  groupId: "web-search" | "academic" | "tdm" | "patent";
  /** Fluent message id for the group header(pref-api-keys-<group>)。 */
  labelKey: string;
  /**
   * 改任一字段后是否清 PDF 缓存。academic(影响 OA 检测)与 tdm(含旧 header)需要。
   * 与 prefApiKeys.ts 原 clearsCache 行为一致。
   */
  clearsPdfCache?: boolean;
  /**
   * 反向标注：这组密钥被哪些功能消费（Fluent label keys of Hub settings
   * sections）。密钥总览据此渲染 "用于：xxx" chips，把孤立的密钥页与
   * 消费它的功能页连起来（设置重设计的 consumedBy 双面策略）。
   */
  consumedBy?: string[];
  fields: ApiKeyField[];
}

/**
 * Single source of truth for all API key bindings.
 *
 * 字段顺序对应 XHTML 里的视觉顺序；prefKeys 与原 prefApiKeys.ts 完全一致，
 * 已被 WebSearchProvider / CitationCountFetcher / AgentRouter 等消费方依赖。
 */
export const API_KEY_GROUPS: ApiKeyFieldGroup[] = [
  {
    groupId: "web-search",
    labelKey: "pref-api-keys-web-search",
    consumedBy: ["hub-settings-section-research", "hub-settings-section-tools"],
    fields: [
      {
        fieldId: "search-web-serpapi",
        prefKey: "search.web.serpapi.apiKey",
        labelKey: "pref-api-key-serpapi",
        placeholderKey: "pref-api-key-serpapi-placeholder",
      },
      {
        fieldId: "search-web-serper",
        prefKey: "search.web.serper.apiKey",
        labelKey: "pref-api-key-serper",
        placeholderKey: "pref-api-key-serper-placeholder",
      },
      {
        fieldId: "search-web-brave",
        prefKey: "search.web.brave.apiKey",
        labelKey: "pref-api-key-brave",
        placeholderKey: "pref-api-key-brave-placeholder",
      },
      {
        fieldId: "search-web-tavily",
        prefKey: "search.web.tavily.apiKey",
        labelKey: "pref-api-key-tavily",
        placeholderKey: "pref-api-key-tavily-placeholder",
      },
      {
        fieldId: "search-web-google",
        prefKey: "search.web.google.apiKey",
        labelKey: "pref-api-key-google",
        placeholderKey: "pref-api-key-google-placeholder",
      },
      {
        fieldId: "search-web-google-cx",
        prefKey: "search.web.google.cx",
        labelKey: "pref-api-key-google-cx",
        placeholderKey: "pref-api-key-google-cx-placeholder",
        type: "text",
      },
      {
        fieldId: "search-web-perplexity",
        prefKey: "search.web.perplexity.apiKey",
        labelKey: "pref-api-key-perplexity",
        placeholderKey: "pref-api-key-perplexity-placeholder",
      },
      {
        fieldId: "search-web-exa",
        prefKey: "search.web.exa.apiKey",
        labelKey: "pref-api-key-exa",
        placeholderKey: "pref-api-key-exa-placeholder",
      },
      {
        fieldId: "search-web-bing",
        prefKey: "search.web.bing.apiKey",
        labelKey: "pref-api-key-bing",
        placeholderKey: "pref-api-key-bing-placeholder",
      },
      {
        fieldId: "search-web-searxng",
        prefKey: "search.web.searxng.instanceUrl",
        labelKey: "pref-api-key-searxng",
        placeholderKey: "pref-api-key-searxng-placeholder",
        type: "text",
      },
    ],
  },
  {
    groupId: "academic",
    labelKey: "pref-api-keys-academic-search",
    clearsPdfCache: true,
    consumedBy: [
      "hub-settings-section-research",
      "hub-settings-tab-pdf-download",
      "hub-settings-section-item-columns",
    ],
    fields: [
      {
        fieldId: "apis-core-apiKey",
        prefKey: "apis.core.apiKey",
        labelKey: "pref-api-key-core",
        placeholderKey: "pref-api-key-core-placeholder",
      },
      {
        fieldId: "apis-semanticscholar-apiKey",
        prefKey: "apis.semanticScholar.apiKey",
        labelKey: "pref-api-key-semanticscholar",
        placeholderKey: "pref-api-key-semanticscholar-placeholder",
      },
      {
        fieldId: "apis-openalex-apiKey",
        prefKey: "apis.openalex.apiKey",
        labelKey: "pref-api-key-openalex",
        placeholderKey: "pref-api-key-openalex-placeholder",
      },
      {
        fieldId: "apis-dimensions-apiKey",
        prefKey: "apis.dimensions.apiKey",
        labelKey: "pref-api-key-dimensions",
        placeholderKey: "pref-api-key-dimensions-placeholder",
      },
      {
        fieldId: "apis-pubmed-apiKey",
        prefKey: "apis.pubmed.apiKey",
        labelKey: "pref-api-key-pubmed",
        placeholderKey: "pref-api-key-pubmed-placeholder",
      },
      {
        fieldId: "apis-github-token",
        prefKey: "apis.github.token",
        labelKey: "pref-api-key-github",
        placeholderKey: "pref-api-key-github-placeholder",
      },
      {
        // easyScholar 免费 key（中文核心期刊标识的可选数据源，P1-4）
        fieldId: "apis-easyscholar-apiKey",
        prefKey: "apis.easyscholar.apiKey",
        labelKey: "pref-api-key-easyscholar",
        placeholderKey: "pref-api-key-easyscholar-placeholder",
      },
    ],
  },
  {
    groupId: "tdm",
    labelKey: "pref-api-keys-tdm",
    clearsPdfCache: true,
    consumedBy: ["hub-settings-tab-pdf-download"],
    fields: [
      {
        fieldId: "apis-elsevier-apiKey",
        prefKey: "apis.elsevier.apiKey",
        labelKey: "pref-api-key-elsevier",
        placeholderKey: "pref-api-key-elsevier-placeholder",
      },
      {
        fieldId: "apis-wiley-tdmToken",
        prefKey: "apis.wiley.tdmToken",
        labelKey: "pref-api-key-wiley",
        placeholderKey: "pref-api-key-wiley-placeholder",
      },
    ],
  },
  {
    groupId: "patent",
    labelKey: "pref-api-keys-patent",
    consumedBy: ["hub-settings-section-research"],
    fields: [
      {
        fieldId: "apis-uspto-apiKey",
        prefKey: "apis.uspto.apiKey",
        labelKey: "pref-api-key-uspto",
        placeholderKey: "pref-api-key-uspto-placeholder",
      },
      {
        fieldId: "apis-epo-consumerKey",
        prefKey: "apis.epo.consumerKey",
        labelKey: "pref-api-key-epo-consumer",
        placeholderKey: "pref-api-key-epo-consumer-placeholder",
        type: "text",
      },
      {
        fieldId: "apis-epo-consumerSecret",
        prefKey: "apis.epo.consumerSecret",
        labelKey: "pref-api-key-epo-secret",
        placeholderKey: "pref-api-key-epo-secret-placeholder",
      },
      {
        fieldId: "apis-lens-token",
        prefKey: "apis.lens.token",
        labelKey: "pref-api-key-lens",
        placeholderKey: "pref-api-key-lens-placeholder",
      },
      {
        fieldId: "apis-pqai-token",
        prefKey: "apis.pqai.token",
        labelKey: "pref-api-key-pqai",
        placeholderKey: "pref-api-key-pqai-placeholder",
      },
      {
        fieldId: "apis-jpo-apiKey",
        prefKey: "apis.jpo.apiKey",
        labelKey: "pref-api-key-jpo",
        placeholderKey: "pref-api-key-jpo-placeholder",
      },
      {
        fieldId: "apis-kipris-apiKey",
        prefKey: "apis.kipris.apiKey",
        labelKey: "pref-api-key-kipris",
        placeholderKey: "pref-api-key-kipris-placeholder",
      },
    ],
  },
];
