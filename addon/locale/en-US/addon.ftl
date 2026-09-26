## [Auto-merged] Common keys consolidated from module-specific duplicates.
## Source: tmp/merge-map.py. Do not re-split unless adding language that needs context-specific override.

btn-cancel = Cancel
btn-clear = Clear
btn-back = Back
aria-breadcrumb = Breadcrumbs
btn-close = Close
btn-retry = Retry
common-confirm = Confirm
common-cancel = Cancel
common-close = Close
toast-viewport-label = Notifications
common-doi = DOI
common-no-selection = Please select an item first
common-searching = Searching...
common-search = Search
common-results = Results
progress-saving = Saving...
error-boundary-message = Something went wrong
error-bridge-timeout = Request timed out: { $method } got no response. Please retry; if it keeps happening, check your network, index, or model configuration.
# Relative time
time-just-now = Just now
time-minutes-ago = { $count ->
    [one] 1 minute ago
    *[other] { $count } minutes ago
}
time-hours-ago = { $count ->
    [one] 1 hour ago
    *[other] { $count } hours ago
}
time-days-ago = { $count ->
    [one] 1 day ago
    *[other] { $count } days ago
}

# Chat Sidebar
recommend-add-success = Added to library: { $title }
recommend-add-failed = Failed to add: { $title }
# Chat Message List
# Chat Window - System Messages
# Chat Window - Toolbar & Status
# Thinking & Tool Calls
# Chat Input
# Item Picker
# Model Quick Switch
# Progress Bar
progress-status-processing = Processing...

# Export Dialog
# Agent & Progress
progress-duration-seconds = { $seconds }s
# Cron Presets
# Context Pane
# Item Tree
itemtree-items-count = { $count ->
    [one] item
    *[other] items
}
# ── Cron Messages Dialog ──
# RM-6: visible label for the header toggle (bare toggle + empty list read as a contradiction)
# CX-8: create/delete success toasts (previously silent)
# Empty state in two parts (Following slim + legacy cronDialog.xhtml share the keys); copy generalized to "tasks" 2026-09-14
# Clipboard (P0-1)
# Translation (P0-2)
# Translate panel
# Reader sections (native Zotero sidebar)
# Translation engine errors (src/core/translation/translationEngines.ts)
translation-error-google-empty = Google Translate returned an empty result
translation-error-bing-empty = Bing Translator returned an empty result
translation-error-deepl-empty = DeepL returned an empty result
translation-error-custom-empty = Custom API returned an empty result
translation-error-ai-empty = Translation returned an empty result
translation-error-google-failed = Google translation failed
translation-error-bing-failed = Bing translation failed
translation-error-deepl-failed = DeepL translation failed
translation-error-custom-failed = Custom API translation failed
translation-error-pdf-translate-failed = zotero-pdf-translate translation failed
translation-error-bing-not-configured = Bing translation has no API key configured
translation-error-deepl-not-configured = DeepL translation has no API key configured
translation-error-custom-url-missing = Custom translation API URL is not configured
translation-error-ai-not-configured = No AI provider configured for translation. Assign a model to the Translation feature in Leadero Settings → AI Models.
translation-error-google-fallback-failed = Google translation failed ({ $googleError }); the Bing fallback also failed ({ $bingError })
translation-error-unknown = Unknown error
translation-error-bing-token-unavailable = Could not obtain the Bing translation token (the page structure may have changed)
translation-error-bing-rejected = Bing rejected the request ({ $status })
translation-error-pdf-translate-missing = The zotero-pdf-translate plugin is not installed or not enabled. Install and enable it in Zotero's plugin manager.

# Reader Context Menu
# Selection context-menu action prefixes (argument-free; text is appended by the caller)
# Selection Action Bar (reader sidebar)
# Profile Memory System
# Deep Research
search-error-serper-quota = Serper credits/quota exhausted; switch the web search provider in settings (e.g. duckduckgo/bing-html free scrape)
}
# Collapsible
# Code Block
codeblock-show-all = Show all ({ $count })
# Mermaid Toolbar
# Agent Run
btn-open = Open
btn-show-more-results = Show { $count } more results
# Argument Display
arg-badge-items = { $count } items
arg-badge-more = +{ $count } more
arg-badge-fields = { $count } fields

# Token Usage
# Tool Labels
# Agent Status
status-tokens = { $count } tokens

