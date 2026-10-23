/**
 * DomainRegistry — 学术子域搜索的注册装配点。
 *
 * 集中注册 Phase 1 的两个域（patent / dataset）及其源适配器、富集钩子、
 * 去重键计算、Zotero itemType 映射。后续 Phase 2-4 的 researcher / grant /
 * oa-fulltext 域在此文件追加注册即可，不改总线。
 *
 * 导入本模块即完成注册（副作用模块）——HubLiteratureHandler 在顶层
 * import 它以确保 domain.search 可用。
 *
 * @module core/search/DomainRegistry
 */

import { registerDomain, registerDomainAdapter } from "./DomainSearchEngine";
import type { DomainDef, DomainResult } from "./domainTypes";
import { normalizePatentNumber } from "../patent/PatentNumberNormalizer";
import { EpoPatentAdapter } from "../sources/patent-search/epo";
import { GooglePatentsAdapter } from "../sources/patent-search/google-patents";
import { UsptoPatentAdapter } from "../sources/patent-search/uspto";
import { WipoPatentAdapter } from "../sources/patent-search/wipo";
import { enrichPatentResults } from "../sources/patent-search/enricher";
import { HuggingFaceDatasetAdapter } from "../sources/dataset-search/huggingface";
import { ZenodoDatasetAdapter } from "../sources/dataset-search/zenodo";
import { KaggleDatasetAdapter } from "../sources/dataset-search/kaggle";
import { UciDatasetAdapter } from "../sources/dataset-search/uci";
import { OpenMLDatasetAdapter } from "../sources/dataset-search/openml";
import { DryadDatasetAdapter } from "../sources/dataset-search/dryad";
import { DataCiteSearchAdapter } from "../sources/dataset-search/datacite-search";
import { Re3dataAdapter } from "../sources/dataset-search/re3data/re3data";
import { FigshareAdapter } from "../sources/dataset-search/figshare/figshare";
import { DataverseAdapter } from "../sources/dataset-search/dataverse/dataverse";
import { OsfAdapter } from "../sources/dataset-search/osf/osf";
import { WorldBankAdapter } from "../sources/dataset-search/worldbank/worldbank";
import { GbifAdapter } from "../sources/dataset-search/gbif/gbif";
import { WhoGhoAdapter } from "../sources/dataset-search/who/who";
import { OecdAdapter } from "../sources/dataset-search/oecd/oecd";
import { NasaOpenDataAdapter } from "../sources/dataset-search/nasa/nasa";
import { EurostatAdapter } from "../sources/dataset-search/eurostat/eurostat";
import { ImfAdapter } from "../sources/dataset-search/imf/imf";
import { UkDataServiceAdapter } from "../sources/dataset-search/ukds/ukds";
import { enrichDatasetResults } from "../sources/dataset-search/enricher";
import { OpenAlexAuthorAdapter } from "../sources/researcher-search/openalex-author";
import { OpenAlexInstitutionAdapter } from "../sources/researcher-search/openalex-institution";
import { OrcidAdapter } from "../sources/researcher-search/orcid";
import { SemanticScholarAuthorAdapter } from "../sources/researcher-search/semantic-scholar-author";
import { enrichResearcherResults } from "../sources/researcher-search/enricher";
import { NsfGrantAdapter } from "../sources/grant-search/nsf";
import { CordisGrantAdapter } from "../sources/grant-search/cordis";
import { NihGrantAdapter } from "../sources/grant-search/nih";
import { enrichGrantResults } from "../sources/grant-search/enricher";
import { ClinicalTrialsAdapter } from "../sources/clinicaltrial-search/clinicaltrials";
import { enrichClinicalTrialResults } from "../sources/clinicaltrial-search/enricher";
import { OatdAdapter } from "../sources/thesis-search/oatd";
import { DblpAdapter } from "../sources/dblp-search/dblp";
import { UnpaywallAdapter } from "../sources/oa-fulltext-search/unpaywall";
import { ChemRxivAdapter } from "../sources/preprint-search/chemrxiv";
import { SocArxivAdapter } from "../sources/preprint-search/socarxiv";
import { enrichPreprintResults } from "../sources/preprint-search/enricher";
import { GeoAdapter } from "../sources/bio-search/geo";
import { PubChemAdapter } from "../sources/chem-search/pubchem";
import { PangaeaAdapter } from "../sources/geoscience-search/pangaea";
import { IcpsrAdapter } from "../sources/social-science-search/icpsr";
import { enrichDomainResults } from "../sources/bio-search/enricher";
import { InspireHepAdapter } from "../sources/physics-search/inspire/inspire";
import { NasaAdsAdapter } from "../sources/physics-search/ads/ads";
import { ZbmathAdapter } from "../sources/math-search/zbmath/zbmath";
import { RepecAdapter } from "../sources/econ-search/repec/repec";
import { enrichPhysicsMathEconResults } from "../sources/physics-search/enricher";

