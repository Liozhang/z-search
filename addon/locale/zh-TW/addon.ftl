## [Auto-merged] Common keys consolidated from module-specific duplicates.
## Source: tmp/merge-map.py. Do not re-split unless adding language that needs context-specific override.

btn-cancel = 取消
btn-clear = 清除
btn-back = 返回
aria-breadcrumb = 麵包屑導覽
btn-close = 關閉
btn-retry = 重試
common-confirm = 確認
common-cancel = 取消
common-close = 關閉
toast-viewport-label = 通知
common-doi = DOI
common-no-selection = 請先選擇一個條目
common-searching = 搜尋中...
common-search = 搜尋
common-results = 結果
progress-saving = 儲存中...
# ============================================================
# Auto-generated i18n entries for tools and prompts
# DO NOT EDIT manually - use consistent naming: tool-{id}-{field}
# ============================================================

error-boundary-message = 發生錯誤
error-bridge-timeout = 請求逾時：{ $method } 無回應，請重試；若反覆出現，請檢查網路、索引或模型設定。
# Chat init timeout
chat-init-timeout = 聊天未能在 30 秒內完成初始化。

# Relative time
time-just-now = 剛剛
time-minutes-ago = { $count } 分鐘前
time-hours-ago = { $count } 小時前
time-days-ago = { $count } 天前

# Chat Sidebar
recommend-add-success = 已加入文獻庫：{ $title }
recommend-add-failed = 加入失敗：{ $title }
# Chat Message List
# Chat Window - System Messages
# Chat Window - Toolbar & Status
# 思考過程與工具呼叫
# Chat Input
# Item Picker
# Model Quick Switch
# Progress Bar
progress-status-processing = 正在處理...

# Export Dialog
# Agent & Progress
progress-duration-seconds = { $seconds }秒
# Cron Presets
# Context Pane
# Item Tree
itemtree-items-count = 個條目
# Tools
# ── Cron 定時訊息 對話方塊 ──
# RM-6：節頭開關可見標籤（原裸 Toggle 無可見詞，ON+空列表語義矛盾）
# CX-8：建立/刪除成功 toast（此前靜默）
# 空態兩段制（Following slim 空態 + 舊 cronDialog.xhtml 同鍵共用）；2026-09-14 口徑改任務通用
# Menu
# Clipboard (P0-1)
# Translation (P0-2)
# Translate panel
# Reader sections (native Zotero sidebar)
# Translation engine errors (src/core/translation/translationEngines.ts)
translation-error-google-empty = Google 翻譯傳回空結果
translation-error-bing-empty = Bing 翻譯傳回空結果
translation-error-deepl-empty = DeepL 翻譯傳回空結果
translation-error-custom-empty = 自訂 API 傳回空結果
translation-error-ai-empty = 翻譯傳回空結果
translation-error-google-failed = Google 翻譯失敗
translation-error-bing-failed = Bing 翻譯失敗
translation-error-deepl-failed = DeepL 翻譯失敗
translation-error-custom-failed = 自訂 API 翻譯失敗
translation-error-pdf-translate-failed = zotero-pdf-translate 翻譯失敗
translation-error-bing-not-configured = Bing 翻譯未配置 API Key
translation-error-deepl-not-configured = DeepL 翻譯未配置 API Key
translation-error-custom-url-missing = 自訂翻譯 API 網址未配置
translation-error-ai-not-configured = 翻譯未配置（請在 Leadero 設定中為 AI 模型設定翻譯功能）
translation-error-google-fallback-failed = Google 翻譯失敗（{ $googleError }），Bing 備援亦失敗（{ $bingError }）
translation-error-unknown = 未知錯誤
translation-error-bing-token-unavailable = 無法取得 Bing 翻譯權杖（頁面結構可能已變更）
translation-error-bing-rejected = Bing 拒絕請求（{ $status }）
translation-error-pdf-translate-missing = zotero-pdf-translate 外掛未安裝或未啟用，請在 Zotero 外掛管理員中安裝並啟用它

# 資料源檔案工具（datasource-mgmt agent）
# ============================================================
# Prompts (22 builtin) - Auto-generated i18n entries
# ============================================================
# Research mode
search-error-serper-quota = Serper credits/quota 耗盡，請在設定中切換 web search provider（如 duckduckgo/bing-html 免費 scrape）

# ── Page Monitor (Tracking) ──
# C-3（第四輪審計）：舊 discovery 棧 → 統一追蹤棧的存量遷移入口
# Discovery Mining Mode + Follow Frequency
usage-tokens-label = { $count } 個 token
usage-calls-label = { $count } 次呼叫
paper-graph-citations = { $count } 次引用

