/**
 * search-ui-states 集成冒烟（真实 Zotero 内运行）——双 tab 化（2026-09-23）后
 * 的回归守卫。
 *
 *   T1 tab 行：网络/本地两枚，默认网络搜索，点击切换 aria-pressed；
 *   T2 网络 tab：状态条只读外部腿（无「库内」）、工具只有 筛选/清除
 *      （查找相似不露面）、初始空态讲外部数据库；
 *   T3 本地 tab：状态条读库内腿、工具含 查找相似/重复检测、无索引时空态
 *      给出实心「构建全文索引」主按钮（用户裁决：按钮住空态，不平铺横幅）；
 *   T4 清除按需渲染：输入后出现、点了真清空；
 *   T5 筛选弹窗按 tab 分流：网络弹出现源 chips 组，本地弹不出；
 *   T6 pane 级「文献/期刊」对钮仍能切换并切回。
 *
 * 走 iframe 真实 DOM（chrome 同源可达）。React 受控输入用原生 value setter +
 * input 事件驱动（不经 OS 输入层）。若运行环境库内已建索引，T3 CTA 分支
 * 自动跳过（守卫其余断言仍有效）。
 */
describe("z-search search page UI states (real Zotero integration)", function () {
  this.timeout(120000);

  let doc = null;
  let win = null;

  const sleep = (ms) => Zotero.Promise.delay(ms);

  // 前缀匹配：钮带计数角标后 textContent 是「筛选1」，精确相等会失配。
  const findBtn = (text) => {
    const btns = Array.from(doc.querySelectorAll("button"));
    return (
      btns.find((b) => (b.textContent || "").trim().startsWith(text)) || null
    );
  };

  const setInputValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(el, v);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  };

  const switchTab = (label) => {
    findBtn(label).click();
    return sleep(900);
  };

  before(async function () {
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    const mainWindow = wm.getMostRecentWindow("navigator:browser");
    let hubWin = null;
    let deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      hubWin = wm.getMostRecentWindow("zsearch:hub");
      if (
        hubWin &&
        !hubWin.closed &&
        hubWin.document.getElementById("zsearch-hub-iframe")
      ) {
        break;
      }
      // hub 窗未开：走 Tools 菜单项命令打开（与真实用户入口同代码路径）
      const mi = mainWindow.document.getElementById(
        "zsearch-tools-open-search",
      );
      if (mi && typeof mi.doCommand === "function") mi.doCommand();
      await sleep(400);
    }
    expect(hubWin, "hub window opened").to.be.ok;
    const iframe = hubWin.document.getElementById("zsearch-hub-iframe");
    deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      doc = iframe.contentDocument;
      win = iframe.contentWindow;
      const root = doc && doc.getElementById("root");
      if (root && root.children.length > 0 && doc.querySelector("input")) break;
      await sleep(250);
    }
    // React 挂载 + 本地化 + 索引状态查询落定
    await sleep(3000);
    expect(doc, "hub iframe document reachable").to.be.ok;
    expect(doc.querySelector("input"), "search input mounted").to.be.ok;
  });

  it("T1: tab row offers web/local with web as the default scope", function () {
    const web = findBtn("网络搜索");
    const local = findBtn("本地搜索");
    expect(web, "web tab present").to.be.ok;
    expect(local, "local tab present").to.be.ok;
    expect(web.getAttribute("aria-pressed"), "web is the default tab").to.equal(
      "true",
    );
    expect(local.getAttribute("aria-pressed")).to.equal("false");
  });

  it("T2: web tab shows only the external leg and the import-oriented tools", async function () {
    // 默认已在网络 tab；保险起见显式切回（前序用例可能切过 tab）。
    if (findBtn("网络搜索").getAttribute("aria-pressed") !== "true") {
      await switchTab("网络搜索");
    }
    const strip = doc.querySelector(".hub-search-engine-strip");
    expect(strip, "engine strip present").to.be.ok;
    expect(strip.textContent, "external leg labeled").to.contain("外部");
    expect(
      strip.textContent,
      "library leg not shown on web tab",
    ).to.not.contain("库内");
    // 找相似/查重是纯库内操作，网络 tab 不露面
    expect(findBtn("查找相似"), "find-similar hidden on web tab").to.be.null;
    expect(findBtn("重复检测"), "duplicates hidden on web tab").to.be.null;
    expect(findBtn("筛选"), "filter trigger present").to.be.ok;
    const empty = doc.querySelector('[data-slot="empty-state"]');
    expect(empty, "initial empty state present").to.be.ok;
    expect(empty.textContent, "web hint names external databases").to.contain(
      "外部数据库",
    );
    expect(empty.textContent, "no library promise on web tab").to.not.contain(
      "库内",
    );
  });

  it("T3: local tab owns the library leg and puts the build button in the empty state", async function () {
    await switchTab("本地搜索");
    expect(findBtn("本地搜索").getAttribute("aria-pressed")).to.equal("true");
    const strip = doc.querySelector(".hub-search-engine-strip");
    expect(strip, "engine strip present").to.be.ok;
    expect(strip.textContent, "library leg labeled").to.contain("库内");
    expect(strip.textContent, "terse status in the strip").to.contain(
      "未建索引",
    );
    expect(findBtn("查找相似"), "find-similar present on local tab").to.be.ok;
    expect(findBtn("重复检测"), "duplicates present on local tab").to.be.ok;
    expect(
      findBtn("查找相似").querySelector("svg"),
      "find-similar carries an icon",
    ).to.be.ok;
    const bw = win.getComputedStyle(findBtn("查找相似")).borderTopWidth;
    expect(bw, "find-similar reads as a button").to.not.equal("0px");

    // 无索引环境：空态给出实心主按钮（不是横幅里的灰钮）
    const empty = doc.querySelector('[data-slot="empty-state"]');
    if (!empty) return; // 已建索引的环境跳过 CTA 分支
    expect(
      empty.textContent,
      "CTA states only the capability delta",
    ).to.contain("构建全文索引后，可启用");
    const buildBtn = Array.from(empty.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("构建全文索引"),
    );
    expect(buildBtn, "build-index button lives in the empty state").to.be.ok;
    const bg = win.getComputedStyle(buildBtn).backgroundColor;
    expect(bg, "build button is a filled primary action").to.not.equal(
      "rgba(0, 0, 0, 0)",
    );
    expect(buildBtn.disabled, "build button is clickable").to.not.equal(true);
  });

  it("T4: clear appears with a query, empties it, then hides", async function () {
    await switchTab("网络搜索");
    // 初始态（空查询、未检索）不渲染清除
    expect(findBtn("清除"), "clear hidden when nothing to clear").to.be.null;
    const input = doc.querySelector("input");
    setInputValue(input, "glycan");
    await sleep(600);
    const clear = findBtn("清除");
    expect(clear, "clear appears once a query exists").to.be.ok;
    expect(input.value, "query landed in the controlled input").to.equal(
      "glycan",
    );
    clear.click();
    await sleep(600);
    expect(input.value, "clear empties the query").to.equal("");
    expect(findBtn("清除"), "clear retires again").to.be.null;
  });

  it("T5: filter dialog splits zones by tab", async function () {
    // 网络 tab：出现源 chips 组（>=4 项）
    findBtn("筛选").click();
    await sleep(900);
    let dialog = doc.querySelector('[role="dialog"]');
    expect(dialog, "web filter dialog opened").to.be.ok;
    let group = Array.from(
      dialog.querySelectorAll('[data-slot="toggle-group"]'),
    ).find(
      (g) => g.querySelectorAll('[data-slot="toggle-group-item"]').length >= 4,
    );
    expect(group, "sources chip group on the web dialog").to.be.ok;
    group.querySelector('[data-slot="toggle-group-item"]').click();
    await sleep(600);
    const badge = findBtn("筛选").querySelector(".hub-tool-count");
    expect(badge, "active-dimension count badge on the filter button").to.be.ok;
    expect(Number(badge.textContent)).to.be.at.least(1);
    dialog.querySelector(".hub-graph-filter-close").click();
    await sleep(500);

    // 本地 tab：无 chips 组（全文范围 + 结果数）
    await switchTab("本地搜索");
    findBtn("筛选").click();
    await sleep(900);
    dialog = doc.querySelector('[role="dialog"]');
    expect(dialog, "local filter dialog opened").to.be.ok;
    group = Array.from(
      dialog.querySelectorAll('[data-slot="toggle-group"]'),
    ).find(
      (g) => g.querySelectorAll('[data-slot="toggle-group-item"]').length >= 4,
    );
    expect(group, "no sources chip group on the local dialog").to.be.undefined;
    dialog.querySelector(".hub-graph-filter-close").click();
    await sleep(500);
  });

  it("T6: pane-level view toggle switches to the journal dashboard and back", async function () {
    const header = doc.querySelector("header");
    const segBtns = header.querySelectorAll("button");
    const litBtn = segBtns[0];
    const journalBtn = segBtns[1];
    expect(
      litBtn.getAttribute("aria-pressed"),
      "literature is the default view",
    ).to.equal("true");
    journalBtn.click();
    await sleep(1500);
    expect(
      journalBtn.getAttribute("aria-pressed"),
      "journal view active after click",
    ).to.equal("true");
    // 期刊仪表盘的自持三模式对钮（aria-label 与 seg 钮 title 同键）
    const journalLabel = journalBtn.getAttribute("title");
    const modeGroup = Array.from(doc.querySelectorAll('[role="group"]')).find(
      (g) => g.getAttribute("aria-label") === journalLabel,
    );
    expect(modeGroup, "journal dashboard mode toggle rendered").to.be.ok;
    litBtn.click();
    await sleep(1200);
    expect(
      litBtn.getAttribute("aria-pressed"),
      "back to literature view",
    ).to.equal("true");
  });
});
