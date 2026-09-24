/**
 * button.tsx — shadcn/ui Button（官方 v4 形态，Base UI 底座）+ leadero 扩展 props。
 *
 * cva 类串逐字对齐 v4.shadcn.com 注册表（含 xs / icon-xs / icon-sm / icon-lg
 * 官方尺寸与 data-variant / data-size 标记）。
 *
 * leadero 扩展（消费点 API 冻结，见 ui/README.md）：
 *   - icon / loading / loadingText / tooltip / ariaLabel / render
 *   - render ≈ 官方 asChild（Base UI 的多态模式）
 *   - data-slot="button" 必须保留：leadero-layout.css 的 XUL reset 以
 *     button:not([data-slot]) 剥掉 padding/border/background。
 *
 * @module react/components/ui/button
 */

import * as React from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { ICON } from "../../utils/iconSizes";

const buttonVariants = cva(
  // v1.43：active:scale-[0.97] 拟物按压微动效移除（Flat §19 反位移精神；反馈走 hover 背景叠层）
  "appearance-none box-border inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius-btn)] text-[length:var(--text-control)] font-medium whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          // v1.44 原子批：outline 去 shadow-xs（§19.1 法则 2 静态控件零投影）
          // 审计 2026-08-31：裸 border 曾跌 currentColor/UA ButtonBorder，显式
          // --border-strong 对齐原型 .btn-outline（1px line-strong）。
          "border border-[color:var(--border-strong)] bg-background hover:bg-[var(--hub-bg-hover)] dark:border-input dark:bg-input/30",
        // v1.46 用户裁决「不满意各种立体灰按钮」：灰实心变体非法——secondary 重定义为 ghost 同形
        // （语义槽位保留兼容存量引用，渲染退化为无边框文字钮）。
        // v1.52（2026-08-22 审计批 S3）：ghost/outline hover 收敛 --hub-bg-hover 单通道
        // （§23.4 反馈=灯罩唯一；原 bg-accent 实心 stone-100 与 5% 黑灯罩双制并存），
        // token 自带暗色值（8% 白），dark: 覆盖不再需要。
        // v1.58 实证修复：补显式 bg-transparent——preflight 关闭 + layout reset 曾排除
        // data-slot，裸 <button> 渲染 UA 灰色按钮面（实机截图铁证）；layout 层已同步修复，
        // 此处显式声明为双保险。
        // 审计 2026-08-31（用户拍板）：ghost 补 1px --border-strong 回原型 .btn-ghost
        // （kit §1 行内动作形态）；secondary 与 ghost 同形（v1.46 裁决）同步补边。
        secondary:
          "border border-[color:var(--border-strong)] bg-transparent hover:bg-[var(--hub-bg-hover)]",
        ghost:
          "border border-[color:var(--border-strong)] bg-transparent hover:bg-[var(--hub-bg-hover)]",
        link: "bg-transparent text-[color:var(--foreground)] underline-offset-4 hover:underline",
        // v1.73（2026-08-26 用户裁决，原型 kit 第六变体 btn-danger-ghost）：透明底红字，
        // 行内危险动作（移除/两步确认触发）；收编 ghost + text-destructive 手写散装组合。
        // 反馈灯罩仍走 --hub-bg-hover 单通道（§23.4），红只在文字。
        "danger-ghost":
          "bg-transparent text-destructive hover:bg-[var(--hub-bg-hover)]",
      },
      size: {
        default: "h-8 px-3 has-[>svg]:px-2.5",
        xs: "h-6 gap-1 rounded-[var(--radius-btn)] px-2 text-[length:var(--text-2xs)] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        // sm 字号=登记字面量 12px（原型 .btn-sm=12px，2026-09-01 审计批裁决）：
        // --text-xs 已归 meta 11px（v1.70），sm 按钮随 chip 家族先例独立保 12，
        // 白名单见 scripts/check-font-ladder.cjs TSX_WHITELIST。
        sm: "h-7 gap-1.5 rounded-[var(--radius-btn)] px-2.5 text-[12px] has-[>svg]:px-2",
        // v1.56：xl 内距 24→16（0.6×高→0.4×高，回归族比例；官方原值 px-6 偏肥且 Hub 消费极少）。
        // v1.73（2026-08-26 用户裁决）：40px 档命名 lg→xl 对齐原型阶梯
        // （xl 40 / default 32 / sm 28 / xs 24；icon 同步 icon-lg→icon-xl）。
        xl: "h-10 rounded-[var(--radius-btn)] px-4 text-[length:var(--text-md)] has-[>svg]:px-3.5",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[var(--radius-btn)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-xl": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    Omit<React.ComponentPropsWithoutRef<typeof BaseButton>, "render">,
    VariantProps<typeof buttonVariants> {
  /** 渲染为子元素（Base UI 的 render prop 模式，类似官方 asChild）。 */
  render?: React.ReactElement;
  /** 自定义 className，与变体类合并（后者可被前者覆盖）。 */
  className?: string;
  /** 左侧图标（消费点统一传 JSX 元素，如 <CopyIcon size={ICON.sm} />）。 */
  icon?: React.ReactElement;
  /** 加载态：显示 Spinner 替代 icon，禁用交互。 */
  loading?: boolean;
  /** 加载态文案（替换 children）。 */
  loadingText?: string;
  /** 悬浮提示（Tooltip，进 a11y 树）。44 个消费点使用。 */
  tooltip?: string;
  /** 显式无障碍名（icon-only 按钮必需）。 */
  ariaLabel?: string;
}

const Button = React.memo(
  React.forwardRef<HTMLButtonElement, ButtonProps>(
    (
      {
        className,
        variant,
        size,
        render,
        icon,
        loading,
        loadingText,
        tooltip,
        ariaLabel,
        children,
        disabled,
        ...props
      },
      ref,
    ) => {
      const button = React.useMemo(
        () => (
          <BaseButton
            ref={ref}
            render={render}
            data-slot="button"
            data-variant={variant ?? "default"}
            data-size={size ?? "default"}
            className={cn(buttonVariants({ variant, size, className }))}
            disabled={disabled || loading}
            aria-label={ariaLabel}
            {...props}
          >
            {loading ? <Spinner size={ICON.base} className="shrink-0" /> : icon}
            {loading && loadingText ? <span>{loadingText}</span> : children}
          </BaseButton>
        ),
        [
          render,
          variant,
          size,
          className,
          disabled,
          loading,
          ariaLabel,
          icon,
          loadingText,
          children,
          ref,
          props,
        ],
      );

      if (!tooltip) return button;

      return (
        <Tooltip>
          <TooltipTrigger render={button} />
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      );
    },
  ),
);
Button.displayName = "Button.memo";
export { Button, buttonVariants };
export default Button;
