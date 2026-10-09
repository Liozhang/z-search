// z-search — search-only preference defaults.
// Trimmed from the upstream project: keeps only keys read by the copied search modules
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

// ── 网络区域（插件的全球性开关；auto = 不声明，沿用国际优先的出厂默认）──
pref("region", "auto"); // "auto" | "global" | "cn"
// 中科院分区显隐（中国科研评价体系数据，离线内置）：auto = 跟随网络区域
// （cn 显示 / global 隐藏 / 未声明沿用历史行为——默认展示），show/hide 为
// 用户显式覆盖（全球用户同样可能在研究中国期刊，绝不硬性剥夺）
pref("region.cassPartition", "auto"); // "auto" | "show" | "hide"

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
// 导入目标（JSON：{libraryID, collectionID|null}；空/缺失 = 跟随主窗选择）
pref("search.importTarget", "");

// Web search providers
pref("search.web.defaultProvider", "duckduckgo");
// 维基百科域名（空 = 跟随 Zotero 界面语言；跨境用户可填镜像或其它语言站）
pref("search.web.wikipedia.host", "");
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
// easyScholar 免费 key（可选；中文核心期刊标识数据源）
pref("apis.easyscholar.apiKey", "");
// easyScholar 端点覆盖（空 = 内置 https://www.easyscholar.cc/...；
// 国内可达性变化/自建代理时由用户指定）
pref("apis.easyscholar.serverUrl", "");

// Patent search API keys (kept: sources/academic-search utils reads them)
pref("apis.uspto.apiKey", "");
pref("apis.epo.consumerKey", "");
pref("apis.epo.consumerSecret", "");
pref("apis.lens.token", "");
pref("apis.pqai.token", "");
pref("apis.jpo.apiKey", "");
pref("apis.kipris.apiKey", "");

// ── Embedding (local ONNX by default — model auto-downloads on first use) ──
pref("embedding.mode", "local");
pref("embedding.local.model", "Xenova/multilingual-e5-small");
// 模型下载镜像覆盖（空 = 自动：中国大陆 hf-mirror.com，其余 huggingface.co）。
// 区域限定端点之一（endpointSchema.ts），设置面板「区域限定端点」组可改。
pref("embedding.local.mirror", "");

// ── PDF parsing (PdfTextProvider — full-text indexing for vector search) ──
pref("pdfParser.backend", "opendataloader"); // "opendataloader" | "mineru"
pref("pdfParser.backendFallback", true); // auto-switch on infra errors
pref("pdfParser.opendataloader.enabled", true);
// jar 在场而机器无 Java 时自动下载 Temurin 便携 JRE（约 40-50MB，数据目录
// 解压，免管理员权限）。没有 jar 就从不触发——不会为未启用的后端花流量。
pref("pdfParser.opendataloader.autoJre", true);
pref("pdfParser.opendataloader.tableEnable", "default");
pref("pdfParser.opendataloader.returnImages", false);
pref("pdfParser.opendataloader.timeout", 300);
pref("pdfParser.opendataloader.jreMirror", ""); // JRE 下载镜像（空 = 官方 api.adoptium.net）
pref("pdfParser.opendataloader.autoWatch", false);
pref("pdfParser.opendataloader.useStructTree", false);
pref("pdfParser.mineru.mode", "cloud"); // "cloud" | "local"
pref("pdfParser.mineru.apiToken", ""); // cloud: sk-... Bearer token
pref("pdfParser.mineru.cloudUrl", ""); // cloud: 端点覆盖（空 = 内置 mineru.net）
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
// 持久翻译缓存（translationCache.ts）：启动按 maxSizeMB 修剪，enabled=false 整体停用。
pref("translate.cache.enabled", true);
pref("translate.cache.maxSizeMB", 200);

// ── Discovery 过滤器（黑/白名单，JSON）────────────────────────────
pref("discovery.blacklist", "{}");
pref("discovery.whitelist", "{}");

// ── PDF 全文索引版本戳（PdfChunkIndexer 写） ─────────────────────
pref("pdfIndexer.lastFullTextVersion", 0);
