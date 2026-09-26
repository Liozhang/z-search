import { registerStyleSheet, unregisterStyleSheet } from "../modules/ui";
import {
  registerMenus,
  unregisterMenus,
  registerToolsMenu,
  unregisterToolsMenu,
  registerToolbar,
  unregisterToolbar,
} from "../modules/menuManager";
import {
  watchPrefPaneIcon,
  unwatchPrefPaneIcon,
} from "../modules/prefPaneIcon";
import {
  registerMetricsColumn,
  unregisterMetricsColumn,
} from "../modules/itemTreeMetricsColumn";
import { safeRegister } from "../utils/safeRegister";

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  win.MozXULElement.insertFTLIfNeeded(
    `${_globalThis.addon.data.config.addonRef}-addon.ftl`,
  );

  // Each registration is isolated so one failure can't abort the rest of
  // window setup (host fault tolerance).
  await safeRegister("StyleSheet", () => registerStyleSheet(win));
  await safeRegister("Menus", () => registerMenus(win));
  await safeRegister("ToolsMenu", () => registerToolsMenu(win));
  await safeRegister("Toolbar", () => registerToolbar(win));
  await safeRegister("PrefPaneIcon", () => watchPrefPaneIcon(win));
  // 条目树期刊徽章列（P1-1）：ItemTreeManager 全局一次注册，随窗卸载反注册
  await safeRegister("MetricsColumn", () => registerMetricsColumn());
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unregisterStyleSheet(win);
  unregisterToolbar();
  unregisterToolsMenu(win);
  unregisterMenus(win);
  unwatchPrefPaneIcon(win);
  unregisterMetricsColumn();
}

export { onMainWindowLoad, onMainWindowUnload };
