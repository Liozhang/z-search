/**
 * checkbox.tsx — shadcn/ui Checkbox（官方 v4 形态，Base UI 底座，leadero 受控 API）。
 *
 * 类串对齐 v4.shadcn.com 注册表；官方的 data-[state=checked]: 选择器翻译为
 * Base UI 的 data-checked: 属性。对外受控 API（checked / onChange(boolean)）
 * 冻结不变——消费点零改动。
 *
 * Base UI 自带：WAI-ARIA checkbox 模式（Space/Enter 切换、表单提交、
 * indeterminate 支持）。
 *
 * @module react/components/ui/checkbox
 */

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface CheckboxProps {
  /** 当前是否选中（受控）。 */
  checked: boolean;
  /** 半选态：显示横线（原型 .cbx.ind），点按后进入选中。Base UI Root 原生支持。 */
  indeterminate?: boolean;
  /** 选中状态变化回调，直接收新的 boolean 值。 */
  onChange: (checked: boolean) => void;
  /** 禁用（不可交互）。 */
  disabled?: boolean;
  /** className 透传到 Root，与官方类串合并。 */
  className?: string;
  /** 关联 label 的 id（设置隐藏 input 的 id）。 */
  id?: string;
  /** 点击事件透传（用于表格行内复选框阻止事件冒泡等场景）。 */
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  /** aria-label（无可见文本时用于可访问名）。 */
  "aria-label"?: string;
}

function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  disabled = false,
  className,
  id,
  onClick,
  "aria-label": ariaLabel,
}: CheckboxProps): React.ReactElement {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      checked={checked}
      indeterminate={indeterminate}
      onCheckedChange={(next) => onChange(next)}
      disabled={disabled}
      id={id}
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "peer size-4 shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-input transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:data-checked:bg-primary",
        className,
      )}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        {/* 半选 = 8×2 白横线（原型 .cbx.ind）；选中 = 勾。
            v1.56：勾 14→12px——14px 在 16px 盒内四边仅 1px 呼吸（顶格）；12px 恢复 2px/边 */}
        {indeterminate && !checked ? (
          <span className="h-[2px] w-2 bg-current" />
        ) : (
          <CheckIcon className="size-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
