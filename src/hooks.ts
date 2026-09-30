import { initLocale } from "./utils/locale";
import { servicesInit } from "./hooks/servicesInit";
import { onMainWindowLoad, onMainWindowUnload } from "./hooks/windowLifecycle";
import { onShutdown } from "./hooks/shutdownSequence";
import { currentPrefPaneIconURI } from "./modules/prefPaneIcon";
import { safeDebug } from "./utils/logger";

async function onStartup() {
  await Promise.allSettled([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // Re-entrancy latch: some hosts fire onStartup more than once per process.
  if (_globalThis.addon.data.initialized) {
    safeDebug(
      "[z-search] services already initialized, skipping onStartup re-init",
    );
  } else {
    await servicesInit();
  }

  // 持久翻译缓存的启动修剪（自 z-transplit 搬入，fire-and-forget，不阻塞
  // 启动）：超 translate.cache.maxSizeMB（默认 200）按 LRU 清到 70%。
  void (async () => {
    try {
      const { getPrefDynamic } = await import("./utils/prefs");
      const { pruneCache } =
        await import("./core/translation/translationCache");
      const maxMB = Number(getPrefDynamic("translate.cache.maxSizeMB")) || 200;
      const removed = await pruneCache(maxMB * 1024 * 1024);
      if (removed > 0) {
        safeDebug(`[z-search] translation cache pruned: ${removed} files`);
      }
    } catch {
      /* best-effort */
    }
  })();

  // 设置侧栏的偏好窗图标按宿主主题选（bootstrap.js 紧接着注册偏好窗时读）：
  // 暗色侧栏下深墨圆的对比度只剩 1.32:1，所以暗底换浅墨圆变体。
  _globalThis.addon.data.prefPaneIcon = currentPrefPaneIconURI(
    Zotero.getMainWindow?.(),
  );

  await Promise.allSettled(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  _globalThis.addon.data.initialized = true;
}

async function onNotify(
  _event: string,
  _type: string,
  _ids: Array<string | number>,
  _extraData: { [key: string]: any },
) {}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
};
