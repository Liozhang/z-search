/**
 * translationEngines — 引擎选择与 Azure 订阅区单测。
 *
 * 跨境相关的两点：`translate.engineType` 是用户可选的（含 2026-09-28 新增
 * 的免 key "bing-web"——中国大陆唯一可达的免 key 引擎），Azure Translator
 * 的订阅区来自 pref（国内 key 必须能改成 chinanorth，而不必手改 prefs.js）。
 *
 * @module tests/unit/core/translation/translationEngines
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ prefs: new Map<string, any>() }));

vi.hoisted(() => {
  const full = (key: string) =>
    key.startsWith("extensions.zotero.zsearch.")
      ? key
      : `extensions.zotero.zsearch.${key}`;
  (globalThis as any).Zotero = {
    debug: () => {},
    Prefs: {
      get: (key: string) => h.prefs.get(full(key)),
      set: (key: string, value: any) => {
        h.prefs.set(full(key), value);
      },
    },
  };
});

import {
  getEngineConfig,
  supportsBatching,
  createTranslator,
} from "../../../../src/core/translation/translationEngines";

const put = (key: string, value: any) =>
  h.prefs.set(`extensions.zotero.zsearch.${key}`, value);

describe("getEngineConfig", () => {
  beforeEach(() => {
    h.prefs.clear();
  });

  it("出厂默认：google 引擎 + Azure 区 global", () => {
    const cfg = getEngineConfig();
    expect(cfg.engineType).toBe("google");
    expect(cfg.bingRegion).toBe("global");
  });

  it("pref 声明 cn 订阅区时透传（Azure 国内 key 的必要条件）", () => {
    put("translate.engineType", "bing");
    put("translate.bing.region", "chinanorth");
    const cfg = getEngineConfig();
    expect(cfg.engineType).toBe("bing");
    expect(cfg.bingRegion).toBe("chinanorth");
  });

  it("bing-web 引擎可被选中（免 key、大陆可达）", () => {
    put("translate.engineType", "bing-web");
    expect(getEngineConfig().engineType).toBe("bing-web");
    // 免 key 引擎不进批量路径（只有 AI 引擎吃 generateObject）
    expect(supportsBatching()).toBe(false);
  });

  it("空 engineType 回落 google（缺 pref 不抛）", () => {
    put("translate.engineType", "");
    expect(getEngineConfig().engineType).toBe("google");
  });
});

describe("createTranslator", () => {
  beforeEach(() => {
    h.prefs.clear();
    (globalThis as any).fetch = undefined;
  });

  it("bing-web 引擎打到 Bing web 端点（免 key）", async () => {
    put("translate.engineType", "bing-web");
    const calls: string[] = [];
    // 令牌页（GET）与翻译 POST 都由 fetch 承担——按序喂两拍回包。
    (globalThis as any).fetch = vi.fn(async (url: string, init: any) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (calls.length === 1) {
        return {
          ok: true,
          url: "https://www.bing.com/translator",
          text: async () =>
            'IG:"ABCDEF0123456789" params_AbusePreventionHelper = [1,"k",3600000] id="rich_tta" data-iid="translator.5023"',
        } as any;
      }
      return {
        ok: true,
        json: async () => [{ translations: [{ text: "译文" }] }],
      } as any;
    });
    const translate = createTranslator("zh-CN", "en");
    const out = await translate("hello", "zh-CN", "en");
    expect(out).toBe("译文");
    expect(calls[0]).toContain("https://www.bing.com/translator");
    expect(calls[1]).toContain("ttranslatev3");
  });

  it("bing-web 失败时抛错（不静默回退到 Google）", async () => {
    put("translate.engineType", "bing-web");
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error("blocked");
    });
    const translate = createTranslator("zh-CN");
    await expect(translate("hello", "zh-CN")).rejects.toThrow(/blocked/);
  });
});
