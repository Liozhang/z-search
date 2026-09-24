/**
 * Gecko DOM (zotero-types) 缺失的标准 DOM 全局函数 polyfill。
 * zotero-types 用 Gecko DOM 替代标准 lib.dom（no-default-lib="true"），
 * Gecko DOM 未声明全局 getComputedStyle/cancelAnimationFrame（src/react 全局调用）。
 * CSSStyleDeclaration/Element 类型 Gecko DOM 已提供。
 */
declare function getComputedStyle(
  elt: Element,
  pseudoElt?: string | null,
): CSSStyleDeclaration;
declare function cancelAnimationFrame(handle: number): void;
