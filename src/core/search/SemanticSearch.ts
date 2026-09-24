/**
 * SemanticSearch - AI-powered semantic search for Zotero items
 *
 * Provides similarity-based search using vector embeddings.
 * Finds items, notes, and detects duplicates based on semantic similarity.
 *
 * @module core/search/SemanticSearch
 */

import EmbeddingsManager from "../ai/EmbeddingsManager";
import { truncate } from "../../utils/truncate";
import EmbeddingStore from "./EmbeddingStore";
import PdfChunkStore from "./PdfChunkStore";
import type { IndexEntry } from "./VectorIndex";
import { cosineSimilarity } from "ai";
import { SAFE_BATCH_SIZE } from "../../utils/constants";

import { rewriteQuery } from "./QueryRewriter";
import { aggregateHybridChunks, type FusionLegChunk } from "./fulltext-fusion";
import ConfigManager from "../../utils/config/ConfigManager";
import { ZoteroFetch } from "../ai/ZoteroFetch";
import { getPrefDynamic } from "../../utils/prefs";
import { safeDebug } from "../../utils/logger";
import { itemDisplayName } from "../../utils/itemDisplayName";

export interface SemanticSearchResult {
  itemID: number;
  similarity: number;
  title?: string;
  type?: string;
  dateAdded?: string;
  /** Item DOI (normalized as stored by Zotero) — used by the Hub merged
   *  search to dedup external hits against library hits. */
  doi?: string;
}

export interface FullTextSearchResult {
  itemID: number;
  /** Cosine similarity (vector/hybrid) — absent for BM25-only hits (no cosine
   *  exists; see fusedScore). NOT the rerank score. */
  similarity?: number;
  title?: string;
  type?: string;
  dateAdded?: string;
  doi?: string;
  sectionCategory?: string;
  sectionName?: string;
  /** First ~200 chars of the highest-scoring chunk for quick preview */
  snippet?: string;
  parseMethod?: string;
  /** E1 片段定位：最高分 chunk 的起始页与 filteredText 坐标区间。
   *  null = 该 chunk 索引时页界不可得（旧索引行）。 */
  page?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  /** retrieval='hybrid': fused RRF score. retrieval='bm25': normalized
   *  display score in (0,1]. Never comparable to cosine. */
  fusedScore?: number;
  /** Contributing retrieval channels ("vector" / "bm25"). */
  sources?: string[];
  /** R4-21：rerank 已开启但本次排序未生效（缺凭证 / 端点 404 / 异常）。
   *  true = 结果仍是原序（向量或 RRF 序），而非 cross-encoder 重排序。 */
  rerankUnavailable?: boolean;
  /** F-26（回退审计 2026-09-11）：hybrid 承诺降级标记——向量腿不可用
   *  （当前嵌入模型无索引）时结果实为 BM25-only。UI 可据此提示
   *  "部分结果未经语义排序"；值省略 = 双腿齐全的正常混合结果。 */
  degraded?: "vector-leg-unavailable";
}

export interface SimilarNoteResult {
  noteID: number;
  similarity: number;
  preview?: string;
}

export interface DuplicateResult {
  itemID: number;
  duplicateIDs: number[];
  confidence: number;
  reason: string;
}

/** Default thresholds for different search operations */
const THRESHOLD_QUERY = 0.75; // Query-to-item: stricter to ensure relevance
const THRESHOLD_FULLTEXT = 0.7; // Fulltext chunk: slightly relaxed for broader recall
const THRESHOLD_SIMILAR = 0.8; // Similar items/find notes: high confidence
const THRESHOLD_DUPLICATE = 0.9; // Duplicate detection: very high to avoid false positives

/**
 * Read an item's DOI for search-result dedup. getField('DOI') is a standard
 * field on regular items; guard against non-regular items / missing field
 * (returns undefined instead of throwing).
 */
function getItemDOI(item?: Zotero.Item): string | undefined {
  if (!item?.isRegularItem?.()) return undefined;
  try {
    const doi = item.getField("DOI");
    return typeof doi === "string" && doi.trim() ? doi.trim() : undefined;
  } catch (e) {
    safeDebug("[z-search] SemanticSearch.getItemDOI failed: " + e);
    return undefined;
  }
}

/**
 * Semantic Search Service
 * Uses embeddings to find semantically similar items
 */
export class SemanticSearch {
  private embeddings = EmbeddingsManager;
  private zoteroFetch = new ZoteroFetch();

