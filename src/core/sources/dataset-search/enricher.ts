/**
 * datasetEnricher — 数据集域结果富集（DataCite 补全）。
 *
 * 对 DomainSearchEngine 去重后的 DomainResult[] 原地写回 extra：
 *  1. 对有 DOI 的结果批量查 DataCite API（/dois/<doi>），补全：
 *     - 发布者（publisher）
 *     - 更精确的创作者列表
 *     - 许可证（rightsList）
 *  2. 无 DOI 的结果跳过（HF/Zenodo 无 DOI 时已带本地元数据）
 *
 * DataCite API 免费、无需 key，是全球数据集注册的事实标准。
 * 批量请求用 Promise.all（DataCite 对单条 /dois/<doi> 请求速率友好）。
 * 全部 best-effort：单条失败跳过，不阻断整批。
 *
 * @module core/sources/dataset-search/enricher
 */

import type { DomainResult } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const DATACITE_API = "https://api.datacite.org/dois";

/**
 * 富集数据集结果（原地写回 extra）。
 * 供 DomainRegistry 注册为 dataset 域的 DomainDef.enrich。
 */
export async function enrichDatasetResults(
  results: DomainResult[],
): Promise<void> {
  // 只对有 DOI 的结果查 DataCite（无 DOI 的 HF/Zenodo 内部 ID 无补全价值）
  const withDoi = results.filter((r) => r.doi);
  if (withDoi.length === 0) return;

  // 并发上限 5（DataCite 礼貌池）
  const CONCURRENCY = 5;
  for (let i = 0; i < withDoi.length; i += CONCURRENCY) {
    const chunk = withDoi.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (r) => {
        try {
          const resp = await Zotero.HTTP.request(
            "GET",
            `${DATACITE_API}/${r.doi}`,
            {
              headers: {
                Accept: "application/vnd.api+json",
                ...ZSEARCH_HTTP_HEADERS,
              },
              timeout: 10000,
              errorDelayMax: 0,
            } as any,
          );

          if (resp.status >= 400) return;

          const data = JSON.parse(resp.responseText || "{}");
          const attrs = data?.data?.attributes;
          if (!attrs) return;

          if (!r.extra) r.extra = {};

          // 发布者
          if (attrs.publisher) {
            r.extra.publisher = attrs.publisher;
          }

          // 创作者（DataCite 的 creators 数组带完整姓名）
          if (Array.isArray(attrs.creators)) {
            const creators = attrs.creators
              .map((c: any) => c.name || c.nameIdentifiers?.[0]?.name || "")
              .filter(Boolean);
            if (creators.length > 0) r.extra.creators = creators;
          }

          // 许可证（rightsList）
          if (Array.isArray(attrs.rightsList)) {
            const license =
              attrs.rightsList.find((rl: any) =>
                rl?.rightsIdentifier?.startsWith("cc-"),
              )?.rightsIdentifier || "";
            if (license) r.extra.license = license;
          }
        } catch (e) {
          safeDebug(
            `[z-search] datasetEnricher DataCite lookup failed for ${r.doi}: ${toErrorMessage(e)}`,
          );
          /* 单条失败跳过 */
        }
      }),
    );
  }
}
