## [Auto-merged] Common keys consolidated from module-specific duplicates.
## Source: tmp/merge-map.py. Do not re-split unless adding language that needs context-specific override.

btn-cancel = 取消
btn-clear = 清除
btn-back = 返回
aria-breadcrumb = 面包屑导航
btn-close = 关闭
btn-retry = 重试
common-confirm = 确认
common-cancel = 取消
common-close = 关闭
toast-viewport-label = 通知
common-doi = DOI
common-no-selection = 请先选择一个条目
common-searching = 搜索中...
common-search = 搜索
common-results = 结果
progress-saving = 保存中...
# ============================================================
# Auto-generated i18n entries for tools and prompts
# DO NOT EDIT manually - use consistent naming: tool-{id}-{field}
# ============================================================

error-boundary-message = 出错了
error-bridge-timeout = 请求超时：{ $method } 无响应，请重试；若反复出现，请检查网络、索引或模型配置。
# Relative time
time-just-now = 刚刚
time-minutes-ago = { $count } 分钟前
time-hours-ago = { $count } 小时前
time-days-ago = { $count } 天前

# Chat Sidebar
recommend-add-success = 已添加到文献库：{ $title }
recommend-add-failed = 添加失败：{ $title }
# Chat Message List
# Chat Window - System Messages
# Chat Window - Toolbar & Status
# Thinking & Tool Calls
# Chat Input
# Item Picker
# Model Quick Switch
# Progress Bar
progress-status-processing = 正在处理...

# Export Dialog
# Agent & Progress
progress-duration-seconds = { $seconds }秒
# Cron Presets
# Context Pane
# Item Tree
itemtree-items-count = 个条目
# Tools
# ── Cron 定时消息 对话框 ──
# RM-6：节头开关可见标签（原裸 Toggle 无可见词，ON+空列表语义矛盾）
# CX-8：创建/删除成功 toast（此前静默）
# 空态两段制（Following slim 空态 + 旧 cronDialog.xhtml 同键共用）；2026-09-14 口径改任务通用
# Menu
# Clipboard (P0-1)
# Translation (P0-2)
# Translate panel
# Reader sections (native Zotero sidebar)
# Translation engine errors (src/core/translation/translationEngines.ts)
translation-error-google-empty = Google 翻译返回空结果
translation-error-bing-empty = Bing 翻译返回空结果
translation-error-deepl-empty = DeepL 翻译返回空结果
translation-error-custom-empty = 自定义 API 返回空结果
translation-error-ai-empty = 翻译返回空结果
translation-error-google-failed = Google 翻译失败
translation-error-bing-failed = Bing 翻译失败
translation-error-deepl-failed = DeepL 翻译失败
translation-error-custom-failed = 自定义 API 翻译失败
translation-error-pdf-translate-failed = zotero-pdf-translate 翻译失败
translation-error-bing-not-configured = Bing 翻译未配置 API Key
translation-error-deepl-not-configured = DeepL 翻译未配置 API Key
translation-error-custom-url-missing = 自定义翻译 API 地址未配置
translation-error-ai-not-configured = 翻译未配置（请在 Leadero 设置里配置 AI 模型的翻译功能）
translation-error-google-fallback-failed = Google 翻译失败（{ $googleError }），Bing 兜底亦失败（{ $bingError }）
translation-error-unknown = 未知错误
translation-error-bing-token-unavailable = 无法获取 Bing 翻译令牌（页面结构可能已变更）
translation-error-bing-rejected = Bing 拒绝请求（{ $status }）
translation-error-pdf-translate-missing = zotero-pdf-translate 插件未安装或未启用，请在 Zotero 插件管理器中安装并启用它

# Reader Context Menu
# 选中文本右键菜单的动作前缀（无参数，文本由调用侧拼接）
# Profile Memory System
# 深度研究
search-error-serper-quota = Serper credits/quota 耗尽，请在设置中切换 web search provider（如 duckduckgo/bing-html 免费 scrape）

# Usage Dashboard — Table Headers
# Usage Dashboard — Day Labels
# Usage Dashboard — Month Labels
# Collapsible
# Code Block
codeblock-show-all = 显示全部 ({ $count })
# Mermaid Toolbar
# Agent Run
btn-open = 打开
btn-show-more-results = 显示更多 { $count } 条结果
# Argument Display
arg-badge-items = { $count } 项
arg-badge-more = +{ $count } 更多
arg-badge-fields = { $count } 个字段

