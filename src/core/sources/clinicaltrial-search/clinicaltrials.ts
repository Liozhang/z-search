/**
 * ClinicalTrialsAdapter — ClinicalTrials.gov API v2 检索源（免 key）。
 *
 * ClinicalTrials.gov API v2 免费、无需 key，覆盖全球注册的临床试验。
 * 端点：/api/v2/studies?query.term=<query>&pageSize=<n>&format=json
 *
 * 返回 DomainResult：
 *  - sourceId = NCT ID（如 "NCT04280705"）
 *  - dedupKey = "clinicaltrials:" + sourceId
 *  - extra 含 status、condition、intervention、sponsor、phase、enrollment
 *
 * @module core/sources/clinicaltrial-search/clinicaltrials
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { safeDebug } from "../../../utils/logger";
import { toErrorMessage } from "../../../utils/error";

const CT_API = "https://clinicaltrials.gov/api/v2/studies";

export class ClinicalTrialsAdapter extends DomainSourceAdapter {
  readonly id = "clinicaltrials";
  readonly domainId = "clinicaltrial";
  readonly label = "ClinicalTrials.gov";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    const limit = Math.min(maxResults, 100);
    let url = `${CT_API}?query.term=${encodeURIComponent(query)}&pageSize=${limit}&format=json`;

    // 状态过滤
    if (filters?.status) {
      url += `&filter.overallStatus=${encodeURIComponent(filters.status)}`;
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
      throw new Error(`ClinicalTrials.gov API error: HTTP ${resp.status}`);
    }

    let data: any;
    try {
      data = JSON.parse(resp.responseText || "{}");
    } catch (e) {
      throw new Error(
        `ClinicalTrials.gov API invalid JSON: ${toErrorMessage(e)}`,
      );
    }

    const studies: any[] = data.studies || [];
    const results: DomainResult[] = [];

    for (const study of studies.slice(0, maxResults)) {
      const protocol = study.protocolSection || {};
      const idModule = protocol.identificationModule || {};
      const statusModule = protocol.statusModule || {};
      const designModule = protocol.designModule || {};
      const conditionsModule = protocol.conditionsModule || {};
      const armsModule = protocol.armsInterventionsModule || {};
      const sponsorModule = protocol.sponsorCollaboratorsModule || {};

      const nctId = idModule.nctId || "";
      if (!nctId) continue;

      const title = idModule.briefTitle || idModule.officialTitle || "";
      if (!title) continue;

      // 干预措施
      const interventions: string[] = Array.isArray(armsModule.interventions)
        ? armsModule.interventions
            .map((int: any) => int.name || "")
            .filter(Boolean)
        : [];

      // 适应症
      const conditions: string[] = Array.isArray(conditionsModule.conditions)
        ? conditionsModule.conditions
        : [];

      // 状态
      const status = statusModule.overallStatus || "";

      // 阶段
      const phases: string[] = Array.isArray(designModule.phases)
        ? designModule.phases
        : [];

      // 入组人数
      const enrollment = designModule.enrollmentInfo?.count ?? 0;

      const url = `https://clinicaltrials.gov/study/${nctId}`;

      results.push({
        title,
        url,
        snippet: idModule.briefSummary || "",
        source: "clinicaltrials",
        sourceId: nctId,
        year: statusModule.startDateStruct?.date
          ? statusModule.startDateStruct.date.slice(0, 4)
          : undefined,
        dedupKey: `clinicaltrials:${nctId}`,
        metrics: {
          enrollment,
        },
        extra: {
          status,
          conditions,
          interventions,
          phases,
          sponsor: sponsorModule.leadSponsor?.name || "",
          startDate: statusModule.startDateStruct?.date || "",
          completionDate: statusModule.completionDateStruct?.date || "",
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const url = `${CT_API}/${sourceId}?format=json`;
    const resp = await Zotero.HTTP.request("GET", url, {
      headers: {
        Accept: "application/json",
        ...ZSEARCH_HTTP_HEADERS,
      },
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

    const protocol = data?.protocolSection || {};
    const idModule = protocol.identificationModule || {};
    const statusModule = protocol.statusModule || {};
    const designModule = protocol.designModule || {};
    const conditionsModule = protocol.conditionsModule || {};
    const armsModule = protocol.armsInterventionsModule || {};
    const sponsorModule = protocol.sponsorCollaboratorsModule || {};

    const nctId = idModule.nctId || sourceId;
    const title = idModule.briefTitle || idModule.officialTitle || "";

    return {
      title: title || nctId,
      url: `https://clinicaltrials.gov/study/${nctId}`,
      snippet: idModule.briefSummary || "",
      source: "clinicaltrials",
      sourceId: nctId,
      year: statusModule.startDateStruct?.date
        ? statusModule.startDateStruct.date.slice(0, 4)
        : undefined,
      dedupKey: `clinicaltrials:${nctId}`,
      metrics: {
        enrollment: designModule.enrollmentInfo?.count ?? 0,
      },
      extra: {
        status: statusModule.overallStatus || "",
        conditions: Array.isArray(conditionsModule.conditions)
          ? conditionsModule.conditions
          : [],
        interventions: Array.isArray(armsModule.interventions)
          ? armsModule.interventions
              .map((int: any) => int.name || "")
              .filter(Boolean)
          : [],
        phases: Array.isArray(designModule.phases)
          ? designModule.phases
          : [],
        sponsor: sponsorModule.leadSponsor?.name || "",
        startDate: statusModule.startDateStruct?.date || "",
        completionDate: statusModule.completionDateStruct?.date || "",
      },
    };
  }
}
