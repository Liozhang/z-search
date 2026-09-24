/**
 * Jotai store — Shared atomic state management for React UI.
 *
 * Store is shared via Zotero global for cross-window consistency.
 */

import { createStore } from "jotai";

let store: ReturnType<typeof createStore> | null = null;

export function getStore(): ReturnType<typeof createStore> {
  // Module-level cached store — initialized once, shared across all callers.
  // Both branches below assign `store` before return, so this never returns
  // null at runtime. The non-null return type propagates to all 45+ callers,
  // eliminating redundant null checks at every call site.
  if (store) return store;

  // P2-3：显式取全局（裸标识符在桩未安装的 realm 会抛 ReferenceError）；
  // Z 为 any，expando 属性直接可写，不再需要 ts-expect-error。
  const Z = (globalThis as any).Zotero;
  if (Z) {
    if (!Z.__leaderoJotaiStore) {
      Z.__leaderoJotaiStore = createStore();
    }
    store = Z.__leaderoJotaiStore;
  } else {
    store = createStore();
  }

  return store!;
}
