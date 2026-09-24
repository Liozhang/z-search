/**
 * JournalMetricCard — full quality card for a single journal (mode 'metric').
 *
 * Shows every signal available on JournalMetric: JCR metrics, CAS quartile
 * (major + minors), risk flags (warning list / Beall's predatory), and
 * OpenAlex supplementary stats when sourced from OpenAlex.
 *
 * @module react/components/Hub/search/JournalSearch/JournalMetricCard
 */

import React from "react";
import { getString } from "../../../../utils/locale";
import { StatFigure } from "@/components/ui/StatFigure";
import type { JournalMetric } from "../../../../../types/journalSearch";
import { normalizeQuartile, formatQuartile } from "./types";

/* 分区色阶退役（砚法 §5.3 语义外色相违法；Q3/Q4 撞色不可辨）：Q1 保留
   --accent 单强调档，Q2-Q4 统一 text-primary——分区语义由 Q1-Q4 文字承载，
   颜色非唯一通道（§10.5）。未知分区（data-quartile=''）维持淡档。
   审计行号更正：2026-09-20 审计只点 ~251（CASS），同一违法式在 ~215（JCR）
   重复出现，按法条意图一并退役。 */
const QUARTILE_TONE =
  "font-semibold text-[length:var(--text-sm)] text-[color:var(--text-primary)] data-[quartile='1']:text-[color:var(--accent)] data-[quartile='']:text-[color:var(--text-secondary)]";

interface JournalMetricCardProps {
  metric: JournalMetric;
}