# Token Usage
# Tool Labels
# Agent Status
status-tokens = { $count } tokens

# Header
# Sidebar
# Action Suggestions
# Drag & Drop
drop-item-count = { $count } 项

# Markdown Renderer
markdown-loading = 加载中

# Search Result Display
# Toolbar
# Sidebar
# 会话产出追踪 — agent 本轮对话改了什么
# 后台任务 (D5)
# Action Suggestions (prompt text)
# Reader Sidebar Quick Actions
# No-model banner (shown on HomePage when no chat model is configured)
# Semantic Search Panel
semantic-sort-label = 排序
semantic-sort-relevance = 相关性
semantic-sort-date = 日期
semantic-sort-title = 标题
semantic-tab-similar = 查找相似
semantic-tab-duplicates = 重复检测
# JA-2（2026-09-17 Hub 评审批 3）：检索结果行内追踪动作（§30.2 文献条目出口）
semantic-track-action = 追踪
semantic-track-paper-tip = 追踪此论文的引用动态
semantic-track-topic-tip = 无 DOI——以此标题为检索式追踪相关新论文
# JA-3（2026-09-17 Hub 评审批 3）：库内结果行「打开」的成功回执（§31.1 页内点击 → Hub toast）
semantic-opened-in-zotero = 已在 Zotero 中选中该条目
semantic-opened-focus-failed = 已在 Zotero 中选中该条目——未能切换到 Zotero 窗口
hub-search-anchor-scope-hint = 作用于 Zotero 主窗口当前选中的条目
semantic-results-header-similar = 相似条目
semantic-results-header-duplicates = 重复检测
csv-header-title = 标题
csv-header-authors = 作者
csv-header-year = 年份
csv-header-journal = 期刊
csv-header-doi = DOI
csv-header-citations = 被引
csv-header-source = 来源
csv-header-pdf-url = PDF 链接
semantic-failed-items = 失败条目：
semantic-skipped-details = 跳过明细：
semantic-skip-no-pdf-attachment = 无 PDF 附件
semantic-skip-extraction-failed = 全文抽取失败
semantic-skip-low-quality-text = 抽取文本质量过低
semantic-skip-empty-parse = 解析结果为空
semantic-skip-already-indexed = 已是最新索引
semantic-watchdog-timeout = 看门狗超时
semantic-item-fallback = 条目 { $itemId }
semantic-scan-desc = 扫描将比较文库中所有条目的语义相似度
semantic-scanning = 扫描中：{ $current }/{ $total } ({ $percent }%)
semantic-scan-failed = 扫描失败：{ $error }
semantic-scope-fulltext = 全文
semantic-section-any = 全部章节
semantic-section-method = 方法
semantic-section-intro = 引言
semantic-section-discussion = 讨论
semantic-section-conclusion = 结论
semantic-build-index = 构建全文索引
semantic-build-confirm = 将对全库 PDF 构建全文索引，可能需要较长时间。继续？
semantic-build-done = 完成：成功 { $processed } 篇，跳过 { $skipped } 篇，失败 { $errors } 篇
semantic-build-failed = 构建失败：{ $error }
semantic-building = 构建中… { $current } / { $total }
semantic-rebuild = 重建
semantic-rebuild-confirm-label = 确认重建
semantic-model-changed-warning = embedding 模型已变更，全文索引需重建
semantic-duplicate-groups = 重复组 ({ $count })
semantic-no-duplicates = 未发现重复项！
# JA-4：找相似已完成但 0 相似（区别于「未选中条目」）
semantic-no-similar = 没有找到与所选条目相似的文献。
semantic-duplicate-item = { $title } + { $count } 个重复项
semantic-results-count = 结果 ({ $count })
semantic-onboarding-desc = 构建全文索引后，可启用库内语义搜索、相似文献与重复检测。

