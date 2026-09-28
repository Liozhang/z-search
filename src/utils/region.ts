/**
 * region — 网络区域选择：插件「全球性」的唯一开关。
 *
 * 背景：z-search 的默认取值是按国际互联网写的（Google 翻译免费端点、
 * DuckDuckGo、英文维基……），而中国大陆网络下这些端点不可达；反过来
 * easyScholar、MinerU 云、中文核心名单又是国内专属服务。历史上这些
 * 差异全靠「Google 失败 → Bing web 兜底」这类隐式链路吸收，用户无从
 * 声明自己所在的网络，也无从把任一区域限定的端点换成自己的镜像。
 *
 * 本模块把区域从「代码里的隐式假设」提成「用户的一个显式选项」：
 *
 *   1. `region` pref（auto | global | cn）声明用户的网络环境；
 *   2. 每个声明区域带一份推荐值（默认网页搜索源 / 翻译引擎 / Azure
 *      订阅区域 / 中科院分区的显隐），仅在目标键**仍是出厂默认值**时套
 *      用——用户改过的设置永不被覆盖；
 *   3. 区域限定的端点一律可由 pref 覆盖（easyScholar / MinerU 云 /
 *      维基百科域名），镜像与自建实例是跨境用户的常规操作；
 *   4. 区域限定的**功能**（中科院分区等中国区数据）随声明区域显隐，
 *      且每项都有用户显式覆盖（见 isCassPartitionVisible）。
 *
 * auto 是缺省：不声明就完全沿用今天的行为（国际优先端点 + 兜底链），
 * 不猜用户在哪——按 IP/时区推断在学术插件里不可接受（隐私 + 误判代价
 * 由用户承担）。
 *
 * @module utils/region
 */

import { getPref, getPrefDynamic, setPref } from "./prefs";

export const REGION_PREF_KEY = "region";

export const NETWORK_REGIONS = ["auto", "global", "cn"] as const;

/** 用户的网络环境。`auto` = 未声明（沿用出厂默认，不做任何推断）。 */
export type NetworkRegion = (typeof NETWORK_REGIONS)[number];

// ── 区域限定功能的显隐（中科院分区等中国区数据）────────────────────────

export const REGION_FEATURE_PREF_CHOICES = ["auto", "show", "hide"] as const;

/**
 * 区域限定功能的用户选择：`auto` = 跟随网络区域推荐，`show`/`hide` =
 * 显式覆盖（分区数据是离线内置的，全球用户也可能研究中国期刊——故只做
 * 默认显隐，绝不硬性剥夺）。
 */
export type RegionFeatureChoice = (typeof REGION_FEATURE_PREF_CHOICES)[number];

export const CASS_PARTITION_PREF_KEY = "region.cassPartition";

/** 归一化：非法值（含空串/旧版残留）一律回落 auto。 */
export function normalizeRegionFeatureChoice(
  value: unknown,
): RegionFeatureChoice {
  const v = typeof value === "string" ? value.trim() : "";
  return (REGION_FEATURE_PREF_CHOICES as readonly string[]).includes(v)
    ? (v as RegionFeatureChoice)
    : "auto";
}

/**
 * 中科院分区（CASS，2025 年度快照；中国科研评价体系的数据）当前是否
 * 参与富集/评分/徽章展示。
 *
 * `show`/`hide` 是用户的最终决定；`auto` 跟随网络区域——`cn` 显示，
 * `global` 隐藏，区域未声明（auto）沿用 1.x 的历史行为：本地离线数据，
 * 默认展示（不猜测用户身份）。
 *
 * 本函数在富集/评分/渲染热路径上被同步调用且调用方的 catch 多为「整段
 * 放弃」——故任何读 pref 异常都回落 true（历史行为），绝不拖垮调用方。
 */
export function isCassPartitionVisible(): boolean {
  try {
    const choice = normalizeRegionFeatureChoice(
      getPrefDynamic(CASS_PARTITION_PREF_KEY),
    );
    if (choice !== "auto") return choice === "show";
    const region = getNetworkRegion();
    if (region === "cn") return true;
    if (region === "global") return false;
    return true;
  } catch {
    return true;
  }
}

/** 声明区域后给出的推荐取值（只做默认值，用户随时可改）。 */
export interface RegionProfile {
  /** 免 key 网页搜索源里当前区域可达的默认源（webSourceRegistry 的 id）。 */
  webDefaultProvider: string;
  /** 翻译引擎（translationEngines 的 engineType）。 */
  translateEngine: string;
  /** Azure Translator 订阅区域（仅 engineType = "bing" 时使用）。 */
  bingRegion: string;
  /** 中国区专属功能（中科院分区）在该区域下的显隐。 */
  cassPartition: RegionFeatureChoice;
}

export const REGION_PROFILES: Record<
  Exclude<NetworkRegion, "auto">,
  RegionProfile
> = {
  // 国际互联网：Google 免费端点与 DuckDuckGo 均可用。
  global: {
    webDefaultProvider: "duckduckgo",
    translateEngine: "google",
    bingRegion: "global",
    cassPartition: "hide",
  },
  // 中国大陆：Google / DuckDuckGo 不可达——默认源落 Bing（web），翻译
  // 走同源的免 key Bing web 端点（Azure 订阅区取国内 region，配了
  // Azure key 的用户无需再手改）。
  cn: {
    webDefaultProvider: "bing-html",
    translateEngine: "bing-web",
    bingRegion: "chinanorth",
    cassPartition: "show",
  },
};

