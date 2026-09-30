# 兄弟仓库回授优化清单（2026-09-30）

> **执行状态（2026-09-30 当日实施）**：第 1、2、3、4、5、7、8 项已完成并通过类型检查、单元测试与完整构建；第 6 项按文档原意（批量摘要翻译尚不存在）保持待办。各项实施要点见对应小节末尾的「已实施」注。
>
> **真机验证记录（2026-09-30，Zotero 10 / Windows 实机）**：新构建经 `npm run restart -- --allow-dirty` 部署到开发 profile。已实测通过：bootstrap `update`/`startup` 全流程无报错；三个新偏好默认值在实机可读（缓存开、200MB、截断 10000 字符）；`zsearch_pdf_vectors.sqlite` 随启动创建，`PdfChunkStore.initialize()` 与分块计数查询在真实库（557 行分块、模型 Xenova/multilingual-e5-small、零向量行）上执行正常；设置界面新控件（缓存开关、容量上限、截断上限）与三语文案已确认进入部署产物。会话期间 Zotero 发生过一次退出（崩溃转储 `%LOCALAPPDATA%/CrashDumps/zotero.exe.27868.dmp`，写于 12:16），三次启动的插件日志均无本插件错误，成因未能定位到具体环节；设置面板的目视核对与一次真实摘要翻译的点击验证因自动化工具无法驱动 Gecko 控制台输入而留待人工完成。
>
> **真机验证补充（同日第二轮，PowerShell 剪贴板 + 浏览器控制台路径）**：设置面板三控件目视核对通过（复检中发现两个数字输入框因缺 flex 约束塌缩为细条——已修复为与学术密钥行同款的 key-row 布局并复验）；面板输入框 DOM 值实测 10000/200。摘要翻译经 Hub 桥（`hubWin.__hubBridge.handleIframeMessage` 直驱真实 `literature.translate` 处理链）实测：首次译文 11843ms（Google 被墙 10s 超时后 Bing web 兜底成功），同文本二次调用 **3ms** 且译文逐字一致——持久缓存命中实证；`zsearch/translation-cache/v1/` 下生成两个分桶 JSON（identity `google|keyless`、语言对 auto→zh-CN、原文归一化存储）。验证还暴露并修复了一个**存量兼容性缺陷**：Zotero 10 引导沙箱不暴露 `AbortSignal` 全局，翻译引擎四处裸调 `AbortSignal.timeout` 使全部免密端点（Google 及其 Bing 兜底）在毫秒级直接抛 ReferenceError——已加 `timeoutSignal` 垫片（宿主 AbortSignal → AbortController 回退 → 无信号降级）并实测恢复。
>
> 背景：本仓库（z-search）与 z-transplit 均从 leadero 拆分而来。2026-09-30 完成了三仓的逐文件级交叉分析（能力清单、同源文件内容级差异、融合冲突面）。分析同时发现了**本仓库自身值得从两个兄弟仓库反向吸收的改进项**，记录于此。
>
> 完整分析主文档在 leadero 仓库：`D:/github_code/leadero/docs/zsearch-ztransplit-integration-analysis-2026-09-30.md`。本仓库的多项成果（健康检查回写、网络区域设置、期刊查询审计修复、引文钻取等）已被该文档列为 leadero 的融合来源，此处不重复；下文只列**本仓库待办**。

## 一、优先级高：正确性缺陷

### 1. 统一的 429 退避重试缺失（从 leadero 搬）

**证据**：leadero 的 `src/core/search/WebSearchProvider.ts` 有 `requestWithRateLimit(source, doRequest)` 包装器（2026-09-28 审计加入）：覆盖 Zotero.HTTP 两种 429 形态（拒绝式带状态与响应头、 resolve 式非 2xx）；优先读重试间隔响应头（间隔大于 120 秒直接终态返回，不塞进 300 秒总闸）；无头时 5 秒退避加抖动；单次重试；限流专门文案。配套 `src/utils/rateLimit.ts`（间隔解析、退避延迟、错误文案）。

