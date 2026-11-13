/**
 * zl-identifier-search-e2e — 标识符检索端到端（真实 Hub 窗口 + 真实网络 + 真实界面）。
 *
 * 背景（2026-11-13 用户实测）：DOI 整串进检索框后走关键词扇出——
 * Crossref 的 query= 检索把 10.1038/s41586-021-03819-2 拆成数字碎片
 * 匹配，实测返回 666 万条、前列是编号含 03819 即命中的书名章节；
 * PubMed/arXiv 等源解析不出检索词返回 0 条。修复后标识符查询走精确
 * 反查。本用例从界面输入驱动，同时核对「搜到什么」与「界面展示什么」：
 *
 *   T1 DOI 命中：恰好 1 张卡片，题名/期刊/年份/DOI 与该文一致，
 *      状态条记「1 条」——旧的噪音行为会返回至多 100 张无关卡片
 *   T2 DOI 未命中：0 张卡片 + 状态条明示「未找到标识符对应的文章」
 *      （不是笼统的零结果，也不是谎报检索失败）
 *   T3 DOI 链接形态（https://doi.org/...）：与 T1 同一篇
 *   T4 arXiv 编号命中：Swin Transformer 预印本
 *   T5 PMID 命中：先用 NCBI 由 DOI 反查 PMID，再以 pmid: 形式从界面
 *      检索，断言与 T1 同一篇（两个独立数据源互相印证）；NCBI
 *      不可达时跳过而非失败
 *   T6 关键词路径无回归：正常检索仍返回多源结果且内容相关
 *
 * 结果写 sdt-out/zl-identifier-search-e2e.json（该目录已 gitignore）。
 */

