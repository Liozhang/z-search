/**
 * ui — 主窗口侧 DOM 注入（当前仅保留样式表的占位注册）。
 *
 * z-search 的主要界面在 Hub 独立窗内（chrome://zsearch/content/hub）；主窗
 * 的入口注入（工具栏按钮/菜单/快捷键）在 menuManager 注册。本模块只保留
 * 样式表占位注册（当前无注入需求）；两个导出保留是为了让
 * src/hooks/windowLifecycle.ts 的注册/反注册对保持对称，加需求时直接填实现。
 */

/** Track created stylesheet elements per window for cleanup */
const windowStyleSheets = new WeakMap<Window, Element[]>();

export function registerStyleSheet(win: _ZoteroTypes.MainWindow) {
  windowStyleSheets.set(win, []);
}

export function unregisterStyleSheet(win: Window): void {
  const sheets = windowStyleSheets.get(win);
  if (sheets) {
    for (const el of sheets) el.remove();
    windowStyleSheets.delete(win);
  }
}
