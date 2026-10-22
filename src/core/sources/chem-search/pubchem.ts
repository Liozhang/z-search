/**
 * PubChemAdapter — PubChem 化学分子检索源（免 key）。
 *
 * PubChem 是 NCBI 运营的开放化学数据库，含 >1 亿化合物。
 * PUG-REST API 免费、无需 key。
 * 端点：/rest/pug/compound/name/<name>/property/<props>/JSON
 *      /rest/pug/compound/cid/<cid>/property/<props>/JSON
 *
 * 返回 DomainResult：
 *  - sourceId = PubChem CID（如 "2244"）
 *  - dedupKey = "pubchem:" + sourceId
 *  - extra 含 molecularFormula、molecularWeight、iupacName、synonyms
 *
 * @module core/sources/chem-search/pubchem
 */

import { DomainSourceAdapter } from "../../search/DomainSourceAdapter";
import type { DomainResult, DomainFilters } from "../../search/domainTypes";
import { ZSEARCH_HTTP_HEADERS } from "../../../utils/httpHeaders";
import { toErrorMessage } from "../../../utils/error";

const PUBCHEM_API = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";

export class PubChemAdapter extends DomainSourceAdapter {
  readonly id = "pubchem";
  readonly domainId = "chemistry";
  readonly label = "PubChem";
  readonly noKey = true;

  async isAvailable() {
    return { available: true };
  }

  async search(
    query: string,
    maxResults: number,
    _filters?: DomainFilters,
  ): Promise<DomainResult[]> {
    // 先用 name 搜索获取 CID 列表
    const searchUrl = `${PUBCHEM_API}/compound/name/${encodeURIComponent(query)}/cids/JSON?name_type=word&MaxRecords=${Math.min(maxResults, 100)}`;
    const searchResp = await Zotero.HTTP.request("GET", searchUrl, {
      headers: { ...ZSEARCH_HTTP_HEADERS },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (searchResp.status >= 400) {
      throw new Error(`PubChem search error: HTTP ${searchResp.status}`);
    }

    let searchData: any;
    try {
      searchData = JSON.parse(searchResp.responseText || "{}");
    } catch (e) {
      throw new Error(`PubChem search invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const cids: number[] = searchData?.IdentifierList?.CID || [];
    if (cids.length === 0) return [];

    // 批量获取属性
    const props = "MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES";
    const cidList = cids.slice(0, maxResults).join(",");
    const propUrl = `${PUBCHEM_API}/compound/cid/${cidList}/property/${props}/JSON`;

    const propResp = await Zotero.HTTP.request("GET", propUrl, {
      headers: { ...ZSEARCH_HTTP_HEADERS },
      timeout: 15000,
      errorDelayMax: 0,
    } as any);

    if (propResp.status >= 400) {
      throw new Error(`PubChem property error: HTTP ${propResp.status}`);
    }

    let propData: any;
    try {
      propData = JSON.parse(propResp.responseText || "{}");
    } catch (e) {
      throw new Error(`PubChem property invalid JSON: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    const properties: any[] = propData?.PropertyTable?.Properties || [];
    const results: DomainResult[] = [];

    for (const prop of properties.slice(0, maxResults)) {
      const cid = String(prop.CID || "");
      if (!cid) continue;

      const iupacName = prop.IUPACName || "";
      const formula = prop.MolecularFormula || "";
      const weight = prop.MolecularWeight ?? 0;
      const smiles = prop.CanonicalSMILES || prop.SMILES || "";

      const url = `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;

      results.push({
        title: iupacName || `CID ${cid}`,
        url,
        snippet: `${formula} | MW: ${weight}`,
        source: "pubchem",
        sourceId: cid,
        dedupKey: `pubchem:${cid}`,
        metrics: {
          molecularWeight: weight,
        },
        extra: {
          cid,
          molecularFormula: formula,
          molecularWeight: weight,
          iupacName,
          smiles,
        },
      });
    }

    return results;
  }

  async profile(sourceId: string): Promise<DomainResult | null> {
    const props = "MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES";
    const url = `${PUBCHEM_API}/compound/cid/${sourceId}/property/${props}/JSON`;

    const resp = await Zotero.HTTP.request("GET", url, {
      headers: { ...ZSEARCH_HTTP_HEADERS },
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

    const prop = data?.PropertyTable?.Properties?.[0];
    if (!prop) return null;

    return {
      title: prop.IUPACName || `CID ${sourceId}`,
      url: `https://pubchem.ncbi.nlm.nih.gov/compound/${sourceId}`,
      snippet: `${prop.MolecularFormula || ""} | MW: ${prop.MolecularWeight ?? 0}`,
      source: "pubchem",
      sourceId,
      dedupKey: `pubchem:${sourceId}`,
      metrics: {
        molecularWeight: prop.MolecularWeight ?? 0,
      },
      extra: {
        cid: sourceId,
        molecularFormula: prop.MolecularFormula || "",
        molecularWeight: prop.MolecularWeight ?? 0,
        iupacName: prop.IUPACName || "",
        smiles: prop.CanonicalSMILES || prop.SMILES || "",
      },
    };
  }
}
