/**
 * prefPaneIcon — Zotero 设置侧栏里 z-search 偏好窗图标的亮/暗主题切换。
 *
 * 背景（2026-09-23 视觉核查）：logo 主标是深墨圆 + 白 Z + 绯红柄，在 Zotero 的
 * 亮色侧栏（#f2f2f2）上对比度 15.55:1 / 17.40:1 / 5.33:1，全过；但暗色侧栏
 * （#303030）上墨圆只剩 1.32:1、选中行的主题蓝（#4072e5）上圆外那段绯红柄
 * 只剩 1.35:1，标的基本糊掉。Zotero 自己的偏好窗图标是 context-fill 单色
 * SVG（跟着 currentColor 走）解决这件事，而我们的标是三色品牌标，没法走那条
 * 路——所以按主题换图：暗底用浅墨圆 + 墨 Z 的 icon-dark 变体。
 *
 * 主题判据（2026-09-23 真机探针实测，别改成只读 OS）：
 * Zotero 内部「设置 → 常规 → 颜色方案」写的是 browser.theme.toolbar-theme，
 * 取值 0=暗色 / 1=亮色 / 2=自动。这个 pref **驱动** chrome 文档的
 * prefers-color-scheme：把它设成 0，matchMedia 立刻变 true、侧栏底色从
 * #f2f2f2 翻成 #303030。所以判据必须先读这个 pref：
 *   显式暗色/亮色  → 听 Zotero 的（哪怕与系统相反）
 *   自动          → 才回落 OS 的 prefers-color-scheme
 * 只读 matchMedia 会在「Zotero 选亮色、系统是暗色」时给错图。
 *
 * 三个同步入口：
 *   1. bootstrap.js 注册偏好窗时读 addon.data.prefPaneIcon（onStartup 算好
 *      存进去的），保证「之后打开设置窗」就是对的图；
 *   2. 主题变化时改 Zotero.PreferencePanes.pluginPanes 里我们那项的 image，
 *      让此后新建的设置窗也拿对图；
 *   3. 已开着的设置窗直接改 DOM——其侧栏项由 preferences.js 的 _addPane 建
 *      （richlistitem[value=paneID] > image），换 src 即可，不必重载窗口。
 *
 * 变化源有两个，都要订阅：pref 变化（用户改颜色方案）与 matchMedia 变化
 * （自动模式下 OS 主题变了）。主窗口卸载时一并摘掉，避免泄漏。
 *
 * @module modules/prefPaneIcon
 */

const CHROME_BASE = "chrome://zsearch/content/icons/";

/** 亮色宿主（Zotero 侧栏 #f2f2f2）：墨圆 + 白 Z + 绯红柄。 */
export const PREF_PANE_ICON_LIGHT = `${CHROME_BASE}icon-48.png`;
/** 暗色宿主（#303030 / 主题蓝选中行）：浅墨圆 + 墨 Z + 绯红柄。 */
export const PREF_PANE_ICON_DARK = `${CHROME_BASE}icon-dark-48.png`;

/** bootstrap.js 里 PreferencePanes.register 用的 id，两边必须一致。 */
export const PREF_PANE_ID = "zsearch-prefpane";
/** Zotero 设置窗的 windowtype（其 preferencePanes._refreshPreferences 同值）。 */
const PREF_WINDOW_TYPE = "zotero:pref";

/** Zotero 内部「颜色方案」pref（设置 → 常规 → 颜色方案单选组绑定的就是这个）。 */
const THEME_PREF = "browser.theme.toolbar-theme";
const THEME_DARK = 0;
const THEME_LIGHT = 1;
const THEME_AUTO = 2;

/**
 * 读 Zotero 内部颜色方案设置。
 * @returns "dark" / "light"（用户显式选的）；null = 自动（跟 OS）或读不到
 */
export function readThemePref(): "dark" | "light" | null {
  try {
    // 第二参给 2（自动）：Zotero 默认分支里本就是 2（defaults/preferences/
    // zotero.js），这里显式兜一层，免得默认分支被裁时抛异常。
    const value = Services.prefs.getIntPref(THEME_PREF, THEME_AUTO);
    if (value === THEME_DARK) return "dark";
    if (value === THEME_LIGHT) return "light";
    // 自动，或将来新增的取值：交给 OS
    return null;
  } catch {
    return null;
  }
}

/** 宿主是否暗色：先听 Zotero 内部设置，「自动」才回落 OS 媒体查询。 */
export function isDarkScheme(win: Window | null | undefined): boolean {
  const forced = readThemePref();
  if (forced) return forced === "dark";
  try {
    return !!win?.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  } catch {
    return false;
  }
}

