/**
 * SearchInput.tsx — 搜索输入统一组件（spec §21.2：搜索语义唯一形态）。
 *
 * 内置前导 Search 图标，消费点不再手写 absolute 定位图标 + !pl 覆盖。
 * size 语义（§21.2 立法）：
 *   sm = 紧凑工具栏 / 全局 header（h-7，28 紧凑档）
 *   md = 页面内搜索行（h-8，默认，与 Input 等高——v1.39 32 阶梯）
 *   lg = 独立搜索页主输入（h-10）
 *
 * className 施加于 wrapper（布局语境：flex-1 / min-w-0 / 工具行弹性宽）；
 * 边缘覆盖用 inputClassName 直达内部 Input。
 *
 * @module react/components/ui/SearchInput
 */

import * as React from "react";
import { SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "./input";

type SearchInputSize = "sm" | "md" | "lg" | "xl";

const SIZE_SPEC: Record<SearchInputSize, { icon: string; input: string }> = {
  sm: { icon: "size-3.5", input: "h-7" },
  // Input 基线即 h-8，md 无需覆盖
  md: { icon: "size-4", input: "" },
  lg: { icon: "size-4", input: "h-10" },
  xl: { icon: "size-4", input: "h-10" },
};

interface SearchInputProps extends Omit<React.ComponentProps<"input">, "size"> {
  size?: SearchInputSize;
  /** 追加到内部 Input 的类（边缘覆盖用；布局类请走 className） */
  inputClassName?: string;
}

function SearchInput({
  className,
  inputClassName,
  size = "md",
  ...props
}: SearchInputProps): React.ReactElement {
  const spec = SIZE_SPEC[size];
  return (
    <div
      data-slot="search-input"
      className={cn("relative min-w-0 flex-1", className)}
    >
      <SearchIcon
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 left-3 z-[var(--z-base)] -translate-y-1/2 text-muted-foreground",
          spec.icon,
        )}
      />
      <Input
        className={cn("!pl-[var(--space-8)]", spec.input, inputClassName)}
        {...props}
      />
    </div>
  );
}

export { SearchInput };
export default SearchInput;