// ─────────────────────────────────────────────────────────────
// 专利域
// ─────────────────────────────────────────────────────────────

const patentDef: DomainDef = {
  id: "patent",
  label: "Patents",
  sources: ["epo", "google-patents", "uspto", "wipo"],
  dedupKey: (r: DomainResult) => r.patentNumber || "",
  importItemType: "patent",
  enrich: enrichPatentResults,
  fields: [
    {
      key: "consumerKey",
      prefKey: "apis.epo.consumerKey",
      label: "EPO Consumer Key",
      secret: true,
    },
    {
      key: "consumerSecret",
      prefKey: "apis.epo.consumerSecret",
      label: "EPO Consumer Secret",
      secret: true,
    },
  ],
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.patentNumber) fields["Patent Number"] = r.patentNumber;
    if (Array.isArray(r.extra?.applicants) && r.extra.applicants.length) {
      fields["Assignees"] = r.extra.applicants.join("; ");
    }
    if (Array.isArray(r.extra?.inventors) && r.extra.inventors.length) {
      fields["Inventors"] = r.extra.inventors.join("; ");
    }
    if (Array.isArray(r.extra?.ipcClasses) && r.extra.ipcClasses.length) {
      fields["IPC/CPC"] = r.extra.ipcClasses.join("; ");
    }
    if (r.extra?.applicationDate) {
      fields["Application Date"] = r.extra.applicationDate;
    }
    if (r.extra?.legalStatus) {
      fields["Legal Status"] = r.extra.legalStatus;
    }
    if (r.metrics?.citations) {
      fields["Citations"] = String(r.metrics.citations);
    }
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 数据集域
// ─────────────────────────────────────────────────────────────

const datasetDef: DomainDef = {
  id: "dataset",
  label: "Datasets",
  sources: [
    "huggingface",
    "zenodo",
    "kaggle",
    "uci",
    "openml",
    "dryad",
    "datacite-search",
    "re3data",
    "figshare",
    "dataverse",
    "osf",
    "worldbank",
    "gbif",
    "who-gho",
    "oecd",
    "nasa",
    "eurostat",
    "imf",
    "ukds",
    // 学科专用源：适配器归属 bio/chemistry/geoscience/social-science 域，
    // 由 DomainSearchEngine 的跨域索引在 dataset 域下解析（前端数据集
    // 标签页的学科分组按源 id 引用它们）。
    "geo",
    "pubchem",
    "pangaea",
    "icpsr",
  ],
  dedupKey: (r: DomainResult) =>
    r.doi || (r.sourceId ? `${r.source}:${r.sourceId}` : ""),
  importItemType: "dataset",
  enrich: enrichDatasetResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.doi) fields["DOI"] = r.doi;
    if (Array.isArray(r.extra?.creators) && r.extra.creators.length) {
      fields["Creators"] = r.extra.creators.join("; ");
    }
    if (r.extra?.license) fields["License"] = r.extra.license;
    if (r.extra?.publisher) fields["Publisher"] = r.extra.publisher;
    if (Array.isArray(r.extra?.taskTags) && r.extra.taskTags.length) {
      fields["Task Tags"] = r.extra.taskTags.join("; ");
    }
    if (r.metrics?.downloads) {
      fields["Downloads"] = String(r.metrics.downloads);
    }
    if (r.metrics?.likes) fields["Likes"] = String(r.metrics.likes);
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 研究者域
// ─────────────────────────────────────────────────────────────

