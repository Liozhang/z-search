/**
 * PaperEvaluator — paper scoring, filtering, and dedup helpers extracted from DiscoveryEngine.
 */

import type { IAIProvider } from "../../types/ai";
import { parseJsonFromMarkdown } from "../../utils/json";
import type {
  DiscoveredPaper,
  DiscoveryBlacklist,
  DiscoveryFilterConfig,
  RelatedConcept,
} from "./DiscoveryTypes";
import { safeDebug } from "../../utils/logger";

/**
 * AI batch-evaluates papers with multi-dimensional scoring.
 * Inspired by ArticleEvaluator: base score + additions - deductions.
 */
export async function aiEvaluatePapers(
  provider: IAIProvider,
  sourceTitle: string,
  concepts: RelatedConcept[],
  papers: any[],
  blacklist: DiscoveryBlacklist,
): Promise<DiscoveredPaper[]> {
  if (!provider || papers.length === 0) return [];

  const paperSummaries = papers.map((p, i) => ({
    i,
    t: (p.title || "").slice(0, 200),
    a: (p.abstract || "").slice(0, 300),
    y: p.year || "",
    c: p.citationCount ?? 0,
    d: p.doi || "",
    q: p._queryOrigin || "",
    j: p.containerTitle || "",
  }));

  const conceptsStr = concepts.map((c) => `${c.concept}(${c.type})`).join(", ");

  const blacklistedJournals = blacklist.journals.join(", ");

  const prompt = `You are an academic literature evaluation expert. Evaluate the relevance of the following papers to the user's research direction.

## User's Research Direction (extracted from paper "${sourceTitle}")
Core concepts: ${conceptsStr}

## Papers to Evaluate
${JSON.stringify(paperSummaries)}

## Evaluation Rules
### Type Base Score
- Original research / new method: 65
- Technical tutorial / deep dive: 50
- Survey / review: 40
- Tool / dataset release: 55
- Preprint: 60

### Bonuses
+ Directly uses or improves a core concept method: +15
+ Solves a key problem in a related domain: +10
+ Has experimental validation and benchmarks: +8
+ From a top journal/conference: +5
+ Provides code/data: +5

### Deductions
- No direct connection to core concepts: -20
- Only superficially mentions related methods: -10
- Content too old (3+ years, non-classic): -5
${blacklistedJournals ? `- Journal in blacklist (${blacklistedJournals}): -30` : ""}

## Output Format (pure JSON array, no markdown)
[{"i":0,"s":72,"t":"research","r":"Improved XX method and applied to YY scenario","k":"Proposed ZZ algorithm, improved performance on AA dataset by 15%"}]

Only output papers with s>=40, sorted by s descending. i=original index, s=score, t=type, r=recommendation reason, k=core contribution.`;

  try {
    const response = await provider.execute({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      maxTokens: 1500,
    });

    const evaluations = parseJsonFromMarkdown(response.content);
    if (!Array.isArray(evaluations)) return [];

    const { heuristicScoreSearchResult } =
      await import("./scoring/search-result-scorer");
    const { fuseScores } = await import("./scoring/score-fusion");

    return evaluations
      .filter((e: any) => e.s >= 40 && typeof e.i === "number")
      .map((e: any) => {
        const original = papers[e.i] || {};

        // Heuristic scoring + fusion (use AI-extracted concept names as dynamic keywords)
        const conceptKeywords = concepts.map((c) => c.concept);
        const heuristic = heuristicScoreSearchResult(
          {
            title: original.title || "",
            abstract: original.abstract || "",
            citationCount: original.citationCount ?? 0,
            year: original.year || "",
            source: original.source || "",
            url: original.url || original.pdfUrl || original.oaUrl || "",
            containerTitle: original.containerTitle || "",
          },
          null,
          conceptKeywords.length > 0 ? conceptKeywords : undefined,
        );
        const fused = fuseScores(e.s, heuristic.score);

        return {
          title: original.title || "",
          authors: original.authors || "",
          year: original.year || "",
          doi: original.doi || "",
          abstract: original.abstract || "",
          citationCount: original.citationCount ?? 0,
          source: original.source || "openalex",
          containerTitle: original.containerTitle || "",
          journalName:
            original.journalName || original.containerTitle || undefined,
          issn: original.issn || undefined,
          volume: original.volume || undefined,
          issue: original.issue || undefined,
          pages: original.pages || undefined,
          publicationType: original.publicationType || undefined,
          publisher: original.publisher || undefined,
          relevanceScore: fused,
          paperType: e.t || "research",
          relevanceReason: e.r || "",
          keyContribution: e.k || "",
          queryOrigin: original._queryOrigin || "",
          heuristicScore: heuristic.score,
          fusedScore: fused,
          fullTextAvailable: heuristic.fullTextAvailable,
        } satisfies DiscoveredPaper;
      })
      .sort(
        (a: DiscoveredPaper, b: DiscoveredPaper) =>
          b.relevanceScore - a.relevanceScore,
      );
  } catch (e) {
    safeDebug("[z-search] PaperEvaluator.evaluatePapers failed: " + e);
    return [];
  }
}

