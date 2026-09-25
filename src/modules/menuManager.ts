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