export function JournalMetricCard({
  metric,
}: JournalMetricCardProps): React.ReactElement {
  const isLocal = metric.source === "local";
  const hasJcr =
    metric.jif != null || metric.jifQuartile != null || metric.jci != null;
  const hasCass = metric.cassQuartile != null;
  const hasRisk = !!metric.warningLevel || !!metric.isPredatory;

  // Overview section: research scope + academic indices + publishing metadata.
  // All sourced from OpenAlex (local tables have none of this).
  const hasTopics = !!metric.topics && metric.topics.length > 0;
  const hasAcademicIndices =
    metric.hIndex != null ||
    metric.i10Index != null ||
    metric.twoYearMeanCitedness != null;
  const hasPublishingMeta =
    !!metric.countryCode ||
    metric.firstPublicationYear != null ||
    metric.apcUsd != null ||
    metric.isOpenAccess != null ||
    metric.isInDoaj != null;
  const hasOverview =
    hasTopics ||
    hasAcademicIndices ||
    hasPublishingMeta ||
    metric.openalexWorksCount != null ||
    metric.openalexH5Index != null ||
    !!metric.homepageUrl;

  return (
    /* v2 §4.5 批5 尾：指标大卡去壳——外层 Card 与四层 MetricSection 内嵌 Card
       （框里框）全部退役：外框 → 无框簇；节壳 → overline 小标签 + 行（C 语法）；
       JCR 数值组由行改为 StatFigure（「指标大卡去壳变数字组」）。 */
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="flex items-baseline justify-between gap-[var(--space-2)]">
        <span
          className="[font:var(--ui-font-heading)] text-[color:var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
          title={metric.name}
        >
          {metric.name}
        </span>
        <span
          className={`inline-flex items-center shrink-0 py-[var(--space-0-5)] px-[var(--space-1-5)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-medium ${isLocal ? "bg-[var(--signal-green-bg)] text-[color:var(--signal-green-dark)]" : "bg-[var(--data-blue-bg)] text-[color:var(--data-blue-dark)]"}`}
        >
          {getString(
            isLocal ? "journal-source-local" : "journal-source-openalex",
          )}
        </span>
      </div>

      {(metric.issn || metric.eissn || metric.publisher) && (
        <div className="flex gap-[var(--space-2-5)] flex-wrap [font:var(--ui-font-meta)] text-[color:var(--text-secondary)]">
          {metric.issn && <span>ISSN: {metric.issn}</span>}
          {metric.eissn && <span>eISSN: {metric.eissn}</span>}
          {metric.publisher && (
            <span className="italic">{metric.publisher}</span>
          )}
        </div>
      )}

      {hasOverview && (
        <MetricSection title={getString("journal-overview-section")}>
          {/* Research scope — the closest thing to a "description". */}
          {hasTopics && (
            <div className="flex flex-col gap-[var(--space-1)]">
              <span className="text-[color:var(--text-secondary)]">
                {getString("journal-topics-label")}
              </span>
              <div className="flex flex-wrap gap-[var(--space-1)]">
                {metric.topics!.map((t, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center py-[var(--space-0-5)] px-[var(--space-1-5)] rounded-[var(--radius-pill)] text-[length:var(--text-xs)] text-[color:var(--text-secondary)]"
                  >
                    {t.displayName}
                    {t.field ? ` · ${t.field}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
          {/* Academic indices. */}
          {metric.hIndex != null && (
            <MetricRow
              label={getString("journal-h-index-label")}
              value={metric.hIndex.toLocaleString()}
            />
          )}
          {metric.i10Index != null && (
            <MetricRow
              label={getString("journal-i10-index-label")}
              value={metric.i10Index.toLocaleString()}
            />
          )}
          {metric.twoYearMeanCitedness != null && (
            <MetricRow
              label={getString("journal-2yr-citedness-label")}
              value={metric.twoYearMeanCitedness.toFixed(2)}
            />
          )}
          {metric.openalexWorksCount != null && (
            <MetricRow
              label={getString("journal-works-count-label")}
              value={metric.openalexWorksCount.toLocaleString()}
            />
          )}
          {metric.openalexH5Index != null && (
            <MetricRow
              label={getString("journal-h5-index-label")}
              value={String(metric.openalexH5Index)}
            />
          )}
          {/* Publishing metadata. */}
          {hasPublishingMeta && (
            <div className="flex flex-wrap items-center gap-[var(--space-1-5)] text-[length:var(--text-xs)] text-[color:var(--text-secondary)]">
              {metric.countryCode && <span>{metric.countryCode}</span>}
              {metric.firstPublicationYear != null && (
                <span>
                  {getString("journal-since-year", {
                    args: { year: metric.firstPublicationYear },
                  })}
                </span>
              )}
              {metric.apcUsd != null && (
                <span>
                  {getString("journal-apc-label", {
                    args: { amount: metric.apcUsd.toLocaleString() },
                  })}
                </span>
              )}
              {metric.isOpenAccess && (
                <span className="inline-flex items-center py-[var(--space-0-5)] px-[var(--space-1-5)] rounded-[var(--radius-pill)] bg-[var(--signal-green-bg)] text-[color:var(--signal-green-dark)] font-medium">
                  {getString("journal-oa-label")}
                </span>
              )}
              {metric.isInDoaj && (
                <span className="inline-flex items-center py-[var(--space-0-5)] px-[var(--space-1-5)] rounded-[var(--radius-pill)] bg-[var(--signal-green-bg)] text-[color:var(--signal-green-dark)] font-medium">
                  {getString("journal-doaj-label")}
                </span>
              )}
            </div>
          )}
          {metric.homepageUrl && (
            <div className="grid grid-cols-[auto_1fr] gap-[var(--space-2)] items-center text-[length:var(--text-sm)]">
              <a
                className="focus-ring-subtle text-[length:var(--text-sm)] text-[color:var(--data-blue-dark)] no-underline break-all hover:underline"
                href={metric.homepageUrl}
                target="_blank"
                rel="noreferrer"
              >
                {metric.homepageUrl}
              </a>
            </div>
          )}
        </MetricSection>
      )}

      {hasJcr && (
        <MetricSection title={getString("journal-jcr-section")}>
          {/* 主指标数字组（§5.1 去壳数字位）：JIF / 五年 JIF / JCI 三个头部
              数值——原与排位、被引数同为行，主次不分。 */}
          {(metric.jif != null ||
            metric.fiveYearJif != null ||
            metric.jci != null) && (
            <div className="hub-grid-12">
              {metric.jif != null && (
                <StatFigure
                  className="col-4"
                  label={getString("journal-jif-label")}
                  value={metric.jif.toFixed(1)}
                />
              )}
              {metric.fiveYearJif != null && (
                <StatFigure
                  className="col-4"
                  label={getString("journal-five-year-jif-label")}
                  value={metric.fiveYearJif.toFixed(1)}
                />
              )}
              {metric.jci != null && (
                <StatFigure
                  className="col-4"
                  label={getString("journal-jci-label")}
                  value={metric.jci.toFixed(2)}
                />
              )}
            </div>
          )}
          {metric.jifQuartile && (
            <MetricRow
              label={getString("journal-quartile-label")}
              value={
                <span
                  className={QUARTILE_TONE}
                  data-quartile={normalizeQuartile(metric.jifQuartile) ?? ""}
                >
                  {formatQuartile(metric.jifQuartile)}
                </span>
              }
            />
          )}
          {metric.jifRank != null && (
            <MetricRow
              label={getString("journal-rank-label")}
              value={String(metric.jifRank)}
            />
          )}
          {metric.totalCites != null && (
            <MetricRow
              label={getString("journal-total-cites-label")}
              value={metric.totalCites.toLocaleString()}
            />
          )}
          {metric.totalArticles != null && (
            <MetricRow
              label={getString("journal-total-articles-label")}
              value={metric.totalArticles.toLocaleString()}
            />
          )}
        </MetricSection>
      )}

      {hasCass && (
        <MetricSection title={getString("journal-cass-section")}>
          {metric.cassQuartile != null && (
            <MetricRow
              label={getString("journal-cass-quartile-label")}
              value={
                <span
                  className={QUARTILE_TONE}
                  data-quartile={normalizeQuartile(metric.cassQuartile) ?? ""}
                >
                  {formatQuartile(metric.cassQuartile)}
                </span>
              }
            />
          )}
          {metric.cassCategory && (
            <MetricRow
              label={getString("journal-cass-category-label")}
              value={`${metric.cassCategory}${metric.cassCategoryEn ? ` (${metric.cassCategoryEn})` : ""}`}
            />
          )}
          {metric.cassIsTop != null && metric.cassIsTop && (
            <MetricRow label={getString("journal-is-top-label")} value="★" />
          )}
          {metric.cassMinorCategories &&
            metric.cassMinorCategories.length > 0 && (
              <div className="flex flex-col gap-[var(--space-1)]">
                <span className="text-[color:var(--text-secondary)]">
                  {getString("journal-minor-categories-label")}
                </span>
                <div className="flex flex-col gap-[var(--space-0-5)]">
                  {metric.cassMinorCategories.map((m, idx) => (
                    <span
                      key={idx}
                      className="text-[length:var(--text-sm)] text-[color:var(--text-primary)]"
                    >
                      <span data-quartile={normalizeQuartile(m.quartile) ?? ""}>
                        {formatQuartile(m.quartile)}
                      </span>{" "}
                      {m.nameCn || m.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
        </MetricSection>
      )}

      {hasRisk && (
        <MetricSection title={getString("journal-risk-section")}>
          {metric.warningLevel && (
            <div className="flex items-center gap-[var(--space-2)] flex-wrap">
              <span className="inline-flex items-center py-[var(--space-0-5)] px-[var(--space-1-5)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-semibold bg-[var(--signal-yellow-bg)] text-[color:var(--signal-yellow-text)]">
                {getString("journal-warning-label")}
                {metric.warningLevel ? `: ${metric.warningLevel}` : ""}
              </span>
              {metric.warningReason && (
                <span className="text-[length:var(--text-xs)] text-[color:var(--text-secondary)]">
                  {metric.warningReason}
                </span>
              )}
            </div>
          )}
          {metric.isPredatory && (
            <div className="flex items-center gap-[var(--space-2)] flex-wrap">
              <span
                className="inline-flex items-center py-[var(--space-0-5)] px-[var(--space-1-5)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-semibold bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)]"
                title={getString("journal-predatory-data-year")}
              >
                {getString("journal-predatory-label")}
                {metric.predatoryCategory
                  ? ` (${metric.predatoryCategory})`
                  : ""}
              </span>
            </div>
          )}
        </MetricSection>
      )}
    </div>
  );
}

function MetricSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    /* 节壳退役（v2 §4.5 批5 尾）：原为 Card 套在外层 Card 里（框里框）——
       节标题改 overline 名字位（C 语法，与同页 hub-overline 同制），内容直接
       落在页面留白上。 */
    <div className="flex flex-col gap-[var(--space-2)]">
      <div className="hub-overline">{title}</div>
      {children}
    </div>
  );
}

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-[var(--space-2)] items-center text-[length:var(--text-sm)]">
      <span className="text-[color:var(--text-secondary)]">{label}</span>
      <span className="text-[color:var(--text-primary)] font-medium text-right overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
        {value}
      </span>
    </div>
  );
}

export default JournalMetricCard;