**本仓库现状**：tavily、serper 等密钥源的调用是裸 `Zotero.HTTP.request`，429 直接冒泡成工具失败（leadero 的审计注释明言其 serper/tavily 此前零处理，本仓库同源继承了这个缺口）。

**处理**：搬 `src/utils/rateLimit.ts` + `requestWithRateLimit` 包装器，逐源套用。工作量小。

> **已实施**：`src/utils/rateLimit.ts` 与单测搬入；包装器套用到全部 8 个密钥源（serpapi、brave、tavily、google、serper、perplexity、exa、bing）。

### 2. 思考型模型返回空译文的风险（从 z-transplit 搬）

**证据**：z-transplit 于 2026-09 实测发现：输出配额按「文本长度乘 2、上限 4000 token」推导时，思考型模型（实测 StepFun step-3.7-flash，37 字符选区）把配额耗在内部推理上，`finish_reason=length`、返回内容为空。修复为输出下限 4096（`MODEL_OUTPUT_FLOOR_TOKENS`）、单次上限 8192（`SINGLE_OUTPUT_MAX_TOKENS`）、批输出默认上限 16384。

**本仓库现状**：本仓库的 `src/core/translation/translationEngines.ts` 与 leadero 的对应路径同源（仅 64 行实质差异，不含此修复），AI 引擎的摘要翻译路径存在同样风险。**搬运前先核对**本仓库该路径的输出配额推导逻辑。

**处理**：对照 z-transplit 的 `translateWithAI/translateWithCustom` 修订版搬入下限与上限常量。工作量小。

> **已实施**：`MODEL_OUTPUT_FLOOR_TOKENS`（4096）/`SINGLE_OUTPUT_MAX_TOKENS`（8192）常量搬入，应用于三处长度推导位（`translateWithCustom`、`createAITranslator`、批量逐段回退）；批量合并调用用模型声明上限，非长度推导，不需改动。

## 二、优先级中：健壮性与存储架构

### 3. PDF 分块向量外置独立数据库（从 leadero 搬）

**证据**：leadero 于 2026-09-29（架构评审 #34 用户裁决）把分块向量从主库表列外置到独立文件 `leadero_pdf_vectors.sqlite`——Zotero 每周期备份并整理主库，大二进制数据放主库代价大；外置带惰性迁移路径（读旧列 → 写外置 → 字节校验 → 清空旧列）。

**本仓库现状**：`src/core/search/PdfChunkStore.ts` 的向量仍内联在主库 `zsearch_pdf_chunks` 表列中。这是三仓对比中**本仓库唯一落后于 leadero 的存储布局点**（嵌入向量库 `zsearch_embeddings.sqlite` 本身已是外置的，此点仅指分块向量）。

**处理**：以 leadero 的 `PdfChunkStore.ts` 外置布局为准改造，惰性迁移复用 leadero 已实现路径。工作量中。

> **已实施**：向量真身移入 `zsearch_pdf_vectors.sqlite`（`chunk_id` 主键）；`storeChunks` 主库一律落 4 字节哨兵、提交后写外置、失败补偿删除；读路径经 `fetchVectorsByIds` 统一供给，存量内联向量惰性迁移（读旧列 → 写外置 → 字节校验 → 清空旧列）；三个删除路径同步清理外置行。leadero 后续的 v2 整表重建（哨兵列退役）未搬——本仓库保留 embedding 列做惰性迁移落点，属两版布局间的过渡形态。

### 4. 摘要翻译的截断保护与配额错误分类（从 leadero 搬）

**证据**：leadero 的摘要翻译通道带三件本仓库没有的能力：长度截断加截断标记透传（`translate.maxChars` + `truncated` 回执字段）、配额/限流/计费类错误统一分类为可操作错误码（`ai-quota-exceeded`）、机器翻译引擎名透传（防配额错误被误判为 AI 配额问题）。

**本仓库现状**：`literature.translate` 直接 `createTranslator`，无截断保护——超长摘要按原文全量发送，配额类错误以原始形态返回。

**处理**：对照 leadero 的 `apiKnowledgeGroup.ts` 翻译段（240–260 行附近）搬入三件能力。工作量小。

