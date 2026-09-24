import { safeDebug } from "../utils/logger";

/**
 * onShutdown — z-search 关闭序列。
 *
 * 关闭所有 Hub 搜索窗口（disable/enable 后旧上下文的 Hub 窗处于半死态：
 * RPC 仍响应但事件链已断——UI 静默冻结而后端继续跑，随插件一起关闭）。
 */
async function onShutdown(): Promise<void> {
  try {
    const { hubWindowManager } = await import("../ui/hub/HubWindowManager");
    hubWindowManager.closeAll();
  } catch (e) {
    safeDebug("[z-search] hubWindowManager.closeAll error: " + e);
  }

  _globalThis.addon.data.alive = false;
}

export { onShutdown };
