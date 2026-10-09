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
  // 端点检测带模块级会话缓存（sessionDetected），逐用例重置模块避免串扰。
  vi.resetModules();
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

describe("buildEndpointProbeUrl", () => {
  it("探测 URL 与下载同布局（config.json 为探针）", async () => {
    const { buildEndpointProbeUrl } = await importManager();
    expect(
      buildEndpointProbeUrl(
        "https://huggingface.co",
        "Xenova/multilingual-e5-small",
      ),
    ).toBe(
      "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/config.json",
    );
  });
});

describe("selectEndpointFromProbes（探测结果选源）", () => {
  it("只有探测成功（latencyMs 非 null）的候选可入选，取最快", async () => {
    const { selectEndpointFromProbes } = await importManager();
    const best = selectEndpointFromProbes([
      { endpoint: "https://huggingface.co", latencyMs: null, error: "timeout" },
      { endpoint: "https://hf-mirror.com", latencyMs: 230 },
      { endpoint: "https://huggingface.co", latencyMs: 500 },
    ]);
    expect(best?.endpoint).toBe("https://hf-mirror.com");
  });

  it("全部失败返回 null（调用方回落区域默认）", async () => {
    const { selectEndpointFromProbes } = await importManager();
    expect(
      selectEndpointFromProbes([
        { endpoint: "https://huggingface.co", latencyMs: null, error: "x" },
        { endpoint: "https://hf-mirror.com", latencyMs: null, error: "y" },
      ]),
    ).toBeNull();
    expect(selectEndpointFromProbes([])).toBeNull();
  });
});

describe("resolveModelEndpointAsync（覆盖 > 检测缓存 > 现场探测 > 区域默认）", () => {
  const PREF = "extensions.zotero.zsearch.embedding.local.detectedEndpoint";

  /** 装 HTTP 假实现：按 URL 域名与探针/文件分流。 */
  function mockHttp(
    byHost: Record<string, (url: string) => any | Promise<any>>,
  ) {
    (globalThis as any).Zotero.HTTP = {
      request: async (_method: string, url: string) => {
        const host = Object.keys(byHost).find((k) => url.includes(k));
        if (!host) throw new Error(`unexpected url: ${url}`);
        return await byHost[host](url);
      },
    };
  }

  it("显式镜像覆盖最优先，不发探测请求", async () => {
    const httpSpy = vi.fn();
    (globalThis as any).Zotero.HTTP = { request: httpSpy };
    h.prefs.set(
      "extensions.zotero.zsearch.embedding.local.mirror",
      "https://hf.example.com/",
    );
    const { resolveModelEndpointAsync } = await importManager();
    expect(
      await resolveModelEndpointAsync("Xenova/multilingual-e5-small"),
    ).toBe("https://hf.example.com");
    expect(httpSpy).not.toHaveBeenCalled();
  });

  it("24 小时内的检测缓存直接复用，不重发探测", async () => {
    const httpSpy = vi.fn();
    (globalThis as any).Zotero.HTTP = { request: httpSpy };
    h.prefs.set(
      PREF,
      JSON.stringify({ endpoint: "https://hf-mirror.com", at: Date.now() }),
    );
    const { resolveModelEndpointAsync } = await importManager();
    expect(
      await resolveModelEndpointAsync("Xenova/multilingual-e5-small"),
    ).toBe("https://hf-mirror.com");
    expect(httpSpy).not.toHaveBeenCalled();
  });

  it("过期缓存（>24h）不采信，现场探测后写入新缓存", async () => {
    mockHttp({
      "huggingface.co": () => ({ status: 200, response: "{}" }),
      "hf-mirror.com": () => {
        throw new Error("timed out");
      },
    });
    h.prefs.set(
      PREF,
      JSON.stringify({
        endpoint: "https://hf-mirror.com",
        at: Date.now() - 25 * 60 * 60 * 1000,
      }),
    );
    const { resolveModelEndpointAsync } = await importManager();
    expect(
      await resolveModelEndpointAsync("Xenova/multilingual-e5-small"),
    ).toBe("https://huggingface.co");
    const cached = JSON.parse(h.prefs.get(PREF));
    expect(cached.endpoint).toBe("https://huggingface.co");
  });

  it("无缓存时现场探测：官方 200、镜像失败 → 选官方并记缓存", async () => {
    mockHttp({
      "huggingface.co": () => ({ status: 200, response: "{}" }),
      "hf-mirror.com": () => {
        throw new Error("connection refused");
      },
    });
    const { resolveModelEndpointAsync } = await importManager();
    expect(
      await resolveModelEndpointAsync("Xenova/multilingual-e5-small"),
    ).toBe("https://huggingface.co");
    expect(JSON.parse(h.prefs.get(PREF)).endpoint).toBe(
      "https://huggingface.co",
    );
  });

  it("两端点均不可达 → 回落区域默认（cn → hf-mirror），不写缓存", async () => {
    mockHttp({
      "huggingface.co": () => {
        throw new Error("timed out");
      },
      "hf-mirror.com": () => {
        throw new Error("timed out");
      },
    });
    h.prefs.set("extensions.zotero.zsearch.region", "cn");
    const { resolveModelEndpointAsync } = await importManager();
    expect(
      await resolveModelEndpointAsync("Xenova/multilingual-e5-small"),
    ).toBe("https://hf-mirror.com");
    expect(h.prefs.get(PREF)).toBeUndefined();
  });
});