/** 当前宿主该用哪张图。 */
export function currentPrefPaneIconURI(win: Window | null | undefined): string {
  return isDarkScheme(win) ? PREF_PANE_ICON_DARK : PREF_PANE_ICON_LIGHT;
}

/**
 * 把图标 URI 写进设置窗侧栏那一行（纯 DOM 操作，便于单测）。
 *
 * Zotero preferences.js 的 _addPane：richlistitem.value = paneID，image 元素
 * 是它的第一个子节点。找不到就静默返回——设置窗没开、或 Zotero 改了 DOM 结构
 * 时不该把宿主搞崩。
 */
export function applyIconToDoc(
  doc: Document | null | undefined,
  iconURI: string,
): boolean {
  try {
    const nav = doc?.getElementById?.("prefs-navigation");
    if (!nav) return false;
    const item = Array.from(nav.children).find(
      (el) => (el as any).value === PREF_PANE_ID,
    );
    const image = item?.querySelector?.("image");
    if (!image) return false;
    if (image.getAttribute("src") !== iconURI) {
      image.setAttribute("src", iconURI);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 同步 Zotero.PreferencePanes.pluginPanes 里我们那项的 image——注册表是「之后
 * 打开设置窗」时的取图来源，只改 DOM 不足以覆盖新窗口。
 */
export function syncRegisteredPaneImage(iconURI: string): boolean {
  try {
    const panes = (globalThis as any).Zotero?.PreferencePanes?.pluginPanes;
    if (!Array.isArray(panes)) return false;
    const ours = panes.find((p: any) => p?.id === PREF_PANE_ID);
    if (!ours) return false;
    ours.image = iconURI;
    return true;
  } catch {
    return false;
  }
}

/** 枚举当前开着的设置窗并换图。 */
export function syncOpenPrefWindows(iconURI: string): number {
  try {
    if (typeof Cc === "undefined" || typeof Ci === "undefined") return 0;
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    let patched = 0;
    for (const win of wm.getEnumerator(PREF_WINDOW_TYPE)) {
      if (applyIconToDoc(win.document, iconURI)) patched++;
    }
    return patched;
  } catch {
    return false as unknown as number;
  }
}

/** 一并把三个目标同步到当前主题。 */
function applyCurrentTheme(win: Window): void {
  const iconURI = currentPrefPaneIconURI(win);
  syncRegisteredPaneImage(iconURI);
  syncOpenPrefWindows(iconURI);
  // _globalThis 只存在于插件主脚本沙箱（bootstrap 的 ctx）。集成用例把本模块
  // 打包进 spec 运行时那里没有它，故 typeof 兜底——别让一次写缓存把宿主炸了。
  try {
    const scope = typeof _globalThis === "undefined" ? undefined : _globalThis;
    if (scope?.addon?.data) {
      scope.addon.data.prefPaneIcon = iconURI;
    }
  } catch {
    /* 写缓存失败不影响换图本身 */
  }
}

/** 每个主窗口挂的订阅（pref 变化 + OS 媒体查询变化），卸载时摘除。 */
const watchers = new WeakMap<Window, { dispose: () => void }>();

/**
 * 订阅主题变化。同一窗口重复调用会先摘掉旧订阅（幂等）。
 *
 * pref 与 matchMedia 两个源都听：前者覆盖用户在 Zotero 里改颜色方案，后者
 * 覆盖「自动」模式下系统主题变了。两个源都触发同一个 applyCurrentTheme——
 * 它是幂等的，重复触发无害。
 */
export function watchPrefPaneIcon(win: _ZoteroTypes.MainWindow): void {
  watchers.get(win)?.dispose();

  const disposers: (() => void)[] = [];
  const onChange = () => applyCurrentTheme(win);

  const mq = win?.matchMedia?.("(prefers-color-scheme: dark)");
  if (mq?.addEventListener) {
    mq.addEventListener("change", onChange);
    disposers.push(() => mq.removeEventListener("change", onChange));
  }

  if (typeof Services !== "undefined" && Services.prefs?.addObserver) {
    const observer = {
      observe: (_subject: unknown, _topic: string, data: string) => {
        if (data === THEME_PREF) onChange();
      },
    };
    try {
      Services.prefs.addObserver(THEME_PREF, observer);
      disposers.push(() => Services.prefs.removeObserver(THEME_PREF, observer));
    } catch {
      // 宿主不给观察 pref 时静默降级：只在窗口加载/注册时取一次图。
    }
  }

  watchers.set(win, {
    dispose: () => {
      for (const off of disposers.splice(0)) {
        try {
          off();
        } catch {
          /* best-effort */
        }
      }
    },
  });
}

/** 主窗口卸载：摘掉该窗口的 pref / matchMedia 订阅。 */
export function unwatchPrefPaneIcon(win: Window): void {
  watchers.get(win)?.dispose();
  watchers.delete(win);
}
