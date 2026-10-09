/**
 * JournalListItem — compact row for modes 'discover' and 'library'.
 *
 * 2026-10-09 用户裁决：期刊行并入文献行（LiteratureResultCard）的视觉语法，
 * 两种列表一套容器语言——行制容器（底线制 + hover 沉纸）、刊名升文献 title
 * 档 + 检索词命中品牌红、质量徽章独立成行走共享壳配方（../badgeRecipes），
 * 指标行保持 text-xs 次级。行序对齐文献徽章行：预警/掠夺 → JCR → 中科院 → Top。
 *
 * @module react/components/Hub/search/JournalSearch/JournalListItem
 */

import React from "react";
import { getString } from "../../../../utils/locale";
import type { JournalListItem } from "../../../../../types/journalSearch";
import { formatQuartile } from "./types";
import { ChevronRightIconSvg } from "../../../../utils/icons";
import { ICON } from "../../../../utils/iconSizes";
import { highlightSegments } from "../../../../utils/highlight";
import {
  TAG_BASE,
  TAG_KIND,
  QUARTILE_STYLE,
  QUARTILE_DOT,
} from "../badgeRecipes";

interface JournalListItemProps {
  item: JournalListItem;
  /** Which count to surface — 'works' (OpenAlex) for discover, 'library' for library mode. */
  countKind: "works" | "library";
  /** 当前检索词——刊名命中片段以品牌红呈现（文献行 `.q` 条款同款）。缺省不高亮。 */
  query?: string;
  onClick?: (name: string, issn?: string) => void;
}

export function JournalListItemView({
  item,
  countKind,
  query,
  onClick,
}: JournalListItemProps): React.ReactElement {
  const count = countKind === "works" ? item.worksCount : item.libraryCount;
  const countLabel =
    countKind === "works"
      ? getString("journal-works-count-label")
      : getString("journal-library-count-label");
  const hasBadges = !!(
    item.warningLevel ||
    item.isPredatory ||
    item.jifQuartile ||
    item.cassQuartile != null ||
    item.cassIsTop
  );

  return (
    /* 容器与文献行同语法（LiteratureResultCard 卡壳）：底线制
       --hub-row-divider + 整行 hover 沉纸 + py space-3 行节奏；无选中态
       （期刊行无 selection 概念），故不带左缘指示条。 */
    <div
      className="flex flex-col gap-[var(--space-1)] py-[var(--space-3)] px-0 bg-transparent border-0 border-b border-b-[var(--hub-row-divider)] rounded-none cursor-pointer transition-colors duration-[var(--transition-fast)] hover:bg-[var(--hub-bg-hover)]"
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
      {/* 行1：刊名（文献 title 档：--text-base/600/--ui-family-display/tight）
          + 检索词命中品牌红 + 行尾常驻淡墨 chevron 示能（砚法 §8.3、§10.1：
          hover 沉纸只许做强化，不得作为唯一示能）。单行省略保留——期刊名
          长度差异大，列表扫读需要等高行。 */}
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <span className="text-[length:var(--text-base)] font-[var(--font-weight-semibold)] font-[family-name:var(--ui-family-display)] text-[color:var(--text-primary)] leading-[var(--leading-tight)] overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {highlightSegments(item.name, query ?? "").map((seg, i) =>
            seg.hit ? (
              <span key={i} className="text-[color:var(--accent)]">
                {seg.text}
              </span>
            ) : (
              <React.Fragment key={i}>{seg.text}</React.Fragment>
            ),
          )}
        </span>
        {onClick && (
          <ChevronRightIconSvg
            size={ICON.sm}
            aria-hidden="true"
            className="text-[color:var(--ink-heavy)] shrink-0"
          />
        )}
      </div>
      {/* 行2：质量徽章——文献行徽章语法（../badgeRecipes 单源）：
          风险红壳 → 分区白底发丝边+蓝点 → Top 黄壳。无徽章不渲染整行。 */}
      {hasBadges && (
        <div className="flex flex-wrap items-center gap-[var(--space-1-5)]">
          {item.warningLevel && (
            <span className={`${TAG_BASE} ${TAG_KIND.warning}`}>
              ⚠ {getString("journal-warning-label")}
            </span>
          )}
          {item.isPredatory && (
            <span
              className={`${TAG_BASE} ${TAG_KIND.predatory}`}
              title={getString("journal-predatory-data-year")}
            >
              {getString("journal-predatory-label")}
            </span>
          )}
          {item.jifQuartile && (
            <span
              className={`${TAG_BASE} ${QUARTILE_STYLE}`}
              title={`${getString("journal-jif-label")} ${formatQuartile(item.jifQuartile)}`}
            >
              <span aria-hidden="true" className={QUARTILE_DOT} />
              {formatQuartile(item.jifQuartile)}
            </span>
          )}
          {item.cassQuartile != null && (
            <span className={`${TAG_BASE} ${QUARTILE_STYLE}`}>
              <span aria-hidden="true" className={QUARTILE_DOT} />
              {formatQuartile(item.cassQuartile)}
            </span>
          )}
          {item.cassIsTop && (
            <span className={`${TAG_BASE} ${TAG_KIND.top}`}>
              {getString("lit-top")}
            </span>
          )}
        </div>
      )}
      {/* 行3：指标行——ISSN / IF / 收录与发文量 / h5 指数，gap 归
          --space-2 对齐文献 meta 行。 */}
      <div className="flex items-center gap-[var(--space-2)] flex-wrap text-[length:var(--text-xs)] text-[color:var(--text-secondary)]">
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
