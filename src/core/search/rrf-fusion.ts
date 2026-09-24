/**
 * Reciprocal Rank Fusion (RRF) — pure, testable scoring utility.
 *
 * Given N ranked result channels (keyword, semantic, …), computes a fused
 * score per document using the standard RRF formula:
 *
 *     RRF(d) = Σᵢ [ wᵢ / (rankᵢ(d) + k) ]
 *
 * where rank is 1-based, k is a constant (default 60), and wᵢ is the
 * per-channel weight.  RRF is score-agnostic: it consumes only ranks, so
 * channels with incomparable score distributions (BM25, cosine, …) can be
 * fused without normalisation.
 *
 * Reference: Cormack, Clarke & Buettcher (SIGIR 2009).
 *
 * @module core/search/rrf-fusion
 */

export interface RankedHit<T = number> {
  /** Document/chunk identifier (e.g. Zotero itemID). */
  id: T;
  /** 1-based rank within this channel. */
  rank: number;
}

export interface FusionChannel<T = number> {
  /** Ordered result list from one retrieval method. */
  results: RankedHit<T>[];
  /** Weight multiplier for this channel (default 1.0). */
  weight?: number;
  /** Optional channel name for debugging / source tracking. */
  label?: string;
}

export interface FusedEntry<T = number> {
  id: T;
  /** Fused RRF score (higher = better). */
  score: number;
  /** Which channels contributed (for UI/debug). */
  sources: string[];
}

const DEFAULT_K = 60;

/**
 * Weighted Reciprocal Rank Fusion.
 *
 * @param channels  retrieval channels to fuse
 * @param k         RRF constant (default 60)
 * @returns         map of id → fused entry, sorted by score descending
 */
export function weightedRRF<T = number>(
  channels: FusionChannel<T>[],
  k = DEFAULT_K,
): Map<T, FusedEntry<T>> {
  const acc = new Map<T, { score: number; sources: Set<string> }>();

  for (const channel of channels) {
    const weight = channel.weight ?? 1.0;
    const channelName = channel.label ?? `channel-${channels.indexOf(channel)}`;

    for (const hit of channel.results) {
      const contribution = weight / (hit.rank + k);
      const entry = acc.get(hit.id) ?? { score: 0, sources: new Set() };
      entry.score += contribution;
      entry.sources.add(channelName);
      acc.set(hit.id, entry);
    }
  }

  // Sort descending by score for deterministic output
  const sorted = Array.from(acc.entries())
    .map(([id, { score, sources }]) => ({
      id,
      score,
      sources: Array.from(sources),
    }))
    .sort((a, b) => b.score - a.score);

  return new Map(sorted.map((e) => [e.id, e]));
}
