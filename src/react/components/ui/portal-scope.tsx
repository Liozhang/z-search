/**
 * PortalScope — 统一作用域容器（Base UI 迁移基础设施）。
 *
 * 问题背景：
 *   leadero 所有 design token（`--accent-*` / `--space-*` / `--fill-*` 桥接）
 *   都挂载在 `.leadero-root` 节点上，所有 CSS 选择器强制以 `.leadero-root`
 *   起始（check-css-scope.cjs）。而 Base UI 的 Dialog/Popover/Tooltip/Menu/
 *   Select/Combobox/Toast 默认把浮层 Portal 到 `document.body`，脱离
 *   `.leadero-root` 子树 → token 解析失败、CSS 选择器命中失败。
 *
 * 解法：
 *   在每个 React 根挂一个 `<PortalScopeRoot>`，它渲染一个物理上位于
 *   `.leadero-root` 子树内的专用容器节点 `.leadero-portal-layer`，并通过
 *   Context 向下暴露该容器的 ref。所有 Base UI 浮层封装组件
 *   （`ui/*`）读取这个 ref，作为 `*.Portal` 的 `container` prop，
 *   使浮层 DOM 物理上落在 `.leadero-root` 内。
 *
 *   关键：该容器自身带 `.leadero-root` 类，因此
 *     (a) `.leadero-root` 前缀的 CSS 选择器能命中它及内部浮层；
 *     (b) 它作为外层 `.leadero-root` 的子节点，CSS 变量沿 DOM 树继承，
 *         无需额外注入 token。
 *
 * 挂载位置（两条路径，见 index.tsx）：
 *   - mountElement（XUL sidebar/translate/paper-graph 挂载）
 *   - iframe 自动挂载（Hub 主路径）
 *
 * @module react/components/ui/portal-scope
 */

import React, { createContext, useContext, useRef } from "react";

/**
 * Portal 容器 ref。
 * 初始为 null（首次渲染时容器尚未挂载）。
 * ⚠️ 传给 Base UI Portal 的 container 时必须解 ref 值：
 *   container={portalRef?.current ?? undefined}
 * 不能直接传 RefObject——ref.current 为 null 时 Base UI floating-ui 的
 * tabbable 扫描会 getComputedStyle(null) 崩溃。
 */
export type PortalContainerRef = React.RefObject<HTMLElement | null>;

const PortalScopeContext = createContext<PortalContainerRef | null>(null);

/**
 * 读取当前作用域的 Portal 容器 ref。
 *
 * 用法（封装组件内部）：
 *   const portalRef = usePortalScope();
 *   // ⚠️ 必须解 ref，不能传 portalRef 本身
 *   <Dialog.Portal container={portalRef?.current ?? undefined}>...</Dialog.Portal>
 *
 * 若无 Provider（理论上不应发生，因 PortalScopeRoot 挂在每个 React 根），
 * 返回 null。
 */
export function usePortalScope(): PortalContainerRef | null {
  return useContext(PortalScopeContext);
}

interface PortalScopeRootProps {
  children: React.ReactNode;
}

/**
 * PortalScopeRoot —— 在 React 根内渲染一个专用 portal 容器节点，并通过
 * Context 向整个子树暴露该容器的 ref。
 *
 * 容器样式（leadero-baseui.css 中定义）：
 *   - position: absolute; inset: 0 —— 覆盖整个父级作用域（.leadero-root
 *     在 baseui.css 里设了 position:relative 作为定位参考）
 *   - pointer-events: none —— 容器本身不拦截鼠标；浮层各自 pointer-events: auto
 *   - 不设 z-index —— 依赖 .leadero-root 的 `isolation: isolate`（官方
 *     quick-start 要求）创建独立堆叠上下文，内部浮层各自用 --z-* token
 *
 * 前置依赖（leadero-baseui.css 顶部）：
 *   .leadero-root { isolation: isolate; position: relative; }
 *   这是 Base UI 官方 quick-start 的硬性要求，确保浮层 z-index 在应用
 *   scope 内独立解析，不与 Zotero 主窗口冲突。
 *
 * 注意：children 正常渲染在 portal-layer 之外（顺序在前），portal-layer
 *       只作为浮层的挂载点，不包裹应用内容。这样应用内容的 DOM 结构和
 *       事件冒泡不受影响。
 */
export function PortalScopeRoot({
  children,
}: PortalScopeRootProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <PortalScopeContext.Provider value={containerRef}>
      {children}
      {/*
        portal-layer：物理上在 .leadero-root 子树内（此组件渲染在应用根
        的 .leadero-root 节点之下），所有 Base UI 浮层会 portal 到这里。
        pointer-events:none 防止空容器拦截点击；浮层组件自身样式设 auto。
      */}
      <div
        ref={containerRef}
        className="leadero-root leadero-portal-layer"
        data-leadero-portal-layer=""
      />
    </PortalScopeContext.Provider>
  );
}

export default PortalScopeRoot;
