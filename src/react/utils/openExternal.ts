/**
 * openExternal — 在系统默认浏览器打开外部链接。
 *
 * Hub 搜索窗的 React 界面跑在 Zotero 特权窗内嵌的 chrome:// iframe 里：
 * <a target="_blank"> 点击不会打开系统浏览器（特权上下文无默认外链处理，
 * Zotero 要求特权代码显式调 Zotero.launchURL）。iframe 模式走桥上行
 * hub.openExternal，宿主 HubWindowBridge 代调；非 iframe（聊天侧栏挂在
 * 主窗、或浏览器里调试）直接 Zotero.launchURL，再以 window.open 兜底。
 *
 * @module react/utils/openExternal
 */

import type { MouseEvent as ReactMouseEvent } from "react";
import { safeDebug } from "../../utils/logger";
import { runningInIframe, sendToBackend } from "./bridge";

/** 只放行 http(s)——javascript:/chrome:/file: 等协议一律拒绝。 */
export function isSafeExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Open a URL in the system default browser.
 * Returns false when the URL is empty / non-http(s) — callers keep the
 * element non-interactive in that case instead of wiring a dead click.
 */
export function openExternalUrl(url: string): boolean {
  if (!isSafeExternalUrl(url)) return false;
  try {
    if (runningInIframe()) {
      sendToBackend("hub.openExternal", { url });
      return true;
    }
    const zotero = (window as any).Zotero;
    if (typeof zotero?.launchURL === "function") {
      zotero.launchURL(url);
      return true;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch (e) {
    safeDebug("[z-search] openExternalUrl: " + e);
    return false;
  }
}

/**
 * Anchor 点击拦截的公共 onClick：chrome:// iframe 里默认导航是死点击，
 * 统一 preventDefault 后走 openExternalUrl。供各结果卡/弹窗的
 * <a> 出口复用，保持行为单源。
 */
export function externalAnchorClick(
  url: string,
): (e: ReactMouseEvent<HTMLAnchorElement>) => void {
  return (e) => {
    e.preventDefault();
    openExternalUrl(url);
  };
}
