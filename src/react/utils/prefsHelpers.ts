/**
 * Shared prefs helpers for reading/writing dynamic preferences.
 * Used by useInputHistory, useSearchHistory, ApiKeysSection, etc.
 *
 * 自动适配三种运行模式（来自 utils/bridge.ts getBridge 的检测顺序）：
 *   - Hub iframe：window.__hubBridge（PostMessageBridge）
 *   - standalone iframe：window.__bridge（PostMessageBridge）
 *   - legacy / 同窗口：window.__bridgeTransport（BridgeTransport）
 *
 * 旧实现写死 `__bridge`，导致 Hub iframe 里调不通（Hub 走的是 __hubBridge）。
 * 改用 getBridge() 后所有模式统一。bridge envelope 解包用 bridgeRequest 模式。
 */
import { getBridge } from "./bridge";

/** 读一个 dynamic pref。返回 null 表示无 bridge / 无值。 */
export async function prefsGetDynamic(key: string): Promise<any> {
  const bridge = getBridge();
  if (bridge) {
    const res = await bridge.request<{
      success?: boolean;
      data?: any;
      error?: string;
    }>("prefs.getDynamic", { key });
    return res?.data;
  }
  return (window as any).leaderoAPI?.prefs?.getDynamic?.(key) ?? null;
}

/** 写一个 dynamic pref（不触发副作用；Hub Settings 内应优先用 hubRequest('settings.*')）。 */
export async function prefsSetDynamic(key: string, value: any): Promise<void> {
  const bridge = getBridge();
  if (bridge) {
    await bridge.request("prefs.setDynamic", { key, value });
    return;
  }
  (window as any).leaderoAPI?.prefs?.setDynamic?.(key, value);
}

/**
 * 清一个 dynamic pref（迁移期清扫孤儿键；键不存在时 Zotero 侧本就是 no-op，故幂等）。
 * 与上两者同面：Hub iframe 走 __hubBridge、独立窗走 __bridge、legacy 走全局。
 */
export async function prefsClearDynamic(key: string): Promise<void> {
  const bridge = getBridge();
  if (bridge) {
    await bridge.request("prefs.clearDynamic", { key });
    return;
  }
  (window as any).leaderoAPI?.prefs?.clearDynamic?.(key);
}
