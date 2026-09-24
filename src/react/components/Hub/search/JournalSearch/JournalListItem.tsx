/**
 * JournalListItem — compact row for modes 'discover' and 'library'.
 *
 * Shows journal name, ISSN, one of {worksCount | libraryCount}, plus inline
 * quality badges (JCR Q, CAS Q, top, warning, predatory).
 *
 * @module react/components/Hub/search/JournalSearch/JournalListItem
 */

import React from "react";
import { getString } from "../../../../utils/locale";
import type { JournalListItem } from "../../../../../types/journalSearch";
import { normalizeQuartile, formatQuartile } from "./types";
import { ChevronRightIconSvg } from "../../../../utils/icons";
import { ICON } from "../../../../utils/iconSizes";

/* 分区色阶退役（砚法 §5.3 语义外色相违法；Q3/Q4 撞色不可辨）：Q1 保留
   --accent 单强调档，Q2-Q4 统一 text-primary——分区语义由 Q1-Q4 文字承载，
   颜色非唯一通道（§10.5）。未知分区（data-quartile=''）维持淡档。 */
const QUARTILE_TONE =
  "font-semibold text-[length:var(--text-sm)] text-[color:var(--text-primary)] data-[quartile='1']:text-[color:var(--accent)] data-[quartile='']:text-[color:var(--text-secondary)]";

interface JournalListItemProps {
  item: JournalListItem;
  /** Which count to surface — 'works' (OpenAlex) for discover, 'library' for library mode. */
  countKind: "works" | "library";
  onClick?: (name: string, issn?: string) => void;
}

export function JournalListItemView({
  item,
  countKind,
  onClick,
}: JournalListItemProps): React.ReactElement {
  const count = countKind === "works" ? item.worksCount : item.libraryCount;
  const countLabel =
    countKind === "works"
      ? getString("journal-works-count-label")
      : getString("journal-library-count-label");

  return (
    /* v2 §4.5 批5 尾：期刊列表行式——去卡壳（border/radius/bg 三件）改行制，
       行线走 --hub-row-divider，整行 hover 补回可点击性；题名升 title 档
       （15px/500），与文献行同语法（D 形态两种列表不再两套容器语言）。 */
    <div
      className="flex flex-col gap-[var(--space-1)] py-[var(--space-2)] px-0 border-t border-t-[var(--hub-row-divider)] cursor-pointer transition-colors duration-[var(--transition-fast)] hover:bg-[var(--hub-bg-hover)]"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? () => onClick(item.name, item.issn) : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(item.name, item.issn);
              }
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <span className="[font:var(--ui-font-title)] text-[color:var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {item.name}
        </span>
        <span className="inline-flex items-center gap-[var(--space-1-5)] shrink-0">
          {item.jifQuartile && (
            <span
              className={QUARTILE_TONE}
              data-quartile={normalizeQuartile(item.jifQuartile) ?? ""}
            >
              {getString("journal-jif-label").slice(0, 1)}
              {formatQuartile(item.jifQuartile)}
            </span>
          )}
          {item.cassQuartile != null && (
            <span
              className={QUARTILE_TONE}
              data-quartile={normalizeQuartile(item.cassQuartile) ?? ""}
            >
              {formatQuartile(item.cassQuartile)}
            </span>
          )}
          {item.cassIsTop && (
            <span className="text-[color:var(--signal-yellow-text)] text-[length:var(--text-sm)]">
              ★
            </span>
          )}
          {item.warningLevel && (
            <span className="inline-flex items-center py-[var(--space-0-5)] px-[var(--space-1-5)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-semibold bg-[var(--signal-yellow-bg)] text-[color:var(--signal-yellow-text)]">
              {getString("journal-warning-label")}
            </span>
          )}
          {item.isPredatory && (
            <span
              className="inline-flex items-center py-[var(--space-0-5)] px-[var(--space-1-5)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-semibold bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)]"
              title={getString("journal-predatory-data-year")}
            >
              {getString("journal-predatory-label")}
            </span>
          )}
          {/* 行可点示能（砚法 §8.3 行可点示能〔法〕、§10.1）：行尾常驻淡墨
              chevron——hover 沉纸只许做强化，不得作为唯一示能。 */}
          {onClick && (
            <ChevronRightIconSvg
              size={ICON.sm}
              aria-hidden="true"
              className="text-[color:var(--ink-heavy)] shrink-0"
            />
          )}
        </span>
      </div>
      <div className="flex items-center gap-[var(--space-2-5)] flex-wrap text-[length:var(--text-xs)] text-[color:var(--text-secondary)]">
        {item.issn && <span className="tabular-nums">ISSN: {item.issn}</span>}
        {item.jif != null && (
          <span>
            {getString("journal-jif-label")} {item.jif.toFixed(1)}
          </span>
        )}
        {count != null && (
          <span>
            {countLabel} {count.toLocaleString()}
          </span>
        )}
        {item.h5Index != null && <span>h5 {item.h5Index}</span>}
      </div>
    </div>
  );
}

export default JournalListItemView;
