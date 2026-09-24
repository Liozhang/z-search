/**
 * 新增开放源 characterization — medRxiv / DOAJ / Zenodo / HAL。
 *
 * 网络缝 = `Zotero.HTTP.request`（host API）；时钟缝（openalex 节流）桩掉。
 * 钉四件事：
 *   - URL 形状（source filter / pageSize / type 过滤 / wt=json+fl）
 *   - 字段映射（含 DOAJ identifier/link 混装数组、HAL 多语言取最长、
 *     Zenodo 非论文过滤与 HTML 摘要剥除、medRxiv source 戳与 PDF 回退）
 *   - source id 戳记（统一 article 契约的 `source` 字段）
 *   - 失败形态（{success:false, articles:[]}，不抛）
 *
 * @module tests/unit/core/tool/openSources.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const prefs = new Map<string, string>();
  const calls: Array<{ method: string; url: string; options: any }> = [];
  let responder: (url: string) => { status: number; text: string } = () => ({
    status: 200,
    text: "{}",
  });
  (globalThis as any).Zotero = {
    debug: () => {},
    Prefs: { get: (key: string) => prefs.get(key) },
    HTTP: {
      request: vi.fn(async (method: string, url: string, options: any) => {
        calls.push({ method, url, options });
        const res = responder(url);
        return { status: res.status, responseText: res.text };
      }),
    },
  };
  return {
    prefs,
    calls,
    setResponder: (fn: (url: string) => { status: number; text: string }) => {
      responder = fn;
    },
  };
});

vi.mock("../../../../src/utils/openalexThrottle", () => ({
  openalexThrottle: async () => {},
}));

import { searchBiorxiv } from "../../../../src/core/sources/academic-search/biorxiv";
import { searchMedrxiv } from "../../../../src/core/sources/academic-search/medrxiv";
import { searchDoaj } from "../../../../src/core/sources/academic-search/doaj";
import { searchZenodo } from "../../../../src/core/sources/academic-search/zenodo";
import { searchHal } from "../../../../src/core/sources/academic-search/hal";

/** mapOpenAlexWork 可读的最小 work payload。 */
const WORK = {
  id: "https://openalex.org/W1",
  doi: "https://doi.org/10.1101/2024.01.01.000001",
  title: "A Preprint",
  publication_year: 2024,
  cited_by_count: 7,
  type: "preprint",
  abstract_inverted_index: { Hello: [0], world: [1] },
  authorships: [{ author: { display_name: "Ada Lovelace" } }],
  primary_location: {
    source: { display_name: "medRxiv", issn: ["1234-5678"] },
  },
  biblio: {},
  open_access: { oa_url: "" },
};

function lastUrl(): string {
  return h.calls[h.calls.length - 1].url;
}

beforeEach(() => {
  h.calls.length = 0;
  (
    (globalThis as any).Zotero.HTTP.request as ReturnType<typeof vi.fn>
  ).mockClear();
  h.setResponder(() => ({ status: 200, text: "{}" }));
});

