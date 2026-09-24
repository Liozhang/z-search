/**
 * Preference defaults — single source of truth.
 *
 * Consumers:
 *  - addon/prefs.js            — MUST mirror every entry here (verified by
 *                                tests/core/defaults-consistency.test.ts,
 *                                which parses prefs.js and compares both
 *                                directions: key sets and values).
 *  - host fallbacks            — prefEmbedding.ts and friends use the named
 *                                constants below instead of hardcoding model
 *                                ids (they had drifted to 4 different values).
 *  - React initial state       — Hub settings sections should seed useState
 *                                from these instead of guessing.
 *
 * Rules:
 *  1. Adding/renaming/deleting a pref: update DEFAULT_PREFS and addon/prefs.js
 *     in the same commit — the consistency test fails the build otherwise.
 *  2. A default consumed directly in code gets a named constant, and the
 *     DEFAULT_PREFS entry references it, so there is exactly one place where
 *     the literal value lives.
 *  3. Internal runtime state (counters, UI collapse caches) does NOT belong
 *     here or in prefs.js — see the state-store migration plan.
 */

// ==================== Named constants ====================

/** Default local embedding model (384-dim, bilingual ZH+EN, CPU-friendly). */
export const DEFAULT_EMBEDDING_LOCAL_MODEL = "Xenova/multilingual-e5-small";

/** Default translation engine. "google" works keyless out of the box (free
 *  endpoint, with a keyless Bing web fallback when Google is unreachable);
 *  "ai" delegates to the modelRouter feature path and needs explicit model
 *  configuration, so it is a user choice, not the default. */
export const DEFAULT_TRANSLATE_ENGINE_TYPE = "google";

/** Default PDF parser backend (primary engine; fallback chain handled at runtime). */
export const DEFAULT_PDF_PARSER_BACKEND = "opendataloader";

/** Default embedding mode ("local"; ONNX multilingual-e5-small is zero-config
 *  out of the box — first use auto-downloads the model, mirroring the ODL
 *  JRE download flow. API mode is opt-in for users who prefer their provider/key.) */
export const DEFAULT_EMBEDDING_MODE = "local";

/** Decision model (System 1 / JEV-class via the OpenRouter Decisions API).
 *  Off by default: decision states carry library/user content to a remote
 *  endpoint, so this is strictly opt-in. The model slug is pinned (not the
 *  ~latest alias) — screening verdicts must not drift silently with upstream
 *  redirects. */
export const DEFAULT_DECISION_MODE = "off";
export const DEFAULT_DECISION_MODEL = "typesafe/jev-1.13";
/** Screening triage bands: p >= include keeps the paper without the LLM
 *  evaluation, p <= exclude drops it, the band between goes to the existing
 *  LLM evaluation (ensemble structure). */
export const DEFAULT_DECISION_SCREEN_INCLUDE = 0.8;
export const DEFAULT_DECISION_SCREEN_EXCLUDE = 0.2;
/** Empty = per-mode default: OpenRouter Decisions endpoint for
 *  decision.mode "openrouter", the local shim for "local". Override enables
 *  mirrors (openrouter mode) or a shim on another host/port (local mode). */
export const DEFAULT_DECISION_ENDPOINT = "";
/** Decision-bearer override: a TypeSafe-direct key (api.typesafe.ai) is not an
 *  OpenRouter key, so it cannot ride the provider keychain entry. Empty =
 *  openrouter mode falls back to the OpenRouter provider key; local mode
 *  never sends auth. Plain-pref storage follows the translate.custom.apiKey
 *  precedent (comparable-risk single-purpose key). */
export const DEFAULT_DECISION_API_KEY = "";
export const DEFAULT_DECISION_LOCAL_ENDPOINT =
  "http://127.0.0.1:8902/api/alpha/decisions";

/** Default web search provider (keyless fallback — works without API keys). */
export const DEFAULT_SEARCH_PROVIDER = "duckduckgo";

// ==================== Full default map ====================
// Keys are relative (no extensions.zotero.leadero. prefix — Zotero adds it
// when loading addon/prefs.js). Values must be JSON-representable scalars.

export const DEFAULT_PREFS: Readonly<
  Record<string, string | number | boolean>
