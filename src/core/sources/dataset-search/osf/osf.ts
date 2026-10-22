/**
 * OsfAdapter — OSF (Open Science Framework) 数据集检索源（免 key）。
 *
 * OSF 是全学科通用开放数据仓储，由 Center for Open Science 运营。
 * 免费 API v2。
 * 端点：/v2/nodes/?filter=<query>&filter[preprint]=false
 *      /v2/preprints/?filter[q]=<query>
 *
 * 返回 DomainResult：
 *  - sourceId = OSF node id（如 "abcd1"）
 *  - dedupKey = "osf:" + sourceId
 *  - extra 含 authors、license、tags、dateCreated
 *
 * @module core/sources/dataset-search/osf
 */

import { DomainSourceAdapter } from "../../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../../utils/httpHeaders";
import { safeDebug } from "../../../../utils/logger";
import { toErrorMessage } from "../../../../utils/error";

const OSF_API = "https://api.osf.io/v2";

export class OsfAdapter extends DomainSourceAdapter {
  readonly id = "osf";
  readonly domainId = "dataset";
  readonly label = "OSF (Open Science Framework)";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 100);
    // OSF 搜索节点（项目/数据集）
    const url = `${OSF_API}/nodes/?filter[title]=${encodeURIComponent(query)}&page[size]=${limit}`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/vnd.api+json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`OSF API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`OSF API invalid JSON: ${toErrorMessage(e)}`);
    }

    const items: any[] = data.data || [];
    const results: DomainResult[] = [];

    for (const item of items.slice(0, maxResults)) {
      const id = item.id || "";
      if (!id) continue;

      const attrs = item.attributes || {};
      const title = attrs.title || "";
      if (!title) continue;

      const url = `https://osf.io/${id}/`;

      // 作者：从 relationships 或 embedded 中提取
      const authors: string[] = [];
      if (Array.isArray(item.embeds?.bibliographic_contributors?.data)) {
        for (const c of item.embeds.bibliographic_contributors.data) {
          const users = c?.embeds?.users?.data;
          if (Array.isArray(users)) {
            for (const u of users) {
              if (u?.attributes?.full_name) authors.push(u.attributes.full_name);
            }
          }
        }
      }

      results.push({
        title,
        url,
        snippet: (attrs.description || "").slice(0, 300),
        source: "osf",
        sourceId: id,
        year: attrs.date_created
          ? attrs.date_created.slice(0, 4)
          : undefined,
        dedupKey: `osf:${id}`,
        metrics: {
          views: 0,
        },
        extra: {
          authors,
          license: attrs.node_license?.name || "",
          tags: Array.isArray(attrs.tags) ? attrs.tags : [],
          dateCreated: attrs.date_created || "",
          dateModified: attrs.date_modified || "",
          public: attrs.public ?? true,
        },
      });
    }

    return results;
  }
}
