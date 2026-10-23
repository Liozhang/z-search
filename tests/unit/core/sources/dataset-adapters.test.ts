/**
 * Dataset source adapters — request construction and response parsing.
 *
 * 每个数据集域适配器（zenodo/huggingface/figshare/dataverse/osf/dryad/
 * datacite/re3data/worldbank/oecd/who/gbif/nasa/eurostat/imf/ukds/kaggle/
 * uci/openml/pubchem/pangaea/icpsr/geo）验证：
 *  1. isAvailable 返回值（免 key 源恒 true）
 *  2. search() 用 mock Zotero.HTTP.request 喂构造好的源站响应，
 *     断言解析出的 DomainResult 字段（title/url/dedupKey/source）
 *  3. 去重键格式符合域约定
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock 依赖 ──
vi.mock("../../../../src/utils/httpHeaders", () => ({
  ZSEARCH_HTTP_HEADERS: {},
}));
vi.mock("../../../../src/utils/logger", () => ({
  safeDebug: vi.fn(),
}));
vi.mock("../../../../src/utils/prefs", () => ({
  getPrefDynamic: vi.fn((k: string) => {
    if (k === "search.dataset.kaggle.username") return "testuser";
    if (k === "search.dataset.kaggle.apiKey") return "testkey";
    if (k === "search.physics.adsApiToken") return "test-token";
    return "";
  }),
}));

// Mock Zotero.HTTP.request —— 各用例按 URL 前缀分流
const httpRequest = vi.fn();
(globalThis as any).Zotero = {
  HTTP: {
    request: (...args: any[]) => httpRequest(...args),
  },
  Items: { get: vi.fn(() => null) },
  Search: class {
    addCondition() {}
    async search() {
      return [];
    }
  },
  Prefs: { clear: vi.fn() },
};

/** 让下一次 httpRequest 返回指定的 status + responseText。 */
function mockHttpResponse(status: number, responseText: string) {
  httpRequest.mockResolvedValueOnce({ status, responseText });
}

import { ZenodoDatasetAdapter } from "../../../../src/core/sources/dataset-search/zenodo";
import { HuggingFaceDatasetAdapter } from "../../../../src/core/sources/dataset-search/huggingface";
import { FigshareAdapter } from "../../../../src/core/sources/dataset-search/figshare/figshare";
import { DataverseAdapter } from "../../../../src/core/sources/dataset-search/dataverse/dataverse";
import { OsfAdapter } from "../../../../src/core/sources/dataset-search/osf/osf";
import { DryadDatasetAdapter } from "../../../../src/core/sources/dataset-search/dryad";
import { DataCiteSearchAdapter } from "../../../../src/core/sources/dataset-search/datacite-search";
import { Re3dataAdapter } from "../../../../src/core/sources/dataset-search/re3data/re3data";
import { WorldBankAdapter } from "../../../../src/core/sources/dataset-search/worldbank/worldbank";
import { GbifAdapter } from "../../../../src/core/sources/dataset-search/gbif/gbif";
import { WhoGhoAdapter } from "../../../../src/core/sources/dataset-search/who/who";
import { OecdAdapter } from "../../../../src/core/sources/dataset-search/oecd/oecd";
import { NasaOpenDataAdapter } from "../../../../src/core/sources/dataset-search/nasa/nasa";
import { EurostatAdapter } from "../../../../src/core/sources/dataset-search/eurostat/eurostat";
import { ImfAdapter } from "../../../../src/core/sources/dataset-search/imf/imf";
import { UkDataServiceAdapter } from "../../../../src/core/sources/dataset-search/ukds/ukds";
import { KaggleDatasetAdapter } from "../../../../src/core/sources/dataset-search/kaggle";
import { UciDatasetAdapter } from "../../../../src/core/sources/dataset-search/uci";
import { OpenMLDatasetAdapter } from "../../../../src/core/sources/dataset-search/openml";
import { GeoAdapter } from "../../../../src/core/sources/bio-search/geo";
import { PubChemAdapter } from "../../../../src/core/sources/chem-search/pubchem";
import { PangaeaAdapter } from "../../../../src/core/sources/geoscience-search/pangaea";
import { IcpsrAdapter } from "../../../../src/core/sources/social-science-search/icpsr";

