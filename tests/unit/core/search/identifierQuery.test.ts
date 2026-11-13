/**
 * identifierQuery — 标识符识别、Atom 解析与精确反查分流。
 *
 * 覆盖三条用户可见路径的底层原语：
 *  1. detectIdentifierQuery：整串是 DOI/arXiv 编号/PMID 才分流，混合串与
 *     裸数字串必须留在关键词检索语义里
 *  2. parseArxivAtomEntry / mapCrossRefWork：两条反查端点的字段映射
 *  3. lookupArticleByIdentifier：端点链式 fallback、未命中与故障的归因区分
 *     （未命中 error 为空，接口故障 error 非空——界面据此给不同提示）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock 依赖（与 dataset-adapters 同款口径）──
vi.mock("../../../../src/utils/httpHeaders", () => ({
  ZSEARCH_HTTP_HEADERS: {},
}));
vi.mock("../../../../src/utils/logger", () => ({ safeDebug: vi.fn() }));
vi.mock("../../../../src/utils/prefs", () => ({
  getPrefDynamic: vi.fn(() => ""),
}));
// 节流器在单测里零延迟：断言的是路由与映射，不是限速
vi.mock("../../../../src/utils/openalexThrottle", () => ({
  openalexThrottle: vi.fn(async () => {}),
}));
vi.mock("../../../../src/utils/ncbiThrottle", () => ({
  ncbiThrottle: vi.fn(async () => {}),
}));

// ── Zotero.HTTP 桩：按 URL 分流，>=400 抛错（与 Zotero 运行时一致）──
type Route = (url: string) => { status: number; responseText: string };
let route: Route = () => ({ status: 404, responseText: "{}" });

const httpRequest = vi.fn(async (_method: string, url: string) => {
  const r = route(url);
  if (r.status >= 400) {
    const err: any = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r;
});

(globalThis as any).Zotero = {
  HTTP: { request: (...args: any[]) => httpRequest(...args) },
};

import {
  detectIdentifierQuery,
  lookupArticleByIdentifier,
  parseArxivAtomEntry,
} from "../../../../src/core/search/identifierQuery";
import { mapCrossRefWork } from "../../../../src/core/sources/academic-search/crossref";

// ──  fixture ──
const CROSSREF_WORK = {
  DOI: "10.1038/s41586-021-03819-2",
  title: ["Highly accurate protein structure prediction with AlphaFold"],
  author: [{ given: "John", family: "Jumper" }],
  published: { "date-parts": [[2021, 7, 15]] },
  "container-title": ["Nature"],
  "is-referenced-by-count": 30000,
  URL: "https://doi.org/10.1038/s41586-021-03819-2",
};

const OPENALEX_WORK = {
  id: "https://openalex.org/W318217400",
  doi: "https://doi.org/10.1038/s41586-021-03819-2",
  title: "Highly accurate protein structure prediction with AlphaFold",
  publication_year: 2021,
  authorships: [{ author: { display_name: "John Jumper" } }],
  cited_by_count: 30000,
  open_access: { is_oa: true, oa_url: "https://www.nature.com/articles/x.pdf" },
  primary_location: {
    source: { display_name: "Nature", issn: ["0028-0836"] },
  },
  biblio: { volume: "596", issue: "7873", first_page: "583", last_page: "589" },
  type: "article",
};

const ARXIV_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title>arXiv Query: id_list=2103.14030</title>
  <entry>
    <id>http://arxiv.org/abs/2103.14030v2</id>
    <title>Swin Transformer: Hierarchical Vision Transformer using Shifted Windows</title>
    <published>2021-07-12T17:56:47Z</published>
    <summary>  This paper presents a new vision Transformer.  </summary>
    <author><name>Ze Liu</name></author>
    <author><name>Yutong Lin</name></author>
    <arxiv:doi>10.1109/ICCV48922.2021.00986</arxiv:doi>
    <link href="https://arxiv.org/pdf/2103.14030v2" rel="related" type="application/pdf" title="pdf"/>
  </entry>
</feed>`;

const PUBMED_ESEARCH = {
  esearchresult: { count: "1", idlist: ["34265844"] },
};
const PUBMED_ESUMMARY = {
  result: {
    "34265844": {
      title: "A pmid-looked-up article",
      authors: [{ name: "Zhang S" }],
      pubdate: "2021 Jul 15",
      source: "Nature",
      articleids: [
        { idtype: "doi", value: "10.1038/s41586-021-03819-2" },
        { idtype: "pmc", value: "PMC8277616" },
      ],
    },
  },
};

/** 全部端点就绪的路由（按测试需要覆盖）。 */
function routeAll(): Route {
  return (url) => {
    if (url.includes("api.crossref.org/works/"))
      return {
        status: 200,
        responseText: JSON.stringify({ message: CROSSREF_WORK }),
      };
    if (url.includes("api.openalex.org/works/"))
      return { status: 200, responseText: JSON.stringify(OPENALEX_WORK) };
    if (url.includes("export.arxiv.org"))
      return { status: 200, responseText: ARXIV_ATOM };
    if (url.includes("esearch.fcgi"))
      return { status: 200, responseText: JSON.stringify(PUBMED_ESEARCH) };
    if (url.includes("esummary.fcgi"))
      return { status: 200, responseText: JSON.stringify(PUBMED_ESUMMARY) };
    if (url.includes("efetch.fcgi")) return { status: 200, responseText: "" };
    return { status: 404, responseText: "{}" };
  };
}

