/**
 * menuManager — z-search 菜单注册（精简版）。
 *
 * 注册四处：
 *  - 主窗工具栏按钮：「打开搜索中心」（search.toolbarButton 可隐藏，默认显示）
 *  - 主窗快捷键：Ctrl/Cmd+Shift+K 开检索窗
 *  - Tools 菜单：「打开搜索中心」
 *  - 条目右键菜单：「查找相似文献」（对选中条目发起库内向量相似检索）
 */
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { hubWindowManager } from "../ui/hub/HubWindowManager";

/**
 * 逐窗登记的反注册器（多主窗隔离）：Zotero 支持 File▸New Window 开多个
 * 主窗，反注册必须只拆本窗的入口——此前是模块级单数组、任一窗卸载即
 * splice 全部，关掉 A 窗会把 B 窗的菜单/工具栏/快捷键一并拆掉且不再重挂。
 */
const disposersByWin = new WeakMap<Window, Array<() => void>>();

function pushDisposer(win: Window, off: () => void): void {
  const list = disposersByWin.get(win) ?? [];
  list.push(off);
  disposersByWin.set(win, list);
}

function runDisposers(win: Window): void {
  const list = disposersByWin.get(win);
  if (!list) return;
  disposersByWin.delete(win);
  for (const off of list) {
    try {
      off();
    } catch {
      /* element may already be gone */
    }
  }
}

/** search.toolbarButton 当前值（未设置=默认显示）。 */
function toolbarButtonEnabled(): boolean {
  const v = getPref("search.toolbarButton");
  return v === undefined || v === null ? true : !!v;
}

/** 快捷键名（macOS 上 accel=Cmd；tooltip 文案据此生成）。 */
function shortcutName(): string {
  return Zotero.isMac ? "Cmd+Shift+K" : "Ctrl+Shift+K";
}

export function registerMenus(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;
  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (!itemMenu) return;

  // ── 条目右键菜单：查找相似文献 ──
  if (doc.getElementById("zsearch-item-find-similar")) return;
  const sep = doc.createXULElement("menuseparator");
  sep.setAttribute("id", "zsearch-item-menu-sep");
  const mi = doc.createXULElement("menuitem");
  mi.setAttribute("id", "zsearch-item-find-similar");
  mi.setAttribute("label", getString("menuitem-find-similar"));
  // 弹出前按选中态启停：找相似只对普通条目（期刊/书籍/文档等）有意义，
  // note/附件/无选中时禁用而非点了以后静默无结果（2026-09-25 审计 P1-3）
  const selectedRegularItem = () => {
    try {
      const items = win.ZoteroPane?.getSelectedItems?.() ?? [];
      return items.length === 1 && items[0].isRegularItem() ? items[0] : null;
    } catch {
      return null;
    }
  };
  const onShowing = () => {
    mi.setAttribute("disabled", selectedRegularItem() ? "false" : "true");
  };
  itemMenu.addEventListener("popupshowing", onShowing);
  mi.addEventListener("command", () => {
    // 深链 action=findSimilar：Hub 开窗后 iframe 自动发起找相似，
    // RPC 侧回退解析主窗选中条目——此前只开窗不检索，是空操作
    void hubWindowManager.findSimilarFromMenu();
  });
  itemMenu.appendChild(sep);
  itemMenu.appendChild(mi);

  pushDisposer(win, () => {
    itemMenu.removeEventListener("popupshowing", onShowing);
    sep.remove();
    mi.remove();
  });
}

export function unregisterMenus(win: Window): void {
  runDisposers(win);
}

export function registerToolsMenu(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;
  const toolsMenu = doc.getElementById("menu_ToolsPopup");
  if (!toolsMenu) return;

  if (doc.getElementById("zsearch-tools-open-search")) return;
  const sep = doc.createXULElement("menuseparator");
  sep.setAttribute("id", "zsearch-tools-menu-sep");
  const mi = doc.createXULElement("menuitem");
  mi.setAttribute("id", "zsearch-tools-open-search");
  mi.setAttribute("label", getString("tools-open-search"));
  mi.addEventListener("command", () => {
    void hubWindowManager.openHub("search");
  });
  toolsMenu.appendChild(sep);
  toolsMenu.appendChild(mi);

  pushDisposer(win, () => {
    sep.remove();
    mi.remove();
  });
}

export function unregisterToolsMenu(win: Window): void {
  runDisposers(win);
}

