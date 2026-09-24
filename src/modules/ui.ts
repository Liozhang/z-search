/**
 * ui — 主窗口侧 DOM 注入（当前仅保留样式表的占位注册）。
 *
 * z-search 的全部界面都在 Hub 独立窗内（chrome://zsearch/content/hub），主
 * 窗口历史上注入过工具栏按钮（2026-09-23 移除：入口重复——Tools 菜单与条目
 * 右键菜单都能打开搜索中心，工具栏上的 logo 钮只占位）。样式表注册同样留空，
 * 因为主窗口当前无注入需求；两个导出保留是为了让
 * src/hooks/windowLifecycle.ts 的注册/反注册对保持称，加需求时直接填实现。
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