# Header
# Sidebar
# Action Suggestions
# Drag & Drop
# In-Conversation Search
drop-item-count = { $count } items

# Markdown Renderer
markdown-loading = Loading

# Search Result Display
# Toolbar
# Sidebar
# Session output tracking — what the agent changed this session
# Background tasks (D5)
# Action Suggestions (prompt text)
# Reader Sidebar Quick Actions
# No-model banner (shown on HomePage when no chat model is configured)
# Semantic Search Panel
semantic-sort-label = Sort
semantic-sort-relevance = Relevance
semantic-sort-date = Date
semantic-sort-title = Title
semantic-tab-similar = Find Similar
semantic-tab-duplicates = Duplicate Detection
# JA-2（2026-09-17 Hub 评审批 3）：检索结果行内追踪动作（§30.2 文献条目出口）
semantic-track-action = Track
semantic-track-paper-tip = Track citation changes for this paper
semantic-track-topic-tip = No DOI — track new papers matching this title as a topic
# JA-3（2026-09-17 Hub 评审批 3）：库内结果行「打开」的成功回执（§31.1 页内点击 → Hub toast）
semantic-opened-in-zotero = Selected in Zotero
semantic-opened-focus-failed = Selected in Zotero — couldn't bring the Zotero window to the front
hub-search-anchor-scope-hint = Acts on the items currently selected in the Zotero main window
semantic-results-header-similar = Similar Items
semantic-results-header-duplicates = Duplicate Detection
csv-header-title = Title
csv-header-authors = Authors
csv-header-year = Year
csv-header-journal = Journal
csv-header-doi = DOI
csv-header-citations = Citations
csv-header-source = Source
csv-header-pdf-url = PDF URL
semantic-failed-items = Failed items:
semantic-skipped-details = Skipped details:
semantic-skip-no-pdf-attachment = No PDF attachment
semantic-skip-extraction-failed = Full-text extraction failed
semantic-skip-low-quality-text = Extracted text too low-quality
semantic-skip-empty-parse = Empty parse result
semantic-skip-already-indexed = Already up to date
semantic-watchdog-timeout = watchdog timeout
semantic-item-fallback = Item { $itemId }
semantic-scan-desc = Scanning will compare all items in your library for semantic similarity
semantic-scanning = Scanning: { $current }/{ $total } ({ $percent }%)
semantic-scan-failed = Scan failed: { $error }
semantic-scope-fulltext = Full Text
semantic-section-any = Any Section
semantic-section-method = Method
semantic-section-intro = Introduction
semantic-section-discussion = Discussion
semantic-section-conclusion = Conclusion
semantic-build-index = Build Full-Text Index
semantic-build-confirm = This will build a full-text index over all PDFs in your library and may take a while. Continue?
semantic-build-done = Done: { $processed } indexed, { $skipped } skipped, { $errors } failed
semantic-build-failed = Build failed: { $error }
semantic-building = Building… { $current } / { $total }
semantic-rebuild = Rebuild
semantic-rebuild-confirm-label = Rebuild
semantic-model-changed-warning = Embedding model changed — full-text index needs rebuild
semantic-duplicate-groups = Duplicate Groups ({ $count })
semantic-no-duplicates = No duplicates found!
# JA-4: find-similar completed but 0 hits (distinct from "no selection")
semantic-no-similar = No similar items found for the selected item.
semantic-duplicate-item = { $title } + { $count } duplicates
semantic-results-count = Results ({ $count })
semantic-onboarding-desc = Build the full-text index to enable library semantic search, similar items, and duplicate detection.

