/**
 * CordisGrantAdapter — EU CORDIS API 检索源（免 key）。
 *
 * CORDIS API 免费、无需 key，覆盖欧盟框架计划资助项目。
 * 端点：/api/projects?q=<query>&format=json&page=1&pageSize=<n>
 *
 * 返回 DomainResult：
 *  - sourceId = CORDIS project id（如 "101234567"）
 *  - dedupKey = "cordis:" + id
 *  - extra 含 coordinator、合作机构、框架计划、金额、执行期
 *
 * 与 grant 域的 importItemType = "note" 联动。
 *
 * @module core/sources/grant-search/cordis
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

const CORDIS_API = "https://cordis.europa.eu/api/projects";

export class CordisGrantAdapter extends DomainSourceAdapter {
  readonly id = "cordis";
  readonly domainId = "grant";
  readonly label = "EU CORDIS";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const pageSize = Math.min(maxResults, 25); // CORDIS 单页上限 25
    let url = `${CORDIS_API}?q=${encodeURIComponent(query)}&format=json&page=1&pageSize=${pageSize}`;

    // 年份过滤：startDate range
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        url += `&startDateStart=${start}-01-01&startDateEnd=${end}-12-31`;
      }
    }

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`CORDIS API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`CORDIS API invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const projects: any[] = data.payload?.projects || data.projects || [];
    const results: DomainResult[] = [];

    for (const project of projects.slice(0, maxResults)) {
      const id = String(project.id || project.rcn || "");
      if (!id) continue;

      const title = project.title || project.acronym || "";
      if (!title) continue;

      const url = `https://cordis.europa.eu/project/id/${id}`;

      results.push({
        title,
        url,
        snippet: (project.objective || project.description || "").slice(0, 300),
        source: "cordis",
        sourceId: id,
        year: project.startDate ? project.startDate.slice(0, 4) : undefined,
        dedupKey: `cordis:${id}`,
        metrics: {
          amount: project.totalCost ? Number(project.totalCost) : 0,
        },
        extra: {
          pi: project.coordinator || "",
          institution: project.coordinatorCountry || "",
          fundingAgency: "EU",
          country: project.coordinatorCountry || "",
          startDate: project.startDate || "",
          endDate: project.endDate || "",
          status: project.status || "",
          frameworkProgramme: project.frameworkProgramme || "",
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const url = `${CORDIS_API}/${sourceId}?format=json`;
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) return null;

    let project: any;
    try {
      project = JSON.parse(resp.responseText || "{}");
    } catch {
      return null;
    }

    if (!project?.id && !project?.rcn) return null;

    return {
      title: project.title || project.acronym || sourceId,
      url: `https://cordis.europa.eu/project/id/${sourceId}`,
      snippet: (project.objective || project.description || "").slice(0, 300),
      source: "cordis",
      sourceId,
      year: project.startDate ? project.startDate.slice(0, 4) : undefined,
      dedupKey: `cordis:${sourceId}`,
      metrics: {
        amount: project.totalCost ? Number(project.totalCost) : 0,
      },
      extra: {
        pi: project.coordinator || "",
        institution: project.coordinatorCountry || "",
        fundingAgency: "EU",
        country: project.coordinatorCountry || "",
        startDate: project.startDate || "",
        endDate: project.endDate || "",
        status: project.status || "",
        frameworkProgramme: project.frameworkProgramme || "",
      },
    };
  }
}
