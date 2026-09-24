/**
 * input.tsx — shadcn/ui Input（官方 v4 形态，Base UI 底座）。
 *
 * 类串逐字对齐 v4.shadcn.com 注册表；cn-input 重复层已退役。
 * bg-background（v1.72 灰底白卡翻转批）：输入=控件面=raised 白——官方移植的
 * bg-transparent 在全白页时代隐形成立，画布 stone-50 上输入内部与页面同色、
 * 可输入供能丢失；raised 白恢复「输入是一个面」的供能（spec §3.1/§19.2）。
 *
 * @module react/components/ui/input
 */

import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "appearance-none box-border h-8 w-full min-w-0 rounded-[var(--radius-btn)] border border-input bg-background px-3 py-1 text-[length:var(--text-control)] transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
