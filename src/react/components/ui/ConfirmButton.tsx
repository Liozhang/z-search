/**
 * ConfirmButton — 触发公用 ConfirmDialog 弹窗的按钮。
 *
 * 原为行内两次点击确认（inline），现改为命令式调用 useConfirm() 弹 modal
 * （更强制的确认反馈，风格与 leadero 其他 dialog 一致）。
 *
 * 调用方接口不变：<ConfirmButton confirmMessage confirmLabel onConfirm />
 * 点击 → 弹 ConfirmDialog → 用户确认 → onConfirm()
 */

import React from "react";
import { cn } from "@/lib/utils";
import Button from "./button";
import { useConfirm } from "./ConfirmDialog";

interface ConfirmButtonProps {
  /** 触发按钮的文字/icon */
  children: React.ReactNode;
  /** 弹窗正文（原 confirmMessage） */
  confirmMessage: string;
  /** 弹窗确认按钮文字 */
  confirmLabel: string;
  /** 弹窗取消按钮文字 */
  cancelLabel?: string;
  /** 用户确认后回调 */
  onConfirm: () => void;
  /** 阻止冒泡（默认 true） */
  stopPropagation?: boolean;
  /** 触发按钮额外 class */
  className?: string;
  /** 触发按钮 variant */
  variant?: "outline" | "ghost" | "subtle" | "solid";
  /** 触发按钮 tone (danger=red, success=green) */
  tone?: "default" | "danger" | "success";
  /** 触发按钮 size */
  size?: "icon" | "compact" | "md" | "base";
  /** Title 属性 */
  title?: string;
  /** 触发按钮 icon */
  icon?:
    React.ComponentType<React.SVGProps<SVGSVGElement>> | React.ReactElement;
  /** 禁用触发按钮（异步进行中防重复点击） */
  disabled?: boolean;
}

export function ConfirmButton({
  children,
  confirmMessage,
  confirmLabel,
  cancelLabel,
  onConfirm,
  stopPropagation = true,
  className = "",
  variant = "outline",
  tone = "default",
  size = "md",
  title,
  icon,
  disabled = false,
}: ConfirmButtonProps): React.ReactElement {
  const confirm = useConfirm();

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) e.stopPropagation();
    const ok = await confirm({
      message: confirmMessage,
      confirmLabel,
      cancelLabel,
      danger: true,
    });
    if (ok) onConfirm();
  };

  // Map the legacy public API (variant/tone/size) onto the new shadcn Button.
  const variantMap = {
    solid: "default",
    outline: "outline",
    subtle: "ghost", // v1.46：灰实心退役（用户裁决「立体灰按钮」禁令）
    ghost: "ghost",
  } as const;
  const sizeMap = {
    icon: "icon",
    compact: "sm",
    md: "default",
    base: "xl", // v1.73：Button 40px 档 lg→xl（对齐原型阶梯）
  } as const;
  const mappedVariant:
    "default" | "destructive" | "outline" | "secondary" | "ghost" =
    variant === "solid" && tone === "danger"
      ? "destructive"
      : variantMap[variant];
  const successClass =
    variant === "solid" && tone === "success"
      ? " bg-success text-success-foreground hover:bg-success/90"
      : "";

  // Normalize icon: new Button wants a ReactElement, but the legacy public API
  // also accepts a component type — render it if needed.
  const iconEl = icon
    ? typeof icon === "function"
      ? React.createElement(
          icon as React.ComponentType<React.SVGProps<SVGSVGElement>>,
        )
      : icon
    : undefined;

  return (
    <Button
      variant={mappedVariant}
      size={sizeMap[size]}
      className={cn(className, successClass) || undefined}
      tooltip={title}
      icon={iconEl}
      disabled={disabled}
      onClick={handleClick}
    >
      {children}
    </Button>
  );
}

export default ConfirmButton;
