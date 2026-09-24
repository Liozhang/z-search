/**
 * hub-visual-search — 结果卡徽章的实机视觉核查（真实 Zotero + 真实网络检索）。
 *
 *   1. openHub("search") 开真实 Hub 窗（文献 scope 默认）
 *   2. 筛选弹窗关掉 ChinaXiv——测试实例无代理，且其返回无视检索词，
 *      会以无关文献灌满 100 条显示上限，把可达源（Crossref/arXiv）的高
 *      被引结果挤出局
 *   3. React 受控输入设值 + 点「搜索」→ 等结果卡（放宽到 150s：被墙源的
 *      TCP 超时会拖慢渐进收尾）→ chrome 特权 drawWindow 截整窗 PNG
 *   4. 徽章统计 + 诊断落 JSON 报告；Beall's 名单期刊名作为第二轮检索词，
 *      结果卡命中同名期刊时掠夺性徽章应点亮
 *
 * 失败一律经 reportError 抛纯对象：runner 的 JSON 往返只保留自有可枚举
 * 属性，普通 Error 的 message 会丢成 undefined。
 */
describe("z-search hub visual search verification (real Zotero + real network)", function () {
  this.timeout(300000);

  // 本 Gecko 的 IOUtils/文件 API 不认正斜杠 Windows 路径
  // （NS_ERROR_FILE_UNRECOGNIZED_PATH）——一律用反斜杠原生路径。
  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";
  const OUTPUTS = {};

  let hubWindowManager;
  let hubWin;
  // 输出目录建不出来（如 CI 的 Linux runner）就整组跳过——本 spec 是
  // 本机实机视觉核查，不作为远程 CI 门禁
  let outDirReady = false;

  function reportError(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message: `[z-search-visual][${name}] ${reason}\n${e?.stack || ""}`.slice(
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

  async function writeReport(name, data) {
    await ensureOutDir();
    const path = PathUtils.join(OUT_DIR, name);
    await Zotero.File.putContentsAsync(
      path,
      JSON.stringify({ ...data, outputs: OUTPUTS }, null, 2),
    );
  }

  function hubDoc() {
    // 卡片在 iframe 的 document 里——查 hubWin.document 永远是 0
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

  function findBtn(text) {
    const root = hubRoot();
    return (
      Array.from(root?.querySelectorAll("button") || []).find((b) =>
        (b.textContent || "").trim().startsWith(text),
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
      throw { message: "[z-search-visual] hub window/input not ready" };
    }
  }

  /** React 受控输入设值 + 点「搜索」。按 placeholder 定位面板——
      keep-alive 让隐藏面板的按钮仍挂在 DOM 里，必须pane 内寻钮。 */
  async function runUiSearch(query, placeholderRe) {
    const root = hubRoot();
    const input =
      Array.from(root.querySelectorAll("input")).find((i) =>
        placeholderRe.test(i.placeholder || ""),
      ) ||
      root.querySelector("input[placeholder]") ||
      root.querySelector("input");
    const win = hubWin2();
    const setter = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, query);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
    await Zotero.Promise.delay(400);
    // 从输入框向上爬，找最近一个同时装有「搜索」钮的祖先——keep-alive
    // 让隐藏面板的同名按钮也挂在 DOM 里，全域找钮会点到隐藏面板去
    let anc = input.parentElement;
    let btn = null;
    while (anc && anc !== root) {
      btn = Array.from(anc.querySelectorAll(":scope > * button")).find(
        (b) => (b.textContent || "").trim().startsWith("搜索") && !b.disabled,
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

  async function waitFor(pred, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const v = pred();
      if (v) return v;
      await Zotero.Promise.delay(500);
    }
    return pred();
  }

  function collectCardStats() {
    const doc = hubDoc();
    if (!doc) return { cards: 0 };
    const cards = doc.querySelectorAll(".lit-result-journal").length;
    const ifs = doc.querySelectorAll(".lit-result-if").length;
    const cites = doc.querySelectorAll(".lit-result-citations").length;
    const metrics = Array.from(
      doc.querySelectorAll(".lit-result-metrics"),
    ).flatMap((n) => Array.from(n.children).map((c) => c.textContent || ""));
    const has = (re) => metrics.some((t) => re.test(t));
    const journals = Array.from(
      doc.querySelectorAll(".lit-result-journal"),
    ).map((n) => (n.textContent || "").trim());
    return {
      cards,
      ifBadges: ifs,
      citationBadges: cites,
      warningBadges: has(/warning|预警/i) ? 1 : 0,
      predatoryBadges: has(/predatory|掠夺/i) ? 1 : 0,
      quartileBadges: has(/Q[1-4]/i) ? 1 : 0,
      metricTagsSample: metrics.slice(0, 12),
      journals,
    };
  }

  /** 直打一次 literature.search RPC，回报服务侧结果（含失败源清单与
      逐篇富集样本——徽章数据正确性的第一手证据）。 */
  async function probeRpcSearch(query, sources) {
    const state = { res: undefined, err: null };
    try {
      const { HubWindowBridge } =
        await import("../../src/ui/hub/HubWindowBridge.js");
      const bridge = new HubWindowBridge();
      bridge.handleIframeMessage(
        {
          type: "zsearch-req",
          id: `visual-probe-${sources.join("-")}`,
          method: "literature.search",
          payload: { query, sources, maxResults: 10 },
        },
        {
          closed: false,
          postMessage: (msg) => {
            if (msg?.type === "zsearch-res" && msg.payload) {
              if (msg.payload.success) state.res = msg.payload.data;
              else state.err = msg.payload.error;
            }
          },
        },
      );
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline && state.res === undefined && !state.err) {
        await Zotero.Promise.delay(500);
      }
    } catch (e) {
      state.err = String(e);
    }
    const articles = state.res?.articles || [];
    return {
      error: state.err,
      articleCount: articles.length,
      failedSources: state.res?.failedSources || [],
      skippedNoKey: state.res?.skippedNoKey || [],
      withCitations: articles.filter((a) => (a.citationCount || 0) > 0).length,
      withJif: articles.filter((a) => a.jif != null).length,
      withQuartile: articles.filter((a) => a.jcrQuartile || a.cassQuartile)
        .length,
      withBealls: articles.filter((a) => a.beallsHit).length,
      samples: articles.slice(0, 10).map((a) => ({
        title: (a.title || "").slice(0, 50),
        journal: a.journal,
        issn: a.issn || null,
        citationCount: a.citationCount,
        jif: a.jif ?? null,
        jcrQuartile: a.jcrQuartile ?? null,
        cassQuartile: a.cassQuartile ?? null,
        warningLevel: a.warningLevel ?? null,
        beallsHit: a.beallsHit ?? null,
      })),
    };
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
    // putContentsAsync 不收 Uint8Array——二进制走 IOUtils.write
    await IOUtils.write(path, bin);
    OUTPUTS[name] = path;
  }

  before(async function () {
    try {
      const mod = await import("../../src/ui/hub/HubWindowManager.js");
      hubWindowManager = mod.hubWindowManager;
      outDirReady = await ensureOutDir();
    } catch (e) {
      reportError("before", e);
    }
    if (!outDirReady) {
      this.skip();
    }
  });

  after(function () {
    try {
      hubWindowManager?.closeAll();
    } catch {
      /* best-effort */
    }
  });

  it("captures a real literature search with metric badges", async function () {
    const pageErrors = [];
    try {
      await openHubReady();
      // 捕获 iframe 页面异常——按钮点击"无声失败"时的第一手线索
      hubWin2()?.addEventListener("error", (e) => {
        pageErrors.push(String(e?.message || e));
      });

      // 服务侧真相：crossref 单源 RPC 的回执（含逐篇富集样本）
      const rpc = await probeRpcSearch("cancer immunotherapy", ["crossref"]);
      await writeReport("hub-visual-crossref-rpc.json", { rpc });

      // 可靠路径：不做筛选交互，直接全源检索（被墙源失败会被状态条点名）
      const drive = await runUiSearch(
        "cancer immunotherapy",
        /研究问题|关键词|DOI/i,
      );
      const cards = await waitFor(
        () => hubDoc()?.querySelectorAll(".lit-result-journal").length,
        150000,
      );
      // 等检索收尾（「取消」钮变回「搜索」，状态条脱离「检索中」置灰态）
      await waitFor(() => !!findBtn("搜索"), 60000);
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

      const stats = collectCardStats();
      await screenshotHub("hub-visual-literature.png");
      await writeReport("hub-visual-literature.json", {
        query: "cancer immunotherapy",
        rpc,
        drive,
        cardsAfterWait: cards,
        ifCardFound: !!ifCard,
        pageErrors,
        ...stats,
      });

      if (stats.cards === 0) {
        reportError("hub-visual-literature", {
          message: `no cards rendered (rpc.articleCount=${rpc.articleCount}, pageErrors=${JSON.stringify(pageErrors)})`,
        });
      }
    } catch (e) {
      reportError("hub-visual-literature", e);
    }
  });

  it("lights the predatory badge for a Beall's-list journal lookup", async function () {
    try {
      // 先直打 journal.search RPC：验证服务层对名单期刊的命中（与 UI 解耦）
      const probe = { res: undefined, err: null };
      try {
        const { HubWindowBridge } =
          await import("../../src/ui/hub/HubWindowBridge.js");
        const bridge = new HubWindowBridge();
        bridge.handleIframeMessage(
          {
            type: "zsearch-req",
            id: "visual-journal-probe",
            method: "journal.search",
            payload: { mode: "metric", query: "Academic Exchange Quarterly" },
          },
          {
            closed: false,
            postMessage: (msg) => {
              if (msg?.type === "zsearch-res" && msg.payload) {
                if (msg.payload.success) probe.res = msg.payload.data;
                else probe.err = msg.payload.error;
              }
            },
          },
        );
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline && probe.res === undefined && !probe.err) {
          await Zotero.Promise.delay(500);
        }
      } catch (e) {
        probe.err = String(e);
      }
      await ensureOutDir();
      await Zotero.File.putContentsAsync(
        PathUtils.join(OUT_DIR, "hub-visual-journal-probe.json"),
        JSON.stringify(probe, null, 2).slice(0, 20000),
      );

      // 期刊仪表盘的 metric 查证是纯本地命中（JCR/CASS/预警/Beall's 内置
      // 库）——确定性渲染掠夺性徽章。文献结果卡的徽章渲染由同一配方覆盖。
      const header = hubDoc()?.querySelector("header");
      const journalBtn = header?.querySelectorAll("button")?.[1];
      if (!journalBtn) {
        reportError("hub-visual-bealls", { message: "journal toggle missing" });
      }
      journalBtn.click();
      await Zotero.Promise.delay(1500);

      // 等 journal 面板的输入框出现在「未隐藏」的 pane 槽里
      await waitFor(() => {
        const input = Array.from(
          hubRoot()?.querySelectorAll("input") || [],
        ).find((i) => /刊名|ISSN/i.test(i.placeholder || ""));
        if (!input) return null;
        const slot = input.closest(".hub-pane-slot");
        return slot && !/hidden/.test(slot.className) ? input : null;
      }, 15000);

      const drive = await runUiSearch(
        "Academic Exchange Quarterly",
        /刊名|ISSN/i,
      );
      const hit = await waitFor(
        () => {
          const doc = hubDoc();
          if (!doc) return 0;
          return Array.from(doc.querySelectorAll("button, span, div")).filter(
            (n) =>
              n.children.length === 0 &&
              /掠夺性|predatory/i.test(n.textContent || ""),
          ).length;
        },
        150000, // metric 查证会 best-effort 拉被墙的 OpenAlex，等它 TCP 超时
      );
      await Zotero.Promise.delay(1000);

      // 徽章滚进视口再截
      const badge = Array.from(
        hubDoc()?.querySelectorAll("button, span, div") || [],
      ).find(
        (n) =>
          n.children.length === 0 &&
          /掠夺性|predatory/i.test(n.textContent || ""),
      );
      badge?.scrollIntoView?.({ block: "center" });
      await Zotero.Promise.delay(1000);

      const stats = collectCardStats();
      await screenshotHub("hub-visual-bealls.png");
      await writeReport("hub-visual-bealls.json", {
        query: "Academic Exchange Quarterly",
        drive,
        predatoryBadgeNodes: hit,
        badgeFound: !!badge,
        ...stats,
      });

      if (!badge) {
        reportError("hub-visual-bealls", {
          message: "predatory badge not rendered for Beall's-list journal",
        });
      }
    } catch (e) {
      reportError("hub-visual-bealls", e);
    }
  });
});
