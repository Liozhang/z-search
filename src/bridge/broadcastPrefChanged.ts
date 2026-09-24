/**
 * broadcastPrefChanged — 跨窗口 pref 变更通知（best-effort）。
 *
 * Leadero 有多个独立 XUL 窗口（zsearch:hub、leadero:chat 等），每个承载自己的
 * React iframe。用户在 Hub Settings 改了 pref 后，希望其他窗口的 React 组件
 * 也能感知并重新读取（例如 ChatPane 显示的 globeAnimated 状态）。
 *
 * 实现：枚举所有 leadero:* windowtype 的窗口，取它们注册的 bridge，调
 * sendNotifyToIframe 推 'zsearch:prefChanged' 事件。React 端用 usePref hook
 * 监听该事件。
 *
 * Best-effort：枚举或推送任一步失败都静默跳过（窗口可能正在关闭、bridge 未就绪）。
 * Phase 1 只覆盖已知的 windowtype；后续新增窗口在此追加即可。
 *
 * 不广播给发起改动的窗口本身——Hub React 端的本地 state 已经更新。
 */

const ZSEARCH_WINDOW_TYPES = ["zsearch:hub"] as const;

/** Pref change event payload sent to each iframe. */
export interface PrefChangedPayload {
  /** Dynamic pref key that changed（不含 prefsPrefix）。 */
  key: string;
}

/**
 * Enumerate all open Leadero windows and push a 'zsearch:prefChanged' notify.
 * Silently no-ops if window mediator is unavailable (e.g. running outside Zotero).
 */
export function broadcastPrefChanged(key: string): void {
  try {
    const wm = (Components.classes as any)[
      "@mozilla.org/appshell/window-mediator;1"
    ]?.getService((Components.interfaces as any).nsIWindowMediator);
    if (!wm) return;

    for (const windowType of ZSEARCH_WINDOW_TYPES) {
      const enumerator = wm.getEnumerator(windowType);
      while (enumerator.hasMoreElements()) {
        const win = enumerator.getNext() as any;
        if (!win || win.closed) continue;
        // Bridge 实例由各 Manager 挂到 window 上（参见 HubWindowManager/ChatWindowManager）
        const bridge = win.__hubBridge ?? win.__chatBridge ?? win.__bridge;
        // ChatWindowBridge（非 BaseWindowBridge 子类）也实现 sendNotifyToIframe，
        // 但接口形态不同——这里仅依赖 BaseWindowBridge 系列的 sendNotifyToIframe。
        if (bridge && typeof bridge.sendNotifyToIframe === "function") {
          try {
            bridge.sendNotifyToIframe("zsearch:prefChanged", { key });
          } catch {
            // Zotero integration: skip this window
          }
        }
      }
    }

    // L-19: main windows host the library/reader sidebar React, whose usePref
    // hook subscribes to the same 'zsearch:prefChanged' event through the
    // window's BridgeTransport (CustomEvent on 'leadero:bridge'). Without
    // this loop, prefs changed in the Hub never refreshed sidebar React in
    // the main windows.
    for (const win of Zotero.getMainWindows() as any[]) {
      try {
        if (!win || win.closed) continue;
        const transport = win.__bridgeTransport;
        if (transport && typeof transport.notify === "function") {
          transport.notify("zsearch:prefChanged", { key });
        }
      } catch {
        // Zotero integration: skip this window
      }
    }
  } catch {
    // Zotero integration: best-effort: swallow
  }
}
