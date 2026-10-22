/**
 * domainTypes — 学术子域搜索的统一结果形状与域定义。
 *
 * 域注册框架（DomainSearchEngine + DomainRegistry）的核心契约：五个子域
 * （patent / dataset / researcher / grant / oa-fulltext）共享同一套通用字段，
 * 各域通过 DomainDef 声明自己的源、去重键、富集钩子和 Zotero itemType 映射。
 *
 * 与 literature.search 的关系：通用字段（title/url/source/dedupKey）与
 * ArticleResult 对齐，使现有 mergeExternalArticles / markInLibrary 逻辑可
 * 直接复用；域特定字段通过可选属性扩展，不污染通用路径。
 *
 * @module core/search/domainTypes
 */

/** 通用搜索结果形状（所有域共有，对齐 ArticleResult 的通用子集）。 */
export interface DomainResult {
  title: string;
  url: string;
  snippet?: string;
  /** 源站 id（如 "epo" / "google-patents" / "huggingface" / "zenodo"） */
  source: string;
  /** 源站内部 ID（用于跨源去重与 profile 下钻） */
  sourceId: string;
  year?: string;
  /** 去重键：DOI / 归一化专利号 / ORCID / 基金号 / 源 ID（由 DomainDef.dedupKey 计算） */
  dedupKey: string;
  /** 已在 Zotero 库中（markInLibrary 写入） */
  inLibrary?: boolean;

  // ── 域特定字段（可选，按 DomainDef 声明的卡片 schema 填充）──

  // 论文/数据集
  doi?: string;
  // 专利（归一化号，如 "us-9999999-b2"）
  patentNumber?: string;
  // 研究者
  orcid?: string;
  // 基金
  grantId?: string;
  // 数据集/基金金额等（通用"数值"位，卡片按域读取）
  metrics?: Record<string, number | string>;

  /** 富集后的附加字段（域 enricher 写入，如 IPC/CPC、license、benchmark） */
  extra?: Record<string, any>;
}

/** 域特定筛选器（各域在 DomainDef.filters 中声明支持的键）。 */
export interface DomainFilters {
  /** 年份范围 "2020-2024"（专利/数据集/基金） */
  year?: string;
  /** 国家/地区（专利/基金） */
  country?: string;
  /** OA 类型（数据集） */
  oaType?: string;
  /** 许可证（数据集） */
  license?: string;
  /** 任务标签（数据集） */
  taskTags?: string[];
  /** 机构类型（研究者） */
  institutionType?: string;
  /** 资助机构（基金） */
  agency?: string;
  /** 金额范围（基金） */
  amount?: string;
  /** IPC 分类（专利） */
  ipc?: string;
  /** 法律状态（专利） */
  legalStatus?: string;
  /** 临床试验状态（recruiting/completed/terminated） */
  status?: string;
}

/** 域搜索选项。 */
export interface DomainSearchOptions {
  query: string;
  maxResults?: number;
  filters?: DomainFilters;
  abortSignal?: AbortSignal;
}

/** 域定义：注册框架中每个子域的声明式描述。 */
export interface DomainDef {
  /** 域 id：patent / dataset / researcher / grant / oa-fulltext */
  id: string;
  /** 域 label（不翻译，进 FTL 的 brand 词） */
  label: string;
  /** 支持的源 id 列表（对应源适配器 registry） */
  sources: string[];
  /** 计算去重键（返回 "" 表示不参与去重） */
  dedupKey: (r: DomainResult) => string;
  /** 导入为 Zotero 的 itemType */
  importItemType: string;
  /** 富集钩子：对结果数组原地写回 extra（best-effort，吞错） */
  enrich?: (results: DomainResult[]) => Promise<void>;
  /** 该域特有的 key 配置（如 EPO consumer key），用于源管理 UI */
  fields?: Array<{
    key: string;
    prefKey: string;
    label: string;
    secret?: boolean;
  }>;
  /** 导入时的 Extra 字段写入（域特定键 → 值的映射函数） */
  buildExtraFields?: (r: DomainResult) => Record<string, string>;
}

/** 单次域搜索的元数据（对齐 PipelineResult.metadata 的可观测性口径）。 */
export interface DomainSearchMetadata {
  totalSearched: number;
  totalReturned: number;
  /** 完全失败的源名单（跨源聚合，对齐 literature.search 的 failedSources） */
  failedSources: string[];
  /** 源 → 失败原因码（timeout/network/rate-limited/http/auth） */
  failedReasons: Record<string, string>;
  /** 缺 API Key 未发起请求的源名单 */
  skippedNoKey: string[];
}