# Usage Dashboard — Table Headers
# Usage Dashboard — Day Labels
# Usage Dashboard — Month Labels
# Collapsible
# Code Block
codeblock-show-all = 顯示全部 ({ $count })
# Mermaid Toolbar
# Agent Run
btn-open = 開啟
btn-show-more-results = 顯示更多 { $count } 筆結果
# Argument Display
arg-badge-items = { $count } 項
arg-badge-more = +{ $count } 更多
arg-badge-fields = { $count } 個欄位

# Token Usage
# Tool Labels
# Agent Status
status-tokens = { $count } tokens

# Header
# Sidebar
# Action Suggestions
# Drag & Drop
drop-item-count = { $count } 項

# Markdown Renderer
markdown-loading = 載入中

# Search Result Display
# Toolbar
# Sidebar
# 會話產出追蹤 — agent 本輪對話改了什麼
# 背景任務 (D5)
# Action Suggestions (prompt text)
# Reader Sidebar Quick Actions
# No-model banner (shown on HomePage when no chat model is configured)
# Semantic Search Panel
semantic-sort-label = 排序
semantic-sort-relevance = 相關性
semantic-sort-date = 日期
semantic-sort-title = 標題
semantic-tab-similar = 尋找相似
semantic-tab-duplicates = 重複偵測
# JA-2（2026-09-17 Hub 評審批 3）：檢索結果行內追蹤動作（§30.2 文獻條目出口）
semantic-track-action = 追蹤
semantic-track-paper-tip = 追蹤此論文的引用動態
semantic-track-topic-tip = 無 DOI——以此標題為檢索式追蹤相關新論文
# JA-3（2026-09-17 Hub 評審批 3）：庫內結果行「開啟」的成功回執（§31.1 頁內點擊 → Hub toast）
semantic-opened-in-zotero = 已在 Zotero 中選取該條目
semantic-opened-focus-failed = 已在 Zotero 中選取該條目——無法切換至 Zotero 視窗
hub-search-anchor-scope-hint = 作用於 Zotero 主視窗目前選中的條目
semantic-results-header-similar = 相似項目
semantic-results-header-duplicates = 重複偵測
csv-header-title = 標題
csv-header-authors = 作者
csv-header-year = 年份
csv-header-journal = 期刊
csv-header-doi = DOI
csv-header-citations = 被引
csv-header-source = 來源
csv-header-pdf-url = PDF 連結
semantic-failed-items = 失敗條目：
semantic-skipped-details = 跳過明細：
semantic-skip-no-pdf-attachment = 無 PDF 附件
semantic-skip-extraction-failed = 全文抽取失敗
semantic-skip-low-quality-text = 抽取文字品質過低
semantic-skip-empty-parse = 解析結果為空
semantic-skip-already-indexed = 已是最新索引
semantic-watchdog-timeout = 看門狗逾時
semantic-item-fallback = 條目 { $itemId }
semantic-scan-desc = 掃描將比較文庫中所有項目的語義相似度
semantic-scanning = 掃描中：{ $current }/{ $total } ({ $percent }%)
semantic-scan-failed = 掃描失敗：{ $error }
semantic-scope-fulltext = 全文
semantic-section-any = 全部章節
semantic-section-method = 方法
semantic-section-intro = 引言
semantic-section-discussion = 討論
semantic-section-conclusion = 結論
semantic-build-index = 建立全文索引
semantic-build-confirm = 將對全庫 PDF 建立全文索引，可能需要較長時間。繼續？
semantic-build-done = 完成：成功 { $processed } 篇，跳過 { $skipped } 篇，失敗 { $errors } 篇
semantic-build-failed = 建立失敗：{ $error }
semantic-building = 建立中… { $current } / { $total }
semantic-rebuild = 重建
semantic-rebuild-confirm-label = 確認重建
semantic-model-changed-warning = embedding 模型已變更，全文索引需重建
semantic-duplicate-groups = 重複組 ({ $count })
semantic-no-duplicates = 未發現重複項！
# JA-4：找相似已完成但 0 相似（區別於「未選中條目」）
semantic-no-similar = 沒有找到與所選條目相似的文獻。
semantic-duplicate-item = { $title } + { $count } 個重複項
semantic-results-count = 結果 ({ $count })
semantic-onboarding-desc = 建立全文索引後，可啟用庫內語意搜尋、相似文獻與重複偵測。