beforeEach(() => {
  httpRequest.mockClear();
  route = () => ({ status: 404, responseText: "{}" });
});

describe("detectIdentifierQuery", () => {
  it("DOI：裸编号/doi.org 链接/dx 子域/doi: 前缀/大写/句末标点都识别", () => {
    const expected = { kind: "doi", value: "10.1038/s41586-021-03819-2" };
    expect(detectIdentifierQuery("10.1038/s41586-021-03819-2")).toEqual(
      expected,
    );
    expect(
      detectIdentifierQuery("https://doi.org/10.1038/s41586-021-03819-2"),
    ).toEqual(expected);
    expect(
      detectIdentifierQuery("https://dx.doi.org/10.1038/s41586-021-03819-2"),
    ).toEqual(expected);
    expect(detectIdentifierQuery("doi:10.1038/s41586-021-03819-2")).toEqual(
      expected,
    );
    // 归一化为小写：DOI 大小写不敏感，反查端点按小写命中
    expect(detectIdentifierQuery("10.1038/S41586-021-03819-2")).toEqual(
      expected,
    );
    // 句末标点是复制粘贴噪声，剥掉后仍识别
    expect(detectIdentifierQuery("  10.1038/s41586-021-03819-2.  ")).toEqual(
      expected,
    );
    expect(detectIdentifierQuery("10.1038/s41586-021-03819-2,")).toEqual(
      expected,
    );
  });

  it("DOI：混合串/无斜杠/空串不识别（留在关键词检索语义）", () => {
    expect(detectIdentifierQuery("")).toBeNull();
    expect(detectIdentifierQuery("   ")).toBeNull();
    expect(detectIdentifierQuery(null)).toBeNull();
    expect(detectIdentifierQuery(undefined)).toBeNull();
    expect(detectIdentifierQuery("10.1038")).toBeNull();
    expect(
      detectIdentifierQuery("10.1038/s41586-021-03819-2 deep learning"),
    ).toBeNull();
    expect(detectIdentifierQuery("deep learning")).toBeNull();
  });

  it("arXiv：新式编号（可带版本号）与 abs 链接识别", () => {
    expect(detectIdentifierQuery("2103.14030")).toEqual({
      kind: "arxiv",
      value: "2103.14030",
    });
    expect(detectIdentifierQuery("2103.14030v2")).toEqual({
      kind: "arxiv",
      value: "2103.14030v2",
    });
    expect(detectIdentifierQuery("https://arxiv.org/abs/2103.14030")).toEqual({
      kind: "arxiv",
      value: "2103.14030",
    });
    // 编号不完整（少两位）不当标识符（4 位是 arXiv 2007-2015 历史合法形态）
    expect(detectIdentifierQuery("2103.14")).toBeNull();
    // 旧式编号只在显式网址里识别：裸 "cs/0501001" 与普通检索词无法区分
    expect(detectIdentifierQuery("cs/0501001")).toBeNull();
  });

  it("PMID：只认显式形态；裸数字串是年份/普通查询，不识别", () => {
    expect(detectIdentifierQuery("pmid:34265844")).toEqual({
      kind: "pmid",
      value: "34265844",
    });
    expect(detectIdentifierQuery("PMID: 34265844")).toEqual({
      kind: "pmid",
      value: "34265844",
    });
    expect(
      detectIdentifierQuery("https://pubmed.ncbi.nlm.nih.gov/34265844/"),
    ).toEqual({ kind: "pmid", value: "34265844" });
    expect(detectIdentifierQuery("34265844")).toBeNull();
    expect(detectIdentifierQuery("2024")).toBeNull();
  });
});

describe("parseArxivAtomEntry", () => {
  it("解析单条 entry 的题录字段", () => {
    const a = parseArxivAtomEntry(ARXIV_ATOM)!;
    expect(a.title).toBe(
      "Swin Transformer: Hierarchical Vision Transformer using Shifted Windows",
    );
    expect(a.authors).toBe("Ze Liu, Yutong Lin");
    expect(a.abstract).toBe("This paper presents a new vision Transformer.");
    expect(a.year).toBe(2021);
    expect(a.doi).toBe("10.1109/ICCV48922.2021.00986");
    expect(a.url).toBe("http://arxiv.org/abs/2103.14030v2");
    expect(a.pdfUrl).toBe("https://arxiv.org/pdf/2103.14030v2");
    expect(a.source).toBe("arxiv");
    expect(a.publicationType).toBe("preprint");
  });

  it("feed 级 title 不会误当成论文题名；无 entry 返回 null", () => {
    // feed 自己的 <title>（查询回显）在 entry 之外，不得命中
    expect(
      parseArxivAtomEntry("<feed><title>arXiv Query</title></feed>"),
    ).toBeNull();
    expect(parseArxivAtomEntry("")).toBeNull();
  });

  it("XML 实体反转义", () => {
    const xml =
      "<feed><entry><title>Tom &amp; Jerry &#x2014; a &lt;classic&gt;</title>" +
      "<summary>done</summary></entry></feed>";
    expect(parseArxivAtomEntry(xml)!.title).toBe("Tom & Jerry — a <classic>");
  });
});

