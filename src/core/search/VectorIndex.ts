/**
 * VectorIndex - In-memory vector index abstraction for semantic search
 *
 * Decouples vector storage/search strategy from callers. First implementation
 * is brute-force matrix cosine (InMemoryMatrixIndex), suitable for personal
 * paper libraries (< 100k vectors). The interface allows swapping in IVF
 * (k-means clustering) or HNSW later without touching PdfChunkStore.
 *
 * @module core/search/VectorIndex
 */

export interface IndexEntry {
  itemId: number;
  sectionCategory?: string;
}

export interface VectorSearchResult {
  /** Chunk row id (matches zsearch_pdf_chunks.id) */
  id: number;
  /** Cosine similarity in [-1, 1] */
  score: number;
  meta: IndexEntry;
}

export interface VectorIndex {
  add(id: number, vector: Float32Array, meta: IndexEntry): void;
  remove(id: number): void;
  clear(): void;
  search(
    query: Float32Array,
    topK: number,
    filter?: (entry: IndexEntry, id: number) => boolean,
  ): VectorSearchResult[];
  size(): number;
  serialize(path: string): Promise<void>;
  deserialize(path: string): Promise<void>;
}

interface StoredEntry {
  vector: Float32Array;
  meta: IndexEntry;
}

/**
 * Min-heap helpers over an array of row indices keyed by `scores[row]`.
 * Used by InMemoryMatrixIndex.search() for O(N log K) top-K selection.
 */

/** Sift up the element at index `i` to restore the min-heap property. */
function siftUpScores(heap: number[], scores: Float32Array, i: number): void {
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (scores[heap[i]] < scores[heap[parent]]) {
      const tmp = heap[i];
      heap[i] = heap[parent];
      heap[parent] = tmp;
      i = parent;
    } else {
      break;
    }
  }
}

/** Sift down the element at index `i` to restore the min-heap property. */
function siftDownScores(
  heap: number[],
  scores: Float32Array,
  i: number,
  size: number,
): void {
  while (true) {
    let smallest = i;
    const left = 2 * i + 1;
    const right = 2 * i + 2;
    if (left < size && scores[heap[left]] < scores[heap[smallest]])
      smallest = left;
    if (right < size && scores[heap[right]] < scores[heap[smallest]])
      smallest = right;
    if (smallest === i) break;
    const tmp = heap[i];
    heap[i] = heap[smallest];
    heap[smallest] = tmp;
    i = smallest;
  }
}

/**
 * InMemoryMatrixIndex - Brute-force cosine similarity over a packed Float32Array.
 *
 * - All vectors concatenated into one Float32Array (N × dim)
 * - search() does a single pass with per-row dot product + normalization
 * - add/remove mark the matrix dirty; rebuilt lazily on next search
 * - serialize() writes a binary blob for fast cold-start
 *
 * For 50k vectors × 1536 dim: matrix ~300MB, search < 50ms.
 */
export class InMemoryMatrixIndex implements VectorIndex {
  private readonly dimension: number;
  private entries: Map<number, StoredEntry> = new Map();
  private matrix: Float32Array | null = null;
  private rowToId: number[] = [];
  private dirty = true;

  constructor(dimension: number) {
    if (!Number.isInteger(dimension) || dimension <= 0) {
      throw new Error(`Invalid dimension: ${dimension}`);
    }
    this.dimension = dimension;
  }

