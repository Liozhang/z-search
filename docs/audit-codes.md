# 审计编号对照表

> 本表由脚本从 `src/` 代码注释自动提取（2026-10-11），每个编号摘录仓库内
> 现存的一到两条代表性注释原文与出处。编号本身产生于过往审计会话，完整
> 审计报告多数未随仓库保存（见文末「失效文档引用」）；修改对应代码前请
> 先读懂注释里描述的约束本身，不要只看编号。

## C-1（14 处引用）

- `src/core/data/BeallsListStore.ts:605` — Clear rows from a single table. C-1: scoping is via structured filters
- `src/core/data/BeallsListStore.ts:679` — C-1: bound parameters via structured filters; row cap matches the

## C-2（2 处引用）

- `src/utils/agentErrors.ts:6` — 位置（C-2，2026-09-16 第四轮审计 R4 §5.1）：本件原住编排域 core/agent/，
- `src/utils/agentErrors.ts:8` — （buildHttpError）反向 import——通用「HTTP 错误原语」住在编排层是 C-2 的错置。

## C-3（2 处引用）

- `src/bridge/localeBatch.ts:94` — 2026-09-16 C-3 批：tracking.ftl（与 utils/locale.ts 的 initLocale 清单同步）
- `src/utils/locale.ts:17` — 2026-09-16 起 FTL 按主题拆文件（C-3 批新建 tracking.ftl）：新文件必须

## C-7（1 处引用）

- `src/utils/constants.ts:29` — note-creation paths can read it without importing `src/modules/**` (C-7);

## C-10（2 处引用）

- `src/utils/agentErrors.ts:9` — 故与 C-1/C-10 同法下沉至横切 utils/（只依赖同层 truncate/error）。语义零改：
- `src/utils/http.ts:24` — citation/RefWorksStore），即 tool 适配层已事实上成了共享基础设施层。故与 C-10 的

## E-04（1 处引用）

- `src/utils/sqlBatch.ts:7` — 已确认 5 处实越界（E-04~E-08）。

## E-05（2 处引用）

- `src/core/data/utils/crud.ts:254` — 2026-09-10（E-05）：原按**行数**分块（每块 SAFE_BATCH_SIZE 行），但每行贡献
- `src/utils/sqlBatch.ts:10` — `Math.floor(SAFE_BATCH_SIZE / columns.length)`（那正是 E-05 写错的地方：它按

## E-06（1 处引用）

- `src/core/data/utils/crud.ts:498` — 2026-09-10（E-06）：原用「插入前后各一次全表 COUNT(*)」求 delta，upsert

## E-07（3 处引用）

- `src/core/data/utils/crud.ts:267` — E-07 注释）。这些行最终归入 insert 桶，与上面的过滤一致。
- `src/core/data/utils/crud.ts:350` — 2026-09-23（E-07）：Zotero 的 db.js parseQueryAndParams 拒绝把 NULL 绑进

## E-08（1 处引用）

- `src/utils/sqlBatch.ts:7` — 已确认 5 处实越界（E-04~E-08）。

## G-03（1 处引用）

- `src/core/pdf/OpenDataLoaderPdfClient.ts:26` — 每次 PDF 解析刷十几行 "[z-search ODL]"（2026-09-10 审计 G-03）。

## G-05（3 处引用）

- `src/core/data/utils/filters.ts:89` — 2026-09-10（审计 G-05）：`in` 取值只校验了类型，没有校验**个数**。
- `src/core/utils/VersionedStore.ts:118` — 2026-09-10（审计 G-05）：tableNames 由子类给出，签名无上界 —— 显式设界。

## L-22（2 处引用）

