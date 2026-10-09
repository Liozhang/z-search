/**
 * zi-import-target-select — 导入目标 Select（跟随主窗选择）实机回归。
 *
 * 背景（2026-10-09）：
 *   学术检索出结果后点击「跟随主窗选择」下拉框，整个 Hub React 树被
 *   "too much recursion" 打穿（顶层 ErrorBoundary 接管，仅剩重试面板）。
 *   根因在 @floating-ui/utils 的 getFrameElement：Hub 是嵌在 XUL chrome
 *   窗里的 iframe，Select 弹层定位时 getOverflowAncestors 沿祖先链走到
 *   iframe 文档的 body，随后经 frameElement 跳进宿主 XUL 文档；XUL 文档
 *   没有 document.body，isBody 判断意外为真，getFrameElement 又取回同一
 *   个 iframe 元素，两个调用帧互相递归直至栈溢出。修复 = patch-package
 *   （patches/@floating-ui+utils+0.2.12.patch）：宿主文档无 body 时不再
 *   跨框架遍历。
 *
 *   本 spec 在真实 Zotero 里走完整链路：开 Hub → 学术检索真实检索 →
 *   点开导入目标 Select → 断言弹层渲染出「跟随主窗选择」选项、无
 *   ErrorBoundary 面板、iframe error 管线无栈溢出；再点选一次选项验证
 *   受控回写不炸。
 *
 * 失败一律经 reportError 抛纯对象（runner 的 JSON 往返只保留自有可枚举
 * 属性，普通 Error 的 message 会丢成 undefined）。
 */
