/**
 * AcademicQueryAdapter — Converts general queries into academic search engine-specific queries.
 *
 * LLM primary path: one AI call generates adapted queries for all engines.
 * Rule-based fallback: constructs queries based on MeSH mapping and keyword extraction, no external API dependency.
 */

import AIProviderRegistry from "../ai/AIProviderRegistry";
import { safeDebug } from "../../utils/logger";

export interface AdaptedQueries {
  openalex: string;
  "semantic-scholar": string;
  pubmed: string;
  arxiv: string;
  crossref: string;
  "europe-pmc": string;
}

/** High-frequency MeSH mapping table (keys normalized to lowercase), covering common biomedical / CS terms */
const MESH_MAP: Readonly<Record<string, string[]>> = {
  // Biomedical
  "rna-seq": ["RNA-Seq", "Transcriptome", "Gene Expression Profiling"],
  transcriptomics: ["Transcriptome", "Gene Expression Profiling"],
  crispr: ["CRISPR-Cas Systems", "Gene Editing"],
  "crispr-cas9": ["CRISPR-Cas Systems", "Gene Editing"],
  "gene editing": ["Gene Editing", "Genome Editing"],
  "gene expression": ["Gene Expression"],
  "single-cell": ["Single-Cell Analysis"],
  "single-cell rna-seq": ["Single-Cell Analysis", "RNA-Seq", "Transcriptome"],
  "scRNA-seq": ["Single-Cell Analysis", "RNA-Seq"],
  proteomics: ["Proteomics", "Proteome"],
  metabolomics: ["Metabolomics"],
  epigenomics: ["Epigenomics", "Epigenesis, Genetic"],
  microbiome: ["Microbiome", "Metagenome"],
  metagenomics: ["Metagenome", "Microbiome"],
  "genome-wide association": ["Genome-Wide Association Study"],
  gwas: ["Genome-Wide Association Study"],
  "drug repurposing": ["Drug Repurposing", "Drug Discovery"],
  "drug discovery": ["Drug Discovery", "Pharmaceutical Preparations"],
  "clinical trial": ["Clinical Trial"],
  "randomized controlled trial": ["Randomized Controlled Trial"],
  "meta-analysis": ["Meta-Analysis as Topic"],
  "systematic review": ["Review Literature as Topic"],
  immunotherapy: ["Immunotherapy", "Immunologic Therapy"],
  "checkpoint inhibitor": ["Immune Checkpoint Inhibitors", "Immunotherapy"],
  antibody: ["Antibodies", "Immunoglobulins"],
  vaccine: ["Vaccines", "Immunization"],
  "stem cell": ["Stem Cells", "Pluripotent Stem Cells"],
  cancer: ["Neoplasms", "Cancer"],
  tumor: ["Neoplasms", "Neoplasm"],
  biomarker: ["Biomarkers"],
  bioinformatics: ["Computational Biology", "Bioinformatics"],
  // AI / CS
  "machine learning": ["Machine Learning", "Deep Learning"],
  "deep learning": ["Deep Learning", "Machine Learning"],
  "neural network": ["Neural Networks, Computer", "Deep Learning"],
  "natural language processing": ["Natural Language Processing"],
  nlp: ["Natural Language Processing"],
  "computer vision": ["Computer Vision"],
  "reinforcement learning": ["Reinforcement Learning"],
  "large language model": ["Large Language Models", "Artificial Intelligence"],
  llm: ["Large Language Models", "Artificial Intelligence"],
  transformer: ["Transformers, Neural Network", "Deep Learning"],
  "generative ai": [
    "Artificial Intelligence",
    "Generative Adversarial Networks",
  ],
  "protein structure": ["Protein Structure", "Protein Conformation"],
  "drug-target interaction": ["Drug Targets", "Protein-Ligand Binding"],
  "molecular docking": ["Molecular Docking Simulation"],
  "attention mechanism": ["Attention", "Deep Learning"],
  "knowledge graph": ["Knowledge Bases", "Semantics"],
  "federated learning": ["Machine Learning", "Distributed Computing"],
  // General methods
  "gene therapy": ["Gene Therapy"],
  "cell therapy": ["Cell Therapy", "Cell- and Tissue-Based Therapy"],
  "gene knockout": ["Gene Knockout Techniques"],
  "rt-pcr": ["Reverse Transcriptase Polymerase Chain Reaction"],
  pcr: ["Polymerase Chain Reaction"],
  "flow cytometry": ["Flow Cytometry"],
  "mass spectrometry": ["Mass Spectrometry"],
  "cryo-em": ["Cryo-Electron Microscopy", "Electron Microscopy"],
  "x-ray crystallography": ["X-Ray Crystallography", "Crystallography, X-Ray"],
};

