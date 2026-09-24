/**
 * Minimal type stub for `react-dom/client` (createRoot/hydrateRoot API).
 *
 * `@types/react-dom` is not installed. This declares only the surface used by
 * src/react (createRoot + Root.render/unmount). If `@types/react-dom` is ever
 * added as a dependency, delete this file.
 */
declare module "react-dom/client" {
  import type { ReactElement } from "react";

  export interface Root {
    render(children: ReactElement | null): void;
    unmount(): void;
  }

  export interface CreateRootOptions {
    key?: string;
    // Other options omitted — not used by the app.
  }

  export function createRoot(
    container: Element | DocumentFragment,
    options?: CreateRootOptions,
  ): Root;

  export function hydrateRoot(
    container: Element | DocumentFragment,
    children: ReactElement,
    options?: CreateRootOptions,
  ): Root;
}

/**
 * react-dom 主入口桩（2026-09-07 布局审计批补）：ItemPicker 浮层锚定层上移
 * 需要 createPortal（ChatInput → .leadero-content）。运行时 React 18/19 主入口
 * 均导出 createPortal；此处只声明用到的面。
 */
declare module "react-dom" {
  import type { ReactElement, ReactPortal } from "react";

  export function createPortal(
    children: ReactElement,
    container: Element | DocumentFragment,
    key?: string,
  ): ReactPortal;
}
