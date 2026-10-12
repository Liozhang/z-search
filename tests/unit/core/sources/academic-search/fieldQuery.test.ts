/**
 * fieldQuery — 高级检索字段编译纯函数的契约测试。
 *
 * 覆盖：各源查询串的编译口径（含「无字段时与历史行为逐字节一致」的回归
 * 底线）、降级口径（无字段语法源以标题词作主查询）、结果内关键词过滤的
 * 多词 AND 语义。
 *
 * @module tests/unit/core/sources/academic-search/fieldQuery
 */
import { describe, it, expect } from "vitest";
import {
  buildArxivSearchQuery,
  buildEuropePMCQuery,
  buildPubMedTerm,
  buildOpenAlexFieldFilterParts,
  arxivSubmittedDateRange,
  githubQueryWithQualifiers,
  fallbackFieldQuery,
  matchKeywordFilter,
} from "../../../../../src/core/sources/academic-search/fieldQuery";

describe("buildArxivSearchQuery", () => {
  it("无字段条件时与历史口径逐字节一致（all: 前缀不加引号）", () => {
    expect(buildArxivSearchQuery({ query: "deep learning" })).toBe(
      "all:deep learning",
    );
    expect(
      buildArxivSearchQuery({ query: "deep learning", author: "Smith" }),
    ).toBe("all:deep learning au:Smith");
  });

  it("标题/摘要编译为 ti:/abs: 前缀，AND 连接", () => {
    expect(
      buildArxivSearchQuery({
        query: "transformer",
        title: "attention",
        abstract: "encoder",
      }),
    ).toBe('all:transformer AND ti:"attention" AND abs:"encoder"');
  });

  it("年份编译为 submittedDate 区间（单年与区间）", () => {
    expect(arxivSubmittedDateRange("2024")).toBe(
      "submittedDate:[202401010000 TO 202412312359]",
    );
    expect(arxivSubmittedDateRange("2020-2024")).toBe(
      "submittedDate:[202001010000 TO 202412312359]",
    );
    expect(arxivSubmittedDateRange("abc")).toBeNull();
  });

  it("只有年份（无字段）也走结构化路径", () => {
    expect(buildArxivSearchQuery({ query: "test", year: "2024" })).toBe(
      "all:test AND submittedDate:[202401010000 TO 202412312359]",
    );
  });
});

describe("buildEuropePMCQuery", () => {
  it("reviewOnly-only 与历史行为逐字节一致", () => {
    expect(buildEuropePMCQuery({ query: "crispr", reviewOnly: true })).toBe(
      "(crispr) AND pub_type:Review",
    );
  });

  it("无条件原样透传", () => {
    expect(buildEuropePMCQuery({ query: "crispr" })).toBe("crispr");
  });

  it("标题/摘要/有摘要编译为 TITLE:/ABSTRACT:/HAS_ABSTRACT:Y", () => {
    expect(
      buildEuropePMCQuery({
        query: "crispr",
        title: "gene editing",
        abstract: "off-target",
        hasAbstract: true,
        reviewOnly: true,
      }),
    ).toBe(
      '(crispr) AND pub_type:Review AND TITLE:"gene editing" AND ABSTRACT:"off-target" AND HAS_ABSTRACT:Y',
    );
  });
});

describe("buildPubMedTerm", () => {
  it("reviewOnly-only 与历史行为逐字节一致", () => {
    expect(buildPubMedTerm({ query: "immunotherapy", reviewOnly: true })).toBe(
      "(immunotherapy) AND Review[ptyp]",
    );
  });

  it("标题用 [Title]、摘要用 [tiab]、有摘要用 hasabstract[Filter]", () => {
    expect(
      buildPubMedTerm({
        query: "immunotherapy",
        title: "CAR-T",
        abstract: "solid tumor",
        hasAbstract: true,
      }),
    ).toBe(
      '(immunotherapy) AND ("CAR-T")[Title] AND ("solid tumor")[tiab] AND hasabstract[Filter]',
    );
  });
});

describe("buildOpenAlexFieldFilterParts", () => {
  it("标题/摘要值经 URI 编码（空格不拆坏逗号连接的 filter 串）", () => {
    expect(buildOpenAlexFieldFilterParts({ title: "deep learning" })).toEqual([
      "title.search:deep%20learning",
    ]);
  });

  it("仅有摘要与 OA 开关各自成片段", () => {
    expect(
      buildOpenAlexFieldFilterParts({
        hasAbstract: true,
        openAccessOnly: true,
      }),
    ).toEqual(["has_abstract:true", "open_access.is_oa:true"]);
  });

  it("空输入返回空数组", () => {
    expect(buildOpenAlexFieldFilterParts({})).toEqual([]);
  });
});

describe("降级与限定符", () => {
  it("GitHub 标题限定追加 in:title", () => {
    expect(githubQueryWithQualifiers("ml toolkit")).toBe("ml toolkit");
    expect(githubQueryWithQualifiers("ml toolkit", "toolkit")).toBe(
      "ml toolkit in:title",
    );
  });

  it("无字段语法源的降级：标题词作主查询，缺省回落原查询", () => {
    expect(fallbackFieldQuery("base query", "title words")).toBe("title words");
    expect(fallbackFieldQuery("base query")).toBe("base query");
    expect(fallbackFieldQuery("base query", "   ")).toBe("base query");
  });
});

describe("matchKeywordFilter（结果内关键词过滤）", () => {
  const article = {
    title: "Deep Learning for Protein Structure",
    authors: "Jumper; Hassabis",
    journal: "Nature",
    abstract: "We predict protein structures with neural networks.",
  };

  it("空关键词不过滤", () => {
    expect(matchKeywordFilter(article, "")).toBe(true);
    expect(matchKeywordFilter(article, "   ")).toBe(true);
  });

  it("多词 AND：全部命中才保留，大小写不敏感", () => {
    expect(matchKeywordFilter(article, "protein nature")).toBe(true);
    expect(matchKeywordFilter(article, "PROTEIN jumper")).toBe(true);
    expect(matchKeywordFilter(article, "protein quantum")).toBe(false);
  });

  it("匹配范围覆盖摘要", () => {
    expect(matchKeywordFilter(article, "neural networks")).toBe(true);
    expect(matchKeywordFilter(article, "structures neural")).toBe(true);
  });
});