const STOP_WORDS = new Set([
  // English noise
  "this",
  "that",
  "with",
  "from",
  "have",
  "been",
  "they",
  "them",
  "their",
  "your",
  "about",
  "which",
  "what",
  "when",
  "where",
  "there",
  "would",
  "could",
  "should",
  "more",
  "some",
  "other",
  "also",
  "into",
  "over",
  "after",
  "before",
  "between",
  "through",
  "than",
  "then",
  "very",
  "just",
  "only",
  "such",
  "each",
  "every",
  "these",
  "those",
  "latest",
  "best",
  "most",
  // Query noise
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "how",
  "new",
  "old",
  "see",
  "way",
  "who",
  "did",
  "get",
  "use",
  "using",
  "used",
  "based",
  "method",
  "study",
  "data",
  "analysis",
  "approach",
  "review",
  "overview",
  "tutorial",
  "guide",
  "tool",
  "tools",
  "2024",
  "2025",
  "2026",
]);

const ARXIV_NOISE = new Set([
  "data",
  "analysis",
  "using",
  "method",
  "based",
  "study",
  "approach",
  "novel",
  "efficient",
  "effective",
  "improved",
  "performance",
  "comparison",
  "evaluation",
  "survey",
]);

const ADAPT_PROMPT = `You are an expert in biomedical and computer science literature retrieval. Convert the user's web search query into optimized queries for each academic search engine.

## Output Format
Pure JSON — one optimized query string per engine:
{
  "pubmed": "PubMed query using MeSH terms, Boolean operators, and field tags: [MeSH Terms], [Title/Abstract], [All Fields], [Date - Publication]",
  "semantic_scholar": "Natural language keyword query (English, specific, includes method/tool names)",
  "arxiv": "Short keyword query (1-5 core terms)",
  "openalex": "Natural language keyword query (English, can include filter syntax)",
  "crossref": "Keyword query (space-separated terms)",
  "europe_pmc": "Boolean query similar to PubMed (use MeSH terms and field tags)"
}

## PubMed / Europe PMC Rules
- Use field tags: [MeSH Terms], [Title/Abstract], [All Fields], [Date - Publication]
- Date ranges: "[Year1 : Year2]" (NOT "[dp]")
- Use AND/OR for Boolean queries, parenthesize groups
- Synonyms → OR, different concepts → AND
- Do NOT include field names like typ/status/kind

## Semantic Scholar / OpenAlex Rules
- Natural language English keywords, no Boolean operators
- Be specific: include method names, tool names, protein/gene names
- OpenAlex: can include filter.title, filter.concept notation if appropriate

## arXiv Rules
- 1-5 core keywords, concise
- Remove noise words like "novel", "efficient", "performance"

## CrossRef Rules
- Space-separated keywords, no special syntax
- Include distinctive terms (DOI-related, author names, exact titles)

## Important
- Extract core concepts from the query, remove noise like "latest", "best", "tutorial", "2025"
- Output exactly ONE query per engine, not multiple
- Output ONLY JSON, no markdown, no explanation`;

const REVIEW_ADAPT_PROMPT = `You are an expert in biomedical and computer science literature retrieval. The goal is to find REVIEW/SURVEYY/SYSTEMATIC REVIEW papers for the given topic. Convert the user's query into optimized review-oriented queries for each academic search engine.

## Output Format
Pure JSON — one optimized query string per engine:
{
  "pubmed": "PubMed query using MeSH terms, Boolean operators, and field tags, targeting review articles",
  "semantic_scholar": "Natural language query targeting survey/review papers (English, include 'survey'/'review'/'systematic review')",
  "arxiv": "Short keyword query targeting surveys/reviews (1-5 core terms, include 'survey' or 'review')",
  "openalex": "Natural language query targeting review/survey literature (English)",
  "crossref": "Keyword query targeting review/survey articles (space-separated terms)",
  "europe_pmc": "Boolean query targeting review articles (use MeSH terms and field tags)"
}

## Review-Orientation Rules
- The user wants comprehensive SURVEY / REVIEW / SYSTEMATIC REVIEW papers, NOT primary research
- Emphasize terms like "survey", "review", "systematic review", "meta-analysis", "literature review" where appropriate
- For PubMed/Europe PMC: keep MeSH field tags but orient toward review-type retrieval
- For Semantic Scholar/OpenAlex/Crossref: append review-oriented terms to the natural language query
- For arXiv: include "survey" as a keyword (arXiv has no type filter)

## PubMed / Europe PMC Rules
- Use field tags: [MeSH Terms], [Title/Abstract], [All Fields], [Date - Publication]
- Synonyms → OR, different concepts → AND
- Parenthesize groups

## Important
- Extract core concepts; KEEP review/survey terminology (do NOT strip these words)
- Output exactly ONE query per engine
- Output ONLY JSON, no markdown, no explanation`;

