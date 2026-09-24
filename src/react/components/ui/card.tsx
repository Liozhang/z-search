/**
 * card.tsx — shadcn/ui Card（官方 v4 形态，Base UI 底座）。
 *
 * 类串对齐 v4.shadcn.com 注册表；刻意省略官方 shadow-sm，遵守
 * leadero §19 平地红线：静态内容卡片零投影。
 *
 * @module react/components/ui/card
 */

import * as React from "react";

import { cn } from "@/lib/utils";

function Card({
  className,
  as = "div",
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  /** 根元素标签：列表容器用 "ul"（保持 list 语义）。
   *  用 HTMLElement 泛型：div/ul 事件处理器协变兼容（ComponentProps<"div">
   *  的 handler 与 ul 不兼容）。 */
  as?: "div" | "ul";
}): React.ReactElement {
  const Tag = as;
  return (
    <Tag
      data-slot="card"
      className={cn(
        "rounded-[var(--card-radius)] border bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...props}
    />
  );
}

function CardTitle({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      data-slot="card-title"
      className={cn("text-2xl font-semibold", className)}
      {...props}
    />
  );
}

function CardDescription({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      data-slot="card-content"
      className={cn("p-6 pt-0", className)}
      {...props}
    />
  );
}

function CardFooter({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center p-6 pt-0", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
