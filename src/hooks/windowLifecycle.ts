import { registerStyleSheet, unregisterStyleSheet } from "../modules/ui";
import {
  registerMenus,
  unregisterMenus,
  registerToolsMenu,
  unregisterToolsMenu,
} from "../modules/menuManager";
import {
  watchPrefPaneIcon,
  unwatchPrefPaneIcon,
} from "../modules/prefPaneIcon";
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
  await safeRegister("PrefPaneIcon", () => watchPrefPaneIcon(win));
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unregisterStyleSheet(win);
  unregisterToolsMenu(win);
  unregisterMenus(win);
  unwatchPrefPaneIcon(win);
}

export { onMainWindowLoad, onMainWindowUnload };
