/**
 * zzh-error-banner — 一次性视觉验收：检索失败横幅（hub-empty-slim）。
 *
 * 2026-09-30 死类清缴批为 hub-empty-slim 补了样式，但常规截图用例只覆盖
 * 成功路径；本用例故意查询不存在的刊名触发错误态，整窗截 PNG 供人工核对。
 * 验收完成后本文件可删除（或留作错误态回归截图的来源）。
 */
describe("z-search error banner capture (hub-empty-slim)", function () {
  this.timeout(300000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";
  let hubWindowManager;
  let hubWin;
  let svc;
  let origSearch;

  function reportError(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message: `[error-banner][${name}] ${reason}\n${e?.stack || ""}`.slice(
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
      throw { message: "[error-banner] hub window/input not ready" };
    }
    await Zotero.Promise.delay(600);
  }

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
      throw { message: `[error-banner] input not visible` };
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
  }

  before(async function () {
    const mod = await import("../../../src/ui/hub/HubWindowManager.js");
    hubWindowManager = mod.hubWindowManager;
    if (!(await ensureOutDir())) this.skip();
  });

  after(async function () {
    try {
      if (svc && origSearch) svc.search = origSearch;
    } catch {
      /* 已还原 */
    }
    try {
      hubWin?.close?.();
    } catch {
      /* 已关 */
    }
    hubWin = null;
  });

  it("captures the journal lookup failure banner", async function () {
    try {
      // 查无此刊走「未找到」空态而非错误态——错误横幅只在宿主 RPC 抛错时
      // 渲染，故打桩 journal.search 服务单例强制抛错（after 还原）。
      const mod =
        await import("../../../src/core/search/JournalSearchService.js");
      svc = mod.default;
      origSearch = svc.search;
      svc.search = async () => {
        throw new Error("强制失败：错误横幅视觉验收");
      };

      await openHubReady();

      const journalTab = await waitFor(
        () => findBtn(/^(Journal|期刊)$/),
        15000,
      );
      if (!journalTab) {
        reportError("error-banner", { message: "journal tab missing" });
      }
      journalTab.click();
      await Zotero.Promise.delay(1500);

      // 不存在的刊名：本地库与 OpenAlex 双双落空 → 走错误态
      await runUiSearch(
        "zz-no-such-journal-qxy-2026",
        /journal name|ISSN|刊名/i,
      );

      const banner = await waitFor(
        () => hubDoc()?.querySelector(".hub-empty-slim") || null,
        150000,
      );
      if (!banner) {
        reportError("error-banner", { message: "hub-empty-slim not rendered" });
      }
      await Zotero.Promise.delay(800);
      await screenshotHub("error-banner.png");
    } catch (e) {
      reportError("error-banner", e);
    }
  });
});
