/**
 * scroll-area.tsx — shadcn/ui ScrollArea（官方 v4 形态，Base UI 底座）。
 *
 * 类串对齐 v4.shadcn.com 注册表（viewport 焦点环 + thumb bg-border）；
 * 保留 overflow-hidden（圆角裁剪）。内容必须放在 Viewport 内——它是唯一
 * overflow:scroll 的元素，自定义 ScrollBar 靠测量它的滚动几何定位 thumb。
 *
 * @module react/components/ui/scroll-area
 */

import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "@/lib/utils";

function ScrollArea({
  className,
  /** 预留竖向滚动条槽（scrollbar-gutter: stable 的自绘等价）：Base UI 的
   *  thumb 是 overlay（w-2.5=10px），不留槽会骑进内容列、与右缘交互件
   *  贴死（2026-09-16 审计 L1：搜索页导入按钮实测间隙 ≤2px）。显式
   *  opt-in，存量消费方零回归。 */
  reserveGutter = false,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  reserveGutter?: boolean;
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-1",
          reserveGutter && "pr-[var(--space-2-5)]",
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
export default ScrollArea;