# Journal Search (Hub "Journal" tab)
journal-mode-metric = Lookup by Name / ISSN
journal-mode-discover = Discover by Field
journal-placeholder-metric = Enter journal name or ISSN...
journal-placeholder-discover = Enter research field keywords...
journal-source-local = Local
journal-source-openalex = OpenAlex
journal-no-data = No data found in local DB or OpenAlex
journal-empty-hint = Enter a journal name or ISSN to look up metrics
journal-empty-hint-discover = Enter research field keywords to discover journals
journal-not-found = Journal not found
journal-jcr-section = JCR Metrics
journal-cass-section = CAS Quartile
journal-risk-section = Risk Flags
journal-overview-section = Overview
journal-topics-label = Research Scope
journal-h-index-label = h-index
journal-i10-index-label = i10-index
journal-2yr-citedness-label = 2yr Mean Citability
journal-since-year = Since { $year }
journal-apc-label = APC ${ $amount }
journal-oa-label = Open Access
journal-doaj-label = DOAJ
journal-jif-label = JIF
journal-five-year-jif-label = 5-Year JIF
journal-jci-label = JCI
journal-quartile-label = JCR Quartile
journal-rank-label = Rank
journal-total-cites-label = Total Cites
journal-total-articles-label = Total Articles
journal-cass-quartile-label = CAS Quartile
journal-cass-category-label = Major Category
journal-is-top-label = Top Journal
journal-minor-categories-label = Minor Categories
journal-warning-label = Warning List
journal-predatory-label = Predatory
journal-predatory-data-year = Beall's list cutoff: Jan 2017
journal-works-count-label = Works
journal-h5-index-label = h5-index
journal-library-count-label = Papers
journal-results-count = { $count } journals
journal-sort-label = Sort
journal-sort-relevance = Relevance
journal-sort-jif = JIF
journal-sort-works = Works Count
journal-sort-h5 = h5-index
journal-sort-library = Paper Count
journal-search-failed = Journal search failed: { $error }

# Profile Window
profile-dim-research-domain = Research Domain
profile-dim-reading-style = Reading Style
profile-dim-interaction-style = Interaction Style
profile-dim-output-preference = Output Preference
profile-dim-tool-preference = Tool Preference
profile-dim-language-style = Language Style

# Quantified features panel (code-computed user model layer)
# Toolbar
# Tool Result Displays
# Missing keys (used in code but not in FTL)
# Session Batch Operations
# Chat Errors
copy-success = Copy Successful
copy-failed = Copy Failed
save-note-success = Note saved successfully
chat-error-generic = An unexpected error occurred. Please try again.
chat-error-auth = Invalid API key. Please check your API key in settings.
chat-error-forbidden = Access denied. Your API key does not have permission for this action.
chat-error-rate-limit = API rate limit reached. Please wait a moment and try again.
chat-error-server = AI server error. Please try again later.
chat-error-unavailable = AI service is temporarily unavailable. Please try again later.
chat-error-token-limit = Request too long. Try shortening your message or starting a new conversation.
chat-error-network = Network error. Please check your internet connection.
chat-error-cancelled = Request was cancelled.
chat-error-no-provider = No AI model is configured for this feature yet. Open Leadero Settings → AI Models and assign a model to it (Chat and Agent each need their own assignment).
chat-error-with-detail = Error: { $error }
# ── Queue panel (sends during execution are enqueued; ZCode lessons batch 2026-09-07) ──
chat-init-timeout = Chat failed to initialize within 30 seconds.

# Slash Menu Commands — keep in sync with src/react/components/Input/slashCommands.ts
# ── Soul / Agent Names ──
soul-name-default = Leadero Assistant
soul-name-reader-copilot = Reader Copilot
soul-name-synthesis-agent = Cross-Paper Analyst
soul-name-digest-agent = Annotation Synthesizer
soul-name-user-memory = User Memory
soul-name-peer-reviewer = Peer Reviewer
soul-name-writing-coach = Writing Coach
soul-name-devils-advocate = Devil's Advocate
soul-name-rebuttal-strategist = Rebuttal Strategist
soul-name-lab-senior = Lab Senior
soul-name-design-advisor = Design Advisor
soul-name-translation-bridge = Translation Bridge
soul-name-organization-master = Organization Master
soul-name-interrogator = Interrogator
soul-name-discussion-facilitator = Discussion Facilitator

# ── Grill / Alignment ──
# ── Research Dashboard UI ──
# R-6 (2026-09-15 deployed-build review): the required marker is rendered by
# NewResearchForm's <span class="leadero-form-required"> (styled red), so this
# value must not carry its own literal "*" — otherwise the label renders as
# "Research Question * *" (confirmed by zoomed screenshot).
# 统一 gap 入口（2026-09-21）：空白卡预览
research-warnings-title = { $count ->
    [one] 1 warning
    *[other] { $count } warnings
}

# ── Structured warning rendering (WarningsPanel parses machine templates) ──
research-warning-retracted = { $count ->
    [one] 1 citation to a retracted paper was stripped
    *[other] { $count } citations to retracted papers were stripped
}
research-warning-epistemic = { $count ->
    [one] 1 claim carries high uncertainty:
    *[other] { $count } claims carry high uncertainty:
}

