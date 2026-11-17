/**
 * domainQuery — 查询方言层的改写规则与总线接线。
 *
 * 覆盖（2026-11-17 HLA-typing 报障修复的回归网）：
 *  1. foldQuerySeparators：连字符/下划线折叠、排除语法与 CJK 不误伤
 *  2. toPhraseQuery：多词短语化、单词不加引号、自带引号不叠加
 *  3. applyQueryDialect：缺省方言与标识符查询原样透传
 *  4. 总线接线：searchDomain 按适配器声明的方言改写后扇出
 *  5. 适配器 URL 落地：nsf/dataverse 短语化、nasa/gbif 折叠后正确编码
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/httpHeaders", () => ({
  ZSEARCH_HTTP_HEADERS: {},
}));
vi.mock("../../../../src/utils/logger", () => ({
  safeDebug: vi.fn(),
  warn: vi.fn(),
}));

const httpRequest = vi.fn();
(globalThis as any).Zotero = {
  HTTP: {
    request: (...args: any[]) => httpRequest(...args),
  },
  Prefs: { get: vi.fn(() => undefined), clear: vi.fn() },
  Search: class {
    addCondition() {}
    async search() {
      return [];
    }
  },
};

import {
  foldQuerySeparators,
  toPhraseQuery,
  applyQueryDialect,
} from "../../../../src/core/search/domainQuery";
import {
  searchDomain,
  registerDomain,
  registerDomainAdapter,
} from "../../../../src/core/search/DomainSearchEngine";
import type {
  DomainResult,
  DomainDef,
} from "../../../../src/core/search/domainTypes";
import type { DomainSourceAdapter } from "../../../../src/core/search/DomainSourceAdapter";
import { NsfGrantAdapter } from "../../../../src/core/sources/grant-search/nsf";
import { DataverseAdapter } from "../../../../src/core/sources/dataset-search/dataverse/dataverse";
import { NasaOpenDataAdapter } from "../../../../src/core/sources/dataset-search/nasa/nasa";
import { GbifAdapter } from "../../../../src/core/sources/dataset-search/gbif/gbif";

describe("foldQuerySeparators", () => {
  it("folds hyphens and underscores between letters into single spaces", () => {
    expect(foldQuerySeparators("HLA-typing")).toBe("HLA typing");
    expect(foldQuerySeparators("HLA_typing")).toBe("HLA typing");
    expect(foldQuerySeparators("HLA--typing")).toBe("HLA typing");
    expect(foldQuerySeparators("HLA__typing-v2")).toBe("HLA typing v2");
  });

  it("collapses whitespace and preserves case", () => {
    expect(foldQuerySeparators("  hla   Typing ")).toBe("hla Typing");
  });

  it("keeps Lucene exclusion syntax intact (hyphen after space)", () => {
    expect(foldQuerySeparators("HLA -typing")).toBe("HLA -typing");
    expect(foldQuerySeparators("-typing")).toBe("-typing");
  });

  it("folds between CJK and digits as well", () => {
    expect(foldQuerySeparators("基因-编辑")).toBe("基因 编辑");
    expect(foldQuerySeparators("COVID-19 vaccine")).toBe("COVID 19 vaccine");
  });
});

describe("toPhraseQuery", () => {
  it("quotes multi-word queries after folding", () => {
    expect(toPhraseQuery("HLA-typing")).toBe('"HLA typing"');
    expect(toPhraseQuery("HLA typing")).toBe('"HLA typing"');
  });

  it("leaves single words unquoted and already-quoted queries untouched", () => {
    expect(toPhraseQuery("HLA")).toBe("HLA");
    expect(toPhraseQuery('"HLA typing"')).toBe('"HLA typing"');
  });

  it("strips inner quotes so the phrase cannot be closed early", () => {
    expect(toPhraseQuery('HLA "typ"ing')).toBe('"HLA typing"');
  });
});

describe("applyQueryDialect", () => {
  it("passes the query through untouched without a dialect", () => {
    expect(applyQueryDialect(undefined, "HLA-typing")).toBe("HLA-typing");
  });

  it("never rewrites whole-string identifier queries", () => {
    // DOI 在数据集/基金标签页里是真实输入，折叠会把它拆成碎片
    expect(applyQueryDialect("normalized", "10.1038/s41586-021-03819-2")).toBe(
      "10.1038/s41586-021-03819-2",
    );
    expect(applyQueryDialect("phrase", "10.1038/s41586-021-03819-2")).toBe(
      "10.1038/s41586-021-03819-2",
    );
    expect(applyQueryDialect("normalized", "pmid:36248247")).toBe(
      "pmid:36248247",
    );
  });

  it("applies folding or phrase quoting per dialect", () => {
    expect(applyQueryDialect("normalized", "HLA-typing")).toBe("HLA typing");
    expect(applyQueryDialect("phrase", "HLA-typing")).toBe('"HLA typing"');
  });
});

describe("DomainSearchEngine dialect wiring", () => {
  beforeEach(() => {
    httpRequest.mockReset();
  });

  /** 记录收到的查询串并返回空结果的 mock 适配器。 */
  function recordingAdapter(
    domainId: string,
    id: string,
    dialect: "normalized" | "phrase" | undefined,
    received: string[],
  ): DomainSourceAdapter {
    return {
      id,
      domainId,
      label: id,
      noKey: true,
      queryDialect: dialect,
      isAvailable: async () => ({ available: true }),
      search: async (q: string) => {
        received.push(q);
        return [] as DomainResult[];
      },
      profile: async () => null,
    } as DomainSourceAdapter;
  }

  it("rewrites the query per adapter dialect before fanning out", async () => {
    const def: DomainDef = {
      id: "dialect-wiring",
      label: "Dialect Wiring",
      sources: ["srcPhrase", "srcFold", "srcRaw"],
      dedupKey: (r) => r.dedupKey,
      importItemType: "journalArticle",
    };
    registerDomain(def);

    const phraseQ: string[] = [];
    const foldQ: string[] = [];
    const rawQ: string[] = [];
    registerDomainAdapter(
      recordingAdapter("dialect-wiring", "srcPhrase", "phrase", phraseQ),
    );
    registerDomainAdapter(
      recordingAdapter("dialect-wiring", "srcFold", "normalized", foldQ),
    );
    registerDomainAdapter(
      recordingAdapter("dialect-wiring", "srcRaw", undefined, rawQ),
    );

    await searchDomain("dialect-wiring", {
      query: "HLA-typing",
      maxResults: 10,
    });

    expect(phraseQ).toEqual(['"HLA typing"']);
    expect(foldQ).toEqual(["HLA typing"]);
    expect(rawQ).toEqual(["HLA-typing"]);
  });
});

