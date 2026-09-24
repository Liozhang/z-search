/**
 * StructuredFullTextClient — 结构化全文 XML 拉取（P1-D）。
 *
 * 两个来源，按序尝试：
 *   1. PMC：NCBI ID Converter（DOI → PMCID）+ eutils efetch（JATS XML）。
 *      免 key，NCBI 礼仪节流 500ms/req。
 *   2. OpenAlex content API：works/doi 解析 W-id → {W}.grobid-xml（GROBID TEI）。
 *      **key 门控**（content.openalex.org 要求 api_key；未配置 key 直接跳过，
 *      与 O7「mailto 已废弃需鉴权迁移」结论一致）。
 *
 * 缓存立法（AICache）：正缓存 24h / 负缓存 1h —— 重建全库索引时同一 DOI
 * 不重复打网络；拉取失败（无 PMCID/无 key/网络错/非 XML）也是可缓存事实。
 *
 * 本模块只搬 XML 字符串；解析在 TeiSectionParser（同型 ParseResult）。
 *
 * @module core/pdf/StructuredFullTextClient
 */

import cache, { CacheKeys } from "../cache/AICache";
// DOI 归一已提升为中立 util（P1-B）；此处 import+re-export 维持既有 import 面
// （本模块单测从本模块取 normalizeDoi）。
import { normalizeDoi } from "../utils/doi";
import { ZSEARCH_HTTP_HEADERS } from "../../utils/httpHeaders";
import { getPrefDynamic } from "../../utils/prefs";
import { safeDebug } from "../../utils/logger";
import { ncbiThrottle } from "../../utils/ncbiThrottle";

export interface StructuredXmlResult {
  xml: string;
  source: "pmc-jats" | "openalex-grobid";
}

interface CachedXml {
  /** null = 负缓存（来源不可得）。 */
  xml: string | null;
  source: StructuredXmlResult["source"] | null;
}

const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

export { normalizeDoi };

async function httpGetText(
  url: string,
  accept: string,
): Promise<string | null> {
  try {
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: { Accept: accept, ...ZSEARCH_HTTP_HEADERS },
      timeout: REQUEST_TIMEOUT_MS,
      errorDelayMax: 0,
    } as any);
    if (resp.status !== 200) return null;
    return resp.responseText ?? null;
  } catch (e) {
    safeDebug(
      `[z-search] StructuredFullTextClient: GET failed ${url.slice(0, 80)}…: ${e}`,
    );
    return null;
  }
}

// ── PMC（免 key）──────────────────────────────────────────────────────────

/**
 * idconv 输入 → PMCID。idconv 按 ids 的字面格式自动识别输入类型
 * （DOI / PMID 皆可），DOI 与 PMID 两条入口共用本步。
 */
async function resolvePmcidViaIdconv(id: string): Promise<string | null> {
  await ncbiThrottle();
  const convRaw = await httpGetText(
    `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${encodeURIComponent(id)}&format=json`,
    "application/json",
  );
  if (!convRaw) return null;
  let pmcid: string | null = null;
  try {
    const rec = JSON.parse(convRaw)?.records?.[0];
    if (rec?.pmcid && !rec?.errmsg) pmcid = String(rec.pmcid);
  } catch {
    return null;
  }
  return pmcid;
}

