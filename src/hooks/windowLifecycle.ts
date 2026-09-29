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
import { migrateLegacyRealm } from "../utils/secretStore";

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
  // 条目树期刊徽章列（P1-1）：ItemTreeManager 全局一列，逐窗引用计数——
  // 最后一个主窗卸载才反注册
  await safeRegister("MetricsColumn", () => registerMetricsColumn(win));
  // 密钥存储域更名迁移（幂等；每个主窗都会尝试，第二次起为空操作）
  await safeRegister("SecretRealmMigration", async () => {
    await migrateLegacyRealm();
  });
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unregisterStyleSheet(win);
  unregisterToolbar(win);
  unregisterToolsMenu(win);
  unregisterMenus(win);
  unwatchPrefPaneIcon(win);
  unregisterMetricsColumn(win);
}

export { onMainWindowLoad, onMainWindowUnload };
