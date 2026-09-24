// gcsGuard 必须在所有其他 import 之前执行——它 patch window.getComputedStyle
// 来防止 Base UI / floating-ui 的 getComputedStyle(null) 崩溃。
import "./utils/gcsGuard";

// [诊断] unhandledrejection 探针：Zotero 控制台对无理由 rejection 只打一行
// "Uncaught (in promise) undefined"（2026-08-27 定位）。命中时把 reason 与
// 完整 stack 打进 console.error，供错误控制台归属。
window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
  const r = (ev as PromiseRejectionEvent).reason;
  const detail =
    r instanceof Error
      ? `${r.message}\n${r.stack}`
      : typeof r === "object" && r !== null
        ? JSON.stringify(r)
        : String(r);
  console.error(
    `[z-search][rejection-probe] @ ${window.location?.href}: ${detail}`,
  );
});

import React from "react";
import { createRoot, Root } from "react-dom/client";
import { Provider } from "jotai";
import { getStore } from "./store";
import { GlobeSpinner } from "./components/ui/GlobeSpinner";
import { PostMessageBridge } from "../bridge/PostMessageBridge";
import { getString, initLocaleCache } from "./utils/locale";
import { SearchShell } from "./components/Hub/SearchShell";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import { ToastProvider } from "./components/ui/toast";
import { BackendEventNotifier } from "./components/ui/BackendEventNotifier";
import { PortalScopeRoot } from "./components/ui/portal-scope";

/* Bundle CSS as raw strings via webpack asset/source.
   Inject as <style> tags at runtime — works in chrome:// iframes
   where <link rel="stylesheet"> fails to load. */
import leaderoTokensCss from "../../addon/content/chat/react/leadero-tokens.css";
import leaderoThemeCss from "../../addon/content/chat/react/leadero-theme.css";
import leaderoLayoutCss from "../../addon/content/chat/react/leadero-layout.css";
import leaderoComponentsCss from "../../addon/content/chat/react/leadero-components.css";
import leaderoMarkdownCss from "../../addon/content/chat/react/leadero-markdown.css";
// Hub 样式（按原 leadero-hub.css 的段序 import——CSS 级联由此序决定）
import leaderoHubBaseCss from "../../addon/content/chat/react/leadero-hub-base.css";
import leaderoHubSearchCss from "../../addon/content/chat/react/leadero-hub-search.css";
import leaderoHubControlsCss from "../../addon/content/chat/react/leadero-hub-controls.css";
import leaderoHubOverridesCss from "../../addon/content/chat/react/leadero-hub-overrides.css";
import leaderoHubResponsiveCss from "../../addon/content/chat/react/leadero-hub-responsive.css";
import leaderoHubSettingsCss from "../../addon/content/chat/react/leadero-hub-settings.css";
import shadcnUtilsCss from "../../addon/content/chat/react/shadcn-utils.css";
import twCss from "../../addon/content/chat/react/tw.css";
import { safeDebug } from "../utils/logger";
import { notifyBridgeAttached } from "./utils/bridge";

/**
 * Resolve a locale key, falling back to a literal when the key is unresolved.
 * getString() returns the key itself when the locale cache is unavailable.
 */
function localized(key: string, fallback: string): string {
  const value = getString(key);
  // iframe（无前缀）与 XUL（zsearch- 前缀）两种 miss 形态都视为未解析。
  return value === key || value === `zsearch-${key}` ? fallback : value;
}

function injectStyles(...sheets: string[]) {
  const target = document.head || document.documentElement;
  if (!target) return;
  // 合并为单个 <style>（布局 P10）：多节点 → 1 个，降低 DOM 开销。
  const el = document.createElement("style");
  el.textContent = sheets.join("\n");
  target.appendChild(el);
}
try {
  injectStyles(
    leaderoTokensCss,
    leaderoThemeCss,
    leaderoLayoutCss,
    leaderoComponentsCss,
    leaderoMarkdownCss,
    leaderoHubBaseCss,
    leaderoHubSearchCss,
    leaderoHubControlsCss,
    leaderoHubOverridesCss,
    leaderoHubResponsiveCss,
    leaderoHubSettingsCss,
    shadcnUtilsCss,
    twCss,
  );
} catch (e) {
  safeDebug("[z-search] index: " + e);
  /* non-critical */
}

/**
 * Mount the search shell inside the Hub iframe init branch.
 */
