/**
 * MinerUQuotaStore — daily cloud-quota counter, persisted OUTSIDE the pref
 * system (internal runtime state, not user configuration).
 *
 * Replaces the pdfParser.mineru.pagesUsedToday/pagesUsedDate prefs: those
 * were mutable counters registered as user prefs — editable via about:config
 * and semantically wrong (a counter is not a setting).
 *
 * Storage: {Zotero.DataDirectory.dir}/leadero/state/mineru-quota.json
 * (same leadero/ subtree convention as ModelDownloadManager's models/).
 *
 * Sync/async contract: the getter is synchronous (returns the in-memory
 * cache; 0 until the async hydration completes — an informational counter
 * tolerating a cold-start read). Mutations are async write-through. Failures
 * are logged and swallowed: quota tracking must never break a parse
 * (honest-error principle applies to the parse, not the bookkeeping).
 */

import { safeDebug } from "../../utils/logger";

const STATE_SUBDIR = "zsearch/state";
const STATE_FILE = "mineru-quota.json";

interface QuotaState {
  /** YYYY-MM-DD (en-CA locale) of the counter. */
  date: string;
  used: number;
}

let cached: QuotaState | null = null;
let hydration: Promise<void> | null = null;

function stateFilePath(): string {
  const dataDir = Zotero.DataDirectory.dir;
  return `${dataDir}/${STATE_SUBDIR}/${STATE_FILE}`;
}

function today(): string {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
}

/** Load state from disk once per process; subsequent calls reuse the promise. */
function ensureHydrated(): Promise<void> {
  if (!hydration) {
    hydration = (async () => {
      try {
        if (await IOUtils.exists(stateFilePath())) {
          const raw = await IOUtils.readUTF8(stateFilePath());
          const parsed = JSON.parse(raw) as Partial<QuotaState>;
          if (
            typeof parsed.date === "string" &&
            typeof parsed.used === "number"
          ) {
            cached = { date: parsed.date, used: parsed.used };
          }
        }
      } catch (e) {
        safeDebug("z-search: [mineru-quota] hydrate failed: " + (e ?? ""));
      }
    })();
  }
  return hydration;
}

async function flush(): Promise<void> {
  try {
    const file = stateFilePath();
    const dir = file.slice(0, file.lastIndexOf("/"));
    if (!(await IOUtils.exists(dir))) {
      await IOUtils.makeDirectory(dir, { createAncestors: true });
    }
    await IOUtils.writeUTF8(
      file,
      JSON.stringify(cached ?? { date: today(), used: 0 }),
    );
  } catch (e) {
    safeDebug("z-search: [mineru-quota] flush failed: " + (e ?? ""));
  }
}

/** Pages consumed today (0 until hydration completes or on a new day). */
export function getPagesUsedToday(): number {
  if (!cached || cached.date !== today()) return 0;
  return cached.used;
}

/** Kick off hydration (call early from plugin lifecycle; optional). */
export function initMinerUQuotaStore(): Promise<void> {
  return ensureHydrated();
}

/** Add pageCount to today's counter (write-through, failure-tolerant). */
export async function trackPagesUsed(pageCount: number): Promise<void> {
  if (pageCount <= 0) return;
  await ensureHydrated();
  const t = today();
  cached =
    cached && cached.date === t
      ? { date: t, used: cached.used + pageCount }
      : { date: t, used: pageCount };
  await flush();
}
