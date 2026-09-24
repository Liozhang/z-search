/**
 * EmptyState.tsx — Tailwind 化的空/加载状态组件。
 *
 * 由原 leadero-empty-* CSS 类迁移为 Tailwind 工具类（hub-redesign 形态：虚线框卡）。
 * 对外 API 完全不变
 * （icon/title/desc/className/children/busy），30 个消费端零改动。
 *
 * 语义区分（WAI-ARIA）：默认 = "无数据"（role=status，无 aria-busy）；
 * 传 `busy` = "加载中"（aria-busy=true，让 AT 正确读作忙碌而非空）。
 *
 * @module react/components/ui/EmptyState
 */

import * as React from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Icon node (SVG, spinner, etc.) */
  icon?: React.ReactNode;
  /** Title text */
  title?: React.ReactNode;
  /** Description text */
  desc?: React.ReactNode;
  /** Additional className for the wrapper */
  className?: string;
  /** Arbitrary extra content rendered after desc (tips, buttons, etc.) */
  children?: React.ReactNode;
  /** 标记为加载中状态（aria-busy=true），用于 spinner 占位场景，区分于"无数据" */
  busy?: boolean;
}

function EmptyState({
  icon,
  title,
  desc,
  className,
  children,
  busy = false,
}: EmptyStateProps): React.ReactElement {
  return (
    <div
      data-slot="empty-state"
      /* 砚法 §4.2 域声明（v1.48 审计收口 §15-94）：空态=墨域特权区（§8.6
         计白当黑，禁语义色/彩色插画），执法归 check-domain-style */
      data-domain="ink"
      className={cn(
        // v1.44 原子批：空态去盒（§23 融合——容器不存在，聚焦留白承担引导）
        "flex flex-col items-center justify-center gap-1.5 py-[26px] text-center",
        className,
      )}
      role="status"
      aria-busy={busy || undefined}
    >
      {icon && (
        <div className="text-muted-foreground flex shrink-0 items-center justify-center mb-[var(--space-1)] [&>svg]:size-7">
          {icon}
        </div>
      )}
      {title && (
        <div className="text-foreground text-[length:var(--text-sm)] font-medium">
          {title}
        </div>
      )}
      {desc && (
        // 2026-09-02 用户拍板全对齐原型：desc 12px（原型 .empty .e-desc，redesign-prototype:434）；
        // --text-xs 已归 meta 11px（v1.70），独立保 12 同 chip/btn-sm 家族先例，
        // 白名单登记见 scripts/check-font-ladder.cjs TSX_WHITELIST。
        // 2026-09-09 值级偏差登记：原型 max-width:36ch 是拉丁计宽（ch="0"宽），
        // CJK 每字≈2ch → 实效上限 ~18 字，触发孤字断行（实锤「…导入 / Zotero」）。
        // 改 28em（12px 基线 = 336px ≈ 28 个汉字），容器更窄时仍由容器收口。
        <div className="text-muted-foreground max-w-[28em] text-[12px]">
          {desc}
        </div>
      )}
      {children}
    </div>
  );
}

export { EmptyState };
export default EmptyState;
