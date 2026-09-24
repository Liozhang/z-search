/**
 * FullTextResolver — 搜索结果全文解析编排单测。
 *
 * StructuredFullTextClient（结构化 XML）与 web-content-fetcher（HTML）全
 * mock，只验本模块的编排逻辑：策略顺序、候选过滤、截断、异常吞噬。
 * JATS fixture 走真 parseTeiOrJats（纯函数，零网络），顺带覆盖 xmlToText。
 *
 * @module tests/unit/core/search/FullTextResolver
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  fetchStructuredXmlForArticle: vi.fn(),
  fetchFullText: vi.fn(),
}));

vi.mock("../../../../src/core/pdf/StructuredFullTextClient", () => ({
  fetchStructuredXmlForArticle: h.fetchStructuredXmlForArticle,
}));

vi.mock("../../../../src/core/search/scoring/web-content-fetcher", () => ({
  fetchFullText: h.fetchFullText,
}));

import {
  resolveArticleFullText,
  htmlCandidate,
  xmlToText,
} from "../../../../src/core/search/FullTextResolver";

// ── Fixtures ──────────────────────────────────────────────────────────

/** 三节 JATS（>200 字符门槛；parseTeiOrJats 按 <title> 落章名）。 */
const JATS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<article><body>
<sec sec-type="intro"><title>Introduction</title>
<p>The mesolimbic network supports affective behaviors in everyday life, and intracranial recordings reveal structure that static studies had missed.</p></sec>
<sec sec-type="methods"><title>Methods</title>
<p>We implanted depth electrodes in eleven participants and acquired continuous iEEG across two weeks of naturalistic behavior.</p></sec>
<sec sec-type="results"><title>Results</title>
<p>Gamma power in the nucleus accumbens tracked self reported positive affect with a lag of approximately four seconds.</p></sec>
</body></article>`;

describe("htmlCandidate", () => {
  it("accepts plain http(s) article pages", () => {
    expect(htmlCandidate("https://pmc.ncbi.nlm.nih.gov/articles/PMC1/")).toBe(
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/",
    );
  });

  it("rejects PDF direct links, SPA abstract pages and non-http", () => {
    expect(htmlCandidate("https://example.org/paper.pdf")).toBeNull();
    expect(
      htmlCandidate("https://example.org/paper.pdf?download=1"),
    ).toBeNull();
    expect(
      htmlCandidate("https://pubmed.ncbi.nlm.nih.gov/35273355/"),
    ).toBeNull();
    expect(htmlCandidate("ftp://example.org/x")).toBeNull();
    expect(htmlCandidate("")).toBeNull();
    expect(htmlCandidate(undefined)).toBeNull();
  });
});

describe("xmlToText", () => {
  it("emits section headers and joined body text", () => {
    const text = xmlToText(JATS_XML);
    expect(text).toContain("## Introduction");
    expect(text).toContain("## Methods");
    expect(text).toContain("## Results");
    expect(text).toContain("nucleus accumbens");
  });

  it("rejects publisher-restricted front-matter-only XML (no body/secs)", () => {
    // PMC 对禁止 XML 分发的文章只回 front-matter + 摘要：不当全文，
    // 交 html 兜底抓文章页。
    const restricted = `<?xml version="1.0"?>
<pmc-articleset><article article-type="research-article">
<!--The publisher of this article does not allow downloading of the full text in XML form.-->
<front><journal-meta><journal-title>J Clin Orthop Trauma</journal-title></journal-meta>
<article-meta><article-title>Restricted title</article-title>
<abstract><p>${"abstract text ".repeat(40)}</p></abstract></article-meta></front>
</article></pmc-articleset>`;
    expect(xmlToText(restricted)).toBeNull();
  });

  it("rejects XML without body even when sections parse", () => {
    const bodiless = `<?xml version="1.0"?><article><front><article-meta>
