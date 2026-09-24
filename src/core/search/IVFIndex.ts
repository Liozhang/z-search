/**
 * IVFIndex — pure-JS Inverted-File (IVF) approximate nearest-neighbor index.
 *
 * Complements InMemoryMatrixIndex: exact brute-force is fine for small corpora,
 * but at thousands of vectors the O(N) per-query scan + O(N log K) heap becomes
 * the bottleneck. IVF clusters vectors into k lists (via k-means) and at query
 * time scans only the `nprobe` lists whose centroids are nearest to the query —
 * trading a small recall loss for a large speedup.
 *
 * No native dependencies (Zotero plugins run on SpiderMonkey, not Node, so
 * hnswlib-node / N-API addons are unavailable). Implements the same VectorIndex
 * interface so PdfChunkStore can swap it in by size threshold.
 *
 * Complexity (N vectors, dimension d, k centroids, nprobe probed):
 *   build:   O(k-means iters × N × d)
 *   search:  O(k·d + (N·nprobe/k)·d)   vs. brute-force O(N·d)
 *
 * @module core/search/IVFIndex
 */

import type {
  IndexEntry,
  VectorIndex,
  VectorSearchResult,
} from "./VectorIndex";
import { cosineSimilarity } from "ai";

interface StoredEntry {
  id: number;
  vector: Float32Array;
  meta: IndexEntry;
  /** Cluster index this vector is assigned to. */
  cluster: number;
}

const DEFAULT_NUM_CLUSTERS = 256;
const DEFAULT_NPROBE = 8;
const KMEANS_ITERS = 12;
/** Below this count the exact brute-force index is preferable (overhead not worth it). */
export const IVF_MIN_VECTORS = 2000;

export class IVFIndex implements VectorIndex {
  private readonly dimension: number;
  private entries = new Map<number, StoredEntry>();
  private centroids: Float32Array[] = [];
  /** cluster index → list of entry ids */
  private invertedLists: number[][] = [];
  private numClusters: number;
  private nprobe: number;
  private dirty = true;

  constructor(
    dimension: number,
    opts?: { numClusters?: number; nprobe?: number },
  ) {
    if (!Number.isInteger(dimension) || dimension <= 0) {
      throw new Error(`Invalid dimension: ${dimension}`);
    }
    this.dimension = dimension;
    this.numClusters = opts?.numClusters ?? DEFAULT_NUM_CLUSTERS;
    this.nprobe = opts?.nprobe ?? DEFAULT_NPROBE;
  }

  add(id: number, vector: Float32Array, meta: IndexEntry): void {
    if (vector.length !== this.dimension) {
      throw new Error(
        `Vector dimension mismatch for id ${id}: expected ${this.dimension}, got ${vector.length}`,
      );
    }
    this.entries.set(id, {
      id,
      vector: new Float32Array(vector),
      meta: { ...meta },
      cluster: -1,
    });
    this.dirty = true;
  }

  remove(id: number): void {
    if (this.entries.delete(id)) {
      this.dirty = true;
    }
  }

  clear(): void {
    this.entries.clear();
    this.centroids = [];
    this.invertedLists = [];
    this.dirty = true;
  }

  size(): number {
    return this.entries.size;
  }