# 期刊搜索（Hub「期刊」标签页）
journal-mode-metric = 按刊名/ISSN 查指标
journal-mode-discover = 按领域发现
journal-placeholder-metric = 输入刊名或 ISSN...
journal-placeholder-discover = 输入研究领域关键词...
journal-source-local = 本地
journal-source-openalex = OpenAlex
journal-no-data = 本地与 OpenAlex 均无数据
journal-empty-hint = 输入刊名或 ISSN 查询期刊指标
journal-empty-hint-discover = 输入研究领域关键词发现期刊
journal-not-found = 未找到该期刊
journal-jcr-section = JCR 指标
journal-cass-section = 中科院分区
journal-risk-section = 风险标记
journal-overview-section = 期刊概况
journal-topics-label = 收稿领域
journal-h-index-label = h 指数
journal-i10-index-label = i10 指数
journal-2yr-citedness-label = 2 年篇均被引
journal-since-year = 创刊于 { $year }
journal-apc-label = 版面费 ${ $amount }
journal-oa-label = 开放获取
journal-doaj-label = DOAJ 收录
journal-jif-label = 影响因子
journal-five-year-jif-label = 5 年 IF
journal-jci-label = JCI
journal-quartile-label = JCR 分区
journal-rank-label = 排名
journal-total-cites-label = 总引用
journal-total-articles-label = 总发文
journal-cass-quartile-label = 中科院分区
journal-cass-category-label = 大类
journal-is-top-label = 顶刊
journal-minor-categories-label = 小类
journal-warning-label = 国际预警
journal-predatory-label = 掠夺性
journal-predatory-data-year = Beall's 列表截止：2017 年 1 月
journal-works-count-label = 发文量
journal-h5-index-label = h5 指数
journal-library-count-label = 库内篇数
journal-results-count = { $count } 本期刊
journal-sort-label = 排序
journal-sort-relevance = 相关性
journal-sort-jif = 影响因子
journal-sort-works = 发文量
journal-sort-h5 = h5 指数
journal-sort-library = 篇数
journal-search-failed = 期刊搜索失败：{ $error }

# Profile Window
profile-dim-research-domain = 研究领域
profile-dim-reading-style = 阅读方式
profile-dim-interaction-style = 交互偏好
profile-dim-output-preference = 输出偏好
profile-dim-tool-preference = 工具偏好
profile-dim-language-style = 语言风格

# 量化特征面板（用户模型的纯代码计算层）
# Toolbar
# Tool Result Displays
# Missing keys (used in code but not in FTL)
# 会话批量操作
# Chat Errors
copy-success = 复制成功
copy-failed = 复制失败
save-note-success = 笔记已保存
chat-error-generic = 发生意外错误，请重试。
chat-error-auth = API 密钥无效，请在设置中检查您的密钥。
chat-error-forbidden = 访问被拒绝，您的 API 密钥没有执行此操作的权限。
chat-error-rate-limit = API 请求频率已达上限，请稍后重试。
chat-error-server = AI 服务器错误，请稍后重试。
chat-error-unavailable = AI 服务暂时不可用，请稍后重试。
chat-error-token-limit = 请求过长，请尝试缩短消息或开始新对话。
chat-error-network = 网络错误，请检查网络连接。
chat-error-cancelled = 请求已取消。
chat-error-no-provider = 尚未为该功能配置 AI 模型。请打开 Leadero 设置 → AI 模型，为对应功能指派模型（聊天与智能体需分别指派）。
chat-error-with-detail = 错误：{ $error }
# ── 排队面板（运行中提交入队；借鉴 ZCode 批 2026-09-07）──
chat-init-timeout = 聊天未能在 30 秒内完成初始化。

# Slash Menu Commands — keep in sync with src/react/components/Input/slashCommands.ts
# ── Soul / Agent 名称 ──
soul-name-default = Leadero 助手
soul-name-reader-copilot = 阅读副驾驶
soul-name-synthesis-agent = 跨论文分析师
soul-name-digest-agent = 批注合成器
soul-name-user-memory = 用户记忆
soul-name-peer-reviewer = 同行评审员
soul-name-writing-coach = 写作教练
soul-name-devils-advocate = 魔鬼代言人
soul-name-rebuttal-strategist = 答辩策略师
soul-name-lab-senior = 资深实验导师
soul-name-design-advisor = 研究设计顾问
soul-name-translation-bridge = 翻译桥梁
soul-name-organization-master = 文献管理大师
soul-name-interrogator = 审问者
soul-name-discussion-facilitator = 讨论主持人

# ── Grill / Alignment ──
# ── Research Dashboard UI ──
# R-6（2026-09-15 部署包评审）：必填星号由 NewResearchForm 的
# <span class="leadero-form-required"> 渲染（红色、有样式），本值内不再自带
# 字面量星号——否则真机渲染成「研究问题 * *」两个星号（截图放大直证）。
# 统一 gap 入口（2026-09-21）：空白卡预览
research-warnings-title = { $count } 个警告