# 期刊搜尋（Hub「期刊」分頁）
journal-mode-metric = 按刊名/ISSN 查指標
journal-mode-discover = 按領域發現
journal-placeholder-metric = 輸入刊名或 ISSN...
journal-placeholder-discover = 輸入研究領域關鍵詞...
journal-source-local = 本地
journal-source-openalex = OpenAlex
journal-no-data = 本地與 OpenAlex 均無資料
journal-empty-hint = 輸入刊名或 ISSN 查詢期刊指標
journal-empty-hint-discover = 輸入研究領域關鍵詞探索期刊
journal-predatory-data-year = Beall's list cutoff: Jan 2017
journal-not-found = 未找到該期刊
journal-jcr-section = JCR 指標
journal-cass-section = 中科院分區
journal-risk-section = 風險標記
journal-overview-section = 期刊概況
journal-topics-label = 收稿領域
journal-h-index-label = h 指數
journal-i10-index-label = i10 指數
journal-2yr-citedness-label = 2 年篇均被引
journal-since-year = 創刊於 { $year }
journal-apc-label = 版面費 ${ $amount }
journal-oa-label = 開放獲取
journal-doaj-label = DOAJ 收錄
journal-jif-label = 影響因子
journal-five-year-jif-label = 5 年 IF
journal-jci-label = JCI
journal-quartile-label = JCR 分區
journal-rank-label = 排名
journal-total-cites-label = 總引用
journal-total-articles-label = 總發文
journal-cass-quartile-label = 中科院分區
journal-cass-category-label = 大類
journal-is-top-label = 頂刊
journal-minor-categories-label = 小類
journal-warning-label = 國際預警
journal-predatory-label = 掠奪性
journal-works-count-label = 發文量
journal-h5-index-label = h5 指數
journal-library-count-label = 庫內篇數
journal-results-count = { $count } 本期刊
journal-sort-label = 排序
journal-sort-relevance = 相關性
journal-sort-jif = 影響因子
journal-sort-works = 發文量
journal-sort-h5 = h5 指數
journal-sort-library = 篇數
journal-search-failed = 期刊搜尋失敗：{ $error }

# Multi-agent tasks
# Profile Window
profile-dim-research-domain = 研究領域
profile-dim-reading-style = 閱讀方式
profile-dim-interaction-style = 互動偏好
profile-dim-output-preference = 輸出偏好
profile-dim-tool-preference = 工具偏好
profile-dim-language-style = 語言風格

# 量化特徵面板（使用者模型的純程式碼計算層）
# Tool Result Displays
# Missing keys (used in code but not in FTL)
# 會話批量操作
# Chat Errors
copy-success = 已複製到剪貼簿
copy-failed = 複製失敗
save-note-success = 筆記已儲存
chat-error-generic = 發生意外錯誤，請重試。
chat-error-auth = API 金鑰無效，請在設定中檢查您的金鑰。
chat-error-forbidden = 存取被拒絕，您的 API 金鑰沒有執行此操作的權限。
chat-error-rate-limit = API 請求頻率已達上限，請稍後重試。
chat-error-server = AI 伺服器錯誤，請稍後重試。
chat-error-unavailable = AI 服務暫時無法使用，請稍後重試。
chat-error-token-limit = 請求過長，請嘗試縮短訊息或開始新對話。
chat-error-network = 網路錯誤，請檢查網路連線。
chat-error-cancelled = 請求已取消。
chat-error-no-provider = 尚未為該功能設定 AI 模型。請開啟 Leadero 設定 → AI 模型，為對應功能指派模型（聊天與智慧代理需分別指派）。
chat-error-with-detail = 錯誤：{ $error }

# Toolbar
# Profile Memory System
# Tool keys
# Slash Menu Commands — keep in sync with src/react/components/Input/slashCommands.ts
# ── Soul / Agent 名稱 ──
soul-name-default = Leadero 助手
soul-name-reader-copilot = 閱讀副駕駛
soul-name-synthesis-agent = 跨論文分析師
soul-name-digest-agent = 批註合成器
soul-name-user-memory = 使用者記憶
soul-name-peer-reviewer = 同行評審員
soul-name-writing-coach = 寫作教練
soul-name-devils-advocate = 魔鬼代言人
soul-name-rebuttal-strategist = 答辯策略師
soul-name-lab-senior = 資深實驗導師
soul-name-design-advisor = 研究設計顧問
soul-name-translation-bridge = 翻譯橋樑
soul-name-organization-master = 文獻管理大師
soul-name-interrogator = 審問者
soul-name-discussion-facilitator = 討論主持人

# ── Grill / Alignment ──
# ── Research Dashboard UI ──
# R-6（2026-09-15 部署包評審）：必填星號由 NewResearchForm 的
# <span class="leadero-form-required"> 渲染（紅色、有樣式），本值內不再自帶
# 字面量星號——否則真機渲染成「研究問題 * *」兩個星號。
# 統一 gap 入口（2026-09-21）：空白卡預覽
research-warnings-title = { $count } 個警告

# ── 結構化警告渲染（WarningsPanel 解析機器模板後映射的文案） ──
research-warning-retracted = 已移除 { $count } 處對撤稿論文的引用
research-warning-epistemic = { $count } 條論斷的不確定性偏高：

