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

/**
 * Item-level merge of the Zotero host full-text leg (see ZoteroFtLeg) into
 * the fused hybrid ranking.
 *
 * The host leg is a boolean hit SET — no scores, no ranking, item-level only —
 * so it cannot join the chunk-level RRF above. Instead the already-ranked
 * hybrid entries and the host hit set each become one RRF channel (the host
 * set's ranks follow its returned order, which carries no relevance signal;
 * the sub-1 default weight keeps it a recall boost that reorders little on
 * its own). Items hit by both legs get both contributions summed and surface
 * "zotero-ft" in sources; host-only items enter with no chunk metadata —
 * downstream consumers must tolerate a missing chunkId (no snippet/page).
 *
 * An empty host set is a no-op: the hybrid ranking passes through unchanged
 * (same order, same scores, same sources) so an absent/degraded leg on older
 * hosts cannot perturb existing behaviour.
 */
export interface MergedItemEntry {
  itemId: number;
  /** Absent for host-leg-only hits (no plugin chunk row exists to point at). */
  chunkId?: number;
  /** Fused RRF score (ordering + display; same scale caveats as above). */
  score: number;
  sectionCategory?: string;
  vectorScore?: number;
  sources: string[];
}

export function mergeZoteroFtLeg(
  hybridEntries: HybridRankedEntry[],
  zoteroItemIds: number[],
  opts: { zoteroWeight?: number; limit: number },
): MergedItemEntry[] {
  if (zoteroItemIds.length === 0) {
    return hybridEntries.slice(0, opts.limit).map((e) => ({ ...e }));
  }

  const channels: FusionChannel<number>[] = [
    {
      label: "hybrid",
      results: hybridEntries.map((e, i) => ({ id: e.itemId, rank: i + 1 })),
      weight: 1.0,
    },
    {
      label: "zotero-ft",
      results: zoteroItemIds.map((id, i) => ({ id, rank: i + 1 })),
      weight: opts.zoteroWeight ?? 0.5,
    },
  ];
  const fused = weightedRRF(channels, 60);

  const hybridByItem = new Map(hybridEntries.map((e) => [e.itemId, e]));
  const zoteroSet = new Set(zoteroItemIds);

  const merged: MergedItemEntry[] = [];
  for (const [itemId, entry] of fused.entries()) {
    const hybrid = hybridByItem.get(itemId);
    merged.push({
      itemId,
      chunkId: hybrid?.chunkId,
      score: entry.score,
      sectionCategory: hybrid?.sectionCategory,
      vectorScore: hybrid?.vectorScore,
      sources:
        hybrid && zoteroSet.has(itemId)
          ? [...hybrid.sources, "zotero-ft"]
          : (hybrid?.sources ?? ["zotero-ft"]),
    });
    if (merged.length >= opts.limit) break;
  }
  return merged;
}