describe("medRxiv（OpenAlex source 过滤通道）", () => {
  it("URL 带 medRxiv source filter，article 戳 source=medrxiv，pdf 无 oa_url 时按 DOI 回退落地页", async () => {
    h.setResponder(() =>
      // Zenodo/HAL 等共享 stub——这里只关心 openalex 请求
      ({
        status: 200,
        text: JSON.stringify({ results: [WORK], meta: { count: 1 } }),
      }),
    );
    const r = await searchMedrxiv({ query: "remdesivir", maxResults: 5 });
    expect(lastUrl()).toContain(
      "filter=primary_location.source.id:https://openalex.org/S3005729997",
    );
    expect(lastUrl()).toContain("sort=relevance_score:desc");
    expect(r.source).toBe("medrxiv");
    expect(r.articles[0].source).toBe("medrxiv");
    expect(r.articles[0].pdfUrl).toBe(
      "https://www.medrxiv.org/content/10.1101/2024.01.01.000001full.pdf",
    );
    expect(r.total).toBe(1);
  });

  it("bioRxiv 同通道：source filter 为 bioRxiv id，pdf 回退落 biorxiv.org", async () => {
    h.setResponder(() => ({
      status: 200,
      text: JSON.stringify({ results: [WORK], meta: { count: 1 } }),
    }));
    const r = await searchBiorxiv({ query: "organoids" });
    expect(lastUrl()).toContain(
      "filter=primary_location.source.id:https://openalex.org/S4306402567",
    );
    expect(r.articles[0].pdfUrl).toBe(
      "https://www.biorxiv.org/content/10.1101/2024.01.01.000001full.pdf",
    );
  });

  it("已有 oa_url 的 work 不做 PDF 回退", async () => {
    h.setResponder(() => ({
      status: 200,
      text: JSON.stringify({
        results: [
          { ...WORK, open_access: { oa_url: "https://oa.test/x.pdf" } },
        ],
        meta: { count: 1 },
      }),
    }));
    const r = await searchMedrxiv({ query: "x" });
    expect(r.articles[0].pdfUrl).toBe("https://oa.test/x.pdf");
  });

  it("HTTP 失败 → success:false + 空 articles（不抛）", async () => {
    h.setResponder(() => ({ status: 503, text: "" }));
    const r = await searchMedrxiv({ query: "x" });
    expect(r.success).toBe(false);
    expect(r.articles).toEqual([]);
    expect(r.source).toBe("medrxiv");
  });
});

describe("DOAJ", () => {
  const HIT = {
    bibjson: {
      title: "An OA Paper",
      abstract: "Open access content.",
      year: "2021",
      month: "6",
      start_page: "10",
      end_page: "20",
      author: [{ name: "Daun Jung" }, { name: "K. Lee" }],
      identifier: [
        { type: "pissn", id: "1111-1111" },
        { type: "doi", id: "10.1186/s13046-021-02089-0" },
      ],
      link: [
        {
          type: "fulltext",
          content_type: "HTML",
          url: "https://doi.org/10.1186/x",
        },
        {
          type: "fulltext",
          content_type: "PDF",
          url: "https://pdf.test/x.pdf",
        },
      ],
      journal: {
        title: "J Exp Clin Cancer Res",
        volume: "40",
        number: "1",
        issns: ["1756-9966"],
        publisher: "BMC",
      },
    },
  };

  it("URL 为 pageSize 查询；字段按 bibjson 映射（identifier/link 混装数组）", async () => {
    h.setResponder(() => ({
      status: 200,
      text: JSON.stringify({ total: 43649, results: [HIT] }),
    }));
    const r = await searchDoaj({
      query: "cancer immunotherapy",
      maxResults: 3,
    });
    expect(lastUrl()).toContain("doaj.org/api/search/articles/");
    expect(lastUrl()).toContain("pageSize=3");
    expect(r.total).toBe(43649);
    const a = r.articles[0];
    expect(a.doi).toBe("10.1186/s13046-021-02089-0");
    expect(a.pdfUrl).toBe("https://pdf.test/x.pdf");
    expect(a.oaUrl).toBe("https://doi.org/10.1186/x");
    expect(a.isOpenAccess).toBe(true);
    expect(a.pages).toBe("10-20");
    expect(a.journalName).toBe("J Exp Clin Cancer Res");
    expect(a.issn).toBe("1756-9966");
    expect(a.volume).toBe("40");
    expect(a.issue).toBe("1");
    expect(a.source).toBe("doaj");
  });

  it("无 PDF 链接的记录 pdfUrl 留空，url 落 DOI", async () => {
    h.setResponder(() => ({
      status: 200,
      text: JSON.stringify({
        total: 1,
        results: [
          {
            bibjson: {
              title: "T",
              year: "2020",
              identifier: [{ type: "doi", id: "10.1/y" }],
              link: [],
            },
          },
        ],
      }),
    }));
    const r = await searchDoaj({ query: "t" });
    expect(r.articles[0].pdfUrl).toBe("");
    expect(r.articles[0].url).toBe("https://doi.org/10.1/y");
  });
});

