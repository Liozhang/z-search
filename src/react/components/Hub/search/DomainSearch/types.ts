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
  /** 声明了高级筛选而源不支持时的跳过名单（后端能力闸归因） */
  skippedNoFilter: string[];
}

/** 域搜索响应。 */
export interface DomainSearchResponse {
  articles: DomainResult[];
  totalSearched: number;
  totalReturned: number;
  failedSources: string[];
  failedReasons: Record<string, string>;
  skippedNoKey: string[];
  skippedNoFilter: string[];
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
      {
        key: "license",
        labelKey: "domain-filter-license",
        type: "select",
        options: [
          { value: "cc-by", labelKey: "domain-filter-license-cc-by" },
          { value: "cc-by-sa", labelKey: "domain-filter-license-cc-by-sa" },
          { value: "cc-by-nc", labelKey: "domain-filter-license-cc-by-nc" },
          {
            value: "cc-by-nc-sa",
            labelKey: "domain-filter-license-cc-by-nc-sa",
          },
          { value: "cc0", labelKey: "domain-filter-license-cc0" },
          { value: "other", labelKey: "domain-filter-license-other" },
        ],
      },
      {
        key: "oaType",
        labelKey: "domain-filter-oa",
        type: "select",
        options: [
          { value: "open", labelKey: "domain-filter-oa-open" },
          { value: "restricted", labelKey: "domain-filter-oa-restricted" },
          { value: "closed", labelKey: "domain-filter-oa-closed" },
        ],
      },
    ],
  },
  {
    id: "ml",
    labelKey: "domain-discipline-ml",
    sources: ["huggingface", "kaggle", "uci", "openml"],
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
      {
        key: "taskTags",
        labelKey: "domain-filter-task",
        type: "multi-select",
        options: [
          {
            value: "classification",
            labelKey: "domain-filter-task-classification",
          },
          { value: "regression", labelKey: "domain-filter-task-regression" },
          { value: "clustering", labelKey: "domain-filter-task-clustering" },
          {
            value: "recommendation",
            labelKey: "domain-filter-task-recommendation",
          },
          {
            value: "question-answering",
            labelKey: "domain-filter-task-question-answering",
          },
          { value: "translation", labelKey: "domain-filter-task-translation" },
          {
            value: "summarization",
            labelKey: "domain-filter-task-summarization",
          },
          {
            value: "text-generation",
            labelKey: "domain-filter-task-text-generation",
          },
          {
            value: "speech-recognition",
            labelKey: "domain-filter-task-speech-recognition",
          },
          { value: "time-series", labelKey: "domain-filter-task-time-series" },
        ],
      },
      {
        key: "license",
        labelKey: "domain-filter-license",
        type: "select",
        options: [
          { value: "cc-by", labelKey: "domain-filter-license-cc-by" },
          { value: "cc-by-sa", labelKey: "domain-filter-license-cc-by-sa" },
          { value: "cc-by-nc", labelKey: "domain-filter-license-cc-by-nc" },
          {
            value: "cc-by-nc-sa",
            labelKey: "domain-filter-license-cc-by-nc-sa",
          },
          { value: "cc0", labelKey: "domain-filter-license-cc0" },
          { value: "other", labelKey: "domain-filter-license-other" },
        ],
      },
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
      {
        key: "country",
        labelKey: "domain-filter-country",
        type: "select",
        options: [
          {
            value: "United States",
            labelKey: "domain-filter-country-united-states",
          },
          {
            value: "United Kingdom",
            labelKey: "domain-filter-country-united-kingdom",
          },
          { value: "China", labelKey: "domain-filter-country-china" },
          { value: "Germany", labelKey: "domain-filter-country-germany" },
          { value: "France", labelKey: "domain-filter-country-france" },
          { value: "Japan", labelKey: "domain-filter-country-japan" },
          { value: "India", labelKey: "domain-filter-country-india" },
          { value: "Brazil", labelKey: "domain-filter-country-brazil" },
          {
            value: "South Africa",
            labelKey: "domain-filter-country-south-africa",
          },
          {
            value: "Australia",
            labelKey: "domain-filter-country-australia",
          },
          { value: "Canada", labelKey: "domain-filter-country-canada" },
          {
            value: "South Korea",
            labelKey: "domain-filter-country-south-korea",
          },
        ],
      },
    ],
  },
  {
    id: "economics",
    labelKey: "domain-discipline-economics",
    sources: ["worldbank", "oecd", "imf", "eurostat"],
    // 国别筛选退役（2026-10-23）：四源均为跨国指标汇总库，检索结果不携带
    // 国别维度，筛选项无从兑现——挂一个必然失效的筛选项比不放更误导。
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
    ],
  },
  {
    id: "health",
    labelKey: "domain-discipline-health",
    sources: ["who-gho"],
    // 同 economics：WHO 指标为全球汇总口径，国别筛选无从兑现。
    filters: [
      { key: "year", labelKey: "domain-filter-year", type: "year-range" },
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
