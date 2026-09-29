/**
 * yyy-ui-audit — 界面巡检截图生成器（视觉和谐度与 Zotero 适配度分析用）。
 *
 * 与 readme-shots 套件同机制：zh-CN locale 强制 + chrome 特权 drawWindow
 * 整窗 PNG，输出落 sdt-out/ui-audit/。覆盖 readme 三图之外的关键界面：
 *
 *   1. Zotero 主窗口（工具栏放大镜按钮 + 条目树 + 种子条目）
 *   2. Hub 本地搜索 tab（初始态 / 检索后 / 筛选弹窗）
 *   3. Hub 主页 tab
 *   4. Zotero 偏好窗的 z-search 面板（顶屏 / 滚动后）
 *
 * 文献结果与期刊两域的截图由 readme-shots 套件产出，本套件不重复。
 */
describe("z-search ui audit screenshots (zh-CN)", function () {
  this.timeout(300000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out\\ui-audit";

  let hubWindowManager;
  let hubWin;

  function reportError(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message: `[ui-audit][${name}] ${reason}\n${e?.stack || ""}`.slice(
        0,
        1500,
      ),
    };
  }

  async function ensureOutDir() {
    try {
      await IOUtils.makeDirectory(OUT_DIR);
    } catch {
      /* 已存在 */
    }
    return !!(await IOUtils.exists(OUT_DIR));
  }

  async function waitFor(pred, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const v = pred();
      if (v) return v;
      await Zotero.Promise.delay(500);
    }
    return pred();
  }

  function mainWindow() {
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    return wm.getMostRecentWindow("navigator:browser");
  }

  function hubDoc() {
    const iframe = hubWin?.document?.getElementById("zsearch-hub-iframe");
    return iframe?.contentDocument || null;
  }

  function hubRoot() {
    return hubDoc()?.getElementById("root") || null;
  }

  function hubWin2() {
    return hubWin?.document?.getElementById("zsearch-hub-iframe")
      ?.contentWindow;
  }

  function findBtn(textRe) {
    const root = hubRoot();
    return (
      Array.from(root?.querySelectorAll("button") || []).find((b) =>
        textRe.test((b.textContent || "").trim()),
      ) || null
    );
  }

  async function openHubReady() {
    await hubWindowManager.openHub("search");
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      hubWin = wm.getMostRecentWindow("zsearch:hub");
      if (hubWin && !hubWin.closed && hubRoot()?.querySelector("input")) break;
      await Zotero.Promise.delay(300);
    }
    if (!(hubWin && hubRoot()?.querySelector("input"))) {
      throw { message: "[ui-audit] hub window/input not ready" };
    }
    const dw = hubWin.innerWidth - 1280;
    const dh = hubWin.innerHeight - 860;
    if (dw !== 0 || dh !== 0) hubWin.resizeTo(1280 + dw, 860 + dh);
    await Zotero.Promise.delay(800);
  }

  /** React 受控输入设值 + 点「搜索」（pane 内寻钮，keep-alive 防误配）。 */
  async function runUiSearch(query, placeholderRe) {
    const root = hubRoot();
    const input = await waitFor(() => {
      const i = Array.from(root.querySelectorAll("input") || []).find(
        (x) =>
          placeholderRe.test(x.placeholder || "") && x.offsetParent !== null,
      );
      return i || null;
    }, 15000);
    if (!input) {
      throw { message: `[ui-audit] input not visible for ${placeholderRe}` };
    }
    const win = hubWin2();
    const setter = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, query);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    await Zotero.Promise.delay(400);
    let anc = input.parentElement;
    let btn = null;
    while (anc && anc !== root) {
      btn = Array.from(anc.querySelectorAll(":scope > * button")).find(
        (b) =>
          /^(Search|搜索)$/.test((b.textContent || "").trim()) && !b.disabled,
      );
      if (btn) break;
      anc = anc.parentElement;
    }
    if (btn) {
      btn.click();
      return;
    }
    input.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  /** chrome 特权 drawWindow：任意 chrome 窗整窗栅格 → PNG 落盘。 */
  async function screenshotWindow(win, name) {
    const doc = win.document;
    const w = win.innerWidth;
    const h = win.innerHeight;
    const canvas = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawWindow(win, 0, 0, w, h, "rgb(255,255,255)");
    const b64 = canvas.toDataURL("image/png").split(",")[1];
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await ensureOutDir();
    await IOUtils.write(PathUtils.join(OUT_DIR, name), bin);
  }

  // ── locale 强制（同 readme-shots 的 before/after 机制）──
  let origRequestedLocales = null;
  let origZoteroLocale = null;

  function localeService() {
    return globalThis.Services
      ? globalThis.Services.locale
      : Cc["@mozilla.org/intl/localeservice;1"].getService(
          Ci.mozILocaleService,
        );
  }

  function addonInstance() {
    return Zotero.ZSearch ?? globalThis.addon ?? null;
  }

  function invalidateLocaleSnapshot() {
    const inst = addonInstance();
    if (inst?.data?.locale) {
      delete inst.data.locale.cacheSnapshot;
      try {
        const Loc = globalThis.Localization;
        if (Loc) {
          inst.data.locale.current = new Loc(
            [
              "zsearch-addon.ftl",
              "zsearch-preferences.ftl",
              "zsearch-tracking.ftl",
            ],
            true,
          );
        }
      } catch {
        /* 保留旧实例 */
      }
    }
  }

  /** 种子条目：给条目树与本地检索提供真实内容（空库截图没有分析价值）。 */
  async function seedItems() {
    const seeds = [
      {
        title:
          "Cancer immunotherapy checkpoint inhibitors in advanced melanoma",
        publicationTitle: "Journal of Clinical Oncology",
        doi: "10.1200/jco.2024.42.7",
        date: "2024-03-01",
        abstractNote:
          "Immune checkpoint blockade has transformed treatment of advanced " +
          "melanoma. We review response rates, biomarkers, and combination " +
          "strategies in oncology.",
      },
      {
        title: "Deep learning for systematic literature review screening",
        publicationTitle: "Journal of Medical Library Association",
        doi: "10.5195/jmla.2023.01",
        date: "2023-06-15",
        abstractNote:
          "Transformer models accelerate title-abstract screening for " +
          "systematic reviews in evidence-based medicine.",
      },
      {
        title: "Academic publishing reform and predatory journals",
        publicationTitle: "Academic Exchange Quarterly",
        doi: "10.7075/aeq.2022.11",
        date: "2022-09-01",
        abstractNote:
          "Editorial quality control and the economics of open-access " +
          "publishing in scholarly communication.",
      },
    ];
    for (const s of seeds) {
      const item = new Zotero.Item("journalArticle");
      item.setField("title", s.title);
      item.setField("publicationTitle", s.publicationTitle);
      item.setField("abstractNote", s.abstractNote);
      item.setField("DOI", s.doi);
      item.setField("date", s.date);
      await item.saveTx();
    }
  }

  before(async function () {
    try {
      const ls = localeService();
      origRequestedLocales = ls.requestedLocales;
      ls.requestedLocales = ["zh-CN"];
      origZoteroLocale = Zotero.locale;
      Zotero.locale = "zh-CN";
      invalidateLocaleSnapshot();
      const mod = await import("../../../src/ui/hub/HubWindowManager.js");
      hubWindowManager = mod.hubWindowManager;
      if (!(await ensureOutDir())) this.skip();
      await seedItems();
    } catch (e) {
      reportError("before", e);
    }
  });

  after(function () {
    try {
      if (origRequestedLocales) {
        try {
          localeService().requestedLocales = origRequestedLocales;
        } catch {
          /* best-effort */
        }
        Zotero.locale = origZoteroLocale;
        invalidateLocaleSnapshot();
      }
      hubWindowManager?.closeAll();
    } catch {
      /* best-effort */
    }
  });

  it("captures the Zotero main window with toolbar button and item tree", async function () {
    try {
      const main = mainWindow();
      if (!main) {
        reportError("main-window", { message: "main window missing" });
      }
      // 等条目树把种子条目渲染出来
      await Zotero.Promise.delay(2500);
      await screenshotWindow(main, "main-window.png");

      // 诊断：期刊指标列单元格空白的归因（数据侧 vs 渲染侧）
      const diag = { dbCount: null, firstRowHTML: null, toolbarBtn: null };
      try {
        const { queryPlain } =
          await import("../../../src/core/data/queryPlain.js");
        const cnt = await queryPlain(
          "SELECT COUNT(*) AS n FROM zsearch_impact_factors",
        );
        diag.dbCount = cnt?.[0]?.n ?? null;
        // 复刻列渲染的查表路径：归一化刊名能否命中数据键
        const { normalizeJournalName } =
          await import("../../../src/core/data/utils/normalize.js");
        diag.normJOC = normalizeJournalName("Journal of Clinical Oncology");
        diag.normAEQ = normalizeJournalName("Academic Exchange Quarterly");
        const joc = await queryPlain(
          "SELECT journal_name, jif, jif_quartile FROM zsearch_impact_factors WHERE journal_name LIKE ? LIMIT 3",
          ["%Clinical Oncology%"],
        );
        diag.jifProbe = joc;
        const bealls = await queryPlain(
          "SELECT journal_name FROM zsearch_bealls_journals WHERE journal_name LIKE ? LIMIT 3",
          ["%Academic Exchange%"],
        );
        diag.beallsProbe = bealls;
      } catch (e) {
        diag.dbCount = "query failed: " + String(e);
      }
      // 视图侧：ItemTree.getRow 是否可用（renderCell 以它反查条目）
      try {
        const view = main.ZoteroPane?.itemsView;
        const r = view?.getRow?.(0);
        diag.viewRow0 = r
          ? {
              pub: r.ref?.getField?.("publicationTitle") ?? null,
            }
          : null;
      } catch (e) {
        diag.viewRow0 = "getRow failed: " + String(e);
      }
      // DOM 侧：树控件真实行结构（不再猜类名）
      const treeEl = main.document.getElementById("itemtree-main");
      diag.treeHeadHTML = treeEl
        ? (treeEl.outerHTML || "").replace(/\s+/g, " ").slice(0, 3000)
        : null;
      diag.toolbarBtn = !!main.document.getElementById(
        "zsearch-tb-open-search",
      );
      await Zotero.File.putContentsAsync(
        PathUtils.join(OUT_DIR, "main-window-diag.json"),
        JSON.stringify(diag, null, 2),
      );
    } catch (e) {
      reportError("main-window", e);
    }
  });

  it("captures the local search tab idle, after query, and filter dialog", async function () {
    try {
      await openHubReady();

      // 切到本地搜索 tab
      const localTab = await waitFor(
        () => findBtn(/^(本地搜索|Local Search)$/),
        15000,
      );
      if (!localTab) {
        reportError("local-search", { message: "local tab missing" });
      }
      localTab.click();
      await Zotero.Promise.delay(2000);
      await screenshotWindow(hubWin, "local-search-idle.png");

      // 库内检索：命中种子条目（向量索引不存在时的真实降级态也如实上屏）
      await runUiSearch("immunotherapy", /标题、摘要与全文|title|abstract/i);
      await waitFor(() => {
        const doc = hubDoc();
        if (!doc) return false;
        // 有结果行，或状态条出现降级/出错/空结果提示即收
        return (
          doc.querySelectorAll("div[role='button'], li").length > 0 ||
          /降级|出错|没有|无结果|no result|degraded|error/i.test(
            doc.body?.textContent || "",
          )
        );
      }, 60000);
      await Zotero.Promise.delay(1500);
      await screenshotWindow(hubWin, "local-search-query.png");

      // 筛选弹窗（本地 scope 的全文范围筛选）
      const filterBtn = findBtn(/^(筛选|Filters)$/);
      if (filterBtn) {
        filterBtn.click();
        await Zotero.Promise.delay(1200);
        await screenshotWindow(hubWin, "local-filter.png");
      }
    } catch (e) {
      reportError("local-search", e);
    }
  });

  /* 「主页」仅存在于子页面包屑（SubPageHeader），独立搜索窗没有
     单独的主页视图（openHub 只收 "search"）——无图可截，不设用例。 */

  it("captures the z-search preferences pane top and scrolled", async function () {
    let prefWin = null;
    try {
      const main = mainWindow();
      prefWin = main.openDialog(
        "chrome://zotero/content/preferences/preferences.xhtml",
        "zotero-prefs-ui-audit",
        "chrome,centerscreen",
      );
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const nav = prefWin.document?.getElementById("prefs-navigation");
        if (prefWin.Zotero_Preferences && nav && nav.itemCount > 5) break;
        await Zotero.Promise.delay(200);
      }
      // navigateToPane 才会真正选中侧栏项并显示面板——_loadPane 只装载
      // 内容不切导航，可见面板停留在「常规」。
      await prefWin.Zotero_Preferences.navigateToPane("zsearch-prefpane");
      const doc = prefWin.document;
      const list = doc.getElementById("zsearch-source-list");
      const deadman = Date.now() + 15000;
      while (Date.now() < deadman && list && list.itemCount < 13) {
        await Zotero.Promise.delay(200);
      }
      await Zotero.Promise.delay(1500);
      await screenshotWindow(prefWin, "prefs-top.png");

      // 面板内容滚动到底再截一张（网络区域、翻译引擎等分组）
      const scroller = Array.from(doc.querySelectorAll("*"))
        .filter(
          (n) => n.scrollHeight > n.clientHeight + 100 && n.clientHeight > 200,
        )
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        await Zotero.Promise.delay(1200);
        await screenshotWindow(prefWin, "prefs-scrolled.png");
      }
    } catch (e) {
      reportError("prefs-pane", e);
    } finally {
      try {
        prefWin?.close();
      } catch {
        /* best-effort */
      }
    }
  });
});
