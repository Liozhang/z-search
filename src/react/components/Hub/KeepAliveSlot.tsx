/**
 * KeepAliveSlot — keep-alive 视图槽（display 切换而非卸载）。
 *
 * 配 useKeepAlive 的 mounted 集：首次访问才挂载子树，此后仅以
 * `.hidden` 切换显隐，保留子树内部 state（搜索/分页/滚动位置等）。
 * 收编此前 HubMainArea / SearchPane / BrainPane 三处同款
 * `${active ? "" : " hidden"}` 槽闭包（16 个调用点）。
 *
 * 显隐用字符串拼接把 `.hidden` 追加到 className 尾部——与既有 CSS
 * 约定一致（.hub-pane-slot 自身 specificity 高于 .hidden，靠
 * .hub-pane-slot.hidden 显式覆盖），故此处不走 cn/twMerge。
 *
 * @module react/components/Hub/KeepAliveSlot
 */

import type * as React from "react";

export function KeepAliveSlot({
  active,
  className,
  animationClassName,
  children,
}: {
  /** 当前是否为激活视图；false 时仅隐藏（不卸载）。 */
  active: boolean;
  /** 布局类（含页面约定的 slot 基类，如 hub-pane-slot / hub-search-slot）。 */
  className?: string;
  /** 入场动画类；active 时应用，hidden 时也保留（恢复显示时动画重播）。 */
  animationClassName?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const base = className ?? "";
  const anim = animationClassName ?? "";
  return (
    <div
      className={
        active ? `${base} ${anim}`.trim() : `${base} hidden ${anim}`.trim()
      }
    >
      {children}
    </div>
  );
}
