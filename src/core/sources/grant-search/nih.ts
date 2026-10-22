/**
 * NihGrantAdapter — NIH RePORTER API 检索源（免 key）。
 *
 * NIH RePORTER 是美国国立卫生研究院的免费项目数据库，API 免费、无需 key。
 * 端点：/api/Projects/search（POST，JSON body）
 *
 * 返回 DomainResult：
 *  - sourceId = NIH project number（如 "R01CA123456"）
 *  - dedupKey = "nih:" + sourceId
 *  - extra 含 PI、机构、金额、执行期、状态、MeSH 术语
 *
 * @module core/sources/grant-search/nih
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

const NIH_API = "https://api.reporter.nih.gov/v2/projects/search";

export class NihGrantAdapter extends DomainSourceAdapter {
  readonly id = "nih";
  readonly domainId = "grant";
  readonly label = "NIH RePORTER";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    // NIH RePORTER 用 POST + JSON body
    const body: Record<string, any> = {
      criteria: {
        advanced_text_search: {
          operator: "and",
          search_field: "projecttitle,abstract,terms",
          search_text: query,
        },
      },
      include_fields: [
        "ProjectNum",
        "ProjectTitle",
        "AbstractText",
        "PrincipalInvestigators",
        "Organization",
        "AwardAmount",
        "ProjectStartDate",
        "ProjectEndDate",
        "FiscalYear",
        "AgencyIcAdmin",
      ],
      offset: 0,
      limit: Math.min(maxResults, 500),
    };

    // 年份过滤
    if (filters?.year) {
      const [start, end] = filters.year.split("-");
      if (start && end) {
        body.criteria.fiscal_years = Array.from(
          { length: Number(end) - Number(start) + 1 },
          (_, i) => Number(start) + i,
        );
      }
    }

    const resp = await Zotero.HTTP.request("POST", NIH_API, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      body: JSON.stringify(body),
      timeout: 20000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) {
      throw new Error(`NIH RePORTER API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(`NIH RePORTER API invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const projects: any[] = data.results || [];
    const results: DomainResult[] = [];

    for (const project of projects.slice(0, maxResults)) {
      const projectNum = project.project_num || "";
      if (!projectNum) continue;

      const title = project.project_title || "";
      if (!title) continue;

      // PI：principal_investigators 数组
      const pis: string[] = Array.isArray(project.principal_investigators)
        ? project.principal_investigators
            .map((pi: any) => pi.full_name || "")
            .filter(Boolean)
        : [];

      // 机构
      const institution = project.organization?.org_name || "";

      // 金额
      const amount = project.award_amount ?? 0;

      const url = `https://reporter.nih.gov/project-details/${projectNum}`;

      results.push({
        title,
        url,
        snippet: (project.abstract_text || "").slice(0, 300),
        source: "nih",
        sourceId: projectNum,
        year: project.fiscal_year ? String(project.fiscal_year) : undefined,
        dedupKey: `nih:${projectNum}`,
        metrics: {
          amount: amount,
        },
        extra: {
          pi: pis.join("; "),
          institution,
          fundingAgency: "NIH",
          country: "US",
          startDate: project.project_start_date || "",
          endDate: project.project_end_date || "",
          status: project.project_end_date
            ? new Date(project.project_end_date) > new Date()
              ? "active"
              : "completed"
            : "unknown",
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const body = {
      criteria: {
        project_nums: [sourceId],
      },
      include_fields: [
        "ProjectNum",
        "ProjectTitle",
        "AbstractText",
        "PrincipalInvestigators",
        "Organization",
        "AwardAmount",
        "ProjectStartDate",
        "ProjectEndDate",
        "FiscalYear",
      ],
      offset: 0,
      limit: 1,
    };

    const resp = await Zotero.HTTP.request("POST", NIH_API, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
      body: JSON.stringify(body),
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (resp.status >= 400) return null;

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch {
      return null;
    }

    const project = data.results?.[0];
    if (!project) return null;

    const pis: string[] = Array.isArray(project.principal_investigators)
      ? project.principal_investigators
          .map((pi: any) => pi.full_name || "")
          .filter(Boolean)
      : [];

    return {
      title: project.project_title || sourceId,
      url: `https://reporter.nih.gov/project-details/${sourceId}`,
      snippet: (project.abstract_text || "").slice(0, 300),
      source: "nih",
      sourceId,
      year: project.fiscal_year ? String(project.fiscal_year) : undefined,
      dedupKey: `nih:${sourceId}`,
      metrics: {
        amount: project.award_amount ?? 0,
      },
      extra: {
        pi: pis.join("; "),
        institution: project.organization?.org_name || "",
        fundingAgency: "NIH",
        country: "US",
        startDate: project.project_start_date || "",
        endDate: project.project_end_date || "",
        status: project.project_end_date
          ? new Date(project.project_end_date) > new Date()
            ? "active"
            : "completed"
          : "unknown",
      },
    };
  }
}
