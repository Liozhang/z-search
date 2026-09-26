// z-search — search-only preference defaults.
// Trimmed from leadero: keeps only keys read by the copied search modules
// (core/search, core/sources, core/ai, core/embedding, core/decision, core/pdf).

// Unified model/provider config (JSON, managed by ConfigManager)
pref("ai.providers", "{}");
pref("ai.models", "{}");

// Feature-based provider selection (empty = not configured, user must choose)
pref("ai.selection.chat", "");
pref("ai.selection.agent", "");
pref("ai.selection.vision", "");
pref("ai.selection.translation", "");
pref("ai.selection.embedding", "");

// Common settings
pref("ai.temperature", 0.7);
pref("ai.toolConcurrency", 3);
pref("ai.maxIterations", 100);
pref("ai.multiStepPilot", false);
pref("ai.model.maxContext", 128000);

// ── Search ──────────────────────────────────────────────────────────
pref("search.queryRewrite", true);
pref("search.rerankEnabled", false);
pref("search.rerankModel", "cohere/rerank-v3.5");
pref("search.qualityMemory", "{}");
pref("search.qualityMemory.high", "{}");

// 主窗入口：工具栏按钮显隐（快捷键 Ctrl/Cmd+Shift+K 不受此控，始终可用）
pref("search.toolbarButton", true);
// 导入时自动尝试下载开放获取 PDF 挂为附件（失败静默降级为纯元数据）
pref("search.importAttachPdf", true);

// Web search providers
pref("search.web.defaultProvider", "duckduckgo");
pref("search.web.addedSources", "[]");
pref("search.web.serpapi.apiKey", "");
pref("search.web.brave.apiKey", "");
pref("search.web.tavily.apiKey", "");
pref("search.web.google.apiKey", "");
pref("search.web.google.cx", "");
pref("search.web.serper.apiKey", "");
pref("search.web.perplexity.apiKey", "");
pref("search.web.exa.apiKey", "");
pref("search.web.bing.apiKey", "");
pref("search.web.searxng.instanceUrl", "");

// Academic / metadata API keys
pref("apis.semanticScholar.apiKey", "");
pref("apis.openalex.apiKey", "");
pref("apis.core.apiKey", "");
pref("apis.dimensions.apiKey", "");
pref("apis.pubmed.apiKey", "");
pref("apis.unpaywall.email", "");
pref("apis.wiley.tdmToken", "");
pref("apis.elsevier.apiKey", "");
pref("apis.github.token", "");

// Patent search API keys (kept: sources/academic-search utils reads them)
pref("apis.uspto.apiKey", "");
pref("apis.epo.consumerKey", "");
pref("apis.epo.consumerSecret", "");
pref("apis.lens.token", "");
pref("apis.pqai.token", "");
pref("apis.jpo.apiKey", "");
pref("apis.kipris.apiKey", "");

// ── Embedding (local ONNX by default — zero-config; API is opt-in) ──
pref("embedding.mode", "local");
pref("embedding.local.model", "Xenova/multilingual-e5-small");

// ── PDF parsing (PdfTextProvider — full-text indexing for vector search) ──
pref("pdfParser.backend", "opendataloader"); // "opendataloader" | "mineru"
pref("pdfParser.backendFallback", true); // auto-switch on infra errors
pref("pdfParser.opendataloader.enabled", true);
pref("pdfParser.opendataloader.tableEnable", "default");
pref("pdfParser.opendataloader.returnImages", false);
pref("pdfParser.opendataloader.timeout", 300);
pref("pdfParser.opendataloader.autoWatch", false);
pref("pdfParser.opendataloader.useStructTree", false);
pref("pdfParser.mineru.mode", "cloud"); // "cloud" | "local"
pref("pdfParser.mineru.apiToken", ""); // cloud: sk-... Bearer token
pref("pdfParser.mineru.serverUrl", "http://127.0.0.1:8000"); // local: self-hosted endpoint
pref("pdfParser.mineru.model", "vlm"); // "vlm" | "pipeline"
pref("pdfParser.mineru.language", "en"); // OCR / document language

// ── Decision model (System 1 / JEV-class; opt-in — search triage) ──
pref("decision.mode", "off");
pref("decision.model", "typesafe/jev-1.13");
pref("decision.screen.include", 0.8);
pref("decision.screen.exclude", 0.2);
pref("decision.endpoint", "");
pref("decision.apiKey", "");

// ── Translation (文献摘要翻译；默认 Google 免费端点) ─────────────────
pref("translate.enabled", false);
pref("translate.auto", false);
pref("translate.maxChars", 10000);
pref("translate.engineType", "google");
pref("translate.google.apiKey", "");
pref("translate.bing.apiKey", "");
pref("translate.bing.region", "");
pref("translate.deepl.apiKey", "");
pref("translate.deepl.useFree", false);
pref("translate.custom.apiUrl", "");
pref("translate.custom.apiKey", "");
pref("translate.custom.model", "");

// ── Discovery 过滤器（黑/白名单，JSON）────────────────────────────
pref("discovery.blacklist", "{}");
pref("discovery.whitelist", "{}");

// ── PDF 全文索引版本戳（PdfChunkIndexer 写） ─────────────────────
pref("pdfIndexer.lastFullTextVersion", 0);
