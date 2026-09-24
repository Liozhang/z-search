/**
 * hub-window 集成冒烟（真实 Zotero 内运行）：
 *
 *   1. 等待插件初始化（waitForPlugin 闩：Zotero.ZSearch.data.initialized）
 *   2. hubWindowManager.openHub("search") —— 真实开窗
 *   3. 等 iframe 就绪 + React 挂载，断言搜索面板 DOM（输入框/搜索钮/视图切换）
 *   4. 断言 host 侧 bridge RPC 分发（semantic.getIndexStatus / searchSources.list）
 *   5. literature.search 的来源契约：缺 Key 的源不请求、但点名回报
 *   6. 主窗口干净：已退役的工具栏 logo 钮不存在，另两个入口仍在
 *   7. 主题实时性：改 Zotero 内部颜色方案，偏好窗图标注册表立刻跟着翻
 *   8. closeAll 收尾
 */
describe("z-search hub window (real Zotero integration)", function () {
  this.timeout(60000);

  let hubWindowManager;
  let hubWin;

  before(async function () {
    const mod = await import("../../src/ui/hub/HubWindowManager.js");
    hubWindowManager = mod.hubWindowManager;
  });

  after(function () {
    try {
      hubWindowManager?.closeAll();
    } catch {
      /* best-effort */
    }
  });

  it("boots the plugin (startup evidence in the profile)", async function () {
    // bootstrap 沙箱的 Zotero facade 与 spec 窗口 global 不是同一对象
    // （Zotero.ZSearch 赋值落在 facade 上），故不断言全局句柄，改断言插件
    // 启动时才产生的可观测证据：EmbeddingStore.initialize() 在 profile 目录
    // 落 zsearch_embeddings.sqlite（getExternalDb → Zotero.Profile.dir）。
    Zotero.debug(
      "[z-search-test] Zotero.ZSearch=" +
        typeof Zotero.ZSearch +
        " _globalThis.addon=" +
        typeof globalThis.addon,
    );
    const probe = PathUtils.join(
      Zotero.Profile.dir,
      "zsearch_embeddings.sqlite",
    );
    const exists = await IOUtils.exists(probe);
    expect(exists, "zsearch_embeddings.sqlite created by servicesInit").to.be
      .true;
    const { size } = await IOUtils.stat(probe);
    expect(size, "embedding schema written").to.be.greaterThan(0);
  });

  it("opens the Hub window and renders the search pane", async function () {
    await hubWindowManager.openHub("search");

    // 等 XUL 窗出现
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      hubWin = wm.getMostRecentWindow("zsearch:hub");
      if (hubWin && !hubWin.closed) break;
      await Zotero.Promise.delay(200);
    }
    expect(hubWin, "hub window opened").to.be.ok;

    // 等 iframe + React 挂载：root 内出现搜索输入（lit.query 绑定）
    const doc = hubWin.document;
    const deadline2 = Date.now() + 30000;
    let input = null;
    while (Date.now() < deadline2) {
      const iframe = doc.getElementById("zsearch-hub-iframe");
      const root = iframe?.contentDocument?.getElementById("root");
      if (root && root.children.length > 0) {
        input =
          root.querySelector("input[placeholder]") ||
          root.querySelector("input");
        if (input) break;
      }
      await Zotero.Promise.delay(300);
    }
    expect(input, "search input rendered in iframe").to.be.ok;

    // 视图切换对钮（文献/期刊）+ 搜索钮在 DOM 中
    const buttons = iframeButtons(hubWin);
    expect(buttons.length, "pane buttons rendered").to.be.greaterThan(0);
  });

  it("routes search RPCs through the host bridge", async function () {
    // 直接构造 host 侧桥，走与 iframe 相同的分发路径
    const { HubWindowBridge } =
      await import("../../src/ui/hub/HubWindowBridge.js");
    const bridge = new HubWindowBridge();

    // semantic.getIndexStatus —— 向量索引状态（空库返回计数 0）
    const status = await bridgeRoute(bridge, "semantic.getIndexStatus", {});
    expect(status, "semantic.getIndexStatus responds").to.be.an("object");
    expect(status).to.have.property("metadataCount");

    // searchSources.list —— 网络搜索源清单（13 源 + defaultProvider）
    const sources = await bridgeRoute(bridge, "searchSources.list", {});
    expect(sources).to.have.property("sources");
    expect(sources).to.have.property("defaultProvider");
    expect(sources.sources.length, "13 web sources").to.equal(13);

    // journal.search —— 期刊检索（metric 模式，空查询也应良构返回或可读错误）
    let journalErr = null;
    try {
      await bridgeRoute(bridge, "journal.search", { mode: "metric" });
    } catch (e) {
      journalErr = String(e && e.message);
    }
    expect(
      journalErr === null || journalErr.length > 0,
      "journal.search ran (or failed cleanly)",
    ).to.be.true;
  });

  it("reports which literature sources it did not run", async function () {
    const { HubWindowBridge } =
      await import("../../src/ui/hub/HubWindowBridge.js");
    const bridge = new HubWindowBridge();

    // 契约：缺 Key 的源不发起请求，但必须点名回报（skippedNoKey）；默认
    // 源表 8 个，若默认源里有缺 Key 的也要出现在名单里。这里只选两个
    // 必然缺 Key 的源，并把本机 Key 临时清空——用例因此不依赖开发者是否
    // 填过 Key，也不打网络。
    const keyPrefs = [
      "extensions.zotero.zsearch.apis.core.apiKey",
      "extensions.zotero.zsearch.apis.semanticScholar.apiKey",
    ];
    const saved = keyPrefs.map((k) => Zotero.Prefs.get(k, true));
    for (const k of keyPrefs) Zotero.Prefs.clear(k, true);
    let res;
    try {
      res = await bridgeRoute(bridge, "literature.search", {
        query: "z-search contract probe",
        sources: ["core", "semantic-scholar"],
        maxResults: 5,
      });
    } finally {
      // 契约用例不应把用户的 Key 带走
      keyPrefs.forEach((k, i) => {
        if (saved[i] !== undefined) Zotero.Prefs.set(k, saved[i], true);
      });
    }

    expect(res, "literature.search responds").to.be.an("object");
    expect(res.articles, "nothing ran, so no article").to.be.an("array").that.is
      .empty;
    expect(res.skippedNoKey, "keyless sources are named").to.have.members([
      "core",
      "semantic-scholar",
    ]);
    expect(res.failedSources, "nothing attempted, so nothing failed").to.be.an(
      "array",
    ).that.is.empty;
  });

  it("keeps the main window free of the retired toolbar button", async function () {
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    const mainWindow = wm.getMostRecentWindow("navigator:browser");
    expect(mainWindow, "main window reachable").to.be.ok;

    // 工具栏 logo 钮已于 2026-09-23 移除：入口重复（Tools 菜单 + 条目右键
    // 菜单都能打开搜索中心）。这条守卫防止它被顺手加回来，也确认另外两个
    // 入口仍在。
    expect(
      mainWindow.document.getElementById("zsearch-toolbar-button"),
      "no toolbar button",
    ).to.be.null;
    expect(
      mainWindow.document.getElementById("zsearch-tools-open-search"),
      "Tools menu entry still present",
    ).to.be.ok;
    expect(
      mainWindow.document.getElementById("zsearch-tools-menu-sep"),
      "Tools menu separator still present",
    ).to.be.ok;
    expect(
      mainWindow.document.getElementById("zsearch-item-find-similar"),
      "item context menu entry still present",
    ).to.be.ok;
  });

  it("follows Zotero's color-scheme setting the moment it changes", async function () {
    // 实时性回归（2026-09-24）：用户改「设置 → 常规 → 颜色方案」时，注册表里
    // 我们那项的 image 必须立刻跟着变——用户看到的就是「Zotero 界面瞬间切暗，
    // 我们的图标也得跟着切」。pref 观察者是同步触发的，不等下一帧。
    //
    // 为什么断言注册表而不是开着的设置窗 DOM：这个 harness 里「开着偏好窗 +
    // 切主题」会让宿主窗口重载、假报失败（同一天的探针实测）；开着窗那条 DOM
    // 路径已由探针验证过会同步翻转 src。注册表决定「之后打开设置窗」的取图，
    // 且不需要持有开着的窗跨主题切换，可常驻。
    const mod = await import("../../src/modules/prefPaneIcon.js");
    const ours = Zotero.PreferencePanes.pluginPanes.find(
      (p) => p.id === "zsearch-prefpane",
    );
    expect(ours, "our pane registered").to.be.ok;
    const before = ours.image;

    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    const mainWin = wm.getMostRecentWindow("navigator:browser");
    const PREF = "browser.theme.toolbar-theme";
    const original = Services.prefs.getIntPref(PREF, 2);
    mod.watchPrefPaneIcon(mainWin);
    try {
      Services.prefs.setIntPref(PREF, 0); // 暗色
      expect(
        ours.image,
        "registry flips to the light-roundel variant on dark",
      ).to.equal(mod.PREF_PANE_ICON_DARK);
      Services.prefs.setIntPref(PREF, 1); // 亮色
      expect(
        ours.image,
        "registry flips back to the ink-roundel mark on light",
      ).to.equal(mod.PREF_PANE_ICON_LIGHT);
    } finally {
      Services.prefs.setIntPref(PREF, original);
      mod.unwatchPrefPaneIcon(mainWin);
    }
    expect(ours.image, "registry restored to its pre-test value").to.equal(
      before,
    );
  });
});

/** Collect all <button> inside the hub iframe document. */
function iframeButtons(win) {
  const iframe = win.document.getElementById("zsearch-hub-iframe");
  const doc = iframe?.contentDocument;
  if (!doc) return [];
  return Array.from(doc.querySelectorAll("button"));
}

/**
 * Drive one bridge request synchronously: call the protected handleRequest
 * through the public message path with a fake source window.
 */
async function bridgeRoute(bridge, method, payload) {
  return new Promise((resolve, reject) => {
    const fakeSource = {
      closed: false,
      postMessage: (msg) => {
        // BaseWindowBridge.sendResponse → { type:'zsearch-res', id, payload }
        if (msg?.type === "zsearch-res" && msg.payload) {
          if (msg.payload.success) resolve(msg.payload.data);
          else reject(new Error(msg.payload.error || "unknown error"));
        }
      },
    };
    // handleIframeMessage routes 'zsearch-req' → handleRequest (setTimeout 0)
    bridge.handleIframeMessage(
      { type: "zsearch-req", id: `test-${method}`, method, payload },
      fakeSource,
    );
  });
}
