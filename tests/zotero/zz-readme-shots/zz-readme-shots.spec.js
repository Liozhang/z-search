/**
 * zz-readme-shots — README 期刊截图生成器（docs/screenshots/ 的期刊两张）。
 *
 * 复用 hub-visual-search 的机制（en-US locale 强制 + chrome 特权 drawWindow
 * 整窗 PNG），输出落 sdt-out/readme/，人工核验后拷入 docs/screenshots/。
 * 文献结果图由 hub-visual-search 的首个用例产出（hub-visual-literature.png）。
 *
 * 目录名 zz- 前缀是刻意的：整跑套件时按字母序压轴，before() 的 locale
 * 强制（after() 恢复）不泄漏给中间的中文断言套件。
 */
describe("z-search readme screenshots (journal tab, en-US)", function () {
  this.timeout(300000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out\\readme";
  const OUTPUTS = {};

  let hubWindowManager;
  let hubWin;

  function reportError(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message: `[readme-shots][${name}] ${reason}\n${e?.stack || ""}`.slice(
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

  async function openHubReady(width = 1280, height = 860) {
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
      throw { message: "[readme-shots] hub window/input not ready" };
    }
    // README 尺寸口径：innerWidth×innerHeight = 1280×860（与 docs 里旧图
    // 逐像素同尺寸）。openDialog 的 width/height 是外框尺寸，按实测差值
    // 校正一次。2026-10-14 参数化：指标卡内容少，用 1280×640 紧凑窗口
    // 让卡片充满画面（860 高会留下大片空白）；列表类用例仍用 860。
    const dw = hubWin.innerWidth - width;
    const dh = hubWin.innerHeight - height;
    if (dw !== 0 || dh !== 0) hubWin.resizeTo(width + dw, height + dh);
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
        message: `[readme-shots] input not visible for ${placeholderRe}`,
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
  // 整窗截图。2026-10-14 支持 cropW/cropH：从窗口左上角按 CSS 像素裁剪
  // ——此环境下 openDialog 出窗 2160×1144 且 resizeTo 不生效，指标卡在
  // 860/1144 高的画布上只占顶部三分之一，下方大片空白；按内容目标尺寸
  // 裁剪让卡片充满画面（文字 1:1 输出，比整窗缩放更清晰）。
  async function screenshotHub(name, cropW, cropH) {
    const doc = hubWin.document;
    const w = Math.min(hubWin.innerWidth, cropW || hubWin.innerWidth);
    const h = Math.min(hubWin.innerHeight, cropH || hubWin.innerHeight);
    if (cropW && cropW < hubWin.innerWidth) {
      // 窗口比目标宽：把 Hub iframe 钉到窗口左上并压到目标宽度，让内容
      // 按目标宽重排（右侧数值列等回到画面内），再从左上角裁剪
      const frame = doc.getElementById("zsearch-hub-iframe");
      if (frame) {
        frame.style.position = "fixed";
        frame.style.left = "0";
        frame.style.top = "0";
        frame.style.width = cropW + "px";
        frame.style.height = hubWin.innerHeight + "px";
        await Zotero.Promise.delay(800); // 等 React 按新视口重排
      }
    }
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

  // ── locale 强制（同 hub-visual-search 的 before/after 机制）──
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
      ls.requestedLocales = ["en-US"];
      origZoteroLocale = Zotero.locale;
      Zotero.locale = "en-US";
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

  it("journal metric card with local predatory flag", async function () {
    try {
      // 指标卡内容少：紧凑窗口 1280×560，让卡片充满画面而非浮在空白上
      await openHubReady(1280, 560);

      // 期刊域：三段 tab 行的文字钮（en-US 渲染 Journal）
      const journalTab = await waitFor(
        () => findBtn(/^(Journal|期刊)$/),
        15000,
      );
      if (!journalTab) {
        reportError("journal-metric", { message: "journal tab missing" });
      }
      journalTab.click();
      await Zotero.Promise.delay(1500);

      // 切到 Exact Search（服务侧 metric，直出指标卡）。2026-10-14 修复：
      // 默认的 Fuzzy 模式是 discover——主数据源为 OpenAlex，配额耗尽/被墙
      // 时列表恒空（且此前断言「任意含 predatory 的叶子元素」被列表行
      // 徽章提前满足，截图停在列表、从未进入指标卡）。Exact 模式的指标
      // 卡字段全部来自本地内置表，不依赖配额。
      const exactToggle = await waitFor(
        () => findBtn(/^(Exact Search|精确搜索)$/),
        15000,
      );
      if (!exactToggle) {
        reportError("journal-metric", { message: "exact toggle missing" });
      }
      exactToggle.click();
      await Zotero.Promise.delay(1000);

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
        reportError("journal-metric", { message: "predatory badge missing" });
      }

      await screenshotHub("journal-metrics-en.png", 1280, 640);
      await Zotero.File.putContentsAsync(
        PathUtils.join(OUT_DIR, "journal-metrics.json"),
        JSON.stringify(
          { drive, badge: (badge.textContent || "").trim() },
          null,
          2,
        ),
      );
    } catch (e) {
      reportError("journal-metric", e);
    }
  });

  it("journal discover list for a field", async function () {
    try {
      // 恢复标准 1280×860（上一用例的指标卡把窗缩到了 560；列表类截图
      // 用标准高度，展示更多行）
      await openHubReady();
      // 2026-10-09 模式改名：按匹配策略命名——模糊搜索（en: Fuzzy Search）
      const segBtn = findBtn(/fuzzy search|模糊搜索|模糊搜尋/i);
      if (!segBtn) {
        reportError("journal-discover", { message: "discover toggle missing" });
      }
      segBtn.click();
      await Zotero.Promise.delay(1000);

      await runUiSearch("oncology", /journal name keywords|期刊名称关键词/i);

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
        reportError("journal-discover", { message: "no discover rows" });
      }

      await screenshotHub("journal-discover-en.png", 1280, 860);
      await Zotero.File.putContentsAsync(
        PathUtils.join(OUT_DIR, "journal-discover.json"),
        JSON.stringify({ rows }, null, 2),
      );
    } catch (e) {
      reportError("journal-discover", e);
    }
  });
});