/** PMCID → JATS XML（efetch 直取，省掉 idconv 往返）。 */
async function fetchPmcJatsByPmcid(pmcid: string): Promise<string | null> {
  const id = pmcid.trim().toUpperCase();
  if (!/^PMC\d+$/.test(id)) return null;

  await ncbiThrottle();
  const xml = await httpGetText(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${encodeURIComponent(id)}&retmode=xml`,
    "application/xml",
  );
  return xml && /<article[\s>]/i.test(xml) ? xml : null;
}

async function fetchPmcJatsByDoi(doi: string): Promise<string | null> {
  const pmcid = await resolvePmcidViaIdconv(doi);
  if (!pmcid) return null;

  return await fetchPmcJatsByPmcid(pmcid);
}

/** PMID → PMCID（idconv）→ JATS XML。 */
async function fetchPmcJatsByPmid(pmid: string): Promise<string | null> {
  const id = String(pmid).trim();
  if (!/^\d{1,8}$/.test(id)) return null;

  const pmcid = await resolvePmcidViaIdconv(id);
  if (!pmcid) return null;

  return await fetchPmcJatsByPmcid(pmcid);
}

// ── OpenAlex（key 门控）───────────────────────────────────────────────────

async function fetchOpenAlexGrobidByDoi(doi: string): Promise<string | null> {
  const apiKey = String(getPrefDynamic("apis.openalex.apiKey") ?? "").trim();
  if (!apiKey) return null; // 门控：无 key 不打 content API

  await ncbiThrottle();
  const idRaw = await httpGetText(
    `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=id&api_key=${encodeURIComponent(apiKey)}`,
    "application/json",
  );
  if (!idRaw) return null;
  let workId: string | null;
  try {
    workId = String(JSON.parse(idRaw)?.id ?? "") || null;
  } catch {
    return null;
  }
  if (!workId) return null;

  await ncbiThrottle();
  const xml = await httpGetText(
    `${workId}.grobid-xml?api_key=${encodeURIComponent(apiKey)}`,
    "application/xml",
  );
  return xml && /<TEI[\s>]/i.test(xml) ? xml : null;
}

// ── 组合入口 ──────────────────────────────────────────────────────────────

/**
 * 缓存包裹的 PMC JATS 拉取：正缓存 24h / 负缓存 1h（与 fetchStructuredXmlByDoi
 * 的 PMC 段同立法）。cacheId 区分输入类型（pmcid:/pmid:），避免不同标识解析到
 * 同一 PMCID 时共享缓存键导致的串味。
 */
async function cachedPmcXml(
  cacheId: string,
  fetcher: () => Promise<string | null>,
): Promise<string | null> {
  const cached = await cache.get<CachedXml>(
    CacheKeys.structuredXml("pmc", cacheId),
  );
  if (cached) return cached.xml;

  const xml = await fetcher();
  await cache.set(
    CacheKeys.structuredXml("pmc", cacheId),
    { xml, source: xml ? "pmc-jats" : null },
    xml ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS,
  );
  return xml;
}

/**
 * 文章级入口：按可用标识依次尝试 DOI 全链（PMC → OpenAlex GROBID 兜底）→
 * PMCID 直取 → PMID 反查，任一成功即返回。
 *
 * DOI 优先：覆盖率最高且带 OpenAlex 兜底；PMCID 直取省一次 idconv 往返
 * （PubMed/Europe PMC 源的文章直接带）；PMID 反查兜底无 DOI 的老文献。
 * 所有标识失败（含负缓存命中）才返回 null。
 */
export async function fetchStructuredXmlForArticle(article: {
  doi?: string;
  pmid?: string;
  pmcid?: string;
}): Promise<StructuredXmlResult | null> {
  const doi = typeof article.doi === "string" ? article.doi.trim() : "";
  const pmcid = typeof article.pmcid === "string" ? article.pmcid.trim() : "";
  const pmid = typeof article.pmid === "string" ? article.pmid.trim() : "";

  const attempts: Array<() => Promise<StructuredXmlResult | null>> = [];
  if (doi && normalizeDoi(doi)) {
    attempts.push(() => fetchStructuredXmlByDoi(doi));
  }
  if (/^PMC\d+$/i.test(pmcid)) {
    const cacheId = `pmcid:${pmcid.toUpperCase()}`;
    attempts.push(async () => {
      const xml = await cachedPmcXml(cacheId, () => fetchPmcJatsByPmcid(pmcid));
      return xml ? { xml, source: "pmc-jats" } : null;
    });
  }
  if (/^\d{1,8}$/.test(pmid)) {
    const cacheId = `pmid:${pmid}`;
    attempts.push(async () => {
      const xml = await cachedPmcXml(cacheId, () => fetchPmcJatsByPmid(pmid));
      return xml ? { xml, source: "pmc-jats" } : null;
    });
  }

  for (const attempt of attempts) {
    const result = await attempt();
    if (result) return result;
  }
  return null;
}

/**
 * DOI → 结构化全文 XML（PMC JATS 优先，OpenAlex GROBID 兜底）。
 * 任一来源不可得返回 null（含负缓存命中）。
 */
export async function fetchStructuredXmlByDoi(
  doi: string,
): Promise<StructuredXmlResult | null> {
  const normalized = normalizeDoi(doi);
  if (!normalized) return null;

  // 正缓存直返；负缓存短路（来源写入 null xml）
  const pmcCached = await cache.get<CachedXml>(
    CacheKeys.structuredXml("pmc", normalized),
  );
  if (pmcCached) {
    return pmcCached.xml ? { xml: pmcCached.xml, source: "pmc-jats" } : null;
  }

  const xml = await fetchPmcJatsByDoi(normalized);
  if (xml) {
    await cache.set(
      CacheKeys.structuredXml("pmc", normalized),
      { xml, source: "pmc-jats" },
      POSITIVE_TTL_MS,
    );
    return { xml, source: "pmc-jats" };
  }
  await cache.set(
    CacheKeys.structuredXml("pmc", normalized),
    { xml: null, source: null },
    NEGATIVE_TTL_MS,
  );

  const openalexCached = await cache.get<CachedXml>(
    CacheKeys.structuredXml("openalex", normalized),
  );
  if (openalexCached) {
    return openalexCached.xml
      ? { xml: openalexCached.xml, source: "openalex-grobid" }
      : null;
  }

  const grobid = await fetchOpenAlexGrobidByDoi(normalized);
  if (grobid) {
    await cache.set(
      CacheKeys.structuredXml("openalex", normalized),
      { xml: grobid, source: "openalex-grobid" },
      POSITIVE_TTL_MS,
    );
    return { xml: grobid, source: "openalex-grobid" };
  }
  await cache.set(
    CacheKeys.structuredXml("openalex", normalized),
    { xml: null, source: null },
    NEGATIVE_TTL_MS,
  );
  return null;
}

/**
 * 条目入口：读 item 的 DOI 字段再走 fetchStructuredXmlByDoi。
 * 无 DOI / 条目不存在返回 null。
 */
export async function fetchStructuredXmlForItem(
  itemId: number,
): Promise<StructuredXmlResult | null> {
  try {
    const item = Zotero.Items.get(itemId);
    if (!item) return null;
    const doi = item.getField?.("DOI");
    if (!doi) return null;
    return await fetchStructuredXmlByDoi(String(doi));
  } catch (e) {
    safeDebug(
      `[z-search] StructuredFullTextClient: item ${itemId} failed: ${e}`,
    );
    return null;
  }
}
