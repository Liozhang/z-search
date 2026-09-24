import { safeDebug } from "../../utils/logger";
// zoteroShim — chrome:// iframe 中的 Zotero 全局变量防御性补丁。
//
// Hub 运行在 chrome:// iframe 中，window.Zotero 可能未定义，
// 但大量 React 代码直接调用 Zotero.debug / Zotero.ProgressWindow 等 API 未加 typeof 守卫。
// 此模块在 bundle 最顶部执行，若 Zotero 不存在则注入安全 no-op 桩，避免 ReferenceError。
//
// 设计原则：
// - debug 等副作用 API 输出到 console.log，保持开发期可见
// - ProgressWindow / Items / getActiveZoteroPane 等需要返回对象的 API 提供空桩
// - 不尝试模拟真实 Zotero 行为；iframe 中本就无法访问这些 API
//
// P2-3（2026-09-15 真机 UI 审计）：原判定用 `typeof window !== "undefined"` 做门，
// 再查 `window.Zotero`——bundle 若被载入**没有 window 的 realm**（worker / 沙箱
// 全局 / 非 window 宿主），整块补丁被跳过，之后任何裸 `Zotero` 标识符访问即
// `ReferenceError: Zotero is not defined`（真机在 reactBundle.js 上采集到 2 次）。
// 现改为：先探测当前 realm 的全局对象（window ?? globalThis），用**安全的**
// `typeof Zotero === "undefined"` 判定（typeof 对未声明标识符不抛），命中即在该
// realm 上定义桩——凡补丁跑过的 realm，裸 `Zotero` 一定解析得到。
const GUARD_GLOBAL: any =
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : undefined;

if (GUARD_GLOBAL && typeof Zotero === "undefined") {
  const shim: Record<string, unknown> = {
    debug: (...args: unknown[]) => {
      // 本桩存在的意义就是「Zotero 不存在时的开发期可见性」（见文件头设计原则第 1 条）。
      // safeDebug 在此分支下会静默吞掉（Zotero 未定义），换掉等于删功能。
      // 唯一豁免点，改动时请连同这条理由一起复核。
      // console-guard-allow: 见上三行理由
      console.log("[Zotero shim]", ...args);
    },
    locale: "en-US",
    getActiveZoteroPane: () => null,
    Items: { get: () => null },
    Clipboard: null,
    __leaderoJotaiStore: null,
  };

  class ProgressWindowStub {
    constructor(_opts?: unknown) {}
    changeHeadline(_msg?: string) {}
    addDescription(_msg?: string) {}
    addTab(_tab?: unknown) {
      return this;
    }
    show() {
      return this;
    }
    hide() {
      return this;
    }
    startCloseTimer(_ms?: number) {
      return this;
    }
  }

  shim.ProgressWindow = ProgressWindowStub;

  try {
    Object.defineProperty(GUARD_GLOBAL, "Zotero", {
      value: shim,
      writable: true,
      configurable: true,
    });
  } catch (e) {
    safeDebug("[z-search] " + e);
    GUARD_GLOBAL.Zotero = shim;
  }
}

/**
 * gcsGuard — getComputedStyle(null) 防御性补丁。
 *
 * Base UI / floating-ui 内部在 focus trap / tabbable 扫描时可能对 null
 * 元素调用 getComputedStyle，Firefox 直接抛 TypeError。此模块在 bundle
 * 最顶部替换 window.getComputedStyle，拦截 null/undefined 参数。
 *
 * 必须作为 side-effect import 放在 index.tsx 第一行（所有其他代码之前）。
 */

if (typeof window !== "undefined") {
  const orig = window.getComputedStyle.bind(window);
  const patched: typeof window.getComputedStyle = function (
    elt: Element,
    pseudo: string | null | undefined,
  ) {
    if (elt == null || typeof elt !== "object") {
      return orig(document.documentElement, pseudo ?? null);
    }
    return orig(elt, pseudo ?? null);
  };
  // 用 Object.defineProperty 确保不可被 minifier 当 dead code 移除
  try {
    Object.defineProperty(window, "getComputedStyle", {
      value: patched,
      writable: true,
      configurable: true,
    });
  } catch (e) {
    safeDebug("[z-search] " + e);
    // 如果 defineProperty 失败（已 frozen），直接赋值
    (window as unknown as Record<string, unknown>).getComputedStyle = patched;
  }
}

export {};