# ── Toolbar Tooltips ──
# ── Brain Dashboard UI ──
brain-export = 匯出 { $count ->
   [0]     (全部)
  *[other] ({ $count })
}

# Search
# 雙 tab（2026-09-23）：網路=外部資料庫，本地=文庫。tab 即範圍，
# 原來全域並聯混清單與 includeLibrary 開關隨之退役。
hub-search-tab-label = 搜尋範圍
hub-search-tab-web = 網路搜尋
hub-search-tab-local = 本地搜尋
# 兩個 tab 各自的輸入框佔位符
hub-search-placeholder-web = 輸入研究問題、關鍵詞或 DOI… 例：multi-agent literature review
hub-search-placeholder-local = 輸入關鍵詞，檢索文庫標題、摘要與全文…
# 兩個 tab 各自的初始空態文案
lit-initial-hint-web = 輸入關鍵詞，檢索外部資料庫；結果可直接匯入 Zotero
lit-initial-hint-local = 輸入關鍵詞，檢索你的文庫；命中可在 Zotero 主視窗打開
lit-select-all = 全選
lit-clear-selection = 清除選擇
lit-import-selected = 匯入選中 ({ $count })
lit-imported-count = 已匯入 { $count } 篇
# Advanced filters
lit-year-range = 年份範圍
lit-filter-sources = 資料來源
lit-sort-relevance = 相關度
lit-sort-published = 最新發表
lit-sort-cited = 引用最多
lit-max-results = 結果數
lit-filter-author = 作者
lit-filter-author-placeholder = 按作者篩選（可選）
lit-filter-journal = 期刊
lit-filter-journal-placeholder = 按期刊篩選（可選）

# Literature filter dialog（Hub 搜索页筛选弹窗：按 tab 分流分区——網路=來源/查詢，本地=全文範圍）
hub-search-filter-trigger = 篩選
hub-lit-filter-title = 文獻篩選
hub-lit-filter-title-local = 文庫篩選
hub-lit-filter-effect-hint = 條件在下次搜尋時生效
hub-lit-filter-active-count = 已啟用 { $count } 項篩選
hub-lit-filter-zone-sources = 來源與引擎
hub-lit-filter-sources-hint = 全不選 = 檢索全部外部源；CORE、Semantic Scholar 需 API Key（未填時自動跳過，設定位置：Zotero 設定·學術檢索 API Keys）
hub-lit-filter-zone-query = 查詢條件
hub-lit-filter-sort-ext = 排序（外部源取回序）
hub-lit-filter-zone-library = 庫內全文範圍
# 本地 tab 空態的差額提示（BM25 可用但向量未建：先搜著，語義能力待構建）
hub-search-local-gap-hint = 目前可先用關鍵字檢索（語義排序未啟用）
hub-lit-build-summary = 上次構建結果

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
lit-citations = 引用 { $count }
lit-tag-pdf = PDF
lit-tag-oa = OA
lit-quartile-cass-1 = 一區
lit-quartile-cass-2 = 二區
lit-quartile-cass-3 = 三區
lit-quartile-cass-4 = 四區
lit-quartile-jcr-q1 = JCR Q1
lit-quartile-jcr-q2 = JCR Q2
lit-quartile-jcr-q3 = JCR Q3
lit-quartile-jcr-q4 = JCR Q4
lit-top = 頂
lit-warning = 預警
lit-if-label = IF

# Import
lit-import-btn = 匯入
lit-importing = 匯入中...
lit-imported = 已匯入
lit-import-success = 已匯入: { $title }
lit-import-no-doi = 該條目缺少 DOI，無法匯入
# Batch import
lit-batch-import-confirm = 確定匯入選中的 { $count } 篇文獻到 Zotero？
lit-batch-import-done = 批量匯入完成: { $count }/{ $total } 篇成功
lit-batch-import-error = 批量匯入出錯: { $error }

# Abstract + translate
lit-abstract-label = 摘要
lit-translate-btn = 翻譯
lit-translating = 翻譯中...
lit-translate-error = 翻譯失敗
lit-translate-truncated = 摘要過長，已截斷翻譯

# Full text（PMC 開放取得 JATS XML 優先，開放取得網頁兜底）
lit-fulltext-title = 全文
lit-fulltext-btn = 全文
lit-fulltext-fetching = 取得中...
lit-fulltext-collapse = 收起
lit-fulltext-tip = 取得全文（PMC 開放取得 XML 優先，開放取得網頁兜底）
lit-fulltext-no-id = 缺少 DOI/PMID，無法取得全文
lit-fulltext-empty = 未能取得全文：該文章可能不在開放取得範圍內
lit-fulltext-failed = 全文取得失敗
lit-fulltext-words = 約 { $count } 詞
lit-fulltext-truncated = 全文過長，已截斷顯示
lit-fulltext-source-pmc = PMC 全文
lit-fulltext-source-grobid = GROBID 全文
lit-fulltext-source-html = 網頁全文
lit-all-sources-failed = 所有外部來源均檢索失敗，請檢查網路連線


