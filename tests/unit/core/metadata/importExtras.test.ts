/**
 * importExtras — 导入时写入条目 Extra 字段的聚合信息契约测试。
 *
 * 覆盖：来源归属口径、buildExtraFields 的取值与缺省跳过、mergeExtraLines
 * 的「同键替换 / 用户内容保留 / 空输入原样」合并语义。
 *
 * @module tests/unit/core/metadata/importExtras
 */
import { describe, it, expect } from "vitest";
import {
  articleSourcesOf,
  buildExtraFields,
  mergeExtraLines,
} from "../../../../src/core/metadata/importExtras";

describe("articleSourcesOf（多源归属口径）", () => {
  it("sources 数组优先，过滤空值", () => {
    expect(
      articleSourcesOf({
        sources: ["openalex", "", "arxiv"],
        source: "pubmed",
      }),
    ).toEqual(["openalex", "arxiv"]);
  });

  it("缺省退化到 source 单值；两者皆无返回空数组", () => {
    expect(articleSourcesOf({ source: "crossref" })).toEqual(["crossref"]);
    expect(articleSourcesOf({})).toEqual([]);
  });
});

describe("buildExtraFields", () => {
  it("有值的键全部产出（含中科院顶刊标注）", () => {
    expect(
      buildExtraFields({
        citationCount: 81218,
        sources: ["openalex", "crossref"],
        jif: 232.4,
        jcrQuartile: "Q1",
        cassQuartile: 1,
        cassIsTop: true,
        warningLevel: "warning",
        stars: 1234,
      }),
    ).toEqual({
      Citations: "81218",
      Sources: "openalex, crossref",
      JIF: "232.4",
      "JCR Quartile": "Q1",
      "CAS Quartile": "Q1 (Top)",
      Warning: "warning",
      Stars: "1234",
    });
  });

  it("零值/缺省键不产出占位行", () => {
    expect(buildExtraFields({ citationCount: 0 })).toEqual({});
    expect(buildExtraFields({})).toEqual({});
  });
});

describe("mergeExtraLines", () => {
  it("空输入 + 新字段 → 仅新行", () => {
    expect(mergeExtraLines(undefined, { Citations: "5" })).toBe("Citations: 5");
  });

  it("同键旧行整体替换，不堆积重复行", () => {
    const existing = "Citations: 3\nSources: arxiv";
    expect(
      mergeExtraLines(existing, { Citations: "8", Sources: "arxiv, crossref" }),
    ).toBe("Citations: 8\nSources: arxiv, crossref");
  });

  it("用户手写的无关行原样保留", () => {
    const existing = "Supplier: library\n备注：手工录入\nCitations: 3";
    expect(mergeExtraLines(existing, { Citations: "8" })).toBe(
      "Supplier: library\n备注：手工录入\nCitations: 8",
    );
  });

  it("空 fields 原样返回（仅去首尾空行）", () => {
    expect(mergeExtraLines("user line", {})).toBe("user line");
    expect(mergeExtraLines(undefined, {})).toBe("");
  });

  it("无冒号的用户行不会被误认成同键行", () => {
    expect(
      mergeExtraLines("plain note without colon", { Citations: "1" }),
    ).toBe("plain note without colon\nCitations: 1");
  });
});
