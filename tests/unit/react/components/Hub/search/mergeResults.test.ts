/**
 * mergeResults — pure merge / dedup / sort contract tests for the Hub merged
 * search page (library semantic hits + external articles in one list).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeDoi,
  mergeResults,
  sortMixedResults,
  countMixed,
  externalArticleKey,
  mergeExternalArticles,
  articleSourcesOf,
} from "../../../../../../src/react/components/Hub/search/mergeResults";
import type { SearchResult } from "../../../../../../src/react/components/Hub/search/Semantic/types";
import type { ArticleResult } from "../../../../../../src/types/literatureSearch";

const lib = (over: Partial<SearchResult> = {}): SearchResult => ({
  itemID: 1,
  similarity: 0.8,
  title: "Library Item",
  ...over,
});

const art = (over: Partial<ArticleResult> = {}): ArticleResult => ({
  title: "External Article",
  authors: "A. Author",
  journal: "Nature",
  year: "2024",
  doi: "",
  isOpenAccess: false,
  source: "arxiv",
  ...over,
});

describe("normalizeDoi", () => {
  it("normalizes casing, trimming, doi: prefix and doi.org URL forms", () => {
    expect(normalizeDoi("10.1234/ABC.def")).toBe("10.1234/abc.def");
    expect(normalizeDoi(" 10.1234/abc.def ")).toBe("10.1234/abc.def");
    expect(normalizeDoi("https://doi.org/10.1234/abc.def")).toBe(
      "10.1234/abc.def",
    );
    expect(normalizeDoi("http://doi.org/10.1234/abc.def")).toBe(
      "10.1234/abc.def",
    );
    expect(normalizeDoi("doi.org/10.1234/abc.def")).toBe("10.1234/abc.def");
    expect(normalizeDoi("doi:10.1234/abc.def")).toBe("10.1234/abc.def");
    // `doi:` 前缀后的空白一并剥（旧实现 slice 后不 trim，会留下前导空格）
    expect(normalizeDoi("doi: 10.1234/ABC")).toBe("10.1234/abc");
  });

  it("strips the dx. doi.org subdomain (cross-source dedup)", () => {
    // 旧实现四个 startsWith 全不命中 → 原样返回 → 跨源去重静默失效
    expect(normalizeDoi("http://dx.doi.org/10.1234/abc")).toBe("10.1234/abc");
  });

  it("returns undefined for empty / nullish / prefix-only input", () => {
    expect(normalizeDoi(undefined)).toBeUndefined();
    expect(normalizeDoi(null)).toBeUndefined();
    expect(normalizeDoi("")).toBeUndefined();
    expect(normalizeDoi("   ")).toBeUndefined();
    expect(normalizeDoi("https://doi.org/")).toBeUndefined();
  });
});

describe("mergeResults", () => {
  it("places library hits before external articles (relevance order)", () => {
    const merged = mergeResults(
      [lib({ itemID: 1, title: "Lib One" })],
      [art({ title: "Ext One" })],
    );
    expect(merged.map((e) => e.kind)).toEqual(["library", "article"]);
  });

  it("drops an external article whose DOI matches a library hit", () => {
    const merged = mergeResults(
      [lib({ itemID: 7, doi: "10.1234/abc.def" })],
      [
        art({ title: "Same Work", doi: "https://doi.org/10.1234/ABC.DEF" }),
        art({ title: "Other Work", doi: "10.9999/xyz" }),
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].kind).toBe("library");
    expect(merged[1].kind).toBe("article");
    if (merged[1].kind === "article") {
      expect(merged[1].article.title).toBe("Other Work");
    }
  });

  it("keeps external articles when the library hit has no DOI", () => {
    const merged = mergeResults(
      [lib({ doi: undefined })],
      [art({ doi: "10.1234/abc" })],
    );
    expect(merged).toHaveLength(2);
  });

  it("keeps external articles with duplicate DOIs among themselves (deduped upstream)", () => {
    // external-vs-external dedup happens upstream of mergeResults — since
    // 2026-09-23 the hook calls mergeExternalArticles per landed source batch
    // (progressive fan-out); mergeResults itself only dedups against library DOIs
    const merged = mergeResults(
      [],
      [art({ title: "A", doi: "10.1/x" }), art({ title: "B", doi: "10.1/X" })],
    );
    expect(merged).toHaveLength(2);
  });
});

describe("sortMixedResults", () => {
  const merged = mergeResults(
    [
      lib({ itemID: 1, title: "Banana", dateAdded: "2023-05-01" }),
      lib({ itemID: 2, title: "Apple", dateAdded: "2021-01-01" }),
    ],
    [art({ title: "Cherry", year: "2025" })],
  );

  it("relevance keeps merge order (library first, response order)", () => {
    const titles = sortMixedResults(merged, "relevance").map((e) =>
      e.kind === "library" ? e.result.title : e.article.title,
    );
    expect(titles).toEqual(["Banana", "Apple", "Cherry"]);
  });

  it("date sorts the whole list by year desc (year from dateAdded)", () => {
    const titles = sortMixedResults(merged, "date").map((e) =>
      e.kind === "library" ? e.result.title : e.article.title,
    );
    expect(titles).toEqual(["Cherry", "Banana", "Apple"]);
  });

  it("title sorts the whole list asc, case- and locale-aware", () => {
    const titles = sortMixedResults(merged, "title").map((e) =>
      e.kind === "library" ? e.result.title : e.article.title,
    );
    expect(titles).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("citations sorts desc client-side (library rows count 0, sort last)", () => {
    const merged = mergeResults(
      [lib({ itemID: 1, title: "LibRow" })],
      [
        art({ title: "Low", citationCount: 3 }),
        art({ title: "High", citationCount: 90 }),
        art({ title: "None" }),
      ],
    );
    const titles = sortMixedResults(merged, "citations").map((e) =>
      e.kind === "library" ? e.result.title : e.article.title,
    );
    expect(titles).toEqual(["High", "Low", "LibRow", "None"]);
  });

  it("does not mutate the input array", () => {
    const before = [...merged];
    sortMixedResults(merged, "date");
    expect(merged).toEqual(before);
  });
});

describe("sortMixedResults 标题排序的完整词组优先（HLA-HD 报障修复）", () => {
  const titleOf = (e: ReturnType<typeof mergeResults>[number]) =>
    e.kind === "article" ? e.article.title : e.result.title;

  it("标题含完整查询短语的排最前，其余随后（梯队内仍字典序）", () => {
    const merged = mergeResults(
      [],
      [
        art({ title: "- unrelated note" }),
        art({ title: "HLA typing and HD screening study" }),
        art({ title: "HLA-HD: a long-read typing pipeline" }),
        art({ title: "Another paper on genotyping" }),
      ],
    );
    const titles = sortMixedResults(merged, "title", "HLA-HD").map(titleOf);
    expect(titles).toEqual([
      "HLA-HD: a long-read typing pipeline",
      "- unrelated note",
      "Another paper on genotyping",
      "HLA typing and HD screening study",
    ]);
  });

  it("完整词组命中优先于纯字典序（连字符开头标题不再顶到最前）", () => {
    const merged = mergeResults(
      [],
      [art({ title: "- leading dash" }), art({ title: "HLA-HD toolkit" })],
    );
    // 无 query：纯字典序，"-" 开头第一
    expect(sortMixedResults(merged, "title").map(titleOf)[0]).toBe(
      "- leading dash",
    );
    // 带 query：完整词组命中排前
    expect(sortMixedResults(merged, "title", "HLA-HD").map(titleOf)[0]).toBe(
      "HLA-HD toolkit",
    );
  });

  it("分隔符写法不敏感：hla hd / hla-hd / HLA HD 同判命中", () => {
    const merged = mergeResults(
      [],
      [
        art({ title: "HLA HD without hyphen" }),
        art({ title: "hla-hd lowercase" }),
        art({ title: "HLA-DR typing" }),
      ],
    );
    const titles = sortMixedResults(merged, "title", "HLA-HD").map(titleOf);
    // 前两条是完整词组的不同写法（梯队 0，按字典序），第三条不含完整短语
    expect(titles).toEqual([
      "HLA HD without hyphen",
      "hla-hd lowercase",
      "HLA-DR typing",
    ]);
  });

  it("库内命中同样参与完整词组梯队", () => {
    const merged = mergeResults(
      [
        lib({ itemID: 1, title: "Zebra typing" }),
        lib({ itemID: 2, title: "HLA-HD library copy" }),
      ],
      [],
    );
    const titles = sortMixedResults(merged, "title", "HLA-HD").map(titleOf);
    expect(titles).toEqual(["HLA-HD library copy", "Zebra typing"]);
  });

  it("无 query 或纯符号 query 时行为与纯字典序一致", () => {
    const merged = mergeResults(
      [],
      [art({ title: "Beta" }), art({ title: "Alpha" })],
    );
    const expected = ["Alpha", "Beta"];
    expect(sortMixedResults(merged, "title").map(titleOf)).toEqual(expected);
    expect(sortMixedResults(merged, "title", "").map(titleOf)).toEqual(expected);
    // 纯符号查询归一后为空串 → 不设优先级
    expect(sortMixedResults(merged, "title", "-").map(titleOf)).toEqual(
      expected,
    );
  });
});

describe("countMixed", () => {
  it("counts each kind", () => {
    const merged = mergeResults(
      [lib(), lib({ itemID: 2 })],
      [art(), art({ title: "B" }), art({ title: "C" })],
    );
    expect(countMixed(merged)).toEqual({
      library: 2,
      article: 3,
    });
  });
});

describe("externalArticleKey（渐进检索的身份键）", () => {
  it("DOI 归一优先（大小写/URL 前缀不敏感）", () => {
    expect(externalArticleKey(art({ doi: "https://doi.org/10.1/X" }))).toBe(
      "doi:10.1/x",
    );
    expect(externalArticleKey(art({ doi: "10.1/x" }))).toBe("doi:10.1/x");
  });

  it("无 DOI 一律 null（不参与身份判定，条目直接保留）", () => {
    // 2026-10-12 用户裁决：身份只认 DOI——标题撞车（同名不同文/预印本与
    // 正式版）的误判代价高于漏合并。
    expect(externalArticleKey(art({ doi: "", title: "Hello World!" }))).toBe(
      null,
    );
    expect(externalArticleKey(art({ doi: "", title: "hi" }))).toBeNull();
    expect(externalArticleKey(art({ doi: "", title: "" }))).toBeNull();
  });
});

describe("mergeExternalArticles（渐进合并原语）", () => {
  it("追加新条目，丢弃 base 已有的 DOI 重复（跨源落地去重）", () => {
    const base = [art({ title: "From OpenAlex", doi: "10.1/x" })];
    const out = mergeExternalArticles(base, [
      art({ title: "From PubMed", doi: "https://doi.org/10.1/X" }),
      art({ title: "Unique", doi: "10.2/y" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((a) => a.title)).toEqual(["From OpenAlex", "Unique"]);
  });

  it("无 DOI 条目不做身份合并，全部保留（含同标题变体）", () => {
    // 身份只认 DOI：两条无 DOI 的同题记录视为「无法判定」，不去重。
    const base = [art({ doi: "", title: "Same Paper Title Here" })];
    const out = mergeExternalArticles(base, [
      art({ doi: "", title: "same  paper  title here" }),
      art({ doi: "", title: "ok" }),
    ]);
    expect(out).toHaveLength(3);
  });

  it("纯追加：不重排不移除既有项（位置索引 = selection 状态键）", () => {
    const base = [art({ title: "First", doi: "10.1/a" })];
    const out = mergeExternalArticles(base, [
      art({ title: "Second", doi: "10.1/b" }),
    ]);
    expect(out[0].doi).toBe("10.1/a");
    expect(out).toHaveLength(2);
    // base 数组不被突变
    expect(base).toHaveLength(1);
  });

  it("incoming 批内同键折叠为首个", () => {
    const out = mergeExternalArticles(
      [],
      [
        art({ title: "Dup", doi: "10.1/x" }),
        art({ title: "Dup", doi: "10.1/x" }),
      ],
    );
    expect(out).toHaveLength(1);
  });

  it("空 base + 空 incoming → 空表", () => {
    expect(mergeExternalArticles([], [])).toEqual([]);
  });

  it("同键跨源命中做字段合并而非丢弃（审计 P1-2）：被引取大、标识/指标补空", () => {
    // PubMed 先回：被引 0、有 pmcid、无 ISSN；OpenAlex 后回同 DOI：
    // 被引 800、有 ISSN → JCR 富集可达。合并后单条保住两源最优字段。
    const first = art({
      title: "Same paper",
      doi: "10.1/x",
      citationCount: 0,
      pmcid: "PMC123",
      issn: undefined,
    });
    const second = art({
      title: "Same paper",
      doi: "https://doi.org/10.1/X",
      citationCount: 800,
      issn: "1234-5678",
      jif: 5.9,
    });
    const out = mergeExternalArticles([first], [second]);
    expect(out).toHaveLength(1);
    expect(out[0].citationCount).toBe(800);
    expect(out[0].pmcid).toBe("PMC123");
    expect(out[0].issn).toBe("1234-5678");
    expect(out[0].jif).toBe(5.9);
  });

  it("同键合并不丢首到源的非空身份字段（title/source 等不随后到漂移）", () => {
    const out = mergeExternalArticles(
      [art({ title: "A", doi: "10.1/x", source: "pubmed" })],
      [art({ title: "B", doi: "10.1/x", source: "openalex" })],
    );
    expect(out[0].title).toBe("A");
    expect(out[0].source).toBe("pubmed");
  });
});

describe("sortMixedResults 对 number year 的健壮性（审计 P0-4）", () => {
  it("数字 year 不再让 localeCompare 抛 TypeError", () => {
    const merged = mergeResults(
      [],
      [
        art({ title: "NumYear", year: 2024 as any }),
        art({ title: "StrYear", year: "2025" }),
      ],
    );
    expect(() => sortMixedResults(merged, "date")).not.toThrow();
    const titles = sortMixedResults(merged, "date").map((e) =>
      e.kind === "article" ? e.article.title : e.result.title,
    );
    expect(titles[0]).toBe("StrYear");
  });
});

describe("多源归属（按源筛选的判定口径）", () => {
  it("mergeExternalArticles 同键命中时 sources 取并集且保持首到顺序", () => {
    const first = art({
      title: "Same paper",
      doi: "10.1/x",
      source: "openalex",
    });
    const second = art({
      title: "Same paper",
      doi: "10.1/x",
      source: "arxiv",
      sources: ["arxiv"],
    });
    const out = mergeExternalArticles([first], [second]);
    expect(out[0].source).toBe("openalex");
    expect(out[0].sources).toEqual(["openalex", "arxiv"]);
  });

  it("sources 缺省时 articleSourcesOf 以 source 单值兜底", () => {
    expect(articleSourcesOf(art({ source: "zenodo" }))).toEqual(["zenodo"]);
    expect(articleSourcesOf({ source: "", sources: undefined })).toEqual([]);
    expect(
      articleSourcesOf({ source: "arxiv", sources: ["arxiv", "pubmed"] }),
    ).toEqual(["arxiv", "pubmed"]);
  });

  it("同键合并后 filters 任一命中口径成立（openalex+arxiv 合并卡命中 arxiv 筛选）", () => {
    const merged = mergeExternalArticles(
      [art({ title: "Dual", doi: "10.2/y", source: "openalex" })],
      [art({ title: "Dual", doi: "10.2/y", source: "arxiv" })],
    );
    const sources = articleSourcesOf(merged[0]);
    expect(sources).toContain("arxiv");
    expect(sources).toContain("openalex");
  });
});
