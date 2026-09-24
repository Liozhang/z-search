/**
 * Badge.tsx — Tailwind 化的 leadero Badge（保留 tone/size/spinner/pulse API）。
 *
 * 由原 CSS 类实现迁移：leadero-badge--* CSS 类 → Tailwind 工具类。
 * 对外 API 完全不变（tone/size/spinner/pulse/title/className），
 * 19 个消费端零改动。
 *
 * Tones: neutral | info | success | warning | danger | brand
 * Size: sm (default) | md
 *
 * @module react/components/ui/Badge
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

export type BadgeTone =
  "neutral" | "info" | "success" | "warning" | "danger" | "brand";
export type BadgeSize = "sm" | "md";

interface BadgeProps {
  /** Semantic color. neutral=gray, info=blue, success=green, warning=yellow, danger=red, brand=red-brand. */
  tone?: BadgeTone;
  /** Badge size. sm (default), md. */
  size?: BadgeSize;
  /** Optional leading spinner (e.g. for 'running'/'mining' states). */
  spinner?: boolean;
  /** Optional tooltip title attribute. */
  title?: string;
  className?: string;
  children: React.ReactNode;
}

// tone → Tailwind 颜色映射（bg-X/10 + text-X 柔和色调，与原 leadero-badge 视觉一致）
const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  // warning 特例：--signal-yellow 直接做文字在浅底仅 ~2.2:1，用专用的
  // --signal-yellow-text（亮 amber-11 #ab6400 / 暗 #ffca16，tokens.css 带 AA 注释）
  warning: "bg-warning/10 text-[var(--signal-yellow-text)]",
  danger: "bg-destructive/10 text-destructive",
  // v1.44：brand tone 改走品牌红 token（原 --primary tint 随单色化会变黑）
  brand: "bg-[color:var(--accent-tint)] text-[color:var(--accent)]",
};

function Badge({
  tone = "neutral",
  size = "sm",
  spinner = false,
  title,
  className,
  children,
}: BadgeProps): React.ReactElement {
  return (
    <span
      data-slot="badge"
      title={title}
      className={cn(
        // v1.65 四级梯子（§19.3）：徽标 → radius-sm 4px 小件档
        // （2026-09-07 W3-A3：rounded-[var(--radius-sharp)] 旧法退役，与 checkbox 对齐）
        "inline-flex max-w-full items-center gap-1 overflow-hidden rounded-[var(--radius-sm)] border border-transparent font-medium transition-colors",
        TONE_CLASS[tone],
        size === "sm"
          ? "px-2 py-0.5 text-[length:var(--text-3xs)]"
          : "px-2.5 py-0.5 text-xs",
        className,
      )}
    >
      {spinner && <Spinner size={size === "md" ? 12 : 10} />}
      {children}
    </span>
  );
}

export { Badge };
export default Badge;