  /**
   * Search items by semantic similarity to a query
   *
   * @param query - Search query text
   * @param options - Search options
   * @returns Array of similar items with similarity scores
   */
  async searchByQuery(
    query: string,
    options: {
      collectionID?: number;
      threshold?: number;
      limit?: number;
    } = {},
  ): Promise<SemanticSearchResult[]> {
    const { collectionID, threshold = THRESHOLD_QUERY, limit = 10 } = options;

    try {
      // Rewrite vague queries for better retrieval
      const effectiveQuery = await rewriteQuery(query);

      let itemIDs: number[];
      if (collectionID) {
        const collection = await Zotero.Collections.getAsync(collectionID);
        const items = collection ? await collection.getChildItems() : [];
        itemIDs = items.map((item) => item.id);
      } else {
        itemIDs = (await Zotero.Items.getAll(
          Zotero.Libraries.userLibraryID,
          false,
          false,
          true,
        )) as number[];
      }

      const similarItems = await this.embeddings.findSimilarItems(
        effectiveQuery,
        itemIDs,
        threshold,
        limit,
      );

      // Enrich results with item metadata — batch load all items at once
      // (was: per-id await in loop — N+1 anti-pattern, slow for large result sets)
      const itemIds = similarItems.map((i) => i.itemID);
      const itemArray = await Zotero.Items.getAsync(itemIds);
      const itemMap = new Map<number, Zotero.Item>(
        itemArray.filter(Boolean).map((it: Zotero.Item) => [it.id, it]),
      );

      const results: SemanticSearchResult[] = [];
      for (const item of similarItems) {
        const zoteroItem = itemMap.get(item.itemID);
        results.push({
          itemID: item.itemID,
          similarity: item.similarity,
          title: itemDisplayName(zoteroItem) || undefined,
          type: zoteroItem
            ? Zotero.ItemTypes.getName(zoteroItem.itemTypeID)
            : undefined,
          dateAdded: zoteroItem ? String(zoteroItem.dateAdded) : undefined,
          doi: getItemDOI(zoteroItem),
        });
      }

      return results;
    } catch (error: any) {
      safeDebug(`[z-search] searchByQuery failed: ${error}`);
      throw error;
    }
  }