/**
 * 主窗工具栏按钮 + Ctrl/Cmd+Shift+K 快捷键。
 *
 * 按钮 fill 走 context-fill（-moz-context-properties: fill），与 Zotero 7+
 * 自带工具栏图标同一套主题适配机制；插入位选主工具栏末尾（sync 按钮后），
 * 不挤占 Zotero 原生按钮。search.toolbarButton=false 时按钮隐藏（快捷键
 * 仍可用）；pref 变更的生效路径 = 设置面板写完 pref 后直调 syncToolbarButtons
 * （servicesInit 暴露为 addon.api.syncToolbarButton——Zotero.Prefs 观察者
 * 在本插件作用域实测不可靠，显式同步是确定性路径，commit 019d55b）。
 */
/** 主窗按钮工具栏（Add/Magic Wand 所在的条目树工具栏）。Zotero 9/10 的
 *  真实元素 id 是 zotero-toolbar-item-tree——不存在裸 "zotero-toolbar"
 *  （2026-09-26 实测 omni.ja：zoteroPane.xhtml 只定义
 *  zotero-toolbar-collection-tree / zotero-toolbar-item-tree 两条）。 */
function resolveToolbar(doc: Document): Element | null {
  return (
    doc.getElementById("zotero-toolbar-item-tree") ??
    doc.getElementById("zotero-toolbar")
  );
}

/** 在指定主窗文档上挂工具栏按钮（幂等）。 */
function attachToolbarButton(doc: Document): void {
  const toolbar = resolveToolbar(doc);
  if (!toolbar || doc.getElementById("zsearch-tb-open-search")) return;
  const btn = doc.createXULElement("toolbarbutton");
  btn.setAttribute("id", "zsearch-tb-open-search");
  btn.setAttribute("class", "zotero-tb-button");
  // 键名按平台生成：modifiers=accel 在 macOS 上映射为 Cmd，tooltip 写死
  // 「Ctrl+Shift+K」会让 Mac 用户照着按无效。
  btn.setAttribute(
    "tooltiptext",
    getString("toolbar-open-search-tooltip", {
      args: { shortcut: shortcutName() },
    }),
  );
  btn.setAttribute(
    "style",
    "list-style-image: url('chrome://zsearch/content/icons/search-16.svg'); -moz-context-properties: fill; fill: var(--fill-secondary);",
  );
  btn.addEventListener("command", () => {
    void hubWindowManager.openHub("search");
  });
  toolbar.appendChild(btn);
}

export function registerToolbar(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;
  if (!resolveToolbar(doc)) return;

  // ── 快捷键（mainKeyset 内 <key>，Ctrl/Cmd+Shift+K）──
  const keyset = doc.getElementById("mainKeyset");
  let keyEl: Element | null = null;
  if (keyset && !doc.getElementById("zsearch-key-open-search")) {
    keyEl = doc.createXULElement("key");
    keyEl.setAttribute("id", "zsearch-key-open-search");
    keyEl.setAttribute("modifiers", "accel shift");
    keyEl.setAttribute("key", "K");
    keyEl.addEventListener("command", () => {
      void hubWindowManager.openHub("search");
    });
    keyset.appendChild(keyEl);
  }

  // ── 工具栏按钮（pref 控制显隐，默认显示）──
  if (toolbarButtonEnabled()) attachToolbarButton(doc);

  pushDisposer(win, () => {
    doc.getElementById("zsearch-tb-open-search")?.remove();
  });
  if (keyEl) {
    const el = keyEl;
    pushDisposer(win, () => el.remove());
  }
}

export function unregisterToolbar(win: Window): void {
  runDisposers(win);
}

/**
 * 按 search.toolbarButton 当前值同步所有主窗的工具栏按钮（设置面板写完
 * pref 后直调——pref 观察者在本插件作用域实测不可靠，显式同步是确定性
 * 路径；窗口加载注册时也会各按当前值挂/不挂）。
 */
export function syncToolbarButtons(): void {
  const trace: unknown[] = [];
  (globalThis as any).__zsearchSyncTrace = trace;
  const wins = Zotero.getMainWindows?.() ?? [];
  trace.push(["windows", wins.length]);
  for (const w of wins) {
    const d = (w as _ZoteroTypes.MainWindow).document;
    trace.push([
      "toolbar?",
      !!resolveToolbar(d),
      "btn?",
      !!d.getElementById("zsearch-tb-open-search"),
      "enabled?",
      toolbarButtonEnabled(),
    ]);
    if (!resolveToolbar(d)) continue;
    if (toolbarButtonEnabled()) attachToolbarButton(d);
    else d.getElementById("zsearch-tb-open-search")?.remove();
  }
}
