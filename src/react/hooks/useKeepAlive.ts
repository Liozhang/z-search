/**
 * useKeepAlive — Hub 各 Pane / sub-tab 共用的 keep-alive 计数 hook。
 *
 * 模式：lazy mount（首次访问某 key 才挂载，避免 N 个子视图同时 init）+ display 切换
 * （已挂载的不卸载，用 CSS .hidden 或 inline display 切换显隐，保留内部 state）。
 *
 * 提取前该模式在 5 处重复（HubMainArea / SettingsPane / SearchPane / BrainPane /
 * FollowingPane），逻辑完全同构。本 hook 只统一"mounted Set + effect"，slot 渲染
 * 仍由各调用方自行实现（差异太多：inline style vs .hidden、activeRef、selfScroll、
 * ErrorBoundary 位置、2-tab-1-slot 映射等，统一组件会过度设计）。
 *
 * @module react/hooks/useKeepAlive
 */

import { useLayoutEffect, useState } from "react";

/**
 * @param activeKey 当前激活的 key（首次渲染即加入 mounted）
 * @returns mounted Set + isMounted 查询函数
 */
export function useKeepAlive<T>(activeKey: T): {
  mounted: Set<T>;
  isMounted: (key: T) => boolean;
} {
  const [mounted, setMounted] = useState<Set<T>>(() => new Set<T>([activeKey]));

  // useLayoutEffect（而非 useEffect）确保新 key 在浏览器 paint 前加入 mounted，
  // 避免首次切换到未访问 Section 时出现一帧空白（修 #8）。useEffect 是 post-paint，
  // 会导致 paint 时新 slot 尚未 mount、内容区空白一帧。
  useLayoutEffect(() => {
    setMounted((prev) =>
      prev.has(activeKey) ? prev : new Set(prev).add(activeKey),
    );
  }, [activeKey]);

  return { mounted, isMounted: (key: T) => mounted.has(key) };
}
