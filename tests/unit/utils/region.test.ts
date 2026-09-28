/**
 * region — 网络区域选择单测。
 *
 * 覆盖三件事：区域值的归一化（坏值不得改变行为）、区域推荐值的守门套用
 * （只改仍是出厂默认的键；用户选过的不被推翻）、维基主机名解析（跟随
 * 界面语言 + pref 覆盖 + 非法覆盖回落）。
 *
 * Zotero.Prefs 全 mock（extensions.zotero.zsearch.* 命名空间镜像）。
 *
 * @module tests/unit/utils/region
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
      clear: (key: string) => {
        h.prefs.delete(full(key));
      },
    },
  };
});

import {
  NETWORK_REGIONS,
  REGION_PROFILES,
  applyRegionRecommendations,
  getNetworkRegion,
  getRegionProfile,
  normalizeRegion,
  regionRecommendation,
  resolveWikiHost,
  setNetworkRegion,
  wikiHostFromLocale,
} from "../../../src/utils/region";

/** 出厂默认（addon/prefs.js 的镜像）。 */
function seedShippedDefaults() {
  h.prefs.clear();
  h.prefs.set("extensions.zotero.zsearch.region", "auto");
  h.prefs.set(
    "extensions.zotero.zsearch.search.web.defaultProvider",
    "duckduckgo",
  );
  h.prefs.set("extensions.zotero.zsearch.translate.engineType", "google");
  h.prefs.set("extensions.zotero.zsearch.translate.bing.region", "");
}

describe("normalizeRegion", () => {
  it("放行三个合法值", () => {
    expect(NETWORK_REGIONS).toEqual(["auto", "global", "cn"]);
    expect(normalizeRegion("auto")).toBe("auto");
    expect(normalizeRegion("global")).toBe("global");
    expect(normalizeRegion("cn")).toBe("cn");
  });

  it("坏值一律回落 auto（空串 / null / 旧版残留 / 大小写）", () => {
    expect(normalizeRegion("")).toBe("auto");
    expect(normalizeRegion(undefined)).toBe("auto");
    expect(normalizeRegion(null)).toBe("auto");
    expect(normalizeRegion("CN")).toBe("auto");
    expect(normalizeRegion("mainland")).toBe("auto");
  });
});

describe("region pref read/write", () => {
  beforeEach(() => {
    h.prefs.clear();
  });

  it("未设置时读作 auto", () => {
    expect(getNetworkRegion()).toBe("auto");
  });

  it("写入时归一化：坏值存不进去", () => {
    setNetworkRegion("cn");
    expect(getNetworkRegion()).toBe("cn");
    setNetworkRegion("nonsense" as any);
    expect(getNetworkRegion()).toBe("auto");
  });

  it("pref 里躺着坏值时读作 auto（不得让坏值改变行为）", () => {
    h.prefs.set("extensions.zotero.zsearch.region", "zh-Hans");
    expect(getNetworkRegion()).toBe("auto");
  });
});

describe("region profiles", () => {
  it("auto 不给推荐值", () => {
    expect(getRegionProfile("auto")).toBeNull();
    expect(regionRecommendation("search.web.defaultProvider", "auto")).toBe(
      "duckduckgo",
    );
    expect(regionRecommendation("translate.engineType", "auto")).toBe("google");
    expect(regionRecommendation("translate.bing.region", "auto")).toBe("");
  });

  it("global 推荐国际可达链路", () => {
    const p = getRegionProfile("global")!;
    expect(p.webDefaultProvider).toBe("duckduckgo");
    expect(p.translateEngine).toBe("google");
    expect(p.bingRegion).toBe("global");
  });

  it("cn 推荐国内可达链路（Bing 网页 / Bing 网页翻译 / 华北订阅区）", () => {
    const p = getRegionProfile("cn")!;
    expect(p.webDefaultProvider).toBe("bing-html");
    expect(p.translateEngine).toBe("bing-web");
    expect(p.bingRegion).toBe("chinanorth");
  });

  it("两份 profile 覆盖 REGION_PROFILES 全表", () => {
    expect(Object.keys(REGION_PROFILES).sort()).toEqual(["cn", "global"]);
  });
});