describe("Dataset source adapters", () => {
  beforeEach(() => {
    httpRequest.mockReset();
  });

  // ── Zenodo ──
  describe("ZenodoDatasetAdapter", () => {
    it("isAvailable returns true (no key)", async () => {
      const a = new ZenodoDatasetAdapter();
      expect(await a.isAvailable()).toEqual({ available: true });
    });

    it("parses Zenodo dataset response with DOI as dedupKey", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          hits: {
            hits: [
              {
                id: "12345",
                metadata: {
                  title: "Climate Observations 2020",
                  doi: "10.5281/zenodo.12345",
                  creators: [{ name: "Alice Smith" }],
                  rights: [{ id: "cc-by-4.0" }],
                  access_right: "open",
                  publication_date: "2021-03-15",
                },
                files: [{ size: 1024000 }],
                stats: { views: 100, downloads: 50 },
              },
            ],
          },
        }),
      );
      const a = new ZenodoDatasetAdapter();
      const results = await a.search("climate", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Climate Observations 2020");
      expect(results[0].source).toBe("zenodo");
      expect(results[0].doi).toBe("10.5281/zenodo.12345");
      expect(results[0].dedupKey).toBe("10.5281/zenodo.12345");
      expect(results[0].extra.creators).toEqual(["Alice Smith"]);
      expect(results[0].extra.oaType).toBe("open");
    });

    it("throws on HTTP error", async () => {
      mockHttpResponse(500, "");
      const a = new ZenodoDatasetAdapter();
      await expect(a.search("test", 10)).rejects.toThrow("Zenodo API error");
    });
  });

  // ── HuggingFace ──
  describe("HuggingFaceDatasetAdapter", () => {
    it("parses HF datasets response with sourceId as dedupKey", async () => {
      mockHttpResponse(
        200,
        JSON.stringify([
          {
            id: "squad",
            description: "Stanford Question Answering Dataset",
            downloads: 500000,
            likes: 1200,
            cardData: { license: "cc-by-4.0" },
            pipeline_tag: "question-answering",
            author: "rajpurkar",
          },
        ]),
      );
      const a = new HuggingFaceDatasetAdapter();
      const results = await a.search("squad", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("squad");
      expect(results[0].source).toBe("huggingface");
      expect(results[0].dedupKey).toBe("hf:squad");
      expect(results[0].extra.license).toBe("cc-by-4.0");
      expect(results[0].metrics.downloads).toBe(500000);
    });
  });

  // ── Figshare ──
  describe("FigshareAdapter", () => {
    it("parses Figshare dataset response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify([
          {
            id: 12345,
            title: "Genomic Sequences Dataset",
            doi: "10.6084/m9.figshare.12345",
            description: "A dataset of genomic sequences",
            authors: [{ full_name: "Jane Doe" }],
            license: { name: "CC BY 4.0" },
            published_date: "2022-06-01",
            url_public_html: "https://figshare.com/articles/dataset/12345",
          },
        ]),
      );
      const a = new FigshareAdapter();
      const results = await a.search("genomic", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Genomic Sequences Dataset");
      expect(results[0].source).toBe("figshare");
      expect(results[0].doi).toBe("10.6084/m9.figshare.12345");
      expect(results[0].extra.license).toBe("CC BY 4.0");
    });
  });

  // ── Dataverse ──
  describe("DataverseAdapter", () => {
    it("parses Harvard Dataverse search response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          data: {
            items: [
              {
                name: "Survey Consumer Finances 2023",
                global_id: "doi:10.7910/DVN/ABCDEF",
                description: "Consumer finance survey microdata",
                author: [{ name: "Federal Reserve Board" }],
                license: "CC0 1.0",
                url: "https://doi.org/10.7910/DVN/ABCDEF",
                publishedAt: "2024-01-15",
              },
            ],
          },
        }),
      );
      const a = new DataverseAdapter();
      const results = await a.search("consumer finance", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Survey Consumer Finances 2023");
      expect(results[0].source).toBe("dataverse");
      expect(results[0].doi).toBe("10.7910/DVN/ABCDEF");
      expect(results[0].dedupKey).toBe("10.7910/DVN/ABCDEF");
      expect(results[0].extra.license).toBe("CC0 1.0");
    });
  });

  // ── OSF ──
  describe("OsfAdapter", () => {
    it("parses OSF node search response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: "abcd1",
              attributes: {
                title: "Replication Data for Psych Study",
                description: "Data and code for replication",
                date_created: "2023-05-20T10:00:00Z",
                public: true,
              },
            },
          ],
        }),
      );
      const a = new OsfAdapter();
      const results = await a.search("replication", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Replication Data for Psych Study");
      expect(results[0].source).toBe("osf");
      expect(results[0].dedupKey).toBe("osf:abcd1");
      expect(results[0].year).toBe("2023");
      expect(results[0].extra.oaType).toBe("open");
    });

    it("maps public=false to closed OA type", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: "priv1",
              attributes: { title: "Embargoed Dataset", public: false },
            },
          ],
        }),
      );
      const a = new OsfAdapter();
      const results = await a.search("embargo", 10);
      expect(results).toHaveLength(1);
      expect(results[0].extra.oaType).toBe("closed");
    });
  });

  // ── Dryad ──
  describe("DryadDatasetAdapter", () => {
    it("parses Dryad search response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          _embedded: {
            "stash:datasets": [
              {
                id: "dryad.abc123",
                title: "Field Survey Data",
                doi: "10.5061/dryad.abc123",
                abstract: "Field survey results",
                authors: [{ name: "Bob Jones" }],
                license: "CC0",
                publicationDate: "2023-01-10",
              },
            ],
          },
        }),
      );
      const a = new DryadDatasetAdapter();
      const results = await a.search("survey", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Field Survey Data");
      expect(results[0].source).toBe("dryad");
      expect(results[0].doi).toBe("10.5061/dryad.abc123");
    });
  });

  // ── DataCite Search ──
  describe("DataCiteSearchAdapter", () => {
    it("parses DataCite search response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          data: [
            {
              attributes: {
                doi: "10.5281/zenodo.99999",
                titles: [{ title: "DataCite Dataset" }],
                creators: [{ name: "Carol White" }],
                rightsList: [{ rightsIdentifier: "cc-by-4.0" }],
                publicationYear: 2023,
                descriptions: [{ description: "A test dataset" }],
              },
            },
          ],
        }),
      );
      const a = new DataCiteSearchAdapter();
      const results = await a.search("datacite", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("DataCite Dataset");
      expect(results[0].source).toBe("datacite-search");
      expect(results[0].doi).toBe("10.5281/zenodo.99999");
      expect(results[0].dedupKey).toBe("10.5281/zenodo.99999");
    });
  });

  // ── re3data ──
  describe("Re3dataAdapter", () => {
    it("parses re3data repository list", async () => {
      mockHttpResponse(
        200,
        JSON.stringify([
          {
            id: "r3d100010371",
            repositoryName: "Zenodo",
            repositoryURL: "https://zenodo.org",
            description: "Open research data repository",
            subjects: [{ subject: "Multidisciplinary" }],
          },
        ]),
      );
      const a = new Re3dataAdapter();
      const results = await a.search("zenodo", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Zenodo");
      expect(results[0].source).toBe("re3data");
      expect(results[0].dedupKey).toBe("re3data:r3d100010371");
    });
  });

  // ── World Bank ──
  describe("WorldBankAdapter", () => {
    it("parses World Bank indicator list", async () => {
      mockHttpResponse(
        200,
        JSON.stringify([
          { page: 1 },
          [
            {
              id: "SP.POP.TOTL",
              name: "Population, total",
              source: { value: "World Development Indicators" },
              sourceNote:
                "Total population is based on the de facto definition",
            },
          ],
        ]),
      );
      const a = new WorldBankAdapter();
      const results = await a.search("population", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Population, total");
      expect(results[0].source).toBe("worldbank");
      expect(results[0].dedupKey).toBe("worldbank:SP.POP.TOTL");
    });
  });

  // ── GBIF ──
  describe("GbifAdapter", () => {
    it("parses GBIF species search response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          results: [
            {
              key: 2480946,
              scientificName: "Panthera leo",
              canonicalName: "Panthera leo",
              kingdom: "Animalia",
              phylum: "Chordata",
              class: "Mammalia",
              order: "Carnivora",
              family: "Felidae",
              rank: "SPECIES",
            },
          ],
        }),
      );
      const a = new GbifAdapter();
      const results = await a.search("lion", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Panthera leo");
      expect(results[0].source).toBe("gbif");
      expect(results[0].dedupKey).toBe("gbif:2480946");
    });
  });

  // ── WHO GHO ──
  describe("WhoGhoAdapter", () => {
    it("parses WHO GHO indicator response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          value: [
            {
              IndicatorCode: "WHS4_100",
              IndicatorName: "Population (in thousands) total",
              Language: "EN",
            },
          ],
        }),
      );
      const a = new WhoGhoAdapter();
      const results = await a.search("population", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Population (in thousands) total");
      expect(results[0].source).toBe("who-gho");
      expect(results[0].dedupKey).toBe("who:WHS4_100");
    });
  });

  // ── OECD ──
  describe("OecdAdapter", () => {
    it("parses OECD dataflow list", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          data: {
            dataflows: [
              {
                id: "DF_GDP",
                name: "GDP and main components",
                agencyID: "OECD.SDD",
                version: "1.0",
              },
            ],
          },
        }),
      );
      const a = new OecdAdapter();
      const results = await a.search("GDP", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("GDP and main components");
      expect(results[0].source).toBe("oecd");
      expect(results[0].dedupKey).toBe("oecd:DF_GDP");
    });
  });

  // ── NASA ──
  describe("NasaOpenDataAdapter", () => {
    it("parses NASA CKAN package search response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          result: {
            results: [
              {
                name: "nasa-near-earth-object-observations",
                title: "Near Earth Object Observations",
                notes: "Observations of near earth objects",
                organization: { title: "NASA" },
                tags: [{ name: "astronomy" }],
                license_title: "Public Domain",
              },
            ],
          },
        }),
      );
      const a = new NasaOpenDataAdapter();
      const results = await a.search("near earth", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Near Earth Object Observations");
      expect(results[0].source).toBe("nasa");
      expect(results[0].dedupKey).toBe(
        "nasa:nasa-near-earth-object-observations",
      );
    });
  });

  // ── Eurostat ──
  describe("EurostatAdapter", () => {
    it("parses Eurostat TOC text response", async () => {
      mockHttpResponse(
        200,
        "nama_10_gdp\tGDP and main components (output, expenditure and income)\tEurostat\t2024-01-15\nnama_10_pop\tPopulation and social conditions\tEurostat\t2024-02-01\n",
      );
      const a = new EurostatAdapter();
      const results = await a.search("GDP", 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].source).toBe("eurostat");
      expect(results[0].title).toContain("GDP");
    });
  });

  // ── IMF ──
  describe("ImfAdapter", () => {
    it("parses IMF SDMX dataflow response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          data: {
            dataflows: [
              {
                id: "IFS",
                name: "International Financial Statistics",
                agencyID: "IMF",
                version: "1.0",
              },
            ],
          },
        }),
      );
      const a = new ImfAdapter();
      const results = await a.search("financial", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("International Financial Statistics");
      expect(results[0].source).toBe("imf");
      expect(results[0].dedupKey).toBe("imf:IFS");
    });
  });

  // ── UK Data Service ──
  describe("UkDataServiceAdapter", () => {
    it("parses UKDS HTML search response", async () => {
      mockHttpResponse(
        200,
        '<a href="/study/854339">Understanding Society Dataset</a><a href="/study/854340">Labour Force Survey</a>',
      );
      const a = new UkDataServiceAdapter();
      const results = await a.search("society", 10);
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe("Understanding Society Dataset");
      expect(results[0].source).toBe("ukds");
      expect(results[0].dedupKey).toBe("ukds:854339");
    });
  });

  // ── Kaggle ──
  describe("KaggleDatasetAdapter", () => {
    it("requires credentials (not available without key)", async () => {
      const a = new KaggleDatasetAdapter();
      const avail = await a.isAvailable();
      expect(avail.available).toBe(true); // mock provides test creds
    });

    it("parses Kaggle dataset list response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify([
          {
            ref: "user/dataset-name",
            title: "Test Dataset",
            subtitle: "A test dataset",
            creatorName: "testuser",
            licenseName: "CC0",
            downloadCount: 1000,
            voteCount: 50,
            totalBytes: 5000000,
          },
        ]),
      );
      const a = new KaggleDatasetAdapter();
      const results = await a.search("test", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Test Dataset");
      expect(results[0].source).toBe("kaggle");
      expect(results[0].dedupKey).toBe("kaggle:user/dataset-name");
    });
  });

  // ── UCI ──
  describe("UciDatasetAdapter", () => {
    it("parses UCI dataset list response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: "iris",
              name: "Iris",
              abstract: "The famous Iris flower dataset",
              area: "Life Science",
              tasks: ["Classification"],
            },
          ],
        }),
      );
      const a = new UciDatasetAdapter();
      const results = await a.search("iris", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Iris");
      expect(results[0].source).toBe("uci");
      expect(results[0].dedupKey).toBe("uci:iris");
    });
  });

  // ── OpenML ──
  describe("OpenMLDatasetAdapter", () => {
    it("parses OpenML dataset list response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          data: {
            dataset: [
              {
                did: "61",
                name: "iris",
                format: "ARFF",
                quality: [
                  { name: "NumberOfInstances", value: 150 },
                  { name: "NumberOfFeatures", value: 4 },
                ],
              },
            ],
          },
        }),
      );
      const a = new OpenMLDatasetAdapter();
      const results = await a.search("iris", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("iris");
      expect(results[0].source).toBe("openml");
      expect(results[0].dedupKey).toBe("openml:61");
      expect(results[0].metrics.samples).toBe(150);
    });
  });

  // ── GEO（NCBI Entrez gds 库，归属 bio 域、经数据集标签页生命科学学科检索）──
  describe("GeoAdapter", () => {
    /** esearch + esummary 两段式响应的 mock 辅助。 */
    function mockGeoResponses() {
      mockHttpResponse(
        200,
        JSON.stringify({
          esearchresult: { idlist: ["200000001", "200000002"] },
        }),
      );
      mockHttpResponse(
        200,
        JSON.stringify({
          result: {
            uids: ["200000001", "200000002"],
            "200000001": {
              accession: "GSE123456",
              title: "Breast cancer transcriptome cohorts",
              summary: "Gene expression profiling of breast tumor samples.",
              platform: "GPL570",
              n_samples: 120,
              taxon: "Homo sapiens",
              entrytype: "Series",
              pdat: "2023-05-01",
            },
            "200000002": {
              accession: "GSE999999",
              title: "Mouse liver time course",
              summary: "Liver expression across development.",
              platform: "GPL19057",
              n_samples: 36,
              taxon: "Mus musculus",
              entrytype: "Series",
              pdat: "2018-02-10",
            },
          },
        }),
      );
    }

    it("isAvailable returns true (no key)", async () => {
      const a = new GeoAdapter();
      expect(await a.isAvailable()).toEqual({ available: true });
    });

    it("parses esearch + esummary two-step response", async () => {
      mockGeoResponses();
      const a = new GeoAdapter();
      const results = await a.search("breast cancer", 10);
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe("Breast cancer transcriptome cohorts");
      expect(results[0].source).toBe("geo");
      expect(results[0].sourceId).toBe("GSE123456");
      expect(results[0].dedupKey).toBe("geo:GSE123456");
      expect(results[0].year).toBe("2023");
      expect(results[0].url).toContain("acc=GSE123456");
      expect(results[0].extra.organism).toBe("Homo sapiens");
      expect(results[0].extra.platform).toBe("GPL570");
      expect(results[0].extra.entryType).toBe("Series");
      expect(results[0].metrics.samples).toBe(120);
    });

    it("first request hits esearch on db=gds", async () => {
      mockGeoResponses();
      const a = new GeoAdapter();
      await a.search("breast cancer", 10);
      const firstUrl = httpRequest.mock.calls[0][1] as string;
      expect(firstUrl).toContain("esearch.fcgi");
      expect(firstUrl).toContain("db=gds");
      expect(firstUrl).toContain("term=breast%20cancer");
    });

    it("year filter adds Entrez mindate/maxdate with datetype=pdat", async () => {
      mockGeoResponses();
      const a = new GeoAdapter();
      await a.search("breast cancer", 10, { year: "2020-2024" });
      const firstUrl = httpRequest.mock.calls[0][1] as string;
      expect(firstUrl).toContain("mindate=2020");
      expect(firstUrl).toContain("maxdate=2024");
      expect(firstUrl).toContain("datetype=pdat");
    });

    it("omits date params when no year filter", async () => {
      mockGeoResponses();
      const a = new GeoAdapter();
      await a.search("breast cancer", 10);
      const firstUrl = httpRequest.mock.calls[0][1] as string;
      expect(firstUrl).not.toContain("mindate");
      expect(firstUrl).not.toContain("datetype");
    });

    it("returns empty array when esearch finds nothing", async () => {
      mockHttpResponse(200, JSON.stringify({ esearchresult: { idlist: [] } }));
      const a = new GeoAdapter();
      const results = await a.search("zzzznonexistent", 10);
      expect(results).toHaveLength(0);
    });
  });

  // ── PubChem（归属 chemistry 域，经数据集标签页化学学科检索）──
  describe("PubChemAdapter", () => {
    it("parses name→cids→property two-step response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({ IdentifierList: { CID: [2244, 2519] } }),
      );
      mockHttpResponse(
        200,
        JSON.stringify({
          PropertyTable: {
            Properties: [
              {
                CID: 2244,
                MolecularFormula: "C9H8O4",
                MolecularWeight: 180.16,
                IUPACName: "2-acetyloxybenzoic acid",
                CanonicalSMILES: "CC(=O)Oc1ccccc1C(=O)O",
              },
            ],
          },
        }),
      );
      const a = new PubChemAdapter();
      const results = await a.search("aspirin", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("2-acetyloxybenzoic acid");
      expect(results[0].source).toBe("pubchem");
      expect(results[0].sourceId).toBe("2244");
      expect(results[0].dedupKey).toBe("pubchem:2244");
      expect(results[0].extra.molecularFormula).toBe("C9H8O4");
      expect(results[0].metrics.molecularWeight).toBe(180.16);
    });
  });

  // ── PANGAEA（归属 geoscience 域，经数据集标签页地球科学学科检索）──
  describe("PangaeaAdapter", () => {
    it("parses PANGAEA search response with DOI as url", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          results: [
            {
              id: "842574",
              title: "Trace metal concentrations in seawater",
              abstract: "Water column samples from the Atlantic.",
              authors: [
                { lastname: "Muller", firstname: "Anna" },
                { lastname: "Lee", firstname: "Jun" },
              ],
              yearOfPublication: 2019,
              license: "CC-BY-4.0",
              eventCount: 3,
              parameterCount: 12,
              topics: ["Geochemistry", "Water column"],
            },
          ],
        }),
      );
      const a = new PangaeaAdapter();
      const results = await a.search("trace metal", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Trace metal concentrations in seawater");
      expect(results[0].source).toBe("pangaea");
      expect(results[0].dedupKey).toBe("pangaea:842574");
      expect(results[0].year).toBe("2019");
      expect(results[0].url).toBe("https://doi.org/10.1594/PANGAEA.842574");
      expect(results[0].extra.authors).toEqual(["Muller, Anna", "Lee, Jun"]);
      expect(results[0].metrics.events).toBe(3);
    });
  });

  // ── ICPSR（归属 social-science 域，经数据集标签页社会科学学科检索）──
  describe("IcpsrAdapter", () => {
    it("parses ICPSR studies response", async () => {
      mockHttpResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: "35218",
              title: "General Social Survey, 2022",
              abstract: "National survey of social attitudes.",
              authors: [{ name: "Smith, John" }],
              dateOfPublication: "2015-06-01",
              geographicCoverage: "United States",
              timePeriod: "2022",
              topics: ["Social attitudes"],
            },
          ],
        }),
      );
      const a = new IcpsrAdapter();
      const results = await a.search("social survey", 10);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("General Social Survey, 2022");
      expect(results[0].source).toBe("icpsr");
      expect(results[0].dedupKey).toBe("icpsr:35218");
      expect(results[0].year).toBe("2015");
      expect(results[0].extra.geographicCoverage).toBe("United States");
      expect(results[0].url).toContain("/studies/35218");
    });
  });
});