# ── Toolbar Tooltips ──
# ── Brain Dashboard UI ──
brain-export = Export { $count ->
   [0]     (All)
  *[other] ({ $count })
}
}
usage-tokens-label = { $count ->
  [one] { $count } token
  *[other] { $count } tokens
}
usage-calls-label = { $count ->
  [one] call
  *[other] calls
}
paper-graph-citations = { $count ->
  [one] citation
  *[other] citations
}
# Window initialization failure (shown when iframe fails to init within 10s)
window-init-failed = { $name } failed to initialize.
window-init-failed-retry = Please try closing and reopening the window.

# Embedding Progress
embedding-progress-init = Preparing embeddings...
embedding-progress-done = Completed: { $count } items in { $elapsed }s
embedding-progress-eta = ETA { $eta }s

# Embedding fallback notifications
# Multi-agent tasks
tracker-state-n-unread = { $count ->
    [one] { $count } unread change
   *[other] { $count } unread changes
}

# Search
# Two tabs (2026-09-23): Web = external databases, Local = the library. The tab
# IS the scope; the old always-on fan-out merged list and includeLibrary switch
# retired with it.
hub-search-tab-label = Search scope
hub-search-tab-web = Web Search
hub-search-tab-local = Local Search
# Per-tab input placeholders
hub-search-placeholder-web = Enter a research question, keywords, or DOI… e.g. multi-agent literature review
hub-search-placeholder-local = Search your library by title, abstract, and full text…
# Per-tab initial empty-state copy
lit-initial-hint-web = Search external databases by keyword; results import straight into Zotero
lit-initial-hint-local = Search your library by keyword; hits open in the Zotero main window
lit-select-all = Select All
lit-clear-selection = Clear Selection
lit-import-selected = Import Selected ({ $count })
lit-imported-count = Imported { $count }
# Advanced filters
lit-year-range = Year Range
lit-filter-sources = Data Sources
lit-sort-relevance = Relevance
lit-sort-published = Recent
lit-sort-cited = Most Cited
lit-max-results = Max Results
lit-filter-author = Author
lit-filter-author-placeholder = Filter by author (optional)
lit-filter-journal = Journal
lit-filter-journal-placeholder = Filter by journal (optional)

# Literature filter dialog (Hub search page filter dialog: zones split by tab — Web = sources/query, Local = full-text scope)
hub-search-filter-trigger = Filters
hub-lit-filter-title = Search Filters
hub-lit-filter-title-local = Library Filters
hub-lit-filter-effect-hint = Applied on your next search
hub-lit-filter-active-count = { $count } active
hub-lit-filter-zone-sources = Sources & Engines
hub-lit-filter-sources-hint = Select none to search all external sources. CORE and Semantic Scholar need an API key (skipped while unset - fill them in Zotero Settings > Academic Search API Keys)
hub-lit-filter-zone-query = Query
hub-lit-filter-sort-ext = Sort (external retrieval order)
hub-lit-filter-zone-library = Library Full-text Scope
# Local tab empty-state delta hint (BM25 usable, vectors not built: search now, semantic ranking after)
hub-search-local-gap-hint = Keyword search works now (semantic ranking not yet enabled)
hub-lit-build-summary = Last index build result

# Sources
lit-source-openalex = OpenAlex
lit-source-semantic-scholar = Semantic Scholar
lit-source-crossref = CrossRef
lit-source-arxiv = arXiv
lit-source-biorxiv = bioRxiv
lit-source-medrxiv = medRxiv
lit-source-doaj = DOAJ
lit-source-zenodo = Zenodo
lit-source-hal = HAL
lit-source-core = CORE
lit-source-europe-pmc = Europe PMC
lit-source-pubmed = PubMed
lit-source-github = GitHub

# Result card
lit-citations = { $count } citations
lit-tag-pdf = PDF
lit-tag-oa = OA
lit-quartile-cass-1 = CAS Q1
lit-quartile-cass-2 = CAS Q2
lit-quartile-cass-3 = CAS Q3
lit-quartile-cass-4 = CAS Q4
lit-quartile-jcr-q1 = JCR Q1
lit-quartile-jcr-q2 = JCR Q2
lit-quartile-jcr-q3 = JCR Q3
lit-quartile-jcr-q4 = JCR Q4
lit-top = Top
lit-warning = Warning
lit-if-label = IF

