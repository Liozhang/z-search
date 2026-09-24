/**
 * select.tsx — shadcn/ui Select 官方形态（Base UI 底座，保留 leadero
 * options/value/onChange 受控 API）。
 *
 * 类串对齐 v4.shadcn.com 注册表（trigger bg-background/shadow-xs + focus
 * ring-[3px]——v1.72 前为 bg-transparent，灰底白卡批改 raised 白；content
 * bg-popover/rounded-md/shadow-md；item rounded-sm +
 * 绝对定位 right-2 勾选指示）。官方 data-[state]/focus: 状态翻译为 Base UI
 * 的 data-[highlighted] 等。Portal 经 useReuiPortal 注入 `.leadero-root` 作用域。
 *
 * leadero 偏离（登记 spec §17）：
 *   - 保留受控 options/value/onChange(string) API（消费点冻结）
 *   - 触发器高度 h-7=28 单档（v1.70 用户裁决 2026-08-26 照原型 .sel=28；
 *     原 32/28 双档分界退役；size prop 保留但不再影响高度）
 *
 * @module react/components/ui/select
 */

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useReuiPortal } from "@/components/ui/reui-portal";
import { selectRootValue, selectTriggerLabel } from "./selectValue";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  /** 当前选中值（string，与原生 select 一致）。 */
  value: string;
  /** 值变化回调。 */
  onChange: (value: string) => void;
  /** className 透传到 Trigger（保持现有视觉类名）。 */
  className?: string;
  /** aria-label（无可见 label 时必需）。 */
  ariaLabel?: string;
  /** 禁用。 */
  disabled?: boolean;
  /** 占位符（未选中时显示）。 */
  placeholder?: string;
  /** 触发器尺寸：v1.70 用户裁决（2026-08-26）照原型 .sel=28 单档——size prop 保留
   *  API 兼容但不再改变高度（原型 .input=32 与 .sel=28 本不齐，接受该形态）。 */
  size?: "sm" | "default";
}

function Select({
  options,
  value,
  onChange,
  className,
  ariaLabel,
  disabled,
  placeholder,
  size = "default",
}: SelectProps): React.ReactElement {
  const portalContainer = useReuiPortal();

  return (
    <SelectPrimitive.Root
      /* 空值语义见 selectValue.ts（2026-09-16 真机缺陷修复：空值选项此前被
         当成「未选中」，触发器只剩 chevron 空壳）。 */
      value={selectRootValue(value, options)}
      onValueChange={(next) => {
        // null=未选（清空）；转回空字符串与原生 select 行为一致。
        onChange((next as string) ?? "");
      }}
      items={options}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        data-size={size}
        className={cn(
          // v1.73（2026-08-26 用户裁决，原型 .sel 内联制）：触发器改内容自适应宽
          // （inline-flex + w-fit；w-fit 防 grid 单元格 stretch 拉伸，去 w-full）。
          // 需要撑满容器的消费点显式传 className="w-full"（cn=tailwind-merge，外部类后写胜）。
          // 2026-09-02 值级批：内距 px-3(12/12)→右10左12 归位原型 :374 .sel
          // （hub-overrides Settings 专属覆写已随之退役）。
          // bg-background（v1.72 灰底白卡批）：触发器=控件面=raised 白（spec §19.2），
          // 理由同 input.tsx 头注——透明底在画布上丢失控件供能。
          "inline-flex h-7 w-fit items-center justify-between gap-2 rounded-[var(--radius-btn)] border border-input bg-background pl-[var(--space-3)] pr-[var(--space-2-5)] py-2 text-[length:var(--text-control)] whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
          className,
        )}
        aria-label={ariaLabel}
      >
        <SelectPrimitive.Value data-slot="select-value">
          {(val: string | null) =>
            selectTriggerLabel(val, options, placeholder)
          }
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon className="text-muted-foreground">
          <ChevronDownIcon className="size-4 opacity-50" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={portalContainer?.current ?? undefined}>
        <SelectPrimitive.Positioner
          data-slot="select-positioner"
          sideOffset={4}
          className="relative z-dropdown"
        >
          <SelectPrimitive.Popup
            data-slot="select-content"
            /* v1.63 C2 同族修：宽度锁 --anchor-width（同 combobox.tsx）——此前
               弹层宽度=最长选项单行 max-content，Lens 的 inquiry 选项是
               「#id · 研究问题」（动辄百字符），点开横贯整个面板。
               box-border 防 border+padding 外溢（preflight 关闭）。 */
            className="relative z-dropdown max-h-[min(var(--available-height),384px)] box-border w-[var(--anchor-width)] min-w-[180px] overflow-x-hidden overflow-y-auto rounded-[var(--card-radius)] border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-md)] outline-none"
          >
            <SelectPrimitive.List>
              {options.map((opt) => (
                <SelectPrimitive.Item
                  key={opt.value}
                  value={opt.value}
                  data-slot="select-item"
                  title={opt.label}
                  /* 2026-09-04 content-box 审计：item w-full+pl/pr 在 content-box 下
                     外溢 40px，被弹层 overflow-x-hidden 裁——选中勾号（right-2）
                     整个出画不可见；box-border 归位（preflight 关无全局 border-box） */
                  className="relative flex box-border w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-[length:var(--text-control)] outline-hidden select-none data-[highlighted]:bg-[var(--hub-bg-hover)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2"
                >
                  <span
                    data-slot="select-item-indicator"
                    className="absolute right-2 flex size-3.5 items-center justify-center"
                  >
                    <SelectPrimitive.ItemIndicator>
                      <CheckIcon className="size-4" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  {/* v1.63 C2：锁宽配套——长选项截两行防文字墙，悬停 title 看全文 */}
                  <SelectPrimitive.ItemText
                    data-slot="select-item-text"
                    className="min-w-0 flex-1 line-clamp-2"
                  >
                    {opt.label}
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { Select };
