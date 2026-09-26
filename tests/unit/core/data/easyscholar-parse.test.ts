/**
 * EasyScholarClient.parseCoreRanks — 中文核心名单回执的防御式解析。
 *
 * 端点 schema 无法从外部验证（需控制台 key）——解析器必须容忍生态内已知的
 * map / 数组两种形态，并对空值（"-" / null / 空串）按未上榜处理；任何不
 * 识别的形状静默返回空，绝不猜。
 */
import { describe, it, expect } from "vitest";
import { parseCoreRanks } from "../../../../src/core/data/EasyScholarClient";

describe("parseCoreRanks", () => {
  it("解析 map 形态：{名单名: 版本/等级}", () => {
    const codes = parseCoreRanks({
      北大核心: "2023",
      CSCD: "C",
      "JCR分区(2024)": "Q1",
      科技核心: "2024",
    });
    expect(codes.sort()).toEqual(["cscd", "pku", "tech"]);
  });

  it("解析数组形态：[{rankName, rankValue}]", () => {
    const codes = parseCoreRanks([
      { rankName: "南大核心", rankValue: "2023-2024" },
      { rank_name: "北大核心", rank_value: "2023" },
      { rankName: "SCI(2023)", rankValue: "Q2" },
    ]);
    expect(codes.sort()).toEqual(["cssci", "pku"]);
  });

  it("空值（'-' / null / 空串）视为未上榜", () => {
    const codes = parseCoreRanks({
      北大核心: "-",
      CSCD: null,
      科技核心: "",
    });
    expect(codes).toEqual([]);
  });

  it("不识别的形状静默返回空", () => {
    expect(parseCoreRanks("string")).toEqual([]);
    expect(parseCoreRanks(42)).toEqual([]);
    expect(parseCoreRanks(null)).toEqual([]);
    expect(parseCoreRanks([{ unrelated: true }])).toEqual([]);
  });

  it("同名名单去重（别名同时命中同一码）", () => {
    const codes = parseCoreRanks({
      中文核心: "2023",
      北大核心: "2023",
    });
    expect(codes).toEqual(["pku"]);
  });
});