describe("downloadModel（端点回落）", () => {
  const PREF = "extensions.zotero.zsearch.embedding.local.detectedEndpoint";

  /** 无盘环境：所有文件视为未下载，写盘只记录不落 IO。 */
  function mockDisk() {
    const written: string[] = [];
    (globalThis as any).PathUtils = {
      join: (...segs: string[]) => segs.join("/"),
    };
    (globalThis as any).Zotero.DataDirectory = { dir: "/data" };
    (globalThis as any).IOUtils = {
      stat: async () => {
        throw new Error("not found");
      },
      makeDirectory: async () => {},
      write: async (path: string) => {
        written.push(path);
      },
    };
    return written;
  }

  it("选中端点文件下载失败 → 自动回落另一内置源并完成下载", async () => {
    mockDisk();
    const requestedHosts: string[] = [];
    (globalThis as any).Zotero.HTTP = {
      request: async (_method: string, url: string) => {
        requestedHosts.push(url);
        if (url.includes("hf-mirror.com")) {
          throw new Error("mirror broken");
        }
        return { status: 200, response: new Uint8Array([1]).buffer };
      },
    };
    h.prefs.set("extensions.zotero.zsearch.region", "cn");
    // 预置新鲜检测缓存指向镜像：主端点即镜像（失败方），官方为回落方。
    h.prefs.set(
      PREF,
      JSON.stringify({ endpoint: "https://hf-mirror.com", at: Date.now() }),
    );
    const { downloadModel } = await importManager();
    await downloadModel("Xenova/multilingual-e5-small");
    expect(requestedHosts.some((u) => u.includes("hf-mirror.com"))).toBe(true);
    expect(requestedHosts.some((u) => u.includes("huggingface.co"))).toBe(true);
    // 回落成功后检测缓存翻转到成功的端点。
    expect(JSON.parse(h.prefs.get(PREF)).endpoint).toBe(
      "https://huggingface.co",
    );
  });

  it("显式镜像覆盖失败时如实上抛，不静默换源", async () => {
    mockDisk();
    const requestedHosts: string[] = [];
    (globalThis as any).Zotero.HTTP = {
      request: async (_method: string, url: string) => {
        requestedHosts.push(url);
        throw new Error("override broken");
      },
    };
    h.prefs.set(
      "extensions.zotero.zsearch.embedding.local.mirror",
      "https://hf.example.com",
    );
    const { downloadModel } = await importManager();
    await expect(downloadModel("Xenova/multilingual-e5-small")).rejects.toThrow(
      /hf\.example\.com/,
    );
    expect(requestedHosts.every((u) => u.includes("hf.example.com"))).toBe(
      true,
    );
  });
});
