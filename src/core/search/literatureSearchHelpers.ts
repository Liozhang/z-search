/**
 * Literature search helpers — extracted from LiteratureSearchWindowBridge
 * so they survive the standalone-page cleanup.
 *
 * @module core/search/literatureSearchHelpers
 */

/**
 * Enrich articles with journal quality metrics (JCR/CASS/Warning) from the
 * builtin DB. Mutates each article in place, attaching jif / jcrQuartile /
 * cassQuartile / cassCategory / cassIsTop / warningLevel when matched.
 *
 * Lookup key: ISSN (normalized) for JCR/CASS, journal name (normalized) for
 * Warning (warning table has no ISSN). Articles without issn are skipped for
 * JCR/CASS (accepted miss rate, see spec §2.2).
 *
 * Failure is silent: metrics are an enhancement and must never break the main
 * search. All store errors are swallowed.
 *
 * Exported + exposed via testAccess for integration testing.
 */
import { safeDebug } from "../../utils/logger";

export async function enrichJournalMetrics(articles: any[]): Promise<void> {
  try {
    const { default: JCRStore } = await import("../data/JCRStore");
    const { default: CASSStore } = await import("../data/CASSStore");
    const { default: WarningListStore } =
      await import("../data/WarningListStore");

    const normIssn = (s: string) => s.replace(/[-\s]/g, "").toUpperCase();
    const normName = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

    const issns = articles.map((a) => a?.issn).filter(Boolean);
    const names = articles
      .map((a) => (a?.journalName || a?.containerTitle || "").trim())
      .filter(Boolean);
    if (issns.length === 0 && names.length === 0) return;

    const [jcrMap, cassMap, warningMap] = await Promise.all([
      issns.length
        ? JCRStore.batchLookupByIssn(issns)
        : Promise.resolve(new Map()),
      issns.length
        ? CASSStore.batchLookupByIssn(issns)
        : Promise.resolve(new Map()),
      names.length
        ? WarningListStore.batchLookupWarnings(names)
        : Promise.resolve(new Map()),
    ]);

    for (const a of articles) {
      if (!a) continue;
      const issnKey = a.issn ? normIssn(a.issn) : "";
      const nameKey = normName(a.journalName || a.containerTitle || "");

      const jcr = issnKey ? jcrMap.get(issnKey) : undefined;
      const cass = issnKey ? cassMap.get(issnKey) : undefined;
      const warn = nameKey ? warningMap.get(nameKey) : undefined;

      if (jcr) {
        a.jif = jcr.jif ?? undefined;
        a.jcrQuartile = jcr.jif_quartile ?? undefined;
      }
      if (cass) {
        a.cassQuartile = cass.major_quartile ?? undefined;
        a.cassCategory = cass.major_category ?? undefined;
        a.cassIsTop = cass.is_top === true;
      }
      if (warn) a.warningLevel = warn.warning_level ?? undefined;
    }
  } catch (e) {
    safeDebug(
      "[z-search] literatureSearchHelpers.enrichWithLocalMetrics failed: " + e,
    );
    // metrics are enhancement; never fail the search
  }
}

/**
 * Normalize a DOI from heterogeneous upstreams into the bare DOI name:
 * strips URL wrappers (https://doi.org/, http(s)://dx.doi.org/) and the
 * `doi:` scheme prefix. Idempotent; empty/absent input returns "".
 *
 * 2026-09-16 审计：OpenAlex 等源会直接回填完整 URL——未归一化时 UI 渲染
 * "DOI: https://doi.org/..."，链接 href 被二次拼成
 * https://doi.org/https://doi.org/...（LiteratureResultCard），导入
 * identifiers 也吃进带前缀串。
 */
export function normalizeDoi(doi: string | undefined | null): string {
  const s = (doi ?? "").trim();
  if (!s) return "";
  return s
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
}
