/**
 * zzz-readme-shots-zh — README 中文截图生成器（docs/screenshots/ 的三张中文图）。
 *
 * 与 zz-readme-shots（英文版）同机制：locale 强制 + chrome 特权 drawWindow
 * 整窗 PNG，输出落 sdt-out/readme/，人工核验后拷入 docs/screenshots/。
 * 文献结果图在这里以 zh-CN 重拍（英文版由 hub-visual-search 首用例产出）。
 *
 * 目录名 zzz- 前缀是刻意的：整跑套件时排在英文截图套件（zz-）之后压轴，
 * before() 的 locale 强制（after() 恢复）互不泄漏。
 */
describe("z-search readme screenshots (literature/journal tabs, zh-CN)", function () {
  this.timeout(300000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out\\readme";
  const OUTPUTS = {};

  let hubWindowManager;
  let hubWin;

  function reportError(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message: `[readme-shots-zh][${name}] ${reason}\n${e?.stack || ""}`.slice(
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

  async function waitFor(pred, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const v = pred();
      if (v) return v;
      await Zotero.Promise.delay(500);
    }
    return pred();
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
      throw { message: "[readme-shots-zh] hub window/input not ready" };
    }
    // README 尺寸口径：innerWidth×innerHeight = 1280×860（与 docs 里英文图
    // 逐像素同尺寸）。openDialog 的 width/height 是外框尺寸，按实测差值
    // 校正一次。
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
      throw {
        message: `[readme-shots-zh] input not visible for ${placeholderRe}`,
      };
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
      return "clicked";
    }
    input.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    return "enter";
  }

  /** chrome 特权 drawWindow：整窗栅格 → PNG 落盘。 */
  async function screenshotHub(name) {
    const doc = hubWin.document;
    const w = hubWin.innerWidth;
    const h = hubWin.innerHeight;
    const canvas = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    );
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawWindow(hubWin, 0, 0, w, h, "rgb(255,255,255)");
    const b64 = canvas.toDataURL("image/png").split(",")[1];
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await ensureOutDir();
    const path = PathUtils.join(OUT_DIR, name);
    await IOUtils.write(path, bin);
    OUTPUTS[name] = path;
  }

  // ── locale 强制（与英文版套件同一套 before/after 机制，方向换成 zh-CN）──
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

  before(async function () {
    try {
      const ls = localeService();
      origRequestedLocales = ls.requestedLocales;
      ls.requestedLocales = ["zh-CN"];
      origZoteroLocale = Zotero.locale;
      // Zotero.locale 同时覆盖：宿主侧富集的 zh/en 数据列选择读它，
      // 不覆盖则结果卡学科徽章仍取英文列。
      Zotero.locale = "zh-CN";
      invalidateLocaleSnapshot();
      const mod = await import("../../../src/ui/hub/HubWindowManager.js");
      hubWindowManager = mod.hubWindowManager;
      if (!(await ensureOutDir())) this.skip();
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

  it("captures a real literature search with metric badges", async function () {
    try {
      await openHubReady();

      const drive = await runUiSearch(
        "cancer immunotherapy",
        /research question|keywords|DOI|研究问题|关键词/i,
      );
      const cards = await waitFor(
        () => hubDoc()?.querySelectorAll(".lit-result-journal").length,
        150000,
      );
      // 等检索收尾（「取消」钮变回「搜索」，状态条脱离「检索中」置灰态）
      await waitFor(() => !!findBtn(/^(Search|搜索)$/), 60000);
      await Zotero.Promise.delay(1500);

      // 把带 IF 徽章的卡滚进视口（虚拟列表只在视口内挂载行）
      const ifCard = hubDoc()?.querySelector(".lit-result-if");
      ifCard?.closest("div[class*='relative'], li, article")?.scrollIntoView?.({
        block: "center",
      });
      if (!ifCard) {
        hubDoc()?.querySelector(".lit-result-journal")?.scrollIntoView?.({
          block: "center",
        });
      }
      await Zotero.Promise.delay(1200);

      await screenshotHub("search-results-zh.png");
      await Zotero.File.putContentsAsync(
        PathUtils.join(OUT_DIR, "search-results-zh.json"),
        JSON.stringify(
          {
            query: "cancer immunotherapy",
            drive,
            cardsAfterWait: cards,
            ifCardFound: !!ifCard,
          },
          null,
          2,
        ),
      );

      if (!cards) {
        reportError("search-results-zh", {
          message: "no cards rendered",
        });
      }
    } catch (e) {
      reportError("search-results-zh", e);
    }
  });

  it("journal metric card with local predatory flag", async function () {
    try {
      // 复用上一用例打开的 Hub 窗（keep-alive），不再重复 openHub

      // 期刊域：三段 tab 行的文字钮（zh-CN 渲染「期刊」）
      const journalTab = await waitFor(
        () => findBtn(/^(Journal|期刊)$/),
        15000,
      );
      if (!journalTab) {
        reportError("journal-metrics-zh", { message: "journal tab missing" });
      }
      journalTab.click();
      await Zotero.Promise.delay(1500);

      const drive = await runUiSearch(
        "Academic Exchange Quarterly",
        /journal name|ISSN|刊名/i,
      );

      // 等本地掠夺性徽章（metric 查证会 best-effort 拉被墙 OpenAlex）
      const badge = await waitFor(() => {
        return (
          Array.from(
            hubDoc()?.querySelectorAll("button, span, div") || [],
          ).find(
            (n) =>
              n.children.length === 0 &&
              /掠夺性|predatory/i.test(n.textContent || ""),
          ) || null
        );
      }, 150000);
      badge?.scrollIntoView?.({ block: "center" });
      await Zotero.Promise.delay(1200);
      if (!badge) {
        reportError("journal-metrics-zh", {
          message: "predatory badge missing",
        });
      }

      await screenshotHub("journal-metrics-zh.png");
      await Zotero.File.putContentsAsync(
        PathUtils.join(OUT_DIR, "journal-metrics-zh.json"),
        JSON.stringify(
          { drive, badge: (badge.textContent || "").trim() },
          null,
          2,
        ),
      );
    } catch (e) {
      reportError("journal-metrics-zh", e);
    }
  });

  it("journal discover list for a field", async function () {
    try {
      const segBtn = findBtn(/discover by field|按领域发现/i);
      if (!segBtn) {
        reportError("journal-discover-zh", {
          message: "discover toggle missing",
        });
      }
      segBtn.click();
      await Zotero.Promise.delay(1000);

      // zh-CN 占位文本是「输入研究领域关键词...」——与研究方向的英文说法
      // 并列覆盖（历史上两种中文文案都出现过）
      await runUiSearch("oncology", /research field|研究领域|研究方向/i);

      // 等 discover 行列表（行内带 ISSN 文本）
      const rows = await waitFor(() => {
        const doc = hubDoc();
        if (!doc) return 0;
        return Array.from(doc.querySelectorAll("div, li, span")).filter((n) =>
          /^ISSN[:：]/.test((n.textContent || "").trim()),
        ).length;
      }, 150000);
      await Zotero.Promise.delay(1500);
      if (!rows) {
        reportError("journal-discover-zh", { message: "no discover rows" });
      }

      await screenshotHub("journal-discover-zh.png");
      await Zotero.File.putContentsAsync(
        PathUtils.join(OUT_DIR, "journal-discover-zh.json"),
        JSON.stringify({ rows }, null, 2),
      );
    } catch (e) {
      reportError("journal-discover-zh", e);
    }
  });
});