  /** Rebuild centroids (k-means) and inverted lists. Called lazily on search. */
  private rebuild(): void {
    if (!this.dirty) return;
    const n = this.entries.size;
    if (n === 0) {
      this.centroids = [];
      this.invertedLists = [];
      this.dirty = false;
      return;
    }

    // Adapt cluster count to corpus size (can't have more clusters than vectors).
    const k = Math.min(this.numClusters, Math.max(1, Math.floor(n / 10)));
    const allEntries = Array.from(this.entries.values());

    // Seed centroids by sampling k evenly-spaced entries (deterministic, so the
    // same corpus always produces the same clustering — important for cache
    // consistency and reproducible search quality).
    this.centroids = [];
    const step = Math.max(1, Math.floor(n / k));
    for (let i = 0; i < n && this.centroids.length < k; i += step) {
      this.centroids.push(new Float32Array(allEntries[i].vector));
    }
    const actualK = this.centroids.length;
    if (actualK === 0) {
      this.dirty = false;
      return;
    }

    // Lloyd's k-means.
    const assignments = new Int32Array(n);
    for (let iter = 0; iter < KMEANS_ITERS; iter++) {
      let changed = false;
      // Assignment step: each vector → nearest centroid.
      for (let i = 0; i < n; i++) {
        let best = 0;
        let bestSim = -Infinity;
        for (let c = 0; c < actualK; c++) {
          const sim = dot(allEntries[i].vector, this.centroids[c]);
          if (sim > bestSim) {
            bestSim = sim;
            best = c;
          }
        }
        if (assignments[i] !== best) {
          assignments[i] = best;
          changed = true;
        }
      }
      const sums = Array.from(
        { length: actualK },
        () => new Float32Array(this.dimension),
      );
      const counts = new Array(actualK).fill(0);
      for (let i = 0; i < n; i++) {
        const c = assignments[i];
        counts[c]++;
        const v = allEntries[i].vector;
        const s = sums[c];
        for (let d = 0; d < this.dimension; d++) s[d] += v[d];
      }
      for (let c = 0; c < actualK; c++) {
        if (counts[c] > 0) {
          for (let d = 0; d < this.dimension; d++)
            this.centroids[c][d] = sums[c][d] / counts[c];
        }
      }
      if (!changed && iter > 0) break; // converged
    }

    this.invertedLists = Array.from({ length: actualK }, () => []);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      allEntries[i].cluster = c;
      this.invertedLists[c].push(allEntries[i].id);
    }
    this.dirty = false;
  }

  search(
    query: Float32Array,
    topK: number,
    filter?: (entry: IndexEntry, id: number) => boolean,
  ): VectorSearchResult[] {
    if (this.entries.size === 0 || topK <= 0) return [];
    if (query.length !== this.dimension) {
      throw new Error(
        `Query dimension mismatch: expected ${this.dimension}, got ${query.length}`,
      );
    }
    this.rebuild();
    if (this.centroids.length === 0) return [];

    // Pick the nprobe nearest centroids to the query.
    const probe = Math.min(this.nprobe, this.centroids.length);
    const centroidScores = this.centroids.map((c, i) => ({
      i,
      sim: dot(query, c),
    }));
    // Partial top-probe selection via sort (probe is small, e.g. 8).
    centroidScores.sort((a, b) => b.sim - a.sim);
    const probedClusters = new Set<number>();
    for (let i = 0; i < probe; i++) probedClusters.add(centroidScores[i].i);

    // Scan only the inverted lists of probed clusters.
    const candidates: Array<{ id: number; score: number; meta: IndexEntry }> =
      [];
    for (const cluster of probedClusters) {
      const ids = this.invertedLists[cluster];
      if (!ids) continue;
      for (const id of ids) {
        const entry = this.entries.get(id);
        if (!entry) continue;
        if (filter && !filter(entry.meta, id)) continue;
        const score = cosineSimilarity(
          Array.from(query),
          Array.from(entry.vector),
        );
        candidates.push({ id, score, meta: entry.meta });
      }
    }

    // Top-K by score (desc). For a small candidate set a full sort is cheaper
    // than maintaining a heap; for large nprobe this could swap to the heap.
    candidates.sort((a, b) => b.score - a.score);
    const limit = Math.min(topK, candidates.length);
    const results: VectorSearchResult[] = [];
    for (let i = 0; i < limit; i++) {
      results.push({
        id: candidates[i].id,
        score: candidates[i].score,
        meta: candidates[i].meta,
      });
    }
    return results;
  }

  // serialize/deserialize are no-ops for IVF: the index rebuilds from entries
  // on first search (k-means is deterministic-ish and fast relative to I/O).
  // The cold-start binary cache is handled by PdfChunkStore against the
  // InMemoryMatrixIndex; IVF is only constructed after a warm load.
  async serialize(_path: string): Promise<void> {}
  async deserialize(_path: string): Promise<void> {}
}

/** Dot product of two equal-length vectors. */
function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
