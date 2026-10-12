/**
 * getModelDimension — 模型维度三级回退（内置表 → 已记录映射 → 384）的回归。
 *
 * 背景（2026-10-11 审计）：未知模型此前一律按 384 维处理，768/1024 维的
 * 自定义模型会在 IVF 索引处以「维度不匹配」失败。真实维度由
 * ModelDownloadManager 从 config.json 读出后写入 `embedding.local.dimensions`
 * 映射 pref；本文件守住查询侧的回退顺序。
 *
 * @module tests/unit/core/embedding/model-dimension
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  prefs: new Map<string, any>(),
}));

vi.hoisted(() => {
  const full = (key: string) =>
    key.startsWith("extensions.zotero.zsearch.")
      ? key
      : `extensions.zotero.zsearch.${key}`;
  (globalThis as any).Zotero = {
    Prefs: {
      get: (key: string) => h.prefs.get(full(key)),
      set: (key: string, value: any) => {
        h.prefs.set(full(key), value);
      },
    },
    debug: () => {},
  };
});

beforeEach(() => {
  h.prefs.clear();
  vi.resetModules();
});

const importProvider = () =>
  import("../../../../src/core/embedding/EmbeddingProvider");

describe("getModelDimension（三级回退）", () => {
  it("内置表命中：四个已知模型各自返回表值", async () => {
    const { getModelDimension } = await importProvider();
    expect(getModelDimension("Xenova/multilingual-e5-small")).toBe(384);
    expect(
      getModelDimension("Xenova/paraphrase-multilingual-mpnet-base-v2"),
    ).toBe(768);
    expect(getModelDimension("Xenova/multilingual-e5-large")).toBe(1024);
  });

  it("未知模型命中已记录映射（下载侧从 config.json 写入）", async () => {
    h.prefs.set(
      "extensions.zotero.zsearch.embedding.local.dimensions",
      JSON.stringify({ "acme/custom-embedder": 768 }),
    );
    const { getModelDimension } = await importProvider();
    expect(getModelDimension("acme/custom-embedder")).toBe(768);
  });

  it("两级都未命中回落 384；损坏的映射 pref 不抛错", async () => {
    const { getModelDimension } = await importProvider();
    expect(getModelDimension("acme/unknown")).toBe(384);
    h.prefs.set(
      "extensions.zotero.zsearch.embedding.local.dimensions",
      "{not json",
    );
    expect(getModelDimension("acme/unknown")).toBe(384);
  });

  it("映射里的非法维度值（0/负数/非数值）不采信", async () => {
    h.prefs.set(
      "extensions.zotero.zsearch.embedding.local.dimensions",
      JSON.stringify({ "a/b": 0, "c/d": -5, "e/f": "768" }),
    );
    const { getModelDimension } = await importProvider();
    expect(getModelDimension("a/b")).toBe(384);
    expect(getModelDimension("c/d")).toBe(384);
    expect(getModelDimension("e/f")).toBe(384);
  });
});