> **已实施**：`literature.translate` 加入 `translate.maxChars`（默认 10000，≤0 不限长）截断与 `truncated` 回执；错误分类为 `ai-quota-exceeded` / `ai-not-configured`，MT 引擎名开头（含本仓库的 Custom API 形态）原样透传；界面侧透传 `truncated` 并显示黄色提示（三语文案齐备）。

## 三、优先级低：可选增强

### 5. 跨会话持久翻译缓存（从 z-transplit 搬）

z-transplit 的 `src/core/translation/translationCache.ts`（325 行）：内容寻址键（哈希含引擎身份、语言对、归一化文本——空白折叠避免软换行未命中）、数据目录下分片小文件（无锁、单文件损坏按未命中跳过）、默认 200MB 上限启动修剪。本仓库的摘要翻译只有会话内内存缓存（500 条），对重复检索同一批文献的场景，接入持久缓存可减少对有额度限制引擎的消耗。工作量中。

> **已实施**（用户裁决）：`translationCache.ts` 搬入（目录 `zsearch/translation-cache/v1`）；新增 `engineCacheIdentity()` 引擎指纹（本仓库 AI 引擎指纹解析后的模型号）；`literature.translate` 接入读命中直返、成功后异步写入；启动钩子按 `translate.cache.maxSizeMB`（默认 200）修剪。缓存开关 pref `translate.cache.enabled`（默认开）。

### 6. 批量翻译四级降级与预算自校准（从 z-transplit 搬）

z-transplit 的批翻译：结构化批输出 → 最多三次手动解析重试（部分网关对 response_format 返回 400，重试时去掉该参数）→ 逐段 → 保留原文标失败；数组条数与输入不符也计入重试预算并产出诊断；字符与 token 比率的指数移动平均自校准（初始 2.5、限幅 1 到 6——中文的低估会触发接口拒包）；每批 5 分钟总超时加 2 分钟空闲超时。若本仓库未来扩展批量摘要翻译，此设计可直接吸收。工作量中。

> **保持待办**：本仓库当前无批量摘要翻译功能，按文档原意不动。

### 7. 结构校验的正控自测思想（从 z-transplit 学）

z-transplit 的 `scripts/qa/structure-check-selftest.mjs`：用 1 个完好插件加 25 个各带一种缺陷的坏插件对照测试自己的结构校验器——「无正控的校验器不能证明自己能抓问题」。本仓库的校验类脚本（构建链、多语言守卫）可参照补充正控用例。工作量小。

> **已实施**（用户裁决）：多语言守卫的死键判定抽为 `computeDeadKeys` 纯函数（真实守卫与自测共用同一函数对象），新增正控用例四组对照：无引用键必判死、三种引用形态必判活、动态前缀豁免生效、正则元字符键不漏检。

### 8. 显式传入 auto 源语言时的 Bing 网页端映射（与 z-transplit 互补）

本仓库的 `detectBingSourceLang` 解决了「调用方不传源语言」的场景（按 Unicode 区段判定）；z-transplit 的修复是「显式传 `auto` 时映射为 `auto-detect`」。两个解法覆盖不同入口，若本仓库将来有调用方显式传 `auto`，需补 z-transplit 的映射。工作量极小。

> **已实施**：`toBingWebLang` 对显式 `auto` 映射为 `auto-detect`（线上 ttranslatev3 拒绝 `auto`），主入口的 `detectBingSourceLang` 路径不变。

## 四、已被 leadero 采纳的本仓库能力（备查）

以下能力已列入 leadero 的融合计划（详见其主文档），后续 leadero 侧改造若与本仓库继续同源演化，值得保持三边同步：健康检查结果回写与判罚失效、源管理失败四分类、网络区域设置全套（`region.ts` 与 42 个测试）、期刊查询服务十一项审计修复、条目树期刊指标列、easyScholar 中文核心、引文钻取通道与弹窗、导入目标选择器与幂等防重、开放获取 PDF 自动挂附件、字段级合并与累积不切片、宿主包冒烟测试、SQL 绑定参数分块工具、发布工程三件（CHANGELOG 截取发布说明、全量克隆、update.json 链路）。
