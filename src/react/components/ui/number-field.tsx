/**
 * number-field.tsx — shadcn Base UI NumberField（保留 leadero 受控 API）。
 *
 * 基于 @base-ui/react/number-field，对外提供受控 API
 * （value: number | null / onChange: (v: number | undefined) => void），
 * 与旧 baseui/NumberField 完全一致——消费点迁移仅需改 import 路径。
 *
 * 旧 baseui/NumberField 用法：
 *   <NumberField min={0} max={2} step={0.1} value={v} onChange={setV} onBlur={commit} />
 * 本组件用法（相同）：
 *   <NumberField min={0} max={2} step={0.1} value={v} onChange={setV} onBlur={commit} />
 *
 * 视觉：Input 类串对齐官方 v4 input.tsx（h-8 与 Input 等高，圆角统一
 * var(--radius-btn)，登记 spec §17）。
 * 消费端既有 className（如 .leadero-form-input / .hub-settings-form-input）
 * 直接透传到 Input，命中既有 CSS 选择器，视觉零变化。
 *
 * @module react/components/ui/number-field
 */

import * as React from "react";
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { cn } from "@/lib/utils";

export interface NumberFieldProps {
  /** 当前数值。null/undefined 表示空。 */
  value: number | null;
  /** 值变化回调；清空时为 undefined（归一自 Base UI 的 null）。 */
  onChange: (value: number | undefined) => void;
  /** 最小值。 */
  min?: number;
  /** 最大值。 */
  max?: number;
  /** 步进（默认 1）。 */
  step?: number;
  /** 禁用。 */
  disabled?: boolean;
  /** className 透传到 Input（非 Root），与 Tailwind 基线类合并。 */
  className?: string;
  /** placeholder。 */
  placeholder?: string;
  /** input 元素 id（关联 label）。 */
  id?: string;
  /** 失焦回调（消费端常用于提交 draft 到 pref）。 */
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  /** 键盘回调（消费端常用于 Enter 触发 blur 以提交）。 */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  /** aria-label。 */
  "aria-label"?: string;
}

function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  disabled = false,
  className,
  placeholder,
  id,
  onBlur,
  onKeyDown,
  "aria-label": ariaLabel,
}: NumberFieldProps): React.ReactElement {
  return (
    <NumberFieldPrimitive.Root
      data-slot="number-field"
      value={value}
      onValueChange={(next) => onChange(next ?? undefined)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      // Editable identifier-ish numbers (years, ports, intervals) must not
      // render with thousands grouping ("2,017" / "23,124") — disable the
      // primitive's default locale grouping for every consumer.
      format={{ useGrouping: false }}
    >
      <NumberFieldPrimitive.Input
        data-slot="number-field-input"
        className={cn(
          "h-8 w-full min-w-0 rounded-[var(--radius-btn)] border border-input bg-background px-3 py-1 text-[length:var(--text-control)] transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          // 2026-08-31 修复批 C1：删无效 md:text-sm（视口断点永不触发）；字号统一
          // --text-control(14px)，与 Input 控件档同律（原 text-base=16px + md:text-sm 双轨）。
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          className,
        )}
        placeholder={placeholder}
        id={id}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel}
      />
    </NumberFieldPrimitive.Root>
  );
}

export { NumberField };