const researcherDef: DomainDef = {
  id: "researcher",
  label: "Researchers",
  sources: [
    "openalex-author",
    "openalex-institution",
    "orcid",
    "semantic-scholar-author",
  ],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "person",
  enrich: enrichResearcherResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.extra?.orcid) fields["ORCID"] = r.extra.orcid;
    if (r.metrics?.hIndex) fields["H-Index"] = String(r.metrics.hIndex);
    if (r.metrics?.i10Index) fields["I10-Index"] = String(r.metrics.i10Index);
    if (r.metrics?.citations) fields["Citations"] = String(r.metrics.citations);
    if (r.metrics?.works) fields["Works"] = String(r.metrics.works);
    if (Array.isArray(r.extra?.institutions) && r.extra.institutions.length) {
      fields["Institutions"] = r.extra.institutions.join("; ");
    }
    if (Array.isArray(r.extra?.topics) && r.extra.topics.length) {
      fields["Research Areas"] = r.extra.topics.join("; ");
    }
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 基金项目域
// ─────────────────────────────────────────────────────────────

const grantDef: DomainDef = {
  id: "grant",
  label: "Grants",
  sources: ["nsf", "cordis", "nih"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "note",
  enrich: enrichGrantResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.dedupKey) fields["Grant ID"] = r.dedupKey;
    if (r.extra?.pi) fields["Principal Investigator"] = r.extra.pi;
    if (r.extra?.institution) fields["Institution"] = r.extra.institution;
    if (r.extra?.fundingAgency)
      fields["Funding Agency"] = r.extra.fundingAgency;
    if (r.extra?.amountFormatted) fields["Amount"] = r.extra.amountFormatted;
    if (r.extra?.period) fields["Period"] = r.extra.period;
    if (r.extra?.statusNormalized) fields["Status"] = r.extra.statusNormalized;
    if (r.extra?.frameworkProgramme)
      fields["Framework"] = r.extra.frameworkProgramme;
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 临床试验域
// ─────────────────────────────────────────────────────────────

const clinicalTrialDef: DomainDef = {
  id: "clinicaltrial",
  label: "Clinical Trials",
  sources: ["clinicaltrials"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "journalArticle",
  enrich: enrichClinicalTrialResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.dedupKey) fields["NCT ID"] = r.dedupKey;
    if (r.extra?.status) fields["Status"] = r.extra.status;
    if (Array.isArray(r.extra?.conditions) && r.extra.conditions.length) {
      fields["Conditions"] = r.extra.conditions.join("; ");
    }
    if (Array.isArray(r.extra?.interventions) && r.extra.interventions.length) {
      fields["Interventions"] = r.extra.interventions.join("; ");
    }
    if (r.extra?.sponsor) fields["Sponsor"] = r.extra.sponsor;
    if (r.extra?.phaseDisplay) fields["Phase"] = r.extra.phaseDisplay;
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 学位论文域
// ─────────────────────────────────────────────────────────────

const thesisDef: DomainDef = {
  id: "thesis",
  label: "Theses",
  sources: ["oatd"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "thesis",
  enrich: undefined,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.extra?.degree) fields["Degree"] = r.extra.degree;
    if (r.extra?.institution) fields["Institution"] = r.extra.institution;
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 计算机文献域
// ─────────────────────────────────────────────────────────────

const dblpDef: DomainDef = {
  id: "dblp",
  label: "CS Bibliography",
  sources: ["dblp"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "conferencePaper",
  enrich: undefined,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.extra?.venue) fields["Venue"] = r.extra.venue;
    if (r.extra?.type) fields["Publication Type"] = r.extra.type;
    if (r.extra?.doi) fields["DOI"] = r.extra.doi;
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 开放获取全文域
// ─────────────────────────────────────────────────────────────

const oaFulltextDef: DomainDef = {
  id: "oa-fulltext",
  label: "Open Access",
  sources: ["unpaywall"],
  dedupKey: (r: DomainResult) => r.doi || "",
  importItemType: "journalArticle",
  enrich: undefined,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.extra?.oaStatus) fields["OA Status"] = r.extra.oaStatus;
    if (r.extra?.license) fields["License"] = r.extra.license;
    if (r.extra?.repository) fields["Repository"] = r.extra.repository;
    if (r.extra?.bestPdfUrl) fields["PDF URL"] = r.extra.bestPdfUrl;
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 预印本域
// ─────────────────────────────────────────────────────────────

const preprintDef: DomainDef = {
  id: "preprint",
  label: "Preprints",
  sources: ["chemrxiv", "socarxiv"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "preprint",
  enrich: enrichPreprintResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.doi) fields["DOI"] = r.doi;
    if (Array.isArray(r.extra?.authors) && r.extra.authors.length) {
      fields["Authors"] = r.extra.authors.join("; ");
    }
    if (r.extra?.publishedDate) fields["Published"] = r.extra.publishedDate;
    fields["Peer Reviewed"] = "No";
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 生命科学域（GEO 基因表达数据）
// ─────────────────────────────────────────────────────────────

const bioDef: DomainDef = {
  id: "bio",
  label: "Life Sciences",
  sources: ["geo"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "dataset",
  enrich: enrichDomainResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.extra?.accession) fields["Accession"] = r.extra.accession;
    if (r.extra?.platform) fields["Platform"] = r.extra.platform;
    if (r.extra?.organism) fields["Organism"] = r.extra.organism;
    if (r.extra?.entryType) fields["Data Type"] = r.extra.entryType;
    if (r.metrics?.samples) fields["Samples"] = String(r.metrics.samples);
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 化学域（PubChem 分子数据）
// ─────────────────────────────────────────────────────────────

const chemistryDef: DomainDef = {
  id: "chemistry",
  label: "Chemistry",
  sources: ["pubchem"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "dataset",
  enrich: enrichDomainResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.extra?.cid) fields["PubChem CID"] = r.extra.cid;
    if (r.extra?.molecularFormula) fields["Formula"] = r.extra.molecularFormula;
    if (r.extra?.molecularWeight)
      fields["MW"] = String(r.extra.molecularWeight);
    if (r.extra?.iupacName) fields["IUPAC Name"] = r.extra.iupacName;
    if (r.extra?.smiles) fields["SMILES"] = r.extra.smiles;
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 地球科学域（PANGAEA 数据）
// ─────────────────────────────────────────────────────────────

const geoscienceDef: DomainDef = {
  id: "geoscience",
  label: "Geosciences",
  sources: ["pangaea"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "dataset",
  enrich: enrichDomainResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.extra?.doi) fields["DOI"] = r.extra.doi;
    if (Array.isArray(r.extra?.authors) && r.extra.authors.length) {
      fields["Authors"] = r.extra.authors.join("; ");
    }
    if (r.extra?.license) fields["License"] = r.extra.license;
    if (Array.isArray(r.extra?.topics) && r.extra.topics.length) {
      fields["Topics"] = r.extra.topics.join("; ");
    }
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 社会科学域（ICPSR 数据）
// ─────────────────────────────────────────────────────────────

const socialScienceDef: DomainDef = {
  id: "social-science",
  label: "Social Sciences",
  sources: ["icpsr"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "dataset",
  enrich: enrichDomainResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.extra?.geographicCoverage)
      fields["Geographic Coverage"] = r.extra.geographicCoverage;
    if (r.extra?.timePeriod) fields["Time Period"] = r.extra.timePeriod;
    if (Array.isArray(r.extra?.topics) && r.extra.topics.length) {
      fields["Topics"] = r.extra.topics.join("; ");
    }
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 物理域（INSPIRE-HEP + NASA ADS）
// ─────────────────────────────────────────────────────────────

const physicsDef: DomainDef = {
  id: "physics",
  label: "Physics",
  sources: ["inspire", "nasa-ads"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "journalArticle",
  enrich: enrichPhysicsMathEconResults,
  fields: [
    {
      key: "adsApiToken",
      prefKey: "search.physics.adsApiToken",
      label: "NASA ADS API Token",
      secret: true,
    },
  ],
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.extra?.arxivId) fields["arXiv"] = r.extra.arxivId;
    if (r.extra?.bibcode) fields["Bibcode"] = r.extra.bibcode;
    if (
      Array.isArray(r.extra?.collaborations) &&
      r.extra.collaborations.length
    ) {
      fields["Collaborations"] = r.extra.collaborations.join("; ");
    }
    if (r.metrics?.citations) fields["Citations"] = String(r.metrics.citations);
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 数学域（zbMATH Open）
// ─────────────────────────────────────────────────────────────

const mathDef: DomainDef = {
  id: "mathematics",
  label: "Mathematics",
  sources: ["zbmath"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "journalArticle",
  enrich: enrichPhysicsMathEconResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (Array.isArray(r.extra?.msc) && r.extra.msc.length) {
      fields["MSC Classification"] = r.extra.msc.join("; ");
    }
    if (Array.isArray(r.extra?.keywords) && r.extra.keywords.length) {
      fields["Keywords"] = r.extra.keywords.join("; ");
    }
    if (r.extra?.serial) fields["Serial"] = r.extra.serial;
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 经济学域（RePEc/IDEAS）
// ─────────────────────────────────────────────────────────────

const econDef: DomainDef = {
  id: "economics",
  label: "Economics",
  sources: ["repec"],
  dedupKey: (r: DomainResult) => r.dedupKey || "",
  importItemType: "journalArticle",
  enrich: enrichPhysicsMathEconResults,
  buildExtraFields: (r: DomainResult) => {
    const fields: Record<string, string> = {};
    if (r.extra?.handle) fields["RePEc Handle"] = r.extra.handle;
    return fields;
  },
};

// ─────────────────────────────────────────────────────────────
// 注册（副作用模块）
// ─────────────────────────────────────────────────────────────

registerDomain(patentDef);
registerDomain(datasetDef);
registerDomain(researcherDef);
registerDomain(grantDef);
registerDomain(clinicalTrialDef);
registerDomain(thesisDef);
registerDomain(dblpDef);
registerDomain(oaFulltextDef);
registerDomain(preprintDef);
registerDomain(bioDef);
registerDomain(chemistryDef);
registerDomain(geoscienceDef);
registerDomain(socialScienceDef);
registerDomain(physicsDef);
registerDomain(mathDef);
registerDomain(econDef);

registerDomainAdapter(new EpoPatentAdapter());
registerDomainAdapter(new GooglePatentsAdapter());
registerDomainAdapter(new UsptoPatentAdapter());
registerDomainAdapter(new WipoPatentAdapter());
registerDomainAdapter(new HuggingFaceDatasetAdapter());
registerDomainAdapter(new ZenodoDatasetAdapter());
registerDomainAdapter(new KaggleDatasetAdapter());
registerDomainAdapter(new UciDatasetAdapter());
registerDomainAdapter(new OpenMLDatasetAdapter());
registerDomainAdapter(new DryadDatasetAdapter());
registerDomainAdapter(new DataCiteSearchAdapter());
registerDomainAdapter(new Re3dataAdapter());
registerDomainAdapter(new FigshareAdapter());
registerDomainAdapter(new DataverseAdapter());
registerDomainAdapter(new OsfAdapter());
registerDomainAdapter(new WorldBankAdapter());
registerDomainAdapter(new GbifAdapter());
registerDomainAdapter(new WhoGhoAdapter());
registerDomainAdapter(new OecdAdapter());
registerDomainAdapter(new NasaOpenDataAdapter());
registerDomainAdapter(new EurostatAdapter());
registerDomainAdapter(new ImfAdapter());
registerDomainAdapter(new UkDataServiceAdapter());
registerDomainAdapter(new OpenAlexAuthorAdapter());
registerDomainAdapter(new OpenAlexInstitutionAdapter());
registerDomainAdapter(new OrcidAdapter());
registerDomainAdapter(new SemanticScholarAuthorAdapter());
registerDomainAdapter(new NsfGrantAdapter());
registerDomainAdapter(new CordisGrantAdapter());
registerDomainAdapter(new NihGrantAdapter());
registerDomainAdapter(new ClinicalTrialsAdapter());
registerDomainAdapter(new OatdAdapter());
registerDomainAdapter(new DblpAdapter());
registerDomainAdapter(new UnpaywallAdapter());
registerDomainAdapter(new ChemRxivAdapter());
registerDomainAdapter(new SocArxivAdapter());
registerDomainAdapter(new GeoAdapter());
registerDomainAdapter(new PubChemAdapter());
registerDomainAdapter(new PangaeaAdapter());
registerDomainAdapter(new IcpsrAdapter());
registerDomainAdapter(new InspireHepAdapter());
registerDomainAdapter(new NasaAdsAdapter());
registerDomainAdapter(new ZbmathAdapter());
registerDomainAdapter(new RepecAdapter());

/** 导出归一化专利号供 handler 复用（保持单一 import 点）。 */
export { normalizePatentNumber };