<abstract><p>${"only abstract ".repeat(40)}</p></abstract></article-meta></front></article>`;
    expect(xmlToText(bodiless)).toBeNull();
  });

  it("returns null for garbage / too-short XML", () => {
    expect(xmlToText("<html><body>not an article</body></html>")).toBeNull();
    expect(xmlToText("")).toBeNull();
  });
});

describe("resolveArticleFullText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetchStructuredXmlForArticle.mockResolvedValue(null);
    h.fetchFullText.mockResolvedValue(null);
  });

  it("structured-first: PMC JATS hit → no HTML request", async () => {
    h.fetchStructuredXmlForArticle.mockResolvedValue({
      xml: JATS_XML,
      source: "pmc-jats",
    });
    const r = await resolveArticleFullText({
      doi: "10.1038/s41562-022-01310-0",
      oaUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9232980/",
    });
    expect(r?.source).toBe("pmc-jats");
    expect(r?.text).toContain("## Methods");
    expect(r?.wordCount).toBeGreaterThan(20);
    expect(r?.truncated).toBe(false);
    expect(h.fetchFullText).not.toHaveBeenCalled();
  });

  it("structured miss → HTML fallback on oaUrl", async () => {
    h.fetchStructuredXmlForArticle.mockResolvedValue(null);
    h.fetchFullText.mockResolvedValue("x".repeat(500));
    const r = await resolveArticleFullText({
      doi: "10.9999/none",
      url: "https://pubmed.ncbi.nlm.nih.gov/1/",
      oaUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/",
    });
    expect(r?.source).toBe("html");
    // SPA 摘要页被过滤，只打 oaUrl
    expect(h.fetchFullText).toHaveBeenCalledTimes(1);
    expect(h.fetchFullText).toHaveBeenCalledWith(
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/",
    );
  });

  it("publisher-restricted XML (abstract-only) falls through to HTML", async () => {
    // PMC 对禁分发的文章只回 front-matter + 摘要：质量门判非全文，
    // html 兜底改抓 PMC 文章页（服务端渲染、含完整正文）。
    h.fetchStructuredXmlForArticle.mockResolvedValue({
      xml: `<?xml version="1.0"?><pmc-articleset><article>
<!--The publisher of this article does not allow downloading of the full text in XML form.-->
<front><article-meta><article-title>Restricted</article-title>
<abstract><p>${"abstract only ".repeat(40)}</p></abstract></article-meta></front>
</article></pmc-articleset>`,
      source: "pmc-jats",
    });
    h.fetchFullText.mockResolvedValue("q".repeat(400));
    const r = await resolveArticleFullText({
      pmcid: "PMC1",
      oaUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/",
    });
    expect(r?.source).toBe("html");
  });

  it("oaUrl is a PDF link → falls through to url HTML candidate", async () => {
    h.fetchFullText.mockResolvedValue("y".repeat(300));
    const r = await resolveArticleFullText(
      {
        oaUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/pdf/paper.pdf",
        url: "https://journals.example.org/article/123",
      },
      { strategy: "html-first" },
    );
    expect(r?.source).toBe("html");
    expect(h.fetchFullText).toHaveBeenCalledWith(
      "https://journals.example.org/article/123",
    );
  });

  it("html-first: HTML hit short-circuits the structured round trip", async () => {
    h.fetchFullText.mockResolvedValue("z".repeat(400));
    const r = await resolveArticleFullText(
      { doi: "10.1/x", oaUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/" },
      { strategy: "html-first" },
    );
    expect(r?.source).toBe("html");
    expect(h.fetchStructuredXmlForArticle).not.toHaveBeenCalled();
  });

  it("structured path throwing is swallowed → HTML still tried", async () => {
    h.fetchStructuredXmlForArticle.mockRejectedValue(new Error("network boom"));
    h.fetchFullText.mockResolvedValue("w".repeat(250));
    const r = await resolveArticleFullText({
      doi: "10.1/x",
      url: "https://journals.example.org/a",
    });
    expect(r?.source).toBe("html");
  });

  it("all strategies fail → null (never throws)", async () => {
    const r = await resolveArticleFullText({ doi: "10.1/x" });
    expect(r).toBeNull();
  });

  it("maxChars truncates and flags truncated", async () => {
    h.fetchStructuredXmlForArticle.mockResolvedValue({
      xml: JATS_XML,
      source: "pmc-jats",
    });
    const r = await resolveArticleFullText(
      { doi: "10.1/x" },
      { maxChars: 200 },
    );
    expect(r?.truncated).toBe(true);
    expect(r?.text.length).toBe(200);
  });

  it("short HTML (<100 chars) is rejected as a full text", async () => {
    h.fetchFullText.mockResolvedValue("too short");
    const r = await resolveArticleFullText({ doi: "10.1/x" });
    expect(r).toBeNull();
  });
});
