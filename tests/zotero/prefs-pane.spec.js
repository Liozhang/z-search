/**
 * prefs-pane 集成冒烟（真实 Zotero 内运行）：
 *
 *   1. 断言 bootstrap 注册的 z-search 偏好面板出现在 Zotero 偏好窗导航
 *      （Zotero.PreferencePanes.pluginPanes 含 zsearch-prefpane）
 *   2. 走偏好窗真实加载路径打开该面板：Zotero_Preferences._loadPane
 *      （parseXULToFragment + Sandbox 脚本 + load 事件 + init）
 *   3. 断言面板 DOM：13 个搜索源行、标题本地化、默认源 menulist、密钥行、
 *      切面板后保持可见
 *   4. 侧栏图标按宿主主题选图（亮=墨圆主标 / 暗=浅墨圆变体），且主题切换的
 *      DOM 改写与注册表改写两条路都真的生效
 *
 * 这条用例守住插件偏好面板的三个历史坑：
 *   - fragment 头禁写 <?xml?> 声明（parseXULToFragment 会把片段包进带
 *     DOCTYPE 的外层文档，中段 XML 声明直接解析失败 → _showPane 不执行、
 *     导航项高亮但内容不切，表现为「点了没反应」）；
 *   - Sandbox 脚本符号对 onload 属性不可见（Zotero 自带面板的脚本进主窗
 *     作用域才可用 onload；插件面板须挂 document load 捕获监听）；
 *   - searchSources handler 返回 {result, error} 信封（直调方需自己剥壳，
 *     桥的分发层才剥）。
 */