# ── 结构化警告渲染（WarningsPanel 解析机器模板后映射的文案） ──
research-warning-retracted = 已移除 { $count } 处对撤稿论文的引用
research-warning-epistemic = { $count } 条论断的不确定性偏高：

# ── Toolbar Tooltips ──
# ── Brain Dashboard UI ──
brain-export = 导出 { $count ->
   [0]     (全部)
  *[other] ({ $count })
}
# Extraction Panel
# Brain extraction fail reasons (user-facing)
# F-54：部分概念写库失败（DB 故障）——条目记 partial 允许重提取
# Brain diagnostic translations
# Brain Insights browser
# Brain concept detail
# Discovery entity types
# Discovery entity extra fields
# New fields for 15-dimension expansion
# Discovery entity tracking fields
# Discovery activity types
# Discovery relation types
usage-tokens-label = { $count } 个 token
usage-calls-label = { $count } 次调用
paper-graph-citations = { $count } 次引用
# 阅读时间统计
# RM-12b：日历右上五色点（主序列选色器）的可见标签（原仅 tooltip 可发现）
# Library tab（文献计量，2026-09-03 批 1）
# Window initialization failure (shown when iframe fails to init within 10s)
window-init-failed = { $name } 初始化失败。
window-init-failed-retry = 请尝试关闭并重新打开窗口。

# Embedding Progress
embedding-progress-init = 正在准备嵌入...
embedding-progress-done = 嵌入完成：共 { $count } 篇，耗时 { $elapsed }s
embedding-progress-eta = 预估剩余 { $eta }s

# Embedding fallback notifications
# Multi-agent tasks
tracker-state-n-unread = { $count } 条未读变化

# Search
# 双 tab（2026-09-23）：网络=外部数据库，本地=文库。tab 即范围，
# 原来的全域并联混列表与 includeLibrary 开关随之退役。
hub-search-tab-label = 搜索范围
hub-search-tab-web = 网络搜索
hub-search-tab-local = 本地搜索
# 两个 tab 各自的输入框占位符
hub-search-placeholder-web = 输入研究问题、关键词或 DOI… 例：multi-agent literature review
hub-search-placeholder-local = 输入关键词，检索文库标题、摘要与全文…
# 两个 tab 各自的初始空态文案
lit-initial-hint-web = 输入关键词，检索外部数据库；结果可直接导入 Zotero
lit-initial-hint-local = 输入关键词，检索你的文库；命中可在 Zotero 主窗口打开
lit-select-all = 全选
lit-clear-selection = 清除选择
lit-import-selected = 导入选中 ({ $count })
lit-imported-count = 已导入 { $count } 篇
# Advanced filters
lit-year-range = 年份范围
lit-filter-sources = 数据源
lit-sort-relevance = 相关度
lit-sort-published = 最新发表
lit-sort-cited = 引用最多
lit-max-results = 结果数
lit-filter-author = 作者
lit-filter-author-placeholder = 按作者筛选（可选）
lit-filter-journal = 期刊
lit-filter-journal-placeholder = 按期刊筛选（可选）

# Literature filter dialog（Hub 搜索页筛选弹窗：按 tab 分流分区——网络=来源/查询，本地=全文范围）
hub-search-filter-trigger = 筛选
hub-lit-filter-title = 文献筛选
hub-lit-filter-title-local = 文库筛选
hub-lit-filter-effect-hint = 条件在下次搜索时生效
hub-lit-filter-active-count = 已启用 { $count } 项筛选
hub-lit-filter-zone-sources = 来源与引擎
hub-lit-filter-sources-hint = 全不选 = 检索全部外部源；CORE、Semantic Scholar 需 API Key（未填时自动跳过，在 Zotero 设置·学术检索 API Keys 填写）
hub-lit-filter-zone-query = 查询条件
hub-lit-filter-sort-ext = 排序（外部源取回序）
hub-lit-filter-zone-library = 库内全文范围
# 本地 tab 空态的差额提示（BM25 可用但向量未建：先搜着，语义能力待构建）
hub-search-local-gap-hint = 当前可先用关键词检索（语义排序未启用）
hub-lit-build-summary = 上次构建结果

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
lit-quartile-cass-1 = 一区
lit-quartile-cass-2 = 二区
lit-quartile-cass-3 = 三区
lit-quartile-cass-4 = 四区
lit-quartile-jcr-q1 = JCR Q1
lit-quartile-jcr-q2 = JCR Q2
lit-quartile-jcr-q3 = JCR Q3
lit-quartile-jcr-q4 = JCR Q4
lit-top = 顶
lit-warning = 预警
lit-if-label = IF

