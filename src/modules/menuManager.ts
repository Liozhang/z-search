/**
 * menuManager — z-search 菜单注册（精简版）。
 *
 * 注册两处：
 *  - Tools 菜单：「打开搜索中心」
 *  - 条目右键菜单：「查找相似文献」（对选中条目发起库内向量相似检索）
 */
import { getString } from "../utils/locale";
import { hubWindowManager } from "../ui/hub/HubWindowManager";

const registeredMenus: (() => void)[] = [];

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
  mi.addEventListener("command", () => {
    void hubWindowManager.openHub("search");
  });
  itemMenu.appendChild(sep);
  itemMenu.appendChild(mi);

  registeredMenus.push(() => {
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