  /**
   * Search PDF full-text chunks across the library by semantic similarity.
   *
   * Unlike searchByQuery (which matches title+abstract only), this walks
   * the in-memory VectorIndex over zsearch_pdf_chunks and aggregates hits
   * per item (max-score chunk wins), so a paper is returned once even if
   * many of its chunks match.
   *
   * @param query - Natural-language query, e.g. "uses contrastive loss"
   * @param options.threshold - Minimum cosine similarity (default 0.7)
   * @param options.limit - Max items to return (default 10)
   * @param options.sectionCategory - Optional filter: only search chunks
   *        tagged with this category ('method'/'intro'/'results'/...).
   *        Omit or 'any' for no filter.
   */
  async searchFullText(
    query: string,
    options: {
      threshold?: number;
      limit?: number;
      sectionCategory?: string;
      /** 'vector' (default, unchanged behaviour) | 'bm25' (FTS5 keyword
       *  index, model-independent) | 'hybrid' (chunk-level weighted RRF
       *  fusion of both legs). */
      retrieval?: "vector" | "bm25" | "hybrid";
      /** hybrid: RRF weight of the BM25 channel (default 1.0). */
      bm25Weight?: number;
    } = {},
  ): Promise<FullTextSearchResult[]> {
    const {
      threshold = THRESHOLD_FULLTEXT,
      limit = 10,
      sectionCategory,
      retrieval = "vector",
      bm25Weight,
    } = options;

    if (retrieval === "bm25") {
      return this.searchFullTextBM25(query, { limit, sectionCategory });
    }

    const model = this.embeddings.getModelInfo().name;

    // Pre-check: if no chunks have been indexed for the current model, throw
    // a typed error so callers can distinguish "library not indexed yet"
    // from "indexed but no matches". Returning [] for both (the old
    // behaviour) caused agents to misreport "no relevant papers" when the
    // real problem was a missing index.
    // hybrid degrades instead: the BM25 leg is text-only and works without
    // an up-to-date vector index.
    const chunkCount = await PdfChunkStore.countChunks(model);
    if (chunkCount === 0) {
      if (retrieval === "hybrid") {
        // F-26（回退审计 2026-09-11，P1）：向量腿缺失时 hybrid 静默变
        // BM25-only——"混合搜索"承诺未兑现且无任何痕迹。降级结果统一打
        // degraded 标记，调用方/UI 可提示"结果未经语义排序"。
        safeDebug(
          "[z-search] SemanticSearch: hybrid degraded to BM25-only (no vector chunks for current model)",
        );
        const bm25Only = await this.searchFullTextBM25(query, {
          limit,
          sectionCategory,
        });
        return bm25Only.map((r) => ({
          ...r,
          degraded: "vector-leg-unavailable" as const,
        }));
      }
      const err = new Error(
        "PDF_CHUNKS_NOT_INDEXED: no full-text chunks found for the current embedding model. " +
          'Run "Build Full-Text Index" in the semantic search panel first.',
      );
      (err as any).code = "PDF_CHUNKS_NOT_INDEXED";
      throw err;
    }

    try {
      const queryEmbedding = await this.embeddings.embedQuery(query);
      const queryVec = new Float32Array(queryEmbedding);

      const index = PdfChunkStore.getIndex();

      const filter =
        sectionCategory && sectionCategory !== "any"
          ? (entry: IndexEntry) => entry.sectionCategory === sectionCategory
          : undefined;

      // Over-fetch because per-item aggregation collapses multiple chunk
      // hits — a survey paper with many matching chunks would otherwise
      // crowd out other items. limit*5 gives headroom for that case.
      const raw = index.search(queryVec, Math.max(limit * 5, 50), filter);

      if (retrieval === "hybrid") {
        return await this.searchFullTextHybrid(query, {
          threshold,
          limit,
          sectionCategory,
          bm25Weight,
          vectorLeg: raw.map((r) => ({
            id: r.id,
            itemId: r.meta.itemId,
            sectionCategory: r.meta.sectionCategory,
            score: r.score,
          })),
        });
      }

      // Aggregate by itemId, keep the highest-scoring chunk per item
      const byItem = new Map<
        number,
        { score: number; chunkId: number; sectionCategory?: string }
      >();
      for (const r of raw) {
        const cur = byItem.get(r.meta.itemId);
        if (!cur || r.score > cur.score) {
          byItem.set(r.meta.itemId, {
            score: r.score,
            chunkId: r.id,
            sectionCategory: r.meta.sectionCategory,
          });
        }
      }

      const ranked = Array.from(byItem.entries())
        .filter(([, v]) => v.score >= threshold)
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, limit);

      if (ranked.length === 0) return [];

      const chunkIds = ranked.map(([, v]) => v.chunkId);
      const chunks = await PdfChunkStore.getChunksByIds(chunkIds);

      // Optional cross-encoder rerank: reorder chunks by semantic relevance
      // to the query before final result construction.
      let effectiveRanked: Array<
        [number, { score: number; chunkId: number; sectionCategory?: string }]
      > = ranked;
      let rerankUnavailable = false;
      const rerankEnabled = getPrefDynamic("search.rerankEnabled");
      if (rerankEnabled && chunks.length > 0) {
        const chunkById = new Map(chunks.map((c) => [c.id, c]));
        // Pair entry+text BEFORE filtering so rerank's originalIndex stays
        // aligned even when some chunk texts are empty (same pattern as the
        // hybrid path — filtering documents upfront shifted indices).
        const candidates = ranked
          .map(([itemId, v]) => ({
            itemId,
            v,
            text: chunkById.get(v.chunkId)?.chunkText,
          }))
          .filter(
            (
              c,
            ): c is {
              itemId: number;
              v: { score: number; chunkId: number; sectionCategory?: string };
              text: string;
            } => typeof c.text === "string" && c.text.trim().length > 0,
          );
        const rerank = await this.doRerank(
          query,
          candidates.map((c) => c.text),
          limit,
        );
        rerankUnavailable = rerank.failed;
        const ranking = rerank.ranking;
        if (ranking.length > 0) {
          effectiveRanked = ranking
            .map((r) => {
              const cand = candidates[r.originalIndex];
              if (!cand) return null;
              return [cand.itemId, { ...cand.v, score: r.score }] as any;
            })
            .filter((e): e is any => e !== null)
            .sort((a: any, b: any) => b[1].score - a[1].score)
            .slice(0, limit);
        }
      }

      if (effectiveRanked.length === 0) return [];

      return this.enrichChunkResults(
        effectiveRanked.map(([itemId, v]) => ({
          itemId,
          chunkId: v.chunkId,
          sectionCategory: v.sectionCategory,
          similarity: v.score,
        })),
        chunks,
        rerankUnavailable,
      );
    } catch (error: any) {
      // Re-throw the typed NOT_INDEXED error so the agent sees it.
      // F-27（回退审计 2026-09-11，P1）：真实运行时故障（嵌入失败/索引损坏）
      // 此前同样吞成 []——与"无匹配"不可区分，用户收到假阴性。升级为第二
      // 个 typed code 抛出：三条调用链（工具 handler / Hub 桥 ×2）均有
      // try/catch 信封，会把失败如实传给 agent 与 UI，而非伪装成空结果。
      if (
        error?.code === "PDF_CHUNKS_NOT_INDEXED" ||
        error?.code === "SEARCH_RUNTIME_FAILED"
      ) {
        throw error;
      }
      safeDebug(`[z-search] SemanticSearch.searchFullText failed: ${error}`);
      const wrapped = new Error(
        `Full-text search failed at runtime (not an empty result): ${error?.message ?? error}`,
      );
      (wrapped as any).code = "SEARCH_RUNTIME_FAILED";
      throw wrapped;
    }
  }

  /**
   * retrieval='bm25' path — pure keyword retrieval over the FTS5 chunk
   * index. No cosine exists, so no threshold gate; items rank by BM25
   * alone (squashed to a (0,1] display score). Throws
   * PDF_CHUNKS_NOT_INDEXED when the library has no chunks at all — the
   * text index is embedding-model-independent, so unlike the vector path
   * this gate counts chunks across ALL models.
   */
  private async searchFullTextBM25(
    query: string,
    opts: { limit: number; sectionCategory?: string },
  ): Promise<FullTextSearchResult[]> {
    const total = await PdfChunkStore.countAllChunks();
    if (total === 0) {
      const err = new Error(
        "PDF_CHUNKS_NOT_INDEXED: no full-text chunks found. " +
          'Run "Build Full-Text Index" in the semantic search panel first.',
      );
      (err as any).code = "PDF_CHUNKS_NOT_INDEXED";
      throw err;
    }

    const hits = await PdfChunkStore.searchByKeyword(
      query,
      Math.max(opts.limit * 5, 50),
      opts.sectionCategory,
    );
    if (hits.length === 0) return [];

    // Per-item aggregation: best-scoring chunk wins (same rule as the
    // vector path).
    const byItem = new Map<number, (typeof hits)[number]>();
    for (const h of hits) {
      const cur = byItem.get(h.itemId);
      if (!cur || h.score > cur.score) byItem.set(h.itemId, h);
    }
    const ranked = Array.from(byItem.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit);
    if (ranked.length === 0) return [];

    return this.enrichChunkResults(
      ranked.map((h) => ({
        itemId: h.itemId,
        chunkId: h.chunkId,
        sectionCategory: h.sectionCategory,
        fusedScore: Math.max(0, Math.min(1, 1 / (1 + Math.max(0, h.score)))),
        sources: ["bm25"],
      })),
    );
  }

  /**
   * retrieval='hybrid' path — chunk-level weighted RRF fusion of the vector
   * and BM25 legs (see fulltext-fusion). The cosine threshold applies only
   * to items that have a vector score; an optional rerank reorders the
   * fused list but does NOT overwrite its display scores (the fused/cosine
   * values are the consumer-facing contract, unlike the vector path where
   * the cross-encoder score replaces cosine).
   */
  private async searchFullTextHybrid(
    query: string,
    args: {
      threshold: number;
      limit: number;
      sectionCategory?: string;
      bm25Weight?: number;
      vectorLeg: FusionLegChunk[];
    },
  ): Promise<FullTextSearchResult[]> {
    const bm25Hits = await PdfChunkStore.searchByKeyword(
      query,
      Math.max(args.limit * 5, 50),
      args.sectionCategory,
    );
    const bm25Leg: FusionLegChunk[] = bm25Hits.map((h) => ({
      id: h.chunkId,
      itemId: h.itemId,
      sectionCategory: h.sectionCategory,
      score: h.score,
    }));

    const fused = aggregateHybridChunks(args.vectorLeg, bm25Leg, {
      threshold: args.threshold,
      limit: args.limit,
      bm25Weight: args.bm25Weight,
    });
    if (fused.length === 0) return [];

    let ordered = fused;
    let rerankUnavailable = false;
    const rerankEnabled = getPrefDynamic("search.rerankEnabled");
    if (rerankEnabled) {
      const chunks = await PdfChunkStore.getChunksByIds(
        fused.map((f) => f.chunkId),
      );
      const chunkById = new Map(chunks.map((c) => [c.id, c]));
      // Pair entry+text BEFORE filtering so rerank's originalIndex stays
      // aligned even when some chunk texts are empty.
      const candidates = fused
        .map((f) => ({ entry: f, text: chunkById.get(f.chunkId)?.chunkText }))
        .filter(
          (c): c is { entry: (typeof fused)[number]; text: string } =>
            typeof c.text === "string" && c.text.trim().length > 0,
        );
      const rerank = await this.doRerank(
        query,
        candidates.map((c) => c.text),
        args.limit,
      );
      rerankUnavailable = rerank.failed;
      const ranking = rerank.ranking;
      if (ranking.length > 0) {
        ordered = ranking
          .map((r) => candidates[r.originalIndex]?.entry)
          .filter((e): e is (typeof fused)[number] => e !== undefined)
          .slice(0, args.limit);
      }
    }

    return this.enrichChunkResults(
      ordered.map((f) => ({
        itemId: f.itemId,
        chunkId: f.chunkId,
        sectionCategory: f.sectionCategory,
        similarity: f.vectorScore,
        fusedScore: f.score,
        sources: f.sources,
      })),
      undefined,
      rerankUnavailable,
    );
  }

  /**
   * Shared result construction for all retrieval modes: batch-loads chunk
   * rows + Zotero items (N+1-safe) and maps ranked entries to the public
   * result shape.
   */
  private async enrichChunkResults(
    ranked: Array<{
      itemId: number;
      chunkId: number;
      sectionCategory?: string;
      similarity?: number;
      fusedScore?: number;
      sources?: string[];
    }>,
    preloadedChunks?: Array<{
      id: number;
      sectionName?: string;
      chunkText: string;
      parseMethod?: string;
      page?: number | null;
      charStart?: number | null;
      charEnd?: number | null;
    }>,
    /** R4-21：本次检索开启了 rerank 但排序未生效——结果仍是原序，标记透传。 */
    rerankUnavailable = false,
  ): Promise<FullTextSearchResult[]> {
    const chunks =
      preloadedChunks ??
      (await PdfChunkStore.getChunksByIds(ranked.map((r) => r.chunkId)));
    const chunkMap = new Map(chunks.map((c) => [c.id, c]));

    // Batch-load all Zotero items at once (was: per-id await in loop — N+1).
    const itemIds = ranked.map((r) => r.itemId);
    const itemArray = await Zotero.Items.getAsync(itemIds);
    const itemMap = new Map<number, Zotero.Item>(
      itemArray.filter(Boolean).map((it: Zotero.Item) => [it.id, it]),
    );

    const results: FullTextSearchResult[] = [];
    for (const entry of ranked) {
      const zoteroItem = itemMap.get(entry.itemId);
      const chunk = chunkMap.get(entry.chunkId);
      results.push({
        itemID: entry.itemId,
        similarity: entry.similarity,
        title: itemDisplayName(zoteroItem) || undefined,
        type: zoteroItem
          ? Zotero.ItemTypes.getName(zoteroItem.itemTypeID)
          : undefined,
        dateAdded: zoteroItem ? String(zoteroItem.dateAdded) : undefined,
        doi: getItemDOI(zoteroItem),
        sectionCategory: entry.sectionCategory,
        sectionName: chunk?.sectionName,
        snippet: chunk?.chunkText.slice(0, 200),
        parseMethod: chunk?.parseMethod,
        page: chunk?.page ?? null,
        charStart: chunk?.charStart ?? null,
        charEnd: chunk?.charEnd ?? null,
        fusedScore: entry.fusedScore,
        sources: entry.sources,
        ...(rerankUnavailable ? { rerankUnavailable: true } : {}),
      });
    }
    return results;
  }

  /**
   * Optional cross-encoder rerank for full-text search candidates.
   *
   * Calls the OpenAI-compatible `/v1/rerank` endpoint using the same provider
   * credentials as the configured embedding model. Returns an empty array
   * when rerank is disabled, misconfigured, or the endpoint is unavailable
   * so callers can fall back silently.
   */
  private async doRerank(
    query: string,
    documents: string[],
    topK: number,
  ): Promise<{
    ranking: Array<{ originalIndex: number; score: number }>;
    /** R4-21：rerankEnabled 为真却未产出排序（缺凭证/非 200/异常/空结果）。 */
    failed: boolean;
  }> {
    const rerankEnabled = getPrefDynamic("search.rerankEnabled");
    // 未开启 = 用户没要重排，不算降级（failed:false）
    if (!rerankEnabled || documents.length === 0) {
      return { ranking: [], failed: false };
    }

    const rerankModelId =
      (getPrefDynamic("search.rerankModel") as string) || "cohere/rerank-v3.5";

    let apiKey = "";
    let baseUrl = "";
    try {
      const embeddingModelId = ConfigManager.getModelForFeature("embedding");
      if (embeddingModelId) {
        const config = ConfigManager.getModelFullConfig(embeddingModelId);
        if (config) {
          apiKey = config.provider.apiKey || "";
          baseUrl = config.provider.baseUrl || "";
        }
      }
    } catch (e) {
      safeDebug(
        "[z-search] SemanticSearch.doRerank: config lookup failed: " + e,
      );
    }

    if (!apiKey || !baseUrl) {
      // R4-21：rerank 端点复用 embedding provider 凭证，而主流 embedding 提供方
      // 并不提供 /v1/rerank——现实配置下「开了 rerank」常常恒失败。失败仍安全
      // 降级（保持原序），但必须让调用方看见 failed，否则用户以为结果已重排。
      safeDebug(
        "[z-search] SemanticSearch.doRerank: embedding provider has no credentials for the rerank endpoint",
      );
      return { ranking: [], failed: true };
    }

    try {
      const response = await this.zoteroFetch.fetch(
        `${baseUrl.replace(/\/+$/, "")}/v1/rerank`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: rerankModelId,
            query,
            documents,
            top_k: topK,
          }),
        },
      );

      if (!response.ok) {
        safeDebug(
          `[z-search] SemanticSearch.doRerank: HTTP ${response.status} (${rerankModelId})`,
        );
        return { ranking: [], failed: true };
      }

      const json = (await response.json()) as {
        results?: Array<{ index: number; score: number }>;
      };
      if (!json.results || json.results.length === 0) {
        return { ranking: [], failed: true };
      }

      return {
        ranking: json.results.map((r) => ({
          originalIndex: r.index,
          score: r.score,
        })),
        failed: false,
      };
    } catch (e: any) {
      safeDebug(`[z-search] SemanticSearch.doRerank failed: ${e}`);
      return { ranking: [], failed: true };
    }
  }

  /**
   * Find items similar to a specific item
   *
   * @param itemID - The reference item ID
   * @param options - Search options
   * @returns Array of similar items
   */
  async findSimilarItems(
    itemID: number,
    options: {
      threshold?: number;
      limit?: number;
      excludeSelf?: boolean;
    } = {},
  ): Promise<SemanticSearchResult[]> {
    const {
      threshold = THRESHOLD_SIMILAR,
      limit = 5,
      excludeSelf = true,
    } = options;

    try {
      const refItem = await Zotero.Items.getAsync(itemID);
      if (!refItem) {
        return [];
      }

      const searchText = this.createItemSearchText(refItem);

      let candidateIDs = (await Zotero.Items.getAll(
        Zotero.Libraries.userLibraryID,
        false,
        false,
        true,
      )) as number[];

      if (excludeSelf) {
        candidateIDs = candidateIDs.filter((id) => id !== itemID);
      }

      const similarItems = await this.embeddings.findSimilarItems(
        searchText,
        candidateIDs,
        threshold,
        limit,
      );

      // Batch-load all matched items at once (was: per-id await in loop — N+1)
      const matchedIds = similarItems.map((i) => i.itemID);
      const matchedItems = await Zotero.Items.getAsync(matchedIds);
      const matchedMap = new Map<number, Zotero.Item>(
        matchedItems.filter(Boolean).map((it: Zotero.Item) => [it.id, it]),
      );

      const results: SemanticSearchResult[] = [];
      for (const item of similarItems) {
        const zoteroItem = matchedMap.get(item.itemID);
        results.push({
          itemID: item.itemID,
          similarity: item.similarity,
          title: itemDisplayName(zoteroItem) || undefined,
          type: zoteroItem
            ? Zotero.ItemTypes.getName(zoteroItem.itemTypeID)
            : undefined,
          dateAdded: zoteroItem ? String(zoteroItem.dateAdded) : undefined,
          doi: getItemDOI(zoteroItem),
        });
      }

      return results;
    } catch (error: any) {
      safeDebug(`[z-search] findSimilarItems failed: ${error}`);
      throw error;
    }
  }

  /**
   * Find similar notes based on content
   *
   * @param noteID - The reference note ID
   * @param options - Search options
   * @returns Array of similar notes
   */
  async findSimilarNotes(
    noteID: number,
    options: {
      threshold?: number;
      limit?: number;
    } = {},
  ): Promise<SimilarNoteResult[]> {
    const { threshold = THRESHOLD_SIMILAR, limit = 10 } = options;

    try {
      const refNote = await Zotero.Items.getAsync(noteID);
      if (!refNote || !refNote.isNote()) {
        return [];
      }

      const noteContent = refNote.getNote();
      const plainText = this.stripHTML(noteContent);

      // Generate embedding for reference note
      const queryEmbedding = await this.embeddings.embedQuery(plainText);

      // Query only note item IDs directly from DB to avoid loading all items
      const noteIDs = (await Zotero.DB.columnQueryAsync(
        `SELECT itemID FROM items WHERE itemTypeID = ? AND libraryID = ? AND itemID != ?`,
        [
          Zotero.ItemTypes.getID("note"),
          Zotero.Libraries.userLibraryID,
          noteID,
        ],
      )) as number[];

      // Batch load notes in chunks (avoid SQLite parameter limit)
      const NOTE_BATCH = SAFE_BATCH_SIZE;
      const model = this.embeddings.getModelInfo().name;
      const results: SimilarNoteResult[] = [];
      for (let i = 0; i < noteIDs.length; i += NOTE_BATCH) {
        const batchIDs = noteIDs.slice(i, i + NOTE_BATCH);
        const noteItems = await Zotero.Items.getAsync(batchIDs);

        for (const note of noteItems) {
          const noteContent = note.getNote();
          const notePlainText = this.stripHTML(noteContent);

          // Prefer a persisted note embedding (O(1) read); fall back to live
          // ONNX inference only on cache miss, then persist for next time.
          // Previously every call re-embedded the entire notes corpus.
          let noteEmbedding = await EmbeddingStore.getNoteEmbedding(
            note.id,
            model,
          );
          if (!noteEmbedding) {
            noteEmbedding = new Float32Array(
              await this.embeddings.embedText(notePlainText),
            );
            await EmbeddingStore.storeNoteEmbedding(
              note.id,
              noteEmbedding,
              model,
              notePlainText,
            );
          }

          const similarity = cosineSimilarity(
            Array.from(queryEmbedding),
            Array.from(noteEmbedding),
          );

          if (similarity >= threshold) {
            results.push({
              noteID: note.id,
              similarity,
              preview: truncate(notePlainText, 100),
            });
          }
        }
      }

      results.sort((a, b) => b.similarity - a.similarity);
      if (results.length > limit) {
        results.length = limit;
      }
      return results;
    } catch (error: any) {
      safeDebug(`[z-search] findSimilarNotes failed: ${error}`);
      throw error;
    }
  }

  /**
   * Scan entire library for duplicates using batched loading.
   *
   * Loads embeddings in configurable batch sizes to avoid memory exhaustion
   * on large libraries. Uses a sliding-window comparison: for each outer batch,
   * compares against subsequent batches.
   *
   * Default batch size: 200 embeddings (~300KB per batch for 1536-dim vectors).
   *
   * @param threshold - Similarity threshold
   * @param onProgress - Callback for progress updates
   * @param batchSize - Number of embeddings per batch (default 200)
   * @returns Array of duplicate detection results
   */
  async scanLibraryForDuplicates(
    threshold = THRESHOLD_DUPLICATE,
    onProgress?: (current: number, total: number) => void,
    batchSize = 200,
    maxResults = 200,
  ): Promise<DuplicateResult[]> {
    const results: DuplicateResult[] = [];

    try {
      // No need to load all items upfront — item names are fetched on-demand
      // only for items that actually have duplicates.

      // Resolve the current configured model name (consistent with searchFullText).
      // Previously this was hard-coded to "text-embedding-3-small", which silently
      // returned 0 embeddings when the user had switched models, making the scan
      // report "no duplicates" even when duplicates existed.
      const model = this.embeddings.getModelInfo().name;

      const totalCount = await EmbeddingStore.getEmbeddingCount(model);
      if (totalCount === 0) return results;

      const processedIDs = new Set<number>();
      let progressCounter = 0;

      // Pre-load all batches once to avoid redundant DB reads.
      // Each batch's embedding array is ~300KB (200 * 1536 * 4 bytes),
      // so total memory is bounded by totalCount.
      const allBatches: Array<
        Array<{ itemId: number; embedding: Float32Array; searchText?: string }>
      > = [];
      for (let offset = 0; offset < totalCount; offset += batchSize) {
        const batch = await EmbeddingStore.getAllEmbeddings(model, {
          limit: batchSize,
          offset,
        });
        if (batch.length === 0) break;
        allBatches.push(batch);
      }

      // Outer loop: iterate over batches
      for (let outerIdx = 0; outerIdx < allBatches.length; outerIdx++) {
        const outerBatch = allBatches[outerIdx];

        for (let i = 0; i < outerBatch.length; i++) {
          const entry = outerBatch[i];
          if (processedIDs.has(entry.itemId)) continue;

          const duplicateIDs: number[] = [];
          let maxSimilarity = 0;

          // Compare within same batch (entries after i)
          for (let j = i + 1; j < outerBatch.length; j++) {
            const other = outerBatch[j];
            if (processedIDs.has(other.itemId)) continue;
            const sim = cosineSimilarity(
              Array.from(entry.embedding),
              Array.from(other.embedding),
            );
            if (sim >= threshold) {
              duplicateIDs.push(other.itemId);
              if (sim > maxSimilarity) maxSimilarity = sim;
            }
          }

          // Compare against subsequent batches (already in memory)
          for (
            let innerIdx = outerIdx + 1;
            innerIdx < allBatches.length;
            innerIdx++
          ) {
            const innerBatch = allBatches[innerIdx];
            for (const other of innerBatch) {
              if (processedIDs.has(other.itemId)) continue;
              const sim = cosineSimilarity(
                Array.from(entry.embedding),
                Array.from(other.embedding),
              );
              if (sim >= threshold) {
                duplicateIDs.push(other.itemId);
                if (sim > maxSimilarity) maxSimilarity = sim;
              }
            }
          }

          if (duplicateIDs.length > 0) {
            // Lazy-load the item only when we actually have duplicates
            let displayName = `Item ${entry.itemId}`;
            try {
              const refItem = await Zotero.Items.getAsync(entry.itemId);
              if (refItem) displayName = itemDisplayName(refItem);
            } catch (e) {
              safeDebug(
                "[z-search] SemanticSearch: getDisplayName failed (itemId=" +
                  entry.itemId +
                  "): " +
                  e,
              ); /* keep fallback name */
            }

            results.push({
              itemID: entry.itemId,
              duplicateIDs,
              confidence: maxSimilarity,
              reason: displayName,
            });
            processedIDs.add(entry.itemId);
            duplicateIDs.forEach((id) => processedIDs.add(id));

            // Early termination when enough duplicate groups found
            if (results.length >= maxResults) {
              if (onProgress) onProgress(totalCount, totalCount);
              return results;
            }
          }

          progressCounter++;
          if (onProgress && progressCounter % 10 === 0) {
            onProgress(progressCounter, totalCount);
          }
        }
      }

      if (onProgress) onProgress(totalCount, totalCount);
      return results;
    } catch (error: any) {
      safeDebug(`[z-search] scanLibraryForDuplicates failed: ${error}`);
      // Return partial results already collected rather than losing everything
      // But also re-throw so the UI can display a warning
      throw error;
    }
  }

  createItemSearchText(item: Zotero.Item): string {
    const parts: string[] = [];

    // Title (most important)
    const title = itemDisplayName(item);
    if (title) parts.push(title);

    const abstract = item.getField("abstractNote");
    if (abstract) parts.push(abstract);

    const creators = item.getCreators();
    if (creators.length > 0) {
      const names = creators
        .map((c) => `${c.firstName || ""} ${c.lastName || ""}`)
        .join(", ");
      parts.push(names);
    }

    const pubTitle = item.getField("publicationTitle");
    if (pubTitle) parts.push(pubTitle);

    const tags = item.getTags();
    if (tags.length > 0) {
      const tagNames = tags.map((t) => t.tag).join(", ");
      parts.push(tagNames);
    }

    return parts.join(" ");
  }

  private stripHTML(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}

export default new SemanticSearch();
