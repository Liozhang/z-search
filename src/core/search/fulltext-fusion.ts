/**
 * Hybrid full-text fusion — pure, testable aggregation for
 * SemanticSearch.searchFullText retrieval='hybrid'.
 *
 * Fuses the vector (cosine) and BM25 legs at CHUNK level with weighted RRF
 * (rrf-fusion), then aggregates per item (best fused chunk wins) and applies
 * the cosine threshold ONLY to items that have a vector score: an item found
 * exclusively by BM25 must not be dropped by a threshold it has no cosine to
 * satisfy — recovering exact keyword matches the vector channel missed is
 * the whole point of the fusion.
 *
 * @module core/search/fulltext-fusion
 */

import { weightedRRF, type FusionChannel } from "./rrf-fusion";

export interface FusionLegChunk {
  /** Chunk row id (zsearch_pdf_chunks.id). */
  id: number;
  itemId: number;
  sectionCategory?: string;
  /** Channel-native score: cosine in [-1,1] for vector, display BM25 for bm25. */
  score: number;
}

export interface HybridRankedEntry {
  itemId: number;
  chunkId: number;
  /** Fused RRF score (ordering + display; NOT comparable to cosine). */
  score: number;
  sectionCategory?: string;
  /** Best cosine across the item's chunks — absent when the vector leg
   *  produced nothing for this item (degraded or BM25-only hit). */
  vectorScore?: number;
  /** Contributing channels ("vector" / "bm25"). */
  sources: string[];
}

export function aggregateHybridChunks(
  vectorLeg: FusionLegChunk[],
  bm25Leg: FusionLegChunk[],
  opts: {
    threshold: number;
    limit: number;
    vectorWeight?: number;
    bm25Weight?: number;
  },
): HybridRankedEntry[] {
  const channels: FusionChannel<number>[] = [];
  if (vectorLeg.length > 0) {
    channels.push({
      label: "vector",
      results: vectorLeg.map((c, i) => ({ id: c.id, rank: i + 1 })),
      weight: opts.vectorWeight ?? 1.0,
    });
  }
  if (bm25Leg.length > 0) {
    channels.push({
      label: "bm25",
      results: bm25Leg.map((c, i) => ({ id: c.id, rank: i + 1 })),
      weight: opts.bm25Weight ?? 1.0,
    });
  }
  if (channels.length === 0) return [];

  const fused = weightedRRF(channels, 60);

  // Per-chunk channel scores for the threshold rule and result metadata.
  const vectorScores = new Map(vectorLeg.map((c) => [c.id, c.score]));
  const metaById = new Map<number, FusionLegChunk>();
  for (const leg of [vectorLeg, bm25Leg]) {
    for (const c of leg) {
      if (!metaById.has(c.id)) metaById.set(c.id, c);
    }
  }

  const sorted = Array.from(fused.entries()).sort(
    (a, b) => b[1].score - a[1].score || a[0] - b[0],
  );

  const byItem = new Map<number, HybridRankedEntry>();
  for (const [chunkId, entry] of sorted) {
    const meta = metaById.get(chunkId)!;
    if (byItem.has(meta.itemId)) continue; // first (best-fused) chunk wins

    const vectorScore = vectorScores.get(chunkId);
    // Threshold gate: only items with a vector score can fail it.
    if (vectorScore !== undefined && vectorScore < opts.threshold) continue;

    byItem.set(meta.itemId, {
      itemId: meta.itemId,
      chunkId,
      score: entry.score,
      sectionCategory: meta.sectionCategory,
      vectorScore,
      sources: entry.sources,
    });
    if (byItem.size >= opts.limit) break;
  }

  return Array.from(byItem.values());
}
