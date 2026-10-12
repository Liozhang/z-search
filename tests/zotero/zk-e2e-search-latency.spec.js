/**
 * zk-e2e-search-latency — 端到端搜索耗时探针（真实 Hub 窗口 + 真实界面）。
 *
 * 背景（2026-12-10 用户报告）：文献搜索总是要十多秒。逐源直测全部 2s 内
 * 返回（见 zk-source-latency-probe），但那绕过了 UI→RPC→合并的完整链路。
 * 本探针打开真实 Hub 窗口，从界面输入触发搜索，每 200ms 采样进度指示
 * 「{done}/{total} sources done · Ns」，直到加载指示消失，得到用户感知
 * 的真实耗时曲线。
 *
 * 结果写 sdt-out/zk-e2e-search-latency.json。
 */
describe("e2e hub search latency probe", function () {
  this.timeout(300000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";

  let hubWindowManager;
  let hubWin;

  function hubDoc() {
    const iframe = hubWin?.document?.getElementById("zsearch-hub-iframe");
    return iframe?.contentDocument || null;
  }

  function hubRoot() {
    return hubDoc()?.getElementById("root") || null;
  }

  function hubIframeWin() {
    return hubWin?.document?.getElementById("zsearch-hub-iframe")
      ?.contentWindow;
  }

  async function writeReport(name, data) {
    try {
      await IOUtils.makeDirectory(OUT_DIR);
    } catch {
      /* 已存在 */
    }
    await Zotero.File.putContentsAsync(
      PathUtils.join(OUT_DIR, name),
      JSON.stringify(data, null, 2),
    );
  }

  /** 进度指示采样：返回 {done,total} 或 null（无指示 = 检索已结束）。 */
  function readProgress() {
    const text = hubRoot()?.textContent || "";
    // zh: 「已完成 3/11 源」 en: 「3/11 sources done」
    const m = text.match(/(\d+)\s*\/\s*(\d+)\s*(?:源|sources done)/);
    if (!m) return null;
    return { done: Number(m[1]), total: Number(m[2]) };
  }

  it("drives a real UI search and samples the progress curve", async function () {
    if (!hubWindowManager) {
      const mod = await import("../../src/ui/hub/HubWindowManager.js");
      hubWindowManager = mod.hubWindowManager;
    }

    await hubWindowManager.openHub("search");
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      hubWin = wm.getMostRecentWindow("zsearch:hub");
      if (hubWin && !hubWin.closed && hubRoot()?.querySelector("input")) break;
      await Zotero.Promise.delay(300);
    }
    if (!hubRoot()?.querySelector("input")) {
      throw { message: "[e2e-latency] hub window/input not ready" };
    }
    await Zotero.Promise.delay(800);

    // React 受控输入设值 + 点「搜索」（与 readme-shots 同法）。
    const input = Array.from(hubRoot().querySelectorAll("input") || []).find(
      (x) => (x.placeholder || "").length > 0 && x.offsetParent !== null,
    );
    if (!input) throw { message: "[e2e-latency] search input not found" };
    const iframeWin = hubIframeWin();
    const setter = Object.getOwnPropertyDescriptor(
      iframeWin.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, "machine learning");
    input.dispatchEvent(new iframeWin.Event("input", { bubbles: true }));
    await Zotero.Promise.delay(400);

    let btn = null;
    let anc = input.parentElement;
    while (anc && anc !== hubRoot()) {
      btn = Array.from(anc.querySelectorAll(":scope > * button")).find(
        (b) =>
          /^(Search|搜索)$/.test((b.textContent || "").trim()) && !b.disabled,
      );
      if (btn) break;
      anc = anc.parentElement;
    }
    const t0 = Date.now();
    if (btn) btn.click();
    else {
      input.dispatchEvent(
        new iframeWin.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    }

    // 采样进度曲线，直到进度指示消失（检索全部结算）或 120s 超时。
    const samples = [];
    let last = null;
    while (Date.now() - t0 < 120000) {
      const p = readProgress();
      const t = Date.now() - t0;
      if (p) {
        if (
          !last ||
          last.done !== p.done ||
          samples.length === 0 ||
          t - samples[samples.length - 1].t >= 1000
        ) {
          samples.push({ t, ...p });
        }
        last = p;
      } else if (samples.length > 0 || t > 3000) {
        // 指示消失：从未出现过（极快完成）或已结算
        break;
      }
      await Zotero.Promise.delay(200);
    }
    const wallMs = Date.now() - t0;

    // 来源筛选 chips 诊断（2026-10-12 功能核验）：完成态下检查结果头里
    // 是否渲染了「源名 · 计数」chips 与计数文案。
    const rootEl = hubRoot();
    const rootText = rootEl ? rootEl.textContent || "" : "";
    const chipLike = (rootText.match(/·\s*\d+/g) || []).length;
    const groups = rootEl
      ? Array.from(
          rootEl.querySelectorAll('[data-slot="toggle-group"]') || [],
        ).map((g) => (g.textContent || "").slice(0, 120))
      : [];
    const items = rootEl
      ? Array.from(
          rootEl.querySelectorAll('[data-slot="toggle-group-item"]') || [],
        ).map((g) => (g.textContent || "").slice(0, 40))
      : [];
    const cardBoxes = rootEl
      ? rootEl.querySelectorAll('input[type="checkbox"]').length
      : -1;
    const countMatch = rootText.match(/共\s*\d+\s*条/);

    // 筛选行为核验：点击第一个来源 chip → 勾选集/计数应收窄；点「全部」→
    // 恢复。checkbox 数 = 当前窗口内可见卡片数（VISIBLE_STEP 封顶）。
    async function clickChipByText(re) {
      const el = Array.from(
        rootEl.querySelectorAll('[data-slot="toggle-group-item"]') || [],
      ).find((b) => re.test((b.textContent || "").trim()));
      if (el) {
        el.click();
        await Zotero.Promise.delay(400);
      }
      return !!el;
    }
    const filterCheck = { clicked: false };
    if (rootEl) {
      filterCheck.clicked = await clickChipByText(/CrossRef/i);
      await Zotero.Promise.delay(200);
      filterCheck.checkboxAfterChip = rootEl.querySelectorAll(
        'input[type="checkbox"]',
      ).length;
      filterCheck.countAfterChip =
        (rootEl.textContent || "").match(/共\s*\d+\s*条/)?.[0] ?? null;
      const allBtn = Array.from(rootEl.querySelectorAll("button") || []).find(
        (b) => /^(全部|All)$/.test((b.textContent || "").trim()),
      );
      if (allBtn) {
        allBtn.click();
        await Zotero.Promise.delay(200);
        filterCheck.countAfterAll =
          (rootEl.textContent || "").match(/共\s*\d+\s*条/)?.[0] ?? null;
      }
    }

    // 数据路径取证：绕过 UI，直接走桥接调单源检索，看回执条目的
    // source/sources 字段是否带值（区分「数据为空」还是「渲染条件错」）。
    let bridgeProbe;
    try {
      const iwin = hubIframeWin();
      const bridge =
        (iwin && iwin.__hubBridge) || (iwin && iwin.__bridge) || null;
      if (bridge && typeof bridge.request === "function") {
        const resp = await bridge.request(
          "literature.search",
          { query: "machine learning", sources: ["crossref"], maxResults: 5 },
          30000,
        );
        const arts = resp?.data?.articles || resp?.articles || [];
        bridgeProbe = {
          bridgeName: iwin && iwin.__hubBridge ? "__hubBridge" : "__bridge",
          articleCount: arts.length,
          first: arts[0]
            ? {
                source: arts[0].source,
                sources: arts[0].sources,
                title: String(arts[0].title || "").slice(0, 60),
              }
            : null,
        };
      } else {
        bridgeProbe = {
          error: "no bridge on iframe window",
          hasHub: !!(iwin && iwin.__hubBridge),
          hasPm: !!(iwin && iwin.__bridge),
        };
      }
    } catch (e) {
      bridgeProbe = { error: String(e?.message ?? e).slice(0, 200) };
    }

    // 首张结果卡的完整文本（来源徽标是否在场）。
    let firstCardText = null;
    try {
      const card = hubRoot()?.querySelector('[data-slot="card"], .card');
      firstCardText = card
        ? (card.textContent || "").slice(0, 200)
        : (hubRoot()?.textContent || "").slice(0, 0);
    } catch {
      /* ignore */
    }

    // 高级检索取证：标题限定经 arXiv 编译（ti:"..."）后的实际召回——命中
    // 标题应包含限定词。与上面的无条件调用对照。
    let advancedProbe;
    try {
      const iwin2 = hubIframeWin();
      const bridge2 =
        (iwin2 && iwin2.__hubBridge) || (iwin2 && iwin2.__bridge) || null;
      if (bridge2 && typeof bridge2.request === "function") {
        const resp = await bridge2.request(
          "literature.search",
          {
            query: "attention",
            sources: ["arxiv"],
            title: "transformer",
            maxResults: 5,
          },
          30000,
        );
        const arts = resp?.data?.articles || resp?.articles || [];
        advancedProbe = {
          articleCount: arts.length,
          titles: arts.map((a) => String(a.title || "").slice(0, 60)),
        };
      } else {
        advancedProbe = { error: "no bridge" };
      }
    } catch (e) {
      advancedProbe = { error: String(e?.message ?? e).slice(0, 200) };
    }

    // 结果内关键词过滤 UI 核验：向筛选框输入「transformer」→ 计数应收窄。
    const keywordCheck = { typed: false };
    try {
      const kwInput = Array.from(
        rootEl.querySelectorAll(
          'input[aria-label*="关键词筛选"], input[aria-label*="keyword"]',
        ) || [],
      ).find((x) => x.offsetParent !== null);
      if (kwInput) {
        const iwin3 = hubIframeWin();
        const setter = Object.getOwnPropertyDescriptor(
          iwin3.HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(kwInput, "transformer");
        kwInput.dispatchEvent(new iwin3.Event("input", { bubbles: true }));
        await Zotero.Promise.delay(400);
        keywordCheck.typed = true;
        keywordCheck.countAfterKeyword =
          (rootEl.textContent || "").match(/共\s*\d+\s*条/)?.[0] ?? null;
      } else {
        keywordCheck.error = "keyword input not found";
      }
    } catch (e) {
      keywordCheck.error = String(e?.message ?? e).slice(0, 200);
    }

    const report = {
      wallMs,
      samples,
      bridgeProbe,
      advancedProbe,
      firstCardText,
      filterCheck,
      keywordCheck,
      chips: {
        chipLikeTextCount: chipLike,
        toggleGroupTexts: groups,
        toggleItemTexts: items,
        cardCheckboxes: cardBoxes,
        countText: countMatch ? countMatch[0] : null,
        textExcerpt: rootText.slice(
          Math.max(0, rootText.indexOf("复制清单") - 260),
          rootText.indexOf("复制清单") + 80,
        ),
      },
      note: "t 为自点击起的毫秒；done/total 为进度指示读数；指示消失即检索结算",
    };
    await writeReport("zk-e2e-search-latency.json", report);

    // 关窗，不留测试窗口
    try {
      hubWindowManager.closeAll();
    } catch {
      /* ignore */
    }
  });
});