/**
 * Domain whitelist + blacklist filter.
 * DomainFilter.should_keep().
 * Blacklist takes priority; whitelist matching grants pass; empty whitelist allows all.
 */
export function filterByDomain(
  papers: any[],
  config: DiscoveryFilterConfig,
): any[] {
  const { blacklist, whitelist } = config;

  return papers.filter((p) => {
    const url = (p.url || p.pdfUrl || p.oaUrl || "").toLowerCase();
    const journal = (p.containerTitle || "").toLowerCase();

    // Blacklist takes priority
    for (const d of blacklist.domains) {
      if (url.includes(d)) return false;
    }
    for (const j of blacklist.journals) {
      if (journal.includes(j)) return false;
    }

    // Whitelist: if configured and matches → pass immediately
    if (whitelist.domains.length > 0) {
      for (const d of whitelist.domains) {
        if (url.includes(d)) return true;
      }
      // Has whitelist but no domain match → check journal
      if (whitelist.journals.length > 0) {
        for (const j of whitelist.journals) {
          if (journal.includes(j)) return true;
        }
      }
      // Whitelist configured but no match → still allow (soft mode)
    }

    return true;
  });
}

/**
 * Soft title keyword filter — matched papers come first, unmatched after.
 * filters.py `title_keyword_filter`.
 *
 * Extracts keywords from query (English words ≥4 chars + Chinese chunks ≥2 chars),
 * then partitions papers into matched / unmatched groups, concatenated.
 */
export function filterByTitleKeywords(papers: any[], query: string): any[] {
  if (!query || papers.length <= 1) return papers;

  const keywords: string[] = [];
  const enWords = query.match(/[a-zA-Z]{4,}/g) || [];
  keywords.push(...enWords.map((w) => w.toLowerCase()));
  const zhChunks = query.match(/[\u4e00-\u9fff]{2,}/g) || [];
  keywords.push(...zhChunks);

  if (keywords.length === 0) return papers;

  const pattern = keywords
    .map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(pattern, "i");

  const matched: any[] = [];
  const unmatched: any[] = [];
  for (const p of papers) {
    if (regex.test(p.title || "")) {
      matched.push(p);
    } else {
      unmatched.push(p);
    }
  }

  // Soft sort: matched first, unmatched after (no papers discarded)
  return matched.concat(unmatched);
}

/**
 * Check if a DOI already exists in the Zotero library.
 */
export async function isInLibrary(doi: string): Promise<boolean> {
  try {
    const s = new Zotero.Search();
    s.addCondition("DOI", "is", doi);
    const ids = await s.search();
    return ids.length > 0;
  } catch (e) {
    safeDebug(
      "[z-search] PaperEvaluator.isInLibrary(" + doi + ") failed: " + e,
    );
    return false;
  }
}

/**
 * Deduplicate articles by DOI or normalized title.
 */
export function deduplicate(articles: any[]): any[] {
  const seen = new Map<string, any>();
  for (const article of articles) {
    if (article.doi) {
      const key = article.doi.toLowerCase().trim();
      if (!seen.has(key)) seen.set(key, article);
      else mergeArticleInfo(seen.get(key)!, article);
      continue;
    }
    const titleKey = (article.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (titleKey.length < 10) continue;
    if (!seen.has(titleKey)) seen.set(titleKey, article);
    else mergeArticleInfo(seen.get(titleKey)!, article);
  }
  return Array.from(seen.values());
}

/**
 * Merge missing fields from source into target.
 */
export function mergeArticleInfo(target: any, source: any): void {
  if (!target.abstract && source.abstract) target.abstract = source.abstract;
  if (!target.pdfUrl && source.pdfUrl) target.pdfUrl = source.pdfUrl;
  if (!target.citationCount && source.citationCount)
    target.citationCount = source.citationCount;
  if (!target.containerTitle && source.containerTitle)
    target.containerTitle = source.containerTitle;
  if (!target.journalName && source.journalName)
    target.journalName = source.journalName;
  if (!target.issn && source.issn) target.issn = source.issn;
  if (!target.volume && source.volume) target.volume = source.volume;
  if (!target.issue && source.issue) target.issue = source.issue;
  if (!target.pages && source.pages) target.pages = source.pages;
  if (!target.publisher && source.publisher)
    target.publisher = source.publisher;
  if (!target.doi && source.doi) target.doi = source.doi;
}
