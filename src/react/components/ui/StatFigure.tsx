/**
 * StatFigure — 去壳数字位（hub-redesign-v2 §5.1，2026-09-10 批3 立法落地）。
 *
 * 取代 StatCard 在 A/B 形态页面的「卡」用法：卡内容 = 标签 + 数字 + 副行，
 * 纯排印信息装在 border+radius 容器里，带来 4×(边框+内边距) 的视觉税，而
 * 内部层级（标签 caption / 数字 display|title）本身已足够自明。去壳后：
 *
 *   标签（caption 灰）
 *   1,247  Δ12            ← 数字 tabular + ≥22px 负字距；Δ 徽标 meta 绿/灰
 *   ▓▓▓▓▓░░░░░            ← 可选 4px 细进度线（灰阶，非图表语义）
 *
 * 「最重要数字」由排印主位表达（display 级 + 栅格跨列），不再由品牌红染底
 * 宣告权重（宪法五：颜色只编码信息，不宣告权重）——StatCard 的 primary
 * 变体已于 v2 批1 废除（废法 #15）。
 *
 * 与 StatCard 的关系：StatCard 仍服务 Gallery 与 Usage 域（薄卡场景），
 * StatFigure 是 A/B 形态门面/仪表页的数字位；同一页不混用两制。
 *
 * @module react/components/ui/StatFigure
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export interface StatFigureDelta {
  /** Δ 徽标文本（如 "Δ12"）。箭头/字符形态由调用方决定（§5.6 徽标族）。 */
  text: React.ReactNode;
  /** 绿=增量，neutral=无变化/中性（跌不自动红——跌是中性还是异常由业务定）。 */
  tone?: "success" | "neutral";
}

interface StatFigureProps {
  /** 标签（caption 档，tertiary 灰）。 */
  label: React.ReactNode;
  /** 主数值（已格式化）。 */
  value: React.ReactNode;
  /** 数字字阶：display 22px（主位，跨列）/ title 15px（次位，并排）。 */
  size?: "display" | "title";
  /** Δ 增量徽标（可选）。 */
  delta?: StatFigureDelta;
  /** 0–1 的细进度线（省略即不渲染）。 */
  progress?: number;
  /** 额外 class（栅格跨列类 .col-* 由此传入）。 */
  className?: string;
}

function StatFigure({
  label,
  value,
  size = "title",
  delta,
  progress,
  className,
}: StatFigureProps): React.ReactElement {
  const isDisplay = size === "display";
  return (
    <div
      data-slot="stat-figure"
      className={cn("flex min-w-0 flex-col gap-[var(--space-1)]", className)}
    >
      <span className="[font:var(--ui-font-caption)] text-[color:var(--text-tertiary)] overflow-hidden text-ellipsis whitespace-nowrap">
        {label}
      </span>
      <span className="flex min-w-0 items-baseline gap-[var(--space-2)]">
        <span
          className={cn(
            // shrink-0：数值是本位信息，任何宽度下不许被挤压截断（真机 2026-09-15：
            // stats 输入 Token 被长 Δ 文案挤成「3…」——改由 Δ 承担收缩，数值恒完整）
            "shrink-0 tabular-nums text-[color:var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap",
            // §5.7：≥22px 数字配负字距（大字视觉收拢）——复用既有 --tracking-tight
            //（-0.3px，22px 下 ≈ -0.0136em，与立法目标 -0.01em 同量级），不另铸 token
            isDisplay
              ? "[font:var(--ui-font-display)] tracking-[var(--tracking-tight)]"
              : "[font:var(--ui-font-title)]",
          )}
        >
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              // Δ 徽标是辅助信息：宽度压力下允许截断（数值已 shrink-0 保真）
              "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap tabular-nums [font:var(--ui-font-meta)]",
              delta.tone === "success"
                ? "text-[color:var(--signal-green-dark)]"
                : "text-[color:var(--text-tertiary)]",
            )}
          >
            {delta.text}
          </span>
        )}
      </span>
      {typeof progress === "number" && (
        <span
          className="mt-[var(--space-0-5)] block h-[var(--space-1)] w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--hub-row-divider)]"
          aria-hidden="true"
        >
          <span
            className="block h-full bg-[var(--text-tertiary)]"
            style={{
              width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
            }}
          />
        </span>
      )}
    </div>
  );
}

export { StatFigure };
export default StatFigure;