export class AcademicQueryAdapter {
  /**
   * Convert a general query into academic search engine-specific queries.
   * Tries LLM path first, falls back to rule-based path on failure.
   */
  async adapt(query: string): Promise<AdaptedQueries> {
    // LLM path
    const llmResult = await this.llmAdapt(query);
    if (llmResult) return llmResult;

    // Rule-based fallback
    return this.ruleBasedAdapt(query);
  }

  /**
   * Adapt a query specifically for REVIEW/SURVEY paper retrieval.
   *
   * Unlike adapt(), this does NOT strip review/survey/overview terms and
   * actively orients each engine's query toward review literature. Used by
   * SearchPipeline Phase A (review search) where API type filters
   * (openalex/crossref/europe-pmc/pubmed) complement the query-word bias.
   */
  async adaptForReview(query: string): Promise<AdaptedQueries> {
    // LLM path
    const llmResult = await this.llmAdaptForReview(query);
    if (llmResult) return llmResult;

    // Rule-based fallback
    return this.ruleBasedAdaptForReview(query);
  }

  // ── LLM Path ───────────────────────────────────

  private async llmAdapt(query: string): Promise<AdaptedQueries | null> {
    const provider = AIProviderRegistry.getProviderForFeature("chat");
    if (!provider) return null;

    try {
      const response = await provider.execute({
        messages: [
          { role: "system", content: ADAPT_PROMPT },
          {
            role: "user",
            content: `Convert this web search query to academic database queries:\n\n${query}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 1500,
      });

      const parsed = this.parseJSON(response.content);
      if (!parsed) return null;

      return {
        openalex: parsed.openalex || query,
        "semantic-scholar": parsed.semantic_scholar || query,
        pubmed: parsed.pubmed || query,
        arxiv: parsed.arxiv || query,
        crossref: parsed.crossref || query,
        "europe-pmc": parsed.europe_pmc || parsed["europe-pmc"] || query,
      };
    } catch (e) {
      safeDebug("[z-search] AcademicQueryAdapter.adapt failed: " + e);
      return null;
    }
  }

  // ── Review-Oriented LLM Path ───────────────────────────────

  private async llmAdaptForReview(
    query: string,
  ): Promise<AdaptedQueries | null> {
    const provider = AIProviderRegistry.getProviderForFeature("chat");
    if (!provider) return null;

    try {
      const response = await provider.execute({
        messages: [
          { role: "system", content: REVIEW_ADAPT_PROMPT },
          {
            role: "user",
            content: `Find REVIEW/SURVEY papers for this topic:\n\n${query}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 1500,
      });

      const parsed = this.parseJSON(response.content);
      if (!parsed) return null;

      return {
        openalex: parsed.openalex || query,
        "semantic-scholar": parsed.semantic_scholar || query,
        pubmed: parsed.pubmed || query,
        arxiv: parsed.arxiv || query,
        crossref: parsed.crossref || query,
        "europe-pmc": parsed.europe_pmc || parsed["europe-pmc"] || query,
      };
    } catch (e) {
      safeDebug(
        "[z-search] AcademicQueryAdapter.llmAdaptForReview failed: " + e,
      );
      return null;
    }
  }

  /**
   * Rule-based review-query builder.
   *
   * Uses a private keyword extractor that retains review/survey terms
   * (the static extractKeywords strips them via STOP_WORDS), then suffixes
   * natural-language queries with review-oriented terms. The API type
   * filters (openalex/crossref/europe-pmc/pubmed) do the real filtering;
   * this just biases the query text.
   */
  private ruleBasedAdaptForReview(query: string): AdaptedQueries {
    // Keywords WITHOUT stripping review/survey terms (review-biased extraction).
    const reviewKeepWords = new Set([
      "review",
      "survey",
      "overview",
      "tutorial",
      "guide",
    ]);
    const words = query.match(/[a-zA-Z][a-zA-Z0-9-]{2,}/g) || [];
    const keywords = words.filter((w) => {
      const lower = w.toLowerCase();
      // Strip general stop words but KEEP review-oriented terms.
      if (reviewKeepWords.has(lower)) return true;
      return !STOP_WORDS.has(lower);
    });
    const keywordBase = keywords.slice(0, 6).join(" ") || query;

    // Natural-language sources: append review-oriented terms.
    const reviewSuffix = `${keywordBase} review OR survey`;
    const arxivReview = `${keywords.slice(0, 4).join(" ")} survey`;

    // PubMed / Europe PMC: keep MeSH-boolean structure + review ptyp bias
    // (the API type filter adds Review[ptyp]; here we just reuse the base builder).
    const pubmed = this.buildPubMedQuery(keywords, query);
    const europePmc = this.buildEuropePmcQuery(keywords, query);

    return {
      openalex: reviewSuffix,
      "semantic-scholar": reviewSuffix,
      pubmed,
      arxiv: arxivReview,
      crossref: reviewSuffix,
      "europe-pmc": europePmc,
    };
  }

  // ── Rule-Based Fallback Path ───────────────────────────────

  /** Extract English keywords from query (including hyphenated terms like RNA-seq) */
  static extractKeywords(query: string): string[] {
    const words = query.match(/[a-zA-Z][a-zA-Z0-9-]{2,}/g) || [];
    return words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  }

  private ruleBasedAdapt(query: string): AdaptedQueries {
    const keywords = AcademicQueryAdapter.extractKeywords(query);
    const pubmed = this.buildPubMedQuery(keywords, query);
    const europePmc = this.buildEuropePmcQuery(keywords, query);
    const keywordQuery = keywords.slice(0, 8).join(" ") || query;
    const arxiv = this.buildArxivQuery(keywords, query);

    return {
      openalex: keywordQuery,
      "semantic-scholar": keywordQuery,
      pubmed,
      arxiv,
      crossref: keywordQuery,
      "europe-pmc": europePmc,
    };
  }

  /** PubMed: MeSH mapping + boolean query */
  private buildPubMedQuery(keywords: string[], fallback: string): string {
    if (keywords.length === 0) return fallback;

    const terms: string[] = [];
    for (const kw of keywords.slice(0, 6)) {
      const lower = kw.toLowerCase();
      const meshTerms = MESH_MAP[lower];
      if (meshTerms) {
        const meshPart = meshTerms
          .map((t) => `"${t}"[MeSH Terms]`)
          .join(" OR ");
        terms.push(`(${meshPart}) AND "${kw}"[Title/Abstract]`);
      } else {
        terms.push(`"${kw}"[All Fields]`);
      }
    }

    return terms.length > 0 ? terms.join(" AND ") : fallback;
  }

  /** Europe PMC: boolean query similar to PubMed */
  private buildEuropePmcQuery(keywords: string[], fallback: string): string {
    if (keywords.length === 0) return fallback;

    const terms: string[] = [];
    for (const kw of keywords.slice(0, 6)) {
      const lower = kw.toLowerCase();
      const meshTerms = MESH_MAP[lower];
      if (meshTerms) {
        const meshPart = meshTerms
          .map((t) => `"${t}"[MeSH Terms]`)
          .join(" OR ");
        terms.push(`(${meshPart}) AND "${kw}"[Title/Abstract]`);
      } else {
        terms.push(`"${kw}"[Title/Abstract]`);
      }
    }

    return terms.length > 0 ? terms.join(" AND ") : fallback;
  }

  /** arXiv: core keywords after removing stop words */
  private buildArxivQuery(keywords: string[], fallback: string): string {
    const core = keywords
      .filter((kw) => !ARXIV_NOISE.has(kw.toLowerCase()))
      .slice(0, 5);
    return core.length > 0 ? core.join(" ") : fallback;
  }

  // ── JSON Parsing ─────────────────────────────────

  private parseJSON(content: string): Record<string, string> | null {
    if (!content) return null;

    // Try to extract code block
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch (e) {
        safeDebug(
          "[z-search] AcademicQueryAdapter.parseJSON codeBlock failed: " + e,
        ); /* fall through */
      }
    }

    // Direct parse
    try {
      return JSON.parse(content.trim());
    } catch (e) {
      safeDebug(
        "[z-search] AcademicQueryAdapter.parseJSON direct failed: " + e,
      ); /* fall through */
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        safeDebug(
          "[z-search] AcademicQueryAdapter.parseJSON objectExtract failed: " +
            e,
        ); /* fall through */
      }
    }

    safeDebug(
      "[z-search] AcademicQueryAdapter.parseJSON: all JSON parse strategies failed",
    );
    return null;
  }
}
