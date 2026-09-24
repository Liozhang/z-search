/**
 * toggle-group.tsx — shadcn/ui ToggleGroup（官方 v4 形态，Base UI 底座）+ filter variant.
 *
 * ToggleGroup 来自 @base-ui/react/toggle-group。受控 API：value 为 string[]
 * （multiple=false 时长度为 0 或 1），onValueChange 接收数组。
 *
 * ToggleGroupItem 以 @base-ui/react/toggle 的 Toggle 为根：点击经
 * ToggleGroupContext.setGroupValue 上报，onValueChange 由此触发；aria-pressed
 * 与 group disabled 由 context 自动下发（context 从
 * @base-ui/react/toggle-group/ToggleGroupContext 子路径导出）。
 *
 * default 变体 = 原型 .seg 分段控件（v1.70 2026-08-26 用户裁决）：无边框 5% 黑轨道
 * （--hub-bg-hover）+ 白片选中。业务消费者：SearchPane 文献/期刊视图切换
 * （2026-08-26 用户裁决 pill→seg 起）；画廊另有陈列。
 * filter variant：用于 GraphFilterDialog 等筛选场景，去盒描边 chip + 选中黑底白字
 * （§5.4 唯一法定筛选形态）。CSS 规则在 leadero-hub.css [data-variant="filter"]。
 *
 * @module react/components/ui/toggle-group
 */

import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import { cn } from "@/lib/utils";

const ToggleGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof ToggleGroupPrimitive> & {
    /** 视觉变体：filter = 紧凑筛选按钮组（分段控件风格） */
    variant?: "default" | "filter";
  }
>(({ className, variant = "default", ...props }, ref) => {
  const variantAttrs =
    variant === "filter" ? { "data-variant": "filter" as const } : {};
  return (
    <ToggleGroupPrimitive
      ref={ref}
      data-slot="toggle-group"
      {...variantAttrs}
      className={cn(
        /* default 变体 = 原型 .seg（v1.70 用户裁决 2026-08-26「照原型：无边框+轨道」）：
           轨道 = --surface-zone（v3 批 2 材质角色法：静态轨道是材质不是 hover——
           stone-100 功能带，与 5% 黑灯罩语义分轨），padding 3px(--space-0-75) +
           gap 2px(--space-0-5) + 控件族圆角；高度由 item 撑（原型无固定容器高）。
           2026-08-30 token 审计批：3px/2px 裸值归位（同 tabs v1.56 先例）。 */
        "group inline-flex items-center justify-center gap-[var(--space-0-5)] rounded-[var(--radius-btn)] bg-[var(--surface-zone)] p-[var(--space-0-75)]",
        className,
      )}
      {...props}
    />
  );
});
ToggleGroup.displayName = "ToggleGroup";

interface ToggleGroupItemProps extends Omit<
  React.ComponentProps<typeof Toggle>,
  "value" | "onPressedChange" | "onClick"
> {
  value: string;
  /** @deprecated 选中视觉已由 Base UI 的 data-pressed 属性单源驱动
   *  （v1.53 2026-08-24 审计：isSelected 冗余——受控组的 value 经 context
   *  下发即决定 pressed，再手传一份是双轨状态）。仅为未迁移调用点保留，
   *  新代码勿传。 */
  isSelected?: boolean;
  /** 可选圆点指示器颜色（CSS var 或 hex），用于知识类型/层级等带色彩语义的筛选。 */
  dotColor?: string;
}

const ToggleGroupItem = React.forwardRef<
  HTMLButtonElement,
  ToggleGroupItemProps
>(
  (
    { value, children, className, disabled, isSelected, dotColor, ...props },
    ref,
  ) => {
    // v1.53 2026-08-24：长标签防御——文本裹 truncate span（配合 filter 变体的
    // max-width 走 ellipsis），字符串子节点自动补 hover title 揭示全文。
    const autoTitle =
      typeof children === "string" && props.title === undefined
        ? children
        : undefined;
    return (
      <Toggle
        ref={ref}
        value={value}
        data-slot="toggle-group-item"
        disabled={disabled}
        className={cn(
          /* 原型 .seg-item（v1.70）：14px 控件档 / 边框透明占位（选中显 --border-strong，
             原型 line-strong 语义）/ 内距 5px 12px / 圆角 4px 档；
             选中 = 白片 + ink + 500 字重（未选中 400，原型 .on 才加 weight）。 */
          "inline-flex items-center justify-center gap-[var(--space-1-5)] whitespace-nowrap rounded-[var(--radius-sm)] border border-transparent bg-none px-3 py-[5px] text-[length:var(--text-control)] text-muted-foreground transition-all",
          // §1.5 ring 立法（2026-08-31 C5）：focus-visible 环单法 ring-[3px] ring-ring（button.tsx:26 范式，去 offset）
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          "data-pressed:border-[var(--border-strong)] data-pressed:bg-background data-pressed:font-medium data-pressed:text-foreground",
          isSelected
            ? "border-[var(--border-strong)] bg-background font-medium text-foreground"
            : "",
          className,
        )}
        {...props}
        title={autoTitle}
      >
        {dotColor && (
          <span
            className="size-[var(--hub-dot-size)] rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
          />
        )}
        <span className="truncate">{children}</span>
      </Toggle>
    );
  },
);
ToggleGroupItem.displayName = "ToggleGroupItem";

export { ToggleGroup, ToggleGroupItem };
export default ToggleGroup;