# Import
lit-import-btn = 导入
lit-importing = 导入中...
lit-imported = 已导入
lit-import-success = 已导入: { $title }
lit-import-no-doi = 该条目缺少 DOI，无法导入
# Batch import
lit-batch-import-confirm = 确定导入选中的 { $count } 篇文献到 Zotero？
lit-batch-import-done = 批量导入完成: { $count }/{ $total } 篇成功
lit-batch-import-error = 批量导入出错: { $error }

# Abstract + translate
lit-abstract-label = 摘要
lit-translate-btn = 翻译
lit-translating = 翻译中...
lit-translate-error = 翻译失败
lit-translate-truncated = 摘要过长，已截断翻译

# Full text（PMC 开放获取 JATS XML 优先，开放获取网页兜底）
lit-fulltext-title = 全文
lit-fulltext-btn = 全文
lit-fulltext-fetching = 获取中...
lit-fulltext-collapse = 收起
lit-fulltext-tip = 获取全文（PMC 开放获取 XML 优先，开放获取网页兜底）
lit-fulltext-no-id = 缺少 DOI/PMID，无法获取全文
lit-fulltext-empty = 未能获取全文：该文章可能不在开放获取范围内
lit-fulltext-failed = 全文获取失败
lit-fulltext-words = 约 { $count } 词
lit-fulltext-truncated = 全文过长，已截断显示
lit-fulltext-source-pmc = PMC 全文
lit-fulltext-source-grobid = GROBID 全文
lit-fulltext-source-html = 网页全文
lit-all-sources-failed = 所有外部来源均检索失败，请检查网络连接


Requires real-time processing
Data size under 100MB
Accuracy over speed
# AnalysisReportView
# DiscussionView
# Progress
zsearch-hub-window =
    .title = z-search 搜索中心
hub-tab-home = 主页
# F-44：统计取数持续失败的内联错误行（toast 之外的常驻可见态）
# P1-1：库况统计取数失败时的内联降级行（数字位置渲染「—」，不渲染 0）
# F-48：文献库打开失败 toast
# CX-4：最近动态取数失败的页内错误行（失败不得渲染成空态）
semantic-vector-gap-desc = 构建全文索引后，可启用语义排序、相似文献与重复检测。
hub-tab-search = 搜索
# { $count } -> 总节点数；{ $limit } -> 推荐上限
hub-search-page-title = 搜索
hub-search-seg-literature = 文献
hub-search-seg-journal = 期刊
hub-search-source-library = 库内
hub-search-engine-external = 外部
hub-search-engine-idle = 未检索
hub-search-engine-bm25 = 仅关键词可用
# R4-04：hybrid 检索的向量腿不可用 → 本批命中实为纯关键词排序（降级可见）
hub-search-engine-degraded = 结果未含语义排序（向量腿不可用，仅 BM25 关键词通道）
hub-search-engine-searching = 检索中
hub-search-engine-progress = 已完成 { $done }/{ $total } 源 · { $seconds } 秒
hub-search-engine-partial = { $count } 个来源失败，结果可能不全
hub-search-engine-done = { $count } 条
hub-search-engine-error = 出错
hub-search-empty-index = 未建索引
hub-search-searching-title = 正在检索 { $count } 个来源…
# 缺 Key 的源不发请求，跑失败的源记名（2026-09-23）：加载标题只报「发起几路」，这两行补上实际哪几路没跑
hub-search-sources-nokey = { $count } 个源未启用（未填 API Key）：{ $sources }——可在 Zotero 设置 · 学术检索 API Keys 填写
hub-search-sources-failed = { $count } 个源未返回结果：{ $sources }
# 值为该 tag/author 覆盖的篇数（2026-09-06 审计 #8 文案修正）
# claim 层极性（2026-09-06 审计 #11）
# cross layer edge types
# relationship layer edge types
# G-7 边交互（2026-09-16）：关系小卡的字段名（悬停提示正文用「源 —类型→ 目标」，
# 箭头字形语言中立，故不占键）。
# 布局选择器（决策批二十二 §15-56）：四档单选，禁用给原因
# TimeBar 时间刷（决策批二十二 §15-59）：年份直方图 + 区间刷 + 播放
hub-graph-filter-year-from = 起始年份
hub-graph-filter-year-to = 结束年份
hub-graph-filter-year-5y = 近5年
hub-graph-filter-year-10y = 近10年
hub-graph-filter-year-all = 全部
hub-graph-filter-keyword = 关键词
hub-graph-filter-reset = 全部重置
hub-graph-filter-count = 显示 { $shown } / { $total } 个节点
error-hub-render = Hub 渲染失败
# PaperGraph 独立窗口（PaperGraphWindow/DetailPanel/RelatedPanel）
# === Hub 设置（Phase 1） ===
# SettingsPane 的区段标题。字段级标签复用 preferences.ftl 里的 pref-* 键。
hub-settings-bad-ascii = 值含非 ASCII 字符，会导致 HTTP 错误。
# === Hub 设置重设计（R1+） ===
hub-settings-saved = 已保存
hub-settings-save-failed = 保存失败

