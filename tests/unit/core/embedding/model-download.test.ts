/**
 * ModelDownloadManager 纯函数单测：模型名校验、URL 拼装、区域默认源。
 * IO 编排（下载/写盘/进度窗）在 vitest 里没有 Zotero 宿主，不在此覆盖。
 *
 * @module tests/unit/core/embedding/model-download
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
  };
});

beforeEach(() => {
  h.prefs.clear();
});

const importManager = () =>
  import("../../../../src/core/embedding/ModelDownloadManager");

describe("sanitizeModelId", () => {
  it("放行 org/repo 两段模型名", async () => {
    const { sanitizeModelId } = await importManager();
    expect(sanitizeModelId("Xenova/multilingual-e5-small")).toBe(
      "Xenova/multilingual-e5-small",
    );
  });

  it("放行单段模型名（首尾空白归一）", async () => {
    const { sanitizeModelId } = await importManager();
    expect(sanitizeModelId("  bert-base  ")).toBe("bert-base");
  });

  it("拒绝路径穿越与非法字符", async () => {
    const { sanitizeModelId } = await importManager();
    expect(sanitizeModelId("../etc/passwd")).toBeNull();
    expect(sanitizeModelId("org/..%2f")).toBeNull();
    expect(sanitizeModelId("org/repo/../../x")).toBeNull();
    expect(sanitizeModelId("")).toBeNull();
    expect(sanitizeModelId("a b/c")).toBeNull();
  });
});

describe("buildModelFileUrl", () => {
  it("按 HF resolve 布局拼 URL，基址去尾斜杠", async () => {
    const { buildModelFileUrl } = await importManager();
    expect(
      buildModelFileUrl(
        "https://hf-mirror.com/",
        "Xenova/multilingual-e5-small",
        "onnx/model_quantized.onnx",
      ),
    ).toBe(
      "https://hf-mirror.com/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx",
    );
  });
});

describe("defaultModelEndpointFor（区域默认源）", () => {
  it("中国大陆默认 hf-mirror.com", async () => {
    const { defaultModelEndpointFor } = await importManager();
    expect(defaultModelEndpointFor("cn")).toBe("https://hf-mirror.com");
  });

  it("国际与未声明（auto）默认 huggingface.co", async () => {
    const { defaultModelEndpointFor } = await importManager();
    expect(defaultModelEndpointFor("global")).toBe("https://huggingface.co");
    expect(defaultModelEndpointFor("auto")).toBe("https://huggingface.co");
  });
});

describe("resolveModelEndpoint（pref 覆盖 > 区域推导）", () => {
  it("无覆盖时按区域推导", async () => {
    const { resolveModelEndpoint } = await importManager();
    h.prefs.set("extensions.zotero.zsearch.region", "cn");
    expect(resolveModelEndpoint()).toBe("https://hf-mirror.com");
    h.prefs.set("extensions.zotero.zsearch.region", "global");
    expect(resolveModelEndpoint()).toBe("https://huggingface.co");
  });

  it("embedding.local.mirror 覆盖生效（去尾斜杠）", async () => {
    const { resolveModelEndpoint } = await importManager();
    h.prefs.set("extensions.zotero.zsearch.region", "global");
    h.prefs.set(
      "extensions.zotero.zsearch.embedding.local.mirror",
      "https://hf.example.com/",
    );
    expect(resolveModelEndpoint()).toBe("https://hf.example.com");
  });

  it("非法覆盖（无协议）不生效，回落区域推导", async () => {
    const { resolveModelEndpoint } = await importManager();
    h.prefs.set("extensions.zotero.zsearch.region", "cn");
    h.prefs.set(
      "extensions.zotero.zsearch.embedding.local.mirror",
      "hf.example.com",
    );
    expect(resolveModelEndpoint()).toBe("https://hf-mirror.com");
  });
});
