/**
 * Runtime loader for externalized data JSON files.
 *
 * Replaces the previous pattern of importing large data arrays directly from
 * `src/core/data/*-data.ts` modules (which esbuild bundled into the main
 * leadero.js). Those four data sets (~8.6 MB of TS literals → ~5.2 MB of
 * JSON) now ship as `addon/data/*.json` and are read on first import only.
 *
 * Path resolution: `rootURI` is the bootstrap-provided addon root. It is a
 * `file:` URI in dev (unpacked dir) and a `jar:file:...!/` URI in a packaged
 * xpi. `Zotero.File.getContentsAsync` accepts both, so the same code path
 * works in either mode.
 *
 * Files are written once at build time by `scripts/export-data-json.cjs`.
 */

/** Envelope shared by cass-2025.json / jcr-2024.json / warning.json. */
export interface YearedDataFile<T = unknown> {
  year: number;
  data: T[];
}

/** Envelope for warning.json (no year field). */
export interface WarningDataFile {
  data: (string | number | null)[][];
}

/** Envelope for bealls.json. */
export interface BeallsDataFile {
  standalone: (string | null)[][];
  publishers: (string | null)[][];
  hijacked: (string | null)[][];
  misleading: (string | null)[][];
}

const loadedFiles = new Map<string, unknown>();

/**
 * Read and JSON.parse a file under `addon/data/`.
 *
 * Results are memoized for the lifetime of the process — the underlying JSON
 * never changes between releases, so re-reading on every call would be wasted
 * work. Callers receive the same object reference on subsequent calls.
 */
export async function loadDataFile<T>(filename: string): Promise<T> {
  const cached = loadedFiles.get(filename);
  if (cached !== undefined) {
    return cached as T;
  }

  const uri = `${rootURI}data/${filename}`;
  const text = (await Zotero.File.getContentsAsync(uri)) as string;
  const parsed = JSON.parse(text) as T;
  loadedFiles.set(filename, parsed);
  return parsed;
}
