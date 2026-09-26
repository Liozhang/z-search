# z-search 社区推广贴（草稿）

> 用途：Zotero 官方论坛（forums.zotero.org）发布 + 中文社区（Zotero 中文站、
> 知乎等）分发。英文贴为论坛主贴；中文版供中文社区直接粘贴。
> 发布前检查清单见文末。

---

## 英文版（forums.zotero.org）

**标题：**

> Announcing z-search — an all-in-one search hub for Zotero (academic · web · repository · in-library vector)

**正文：**

Hi everyone!

I'd like to share a plugin I've been working on: **z-search**, an open-source
(MIT) search hub that puts most of the searching you do around your library
into a single window — https://github.com/Liozhang/z-search

**What it does**

- **Academic search** — queries 13 scholarly sources in parallel (OpenAlex,
  Crossref, arXiv, Semantic Scholar, PubMed/Europe PMC, bioRxiv/medRxiv, DOAJ,
  Zenodo, HAL, CORE, GitHub) and merges the results into one deduplicated
  list. Sources run concurrently and render as they arrive, so a slow or
  blocked source never holds up the rest. Several sources work without any API
  key; adding keys (all optional) unlocks more.
- **Journal quality badges, fully offline** — every result card shows citation
  count, impact factor, JCR quartile (JCR 2024), CAS major-category quartile
  and top-journal flag (CAS partition table 2025), and flags hits against the
  international warning list and Beall's predatory-journal list (exact name
  match only, with the list's cutoff date on the badge). All of this ships
  inside the plugin — no extra network requests at search time, and no per-item
  lookups.
- **Journal lookup & discovery** — enter a journal name or ISSN for a full
  profile (metrics, quartiles, risk flags, OpenAlex stats), or discover
  journals by research field.
- **One-click import** — single or batch import into your library (DOI
  dedup, title→DOI fallback for keyless entries), into the selected
  collection. Copy/CSV export included.
- **Full text on demand** — open-access full text (PMC JATS XML first, OA page
  fallback) rendered inline from the result card, plus abstract translation.
- **Web search** — 13 general web sources (DuckDuckGo, Wikipedia, Archive.org
  etc., no key needed) with a built-in "enable & test" panel that classifies
  failures per source.
- **In-library vector search** — semantic search over your own library
  (metadata + PDF full-text chunks, local ONNX embeddings by default — nothing
  leaves your machine), with keyword fallback, find-similar, and duplicate
  scan. Works in English and Chinese.

The UI is available in English and Chinese and follows Zotero's language
setting.

**Install:** grab `z-search.xpi` from the releases page
(https://github.com/Liozhang/z-search/releases), then Zotero ▸ Tools ▸
Plugins ▸ gear menu ▸ Install Plugin From File. Requires Zotero 9 or 10.
Installed copies update automatically via the update manifest.

**Honest caveats:** source coverage varies by network (some providers are
unreachable from some regions — the status bar tells you exactly which sources
ran, failed, or were skipped rather than pretending to an empty result); the
vector index needs a one-time build pass over your library.

Screenshots (real searches, English UI): see the README at
https://github.com/Liozhang/z-search#readme

Feedback is much appreciated — bug reports and feature requests are best
filed at https://github.com/Liozhang/z-search/issues (I'm more responsive
there than on the forum). If you find the plugin useful, a star on the repo
helps others find it too.

---

## 中文版（Zotero 中文社区 / 知乎 / 公众号）

**标题：**

> z-search：一个窗口搜所有——Zotero 学术/网页/仓库/库内向量检索插件（含期刊质量徽章）

**正文：**

大家好，分享一个我开发的 Zotero 检索插件 **z-search**（开源，MIT 协议）：
把围绕文献库的大部分检索收进一个窗口。

**核心功能**

- **学术检索**：并行查询 13 个学术源（OpenAlex、Crossref、arXiv、Semantic
  Scholar、PubMed/Europe PMC、bioRxiv/medRxiv、DOAJ、Zenodo、HAL、CORE、
  GitHub），结果合并去重为单一列表；逐源并发、先到先上屏，慢源或被墙源不
  拖累其余。多数源免 API key 直接可用，其余按需配置（全部可选）。
- **期刊质量徽章（离线内置）**：结果卡直接标注引用数、影响因子、JCR 分区
  （2024）、中科院大类分区与顶刊标记（2025 分区表）、国际预警名单与
  Beall's 掠夺性期刊命中（仅精确刊名，徽章附名单截止时间）。全部数据随包
  分发——检索时零额外网络请求，无需逐条在线查询。
- **期刊查证与发现**：按刊名/ISSN 查单刊完整画像（指标、分区、风险标记、
  OpenAlex 统计），或按研究方向发现期刊。
- **一键导入**：单条/批量导入文献库（DOI 去重、无 DOI 条目标题→DOI 回退
  解析），落到当前选中分类；支持复制与 CSV 导出。
- **按需全文**：开放获取全文（PMC JATS XML 优先、OA 网页兜底）卡内内联
  阅读，附摘要翻译。
- **网页搜索**：13 个通用网页源（DuckDuckGo、Wikipedia、Archive.org 等免
  key），带「启用并测试」管理面，逐源诊断失败原因。
- **库内向量搜索**：对自己库做语义检索（元数据 + PDF 分块，默认本地 ONNX
  嵌入——数据不出机器），关键词降级兜底，含找相似与查重。中英文文献均
  支持。

界面提供中英双语，跟随 Zotero 语言设置。

**安装**：从 Releases 下载 `z-search.xpi`
（https://github.com/Liozhang/z-search/releases）→ Zotero ▸ 工具 ▸ 插件 ▸
齿轮 ▸ Install Plugin From File。支持 Zotero 9 / 10；已装用户经 update.json
自动升级。

**如实说明**：各源可达性随网络环境而异（部分源在某些地区不可达——状态条
会明确列出哪些源成功、失败或跳过，不会谎报空结果）；向量检索需对库做一次
索引构建。

实测截图与文档：https://github.com/Liozhang/z-search#readme

欢迎反馈——bug 与功能建议请到
https://github.com/Liozhang/z-search/issues 提 issue（比论坛回帖更及时）。
觉得有用的话，给仓库点个 star 能帮更多人看到。

---

## 发布渠道与检查清单

| 渠道                                          | 说明                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| forums.zotero.org                             | 主贴渠道。发在 General 版（论坛无独立插件发布版）；标题用上面的英文标题           |
| zotero.org/plugins 官方插件目录               | 提交收录（要求开源、GitHub Releases 提供 xpi、update.json——本插件已具备）         |
| r/Zotero (reddit)                             | 可同文转发，语气可稍口语化                                                        |
| Zotero 中文站 (zotero-chinese.com) / 中文社区 | 用中文版；中文站有插件收录页可提                                                  |
| 知乎 / 公众号                                 | 中文版 + 三张截图（search-results-en / journal-metrics-en / journal-discover-en） |

发布前确认：

- [ ] Releases 页最新版本与正文描述的功能一致（徽章、发现模式等均已随 v1.0.2 发布）
- [ ] 三张 README 截图为英文界面（已就位）
- [ ] GitHub 仓库的 About 栏填一句话简介 + topics（zotero, zotero-plugin, academic-search）
- [ ] 论坛发帖后自己的账号订阅该主题，及时回帖
- [ ] 首贴避免与后续更新混楼：后续版本更新用同贴回帖（论坛惯例），不发新贴