  add(id: number, vector: Float32Array, meta: IndexEntry): void {
    if (vector.length !== this.dimension) {
      throw new Error(
        `Vector dimension mismatch for id ${id}: expected ${this.dimension}, got ${vector.length}`,
      );
    }
    // Defensive copy — callers may reuse the source buffer
    this.entries.set(id, {
      vector: new Float32Array(vector),
      meta: { ...meta },
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
    this.matrix = null;
    this.rowToId = [];
    this.dirty = true;
  }

  size(): number {
    return this.entries.size;
  }

  private ensureMatrix(): void {
    if (!this.dirty && this.matrix) return;
    const n = this.entries.size;
    this.rowToId = new Array(n);
    this.matrix = new Float32Array(n * this.dimension);
    let row = 0;
    for (const [id, entry] of this.entries) {
      this.matrix.set(entry.vector, row * this.dimension);
      this.rowToId[row] = id;
      row++;
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
    this.ensureMatrix();

    const n = this.rowToId.length;
    const dim = this.dimension;
    const mat = this.matrix!;

    // Precompute query norm. Inlined for the hot loop (flat Float32Array matrix,
    // no per-row allocation); the formula matches AI SDK cosineSimilarity
    // exactly (zero-magnitude → 0, no epsilon) so scores stay cross-comparable
    // with the other 'ai' cosineSimilarity call sites.
    let queryNormSq = 0;
    for (let i = 0; i < dim; i++) queryNormSq += query[i] * query[i];
    const queryNorm = Math.sqrt(queryNormSq);

    const scores = new Float32Array(n);
    for (let row = 0; row < n; row++) {
      const id = this.rowToId[row];
      const entry = this.entries.get(id)!;

      // Filtered-out entries get -Infinity so they sink in the sort
      if (filter && !filter(entry.meta, id)) {
        scores[row] = -Infinity;
        continue;
      }

      let dot = 0;
      let normSq = 0;
      const offset = row * dim;
      for (let i = 0; i < dim; i++) {
        const v = mat[offset + i];
        dot += query[i] * v;
        normSq += v * v;
      }
      // AI SDK cosineSimilarity semantics: zero magnitude → 0 (not NaN)
      scores[row] =
        queryNormSq === 0 || normSq === 0
          ? 0
          : dot / (queryNorm * Math.sqrt(normSq));
    }

    // Partial selection of topK via a fixed-size min-heap.
    // The heap holds the current top-K candidate row indices, ordered so the
    // SMALLEST score sits at the root (the eviction candidate). For each row we
    // either fill the heap (size < K) or replace the root when a higher score
    // arrives. This is O(N log K) instead of O(N log N) full-sort, with a
    // smaller constant than quickselect for typical K (≤50).
    const limit = Math.min(topK, n);
    const heap: number[] = []; // row indices; heap property on scores[row]

    for (let row = 0; row < n; row++) {
      if (scores[row] === -Infinity) continue; // filtered out
      if (heap.length < limit) {
        heap.push(row);
        siftUpScores(heap, scores, heap.length - 1);
      } else if (scores[row] > scores[heap[0]]) {
        heap[0] = row; // evict the current smallest top-K member
        siftDownScores(heap, scores, 0, heap.length);
      }
    }

    heap.sort((a, b) => scores[b] - scores[a]);
    const results: VectorSearchResult[] = [];
    for (let i = 0; i < heap.length; i++) {
      const row = heap[i];
      const id = this.rowToId[row];
      results.push({
        id,
        score: scores[row],
        meta: this.entries.get(id)!.meta,
      });
    }
    return results;
  }

  /**
   * Serialize the index to a binary file for fast cold-start.
   *
   * Layout (little-endian):
   *   [dimension: uint32]
   *   [count: uint32]
   *   per entry:
   *     [id: uint32]
   *     [itemId: uint32]
   *     [sectionCategoryLen: uint16] (0 = undefined)
   *     [sectionCategory: utf8 bytes]
   *     [vector: dimension × float32]
   */
  async serialize(path: string): Promise<void> {
    this.ensureMatrix();
    const n = this.rowToId.length;
    const dim = this.dimension;

    const encoder = new TextEncoder();
    const metaPre: Array<{
      id: number;
      itemId: number;
      cat: Uint8Array | null;
    }> = [];
    let metaBytesTotal = 0;
    for (let row = 0; row < n; row++) {
      const id = this.rowToId[row];
      const entry = this.entries.get(id)!;
      let cat: Uint8Array | null = null;
      if (entry.meta.sectionCategory) {
        cat = encoder.encode(entry.meta.sectionCategory);
        metaBytesTotal += cat.length;
      }
      metaPre.push({ id, itemId: entry.meta.itemId, cat });
    }

    const headerLen = 8;
    const perEntryFixed = 4 + 4 + 2; // id + itemId + catLen
    const totalLen =
      headerLen + n * perEntryFixed + metaBytesTotal + n * dim * 4;
    const buf = new ArrayBuffer(totalLen);
    const dv = new DataView(buf);
    dv.setUint32(0, dim, true);
    dv.setUint32(4, n, true);

    let offset = headerLen;
    for (let row = 0; row < n; row++) {
      const m = metaPre[row];
      dv.setUint32(offset, m.id, true);
      offset += 4;
      dv.setUint32(offset, m.itemId, true);
      offset += 4;
      if (m.cat) {
        dv.setUint16(offset, m.cat.length, true);
        offset += 2;
        new Uint8Array(buf, offset, m.cat.length).set(m.cat);
        offset += m.cat.length;
      } else {
        dv.setUint16(offset, 0, true);
        offset += 2;
      }
    }
    // Vectors: bulk copy the already-packed matrix
    new Float32Array(buf, offset, n * dim).set(this.matrix!);

    await IOUtils.write(path, new Uint8Array(buf));
  }

  async deserialize(path: string): Promise<void> {
    const exists = await IOUtils.exists(path);
    if (!exists) return;

    const bytes = await IOUtils.read(path);

    if (bytes.byteLength < 8) {
      throw new Error(
        `Invalid index file: too short (${bytes.byteLength} bytes, need >= 8)`,
      );
    }

    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    const dv = new DataView(buf);
    const dim = dv.getUint32(0, true);
    const n = dv.getUint32(4, true);

    if (dim !== this.dimension) {
      throw new Error(
        `Serialized dimension mismatch: file has ${dim}, index expects ${this.dimension}`,
      );
    }

    // First pass: validate full structure WITHOUT mutating this.entries.
    // A corrupted file must not leave the index half-initialized.
    const decoder = new TextDecoder();
    const staged: Array<{ id: number; meta: IndexEntry; vecOffset: number }> =
      [];
    let offset = 8;
    for (let i = 0; i < n; i++) {
      if (offset + 10 > bytes.byteLength) {
        throw new Error(
          `Corrupted index file: unexpected EOF before entry ${i} header`,
        );
      }
      const id = dv.getUint32(offset, true);
      offset += 4;
      const itemId = dv.getUint32(offset, true);
      offset += 4;
      const catLen = dv.getUint16(offset, true);
      offset += 2;
      if (catLen > 65535) {
        throw new Error(`Corrupted index file: catLen overflow at entry ${i}`);
      }
      if (offset + catLen > bytes.byteLength) {
        throw new Error(
          `Corrupted index file: sectionCategory overflow at entry ${i}`,
        );
      }
      let sectionCategory: string | undefined;
      if (catLen > 0) {
        sectionCategory = decoder.decode(new Uint8Array(buf, offset, catLen));
        offset += catLen;
      }
      const vecLen = dim * 4;
      if (offset + vecLen > bytes.byteLength) {
        throw new Error(`Corrupted index file: vector overflow at entry ${i}`);
      }
      staged.push({ id, meta: { itemId, sectionCategory }, vecOffset: offset });
      offset += vecLen;
    }

    // All validation passed — safe to mutate state
    this.entries.clear();
    for (const s of staged) {
      const view = new Float32Array(buf, s.vecOffset, dim);
      // Defensive copy so `buf` can be GC'd after we return
      this.entries.set(s.id, {
        vector: new Float32Array(view),
        meta: s.meta,
      });
    }

    this.dirty = true;
    this.ensureMatrix();
  }
}