# Window initialization failure (shown when iframe fails to init within 10s)
window-init-failed = { $name } 初始化失敗。
window-init-failed-retry = 請嘗試關閉並重新開啟視窗。

# Embedding Progress
embedding-progress-init = 正在準備嵌入...
embedding-progress-done = 嵌入完成：共 { $count } 篇，耗時 { $elapsed }s
embedding-progress-eta = 預估剩餘 { $eta }s

# Embedding fallback notifications
tracker-state-n-unread = { $count } 條未讀變化
Requires real-time processing
Data size under 100MB
Accuracy over speed
# AnalysisReportView
# DiscussionView
# Progress
zsearch-hub-window =
    .title = z-search 搜尋中心
hub-tab-home = 首頁
# F-44：統計取數持續失敗的內聯錯誤行（toast 之外的常駐可見態）
# P1-1：庫況統計取數失敗時的內聯降級行（數字位置渲染「—」，不渲染 0）
# F-48：文獻庫開啟失敗 toast
# CX-4：最近動態取數失敗的頁內錯誤行（失敗不得渲染成空態）
semantic-vector-gap-desc = 建立全文索引後，可啟用語意排序、相似文獻與重複偵測。
hub-tab-search = 搜尋
# { $count } -> 總節點數；{ $limit } -> 建議上限
hub-search-page-title = 搜尋
hub-search-seg-literature = 文獻
hub-search-seg-journal = 期刊
hub-search-source-library = 庫內
hub-search-engine-external = 外部
hub-search-engine-idle = 未檢索
hub-search-engine-bm25 = 僅關鍵字可用
# R4-04：hybrid 檢索的向量腿不可用 → 本批命中實為純關鍵詞排序（降級可見）
hub-search-engine-degraded = 結果未含語義排序（向量腿不可用，僅 BM25 關鍵詞通道）
hub-search-engine-searching = 檢索中
hub-search-engine-progress = 已完成 { $done }/{ $total } 源 · { $seconds } 秒
hub-search-engine-partial = { $count } 個來源失敗，結果可能不全
hub-search-engine-done = { $count } 條
hub-search-engine-error = 出錯
hub-search-empty-index = 未建索引
hub-search-searching-title = 正在檢索 { $count } 個來源…
# 缺 Key 的來源不發請求，跑失敗的來源記名（2026-09-23）：載入標題只報「發起幾路」，這兩行補上實際哪幾路沒跑
hub-search-sources-nokey = { $count } 個來源未啟用（未填 API Key）：{ $sources }——可在 Zotero 設定 · 學術檢索 API Keys 填寫
hub-search-sources-failed = { $count } 個來源未回傳結果：{ $sources }
# 值為該 tag/author 覆蓋的篇數（2026-09-06 審計 #8 文案修正）
# claim 層極性（2026-09-06 審計 #11）
# cross layer edge types
# relationship layer edge types
# G-7 邊互動（2026-09-16）：關係小卡的欄位名。
# 布局選擇器（決策批二十二 §15-56）：四檔單選，停用給原因
# TimeBar 時間刷（決策批二十二 §15-59）：年份直方圖 + 區間刷 + 播放
hub-graph-filter-year-from = 起始年份
hub-graph-filter-year-to = 結束年份
hub-graph-filter-year-5y = 近5年
hub-graph-filter-year-10y = 近10年
hub-graph-filter-year-all = 全部
hub-graph-filter-keyword = 關鍵詞
hub-graph-filter-reset = 全部重置
hub-graph-filter-count = 顯示 { $shown } / { $total } 個節點
error-hub-render = Hub 渲染失敗
# PaperGraph 獨立視窗（PaperGraphWindow/DetailPanel/RelatedPanel）
# === Hub 設定（Phase 1） ===
# SettingsPane 的區段標題。欄位級標籤沿用 preferences.ftl 中的 pref-* 鍵。
hub-settings-bad-ascii = 值含非 ASCII 字元，會導致 HTTP 錯誤。
# === Hub 設定重設計（R1+） ===
hub-settings-saved = 已儲存
hub-settings-save-failed = 儲存失敗

