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
import { getPref, setPref } from "../utils/prefs";
import { hubWindowManager } from "../ui/hub/HubWindowManager";

const registeredMenus: (() => void)[] = [];
/** search.toolbarButton 当前值（未设置=默认显示）。 */
function toolbarButtonEnabled(): boolean {
  const v = getPref("search.toolbarButton");
  return v === undefined || v === null ? true : !!v;
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

  registeredMenus.push(() => {
    itemMenu.removeEventListener("popupshowing", onShowing);
    sep.remove();
    mi.remove();
  });
}

export function unregisterMenus(_win: Window): void {
  for (const off of registeredMenus.splice(0)) {
    try {
      off();
    } catch {
      /* element may already be gone */
    }
  }
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

  registeredMenus.push(() => {
    sep.remove();
    mi.remove();
  });
}

export function unregisterToolsMenu(_win: Window): void {
  for (const off of registeredMenus.splice(0)) {
    try {
      off();
    } catch {
      /* element may already be gone */
    }
  }
}

/**
 * 主窗工具栏按钮 + Ctrl/Cmd+Shift+K 快捷键。
 *
 * 按钮 fill 走 context-fill（-moz-context-properties: fill），与 Zotero 7+
 * 自带工具栏图标同一套主题适配机制；插入位选主工具栏末尾（sync 按钮后），
 * 不挤占 Zotero 原生按钮。search.toolbarButton=false 时按钮隐藏（快捷键
 * 仍可用），pref 变更即时生效（registerObserver 增删）。
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
  btn.setAttribute("tooltiptext", getString("toolbar-open-search-tooltip"));
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

  registeredMenus.push(() => {
    doc.getElementById("zsearch-tb-open-search")?.remove();
  });
  if (keyEl) registeredMenus.push(() => keyEl!.remove());
}

export function unregisterToolbar(): void {
  for (const off of registeredMenus.splice(0)) {
    try {
      off();
    } catch {
      /* element may already be gone */
    }
  }
}

/** 设置面板「显示工具栏按钮」开关的直写入口（preferences.js sandbox 调用）。 */
export function setToolbarButtonPref(value: boolean): void {
  setPref("search.toolbarButton", value);
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
