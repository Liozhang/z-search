# z-search

[English](README.md) | **中文**

[![Release](https://img.shields.io/github/v/release/Liozhang/z-search?color=blue&logo=github)](https://github.com/Liozhang/z-search/releases)
[![CI](https://github.com/Liozhang/z-search/actions/workflows/ci.yml/badge.svg)](https://github.com/Liozhang/z-search/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Liozhang/z-search/total?color=orange)](https://github.com/Liozhang/z-search/releases)
[![Zotero 9 ~ 10](https://img.shields.io/badge/Zotero-9%20~%2010-CC6633.svg)](https://www.zotero.org/)

**学术搜索 · 网络搜索 · 仓库搜索 · 向量搜索 — 一站式 Zotero 搜索插件。**

z-search 是一个独立的 Zotero 插件，把图书馆内外的全部检索能力收进一个窗口：
外部学术数据库检索并一键导入文献库、网页搜索源管理、GitHub 仓库搜索、
基于本地/云端嵌入模型的库内向量与全文检索。结果卡直接内置期刊质量信息——
引用数、影响因子、JCR/中科院分区、顶刊、国际预警、掠夺性期刊标记，
全部来自随包分发的离线数据库，检索时零额外网络开销。

## 安装

1. 从 [Releases](https://github.com/Liozhang/z-search/releases) 下载最新
   `z-search.xpi`；
2. Zotero ▸ 工具 ▸ 插件 ▸ 右上角齿轮 ▸ Install Plugin From File，选择
   下载的 xpi；
3. 工具栏出现放大镜按钮即安装成功。已装用户经 update.json 自动升级。

## 检索结果卡

每条结果直接标注引用数、影响因子（黄字）、JCR 分区、中科院大类分区与
顶刊标记，命中国际预警名单或 Beall's 掠夺性期刊名单时以警示徽章标出；
检索词高亮、全文按需拉取、单条/批量导入都在同一张卡上完成。

![学术检索结果卡：引用数、影响因子、JCR/中科院分区、OA 标记](docs/screenshots/search-results-en.png)

## 功能

### 1. 学术检索（多源并联 + 期刊质量徽章）

- 并联检索 13 个学术源：OpenAlex、Semantic Scholar、Crossref、arXiv、
  bioRxiv、medRxiv、DOAJ、Zenodo、HAL、CORE、Europe PMC、PubMed、
  GitHub（除 medRxiv/DOAJ/Zenodo/HAL/GitHub 免 key 外，其余每源独立
  API key 可选配置）
- 渐进式检索：逐源并行发起，先到先上屏，慢源不拖累快源；状态条实时
  显示「X/N 源」进度，部分源失败显式提示，不谎报空结果
- 结果合并去重（DOI 归一化），支持按年份区间、作者、期刊、排序、上限
  等维度筛选
- 期刊质量徽章（离线内置库，随包分发、零网络开销）：
  - 引用数（各源口径不一，合并时取较大值）
  - 影响因子（黄字强调）与 JCR 分区——JCR 2024
  - 中科院大类分区、学科类别与顶刊标记——中科院分区表 2025
  - 国际预警名单、Beall's 掠夺性期刊名单（后者仅精确刊名命中才标记，
    徽章附名单截止时间，避免误伤）
- 单条导入 / 批量导入到 Zotero 文献库（无 DOI 条目走标题→DOI 回退解析），
  导入落到当前选中的分类（无则 My Library 根）
- 结果卡「全文」按钮：按需拉取单篇全文——PMC 开放获取 JATS XML 优先
  （DOI/PMID/PMCID 解析 + 正负缓存），开放获取网页兜底，内联展示
- 摘要翻译（默认 Google 免费端点，可切 AI / Bing / DeepL / 自定义引擎）
- 结果列表复制 / CSV 导出

### 2. 期刊指标卡（按刊名 / ISSN 查证）

输入刊名或 ISSN 即查单刊画像：JCR 影响因子与分区、中科院大类分区、
h 指数 / i10 指数 / 2 年篇均被引 / 发文量、收稿领域与创刊信息；
风险标记区直接给出国际预警与掠夺性名单命中——投稿前查刊、引用前排雷
都在同一处完成。另有「按领域发现」模式按研究方向检索期刊。

![期刊指标卡：本地命中 Beall's 名单的掠夺性标记](docs/screenshots/journal-metrics-en.png)

「按领域发现」模式以紧凑行列表呈现命中的期刊——刊名、ISSN、影响因子、
发文量与内联的 JCR/中科院分区徽章、顶刊星标——可按相关度、JIF、发文量、
h5 指数排序；点击任意行即钻取到该刊的完整指标卡。

![期刊发现模式：按领域关键字的行式列表，带分区徽章与排序 chips](docs/screenshots/journal-discover-en.png)

### 3. 网络搜索

- 13 个网页搜索源：DuckDuckGo、Bing(web)、Wikipedia、Archive.org（免 key），
  SearXNG、Tavily、Brave、Exa、Serper、SerpAPI、Google、Perplexity、Bing API
- 「启用并测试」管理面：单源真实搜索一次，失败分类（key 被拒 auth /
  网络不可达 unreachable / error），默认源设置，健康状态缓存
- 由 `WebSearchProvider` 统一调度，学术检索的综述扫描（review search）
  复用同栈

### 4. 仓库搜索

- GitHub 仓库检索（`api.github.com/search/repositories`，按 star 排序，
  可选 `created:` 年份窗），命中映射为统一文章结构进入学术检索流
- 支持个人 access token 提升速率限额

### 5. 向量搜索（库内检索）

- 库内语义检索：标题/摘要元数据向量 + PDF 全文分块向量两路，RRF 融合排序
- 全文关键词通道（BM25 + FTS）在向量不可用时自动降级，降级态在 UI 显式可见
- 找相似（find similar）、查重（duplicate scan）锚点工具，作用于 Zotero 主窗
  选中条目
- 嵌入后端双模：本地 ONNX（默认，Xenova/multilingual-e5-small，零配置）
  或 API 模式（接入 AI provider 的 embedding 模型）；模型切换自动标记 stale
  分块并可一键重建
- 索引构建带进度通知、跳过原因聚合、取消与看门狗
- 可选本地深度解析后端（opendataloader，需 Java 11+）：jar 不随包分发，
  手动放入插件安装目录 `core/pdf/lib/` 即启用；未配置时自动走基础文本
  抽取或 MinerU 远程 API

### 统一搜索页

一个输入框并联三条腿（库内语义 + 外部学术），DOI 去重后单一列表，
逐路引擎状态条（就绪/检索中/降级/出错各自结算，失败不谎报空结果），
窗口化结果列表 + 期刊搜索（JCR/CASS 指标、预警名单、掠夺性期刊名单、
发现模式）。

## 入口

- 工具菜单 ▸ 「打开搜索中心」打开搜索窗
- 条目右键菜单 ▸ 「查找相似文献」（选中恰好一个普通条目时可用）直达找相似
- 深链：`hubWindowManager.openHub("search")`

## 开发

架构说明、与上游 leadero 的移植裁剪、构建/测试/部署/发布流程见
[docs/development.md](docs/development.md)。

## 许可

MIT