hub-settings-key-mask-placeholder = 新增金鑰…
hub-settings-key-empty = 未設定
hub-settings-key-show = 顯示
hub-settings-key-hide = 隱藏
hub-settings-key-copy = 複製
# === Hub Settings Part A bug 修復 ===
# === Hub Settings Part B1: section 標題 ===
hub-settings-section-research = 研究
hub-settings-section-item-columns = 條目列表欄
# 灰色源門控（2026-09-07 裁決：預設關 + 顯式確認啟用）
hub-settings-tab-pdf-download = PDF 下載
# === Hub Settings Part B2: section 標題 + 缺失 key ===
# ── 第四層自動化：事件 Hook（2026-09-21 補實現）──
# ── 新增追蹤對話框（trackableTypes 註冊表驅動，2026-08-17）──
hub-settings-section-tools = 工具
# === Hub Settings Part B3: shortcuts/security/backup ===
# === Hub Settings B4 ===
# === 驗證內聯標記（A2） ===
# === 驗證面板（A3） ===
# === (作者, 年份) 引用點擊（A1） ===
# A2A (Agent2Agent)
# 方案四（2026-09-21）：QuickStartWizard 個人化播種螢幕
embedding-not-configured-error = 語意索引未設定：請到 設定 → AI 模型 → 嵌入 指派模型（API 模式），或切換本地模式。
decision-not-configured-error = 決策模型未啟用：請到 設定 → AI 模型 → 決策模型 開啟，並確認已設定 OpenRouter API 金鑰。
decision-unavailable-error = 決策服務暫時不可用——本次呼叫已跳過，走常規路徑。
chat-citation-nav-no-pdf = 該文獻未找到 PDF 附件，無法跳轉。
chat-citation-nav-not-found = 未找到該文獻（可能文獻庫尚未同步至此裝置）。
# ===== UX fixes round 3 (2026-08-14) =====
ux3-lit-refreshing = 檢索中——目前顯示上次結果
ux3-lit-no-results-desc = 未找到結果。請調整關鍵字或篩選條件後重試。
ux3-lit-copy-list = 複製清單
ux3-lit-export-csv = 匯出 CSV
ux3-lit-export-failed = 匯出失敗
ux3-lit-load-more-remaining = 載入更多（剩餘 { $count } 條）
ux3-journal-searching = 正在檢索期刊資料…
ux3-journal-no-response = 檢索服務無回應
ux3-misc-sr-close = 關閉
# ── Discussion Room (討論室) ──────────────────────────────
# v1.52（2026-08-22 审计修复批）：设置页拆节/空态/快捷键新键
# v1.52 二轮（2026-08-22）：mcp 导航键 taxonomy 对齐 + brain 首用引导/组标签
# B2 三維語意審計（嚴格模式）— 2026-08-26
# 記憶可見性披露（memorax 參照批⑤）
# B9 審計面板與回饋
# R4-03：整幀快照（撤銷來源）上行失敗——與「編輯儲存失敗」是兩件事
# Constraint mining (经验约束挖掘)
# Constraint library (constraint mining 批 2)
# Constraint interrogation (constraint mining 批 3)
# Search sources management (搜索源管理批)
hub-settings-section-search-sources = 搜尋源
search-sources-desc = 啟用網頁搜尋源、測試可達性並選擇預設源；不可達的源會在查詢時自動跳過。
search-sources-default = 預設
search-sources-empty = 還沒有啟用的搜尋源——新增一個以驅動網頁搜尋。
prefs-keys-title = API Keys 與服務端點
prefs-keys-desc = 各搜尋源的 API key 即填即存，僅寫入本機設定。
prefs-academic-keys-title = 學術檢索 API Keys
prefs-academic-keys-desc = 學術檢索源的存取憑據。CORE、Semantic Scholar、Dimensions 未填 Key 時該源會在檢索中被跳過；PubMed、GitHub 的 Key 僅用於提高存取頻率；OpenAlex 一欄填免費 API Key（約 10 萬次/天），舊版 mailto 郵箱已廢、填郵箱不生效。下滑鼠標悬停輸入框可看各 Key 的申請位址。
prefs-key-set = 已填寫
prefs-key-missing = 未填寫
prefs-key-required = 必填
prefs-key-optional = 可選
prefs-show-keys = 顯示金鑰
prefs-select-source = 請先在清單中選取一個搜尋源，再測試連線。
prefs-status-enabled = 已啟用
prefs-status-not-added = 未啟用
prefs-status-not-added-nokey = 未啟用 · 免 key
prefs-default-set = 預設源已設為 { $name }。
search-sources-test = 測試
search-sources-test-ok = 可達 · { $count } 條結果
search-sources-test-auth = key 被拒絕——請檢查 API key。
search-sources-test-missing-key = 未設定 API key——請先在下方填寫。
journal-data-import-failed = 內建期刊資料集（JCR/中科院分區/預警/Beall's）未能載入——期刊指標與風險標記將缺席，重啟 Zotero 可重試匯入。
search-sources-test-unreachable = 目前網路不可達。
search-sources-test-failed = 測試失敗：{ $detail }
search-sources-not-configured = 未填 key