/** 出厂默认值（addon/prefs.js 的镜像）。推荐值只覆盖仍等于这些值的键。 */
const SHIPPED_DEFAULTS: Record<string, string> = {
  "search.web.defaultProvider": "duckduckgo",
  "translate.engineType": "google",
  "translate.bing.region": "",
  [CASS_PARTITION_PREF_KEY]: "auto",
};

/** 推荐值写入的目标键（顺序即 UI 展示顺序）。 */
export const REGION_RECOMMENDED_KEYS = [
  "search.web.defaultProvider",
  "translate.engineType",
  "translate.bing.region",
  CASS_PARTITION_PREF_KEY,
] as const;

export type RegionRecommendedKey = (typeof REGION_RECOMMENDED_KEYS)[number];

/** 归一化：非法值（含空串/旧版残留）一律回落 auto，绝不让坏值改变行为。 */
export function normalizeRegion(value: unknown): NetworkRegion {
  const v = typeof value === "string" ? value.trim() : "";
  return (NETWORK_REGIONS as readonly string[]).includes(v)
    ? (v as NetworkRegion)
    : "auto";
}

/** 读当前区域选择。 */
export function getNetworkRegion(): NetworkRegion {
  return normalizeRegion(getPref(REGION_PREF_KEY));
}

/** 写区域选择（设置面板与迁移用）。 */
export function setNetworkRegion(region: NetworkRegion): void {
  setPref(REGION_PREF_KEY, normalizeRegion(region));
}

/** 声明区域的推荐值；未声明（auto）返回 null。 */
export function getRegionProfile(
  region: NetworkRegion = getNetworkRegion(),
): RegionProfile | null {
  return region === "auto" ? null : REGION_PROFILES[region];
}

/** 当前网络是否声明为中国大陆。 */
export function isChinaRegion(region: NetworkRegion = getNetworkRegion()) {
  return region === "cn";
}

/** 取区域推荐值在某个键上的取值（auto 回落出厂默认）。 */
export function regionRecommendation(
  key: RegionRecommendedKey,
  region: NetworkRegion = getNetworkRegion(),
): string {
  const profile = getRegionProfile(region);
  if (!profile) return SHIPPED_DEFAULTS[key];
  if (key === "search.web.defaultProvider") return profile.webDefaultProvider;
  if (key === "translate.engineType") return profile.translateEngine;
  if (key === CASS_PARTITION_PREF_KEY) return profile.cassPartition;
  return profile.bingRegion;
}

/**
 * 套用区域推荐值。
 *
 * 守门：只有当前值仍等于出厂默认的键才会被改写——用户显式选过的源/引擎
 * 不被区域选择推翻（区域只是「默认值」，不是「强制值」）。`force` 供
 * 设置面板的「重新应用」按钮使用：那一次点击本身就是显式授权。
 *
 * @returns 实际写入的键（UI 据此回显改了什么）。
 */
export function applyRegionRecommendations(
  region: NetworkRegion,
  opts: { force?: boolean } = {},
): RegionRecommendedKey[] {
  const profile = getRegionProfile(region);
  if (!profile) return [];
  const written: RegionRecommendedKey[] = [];
  for (const key of REGION_RECOMMENDED_KEYS) {
    const current = String(getPrefDynamic(key) ?? "");
    if (!opts.force && current !== SHIPPED_DEFAULTS[key]) continue;
    const next = regionRecommendation(key, region);
    if (current === next) continue;
    setPref(key, next as any);
    written.push(key);
  }
  return written;
}

/**
 * 维基百科域名：pref 覆盖 > 按 Zotero 界面语言推导 > 英文维基。
 *
 * 全球化的硬伤原本写死在 `https://en.wikipedia.org/w/api.php`——中文用户
 * 在中文维基里能搜到的条目，英文维基往往没有。现在默认跟随界面语言，
 * 并允许用户指定镜像/其它语言站（`search.web.wikipedia.host`）。
 */
export const WIKIPEDIA_HOST_PREF_KEY = "search.web.wikipedia.host";

const DEFAULT_WIKIPEDIA_HOST = "en.wikipedia.org";

/** 合法维基主机名：字母/数字/连字符/点，且至少两段（zh.wikipedia.org）。 */
const WIKI_HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** 语言代码（Zotero locale 或裸 ISO-639）→ 维基域名。非法输入回落英文维基。 */
export function wikiHostFromLocale(locale?: string | null): string {
  const base = String(locale ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .split("-")[0];
  // 只放行 2-8 个字母的语言码：挡住空串、地区缩写与一切注入企图。
  if (!/^[a-z]{2,8}$/.test(base)) return DEFAULT_WIKIPEDIA_HOST;
  return `${base}.wikipedia.org`;
}

/** 当前生效的维基主机名（用户在 pref 里填的值原样信任，但需过域名校验）。 */
export function resolveWikiHost(locale?: string | null): string {
  const override = String(getPrefDynamic(WIKIPEDIA_HOST_PREF_KEY) ?? "")
    .trim()
    .toLowerCase();
  if (override && WIKI_HOST_RE.test(override)) return override;
  return wikiHostFromLocale(locale);
}