describe("applyRegionRecommendations", () => {
  beforeEach(seedShippedDefaults);

  it("全默认态：cn 一次改写三项", () => {
    const written = applyRegionRecommendations("cn");
    expect(written.sort()).toEqual([
      "search.web.defaultProvider",
      "translate.bing.region",
      "translate.engineType",
    ]);
    expect(
      h.prefs.get("extensions.zotero.zsearch.search.web.defaultProvider"),
    ).toBe("bing-html");
    expect(h.prefs.get("extensions.zotero.zsearch.translate.engineType")).toBe(
      "bing-web",
    );
    expect(h.prefs.get("extensions.zotero.zsearch.translate.bing.region")).toBe(
      "chinanorth",
    );
  });

  it("守门：用户改过的默认源不被区域选择推翻", () => {
    h.prefs.set(
      "extensions.zotero.zsearch.search.web.defaultProvider",
      "searxng",
    );
    const written = applyRegionRecommendations("cn");
    expect(written).not.toContain("search.web.defaultProvider");
    expect(
      h.prefs.get("extensions.zotero.zsearch.search.web.defaultProvider"),
    ).toBe("searxng");
    // 其余两项仍是出厂默认 → 照改
    expect(written.sort()).toEqual([
      "translate.bing.region",
      "translate.engineType",
    ]);
  });

  it("force：设置面板的「重新应用」才覆盖用户选过的值", () => {
    h.prefs.set("extensions.zotero.zsearch.translate.engineType", "deepl");
    expect(applyRegionRecommendations("cn")).not.toContain(
      "translate.engineType",
    );
    expect(h.prefs.get("extensions.zotero.zsearch.translate.engineType")).toBe(
      "deepl",
    );
    const forced = applyRegionRecommendations("cn", { force: true });
    expect(forced).toContain("translate.engineType");
    expect(h.prefs.get("extensions.zotero.zsearch.translate.engineType")).toBe(
      "bing-web",
    );
  });

  it("已是推荐值时零写入（幂等）", () => {
    applyRegionRecommendations("cn");
    expect(applyRegionRecommendations("cn")).toEqual([]);
    expect(applyRegionRecommendations("cn", { force: true })).toEqual([]);
  });

  it("auto 不写任何 pref", () => {
    expect(applyRegionRecommendations("auto")).toEqual([]);
    expect(
      h.prefs.get("extensions.zotero.zsearch.search.web.defaultProvider"),
    ).toBe("duckduckgo");
  });

  it("非法区域值按 auto 处理（不写）", () => {
    expect(applyRegionRecommendations("bogus" as any)).toEqual([]);
  });
});

describe("wikiHostFromLocale", () => {
  it("按界面语言选分站", () => {
    expect(wikiHostFromLocale("zh-CN")).toBe("zh.wikipedia.org");
    expect(wikiHostFromLocale("zh-TW")).toBe("zh.wikipedia.org");
    expect(wikiHostFromLocale("ja-JP")).toBe("ja.wikipedia.org");
    expect(wikiHostFromLocale("pt-BR")).toBe("pt.wikipedia.org");
    expect(wikiHostFromLocale("de")).toBe("de.wikipedia.org");
  });

  it("坏输入回落英文维基（含注入企图）", () => {
    expect(wikiHostFromLocale("")).toBe("en.wikipedia.org");
    expect(wikiHostFromLocale(undefined)).toBe("en.wikipedia.org");
    expect(wikiHostFromLocale(null)).toBe("en.wikipedia.org");
    expect(wikiHostFromLocale("x")).toBe("en.wikipedia.org");
    // 下划线区域形按 Zotero 惯例处理：取基语言 zh（后缀不是主机名）
    expect(wikiHostFromLocale("zh_CN.override")).toBe("zh.wikipedia.org");
    // 只取第一段且必须是 2-8 个字母：带点/带数字/过短的一律不是语言码，
    // 绝不让输入拼进主机名
    expect(wikiHostFromLocale("zh.wikipedia.org")).toBe("en.wikipedia.org");
    expect(wikiHostFromLocale("../evil.com")).toBe("en.wikipedia.org");
    expect(wikiHostFromLocale("zh-CN/../../x")).toBe("zh.wikipedia.org");
    expect(wikiHostFromLocale("a-b")).toBe("en.wikipedia.org");
    expect(wikiHostFromLocale("1234567890")).toBe("en.wikipedia.org");
  });
});

describe("resolveWikiHost", () => {
  beforeEach(() => {
    h.prefs.clear();
  });

  it("无覆盖时跟随界面语言", () => {
    expect(resolveWikiHost("zh-CN")).toBe("zh.wikipedia.org");
    expect(resolveWikiHost("en-US")).toBe("en.wikipedia.org");
  });

  it("pref 覆盖优先（含镜像站）", () => {
    h.prefs.set(
      "extensions.zotero.zsearch.search.web.wikipedia.host",
      "zh.m.wikipedia.org",
    );
    expect(resolveWikiHost("en-US")).toBe("zh.m.wikipedia.org");
  });

  it("覆盖值大小写不敏感（与写入侧归一化一致）", () => {
    h.prefs.set(
      "extensions.zotero.zsearch.search.web.wikipedia.host",
      "ZH.Wikipedia.ORG",
    );
    expect(resolveWikiHost("en-US")).toBe("zh.wikipedia.org");
  });

  it("非法覆盖不生效，回落语言推导", () => {
    h.prefs.set(
      "extensions.zotero.zsearch.search.web.wikipedia.host",
      "https://zh.wikipedia.org",
    );
    expect(resolveWikiHost("en-US")).toBe("en.wikipedia.org");
    h.prefs.set(
      "extensions.zotero.zsearch.search.web.wikipedia.host",
      "zh.wikipedia.org/x",
    );
    expect(resolveWikiHost("zh-CN")).toBe("zh.wikipedia.org");
    h.prefs.set(
      "extensions.zotero.zsearch.search.web.wikipedia.host",
      "not a host",
    );
    expect(resolveWikiHost("ja-JP")).toBe("ja.wikipedia.org");
  });
});
