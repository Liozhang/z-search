/**
 * endpointSchema — 区域限定端点的字段表（设置面板「区域限定端点」组的单一事实源）。
 *
 * 这些服务的端点只在其所属区域可达：easyScholar 与 MinerU 云只在中国大陆
 * 运营，维基百科的分站按语言分布，OpenDataLoader 的 JRE 下载走 Adoptium
 * （国内可达但慢）。硬编码内置值对跨境用户（以及站点变更/自建代理）是死路，
 * 故每个端点都可由 pref 覆盖——本表描述「哪个 pref、覆盖成什么形状算合法」，
 * 渲染与消费两侧共用（preferences.js 渲染，EasyScholarClient /
 * MinerUApiClient / JavaRuntimeManager / utils/region 求值）。
 *
 * 与 apiKeySchema 同构但刻意分开：密钥是「必填才有功能」，端点是「留空即
 * 用内置值」，状态语义不同（未填不是缺失，是默认）。
 *
 * @module utils/endpointSchema
 */

export interface EndpointField {
  /** 组内唯一 id（XHTML element id / React key）。 */
  fieldId: string;
  /** 完整相对 pref 键（运行时由 getPrefDynamic 加前缀）。 */
  prefKey: string;
  /** Fluent message id：字段 label。 */
  labelKey: string;
  /** Fluent message id：placeholder（内置端点提示）。 */
  placeholderKey: string;
  /** 合法值形状：url = http(s):// 开头；host = 裸主机名。 */
  kind: "url" | "host";
  /** 内置端点（留空时生效）；display 用，逻辑侧各自持有同一常量。 */
  builtin: string;
}

export const ENDPOINT_FIELDS: EndpointField[] = [
  {
    fieldId: "endpoint-easyscholar",
    prefKey: "apis.easyscholar.serverUrl",
    labelKey: "pref-endpoint-easyscholar",
    placeholderKey: "pref-endpoint-easyscholar-placeholder",
    kind: "url",
    builtin: "https://www.easyscholar.cc/openapi/api/paper/query",
  },
  {
    fieldId: "endpoint-mineru-cloud",
    prefKey: "pdfParser.mineru.cloudUrl",
    labelKey: "pref-endpoint-mineru",
    placeholderKey: "pref-endpoint-mineru-placeholder",
    kind: "url",
    builtin: "https://mineru.net/api/v4",
  },
  {
    fieldId: "endpoint-jre-mirror",
    prefKey: "pdfParser.opendataloader.jreMirror",
    labelKey: "pref-endpoint-jre-mirror",
    placeholderKey: "pref-endpoint-jre-mirror-placeholder",
    kind: "url",
    builtin: "https://api.adoptium.net/v3",
  },
  {
    fieldId: "endpoint-wikipedia-host",
    prefKey: "search.web.wikipedia.host",
    labelKey: "pref-endpoint-wikipedia",
    placeholderKey: "pref-endpoint-wikipedia-placeholder",
    kind: "host",
    builtin: "",
  },
];

/** http(s) URL：协议 + 主机两段即可，路径随意（覆盖为反代时常带路径）。 */
const URL_RE = /^https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:\/\S*)?$/i;

/** 裸主机名：至少两段（zh.wikipedia.org），不含协议/路径/端口。 */
const HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/**
 * 归一化待存值：去空白；host 型统一小写（大小写在 DNS 上无意义，且
 * resolveWikiHost 也是小写后校验的——两侧必须同形，否则 UI 收下的大小写
 * 值会在运行时被判非法而静默回落到默认）。url 型保留原样（路径大小写敏感）。
 */
export function normalizeEndpointValue(
  field: EndpointField,
  value: string,
): string {
  const v = String(value ?? "").trim();
  return field.kind === "host" ? v.toLowerCase() : v;
}

/**
 * 校验一个端点字段值。空串合法（= 用内置值）。
 *
 * @returns 空串 = 合法；否则是 Fluent message id（调用方本地化后展示）。
 */
export function validateEndpointValue(
  field: EndpointField,
  value: string,
): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (/\s/.test(v)) return "pref-endpoint-invalid";
  if (field.kind === "url") {
    return URL_RE.test(v) ? "" : "pref-endpoint-invalid";
  }
  return HOST_RE.test(v.toLowerCase()) ? "" : "pref-endpoint-invalid";
}