function mountDashboard(
  root: Root,
  store: ReturnType<typeof getStore>,
  cleanup: () => void,
  message: MessageEvent,
  messageType: string,
  element: React.ReactNode,
  fallbackMessage: string,
): void {
  if (message.data?.type !== messageType) return;
  cleanup();
  const bridge = new PostMessageBridge();
  (window as any).__bridge = bridge;
  // 桥 attach 广播（2026-09-14 架构批）：等待中的订阅者（SearchShell 深链等）
  // 事件驱动唤醒，替代各消费方自写轮询。
  notifyBridgeAttached();

  const wrapped = (
    <Provider store={store}>
      <PortalScopeRoot>
        <ConfirmProvider>
          <ToastProvider>
            <BackendEventNotifier>
              <ErrorBoundary fallbackMessage={fallbackMessage}>
                {element}
              </ErrorBoundary>
            </BackendEventNotifier>
          </ToastProvider>
        </ConfirmProvider>
      </PortalScopeRoot>
    </Provider>
  );

  // Render 策略：
  // 1. 5s 内 cache 完成 → 立即 render（cache 满，不裸露）
  // 2. 5s 超时 → 强制 render 兜底（避免无限白屏），但 cache 仍在后台加载
  // 3. 关键：超时分支触发 render 后，cache 后续完成时再 render 一次，确保
  //  getString 拿到正确翻译。
  const render = () => {
    try {
      root.render(wrapped);
    } catch (e) {
      safeDebug("[z-search] index: " + e);
      /* 容器可能已脱离 DOM（窗口关闭） */
    }
  };
  const cachePromise = initLocaleCache();
  const timeoutPromise = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), 5000),
  );
  Promise.race([cachePromise.then(() => "cache" as const), timeoutPromise])
    .then((winner) => {
      render();
      if (winner === "timeout") {
        // 超时分支：cache 后续完成时强制 re-render
        cachePromise.then(render).catch(() => {});
      }
    })
    .catch(render);
}

const roots = new Map<HTMLElement, Root>();

function unmountFromElement(container: HTMLElement): void {
  const root = roots.get(container);
  if (root) {
    root.unmount();
    roots.delete(container);
  }
}

// Auto-mount: detect if running in iframe (HTML document)
if (
  typeof document !== "undefined" &&
  (document.contentType === "text/html" || window.self !== window.top)
) {
  const container = document.getElementById("root");
  if (container) {
    container.classList.add("leadero-root", "flex-col");
    const store = getStore();
    const root = createRoot(container);
    roots.set(container, root);

    // Phase 1: Immediate globe spinner (locale cache not loaded yet)
    root.render(
      <Provider store={store}>
        <div
          className="leadero-chat-root bg-sidepane h-full display-flex flex-col"
          data-window=""
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GlobeSpinner size={200} />
          </div>
        </div>
      </Provider>,
    );

    // Phase 2: Full SearchShell when init message arrives from parent
    const onInit = function (e: MessageEvent) {
      // Guard: skip if container was removed from DOM
      if (!container.isConnected) return;

      // Hub 搜索工作台
      if (e.data?.type === "zsearch-hub-init") {
        mountDashboard(
          root,
          store,
          cleanup,
          e,
          "zsearch-hub-init",
          <SearchShell />,
          localized("error-hub-render", "Failed to render the search window."),
        );
        return;
      }
    };
    function cleanup() {
      clearTimeout(initTimeout);
      window.removeEventListener("message", onInit);
      const prevBridge = (window as any).__bridge;
      if (prevBridge && typeof prevBridge.destroy === "function") {
        prevBridge.destroy();
      }
      (window as any).__bridge = null;
    }
    const initTimeout = window.setTimeout(() => {
      window.removeEventListener("message", onInit);
      // Show error feedback instead of leaving GlobeSpinner forever
      root.render(
        <Provider store={store}>
          <div
            className="leadero-chat-root bg-sidepane h-full display-flex flex-col"
            data-window=""
            style={{
              color: "var(--signal-red)",
              fontFamily: "var(--font-sans)",
              padding: "var(--space-5)",
            }}
          >
            {localized(
              "chat-init-timeout",
              "Search failed to start. Please reopen the window.",
            )}
          </div>
        </Provider>,
      );
    }, 30000);
    window.addEventListener("message", onInit);
  }
}

export { unmountFromElement };