# Import
lit-import-btn = Import
lit-importing = Importing...
lit-imported = Imported
lit-import-success = Imported: { $title }
lit-import-no-doi = This entry has no DOI and cannot be imported
# Batch import
lit-batch-import-confirm = Import { $count } selected articles into Zotero?
lit-batch-import-done = Batch import complete: { $count }/{ $total } succeeded
lit-batch-import-error = Batch import error: { $error }

# Abstract + translate
lit-abstract-label = Abstract
lit-translate-btn = Translate
lit-translating = Translating...
lit-translate-error = Translation failed
lit-translate-truncated = Abstract too long, translation truncated

# Full text (PMC open-access JATS XML first, OA web page fallback)
lit-fulltext-title = Full text
lit-fulltext-btn = Full text
lit-fulltext-fetching = Fetching...
lit-fulltext-collapse = Collapse
lit-fulltext-tip = Fetch full text (PMC open-access XML first, OA web page fallback)
lit-fulltext-no-id = No DOI/PMID — full text unavailable
lit-fulltext-empty = No full text available: this article may not be in an open-access repository
lit-fulltext-failed = Full text fetch failed
lit-fulltext-words = ~{ $count } words
lit-fulltext-truncated = Full text truncated for display
lit-fulltext-source-pmc = PMC full text
lit-fulltext-source-grobid = GROBID full text
lit-fulltext-source-html = Web full text
lit-all-sources-failed = All external sources failed — check your network connection

Requires real-time processing
Data size under 100MB
Accuracy over speed
# AnalysisReportView
# DiscussionView
# Progress
zsearch-hub-window =
    .title = z-search Hub
hub-tab-home = Home
# F-44: persistent stats-load failure inline row (visible beyond the toast)
# P1-1: inline degraded row when library stats fail (numbers render as em-dash, not 0)
# F-48: open-in-library failure toast
# CX-4: recent-activity feed load failure inline row (failure must not read as empty)
semantic-vector-gap-desc = Build the full-text index to enable semantic ranking, similar items, and duplicate detection.
hub-tab-search = Search
# { $count } -> total nodes; { $limit } -> recommended cap
hub-search-page-title = Search
hub-search-seg-literature = Literature
hub-search-seg-journal = Journal
hub-search-source-library = Library
hub-search-engine-external = External
hub-search-engine-idle = idle
hub-search-engine-bm25 = keyword only
# R4-04: hybrid retrieval with a missing vector leg — these hits are keyword-only
hub-search-engine-degraded = results not semantically ranked (no vector leg — BM25 keywords only)
hub-search-engine-searching = searching
hub-search-engine-progress = { $done }/{ $total } sources done · { $seconds }s
hub-search-engine-partial = { $count } sources failed; results may be incomplete
hub-search-engine-done = { $count } results
hub-search-engine-error = error
hub-search-empty-index = no index
hub-search-searching-title = Searching { $count } sources…
# Sources skipped for a missing key, and sources that failed, are named
# (2026-09-23): the loading title only reports how many legs were attempted
hub-search-sources-nokey = { $count } sources not enabled (no API Key): { $sources } — add keys in Zotero Settings · Academic Search API Keys
hub-search-sources-failed = { $count } sources returned no results: { $sources }
# claim 层极性（2026-09-06 审计 #11）：此前 fallback 英文 Title Case
# cross layer edge types
# relationship layer edge types
# G-7 edge interaction (2026-09-16): field labels for the relationship card.
# The hover tooltip body (source —type→ target) uses language-neutral arrows.
# Graph layout selector (decision batch 22, §15-56): four modes, gated with reasons
# TimeBar (decision batch 22, §15-59): year histogram + range brush + play
hub-graph-filter-year-from = From year
hub-graph-filter-year-to = To year
hub-graph-filter-year-5y = 5y
hub-graph-filter-year-10y = 10y
hub-graph-filter-year-all = All
hub-graph-filter-keyword = Keyword
hub-graph-filter-reset = Reset All
hub-graph-filter-count = { $shown } / { $total } nodes shown
error-hub-render = Failed to render Hub
# PaperGraph standalone window (PaperGraphWindow/DetailPanel/RelatedPanel)
# === Hub Settings (Phase 1) ===
# Section titles in SettingsPane. Field-level labels reuse pref-* keys from preferences.ftl.
hub-settings-bad-ascii = Value contains non-ASCII characters which will cause HTTP errors.
# === Hub Settings redesign (R1+) ===
hub-settings-saved = Saved
hub-settings-save-failed = Save failed