describe("Zenodo", () => {
  const REC = {
    links: { self_html: "https://zenodo.org/records/17131667" },
    metadata: {
      title: "P5424 RNA-seq tutorial datasets",
      doi: "10.5281/zenodo.17131667",
      publication_date: "2025-09-16",
      access_right: "open",
      creators: [{ name: "Denis Puthier" }],
      description: "<p>An <b>HTML</b> abstract &amp; notes</p>",
      resource_type: {
        title: "Journal article",
        type: "publication",
        subtype: "article",
      },
      journal: { title: "Zenodo", volume: "1", issue: "2", pages: "3-4" },
    },
  };

  it("URL 带 type=publication；映射 + HTML 摘要剥除 + source 戳", async () => {
    h.setResponder(() => ({
      status: 200,
      text: JSON.stringify({ hits: { hits: [REC], total: 42 } }),
    }));
    const r = await searchZenodo({ query: "rna-seq", maxResults: 2 });
    expect(lastUrl()).toContain("zenodo.org/api/records?q=rna-seq");
    expect(lastUrl()).toContain("type=publication");
    const a = r.articles[0];
    expect(a.abstract).toBe("An HTML abstract & notes");
    expect(a.isOpenAccess).toBe(true);
    expect(a.url).toBe("https://doi.org/10.5281/zenodo.17131667");
    expect(a.oaUrl).toBe("https://zenodo.org/records/17131667");
    expect(a.publicationType).toBe("article");
    expect(a.source).toBe("zenodo");
    expect(r.total).toBe(42);
  });

  it("数据集/软件记录被响应侧过滤掉", async () => {
    h.setResponder(() => ({
      status: 200,
      text: JSON.stringify({
        hits: {
          hits: [
            REC,
            {
              metadata: {
                title: "A dataset",
                resource_type: { type: "dataset" },
              },
            },
            {
              metadata: {
                title: "Software",
                resource_type: { type: "software" },
              },
            },
          ],
          total: 3,
        },
      }),
    }));
    const r = await searchZenodo({ query: "x" });
    expect(r.articles).toHaveLength(1);
    expect(r.articles[0].title).toBe("P5424 RNA-seq tutorial datasets");
  });
});

describe("HAL", () => {
  const DOC = {
    title_s: [
      "Court titre",
      "A much longer English title about RNA-seq methods",
    ],
    abstract_s: [
      "Résumé court",
      "An English abstract describing the study in detail.",
    ],
    authFullName_s: ["Ada Lovelace", "Grace Hopper"],
    publicationDateY_i: 2022,
    journalTitle_s: ["Bulletins de la SOF"],
    doiId_s: "10.1/hal",
    fileMain_s: "https://hal.science/hal-01234567/document",
    uri_s: "https://hal.science/hal-01234567",
    volume_s: ["7"],
    issue_s: ["2"],
    page_s: ["1-9"],
  };

  it("URL 含 wt=json 与 fl 字段选择；多语言字段取最长；source 戳", async () => {
    h.setResponder(() => ({
      status: 200,
      text: JSON.stringify({ response: { numFound: 4212, docs: [DOC] } }),
    }));
    const r = await searchHal({ query: "rna-seq", maxResults: 4 });
    expect(lastUrl()).toContain("api.archives-ouvertes.fr/search/?q=rna-seq");
    expect(lastUrl()).toContain("wt=json");
    expect(lastUrl()).toContain("fl=");
    const a = r.articles[0];
    expect(a.title).toBe("A much longer English title about RNA-seq methods");
    expect(a.abstract).toBe(
      "An English abstract describing the study in detail.",
    );
    expect(a.year).toBe(2022);
    expect(a.journalName).toBe("Bulletins de la SOF");
    expect(a.pdfUrl).toBe("https://hal.science/hal-01234567/document");
    expect(a.isOpenAccess).toBe(true);
    expect(a.source).toBe("hal");
    expect(r.total).toBe(4212);
  });
});
