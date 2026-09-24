/* eslint-disable */
var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  const ctx = { rootURI };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js`,
    ctx,
  );
  await Zotero.__addonInstance__.hooks.onStartup();

  // Zotero 设置面板注册（搜索中心的设置项：网页搜索源管理）。fragment +
  // Sandbox 脚本由偏好窗按需载入；插件 shutdown 时 Zotero 自动反注册。
  try {
    const cfg = Zotero.__addonInstance__.data.config;
    // 图标按宿主主题选：亮色侧栏用主标（墨圆白 Z），暗色侧栏用浅墨圆变体
    // （深墨圆在 #303030 上只剩 1.32:1）。URI 由 onStartup 算好放在这里，
    // 缺省回落到主标。chrome:// 绝对路径 Zotero.Plugins.resolveURI 原样透传。
    const iconURI =
      Zotero.__addonInstance__.data.prefPaneIcon ||
      "chrome://zsearch/content/icons/icon-48.png";
    await Zotero.PreferencePanes.register({
      pluginID: cfg.addonID,
      id: "zsearch-prefpane",
      label: cfg.addonName,
      image: iconURI,
      src: `${rootURI}content/preferences.xhtml`,
      scripts: [`${rootURI}content/preferences.js`],
      stylesheets: [`${rootURI}content/preferences.css`],
    });
  } catch (e) {
    Zotero.logError("[z-search] PreferencePanes.register failed: " + e);
  }
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }

  await Zotero.__addonInstance__?.hooks.onShutdown();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {
  // Ask the user whether to remove all z-search data before cleanup. Runs in the
  // chrome context where Services.prompt and Zotero.DB are available.
  try {
    const title = "z-search";
    const message =
      "Remove all z-search data (database tables, files, and preferences)? Click Cancel to keep it.";
    const confirm = Services.prompt.confirm(null, title, message);
    if (!confirm) return;

    // 1. Drop all zsearch_* tables (incl. FTS virtual table + triggers).
    try {
      const tables = await Zotero.DB.queryAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'zsearch_%'",
      );
      for (const row of tables) {
        const name = row && row.name;
        if (name) {
          await Zotero.DB.queryAsync(`DROP TABLE IF EXISTS ${name}`);
        }
      }
      // Explicitly drop FTS virtual table + sync triggers (some builds don't
      // surface virtual tables in the LIKE scan, and triggers must go too).
      await Zotero.DB.queryAsync(
        "DROP TABLE IF EXISTS zsearch_chat_messages_fts",
      );
      await Zotero.DB.queryAsync("DROP TRIGGER IF EXISTS zsearch_fts_ai");
      await Zotero.DB.queryAsync("DROP TRIGGER IF EXISTS zsearch_fts_ad");
      await Zotero.DB.queryAsync("DROP TRIGGER IF EXISTS zsearch_fts_au");
    } catch (e) {
      Zotero.logError("[z-search] Uninstall: DB table cleanup failed: " + e);
    }

    // 2. Remove the z-search data directory under Zotero's data dir.
    try {
      const dataDir = Zotero.DataDirectory && Zotero.DataDirectory.dir;
      if (dataDir) {
        const zsearchDir = PathUtils.join(dataDir, "zsearch");
        try {
          await IOUtils.remove(zsearchDir, { recursive: true });
        } catch (e) {
          // Directory may not exist — not fatal.
        }
      }
    } catch (e) {
      Zotero.logError("[z-search] Uninstall: data dir cleanup failed: " + e);
    }

    // 3. Clear all z-search preferences under the plugin's pref branch.
    try {
      Services.prefs.deleteBranch("extensions.zotero.zsearch");
    } catch (e) {
      Zotero.logError("[z-search] Uninstall: prefs cleanup failed: " + e);
    }
  } catch (e) {
    Zotero.logError("[z-search] Uninstall cleanup failed: " + e);
  }
}