hub-settings-key-mask-placeholder = Add key…
hub-settings-key-empty = Not configured
hub-settings-key-show = Show
hub-settings-key-hide = Hide
hub-settings-key-copy = Copy
# === Hub Settings Part A bug fixes ===
# === Hub Settings Part B1: section titles ===
hub-settings-section-research = Research
hub-settings-section-item-columns = Item List Columns
# Sci-Hub grey-source gate (2026-09-07 adjudication: default off + explicit confirm)
hub-settings-tab-pdf-download = PDF Download
# === Hub Settings Part B2: section titles + missing keys ===
# ── Layer-4 automation: event hooks (2026-09-21) ──
# ── Add Tracker dialog (trackableTypes registry-driven, 2026-08-17) ──
hub-settings-section-tools = Tools
# === Hub Settings Part B3: shortcuts/security/backup ===
# === Hub Settings B4 ===
# === Verification chips (inline verifier markers, A2) ===
# === Verification panel (A3) ===
# === (Author, Year) citation click (A1) ===
# A2A (Agent2Agent)
# 方案四（2026-09-21）：QuickStartWizard 个性化播种屏
embedding-not-configured-error = Semantic index is not configured: assign a model under Settings → AI Models → Embedding (API mode), or switch to local mode.
decision-not-configured-error = Decision model is not enabled: turn it on under Settings → AI Models → Decision and make sure an OpenRouter API key is configured.
decision-unavailable-error = Decision service is temporarily unavailable — the call was skipped and the regular path was used.
chat-citation-nav-no-pdf = This item has no PDF attachment to open.
chat-citation-nav-not-found = Item not found (the library may not be synced to this device yet).
# ===== UX fixes round 3 (2026-08-14) =====
ux3-lit-refreshing = Searching — showing previous results
ux3-lit-no-results-desc = No results found. Adjust the keywords or filters and try again.
ux3-lit-copy-list = Copy List
ux3-lit-export-csv = Export CSV
ux3-lit-export-failed = Export failed
ux3-lit-load-more-remaining = Load more ({ $count } remaining)
ux3-journal-searching = Searching journal data…
ux3-journal-no-response = no response from the search service
ux3-misc-sr-close = Close
{$edits}
# Constraint mining (经验约束挖掘)
# Constraint library (constraint mining 批 2)
# Constraint interrogation (constraint mining 批 3)
# Search sources management (搜索源管理批)
hub-settings-section-search-sources = Search Sources
search-sources-desc = Enable web search sources, test reachability, and pick the default. Unreachable sources are skipped automatically at query time.
search-sources-default = Default
search-sources-empty = No sources enabled yet — add one to power web search.
prefs-keys-title = API Keys & Endpoints
prefs-keys-desc = API keys are saved to your local configuration as you type.
prefs-academic-keys-title = Academic Search API Keys
prefs-academic-keys-desc = Credentials for academic sources. CORE, Semantic Scholar and Dimensions are skipped at query time until their key is set; PubMed and GitHub keys only raise rate limits; the OpenAlex field takes a free API key (~100k/day) - the legacy mailto email is ignored. Hover an input to see where to get each key.
prefs-key-set = Set
prefs-key-missing = Not set
prefs-key-required = Required
prefs-key-optional = Optional
prefs-show-keys = Show keys
prefs-select-source = Select a search source in the list before testing.
prefs-status-enabled = Enabled
prefs-status-not-added = Not enabled
prefs-status-not-added-nokey = Not enabled · no key
prefs-default-set = Default source set to { $name }.
search-sources-test = Test
search-sources-test-ok = Reachable · { $count } result(s)
search-sources-test-auth = Key rejected — check the API key.
search-sources-test-missing-key = No API key set — fill it in below first.
journal-data-import-failed = Built-in journal datasets (JCR / CAS / warning lists / Beall's) failed to load — journal metrics and risk flags will be missing. Restart Zotero to retry the import.
search-sources-test-unreachable = Unreachable from this network.
search-sources-test-failed = Test failed: { $detail }
search-sources-not-configured = Key not set
soul-name-datasource-manager-soul = Data Source Manager
# ── 进程超时对话框 / OAuth 落地页 / 聊天与进度兜底文案（2026-09-17 清理批六）
embedding-failed-fallback = Embedding failed

# === Shortcut Manager：帮助弹窗 + Hub 设置页快捷键列表（2026-09-17 i18n 批）===
# 数据侧仍存 action id 与英文分类 id（注册/匹配/分组语义不变），本族键只供展示取词：
# 唯一取词点是 ShortcutManager.getAllShortcuts()（help 弹窗 + Hub 设置页 shortcuts.list）。
# *-name 对应 ShortcutConfig.nameKey，*-desc 对应 descKey，cat-* 对应 category 展示名。
# ── OpenDataLoader 翻译错误友好化文案（2026-09-17 批七 i18n）
# 砚法 §8.3 表格尾状态栏〔则〕：结果型列表尾部计数（2026-09-20 合规批，与 hub-search-results-count 头部计数同源）
hub-search-total-count = { $count } results

# Inkstone compliance batch (2026-09-20 S5.5/S10.1): accessible name for the
# canvas instruction send button (glyph arrow retired for a lucide send icon).
# 砚法合规修复批（2026-09-20 §4.6）：审批卡「查看上下文」入口
# Ink-law compliance batch 2026-09-20 (S9.1 no progress bars in stage wall / S11 report byline)
# ── Inkstone compliance batch (2026-09-20 §8.0/§15-61): sidebar density toggle + settings section search
# ── Graph canvas (inkstone legislation §8.11/§15-58~59, compliance fix batch 2026-09-20) ──
# 砚法合规修复批（2026-09-20 §9.2）：审批卡参数折叠钮（图标钮 aria 名）
# Inkstone compliance batch (2026-09-20 §15-39): review queue primary host = Evidence pane (full worklist subpage) - shared by banner and Brain count badge
# Short in-button labels for the always-visible four-segment layout selector
# (ruling 2026-09-20: MenuDropdown -> tglgrp; full names / gating reasons reuse
# the existing keys above)
# Inkstone compliance batch 2026-09-20 (user ruling "fill in all"): two new fields on the research start form (depth tiers presented honestly as estimates)
# Inkstone compliance batch 2026-09-20 (user ruling "full alignment"): sources & citations subpage (prototype #research-sub-sources)
# ── §8.0 pane header statute + IA §0 form badge (2026-09-20 user ruling: production rollout) ──
# Subtitles for the 13 top-level pane headers (§8.0: title + subtitle)
# ── Following two-block layout (IA §4.3 ruling 31, 2026-09-20 page batch): manage drawer + cron 4-mode form ──
# ── 砚法页批（§15-46 三段名实闭环 / §15-38 分析区卡化 / §15-40 摘要迁概念面 /
#    §15-37 定式3 透视三栏 + 决策双栏向导，2026-09-20）──
# ── Inkstone research structure batch (A1/A2/A5/A9/A13, 2026-09-20): form-2
#    skeleton / progress compressed view / subpages (launch-5, progress-3,
#    checkpoints-3) / deep links ──
# B1.5 finalization (2026-09-20, prototype :7028-7090): concept detail taxonomy rows
# B1.5 定稿（2026-09-20 §15-47③ 三面板）：论文画像详情弹窗面板三——篇级不确定性聚合
# Workspace session sidebar (IA §4.4 v2.19 §15-91 feature batch, 2026-09-20): searchable session list
# Memory management card (§15-75 / IA v2.18 §4.7: memory managed in settings
# Agent section, 2026-09-20): list + delete + stats, no create/edit forms
# Workspace Dashboard promotion batch 1 (IA §0 sidebar-content admission law + §4.4; prototype ws-sub-dash entry rail :7902-7977 / sub page :7979-8090)
# 准入法升格批②（IA §0 形式⑥；原型 canvas-sub-material）：画布素材库次级页
# ── Inkstone compliance batch · chat window (2026-09-20 round 2-1: §8.5/§9.2/§10.5) ──
# ── Inkstone round 2 reader panels (law §9.4 failure != empty: honest capability/empty disclosure) ──
# 为你发现卡（推荐引擎功能批 v1：三腿聚合真数据）
# 研究空白次级页（功能批②：三视图聚合真数据，§15-48/49）
# 研究空白十六裁收口（§15-98~100：行动钮排/双维度/三态互链）
# 十六裁批C（§15-106~108：页头主钮/事件行去处）
# 十六裁批D（§15-110：素材形态轴）
# 复审批E（Q1 元信息行）
# 方案四（2026-09-21 共同成长闭环）：消息级反馈
# 复审批F（Q14 cron 试运行文案本地化）
# z-search 菜单
tools-open-search = Open Search Center
menuitem-find-similar = Find Similar Items

# ---- PDF 解析路径（MinerU / Java / OpenDataLoader）用户可见文案 ----
pdf-mineru-token-missing = MinerU API token isn't set. Add it in Settings > PDF Parsing Engine.
pdf-mineru-requesting-url = Requesting an upload URL from MinerU Cloud…
pdf-mineru-no-upload-url = MinerU Cloud returned no upload URL: { $detail }
pdf-cancelled = Cancelled
pdf-mineru-uploading = Uploading the PDF to MinerU Cloud…
pdf-mineru-upload-failed = MinerU file upload failed (HTTP { $status })
pdf-mineru-parsing = MinerU is parsing, please wait…
pdf-mineru-downloading = Downloading the parse result…
pdf-mineru-no-download-url = MinerU Cloud returned no result download URL
pdf-mineru-parsing-elapsed = MinerU is parsing ({ $elapsed }s)
pdf-mineru-parse-failed = MinerU parse failed: { $detail }
pdf-mineru-timeout = MinerU parse timed out ({ $minutes } min)
pdf-mineru-checking-local = Checking the local MinerU service…
pdf-mineru-local-unavailable = Local MinerU service unavailable ({ $base }): { $detail }
pdf-java-unzip-failed = Unzip failed: { $detail }
pdf-java-downloading = Downloading Java { $version } JRE ({ $archive })…
pdf-java-downloading-percent = Downloading { $percent }%
pdf-java-download-failed = Download failed: { $detail }
pdf-java-not-found-after-unzip = No java executable found after unzipping (in { $dir }). Install one manually from { $url }.
pdf-java-unrunnable = The downloaded Java won't run: { $detail }
pdf-java-too-old = Detected Java { $version }, but OpenDataLoader needs Java 11+. Install a newer version from { $url }.
pdf-mineru-connect-failed = connection failed
pdf-java-extracting = Extracting…
pdf-java-verifying = Verifying the install…
pdf-java-done = Java install complete
pdf-jar-load-failed = Failed to load the JAR file ({ $path }): { $detail }
pdf-mineru-uploading-local = Uploading the PDF to the local MinerU…
pdf-mineru-parsing-local = The local MinerU is parsing…
pdf-mineru-token-not-set = API token not set
pdf-mineru-no-layout-json = No layout.json in the ZIP
pdf-mineru-empty-response = MinerU returned an empty response
pdf-mineru-local-parse-failed = Local MinerU parse failed (HTTP { $status }): { $detail }
pdf-mineru-auth-failed = Authentication failed: { $detail }
pdf-mineru-download-failed = Failed to download the parse result (HTTP { $status })
pdf-mineru-quota-exhausted = MinerU's daily parse quota is used up ({ $detail }). Try again tomorrow.
pdf-mineru-auth-rejected = MinerU authentication failed ({ $detail }) - check the API token.
pdf-mineru-api-error = MinerU API error: { $detail } (code { $code })
pdf-translate-batch-start = Translating in batch ({ $paragraphs } paragraphs in { $chunks } chunks)…
pdf-translate-batch-progress = Batch translation: { $done }/{ $total } chunks

# ── Toolbar button & shortcut (main window entry, P0-4) ──
toolbar-open-search-tooltip = Open Search Center (Ctrl+Shift+K)

# ── In-library badge & OA filter (P0-3) ──
lit-in-library = In Library
lit-in-library-tip = This DOI already exists in your Zotero library
lit-filter-open-access = Open Access
lit-filter-open-access-hint = Show only open-access results

# ── Citation traversal (P0-2) ──
lit-cited-by-title = Cited by — { $title }
lit-references-title = References — { $title }
lit-references-btn = References
lit-cited-by-tip = Show papers citing this work (OpenAlex)
lit-citations-loading = Fetching citations…
lit-citations-count = { $count } shown of { $total }
lit-citations-empty = No citation data found