hub-settings-key-mask-placeholder = 添加密钥…
hub-settings-key-empty = 未配置
hub-settings-key-show = 显示
hub-settings-key-hide = 隐藏
hub-settings-key-copy = 复制
# === Hub Settings Part A bug 修复 ===
# === Hub Settings Part B1: section 标题 ===
hub-settings-section-research = 研究
hub-settings-section-item-columns = 条目列表列
# 灰色源门控（2026-09-07 裁决：默认关 + 显式确认启用）
hub-settings-tab-pdf-download = PDF 下载
# === Hub Settings Part B2: section 标题 + 缺失 key ===
# ── 第四层自动化：事件 Hook（2026-09-21 补实现）──
# ── 添加追踪对话框（trackableTypes 注册表驱动，2026-08-17）──
hub-settings-section-tools = 工具
# === Hub Settings Part B3: shortcuts/security/backup ===
# === Hub Settings B4 ===
# === 验证内联标记（A2） ===
# === 验证面板（A3） ===
# === (作者, 年份) 引用点击（A1） ===
# A2A (Agent2Agent)
# 方案四（2026-09-21）：QuickStartWizard 个性化播种屏
embedding-not-configured-error = 语义索引未配置：请到 设置 → AI 模型 → 嵌入 指派模型（API 模式），或切换本地模式。
decision-not-configured-error = 决策模型未启用：请到 设置 → AI 模型 → 决策模型 开启，并确认已配置 OpenRouter API 密钥。
decision-unavailable-error = 决策服务暂时不可用——本次调用已跳过，走常规路径。
chat-citation-nav-no-pdf = 该文献未找到 PDF 附件，无法跳转。
chat-citation-nav-not-found = 未找到该文献（可能文献库尚未同步至当前设备）。
# ===== UX fixes round 3 (2026-08-14) =====
ux3-lit-refreshing = 检索中——当前显示上次结果
ux3-lit-no-results-desc = 未找到结果。请调整关键词或筛选条件后重试。
ux3-lit-copy-list = 复制清单
ux3-lit-export-csv = 导出 CSV
ux3-lit-export-failed = 导出失败
ux3-lit-load-more-remaining = 加载更多（剩余 { $count } 条）
ux3-journal-searching = 正在检索期刊数据…
ux3-journal-no-response = 检索服务无响应
ux3-misc-sr-close = 关闭
{$edits}
# Constraint mining (经验约束挖掘)
# Constraint library (constraint mining 批 2)
# Constraint interrogation (constraint mining 批 3)
# Search sources management (搜索源管理批)
hub-settings-section-search-sources = 搜索源
search-sources-desc = 启用网页搜索源、测试可达性并选择默认源；不可达的源会在查询时自动跳过。
search-sources-default = 默认
search-sources-empty = 还没有启用的搜索源——添加一个以驱动网页搜索。
prefs-keys-title = API Keys 与服务端点
prefs-keys-desc = 各搜索源的 API key 即填即存，只写入本机配置。
prefs-academic-keys-title = 学术检索 API Keys
prefs-academic-keys-desc = 学术检索源的访问凭证。CORE、Semantic Scholar、Dimensions 未填 Key 时该源会在检索中被跳过；PubMed、GitHub 的 Key 仅用于提高访问频率；OpenAlex 一栏填免费 API Key（约 10 万次/天），旧版 mailto 邮箱已废、填邮箱不生效。鼠标悬停输入框可看各 Key 的申请地址。
prefs-key-set = 已填写
prefs-key-missing = 未填写
prefs-key-required = 必填
prefs-key-optional = 可选
prefs-show-keys = 显示密钥
prefs-select-source = 请先在列表中选中一个搜索源，再测试连接。
prefs-status-enabled = 已启用
prefs-status-not-added = 未启用
prefs-status-not-added-nokey = 未启用 · 免 key
prefs-default-set = 默认源已设为 { $name }。
search-sources-test = 测试
search-sources-test-ok = 可达 · { $count } 条结果
search-sources-test-auth = key 被拒绝——请检查 API key。
search-sources-test-missing-key = 未配置 API key——请先在下方填写。
search-sources-test-unreachable = 当前网络不可达。
search-sources-test-failed = 测试失败：{ $detail }
search-sources-not-configured = 未填 key
soul-name-datasource-manager-soul = 文献质量数据源管理专家
# ── 进程超时对话框 / OAuth 落地页 / 聊天与进度兜底文案（2026-09-17 清理批六）
embedding-failed-fallback = 向量化失败