describe("identifier search e2e (real Zotero integration)", function () {
  this.timeout(900000); // 真实跨境链路 + 界面等待，整体放宽到 15 分钟

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";

  // 2021 年 Nature 的 AlphaFold 论文——Crossref 精确反查的已知靶点
  const DOI = "10.1038/s41586-021-03819-2";
  const DOI_TITLE =
    "Highly accurate protein structure prediction with AlphaFold";
  const ARXIV_ID = "2103.14030";
  const ARXIV_TITLE = "Swin Transformer";

  const sleep = (ms) => Zotero.Promise.delay(ms);

  // 状态条忙碌态：「已完成 0/1 源 · N 秒」/「0/1 sources done · Ns」
  const BUSY_RE = /\d+\s*\/\s*\d+\s*(?:源|sources)/;
  const NOT_FOUND_RE = /未找到标识符|No article found for identifier/;
  const FAILED_RE = /查询失败|Lookup failed for identifier/;

  let hubWindowManager;
  let hubWin;
  const report = { cases: [] };

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

  /** 读当前窗口内可见结果卡片（VISIBLE_STEP 封顶；标识符路径只有 1 张）。 */
  function readCards() {
    const root = hubRoot();
    if (!root) return [];
    return Array.from(root.querySelectorAll(".lit-result-card")).map((el) => ({
      title: (el.querySelector(".lit-result-title")?.textContent || "").trim(),
      authors: (
        el.querySelector(".lit-result-authors")?.textContent || ""
      ).trim(),
      journal: (
        el.querySelector(".lit-result-journal")?.textContent || ""
      ).trim(),
      year: (el.querySelector(".lit-result-year")?.textContent || "").trim(),
      doi: (el.querySelector(".lit-result-doi")?.textContent || "").trim(),
    }));
  }

  function statusText() {
    return hubRoot()?.textContent || "";
  }

  async function waitForInput(timeoutMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const root = hubRoot();
      const input = Array.from(root?.querySelectorAll("input") || []).find(
        (x) => (x.placeholder || "").length > 0 && x.offsetParent !== null,
      );
      if (input) return input;
      await sleep(300);
    }
    return null;
  }

  /** 界面输入 + 点「搜索」（与 zk-e2e-search-latency 同款驱动法）。 */
  async function runSearch(text) {
    const root = hubRoot();
    const input = await waitForInput();
    if (!input) throw new Error("[identifier-e2e] 检索输入框未就绪");
    const iframeWin = hubIframeWin();
    const setter = Object.getOwnPropertyDescriptor(
      iframeWin.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, text);
    input.dispatchEvent(new iframeWin.Event("input", { bubbles: true }));
    await sleep(400);

    let btn = null;
    let anc = input.parentElement;
    while (anc && anc !== root) {
      btn = Array.from(anc.querySelectorAll(":scope > * button")).find(
        (b) =>
          /^(Search|搜索)$/.test((b.textContent || "").trim()) && !b.disabled,
      );
      if (btn) break;
      anc = anc.parentElement;
    }
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
  }

  /**
   * 等到本次检索结算：忙碌指示消失且状态稳定，返回结算后的正文与卡片。
   * 至少观察 2.5s，避免采到点击前的旧完成态。
   */
  async function searchAndSettle(text, timeoutMs = 150000) {
    await runSearch(text);
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const body = statusText();
      const busy = BUSY_RE.test(body);
      if (!busy && Date.now() - t0 > 2500) {
        await sleep(600);
        const body2 = statusText();
        if (!BUSY_RE.test(body2)) {
          return { text: body2, cards: readCards(), ms: Date.now() - t0 };
        }
      }
      await sleep(250);
    }
    throw new Error(
      `[identifier-e2e] 等待检索结算超时（${timeoutMs}ms）：${statusText().slice(0, 200)}`,
    );
  }

  function record(name, data) {
    report.cases.push({ name, ...data });
  }

  async function writeReport() {
    try {
      await IOUtils.makeDirectory(OUT_DIR);
      await Zotero.File.putContentsAsync(
        PathUtils.join(OUT_DIR, "zl-identifier-search-e2e.json"),
        JSON.stringify(report, null, 2),
      );
    } catch (e) {
      Zotero.debug("[identifier-e2e] write report failed: " + e);
    }
  }

  /** NCBI 由 DOI 反查 PMID（T5 用；不可达返回 null，用例据此跳过）。 */
  async function pmidForDoi(doi) {
    try {
      const url =
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" +
        `?db=pubmed&term=${encodeURIComponent(doi + "[aid]")}&retmode=json`;
      const resp = await Zotero.HTTP.request("GET", url, {
        timeout: 20000,
        errorDelayMax: 0,
      });
      const ids = JSON.parse(resp.responseText || "{}")?.esearchresult?.idlist;
      return ids && ids.length ? ids[0] : null;
    } catch (e) {
      Zotero.debug("[identifier-e2e] ncbi pmid lookup failed: " + e);
      return null;
    }
  }

  before(async function () {
    const mod = await import("../../src/ui/hub/HubWindowManager.js");
    hubWindowManager = mod.hubWindowManager;
    await hubWindowManager.openHub("search");

    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      hubWin = wm.getMostRecentWindow("zsearch:hub");
      if (hubWin && !hubWin.closed && (await waitForInput(3000))) break;
      await sleep(500);
    }
    if (!hubRoot()) throw new Error("[identifier-e2e] Hub 窗口/输入框未就绪");
    await sleep(800);
  });

  after(async function () {
    await writeReport();
    try {
      hubWin?.close();
    } catch {
      /* 窗口已关 */
    }
  });

  it("T1 DOI 命中：恰好一篇，字段与该文一致，状态条记 1 条", async function () {
    const r = await searchAndSettle(DOI);
    record("T1-doi-hit", {
      ms: r.ms,
      cards: r.cards,
      text: r.text.slice(0, 300),
    });

    // 反噪音断言：旧的碎片匹配行为会返回至多 100 张无关卡片
    expect(r.cards.length, "DOI 检索应只返回精确命中的单篇").to.equal(1);
    const card = r.cards[0];
    expect(card.title).to.contain(DOI_TITLE);
    expect(card.doi).to.contain(DOI);
    expect(card.journal.toLowerCase()).to.contain("nature");
    expect(card.year).to.contain("2021");
    expect(card.authors.toLowerCase()).to.contain("jumper");
    // 状态条完成态（汉字不是正则单字符，不能用 \b 收尾）
    expect(r.text).to.match(/1\s*(?:条|results)/);
  });

  it("T2 DOI 未命中：0 张卡片 + 明示未找到（不谎报故障）", async function () {
    const bogus = "10.1038/zzzz-not-a-real-doi-000";
    const r = await searchAndSettle(bogus);
    record("T2-doi-miss", {
      ms: r.ms,
      cards: r.cards,
      text: r.text.slice(0, 300),
    });

    expect(r.cards.length).to.equal(0);
    expect(r.text, "应提示未找到该标识符对应的文章").to.match(NOT_FOUND_RE);
    expect(r.text, "未命中不得谎报成接口故障").to.not.match(FAILED_RE);
  });

  it("T3 DOI 链接形态：与 T1 同一篇", async function () {
    const r = await searchAndSettle(`https://doi.org/${DOI}`);
    record("T3-doi-url", {
      ms: r.ms,
      cards: r.cards,
      text: r.text.slice(0, 300),
    });

    expect(r.cards.length).to.equal(1);
    expect(r.cards[0].title).to.contain(DOI_TITLE);
    expect(r.cards[0].doi).to.contain(DOI);
  });

  it("T4 arXiv 编号命中：Swin Transformer 预印本", async function () {
    const r = await searchAndSettle(ARXIV_ID);
    record("T4-arxiv-hit", {
      ms: r.ms,
      cards: r.cards,
      text: r.text.slice(0, 300),
    });

    expect(r.cards.length).to.equal(1);
    expect(r.cards[0].title).to.contain(ARXIV_TITLE);
    expect(r.cards[0].year).to.contain("2021");
  });

  it("T5 PMID 命中：与 T1 同一篇（NCBI 反查 PMID 后从界面检索）", async function () {
    const pmid = await pmidForDoi(DOI);
    if (!pmid) {
      record("T5-pmid-hit", { skipped: "NCBI 未返回该 DOI 的 PMID" });
      this.skip();
      return;
    }
    const r = await searchAndSettle(`pmid:${pmid}`);
    record("T5-pmid-hit", {
      pmid,
      ms: r.ms,
      cards: r.cards,
      text: r.text.slice(0, 300),
    });

    expect(r.cards.length).to.equal(1);
    expect(r.cards[0].title).to.contain(DOI_TITLE);
    expect(r.cards[0].doi).to.contain(DOI);
  });

  it("T6 关键词路径无回归：多源结果且内容相关", async function () {
    const r = await searchAndSettle("swin transformer shifted windows", 240000);
    record("T6-keyword", {
      ms: r.ms,
      cardCount: r.cards.length,
      titles: r.cards.map((c) => c.title).slice(0, 10),
      text: r.text.slice(0, 300),
    });

    expect(r.cards.length, "关键词检索应返回多条结果").to.be.greaterThan(1);
    const hit = r.cards.some((c) => /swin/i.test(c.title));
    expect(hit, "结果里应有与查询词相关的论文").to.be.true;
    expect(r.text).to.not.match(NOT_FOUND_RE);
  });
});
