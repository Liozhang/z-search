/**
 * parseChain 回退矩阵单测：锁死「哪些后端按什么顺序参与」。
 *
 * 背景（2026-10-04）：此前 ODL 缺 jar → MinerU 缺 token 两连败后直接抛错，
 * 全新安装的 PDF 全文索引全军覆没。修复后链尾恒为 Zotero 内建抽取（纯本地
 * 兜底）——这里的矩阵就是那道保证的回归锁。
 *
 * @module tests/unit/core/pdf/parse-chain
 */

import { describe, it, expect } from "vitest";
import { resolveParseChain } from "../../../../src/core/pdf/parseChain";

const base = {
  backend: "opendataloader",
  fallback: true,
  localOnly: false,
  mineruAvailable: false,
};

describe("默认后端（opendataloader）", () => {
  it("全新安装（无 jar、MinerU 无令牌）：ODL 后直接落内建抽取", () => {
    expect(resolveParseChain(base)).toEqual([
      "opendataloader",
      "zotero-fulltext",
    ]);
  });

  it("配置了 MinerU 令牌时，MinerU 插在 ODL 与内建抽取之间", () => {
    expect(resolveParseChain({ ...base, mineruAvailable: true })).toEqual([
      "opendataloader",
      "mineru",
      "zotero-fulltext",
    ]);
  });

  it("关闭回退时只跑主后端", () => {
    expect(resolveParseChain({ ...base, fallback: false })).toEqual([
      "opendataloader",
    ]);
  });
});

describe("显式 MinerU 后端", () => {
  it("回退链：MinerU → ODL → 内建抽取", () => {
    expect(resolveParseChain({ ...base, backend: "mineru" })).toEqual([
      "mineru",
      "opendataloader",
      "zotero-fulltext",
    ]);
  });

  it("无令牌时 MinerU 仍然入链（用户显式选择，失败按基础设施错误换层）", () => {
    expect(
      resolveParseChain({ ...base, backend: "mineru", mineruAvailable: false }),
    ).toEqual(["mineru", "opendataloader", "zotero-fulltext"]);
  });

  it("关闭回退时只跑 MinerU", () => {
    expect(
      resolveParseChain({ ...base, backend: "mineru", fallback: false }),
    ).toEqual(["mineru"]);
  });
});

describe("localOnly（后台自动动作，禁远程）", () => {
  it("主层强制 ODL、链尾内建抽取，绝不入链 MinerU", () => {
    expect(
      resolveParseChain({
        ...base,
        backend: "mineru",
        localOnly: true,
        mineruAvailable: true,
      }),
    ).toEqual(["opendataloader", "zotero-fulltext"]);
  });

  it("localOnly 下关闭回退仍只跑 ODL（用户显式 fail-fast 优先）", () => {
    expect(
      resolveParseChain({ ...base, localOnly: true, fallback: false }),
    ).toEqual(["opendataloader"]);
  });
});

describe("健壮性", () => {
  it("未知 backend 值按 opendataloader 处理", () => {
    expect(resolveParseChain({ ...base, backend: "something-else" })).toEqual([
      "opendataloader",
      "zotero-fulltext",
    ]);
  });

  it("空 backend 字符串按 opendataloader 处理", () => {
    expect(resolveParseChain({ ...base, backend: "" })).toEqual([
      "opendataloader",
      "zotero-fulltext",
    ]);
  });

  it("任何输入下链都非空", () => {
    const inputs = [
      {
        backend: "mineru",
        fallback: false,
        localOnly: false,
        mineruAvailable: false,
      },
      {
        backend: "mineru",
        fallback: false,
        localOnly: true,
        mineruAvailable: false,
      },
      { backend: "", fallback: false, localOnly: true, mineruAvailable: false },
    ];
    for (const input of inputs) {
      expect(resolveParseChain(input).length).toBeGreaterThan(0);
    }
  });
});