# === Shortcut Manager：帮助弹窗 + Hub 设置页快捷键列表（2026-09-17 i18n 批）===
# 数据侧仍存 action id 与英文分类 id（注册/匹配/分组语义不变），本族键只供展示取词：
# 唯一取词点是 ShortcutManager.getAllShortcuts()（help 弹窗 + Hub 设置页 shortcuts.list）。
# *-name 对应 ShortcutConfig.nameKey，*-desc 对应 descKey，cat-* 对应 category 展示名。
# ── OpenDataLoader 翻译错误友好化文案（2026-09-17 批七 i18n）
# 砚法 §8.3 表格尾状态栏〔则〕：结果型列表尾部「共 N 条」计数（2026-09-20 合规批，与 hub-search-results-count 头部计数同源）
hub-search-total-count = 共 { $count } 条

# 砚法合规批（2026-09-20 §5.5/§10.1）：画布指令框发送钮图标化后的可达名
# （字形 ➤ 退役 lucide send 图标，§10.1 图标钮须 aria-label + tooltip）
# 砚法合规修复批（2026-09-20 §4.6）：审批卡「查看上下文」入口
# 砚法合规批 2026-09-20（§9.1 阶段墙禁进度条/§11 深度研究行 byline）
# ── 砚法合规批（2026-09-20 §8.0/§15-61）：侧栏密度二档开关 + 设置页分区搜索
# ── 图谱画布件（砚法立法 §8.11/§15-58~59，2026-09-20 合规修复批）──
# 砚法合规修复批（2026-09-20 §9.2）：审批卡参数折叠钮（图标钮 aria 名）
# 砚法合规批（2026-09-20 §15-39）：重评队列主宿=证据面（全量工单次级页）——证据面 banner 与学术脑计数徽标共用
# 布局选择器四档常显钮内短标签（用户裁决 2026-09-20：MenuDropdown→tglgrp 四档，
# 形态对齐原型图谱页/§15-54 标本；全名/门控原因仍复用上方既有键）
# ── 砚法合规批 2026-09-20（用户裁决「全补」）：发起表单补两字段（深度档位按预估件诚实呈现）──
# ── 砚法合规批 2026-09-20（用户裁决「全量对齐」）：来源与引用次级页（原型 #research-sub-sources）──
# ── §8.0 页头法 + IA §0 形式徽标（2026-09-20 用户裁决：页头+形式徽标生产落地）──
# 13 顶层 pane 页头副语（§8.0 页头法：标题+副语）
# ── 关注页两块制（IA §4.3 裁决 31，2026-09-20 页批）：管理抽屉 + cron 四模式表单 ──
# ── 砚法页批（§15-46 三段名实闭环 / §15-38 分析区卡化 / §15-40 摘要迁概念面 /
#    §15-37 定式3 透视三栏 + 决策双栏向导，2026-09-20）──
# ── 砚法研究结构批（A1/A2/A5/A9/A13，2026-09-20）：形式②骨架 / 进展压缩视图 /
#    次级页（发起⑤·研究进展③·检查点③）/ 深链 ──
# B1.5 定稿批（2026-09-20，原型 :7028-7090）：概念详情分类学信息行
# B1.5 定稿（2026-09-20 §15-47③ 三面板）：论文画像详情弹窗面板三——篇级不确定性聚合
# 工作区会话侧栏（IA §4.4 v2.19 §15-91 功能批，2026-09-20）：左栏可搜索会话列表
# Memory 管理卡（§15-75 / IA v2.18 §4.7：记忆管理归设置 Agent 分区，2026-09-20）：
# 最小可用=列表+删除+统计，不做新建/编辑表单
# 工作区 Dashboard 升格批①（IA §0 侧栏内容准入法落地实例 + §4.4；原型 ws-sub-dash 入口栏 :7902-7977 / 次级页 :7979-8090）
# 准入法升格批②（IA §0 形式⑥；原型 canvas-sub-material）：画布素材库次级页
# ── 砚法合规批·聊天窗（2026-09-20 第二轮①：§8.5/§9.2/§10.5）──
# ── 砚化第二轮·阅读器面板批（砚法 §9.4 失败≠空：能力缺失/空译文诚实披露）──
# 为你发现卡（推荐引擎功能批 v1：三腿聚合真数据）
# 研究空白次级页（功能批②：三视图聚合真数据，§15-48/49）
# 研究空白十六裁收口（§15-98~100：行动钮排/双维度/三态互链）
# 十六裁批C（§15-106~108：页头主钮/事件行去处）
# 十六裁批D（§15-110：素材形态轴）
# 复审批E（Q1 元信息行）
# 方案四（2026-09-21 共同成长闭环）：消息级反馈
# 复审批F（Q14 cron 试运行文案本地化）
# z-search 菜单
tools-open-search = 打开搜索中心
menuitem-find-similar = 查找相似文献

