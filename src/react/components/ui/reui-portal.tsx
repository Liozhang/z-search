/**
 * reui-portal — ReUI/shadcn 浮层组件的 PortalScope 适配器。
 *
 * 背景：
 *   leadero 的所有 design token 挂在 `.leadero-root` 节点，且构建强制
 *   要求类选择器以 `.leadero-root` 起始（check-css-scope.cjs）。Base UI
 *   的浮层（Dialog/Popover/Tooltip/Select/Combobox/Menu）默认 Portal 到
 *   document.body，会脱离 `.leadero-root` 子树 → token 解析失败、Tailwind
 *   工具类选择器无法命中。
 *
 *   leadero 已有成熟的 PortalScope 基础设施（portal-scope），在每个
 *   React 根挂一个 `.leadero-root.leadero-portal-layer` 容器。本模块把它
 *   暴露给新落地的 shadcn/ReUI 组件使用。
 *
 * 用法（在 shadcn 浮层组件内）：
 *   import { useReuiPortal } from '@/components/ui/reui-portal';
 *   const portalRef = useReuiPortal();
 *   // ⚠️ 必须解 ref 值，不能传 RefObject 本身——ref.current 在首次渲染
 *   //   或 ErrorBoundary 恢复期间可能为 null，Base UI floating-ui 的
 *   //   tabbable 扫描会 getComputedStyle(null) 崩溃。
 *   <Dialog.Portal container={portalRef?.current ?? undefined}>...</Dialog.Portal>
 *
 * 注意：本模块复用 portal-scope，不复制其实现。PortalScope 是承重墙，不可删除。
 *
 * @module react/components/ui/reui-portal
 */

import { usePortalScope, type PortalContainerRef } from "./portal-scope";

/**
 * 获取当前作用域的 Portal 容器 ref，供 shadcn/ReUI 浮层组件使用。
 *
 * 返回值需解 ref 后传给 Base UI 的 `*.Portal` 的 `container` prop：
 *   container={portalRef?.current ?? undefined}
 * 若 ref.current 为 null（Provider 未挂载/div 未 commit），传 undefined
 * 让 Base UI 回退到 document.body。直接传 RefObject 会导致
 * getComputedStyle(null) 崩溃。
 */
export function useReuiPortal(): PortalContainerRef | null {
  return usePortalScope();
}

export type { PortalContainerRef };