describe("adapter URL embedding after dialect rewrite", () => {
  beforeEach(() => {
    httpRequest.mockReset();
  });

  it("NSF embeds the phrase-quoted keyword (URL-encoded)", async () => {
    httpRequest.mockResolvedValue({ status: 200, responseText: "{}" });
    const a = new NsfGrantAdapter();
    await a.search('"HLA typing"', 5);
    const url = httpRequest.mock.calls[0][1] as string;
    expect(url).toContain("keyword=%22HLA%20typing%22");
  });

  it("Dataverse embeds the phrase-quoted q (URL-encoded)", async () => {
    httpRequest.mockResolvedValue({
      status: 200,
      responseText: JSON.stringify({ data: { items: [] } }),
    });
    const a = new DataverseAdapter();
    await a.search('"HLA typing"', 5);
    const url = httpRequest.mock.calls[0][1] as string;
    expect(url).toContain("q=%22HLA%20typing%22");
  });

  it("NASA embeds the folded q with space encoding", async () => {
    httpRequest.mockResolvedValue({
      status: 200,
      responseText: JSON.stringify({ result: { results: [] } }),
    });
    const a = new NasaOpenDataAdapter();
    await a.search("HLA typing", 5);
    const url = httpRequest.mock.calls[0][1] as string;
    expect(url).toContain("q=HLA%20typing");
    expect(url).not.toContain("HLA-typing");
  });

  it("GBIF embeds the folded q with space encoding", async () => {
    httpRequest.mockResolvedValue({
      status: 200,
      responseText: JSON.stringify({ results: [] }),
    });
    const a = new GbifAdapter();
    await a.search("HLA typing", 5);
    const url = httpRequest.mock.calls[0][1] as string;
    expect(url).toContain("q=HLA%20typing");
    expect(url).not.toContain("HLA-typing");
  });
});
