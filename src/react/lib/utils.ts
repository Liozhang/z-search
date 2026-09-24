/**
 * cn — shadcn/ui 标配的 className 合并工具。
 *
 * 合并 clsx（条件类名）与 tailwind-merge（解决 Tailwind 工具类冲突，
 * 后写的覆盖先写的，如 px-2 被同元素的 px-4 覆盖）。
 *
 * ReUI/shadcn 组件统一用 `cn()` 组合基线类与外部传入的 className。
 *
 * @example
 *   cn('px-2 py-1', isActive && 'bg-primary', className)
 *
 * @module react/lib/utils
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