> = {
  // Unified model/provider config (JSON, managed by ConfigManager)
  "ai.providers": "{}",
  "ai.models": "{}",

  // Feature-based provider selection (empty = not configured, user must choose)
  "ai.selection.chat": "",
  "ai.selection.agent": "",
  "ai.selection.vision": "",
  "ai.selection.translation": "",
  "ai.selection.embedding": "",

  // Common settings
  "ai.temperature": 0.7,
  "ai.toolConcurrency": 3,
  "ai.maxIterations": 100,
  // P1-B batch 2b: SDK-native multi-step loop pilot (chat mode first), default off
  "ai.multiStepPilot": false,

  // B2 三维语义审计（严格模式规则门控阈值与等待弹窗）
  "ai.audit.minCitations": 2,
  "ai.audit.minChars": 1500,
  "ai.audit.waitPromptMs": 90000,

  // B4 外部元数据核验（隐私开关默认开；mailto 为 Crossref polite pool 可选）
  "research.externalVerify": true,
  "research.externalVerifyMailto": "",

  // Multi-agent concurrency
  "agent.subAgentMaxConcurrent": 3,

  // Deep Research
  "research.investigationParallel": true,
  "research.citationStyle": "apa",

  // Context management
  "ai.model.maxContext": 128000,

  // Soul settings
  "soul.active": "default",

  // MCP Client
  "mcp.client.enabled": false,
  "mcp.client.servers": "",
  "mcp.client.relayUrl": "",

  // MCP Server (expose Leadero tools to external agents; read-only default)
  "mcp.server.enabled": false,
  "mcp.server.port": 23146,
  "mcp.server.token": "",
  "mcp.server.allowWrite": false,

  // A2A Client (external A2A servers Leadero can dispatch agents to)
  "a2a.client.servers": "[]",

  // A2A Server (Agent2Agent endpoint for external agent clients; read-only)
  "a2a.server.enabled": false,
  "a2a.server.port": 23145,
  "a2a.server.token": "",
  "a2a.server.allowWrite": false,

  // Auto-analysis
  "autoAnalyze.new": false,
  "autoAnalyze.tagChange": false,
  "autoAnalyze.annotation": false,
  "autoAnalyze.delay": 2000,

  // Auto-scan
  "autoScan.enabled": false,
  "autoScan.createNote": false,

  // Advanced
  "advanced.debugLog": false,
  "advanced.timeout": 300000,

  // Reader sidebar
  "reader.sidebar.width": 400,

  // Tools
  "tools.disabled": "[]",
  "tools.forceEnabled": "[]",

  // Prompt templates
  "prompts.customDir": "",

  // Sci-Hub
  "scihub.mirrors": "",

  // PDF Finder
  "pdfFinder.customSources": "",
  // 灰色源门控（2026-09-07 裁决）：Sci-Hub 默认关，设置页开关+二次确认启用
  "pdfFinder.includeSciHub": false,

  // Hooks
  "hooks.config": "[]",
  // 第四层自动化总门（2026-09-21 HookManager 补实现）
  "hooks.enabled": false,

  // UI state
  "ui.globeAnimated": true,

  // Translation
  "translate.enabled": false,
  "translate.auto": false,
  "translate.maxChars": 10000,
  "translate.engineType": DEFAULT_TRANSLATE_ENGINE_TYPE,
  "translate.google.apiKey": "",
  "translate.bing.apiKey": "",
  "translate.bing.region": "",
  "translate.deepl.apiKey": "",
  "translate.deepl.useFree": false,
  "translate.custom.apiUrl": "",
  "translate.custom.apiKey": "",
  "translate.custom.model": "",

  // Cron
  "cron.enabled": false,
  "tracking.retentionDays": 180,
  "cron.pollInterval": 60000,

  // Code Execution Security
  "security.codeExec.enabled": false,
  "security.codeExec.timeout": 300000,
  "security.codeExec.whitelist": "[]",
  "security.codeExec.maxOutputLength": 100000,
  "security.autoApproveReadOps": true,
  "remote.timeout": 120,
  "security.clipboard.enabled": true,

  // Tool Approval Bypass
  "security.bypassMode": false,
  "security.bypassWhitelist": "[]",
  "security.bypassModeKind": "whitelist",

  // PDF Parser backend selection
  "pdfParser.backend": DEFAULT_PDF_PARSER_BACKEND,
  "pdfParser.backendFallback": true,

  // OpenDataLoader
  "pdfParser.opendataloader.enabled": true,
  "pdfParser.opendataloader.tableEnable": "default",
  "pdfParser.opendataloader.returnImages": false,
  "pdfParser.opendataloader.timeout": 300,
  "pdfParser.opendataloader.autoWatch": false,
  "pdfParser.opendataloader.useStructTree": false,

  // MinerU
  "pdfParser.mineru.mode": "cloud",
  "pdfParser.mineru.apiToken": "",
  "pdfParser.mineru.serverUrl": "http://127.0.0.1:8000",
  "pdfParser.mineru.model": "vlm",
  "pdfParser.mineru.language": "en",

  // Search
  "search.queryRewrite": true,
  "search.web.defaultProvider": DEFAULT_SEARCH_PROVIDER,

  // Context Budget
  "context.budget.maxItems": 5,
  "context.budget.abstractTokens": 500,
  "context.keepRecentRounds": 5,
  "context.idleCompactThresholdMin": 5,
  "context.idleAggressiveThresholdMin": 30,

  // Discovery
  "discovery.autoExtract": false,
  "discovery.blacklist": "{}",

  // Keyboard Shortcuts
  // 断裂审计 2026-09-12 INT-2：chat.newSession/search/clear/export/toggleSidebar/
  // focusInput/soul.switch 七个死键位的 pref 位一并撤下（键位自注册以来从未生效，
  // 见 docs/feature-chain-break-audit-2026-09-12.md §INT-2；旧用户 prefs 里的
  // 孤儿键无害，不清理迁移）。
  "shortcuts.chat.open": "",
  "shortcuts.chat.quickAsk": "",
  "shortcuts.command.openMode": "",
  "shortcuts.item.summarize": "",
  "shortcuts.item.findRelated": "",
  "shortcuts.item.findPdf": "",
  "shortcuts.item.semanticSearch": "",
  "shortcuts.item.importArticle": "",
  "shortcuts.item.suggestTags": "",
  "shortcuts.item.copyItemFiles": "",

  // Academic Brain
  "brain.enabled": false,
  // P1-2（2026-09-10）：普通对话被动注入学术脑上下文（chat 域开关）
  "chat.brainContext": false,
  "brain.tokenWarningAccepted": false,
  "brain.manualOnly": true,
  "brain.source.papers": true,
  "brain.source.annotations": true,
  "brain.source.notes": true,
  "brain.batchLimit": 5,
  "brain.confidenceThreshold": 0.5,
  "brain.abstractionLevel": "L2",
  "brain.extractL1": false,
  "brain.excludedTags": "",
  "brain.excludedCollections": "",
  "brain.inferRelations": false,
  // Internal one-shot flag: v9 migration relinked/dropped unbound L1 orphans
  "brain.l1OrphanCleanupDone": false,

  // Auto Actions (LLM-free)
  "autoActions.retractionCheck": false,
  "autoActions.annotationTagSync": false,
  "autoActions.duplicateCheck": false,
  "autoActions.citationResolve": true,
  "autoActions.delay": 3000,
  "autoActions.retractionTagName": "retracted",
  "apis.semanticScholar.apiKey": "",

  // Patent search API keys
  "apis.uspto.apiKey": "",
  "apis.epo.consumerKey": "",
  "apis.epo.consumerSecret": "",
  "apis.lens.token": "",
  "apis.pqai.token": "",
  "apis.jpo.apiKey": "",
  "apis.kipris.apiKey": "",

  // Backup
  "backup.lastStatus": "",
  "backup.autoOnSync": false,
  "backup.selectedGroups": "",

  // Embedding
  "embedding.mode": DEFAULT_EMBEDDING_MODE,
  "embedding.local.model": DEFAULT_EMBEDDING_LOCAL_MODEL,

  // Decision model (System 1 / JEV-class, OpenRouter Decisions API; opt-in)
  "decision.mode": DEFAULT_DECISION_MODE,
  "decision.model": DEFAULT_DECISION_MODEL,
  "decision.screen.include": DEFAULT_DECISION_SCREEN_INCLUDE,
  "decision.screen.exclude": DEFAULT_DECISION_SCREEN_EXCLUDE,
  "decision.endpoint": DEFAULT_DECISION_ENDPOINT,
  "decision.apiKey": DEFAULT_DECISION_API_KEY,

  // Item Metrics display
  "itemMetrics.showColumns": false,
  "itemMetrics.showCASColumns": false,
  "itemMetrics.showWarningColumn": false,

  // Additional API keys
  "apis.unpaywall.email": "",
  "apis.wiley.tdmToken": "",
  "apis.elsevier.apiKey": "",
  "apis.openalex.apiKey": "",
  "apis.core.apiKey": "",
  "apis.dimensions.apiKey": "",
  "apis.pubmed.apiKey": "",
  "apis.github.token": "",

  // Web search provider API keys
  "search.web.serpapi.apiKey": "",
  "search.web.brave.apiKey": "",
  "search.web.tavily.apiKey": "",
  "search.web.google.apiKey": "",
  "search.web.google.cx": "",
  "search.web.serper.apiKey": "",
  "search.web.perplexity.apiKey": "",
  "search.web.exa.apiKey": "",
  "search.web.bing.apiKey": "",
  "search.web.searxng.instanceUrl": "",

  // Other
  "brain.excludedConcepts": "",
  "discovery.whitelist": "{}",
  "search.qualityMemory": "{}",
  "search.qualityMemory.high": "{}",
  "chat.search.history": "[]",
  "chat.input.history": "[]",

  // P0-B PDF 下载扩展
  "pdfDownload.batchWorkers": 5,
  "pdfDownload.autoFetch": false,
  "pdfDownload.publisherRateLimitMs": 2000,
  "institutional.webvpn.school": "",
  "institutional.carsi.idp": "",
  "institutional.ezproxy.url": "",

  // Constraint mining (经验约束挖掘：管线预设与检索工具的总门 + 单次抓取上限)
  "constraints.mining.enabled": false,
  "constraints.maxPagesPerRun": 15,

  // Web search sources management (搜索源管理：已启用源清单)
  "search.web.addedSources": "[]",
};
