/**
 * DuplicateGroupItem — one duplicate-group row (primary item + its duplicate ids).
 *
 * Extracted from the former DuplicatesTab. Pure presentational; the parent owns
 * the duplicate list and open-item callback.
 *
 * @module react/components/Hub/search/Semantic/DuplicateGroupItem
 */

import React from "react";
import { getString } from "../../../../utils/locale";
import Button from "@/components/ui/button";
import { DuplicateGroup } from "./types";

interface DuplicateGroupItemProps {
  group: DuplicateGroup;
  onOpenItem: (itemID: number) => void;
}

export function DuplicateGroupItem({
  group,
  onOpenItem,
}: DuplicateGroupItemProps): React.ReactElement {
  return (
    <div className="semantic-duplicate-group flex flex-col gap-[var(--space-0-5)] px-[var(--space-2-5)] py-[var(--space-2)] rounded-[var(--radius-md)]">
      {/* block：span 非 block 化则 overflow/text-overflow 不生效（inline 盒忽略），
          死类 semantic-duplicate-* 在 CSS 零定义兜不了底 → 长标题顶出检索页
          横向滚动条（2026-09-07 布局审计 P2，违 pane 禁横滚立法）
          2026-09-20 砚法批：重复组=警示不是危险（§5.3 功能表唯一，语义红只归
          danger）——主标题 danger 红字退役回 text-primary，重复度信号改 warn
          色点+字（§8.3 状态点字法；文字自带「+N 个重复项」，颜色非唯一通道
          §10.5）；相似度百分数保持 meta 淡档 + tabular-nums（§8.3）。 */}
      <span className="semantic-duplicate-main flex items-center gap-[var(--space-1-5)] min-w-0 font-[var(--font-weight-semibold)] text-[length:var(--text-base)] text-[color:var(--text-primary)]">
        <span
          aria-hidden="true"
          className="inline-block w-[var(--hub-dot-size)] h-[var(--hub-dot-size)] rounded-full bg-[var(--signal-yellow)] shrink-0"
        />
        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {getString("semantic-duplicate-item", {
            args: { title: group.title, count: group.duplicateIDs.length },
          })}
        </span>
        <span className="semantic-duplicate-confidence shrink-0 text-[length:var(--text-xs)] font-[var(--font-weight-normal)] text-[color:var(--text-secondary)] [font-variant-numeric:tabular-nums]">
          {(typeof group.confidence === "number"
            ? group.confidence * 100
            : 0
          ).toFixed(0)}
          %
        </span>
      </span>
      <span className="semantic-duplicate-ids flex flex-wrap gap-[var(--space-1)] overflow-hidden text-[length:var(--text-2xs)] text-[color:var(--text-secondary)]">
        <Button
          variant="ghost"
          size="sm"
          className="semantic-duplicate-id-btn"
          onClick={() => onOpenItem(group.itemID)}
        >
          #{group.itemID}
        </Button>
        {group.duplicateIDs.map((dupID, idx) => (
          <React.Fragment key={dupID}>
            {idx > 0 && <span className="semantic-duplicate-id-sep">,</span>}
            <Button
              variant="ghost"
              size="sm"
              className="semantic-duplicate-id-btn"
              onClick={() => onOpenItem(dupID)}
            >
              #{dupID}
            </Button>
          </React.Fragment>
        ))}
      </span>
    </div>
  );
}

export default DuplicateGroupItem;