describe("mapCrossRefWork", () => {
  it("单条 work 映射为统一题录字段", () => {
    const a = mapCrossRefWork(CROSSREF_WORK);
    expect(a.title).toBe(
      "Highly accurate protein structure prediction with AlphaFold",
    );
    expect(a.authors).toBe("John Jumper");
    expect(a.year).toBe(2021);
    expect(a.doi).toBe("10.1038/s41586-021-03819-2");
    expect(a.containerTitle).toBe("Nature");
    expect(a.citationCount).toBe(30000);
    expect(a.source).toBe("crossref");
  });
});

describe("lookupArticleByIdentifier", () => {
  it("DOI：Crossref 主端点命中", async () => {
    route = routeAll();
    const r = await lookupArticleByIdentifier({
      kind: "doi",
      value: "10.1038/s41586-021-03819-2",
    });
    expect(r.article).not.toBeNull();
    expect(r.source).toBe("crossref");
    expect(r.attempted).toEqual(["crossref"]);
    expect(r.error).toBeUndefined();
  });

  it("DOI：Crossref 404 时 OpenAlex 兜底命中", async () => {
    route = (url) =>
      url.includes("api.crossref.org")
        ? { status: 404, responseText: "{}" }
        : routeAll()(url);
    const r = await lookupArticleByIdentifier({
      kind: "doi",
      value: "10.1038/s41586-021-03819-2",
    });
    expect(r.source).toBe("openalex");
    expect(r.attempted).toEqual(["crossref", "openalex"]);
    expect(r.error).toBeUndefined();
  });

  it("DOI：两端点都明确没有 → 未命中且无 error（真实未找到）", async () => {
    const r = await lookupArticleByIdentifier({
      kind: "doi",
      value: "10.1038/does-not-exist",
    });
    expect(r.article).toBeNull();
    expect(r.attempted).toEqual(["crossref", "openalex"]);
    expect(r.error).toBeUndefined();
  });

  it("DOI：网络故障 → 未命中且 error=network（不得谎报未找到）", async () => {
    route = () => {
      throw new Error("connection reset");
    };
    const r = await lookupArticleByIdentifier({
      kind: "doi",
      value: "10.1038/s41586-021-03819-2",
    });
    expect(r.article).toBeNull();
    expect(r.error).toBe("network");
  });

  it("arXiv：Atom 主端点命中", async () => {
    route = routeAll();
    const r = await lookupArticleByIdentifier({
      kind: "arxiv",
      value: "2103.14030",
    });
    expect(r.source).toBe("arxiv");
    expect(r.article.title).toContain("Swin Transformer");
    expect(r.attempted).toEqual(["arxiv"]);
  });

  it("arXiv：Atom 无 entry 时 OpenAlex 兜底", async () => {
    route = (url) =>
      url.includes("export.arxiv.org")
        ? { status: 200, responseText: "<feed><title>empty</title></feed>" }
        : routeAll()(url);
    const r = await lookupArticleByIdentifier({
      kind: "arxiv",
      value: "2103.14030",
    });
    expect(r.source).toBe("openalex");
    expect(r.attempted).toEqual(["arxiv", "openalex"]);
  });

  it("PMID：esearch/esummary 链路命中并映射标识字段", async () => {
    route = routeAll();
    const r = await lookupArticleByIdentifier({
      kind: "pmid",
      value: "34265844",
    });
    expect(r.source).toBe("pubmed");
    expect(r.article.title).toBe("A pmid-looked-up article");
    expect(r.article.doi).toBe("10.1038/s41586-021-03819-2");
    expect(r.article.pmid).toBe("34265844");
    expect(r.error).toBeUndefined();
  });

  it("PMID：检索成功但零命中 → 未命中且无 error", async () => {
    route = (url) =>
      url.includes("esearch.fcgi")
        ? {
            status: 200,
            responseText: JSON.stringify({
              esearchresult: { count: "0", idlist: [] },
            }),
          }
        : { status: 404, responseText: "{}" };
    const r = await lookupArticleByIdentifier({
      kind: "pmid",
      value: "1",
    });
    expect(r.article).toBeNull();
    expect(r.error).toBeUndefined();
  });
});