describe("z-search import-target select regression (real Zotero + real network)", function () {
  this.timeout(300000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";

  let hubWindowManager;
  let hubWin;

  function reportError(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message: `[z-search-select][${name}] ${reason}\n${e?.stack || ""}`.slice(
        0,
        1500,
      ),
    };
  }

  function hubDoc() {
    const iframe = hubWin?.document?.getElementById("zsearch-hub-iframe");
    return iframe?.contentDocument || null;
  }

  function hubWin2() {
    return hubWin?.document?.getElementById("zsearch-hub-iframe")
      ?.contentWindow;
  }

  function hubRoot() {
    return hubDoc()?.getElementById("root") || null;
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
      throw { message: "[z-search-select] hub window/input not ready" };
    }
  }

  async function waitFor(pred, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const v = pred();
      if (v) return v;
      await Zotero.Promise.delay(400);
    }
    return pred();
  }

  /** React 受控输入设值 + 点「搜索」（同 hub-visual-search 的锚爬策略）。 */
  async function runUiSearch(query) {
    const root = hubRoot();
    const input =
      Array.from(root.querySelectorAll("input")).find((i) =>
        /DOI|研究问题/.test(i.placeholder || ""),
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
    if (!btn) throw { message: "[z-search-select] search button not found" };
    btn.click();
  }

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

  it("opens the import-target select without stack overflow", async function () {
    try {
      await openHubReady();

      // 真实网络检索（Crossref 免 Key 源可达即可出结果卡）
      await runUiSearch("MHC genotyping alpine chamois");
      const cardReady = await waitFor(() => {
        const root = hubRoot();
        return root &&
          root.querySelectorAll('[data-slot="select-trigger"]').length
          ? root.querySelector('[data-slot="select-trigger"]')
          : null;
      }, 150000);
      if (!cardReady) {
        throw {
          message:
            "[z-search-select] select trigger not rendered after search " +
            "(search failed or toolbar missing)",
        };
      }

      const win = hubWin2();
      const doc = hubDoc();
      // 挂 error 侦听：栈溢出若发生会从这里路过
      const errors = [];
      const onError = (e) => {
        errors.push(
          (e && (e.message || (e.error && e.error.message))) || "unknown",
        );
      };
      win.addEventListener("error", onError);

      // 触发 Select 弹层：焦点 + 真实鼠标事件序列（Base UI Trigger 走
      // mousedown/mouseup/click 链）
      const trigger = doc.querySelector('[data-slot="select-trigger"]');
      trigger.focus();
      const opts = { bubbles: true, cancelable: true, view: win };
      trigger.dispatchEvent(new win.MouseEvent("mousedown", opts));
      trigger.dispatchEvent(new win.MouseEvent("mouseup", opts));
      trigger.dispatchEvent(new win.MouseEvent("click", opts));

      // 弹层应挂进 portal layer 并渲染出「跟随主窗选择」选项
      const popup = await waitFor(() => {
        const el = doc.querySelector('[data-slot="select-content"]');
        return el && el.textContent ? el : null;
      }, 10000);

      win.removeEventListener("error", onError);

      if (!popup) {
        // 崩溃现场取证：ErrorBoundary 面板文本
        const rootText = (hubRoot()?.textContent || "").slice(0, 400);
        throw {
          message:
            "[z-search-select] select popup did not open. rootText=" +
            JSON.stringify(rootText) +
            " iframeErrors=" +
            JSON.stringify(errors.slice(0, 5)),
        };
      }

      const popupText = popup.textContent || "";
      const followOk = /跟随主窗|Follow( the)? (main|primary) window/i.test(
        popupText,
      );
      const rootText = hubRoot()?.textContent || "";
      const boundaryHit = /too much recursion/.test(rootText);
      const stackErrors = errors.filter((m) => /recursion/i.test(m));

      // 截图落盘（失败时可人工目检；成功也留档）
      try {
        await IOUtils.makeDirectory(OUT_DIR);
      } catch {
        /* 已存在 */
      }
      const shotPath = PathUtils.join(OUT_DIR, "import-target-select-open.png");
      try {
        const canvas = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "canvas",
        );
        canvas.width = hubWin.innerWidth;
        canvas.height = hubWin.innerHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawWindow(
          win,
          0,
          0,
          hubWin.innerWidth,
          hubWin.innerHeight,
          "rgb(255,255,255)",
        );
        const dataUrl = canvas.toDataURL("image/png");
        const b64 = dataUrl.split(",")[1];
        await Zotero.File.putContentsAsync(shotPath, atob(b64), "binary");
      } catch (e) {
        Zotero.debug("[z-search-select] screenshot failed: " + e.message);
      }

      expect(followOk, "popup lists the follow option").to.be.true;
      expect(boundaryHit, "no ErrorBoundary stack-overflow panel").to.be.false;
      expect(
        stackErrors,
        "no recursion errors on iframe error pipeline",
      ).to.have.lengthOf(0);
    } catch (e) {
      reportError("open-select", e);
    }
  });

  it("commits a selection (controlled write-back) without stack overflow", async function () {
    try {
      const doc = hubDoc();
      const win = hubWin2();
      if (!doc || !win) throw { message: "hub iframe lost" };

      const popup = doc.querySelector('[data-slot="select-content"]');
      if (!popup) {
        // 上一个用例已验证弹层可开；此处兜底重开一次
        const trigger = doc.querySelector('[data-slot="select-trigger"]');
        trigger.dispatchEvent(
          new win.MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await waitFor(
          () => doc.querySelector('[data-slot="select-content"]'),
          10000,
        );
      }

      const errors = [];
      const onError = (e) =>
        errors.push((e && e.message) || (e && e.error && e.error.message));
      win.addEventListener("error", onError);

      // 点第一项（跟随主窗选择）：受控 onChange → chooseImportTarget(null)
      // → pref 写空串（等于默认态），对用户配置无副作用。
      const item = doc.querySelector('[data-slot="select-item"]');
      if (!item) throw { message: "select item not found" };
      const opts = { bubbles: true, cancelable: true, view: win };
      item.dispatchEvent(new win.MouseEvent("mousedown", opts));
      item.dispatchEvent(new win.MouseEvent("mouseup", opts));
      item.dispatchEvent(new win.MouseEvent("click", opts));

      const closed = await waitFor(
        () => !doc.querySelector('[data-slot="select-content"]'),
        10000,
      );
      win.removeEventListener("error", onError);

      const rootText = hubRoot()?.textContent || "";
      expect(closed, "popup closes after selection").to.be.ok;
      expect(/too much recursion/.test(rootText)).to.be.false;
      expect(errors.filter((m) => /recursion/i.test(m))).to.have.lengthOf(0);
    } catch (e) {
      reportError("commit-selection", e);
    }
  });
});