describe("z-search preferences pane (real Zotero integration)", function () {
  this.timeout(60000);

  let prefWin;

  before(async function () {
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    const mainWindow = wm.getMostRecentWindow("navigator:browser");
    prefWin = mainWindow.openDialog(
      "chrome://zotero/content/preferences/preferences.xhtml",
      "zotero-prefs-zsearch-test",
      "chrome,centerscreen",
    );
    // 等 Zotero_Preferences.init() 建完导航（含插件面板项）
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const nav = prefWin.document?.getElementById("prefs-navigation");
      if (prefWin.Zotero_Preferences && nav && nav.itemCount > 5) break;
      await Zotero.Promise.delay(200);
    }
  });

  after(function () {
    try {
      prefWin?.close();
    } catch {
      /* best-effort */
    }
  });

  it("registers the z-search pane in the pref window navigation", function () {
    const panes = prefWin.Zotero.PreferencePanes.pluginPanes;
    const ours = panes.filter((p) => p.id === "zsearch-prefpane");
    expect(ours.length, "zsearch-prefpane registered").to.equal(1);
    expect(ours[0].src, "pane src resolves to the built fragment").to.match(
      /preferences\.xhtml$/,
    );
    const nav = prefWin.document.getElementById("prefs-navigation");
    const items = Array.from(nav.children).filter(
      (el) => el.value === "zsearch-prefpane",
    );
    expect(items.length, "nav item present").to.equal(1);
  });

  it("loads the pane fragment and renders the source list", async function () {
    // 直调 _loadPane（公开 navigateToPane 在 _loadPane rejection 时只挂起，
    // select 处理器里未 await，错误不冒泡）——rejection 在此可断言。
    await prefWin.Zotero_Preferences._loadPane("zsearch-prefpane");
    const doc = prefWin.document;
    const list = doc.getElementById("zsearch-source-list");
    // init 异步（searchSources.list + api.t），等源行渲染完成
    const deadman = Date.now() + 15000;
    while (Date.now() < deadman && list.itemCount < 13) {
      await Zotero.Promise.delay(200);
    }

    expect(list.itemCount, "13 web source rows rendered").to.equal(13);

    // 标题走 FTL（非裸键）。caption 的渲染正文是 textContent（label 属性
    // 对动态 caption 不出屏——与 description 同因），故断言 textContent。
    const title = doc.getElementById("zsearch-sources-title");
    expect(title.textContent, "caption localized from FTL").to.equal("搜索源");
    expect(
      doc.getElementById("zsearch-keys-desc").textContent.length,
      "keys description localized (non-empty)",
    ).to.be.greaterThan(0);

    // 默认源 menulist + 密钥区（10 个字段：8 key 源各 1 + google cx + searxng URL）
    expect(doc.getElementById("zsearch-default-provider"), "default menulist")
      .to.be.ok;
    expect(
      doc.getElementById("zsearch-keys-rows").children.length,
      "API key rows rendered from source fields",
    ).to.equal(10);

    // 行勾选态与 addedSources 一致（handler 返回 {result,error} 信封，需解包）
    const state = await prefWin.Zotero.ZSearch.api.searchSources(
      "searchSources.list",
      {},
    );
    expect(state.error, "list error envelope").to.be.null;
    const firstRow = list.firstChild;
    expect(
      firstRow.firstChild.getAttribute("checked"),
      "checkbox reflects added state",
    ).to.equal(
      state.result.addedSources.includes(firstRow.value) ? "true" : "false",
    );

    // 状态列必带 tone-* 色档类（CSS 按语义上色，无类=灰底白字）
    const statusCls = firstRow
      .querySelector(".source-status")
      .getAttribute("class");
    expect(statusCls, "status cell carries a semantic tone class").to.match(
      /source-status tone-(idle|accent|warn|ok|bad)/,
    );

    // 无启用源时给引导语；有启用源时清空
    const note = doc.getElementById("zsearch-source-note");
    if (state.result.addedSources.length === 0) {
      expect(
        note.textContent.length,
        "empty-state hint shown",
      ).to.be.greaterThan(0);
    } else {
      expect(note.textContent, "note cleared when sources exist").to.equal("");
    }

    // 切到本面板并保持可见。navigateToPane 内部已 await waitForPaneSelect
    // （_showPane 随 select 处理器在其之前完成）——不可再单独 await，那是
    // 给「下一次面板选择」新建的 deferred，不触发选择就永远不 resolve。
    await prefWin.Zotero_Preferences.navigateToPane("zsearch-prefpane");
    const pane = doc.getElementById("zsearch-prefpane");
    expect(pane.closest(".pane-container").hidden, "pane shown").to.be.false;
  });

  it("picks the sidebar icon for the host theme and can swap it live", async function () {
    const doc = prefWin.document;
    const nav = doc.getElementById("prefs-navigation");
    const item = Array.from(nav.children).find(
      (el) => el.value === "zsearch-prefpane",
    );
    expect(item, "nav item present").to.be.ok;
    const image = item.querySelector("image");
    expect(image, "sidebar icon element present").to.be.ok;

    // 注册表与 DOM 取的是同一张图
    const registered = prefWin.Zotero.PreferencePanes.pluginPanes.find(
      (p) => p.id === "zsearch-prefpane",
    );
    const src = image.getAttribute("src");
    expect(registered.image, "registered image matches the DOM").to.equal(src);

    // 判据：Zotero 内部「颜色方案」显式选择优先，只在「自动」才跟 OS。
    // browser.theme.toolbar-theme: 0=暗色 1=亮色 2=自动（本机探针实测它驱动
    // chrome 的 prefers-color-scheme）。
    const mod = await import("../../src/modules/prefPaneIcon.js");
    const forced = mod.readThemePref();
    const mq = prefWin.matchMedia("(prefers-color-scheme: dark)").matches;
    const wantDark = forced ? forced === "dark" : mq;
    expect(
      src,
      forced === "dark"
        ? "Zotero set to dark uses the light-roundel variant"
        : forced === "light"
          ? "Zotero set to light uses the ink-roundel mark"
          : mq
            ? "auto + dark OS uses the light-roundel variant"
            : "auto + light OS uses the ink-roundel mark",
    ).to.match(wantDark ? /icon-dark-48\.png$/ : /icon-48\.png$/);

    // 内部设置与 OS 不一致时，必须听 Zotero 的（本轮修复的回归点）
    if (forced === "dark" || forced === "light") {
      expect(wantDark, "Zotero setting overrides the OS signal").to.not.equal(
        mq,
      );
    }

    // 主题切换走的两条路都真的生效：改 DOM + 改注册表（后者覆盖「之后打开
    // 设置窗」的取图）
    const other = wantDark ? mod.PREF_PANE_ICON_LIGHT : mod.PREF_PANE_ICON_DARK;
    expect(mod.applyIconToDoc(doc, other)).to.be.true;
    expect(image.getAttribute("src")).to.equal(other);
    expect(mod.syncRegisteredPaneImage(other)).to.be.true;
    expect(registered.image).to.equal(other);

    // 换回宿主该用的那张，别把这条用例的状态漏给后续用例
    const wanted = wantDark
      ? mod.PREF_PANE_ICON_DARK
      : mod.PREF_PANE_ICON_LIGHT;
    expect(mod.applyIconToDoc(doc, wanted)).to.be.true;
    expect(mod.syncRegisteredPaneImage(wanted)).to.be.true;
  });

  it("renders the academic API key group with required/optional status", async function () {
    const doc = prefWin.document;
    const rows = doc.getElementById("zsearch-academic-keys-rows");
    // init 异步，等学术 key 行渲染完成
    const deadman = Date.now() + 15000;
    while (Date.now() < deadman && rows.children.length < 6) {
      await Zotero.Promise.delay(200);
    }
    expect(
      rows.children.length,
      "6 academic key rows (core/semantic-scholar/openalex/dimensions/pubmed/github)",
    ).to.equal(6);

    // 区标题本地化（caption 渲染正文是 textContent）
    expect(
      doc.getElementById("zsearch-academic-keys-title").textContent,
      "academic group caption localized",
    ).to.equal("学术检索 API Keys");
    expect(
      doc.getElementById("zsearch-academic-keys-desc").textContent.length,
      "academic group description localized",
    ).to.be.greaterThan(0);

    // 字段来自 api.getAcademicKeyFields（apiKeySchema.academic + required 标注）
    const fields = prefWin.Zotero.ZSearch.api.getAcademicKeyFields();
    expect(fields.length, "schema exposes 6 academic fields").to.equal(6);
    const requiredKeys = fields
      .filter((f) => f.required)
      .map((f) => f.prefKey)
      .sort();
    expect(
      requiredKeys,
      "core/semantic-scholar/dimensions are required (they hard-fail without a key)",
    ).to.deep.equal([
      "apis.core.apiKey",
      "apis.dimensions.apiKey",
      "apis.semanticScholar.apiKey",
    ]);

    // 每行：label + 输入框 + 状态列；状态类与「是否必填」一致
    const first = rows.firstChild;
    expect(first.querySelector(".key-label"), "label rendered").to.be.ok;
    const input = first.querySelector(".key-input");
    expect(input, "textbox rendered").to.be.ok;
    // 取键途径/限速提示走 tooltiptext：XUL textbox 不渲染 placeholder，
    // 悬停说明是原生 idiom（同源行 tooltiptext）。
    const tip = input.getAttribute("tooltiptext");
    expect(tip && tip.length > 0, "key hint carried as tooltiptext").to.be.ok;
    expect(tip, "tooltip is localized text, not a bare key").to.not.match(
      /^pref-api-key-/,
    );
    const status = first.querySelector(".key-status");
    expect(status, "status cell rendered").to.be.ok;
    expect(
      status.getAttribute("class"),
      "status carries a tone class",
    ).to.match(/key-status tone-(ok|warn|idle)/);

    // OpenAlex 一栏收的是 API Key，不是邮箱：mailto 池 2026 年初已废
    // （utils/openalexAuth），旧值含 "@" 仍照发但服务端忽略。标签/掩码
    // 形态必须与实现一致，否则用户照着「填邮箱」填了不生效。
    const oaField = fields.find((f) => f.prefKey === "apis.openalex.apiKey");
    expect(oaField, "openalex field exposed").to.be.ok;
    expect(
      oaField.type,
      "openalex input is masked (it is a key now)",
    ).to.not.equal("text");
    const oaRow = Array.from(rows.children)[fields.indexOf(oaField)];
    expect(
      oaRow.querySelector(".key-label").value,
      "openalex label says API Key, not email",
    ).to.equal("OpenAlex · API Key");
    expect(
      oaRow.querySelector(".key-input").getAttribute("tooltiptext"),
      "openalex tooltip explains the mailto deprecation",
    ).to.contain("mailto");

    // 必填行在未填时必须是 warn 色档（否则用户会静默丢源）
    for (const f of fields) {
      const val = prefWin.Zotero.ZSearch.api.getPrefDynamic(f.prefKey);
      if (f.required && !val) {
        const row = Array.from(rows.children)[fields.indexOf(f)];
        expect(
          row.querySelector(".key-status").getAttribute("class"),
          `required key ${f.prefKey} warns while unset`,
        ).to.contain("tone-warn");
      }
    }
  });
});
