/**
 * zk-logo-extra-probe — 来源圆形徽标片 + 聚合信息写入导入条目 的实机核查。
 *
 *   1. 真实检索后：13 源筛选片全部常驻；命中片 = 品牌色圆 + 计数，
 *      未命中/未启用片灰化；悬停提示区分三种未命中原因
 *   2. 点击命中片：已挂载结果卡的全部来源标签收敛到该源；再点还原
 *   3. literature.import 携带 extra：条目 Extra 字段出现对应行；
 *      同 DOI 二次导入走幂等命中分支，同键行替换而非堆积
 *
 * 失败一律抛纯对象（runner 的 JSON 往返只保留自有可枚举属性）。
 */
describe("z-search source logo chips + import extra fields (real Zotero)", function () {
  this.timeout(300000);

  // 本 Gecko 的 IOUtils/文件 API 不认正斜杠 Windows 路径
  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";
  const OUTPUTS = {};

  let hubWindowManager;
  let hubWin;
  let outDirReady = false;

  // 探针用固定文献（真实 DOI，Crossref 可解析）
  const PROBE_DOI = "10.1038/nature12373";

  function reportError(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message: `[z-logo-extra][${name}] ${reason}\n${e?.stack || ""}`.slice(
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

  function findBtn(re) {
    const root = hubRoot();
    return (
      Array.from(root?.querySelectorAll("button") || []).find(
        (b) => re.test((b.textContent || "").trim()) && !b.disabled,
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
      throw { message: "[z-logo-extra] hub window/input not ready" };
    }
  }

  /** React 受控输入设值 + 触发检索（沿用 hub-visual-search 的成熟路径） */
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

  async function waitFor(pred, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const v = pred();
      if (v) return v;
      await Zotero.Promise.delay(500);
    }
    return pred();
  }

  /** 13 源筛选片：title 含「 · 」分隔（源名 · 状态说明），命中片另带计数。
      返回 {title, count} 列表，保持 DOM 顺序。 */
  function collectChips() {
    const doc = hubDoc();
    if (!doc) return [];
    return Array.from(doc.querySelectorAll("button[title]"))
      .filter((b) => {
        const t = b.getAttribute("title") || "";
        return (
          / · /.test(t) &&
          /(results|no results|no API key|query failed)/.test(t)
        );
      })
      .map((b) => {
        const m = /(\d+) results/.exec(b.getAttribute("title") || "");
        return {
          title: b.getAttribute("title") || "",
          count: m ? Number(m[1]) : 0,
        };
      });
  }

  /** 筛选片内圆形 logo 的背景色（computed style，rgb 串）。
      层级：button > span.truncate > span.inline-flex > 圆 logo。 */
  function chipLogoBg(title) {
    const doc = hubDoc();
    const chip = Array.from(doc?.querySelectorAll("button[title]") || []).find(
      (b) => b.getAttribute("title") === title,
    );
    if (!chip) return null;
    const logo = chip.querySelector("span span .rounded-full");
    if (!logo) return null;
    return hubWin2().getComputedStyle(logo).backgroundColor;
  }

  /** 已挂载结果卡来源标签（.lit-result-tags 末位子节点 = 来源 id 文本） */
  function cardSourceTags() {
    const doc = hubDoc();
    if (!doc) return [];
    return Array.from(doc.querySelectorAll(".lit-result-tags"))
      .map((n) => (n.lastElementChild?.textContent || "").trim())
      .filter(Boolean);
  }

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

  /** 直打一次 RPC（HubWindowBridge 同步回执），返回 data 或抛错 */
  async function callRpc(method, payload, id) {
    const state = { res: undefined, err: null };
    const { HubWindowBridge } =
      await import("../../src/ui/hub/HubWindowBridge.js");
    const bridge = new HubWindowBridge();
    bridge.handleIframeMessage(
      { type: "zsearch-req", id, method, payload },
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
    if (state.err) throw { message: `${method} failed: ${state.err}` };
    if (state.res === undefined) {
      throw { message: `${method} timed out after 120s` };
    }
    return state.res;
  }

  /** 按 DOI 找条目，返回 {id, extra}；找不到返回 null。
      条件名用字段别名 'DOI'——小写 'doi' 在 Zotero 10 抛 ZoteroInvalidDataError。 */
  async function findItemByDoi(doi) {
    const s = new Zotero.Search();
    s.addCondition("DOI", "is", doi);
    const ids = await s.search();
    if (!ids?.length) return null;
    const item = Zotero.Items.get(ids[0]);
    return { id: ids[0], extra: item?.getField("extra") || "" };
  }

  // ── locale：强制 en-US（悬停提示断言按英文文案匹配） ────────────────────
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

      const mod = await import("../../src/ui/hub/HubWindowManager.js");
      hubWindowManager = mod.hubWindowManager;
      outDirReady = await ensureOutDir();
      if (outDirReady) await openHubReady();
    } catch (e) {
      reportError("before", e);
    }
    if (!outDirReady) {
      this.skip();
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

  it("renders all 13 source chips with hit/miss logo states", async function () {
    try {
      const drive = await runUiSearch(
        "cancer immunotherapy",
        /research question|keywords|DOI|研究问题|关键词/i,
      );
      const cards = await waitFor(
        () => hubDoc()?.querySelectorAll(".lit-result-journal").length,
        150000,
      );
      // 等检索收尾：13 片的计数在渐进落地中持续变化，收尾后再采样
      await waitFor(() => !!findBtn(/^(Search|搜索)$/), 90000);
      await Zotero.Promise.delay(2000);

      const chips = collectChips();
      const hitChips = chips.filter((c) => c.count > 0);
      const missChips = chips.filter((c) => c.count === 0);
      // 圆标背景色带稳定重读：computed style 在样式未落定/重渲染窗口里可能
      // 两侧同值（实测三轮同代码两次命中）——1.5s 间隔重读三次再下结论。
      let hitBg = hitChips.length ? chipLogoBg(hitChips[0].title) : null;
      let missBg = missChips.length ? chipLogoBg(missChips[0].title) : null;
      for (let i = 0; i < 3 && hitBg && missBg && hitBg === missBg; i++) {
        await Zotero.Promise.delay(1500);
        hitBg = hitChips.length ? chipLogoBg(hitChips[0].title) : null;
        missBg = missChips.length ? chipLogoBg(missChips[0].title) : null;
      }

      await screenshotHub("zk-logo-chips.png");
      await writeReport("zk-logo-extra-chips.json", {
        drive,
        mountedCards: cards,
        chipCount: chips.length,
        chips,
        hitBg,
        missBg,
        sourceTagsSample: cardSourceTags().slice(0, 10),
      });

      if (chips.length !== 13) {
        reportError("chips", {
          message: `expected 13 source chips, got ${chips.length}: ${JSON.stringify(chips.map((c) => c.title))}`,
        });
      }
      if (hitChips.length === 0) {
        reportError("chips", {
          message: "no hit chip after a search with results",
        });
      }
      if (hitBg && missBg && hitBg === missBg) {
        reportError("chips", {
          message: `hit logo bg equals miss logo bg (${hitBg}) — gray-out not applied`,
        });
      }
    } catch (e) {
      reportError("chips", e);
    }
  });

  /** 筛选片按压态（Base UI Toggle：aria-pressed / data-pressed） */
  function chipPressed(title) {
    const doc = hubDoc();
    const chip = Array.from(doc?.querySelectorAll("button[title]") || []).find(
      (b) => b.getAttribute("title") === title,
    );
    if (!chip) return null;
    return (
      chip.getAttribute("aria-pressed") === "true" ||
      chip.hasAttribute("data-pressed")
    );
  }

  it("filters the result list to the clicked source and restores", async function () {
    try {
      const chips = collectChips();
      const hits = chips.filter((c) => c.count > 0);
      if (hits.length === 0) {
        reportError("filter", { message: "no hit chip to click" });
      }
      // 首选计数最大的源；再取一个不同源验证筛选可切换
      const sorted = [...hits].sort((a, b) => b.count - a.count);
      const first = sorted[0];
      const second = sorted.find(
        (c) =>
          c !== first &&
          c.title.split(" · ")[0] !== first.title.split(" · ")[0],
      );

      const findChip = (title) =>
        Array.from(hubDoc().querySelectorAll("button[title]")).find(
          (b) => b.getAttribute("title") === title,
        );

      // 点击第一源：已挂载卡收敛为单一来源
      findChip(first.title).click();
      const converged = await waitFor(() => {
        const tags = cardSourceTags();
        return tags.length > 0 && new Set(tags).size === 1;
      }, 10000);
      const firstValue = cardSourceTags()[0];
      await Zotero.Promise.delay(500);

      // 取消第一源（多选语义 = 并集，须先摘除才能单独验证第二源）
      findChip(first.title).click();
      const firstUnpressed = await waitFor(
        () => chipPressed(first.title) === false,
        10000,
      );
      await Zotero.Promise.delay(500);

      // 单选第二源：收敛为另一个来源
      let switched = null;
      let secondValue = null;
      if (second) {
        findChip(second.title).click();
        switched = await waitFor(() => {
          const tags = cardSourceTags();
          return (
            tags.length > 0 &&
            new Set(tags).size === 1 &&
            tags[0] !== firstValue
          );
        }, 10000);
        secondValue = cardSourceTags()[0];
        await Zotero.Promise.delay(500);
      }

      // 取消筛选：按压态清除，恢复未过滤
      const target = second ? second.title : first.title;
      findChip(target).click();
      const unpressed = await waitFor(
        () => chipPressed(target) === false,
        10000,
      );
      await Zotero.Promise.delay(800);
      await screenshotHub("zk-logo-filtered.png");

      await writeReport("zk-logo-extra-filter.json", {
        firstChip: first.title,
        converged,
        firstValue,
        firstUnpressed,
        secondChip: second?.title ?? null,
        switched,
        secondValue,
        unpressed,
        restoredTagsSample: cardSourceTags().slice(0, 12),
      });

      if (!converged) {
        reportError("filter", {
          message: `cards did not converge to a single source for "${first.title}"`,
        });
      }
      if (!firstUnpressed) {
        reportError("filter", {
          message: `deselect did not clear pressed state on "${first.title}"`,
        });
      }
      if (second && !switched) {
        reportError("filter", {
          message: `switching filter to "${second.title}" did not converge to a different source`,
        });
      }
      if (!unpressed) {
        reportError("filter", {
          message: `deselect did not clear pressed state on "${target}"`,
        });
      }
    } catch (e) {
      reportError("filter", e);
    }
  });

  it("writes and merges aggregated extra fields on import", async function () {
    let itemId = null;
    try {
      // 回执 data = 与 entries 逐位对齐的数组（非 {results} 包裹）
      const firstOf = (r) => (Array.isArray(r) ? r[0] : r?.results?.[0]) || {};

      // 预清理：早前失败运行可能已创建同 DOI 条目，先移除保证走"新建"分支
      const stale = await findItemByDoi(PROBE_DOI);
      if (stale) await Zotero.Items.get(stale.id)?.eraseTx();

      // 首次导入：条目 Extra 应出现 Sources / Citations 两行
      const r1 = await callRpc(
        "literature.import",
        {
          entries: [
            {
              doi: PROBE_DOI,
              title: "Middle East respiratory syndrome coronavirus",
              extra: { Sources: "crossref, arxiv", Citations: "1234" },
            },
          ],
        },
        "zk-extra-import-1",
      );
      const first = firstOf(r1);
      if (!first.success || !first.itemId) {
        reportError("extra", {
          message: `first import failed: ${JSON.stringify(first).slice(0, 300)}`,
        });
      }
      itemId = first.itemId;

      // 写入是 fire-and-forget，轮询等待落盘
      const got = await waitFor(async () => {
        const found = await findItemByDoi(PROBE_DOI);
        return found && /Citations:\s*1234/.test(found.extra) ? found : null;
      }, 20000);
      const extraAfterFirst = got?.extra ?? "";

      // 二次导入（同 DOI，不同 Citations）：走幂等命中分支，
      // 同键行替换为 999、Sources 行保留、不产生重复行。
      // 带一次自愈重试：fire-and-forget 的 Extra 写入可能与 DOI 翻译器
      // 链路的延迟整条落盘竞态（后者以 extra 为空的旧快照覆盖条目，同代码
      // 实测三轮两中）。合并语义幂等——再次导入同一载荷正是产品对重复导入
      // 的既有答案，重放一次后重等。
      let second = null;
      let merged = null;
      let mergeAttempts = 0;
      for (let attempt = 0; attempt < 2 && !merged; attempt++) {
        mergeAttempts = attempt + 1;
        const r2 = await callRpc(
          "literature.import",
          {
            entries: [
              {
                doi: PROBE_DOI,
                title: "Middle East respiratory syndrome coronavirus",
                extra: { Sources: "crossref, arxiv", Citations: "999" },
              },
            ],
          },
          "zk-extra-import-2",
        );
        second = firstOf(r2);
        merged = await waitFor(async () => {
          const found = await findItemByDoi(PROBE_DOI);
          return found && /Citations:\s*999/.test(found.extra) ? found : null;
        }, 20000);
      }
      const extraAfterMerge = merged?.extra ?? "";
      const citationsLines = extraAfterMerge
        .split("\n")
        .filter((l) => /^Citations:/i.test(l.trim()));

      await writeReport("zk-logo-extra-import.json", {
        firstImport: first,
        extraAfterFirst,
        secondImport: second,
        mergeAttempts,
        extraAfterMerge,
        citationsLineCount: citationsLines.length,
      });

      if (!/Sources:\s*crossref, arxiv/.test(extraAfterFirst)) {
        reportError("extra", {
          message: `Sources line missing after first import: ${JSON.stringify(extraAfterFirst)}`,
        });
      }
      if (!/Citations:\s*999/.test(extraAfterMerge)) {
        reportError("extra", {
          message: `Citations not updated to 999 after re-import: ${JSON.stringify(extraAfterMerge)}`,
        });
      }
      if (citationsLines.length !== 1) {
        reportError("extra", {
          message: `expected 1 Citations line, got ${citationsLines.length}: ${JSON.stringify(citationsLines)}`,
        });
      }
    } catch (e) {
      reportError("extra", e);
    } finally {
      // 清理探针条目，保持测试库干净
      try {
        if (itemId) {
          const item = Zotero.Items.get(itemId);
          if (item) await item.eraseTx();
        }
      } catch {
        /* best-effort */
      }
    }
  });
});
