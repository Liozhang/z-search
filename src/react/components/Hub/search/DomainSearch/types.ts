/**
 * DomainSearch types — 学术子域搜索（专利/数据集）的前端共享类型。
 *
 * 与后端 DomainResult 对齐（src/core/search/domainTypes.ts），前端 React
 * 侧通过 domain.search RPC 拿到这些结果并渲染卡片。
 *
 * @module react/components/Hub/search/DomainSearch/types
 */

/** 域搜索结果（对齐后端 DomainResult）。 */
export interface DomainResult {
  title: string;
  url: string;
  snippet?: string;
  source: string;
  sourceId: string;
  year?: string;
  dedupKey: string;
  inLibrary?: boolean;
  doi?: string;
  patentNumber?: string;
  orcid?: string;
  grantId?: string;
  metrics?: Record<string, number | string>;
  extra?: Record<string, any>;
  /** 多源命中时的源归属并集（后端去重时写入） */
  sources?: string[];
}

/** 域搜索元数据（对齐后端 DomainSearchMetadata）。 */
export interface DomainSearchMetadata {
  totalSearched: number;
  totalReturned: number;
  failedSources: string[];
  failedReasons: Record<string, string>;
  skippedNoKey: string[];
}

/** 域搜索响应。 */
export interface DomainSearchResponse {
  articles: DomainResult[];
  totalSearched: number;
  totalReturned: number;
  failedSources: string[];
  failedReasons: Record<string, string>;
  skippedNoKey: string[];
}

/** 支持的学术子域（Phase 1-3）。 */
export type DomainId = "patent" | "dataset" | "researcher" | "grant";

/** 数据集学科分组（用户先选学科，再在该学科的源中检索）。 */
export interface DatasetDiscipline {
  id: string;
  labelKey: string;
  /** 该学科下的源 id 列表（对应 DomainSearchEngine 注册的适配器） */
  sources: string[];
  /** 该学科支持的高级查询字段（前端据此渲染筛选器） */
  filters: DatasetFilterDef[];
}

/** 高级查询字段定义。 */
export interface DatasetFilterDef {
  key: "year" | "license" | "oaType" | "taskTags" | "country" | "status";
  labelKey: string;
  /** 控件类型 */
  type: "year-range" | "select" | "multi-select";
  /** select / multi-select 的选项（可选，缺省由后端源能力决定） */
  options?: Array<{ value: string; labelKey: string }>;
}

/** 数据集学科分组列表。 */
export const DATASET_DISCIPLINES: ReadonlyArray<DatasetDiscipline> = [
  {
    id: "general",
    labelKey: "domain-discipline-general",
    sources: ["zenodo", "figshare", "dataverse", "osf", "dryad"],
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
      { key: "license", labelKey: "domain-filter-license", type: "select" },
      { key: "oaType", labelKey: "domain-filter-oa", type: "select" },
    ],
  },
  {
    id: "ml",
    labelKey: "domain-discipline-ml",
    sources: ["huggingface", "kaggle", "uci", "openml"],
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
      { key: "taskTags", labelKey: "domain-filter-task", type: "multi-select" },
      { key: "license", labelKey: "domain-filter-license", type: "select" },
    ],
  },
  {
    id: "life-science",
    labelKey: "domain-discipline-life-science",
    sources: ["geo", "gbif"],
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
    ],
  },
  {
    id: "chemistry",
    labelKey: "domain-discipline-chemistry",
    sources: ["pubchem"],
    filters: [],
  },
  {
    id: "geoscience",
    labelKey: "domain-discipline-geoscience",
    sources: ["pangaea", "nasa"],
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
    ],
  },
  {
    id: "social-science",
    labelKey: "domain-discipline-social-science",
    sources: ["icpsr", "ukds"],
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
      { key: "country", labelKey: "domain-filter-country", type: "select" },
    ],
  },
  {
    id: "economics",
    labelKey: "domain-discipline-economics",
    sources: ["worldbank", "oecd", "imf", "eurostat"],
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
      { key: "country", labelKey: "domain-filter-country", type: "select" },
    ],
  },
  {
    id: "health",
    labelKey: "domain-discipline-health",
    sources: ["who-gho"],
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
      { key: "country", labelKey: "domain-filter-country", type: "select" },
    ],
  },
  {
    id: "registry",
    labelKey: "domain-discipline-registry",
    sources: ["datacite-search", "re3data"],
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
    ],
  },
];

/** 数据集域 Tab 的完整来源列表（所有学科并集，供"全部"选项使用）。 */
export const DATASET_ALL_SOURCES = DATASET_DISCIPLINES.flatMap(
  (d) => d.sources,
);

/** 域 Tab 元数据。 */
export const DOMAIN_TABS: ReadonlyArray<{
  id: DomainId;
  labelKey: string;
  /** 输入框 placeholder 的 locale key */
  placeholderKey: string;
}> = [
  {
    id: "patent",
    labelKey: "hub-domain-tab-patent",
    placeholderKey: "hub-domain-patent-placeholder",
  },
  {
    id: "dataset",
    labelKey: "hub-domain-tab-dataset",
    placeholderKey: "hub-domain-dataset-placeholder",
  },
  {
    id: "researcher",
    labelKey: "hub-domain-tab-researcher",
    placeholderKey: "hub-domain-researcher-placeholder",
  },
  {
    id: "grant",
    labelKey: "hub-domain-tab-grant",
    placeholderKey: "hub-domain-grant-placeholder",
  },
];