{$edits}
soul-name-datasource-manager-soul = 文獻品質資料源管理專家
# ── 进程超时对话框 / OAuth 落地页 / 聊天与进度兜底文案（2026-09-17 清理批六）
embedding-failed-fallback = 向量化失敗

# === Shortcut Manager：說明彈窗 + Hub 設定頁快速鍵清單（2026-09-17 i18n 批）===
# 資料側仍存 action id 與英文分類 id（註冊/匹配/分組語義不變），本族鍵只供展示取詞：
# 唯一取詞點是 ShortcutManager.getAllShortcuts()（help 彈窗 + Hub 設定頁 shortcuts.list）。
# *-name 對應 ShortcutConfig.nameKey，*-desc 對應 descKey，cat-* 對應 category 展示名。
# ── OpenDataLoader 翻译错误友好化文案（2026-09-17 批七 i18n）
# 硯法 §8.3 表格尾狀態欄〔則〕：結果型列表尾部「共 N 條」計數（2026-09-20 合規批，與 hub-search-results-count 頭部計數同源）
hub-search-total-count = 共 { $count } 條

# 硯法合規批（2026-09-20 §5.5/§10.1）：畫布指令框發送鈕圖標化後的可達名
# （字形 ➤ 退役 lucide send 圖標，§10.1 圖標鈕須 aria-label + tooltip）
# 砚法合规修复批（2026-09-20 §4.6）：审批卡「查看上下文」入口
# 硯法合規批 2026-09-20（§9.1 階段牆禁進度條/§11 深度研究行 byline）
# ── 硯法合規批（2026-09-20 §8.0/§15-61）：側欄密度二檔開關 + 設定頁分區搜尋
# ── 圖譜畫布件（硯法立法 §8.11/§15-58~59，2026-09-20 合規修復批）──
# 硯法合規修復批（2026-09-20 §9.2）：審批卡參數摺疊鈕（圖標鈕 aria 名）
# 硯法合規批（2026-09-20 §15-39）：重評佇列主宿=證據面（全量工單次級頁）——證據面橫幅與學術腦計數徽標共用
# 布局選擇器四檔常顯鈕內短標籤（用戶裁決 2026-09-20：MenuDropdown→tglgrp 四檔，
# 形態對齊原型圖譜頁/§15-54 標本；全名/門控原因仍複用上方既有鍵）
# ── 硯法合規批 2026-09-20（用戶裁決「全補」）：發起表單補兩欄位（深度檔位按預估件誠實呈現）──
# ── 硯法合規批 2026-09-20（用戶裁決「全量對齊」）：來源與引用次級頁（原型 #research-sub-sources）──
# ── §8.0 頁頭法 + IA §0 形式徽標（2026-09-20 用戶裁決：頁頭+形式徽標生產落地）──
# 13 頂層 pane 頁頭副語（§8.0 頁頭法：標題+副語）
# ── 關注頁兩塊制（IA §4.3 裁決 31，2026-09-20 頁批）：管理抽屜 + cron 四模式表單 ──
# ── 硯法頁批（§15-46 三段名實閉環 / §15-38 分析區卡化 / §15-40 摘要遷概念面 /
#    §15-37 定式3 透視三欄 + 決策雙欄嚮導，2026-09-20）──
# ── 硯法研究結構批（A1/A2/A5/A9/A13，2026-09-20）：形式②骨架 / 進展壓縮視圖 /
#    次級頁（發起⑤·研究進展③·檢查點③）/ 深鏈 ──
# B1.5 定稿批（2026-09-20，原型 :7028-7090）：概念詳情分類學資訊行
# B1.5 定稿（2026-09-20 §15-47③ 三面板）：論文畫像詳情彈窗面板三——篇級不確定性聚合
# 工作區會話側欄（IA §4.4 v2.19 §15-91 功能批，2026-09-20）：左欄可搜尋會話列表
# Memory 管理卡（§15-75 / IA v2.18 §4.7：記憶管理歸設定 Agent 分區，2026-09-20）：
# 最小可用=列表+刪除+統計，不做新建/編輯表單
# 工作區 Dashboard 升格批①（IA §0 側欄內容准入法落地實例 + §4.4；原型 ws-sub-dash 入口欄 :7902-7977 / 次級頁 :7979-8090）
# 准入法升格批②（IA §0 形式⑥；原型 canvas-sub-material）：畫布素材庫次級頁
# ── 硯法合規批·聊天窗（2026-09-20 第二輪①：§8.5/§9.2/§10.5）──
# ── 硯化第二輪·閱讀器面板批（硯法 §9.4 失敗≠空：能力缺失/空譯文誠實披露）──
# 为你发现卡（推荐引擎功能批 v1：三腿聚合真数据）
# 研究空白次级页（功能批②：三视图聚合真数据，§15-48/49）
# 研究空白十六裁收口（§15-98~100：行动钮排/双维度/三态互链）
# 十六裁批C（§15-106~108：页头主钮/事件行去处）
# 十六裁批D（§15-110：素材形态轴）
# 复审批E（Q1 元信息行）
# 方案四（2026-09-21 共同成長閉環）：訊息級回饋
# 复审批F（Q14 cron 试运行文案本地化）
# z-search 菜单
tools-open-search = 開啟搜尋中心
menuitem-find-similar = 尋找相似文獻

