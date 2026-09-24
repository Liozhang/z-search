/**
 * ResultItem — single semantic search / find-similar result row.
 *
 * Shared between search and similar modes (both render `SearchResult[]`).
 * Extracted from the former SearchTab / SimilarTab to eliminate duplication;
 * the optional `query` enables snippet keyword highlighting (full-text only).
 *
 * @module react/components/Hub/search/Semantic/ResultItem
 */

import React from "react";
import { highlightText } from "../../../../utils/highlight";
import { getString } from "../../../../utils/locale";
import { escapeHtml } from "../../../../../utils/escapeHtml";
import { SearchResult } from "./types";
import { FileTextIconSvg } from "../../../../utils/icons";
import { Badge } from "@/components/ui/Badge";
import Button from "@/components/ui/button";

interface ResultItemProps {
  result: SearchResult;
  /** Search query used for snippet highlighting (full-text search only). */
  query?: string;
  onOpenItem: (itemID: number) => void;
  /**
   * JA-2（§30.2 文献条目出口「追踪」）：行内追踪动作，handler 在页面层
   * （LiteratureSearchPage，toast + 关注页出口都在那）。DOI 或标题皆缺时
   * 不渲染（无可用标识不假装可用）。
   */
  onTrack?: (result: SearchResult) => void;
  isTracking?: boolean;
}

/** 格式化 dateAdded 为年份（学术文献惯例显示年份） */
function formatYear(dateAdded?: string): string {
  if (!dateAdded) return "";
  const m = dateAdded.match(/\d{4}/);
  return m ? m[0] : "";
}

export function ResultItem({
  result,
  query,
  onOpenItem,
  onTrack,
  isTracking,
}: ResultItemProps): React.ReactElement {
  const open = () => onOpenItem(result.itemID);
  const year = formatYear(result.dateAdded);
  // BM25-only hits（hybrid/bm25 检索）没有 cosine，显示「0%」是误导——
  // 无分数时整个徽标隐藏；fusedScore 优先展示（RRF/归一 BM25 分）。
  const hasCosine = typeof result.similarity === "number";
  const similarity = hasCosine ? result.similarity! : 0;
  const similarityPct = (similarity * 100).toFixed(0);
  // JA-2：DOI 在 → 追踪论文引用；仅标题 → 主题追踪（tooltip 说实话）
  const canTrack = !!(result.doi || (result.title ?? "").trim());
  const trackTip = result.doi
    ? getString("semantic-track-paper-tip")
    : getString("semantic-track-topic-tip");
  return (
    <div
      /* v2 §4.5 批6：文献卡→文献行——去卡壳（border/radius/bg 三件）改行制：
         左缘 2px --data-blue 指示线 = 「这条在你的库里」的结构性标记（宪法四：
         结构线表达归属差异，替代「两种卡」的容器级差异），行线走
         --hub-row-divider，整行 hover 补回可点击性。
         信息零损失：题名/作者/年份/相似度本来就是文字，去的只是容器暗示。 */
      className="semantic-result-item focus-ring-subtle flex flex-row items-start gap-[var(--space-3)] pl-[var(--space-3)] pr-0 py-[var(--space-3)] border-l-2 border-l-[var(--data-blue)] border-t border-t-[var(--hub-row-divider)] cursor-pointer transition-colors duration-[var(--transition-fast)] hover:bg-[var(--hub-bg-hover)]"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      {/* 论文图标缩略图（对齐 mockup 的 result-thumb） */}
      <span
        className="semantic-result-thumb w-[var(--space-8)] h-[var(--space-8)] rounded-[var(--radius-sm)] bg-[var(--hub-bg-hover)] text-[color:var(--text-tertiary)] grid place-items-center flex-shrink-0 [&_svg]:w-[var(--icon-base)] [&_svg]:h-[var(--icon-base)]"
        aria-hidden="true"
      >
        <FileTextIconSvg />
      </span>
      <div className="semantic-result-content flex-1 min-w-0 flex flex-col gap-[var(--space-1)]">
        <div className="semantic-result-main flex items-center gap-[var(--space-2)]">
          {/* 2026-08-31 C3：库内标题去截断（nowrap/ellipsis/overflow-hidden）改自然换行——
              与外部卡（LiteratureResultCard break-words）一致，原型无标题截断 */}
          <span className="semantic-result-title flex-1 font-[family-name:var(--ui-family-display)] font-[var(--font-weight-semibold)] text-[length:var(--text-base)] text-[color:var(--text-primary)]">
            {result.title ||
              getString("semantic-item-fallback", {
                args: { itemId: result.itemID },
              })}
          </span>
          {/* 匹配分数 badge（对齐 mockup 的 match-score）；无 cosine 时隐藏 */}
          {hasCosine && (
            <Badge
              tone={
                similarity >= 0.85
                  ? "success"
                  : similarity >= 0.7
                    ? "info"
                    : "neutral"
              }
              className="semantic-result-score flex-shrink-0"
            >
              {similarityPct}%
            </Badge>
          )}
        </div>
        {/* 元数据行：类型 · 年份 · 章节（仅有数据的才显示，对齐 mockup 的 authors 行） */}
        {(result.type || year || result.sectionName) && (
          <div className="semantic-result-meta flex flex-wrap gap-[var(--space-1-5)] text-[length:var(--text-2xs)] text-[color:var(--text-tertiary)]">
            {result.type && <span>{result.type}</span>}
            {year && <span>{year}</span>}
            {result.sectionName && <span>{result.sectionName}</span>}
          </div>
        )}
        {result.snippet && (
          <div
            className="semantic-result-snippet text-[length:var(--text-xs)] text-[color:var(--text-secondary)] leading-[var(--leading-normal)] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden"
            dangerouslySetInnerHTML={{
              __html: highlightText(escapeHtml(result.snippet), query ?? ""),
            }}
          />
        )}
      </div>
      {/* JA-2 行内追踪动作：整行是 role=button 的打开热区，此槽 stopPropagation
          隔离 click/keyboard，避免「追踪」误触发行打开 */}
      {onTrack && canTrack && (
        <span
          className="semantic-result-track flex-shrink-0 self-start"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="xs"
            loading={isTracking}
            disabled={isTracking}
            tooltip={trackTip}
            ariaLabel={getString("semantic-track-action")}
            onClick={() => onTrack(result)}
          >
            {getString("semantic-track-action")}
          </Button>
        </span>
      )}
    </div>
  );
}

export default ResultItem;
