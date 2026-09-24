"use client";

/**
 * tooltip.tsx — shadcn/ui Tooltip（Base UI 底座）。
 *
 * v1.65 矩阵 ⑪（2026-08-25 裁决，原型 .has-tip）：px-2 py-1 / 11px /
 * rounded-sm(4px) / 无箭头；bg-foreground 反白底保留。动画用 Base UI 的
 * data-starting/ending-style 过渡（官方的 tw-animate-css 类不在依赖内，等价实现）。
 *
 * Portal container 走 PortalScope（reui-portal），与 dialog/select/
 * combobox/dropdown-menu/sheet 一致：默认 body 会让浮层脱离 .leadero-root
 * 子树——tw.css 工具类全部是 `.leadero-root ` 后代选择器，bg-foreground/
 * px-3/rounded-md 一律不命中，tooltip 退化为透明裸文本，token 也解析失败
 * （见 reui-portal.tsx 头注释）。传值必须解 ref：RefObject 直传在首次
 * 渲染 ref.current 为 null 时会触发 floating-ui tabbable 扫描
 * getComputedStyle(null) 崩溃；null 时回退 undefined → Base UI 落 body
 * （仅首次渲染前的安全窗口）。
 *
 * @module react/components/ui/tooltip
 */

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";
import { useReuiPortal } from "@/components/ui/reui-portal";

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  );
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  container: containerProp,
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    /** Portal 挂载点；缺省走 PortalScope（.leadero-portal-layer） */
    container?: TooltipPrimitive.Portal.Props["container"];
  }) {
  const portalRef = useReuiPortal();
  // 解 ref 值（不能传 RefObject 本身）：null → undefined → Base UI 回退
  // document.body。见文件头注释。
  const container = containerProp ?? portalRef?.current ?? undefined;
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-tooltip"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-tooltip w-fit max-w-xs rounded-sm bg-foreground px-2 py-1 text-[length:var(--text-2xs)] text-balance text-background",
            "origin-(--transform-origin) transition-[transform,opacity] duration-150 motion-reduce:transition-none",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
