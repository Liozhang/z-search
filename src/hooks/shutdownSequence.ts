import { safeDebug } from "../utils/logger";
import AICache from "../core/cache/AICache";

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

  // 条目删除观察者注销：shutdown 后 observer 闭包不得再触库操作。
  try {
    const { unregisterLibraryIndexNotifier } =
      await import("../modules/libraryIndexNotifier");
    unregisterLibraryIndexNotifier();
  } catch (e) {
    safeDebug("[z-search] unregisterLibraryIndexNotifier error: " + e);
  }

  // AI 缓存立即落盘：退出前最后一次持久化。此前 flushNow 是死代码，
  // 缓存只靠五分钟周期定时器写盘，每次退出丢最近一个周期的写入。
  try {
    await AICache.flushNow();
  } catch (e) {
    safeDebug("[z-search] AICache.flushNow error: " + e);
  }

  _globalThis.addon.data.alive = false;
}

export { onShutdown };