# ---- PDF 解析路径（MinerU / Java / OpenDataLoader）用户可见文案 ----
pdf-mineru-token-missing = MinerU API Token 未配置，请在设置 → PDF 解析引擎中填写。
pdf-mineru-requesting-url = 正在向 MinerU 云端申请上传地址…
pdf-mineru-no-upload-url = MinerU 云端未返回上传地址：{ $detail }
pdf-cancelled = 已取消
pdf-mineru-uploading = 正在上传 PDF 到 MinerU 云端…
pdf-mineru-upload-failed = MinerU 文件上传失败 (HTTP { $status })
pdf-mineru-parsing = MinerU 正在解析，请稍候…
pdf-mineru-downloading = 正在下载解析结果…
pdf-mineru-no-download-url = MinerU 云端未返回结果下载地址
pdf-mineru-parsing-elapsed = MinerU 正在解析…（{ $elapsed }s）
pdf-mineru-parse-failed = MinerU 解析失败：{ $detail }
pdf-mineru-timeout = MinerU 解析超时（{ $minutes } 分钟）
pdf-mineru-checking-local = 正在检查本地 MinerU 服务…
pdf-mineru-local-unavailable = 本地 MinerU 服务不可用 ({ $base })：{ $detail }
pdf-java-unzip-failed = 解压失败: { $detail }
pdf-java-downloading = 下载 Java { $version } JRE ({ $archive })…
pdf-java-downloading-percent = 下载中 { $percent }%
pdf-java-download-failed = 下载失败: { $detail }
pdf-java-not-found-after-unzip = 解压后未找到 java 可执行文件（在 { $dir }）。请手动从 { $url } 安装。
pdf-java-unrunnable = 下载的 Java 无法运行: { $detail }
pdf-java-too-old = 检测到 Java { $version }，但 OpenDataLoader 需要 Java 11+。请从 { $url } 安装较新版本。
pdf-mineru-connect-failed = 连接失败
pdf-java-extracting = 解压中…
pdf-java-verifying = 验证安装…
pdf-java-done = Java 安装完成
pdf-jar-load-failed = 无法加载 JAR 文件 ({ $path })：{ $detail }
pdf-mineru-uploading-local = 正在上传 PDF 到本地 MinerU…
pdf-mineru-parsing-local = 本地 MinerU 正在解析…
pdf-mineru-token-not-set = API Token 未配置
pdf-mineru-no-layout-json = ZIP 中未找到 layout.json
pdf-mineru-empty-response = MinerU 返回空响应
pdf-mineru-local-parse-failed = 本地 MinerU 解析失败 (HTTP { $status }): { $detail }
pdf-mineru-auth-failed = 认证失败: { $detail }
pdf-mineru-download-failed = 下载解析结果失败 (HTTP { $status })
pdf-mineru-quota-exhausted = MinerU 每日解析额度已用尽（{ $detail }），请明日再试
pdf-mineru-auth-rejected = MinerU 认证失败（{ $detail }），请检查 API Token
pdf-mineru-api-error = MinerU API 错误：{ $detail } (code { $code })
pdf-translate-batch-start = 正在批量翻译（{ $paragraphs } 段，分 { $chunks } 块）…
pdf-translate-batch-progress = 批量翻译进度：{ $done }/{ $total } 块