# ---- PDF 解析路径（MinerU / Java / OpenDataLoader）用户可见文案 ----
pdf-mineru-token-missing = MinerU API Token 未設定，請在設定 → PDF 解析引擎中填寫。
pdf-mineru-requesting-url = 正在向 MinerU 雲端申請上傳位址…
pdf-mineru-no-upload-url = MinerU 雲端未傳回上傳位址：{ $detail }
pdf-cancelled = 已取消
pdf-mineru-uploading = 正在上傳 PDF 到 MinerU 雲端…
pdf-mineru-upload-failed = MinerU 檔案上傳失敗 (HTTP { $status })
pdf-mineru-parsing = MinerU 正在解析，請稍候…
pdf-mineru-downloading = 正在下載解析結果…
pdf-mineru-no-download-url = MinerU 雲端未傳回結果下載位址
pdf-mineru-parsing-elapsed = MinerU 正在解析…（{ $elapsed }s）
pdf-mineru-parse-failed = MinerU 解析失敗：{ $detail }
pdf-mineru-timeout = MinerU 解析超時（{ $minutes } 分鐘）
pdf-mineru-checking-local = 正在檢查本地 MinerU 服務…
pdf-mineru-local-unavailable = 本地 MinerU 服務不可用 ({ $base })：{ $detail }
pdf-java-unzip-failed = 解壓失敗: { $detail }
pdf-java-downloading = 下載 Java { $version } JRE ({ $archive })…
pdf-java-downloading-percent = 下載中 { $percent }%
pdf-java-download-failed = 下載失敗: { $detail }
pdf-java-not-found-after-unzip = 解壓後未找到 java 可執行檔案（在 { $dir }）。請手動從 { $url } 安裝。
pdf-java-unrunnable = 下載的 Java 無法執行: { $detail }
pdf-java-too-old = 偵測到 Java { $version }，但 OpenDataLoader 需要 Java 11+。請從 { $url } 安裝较新版本。
pdf-mineru-connect-failed = 連線失敗
pdf-java-extracting = 解壓中…
pdf-java-verifying = 驗證安裝…
pdf-java-done = Java 安裝完成
pdf-jar-load-failed = 無法載入 JAR 檔案 ({ $path })：{ $detail }
pdf-mineru-uploading-local = 正在上傳 PDF 到本地 MinerU…
pdf-mineru-parsing-local = 本地 MinerU 正在解析…
pdf-mineru-token-not-set = API Token 未設定
pdf-mineru-no-layout-json = ZIP 中未找到 layout.json
pdf-mineru-empty-response = MinerU 傳回空回應
pdf-mineru-local-parse-failed = 本地 MinerU 解析失敗 (HTTP { $status }): { $detail }
pdf-mineru-auth-failed = 認證失敗: { $detail }
pdf-mineru-download-failed = 下載解析結果失敗 (HTTP { $status })
pdf-mineru-quota-exhausted = MinerU 每日解析額度已用盡（{ $detail }），請明日再試
pdf-mineru-auth-rejected = MinerU 認證失敗（{ $detail }），請檢查 API Token
pdf-mineru-api-error = MinerU API 錯誤：{ $detail } (code { $code })
pdf-translate-batch-start = 正在批量翻譯（{ $paragraphs } 段，分 { $chunks } 塊）…
pdf-translate-batch-progress = 批量翻譯進度：{ $done }/{ $total } 塊

# ── 主窗工具列按鈕與快捷鍵（入口，P0-4）──
toolbar-open-search-tooltip = 開啟搜尋中心（Ctrl+Shift+K）

# ── 已在庫徽章與 OA 篩選（P0-3）──
lit-in-library = 已在庫
lit-in-library-tip = 該 DOI 已存在於你的 Zotero 文庫
lit-filter-open-access = 開放取用
lit-filter-open-access-hint = 只顯示開放取用結果

# ── 引文鑽取（P0-2）──
lit-cited-by-title = 施引文獻 — { $title }
lit-references-title = 參考文獻 — { $title }
lit-references-btn = 參考文獻
lit-cited-by-tip = 查看引用本文的文獻（OpenAlex）
lit-citations-loading = 正在取得引文…
lit-citations-count = 已載 { $count } 條 / 共 { $total } 條
lit-citations-empty = 未找到引文資料