- `src/core/pdf/OpenDataLoaderPdfClient.ts:220` — L-22: a developer-machine path ("D:\IGV_2.17.3\jdk-17\bin\java.exe") used
- `src/core/pdf/OpenDataLoaderPdfClient.ts:520` — L-22: the old developer-machine path (a repo-local absolute path from

## L-23（1 处引用）

- `src/core/translation/translationEngines.ts:740` — L-23: fold the model + API-key fingerprint into the cache key —

## L-25（1 处引用）

- `src/core/pdf/OpenDataLoaderPdfClient.ts:1015` — L-25: images with the same alt text used to overwrite each other (map is

## L-26（1 处引用）

- `src/core/pdf/OpenDataLoaderPdfClient.ts:1116` — L-26: an inverted range used to fall through silently and parse the

## L-27（1 处引用）

- `src/core/pdf/MinerUApiClient.ts:305` — L-27: the cloud path polls with a 5-minute ceiling and the health check

## L-28（2 处引用）

- `src/core/pdf/OpenDataLoaderPdfClient.ts:638` — L-28: hard-timeout handle, cleared whenever the run settles early.
- `src/core/pdf/OpenDataLoaderPdfClient.ts:783` — L-28: captured so finish()/failure paths can clearTimeout — a

## L-31（1 处引用）

- `src/react/utils/locale.ts:107` — L-31: function-form replacer — String.replace treats `$&`, `$'`, `$\``

## P0-1（9 处引用）

- `src/core/search/runFullLibraryBuild.ts:5` — 职责（2026-09-25 审计 P0-1 起）：跑**两段**索引构建 + 通过 notify 回调发
- `src/core/sources/academic-search/crossref.ts:18` — 默认「近10年」被压成单下限年（2026-09-25 审计 P0-1）。

## P0-2（9 处引用）

- `src/core/search/JournalSearchService.ts:636` — （"0028-0836"），裸 get 恒 miss（审计 P0-2）
- `src/core/sources/academic-search/crossref.ts:40` — "cited" 直传会 HTTP 400，Crossref 源静默归零（2026-09-25 审计 P0-2）

## P0-3（12 处引用）

- `src/core/search/JournalSearchService.ts:336` — 界面语言取值、全缺时 ⚠ 兜底（审计 P0-3 / P2-5）
- `src/core/search/JournalSearchService.ts:671` — 语言取值（同 composeMetric 口径，审计 P0-3 / P2-5）

## P0-4（3 处引用）

- `src/hooks/servicesInit.ts:324` — 工具栏按钮显隐的即时同步（设置面板写 pref 后直调；P0-4）。必须静态
- `src/react/components/Hub/search/mergeResults.ts:158` — （2026-09-25 审计 P0-4——「日期」排序曾让结果区整体崩溃）。 */

## P1-1（4 处引用）

- `src/hooks/windowLifecycle.ts:33` — 条目树期刊徽章列（P1-1）：ItemTreeManager 全局一列，逐窗引用计数——
- `src/modules/itemTreeMetricsColumn.ts:2` — itemTreeMetricsColumn — 主窗条目树的期刊质量徽章列（P1-1）。

## P1-2（2 处引用）

- `src/core/search/PdfChunkIndexer.ts:468` — 直接 fast-skip「已处理 0」，索引永远停在部分状态（审计 P1-2）。
- `src/react/components/Hub/search/mergeResults.ts:77` — 字段级合并（2026-09-25 审计 P1-2）：同一作品跨源命中时后到源不再整条

## P1-3（4 处引用）

- `src/modules/menuManager.ts:64` — note/附件/无选中时禁用而非点了以后静默无结果（2026-09-25 审计 P1-3）
- `src/react/components/Hub/search/LiteratureSearchPage.tsx:261` — 右键菜单「查找相似文献」深链（2026-09-25 审计 P1-3）：宿主经

## P1-4（10 处引用）

- `src/core/data/EasyScholarClient.ts:2` — EasyScholarClient — 中文核心期刊标识的可选数据源（P1-4）。
- `src/core/search/JournalSearchService.ts:193` — （2026-09-25 审计 P1-4）。落空的增强数据下次查询走缓存路径。

## P1-5（3 处引用）

- `src/core/search/JournalSearchService.ts:316` — ——卡片会拼出 lit-quartile-jcr-q/A 这类裸 locale key（审计 P1-5）
- `src/core/search/literatureSearchHelpers.ts:93` — （lit-quartile-jcr-q/A，审计 P1-5）

## P1-6（3 处引用）

- `src/core/search/JournalSearchService.ts:152` — 重叠(0.7)模糊层误报率高，不足以给单本期刊定罪（审计 P1-6）
- `src/core/search/JournalSearchService.ts:622` — 路径的裁决，审计 P1-6）。

## P1-7（2 处引用）

- `src/core/data/WarningListStore.ts:62` — 取决于物理行序（审计 P1-7）
- `src/core/tool/builtin/handlers/academic-search/index.ts:463` — DOI 归一化去重（审计 P1-7）：OpenAlex 主搜索回填 https://doi.org/

## P1-8（3 处引用）

- `src/core/search/JournalSearchService.ts:107` — （对齐 discover 路径的 P1-8 口径），不再谎报「未找到该期刊」。
- `src/react/components/Hub/search/JournalSearch/JournalSearchDashboard.tsx:150` — 服务侧错误（如 OpenAlex 断网）与「无结果」分流（审计 P1-8）；

## P1-9（3 处引用）

- `src/hooks/servicesInit.ts:109` — 数据集导入失败旗（审计 P1-9）：此前只写 debug 日志，用户在期刊页只见
- `src/react/components/Hub/search/JournalSearch/JournalSearchDashboard.tsx:52` — 内置期刊数据集导入失败旗（审计 P1-9）：启动导入挂掉时提示用户数据

## P2-1（3 处引用）

- `src/core/data/OpenAlexJournalCacheStore.ts:39` — on read（审计 P2-1：陈旧行此前永不清理，表无限增长）.
- `src/core/sources/academic-search/europe-pmc.ts:75` — Europe PMC 结果的分区/IF 徽章恒缺失（审计 P2-1）

## P2-2（3 处引用）

- `src/core/data/JCRStore.ts:130` — 审计 P2-2：双空格/前后空格输入此前只有另两家能命中).
- `src/core/search/WebSearchProvider.ts:44` — 启用清单参与选择（审计 P2-2）：管理面勾选的 addedSources 应实际

## P2-3（4 处引用）

- `src/core/search/JournalSearchService.ts:480` — 计数诚实化（审计 P2-3）：无分页，展示数即返回列表长度——OpenAlex 的
- `src/react/store.ts:18` — P2-3：显式取全局（裸标识符在桩未安装的 realm 会抛 ReferenceError）；

## P2-4（6 处引用）

- `src/core/search/JournalSearchService.ts:388` — JIF 排序的取样放宽（审计 P2-4）：OpenAlex 排不了 JIF，若只取按
- `src/core/search/JournalSearchService.ts:509` — （名称精确查 JCR 表，前 50 条），让 JIF 排序真正有数可排（审计 P2-4）

## P2-5（5 处引用）

- `src/core/search/JournalSearchService.ts:51` — 预警级别按界面语言取值（审计 P2-5）：en 界面优先 warning_level_en
- `src/core/search/JournalSearchService.ts:336` — 界面语言取值、全缺时 ⚠ 兜底（审计 P0-3 / P2-5）

## P2-6（5 处引用）

- `src/core/search/JournalSearchService.ts:223` — （审计 P2-6：warning/bealls-only 命中此前阻断了 JCR/CASS 复探）。
- `src/core/sources/academic-search/github.ts:87` — 星数与被引是两种语义（审计 P2-6）：不再让星数冒充「被引 N」，

## P2-7（2 处引用）

- `src/core/tool/builtin/handlers/items/citations/doiLookup.ts:106` — year（审计 P2-7）：已知发表年时取前 5 候选，优先选年份吻合者——纯
- `src/ui/hub/HubLiteratureHandler.ts:557` — 标题→DOI 解析并行化（审计 P2-7）：串行最坏 63s/条，批量 120s RPC

## P2-8（1 处引用）

- `src/react/components/Hub/search/LiteratureSearch/useLiteratureSearch.ts:767` — 导出/复制清单的数据集（审计 P2-8）：有勾选时作用于选中集（与同行

## R8-B（1 处引用）

- `src/core/ai/XhrWireMiddleware.ts:510` — 导出仅供 wire 快照一致性测试（tests/eval/xhrwire-snapshot.test.ts，R8-B）：

## UX-M23（3 处引用）

- `src/react/components/Hub/search/JournalSearch/JournalSearchDashboard.tsx:82` — UX-M23: elapsed-seconds ticker for the loading state. The journal handler
- `src/react/components/Hub/search/LiteratureSearch/useLiteratureSearch.ts:60` — UX-M23: elapsed-seconds ticker + requested-source count for the loading

## UX-M25（3 处引用）

- `src/react/components/Hub/search/LiteratureSearchPage.tsx:884` — {/* UX-M25: refresh overlay — previous results stay visible, greyed
- `src/react/components/Hub/search/LiteratureSearch/useLiteratureSearch.ts:183` — UX-M25（渐进变体）：旧结果保留（灰显于刷新条之后）直到第一批新结果

## UX-M32（3 处引用）

- `src/react/components/Hub/search/LiteratureSearch/useLiteratureSearch.ts:8` — and the UX-M32 export actions (copy list / CSV). Purely presentational
- `src/react/components/Hub/search/LiteratureSearch/useLiteratureSearch.ts:43` — UX-M32: RFC-4180 escaping for CSV cell values. */

## UX-M41（2 处引用）

- `src/react/components/Hub/search/LiteratureSearchPage.tsx:1076` — {/* UX-M41: windowing — reveal the next slice on demand. */}
- `src/react/components/Hub/search/LiteratureSearch/useLiteratureSearch.ts:34` — UX-M41: windowing page size for the results list (module const: stable dep). */

## 失效文档引用（代码引用了但仓库中不存在）

以下文档被代码注释引用，但未随仓库保存——编号与 `§` 章节号因此无法追溯。
若本地仍有底稿，建议补交到 `docs/`；若已遗失，请改写引用处注释为自包含描述。

- `CLAUDE.md`
- `docs/audit-full-2026-09-10.md`
- `docs/component-audit-2026-08-14.md`
- `docs/search-recall-diagnosis-2026-09-16.md`
- `docs/security.md`
