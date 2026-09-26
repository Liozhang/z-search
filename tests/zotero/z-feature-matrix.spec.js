/**
 * z-feature-matrix — 执行类功能的实机端到端（真实 Zotero + 真实网络）。
 *
 * 既有套件（hub-window / hub-visual-search / prefs-pane / search-ui-states）
 * 覆盖了开窗、桥路由、徽章视觉、UI 状态与偏好面；本套件补齐「功能真的执行
 * 出结果」的部分（文件名 z- 前缀保证按字母序最后跑，不干扰前面的 locale
 * 切换/恢复）：
 *
 *   S1 literature.import      —— DOI 直采 + 无 DOI 标题回退解析 → 真实建条目
 *   S2 literature.fetchFulltext —— PMC OA 结构化正文 + 不可得时诚实失败
 *   S3 literature.translate   —— 翻译引擎链（Google 免费端点被墙时 Bing web 兜底）
 *   S4 literature.search github —— 仓库搜索映射统一文章结构（★ 独立字段）
 *   S5 searchSources.*        —— missing-key 失败分类 + bing-html 真实搜索 +
 *                                add/setDefault/remove 管理生命周期
 *   S6 semantic.*             —— 本地 ONNX 向量全流程：fixture 入库 → 构建索引 →
 *                                语义检索 → 找相似 → 重复扫描
 *   S7 条目右键深链           —— 菜单入口 → Hub 落本地腿并自动发起找相似
 *   S8 复制清单 / 导出 CSV    —— 结果清单导出链（系统剪贴板回读 + Blob 截获）
 *
 * 断言策略：RPC 一律走与 iframe 相同的 host 桥分发路径（bridgeRoute）；
 * 失败抛纯对象（runner 的 JSON 往返只保留自有可枚举属性）。
 *
 * S6/S7 前置：transformers env.allowRemoteModels=false（不在线下载），本地模型
 * 文件须在 {DataDir}/zsearch/models/<model>/。scaffold 每次测试会 emptyDir
 * 测试数据目录，因此 spec 启动时从 .scaffold/model-cache 拷入（缓存缺失则
 * 整组跳过——诚实报告环境约束，不伪装通过）。
 */
describe("z-search feature matrix (real Zotero end-to-end)", function () {
  this.timeout(300000);

  const OUT_DIR = "D:\\github_code\\z-search\\tests\\zotero\\sdt-out";
  const REPORT = {};

  let bridge = null;
  let hubWindowManager = null;
  let hubWin = null;
  let vectorReady = false; // 模型文件就绪（S6/S7 前置）
  let vectorDupAId = null; // 重复对之一（S7 深链找相似的锚条目）
  const fixtures = []; // 本套件创建的所有条目 id（after 全部清除）

  function reportError(name, e) {
    const reason = e?.message != null ? String(e.message) : String(e);
    throw {
      message: `[z-search-matrix][${name}] ${reason}\n${e?.stack || ""}`.slice(
        0,
        1500,
      ),
    };
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

  async function waitFor(pred, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const v = await pred();
      if (v) return v;
      await Zotero.Promise.delay(500);
    }
    return pred();
  }

  /** runner 桥驱动（S1-S5 服务层 RPC）；向量链路用 route(插件桥, ...)。 */
  function bridgeRoute(method, payload) {
    return route(bridge, method, payload);
  }

  async function makeItem(fields) {
    const item = new Zotero.Item("journalArticle");
    item.setField("title", fields.title);
    if (fields.abstract) item.setField("abstractNote", fields.abstract);
    if (fields.year) item.setField("date", fields.year);
    if (fields.journal) item.setField("publicationTitle", fields.journal);
    item.setCreators([{ creatorType: "author", name: "Zsearch, Test" }]);
    await item.saveTx();
    fixtures.push(item.id);
    return item;
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

  function findBtn(textOrRe) {
    const root = hubRoot();
    return (
      Array.from(root?.querySelectorAll("button") || []).find((b) => {
        const t = (b.textContent || "").trim();
        return typeof textOrRe === "string"
          ? t.startsWith(textOrRe)
          : textOrRe.test(t);
      }) || null
    );
  }

  /** 只在可见元素里找钮——keep-alive 让隐藏面板的同名按钮也挂在 DOM，
   *  全域找会点到不可见面板去（hub-visual-search 同款教训）。 */
  function findVisibleBtn(textOrRe) {
    const root = hubRoot();
    return (
      Array.from(root?.querySelectorAll("button") || []).find((b) => {
        if (b.offsetParent === null) return false;
        const t = (b.textContent || "").trim();
        return typeof textOrRe === "string"
          ? t.startsWith(textOrRe)
          : textOrRe.test(t);
      }) || null
    );
  }

  /** 确保 Hub 窗开着且 React 挂载（S8 独立使用；S6/S7 走插件入口版）。 */
  async function ensureHubOpen() {
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    hubWin = wm.getMostRecentWindow("zsearch:hub");
    if (!(hubWin && !hubWin.closed && hubRoot()?.querySelector("input"))) {
      await hubWindowManager.openHub("search");
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        hubWin = wm.getMostRecentWindow("zsearch:hub");
        if (hubWin && !hubWin.closed && hubRoot()?.querySelector("input"))
          break;
        await Zotero.Promise.delay(300);
      }
    }
    if (!(hubWin && hubRoot()?.querySelector("input"))) {
      throw { message: "[z-search-matrix] hub window/input not ready" };
    }
  }

  /**
   * 经插件上下文打开 Hub（Tools 菜单入口 → 插件自己的 hubWindowManager），
   * 返回挂在窗上的插件运行时桥。嵌入推理（EmbedFrameHost）需要插件的
   * bootstrap rootURI——runner 桥跑不了，向量链路必须走这个桥。
   */
  async function openHubViaPlugin() {
    const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
      Ci.nsIWindowMediator,
    );
    try {
      hubWindowManager?.closeAll();
    } catch {
      /* 无旧窗 */
    }
    await Zotero.Promise.delay(800);
    const mainWin = wm.getMostRecentWindow("navigator:browser");
    const mi = mainWin.document.getElementById("zsearch-tools-open-search");
    if (!mi) {
      throw { message: "Tools menu entry missing" };
    }
    mi.doCommand();
    await waitFor(() => {
      hubWin = wm.getMostRecentWindow("zsearch:hub");
      return hubWin &&
        !hubWin.closed &&
        hubWin.__hubBridge &&
        hubRoot()?.querySelector("input")
        ? hubWin
        : null;
    }, 20000);
    if (!(hubWin && hubWin.__hubBridge)) {
      throw {
        message: `plugin-context hub bridge not attached (win=${!!hubWin}, bridge=${!!hubWin?.__hubBridge})`,
      };
    }
    return hubWin.__hubBridge;
  }

  /** 通用桥驱动：handleIframeMessage 公共消息路径进 handleRequest。 */
  function route(targetBridge, method, payload) {
    return new Promise((resolve, reject) => {
      const fakeSource = {
        closed: false,
        postMessage: (msg) => {
          if (msg?.type === "zsearch-res" && msg.payload) {
            if (msg.payload.success) resolve(msg.payload.data);
            else reject(new Error(msg.payload.error || "unknown error"));
          }
        },
      };
      targetBridge.handleIframeMessage(
        { type: "zsearch-req", id: `matrix-${method}`, method, payload },
        fakeSource,
      );
    });
  }

  before(async function () {
    try {
      const { HubWindowBridge } =
        await import("../../src/ui/hub/HubWindowBridge.js");
      bridge = new HubWindowBridge();
      const mod = await import("../../src/ui/hub/HubWindowManager.js");
      hubWindowManager = mod.hubWindowManager;
      vectorReady = await seedLocalModel();
      const ortSeeded = await seedOrtAssets();
      REPORT.ortSeeded = ortSeeded;
      vectorReady = vectorReady && ortSeeded;
      await writeReport("z-matrix-env.json", {
        dataDir: Zotero.DataDirectory.dir,
        modelSeeded: vectorReady,
        ortSeeded,
        modelSeedError: REPORT.modelSeedError || null,
        ortSeedError: REPORT.ortSeedError || null,
      });
    } catch (e) {
      reportError("before", e);
    }
  });

  /**
   * 本地模型预置：scaffold 每次测试都 emptyDir 测试数据目录（模型放进去
   * 也会被清掉），因此从重置区外的 .scaffold/model-cache 拷入
   * {DataDir}/zsearch/models/。缓存缺失 → 返回 false → S6/S7 诚实跳过。
   */
  async function seedLocalModel() {
    try {
      // 本套件与 hub-visual-search 同为本机实机专用（OUT_DIR 硬编码）——
      // PathUtils.join 拒绝 ".." 段，工程根直接给常量。
      const projectRoot = "D:\\github_code\\z-search";
      const cacheRoot = PathUtils.join(
        projectRoot,
        ".scaffold",
        "model-cache",
        "Xenova",
        "multilingual-e5-small",
      );
      if (
        !(await IOUtils.exists(
          PathUtils.join(cacheRoot, "onnx", "model_quantized.onnx"),
        ))
      ) {
        return false;
      }
      const destRoot = PathUtils.join(
        Zotero.DataDirectory.dir,
        "zsearch",
        "models",
        "Xenova",
        "multilingual-e5-small",
      );
      const dd = Zotero.DataDirectory.dir;
      for (const dir of [
        PathUtils.join(dd, "zsearch"),
        PathUtils.join(dd, "zsearch", "models"),
        PathUtils.join(dd, "zsearch", "models", "Xenova"),
        PathUtils.join(
          dd,
          "zsearch",
          "models",
          "Xenova",
          "multilingual-e5-small",
        ),
        PathUtils.join(
          dd,
          "zsearch",
          "models",
          "Xenova",
          "multilingual-e5-small",
          "onnx",
        ),
      ]) {
        try {
          await IOUtils.makeDirectory(dir);
        } catch {
          /* 已存在 */
        }
      }
      for (const f of [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
      ]) {
        const dest = PathUtils.join(destRoot, f);
        if (!(await IOUtils.exists(dest))) {
          await IOUtils.copy(PathUtils.join(cacheRoot, f), dest);
        }
      }
      const onnx = PathUtils.join(destRoot, "onnx", "model_quantized.onnx");
      if (!(await IOUtils.exists(onnx))) {
        await IOUtils.copy(
          PathUtils.join(cacheRoot, "onnx", "model_quantized.onnx"),
          onnx,
        );
      }
      return (
        (await IOUtils.exists(onnx)) &&
        (await IOUtils.stat(onnx)).size > 1000000 &&
        (await IOUtils.exists(PathUtils.join(destRoot, "config.json")))
      );
    } catch (e) {
      REPORT.modelSeedError = String(e?.message || e);
      return false;
    }
  }

  /**
   * ORT wasm 资产保障：修复后 scripts/build-ort-assets.cjs 已把两个文件
   * 生成进 addon/content/ort/ 并由 assets 打进构建产物——这里仅校验存在，
   * 缺失时（如绕过 npm scripts 的构建路径）才从 node_modules 补拷。
   */
  async function seedOrtAssets() {
    try {
      const projectRoot = "D:\\github_code\\z-search";
      const ortDir = PathUtils.join(
        projectRoot,
        ".scaffold",
        "build",
        "addon",
        "content",
        "ort",
      );
      try {
        await IOUtils.makeDirectory(ortDir);
      } catch {
        /* 已存在 */
      }
      for (const f of [
        "ort-wasm-simd-threaded.jsep.mjs",
        "ort-wasm-simd-threaded.jsep.wasm",
      ]) {
        const src = PathUtils.join(
          projectRoot,
          "node_modules",
          "onnxruntime-web",
          "dist",
          f,
        );
        const dest = PathUtils.join(ortDir, f);
        if (!(await IOUtils.exists(dest))) {
          if (!(await IOUtils.exists(src))) {
            REPORT.ortSeedError = `missing source: ${f}`;
            return false;
          }
          await IOUtils.copy(src, dest);
        }
      }
      return (
        (await IOUtils.exists(
          PathUtils.join(ortDir, "ort-wasm-simd-threaded.jsep.wasm"),
        )) &&
        (await IOUtils.exists(
          PathUtils.join(ortDir, "ort-wasm-simd-threaded.jsep.mjs"),
        ))
      );
    } catch (e) {
      REPORT.ortSeedError = String(e?.message || e);
      return false;
    }
  }

  after(async function () {
    for (const id of fixtures) {
      try {
        const fresh = await Zotero.Items.getAsync(id);
        if (fresh) await fresh.eraseTx();
      } catch {
        /* best-effort */
      }
    }
    fixtures.length = 0;
    try {
      hubWindowManager?.closeAll();
    } catch {
      /* best-effort */
    }
  });

  // ── S1 literature.import ──────────────────────────────────────────────
  it("imports search results into the library (DOI direct + title fallback)", async function () {
    try {
      const payload = {
        entries: [
          { doi: "10.1038/s41586-021-03819-2" }, // AlphaFold, Nature 2021
          {
            title:
              "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity",
            year: "2012", // Jinek 2012, Science——标题回退（无 DOI 入参）
          },
          {
            // 相关度门槛回归（2026-09-26 修复）：bibliographic 检索对乱码
            // 也恒返"最接近"条目，修复前会导入错误论文（曾命中
            // "What's Deep About Deep Learning?"）；修复后应诚实失败。
            title: "zzqqxx-no-such-paper-4b7f-e2a1",
          },
        ],
      };
      // doi.org 内容协商偶发慢网（实测 9s+）会打出一次性
      // "Failed to extract metadata"——重试一次消 flake。
      let res = await bridgeRoute("literature.import", payload);
      if (!res?.[0]?.success) {
        await Zotero.Promise.delay(2000);
        res = await bridgeRoute("literature.import", payload);
      }
      expect(res, "import returns per-entry results").to.have.lengthOf(3);

      // 条目 1：DOI 直采
      expect(res[0].success, `DOI import: ${res[0].error || "ok"}`).to.be.true;
      expect(res[0].itemId, "DOI import yields an item id").to.be.a("number");
      fixtures.push(res[0].itemId);
      const it0 = await Zotero.Items.getAsync(res[0].itemId);
      expect(it0, "imported item exists in the library").to.be.ok;
      expect(it0.getField("title")).to.match(/protein structure prediction/i);

      // 条目 2：无 DOI → crossrefTitleToDoi → s2TitleToDoi 回退链
      expect(res[1].success, `title-fallback import: ${res[1].error || "ok"}`)
        .to.be.true;
      expect(res[1].itemId).to.be.a("number");
      fixtures.push(res[1].itemId);
      const it1 = await Zotero.Items.getAsync(res[1].itemId);
      expect(it1.getField("title")).to.match(/RNA-guided DNA endonuclease/i);

      // 条目 3：乱码标题 → 相关度门槛全拒 → 诚实失败，不导入错误论文
      expect(res[2].success, "garbage title must NOT import").to.be.false;
      expect(String(res[2].error || "")).to.match(/doi/i);
    } catch (e) {
      reportError("import", e);
    }
  });

  it("rejects an import request without identifiers or entries", async function () {
    try {
      await bridgeRoute("literature.import", { entries: [] });
      throw { message: "empty import payload must reject" };
    } catch (e) {
      expect(
        String(e?.message || e),
        "honest rejection names the contract",
      ).to.contain("missing identifiers/entries");
    }
  });

  // ── S2 literature.fetchFulltext ───────────────────────────────────────
  it("fetches PMC open-access full text and fails honestly when unavailable", async function () {
    try {
      // europe-pmc 检索不筛 OA，PMCID 命中的可能是非 OA 授权文章（efetch
      // 不回 XML）——取前 3 个 PMCID 候选逐个尝试，≥1 成功即过，全部失败
      // 时把逐个结果写进报告（区分网络不可达 vs 非 OA 文章）。
      const search = await bridgeRoute("literature.search", {
        query: "CRISPR Cas9",
        sources: ["europe-pmc"],
        maxResults: 10,
      });
      expect(
        search?.articles?.length,
        "europe-pmc returned articles",
      ).to.be.greaterThan(0);
      const candidates = search.articles.filter((a) => a.pmcid).slice(0, 3);
      expect(
        candidates.length,
        "at least one article carries a PMCID",
      ).to.be.greaterThan(0);

      const attempts = [];
      let ft = null;
      for (const c of candidates) {
        try {
          const r = await bridgeRoute("literature.fetchFulltext", {
            doi: c.doi || undefined,
            pmcid: c.pmcid,
            oaUrl: c.oaUrl || undefined,
            maxChars: 20000,
          });
          attempts.push({
            title: (c.title || "").slice(0, 60),
            pmcid: c.pmcid,
            success: r.success,
            reason: r.reason,
            textLen: r.text?.length,
            source: r.source,
          });
          if (r.success && (r.text?.length || 0) >= 200) {
            ft = r;
            break;
          }
        } catch (e) {
          attempts.push({ pmcid: c.pmcid, error: String(e?.message || e) });
        }
      }
      await writeReport("z-matrix-fulltext.json", { attempts });
      expect(
        ft,
        `PMC fulltext resolved for at least one candidate: ${JSON.stringify(attempts).slice(0, 400)}`,
      ).to.be.ok;
      expect(ft.text, "fulltext body non-empty").to.have.lengthOf.at.least(200);
      expect(ft.wordCount, "wordCount reported").to.be.greaterThan(0);

      // 负例：不存在的 DOI —— success:false + reason，而非抛错或编内容
      const miss = await bridgeRoute("literature.fetchFulltext", {
        doi: "10.5555/zsearch-nonexistent-probe",
      });
      expect(miss.success, "unavailable article reports success:false").to.be
        .false;
      expect(miss.reason).to.equal("unavailable");
    } catch (e) {
      reportError("fulltext", e);
    }
  });

  // ── S3 literature.translate ───────────────────────────────────────────
  it("translates an abstract through the engine chain (Google→Bing web fallback)", async function () {
    try {
      // 主断言 = 真实用户路径（修复 3 回归）：UI 只发 {text}（无
      // sourceLanguage → auto）。Bing ttranslatev3 对 fromLang=auto 直接
      // 400（实机对照确认），修复后引擎链在 auto 源下按文字系判定源语言，
      // Google 被墙 → Bing 兜底应产出中文译文。
      const t0 = Date.now();
      const uiLike = await bridgeRoute("literature.translate", {
        text: "Protein structure prediction has been transformed by deep learning.",
        targetLanguage: "zh-CN",
      });
      expect(
        uiLike.success,
        `translate via UI path (auto source): ${uiLike.error || "ok"} (${Date.now() - t0}ms)`,
      ).to.be.true;
      expect(uiLike.translatedText, "target language produced").to.match(
        /[\u4e00-\u9fff]/,
      );
      expect(uiLike.translatedText.length).to.be.greaterThan(2);

      // 引擎链能力补充：显式 sourceLanguage（跨过源语言判定，直证兜底链）
      const explicit = await bridgeRoute("literature.translate", {
        text: "Translation with an explicit source language.",
        targetLanguage: "zh-CN",
        sourceLanguage: "en",
      });
      expect(
        explicit.success,
        `translate with explicit source: ${explicit.error || "ok"}`,
      ).to.be.true;

      await writeReport("z-matrix-translate.json", {
        uiLike: {
          ok: uiLike.success,
          translatedText: uiLike.translatedText,
          ms: Date.now() - t0,
        },
        explicit: { ok: explicit.success },
      });
    } catch {
      // 失败诊断：逐腿探针定位（google 免费端点 / bing token 页 / POST）
      const diag = await probeTranslationEndpoints();
      await writeReport("z-matrix-translate-fail-diag.json", { diag });
      reportError("translate", {
        message: `diag=${JSON.stringify(diag).slice(0, 600)}`,
      });
    }
  });

  async function probeTranslationEndpoints() {
    const out = { scopeHasFetch: typeof fetch };
    try {
      const r = await Zotero.HTTP.request(
        "GET",
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=hello",
        { timeout: 10000, errorDelayMax: 0 },
      );
      out.google = {
        status: r.status,
        sample: String(r.responseText || "").slice(0, 80),
      };
    } catch (e) {
      out.google = { error: String(e?.message || e).slice(0, 120) };
    }
    // 腿 2a：Bing token 页 —— 与引擎同款裸 fetch（httpGet 只带 signal）
    try {
      const rf = await fetch("https://www.bing.com/translator", {
        signal: AbortSignal.timeout(10000),
      });
      const html = String(await rf.text());
      out.bingFetchGet = {
        status: rf.status,
        finalUrl: rf.url,
        hasIG: /IG:"([A-Fa-f0-9]{16,})"/.test(html),
        hasAbuse: /params_AbusePreventionHelper/.test(html),
        len: html.length,
      };
    } catch (e) {
      out.bingFetchGet = { error: String(e?.message || e).slice(0, 120) };
    }
    try {
      const r2 = await Zotero.HTTP.request(
        "GET",
        "https://www.bing.com/translator",
        {
          timeout: 15000,
          errorDelayMax: 0,
        },
      );
      const html = String(r2.responseText || "");
      const ig = html.match(/IG:"([A-Fa-f0-9]{16,})"/)?.[1] || "";
      const abuse = html.match(
        /params_AbusePreventionHelper\s*=\s*\[\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*\]/,
      );
      const iid =
        html.match(/id="rich_tta"\s+data-iid="(translator\.\d+)"/)?.[1] ||
        "translator.5023";
      out.bing = {
        status: r2.status,
        finalUrl: r2?.channel?.URI?.spec || r2.responseURL || "?",
        hasIG: !!ig,
        hasAbuse: !!abuse,
        iid,
        len: html.length,
      };
      // 复刻 postBingWebTranslate 的 POST（token 页 GET 已通时定位 POST 段）。
      // 注意 Zotero.HTTP 的 Cookie jar 与插件 fetch 共享浏览器网络栈。
      if (ig && abuse) {
        const origin = String(
          r2?.channel?.URI?.spec || "https://cn.bing.com",
        ).replace(/(\/translator.*|#.*)$/, "");
        const url =
          `${origin}/ttranslatev3?isVertical=1` +
          `&IG=${encodeURIComponent(ig)}` +
          `&IID=${encodeURIComponent(iid)}` +
          `&SFX=0` +
          `&token=${encodeURIComponent(abuse[2])}` +
          `&key=${encodeURIComponent(abuse[1])}`;
        const body =
          "fromLang=en&to=zh-Hans&text=hello&tryFetchingGenderDebiasedTranslations=false";
        try {
          const r3 = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Referer: `${origin}/translator`,
            },
            body,
            signal: AbortSignal.timeout(15000),
          });
          out.bingPostFetch = {
            status: r3.status,
            sample: (await r3.text()).slice(0, 200),
          };
        } catch (e) {
          out.bingPostFetch = { error: String(e?.message || e).slice(0, 160) };
        }
        try {
          const r4 = await Zotero.HTTP.request("POST", url, {
            body,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Referer: `${origin}/translator`,
            },
            timeout: 15000,
            errorDelayMax: 0,
          });
          out.bingPostXhr = {
            status: r4.status,
            sample: String(r4.responseText || "").slice(0, 200),
          };
        } catch (e) {
          out.bingPostXhr = { error: String(e?.message || e).slice(0, 160) };
        }
        // 缺陷对照：fromLang=auto（UI 真实路径）vs fromLang=en
        out.bingPostAutoVsEn = {};
        for (const [label, from] of [
          ["auto", "fromLang=auto"],
          ["en", "fromLang=en"],
        ]) {
          try {
            const r5 = await Zotero.HTTP.request("POST", url, {
              body: `${from}&to=zh-Hans&text=hello&tryFetchingGenderDebiasedTranslations=false`,
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Referer: `${origin}/translator`,
              },
              timeout: 15000,
              errorDelayMax: 0,
            });
            out.bingPostAutoVsEn[label] = {
              status: r5.status,
              sample: String(r5.responseText || "").slice(0, 120),
            };
          } catch (e) {
            out.bingPostAutoVsEn[label] = {
              status: e?.status ?? null,
              error: String(e?.message || e).slice(0, 120),
            };
          }
        }
      }
    } catch (e) {
      out.bing = { error: String(e?.message || e).slice(0, 120) };
    }
    // 终判：runner 上下文直接调引擎（与 RPC 同模块、同 fetch 面）——
    // 若直接调用成功而 RPC 失败，差异在 RPC 侧上下文；若同样失败，
    // 失败腿即上面各探针暴露的那条。
    try {
      const te =
        await import("../../src/core/translation/translationEngines.js");
      te.resetBingWebSession?.();
      te.clearTranslationCache?.();
      const translator = te.createTranslator("zh-CN", "en");
      const t1 = Date.now();
      const direct = await translator("hello world");
      out.directTranslator = {
        ok: !!direct,
        ms: Date.now() - t1,
        sample: String(direct || "").slice(0, 60),
      };
    } catch (e) {
      out.directTranslator = {
        error: String(e?.message || e).slice(0, 160),
        cause: String(e?.cause?.message || e?.cause || "").slice(0, 160),
      };
    }
    return out;
  }

  // ── S4 literature.search · github ─────────────────────────────────────
  it("searches GitHub repositories into the unified article structure", async function () {
    try {
      const res = await bridgeRoute("literature.search", {
        query: "zotero plugin",
        sources: ["github"],
        maxResults: 10,
      });
      await writeReport("z-matrix-github.json", {
        articleCount: res.articles.length,
        failedSources: res.failedSources,
        sample: res.articles.slice(0, 3).map((a) => ({
          title: a.title,
          stars: a.stars,
          source: a.source,
        })),
      });
      expect(res.failedSources, "api.github.com reachable").to.eql([]);
      expect(res.articles.length).to.be.greaterThan(0);
      const gh = res.articles[0];
      expect(gh.source).to.equal("github");
      expect(gh.title, "repo full_name as title").to.match(/\//);
      expect(gh.stars, "stars carried on the dedicated field").to.be.a(
        "number",
      );
    } catch (e) {
      reportError("github", e);
    }
  });

  // ── S5 searchSources.* ────────────────────────────────────────────────
  it("manages web search sources: missing-key classification, real Bing search, lifecycle", async function () {
    try {
      // 未配 key 的源：确定性分类 missing-key，不打网络
      const miss = await bridgeRoute("searchSources.test", { id: "tavily" });
      expect(miss.ok, "keyless source test fails").to.be.false;
      expect(miss.kind).to.equal("missing-key");

      // 免 key 且本机可达的源：真实搜索一次（Bing 网页版，国内可达）
      const ok = await bridgeRoute("searchSources.test", { id: "bing-html" });
      await writeReport("z-matrix-sources.json", { miss, ok });
      expect(
        ok.ok,
        `bing-html real search: ${JSON.stringify(ok).slice(0, 200)}`,
      ).to.be.true;
      expect(ok.count).to.be.at.least(1);

      // 测试结果回写健康缓存（此前永远停在 untested 的回归点）
      const list = await bridgeRoute("searchSources.list", {});
      expect(list.sources).to.have.lengthOf(13);
      expect(list.sources.find((s) => s.id === "bing-html").health).to.equal(
        "ok",
      );

      // add / setDefault / remove 生命周期（保存原 pref，finally 恢复）
      const PREF_ADDED = "extensions.zotero.zsearch.search.web.addedSources";
      const PREF_DEFAULT =
        "extensions.zotero.zsearch.search.web.defaultProvider";
      const savedAdded = Zotero.Prefs.get(PREF_ADDED, true);
      const savedDefault = Zotero.Prefs.get(PREF_DEFAULT, true);
      try {
        await bridgeRoute("searchSources.add", { id: "wikipedia" });
        let l2 = await bridgeRoute("searchSources.list", {});
        expect(l2.addedSources).to.include("wikipedia");

        await bridgeRoute("searchSources.setDefault", { id: "wikipedia" });
        l2 = await bridgeRoute("searchSources.list", {});
        expect(l2.defaultProvider).to.equal("wikipedia");

        const rm = await bridgeRoute("searchSources.remove", {
          id: "wikipedia",
        });
        expect(rm.ok).to.be.true;
        l2 = await bridgeRoute("searchSources.list", {});
        expect(l2.addedSources).to.not.include("wikipedia");
        // 移除默认源 → 落级（无已配置启用源时回出厂默认）
        expect(l2.defaultProvider).to.not.equal("wikipedia");
      } finally {
        if (savedAdded === undefined) Zotero.Prefs.clear(PREF_ADDED, true);
        else Zotero.Prefs.set(PREF_ADDED, savedAdded, true);
        if (savedDefault === undefined) Zotero.Prefs.clear(PREF_DEFAULT, true);
        else Zotero.Prefs.set(PREF_DEFAULT, savedDefault, true);
      }
    } catch (e) {
      reportError("sources", e);
    }
  });

  // ── S6 semantic.* 向量全流程 ──────────────────────────────────────────
  it("builds the vector index and serves semantic search, find-similar, duplicate scan", async function () {
    if (!vectorReady) {
      this.skip();
      return;
    }
    const notifyLog = [];
    try {
      // 向量链路必须走插件运行时桥（EmbedFrameHost 需要插件 rootURI）
      const pBridge = await openHubViaPlugin();
      const origNotify = pBridge.sendNotifyToIframe.bind(pBridge);
      pBridge.sendNotifyToIframe = (ev, p) => {
        notifyLog.push({ ev, p });
        return origNotify(ev, p);
      };

      // ── fixture 入库：2 篇不相关主题 + 1 对完全重复 ──
      const protein = await makeItem({
        title: "Transformer networks for protein structure prediction",
        abstract:
          "We review how deep learning transformer models such as AlphaFold " +
          "predict protein three-dimensional structures from amino acid " +
          "sequences with near-experimental accuracy.",
        year: "2024",
        journal: "Zsearch Test Rig Journal",
      });
      await makeItem({
        title: "Gut microbiome metabolomics in inflammatory bowel disease",
        abstract:
          "Targeted metabolomics of stool samples reveals distinct microbial " +
          "metabolite signatures in Crohn's disease and ulcerative colitis.",
        year: "2023",
      });
      const DUP_TITLE =
        "Single-cell atlas of the human pancreas reveals rare endocrine cell types";
      const DUP_ABSTRACT =
        "A single-cell transcriptomic atlas of human pancreatic islets " +
        "identifies rare delta and epsilon endocrine cell subpopulations and " +
        "their ligand-receptor signalling networks.";
      const dupA = await makeItem({
        title: DUP_TITLE,
        abstract: DUP_ABSTRACT,
        year: "2022",
      });
      vectorDupAId = dupA.id;
      const dupB = await makeItem({
        title: DUP_TITLE,
        abstract: DUP_ABSTRACT,
        year: "2022",
      });

      const modelInfo = await route(pBridge, "semantic.getModelInfo", {});
      expect(modelInfo.name).to.equal("Xenova/multilingual-e5-small");
      expect(modelInfo.dimension).to.equal(384);

      // ── 构建索引（早响应 started；经 notify 捕获 buildComplete/Error）──
      // 同时挂钩 Zotero.debug：逐条目嵌入错误经 safeDebug 出口，抓到具体
      // 错误串才能区分「推理失败」vs「入库失败」。
      const debugLines = [];
      const origDebug = Zotero.debug;
      Zotero.debug = function (line) {
        try {
          const s = String(line);
          if (s.includes("z-search")) debugLines.push(s.slice(0, 300));
        } catch {
          /* 忽略 */
        }
        return origDebug.apply(this, arguments);
      };
      const started = await route(pBridge, "semantic.buildIndex", {});
      expect(started.started).to.be.true;
      const done = await waitFor(() => {
        const complete = notifyLog.find(
          (n) => n.ev === "semantic.buildComplete",
        );
        const error = notifyLog.find((n) => n.ev === "semantic.buildError");
        return complete || error || null;
      }, 300000);
      Zotero.debug = origDebug;
      expect(done, "build finished (complete or error notification)").to.be.ok;
      const status = await route(pBridge, "semantic.getIndexStatus", {});
      await writeReport("z-matrix-vector-build.json", {
        notifyLog: notifyLog.filter((n) => n.ev !== "hub.setActiveTab"),
        indexStatus: status,
        zsearchDebugLines: debugLines.slice(0, 40),
      });
      expect(
        done.ev,
        `build outcome: ${JSON.stringify(
          notifyLog.filter((n) => n.ev !== "hub.setActiveTab"),
        ).slice(0, 400)}`,
      ).to.equal("semantic.buildComplete");
      expect(
        status.metadataCount,
        `metadata index reached 4 fixtures (debug: ${
          debugLines.slice(0, 6).join(" | ") || "no z-search debug lines"
        })`,
      ).to.be.at.least(4);

      // ── 语义检索：主题查询，首命中应为 AlphaFold 篇 ──
      const hits = await route(pBridge, "semantic.search", {
        query: "deep learning protein folding",
        threshold: 0.3,
        limit: 5,
      });
      await writeReport("z-matrix-vector.json", {
        indexStatus: status,
        hits: hits.map((h) => ({
          itemID: h.itemID,
          similarity: h.similarity,
          title: h.title,
        })),
      });
      expect(hits.length).to.be.at.least(2);
      expect(
        hits[0].itemID,
        "top semantic hit is the protein-folding item",
      ).to.equal(protein.id);
      expect(hits[0].similarity).to.be.a("number");
      expect(hits[0].title).to.be.a("string");

      // ── 找相似：重复对应以最高相似度互见 ──
      const similar = await route(pBridge, "semantic.findSimilar", {
        itemID: dupA.id,
        threshold: 0.5,
        limit: 5,
      });
      expect(
        similar.some((s) => s.itemID === dupB.id),
        "duplicate twin found via find-similar",
      ).to.be.true;
      expect(similar[0].itemID, "twin ranks first").to.equal(dupB.id);

      // ── 重复扫描：走 RPC（早响应），从捕获的 notify 里拿结果 ──
      await route(pBridge, "semantic.scanDuplicates", { threshold: 0.9 });
      const scanDone = await waitFor(() => {
        const complete = notifyLog.find(
          (n) => n.ev === "semantic.scanComplete",
        );
        const error = notifyLog.find((n) => n.ev === "semantic.scanError");
        return complete || error || null;
      }, 180000);
      expect(scanDone, "duplicate scan finished").to.be.ok;
      const scanResults =
        scanDone.ev === "semantic.scanComplete" ? scanDone.p.results : [];
      const pair =
        scanResults.find(
          (d) => d.itemID === dupA.id && d.duplicateIDs.includes(dupB.id),
        ) ||
        scanResults.find(
          (d) => d.itemID === dupB.id && d.duplicateIDs.includes(dupA.id),
        );
      await writeReport("z-matrix-duplicates.json", {
        outcome: scanDone.ev,
        scanned: scanResults.length,
        pair: pair || null,
        error: scanDone.p?.error,
      });
      expect(
        scanDone.ev,
        `scan outcome: ${JSON.stringify(scanDone).slice(0, 200)}`,
      ).to.equal("semantic.scanComplete");
      expect(pair, "planted duplicate pair detected at 0.9").to.be.ok;
      expect(pair.confidence, "confidence reported").to.be.a("number");
    } catch (e) {
      reportError("vector", e);
    }
  });

  // ── S7 条目右键深链 ───────────────────────────────────────────────────
  it("deep-links from the item context menu into an auto find-similar run", async function () {
    if (!vectorReady || !vectorDupAId) {
      this.skip();
      return;
    }
    try {
      const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(
        Ci.nsIWindowMediator,
      );
      const mainWin = wm.getMostRecentWindow("navigator:browser");
      expect(mainWin, "main window reachable").to.be.ok;

      // 右键菜单语义：单选一个普通条目（重复对之一）
      await mainWin.ZoteroPane.selectItem(vectorDupAId);

      // 走真实菜单入口的命令路径（menuManager command → findSimilarFromMenu）
      const mi = mainWin.document.getElementById("zsearch-item-find-similar");
      expect(mi, "context menu entry present").to.be.ok;
      mi.doCommand();

      // 深链落位：本地腿自动激活
      await ensureHubOpen();
      const localTab = await waitFor(() => {
        const b = findBtn("本地搜索");
        return b && b.getAttribute("aria-pressed") === "true" ? b : null;
      }, 15000);
      expect(localTab, "local tab activated by the deep link").to.be.ok;

      // 修复 2 回归：深链必须落在 similar 结果子页并自动发起找相似——
      // 重复孪生的标题应真正上屏（修复前 setResultsView("search")，检索
      // 发了但结果永不渲染，实机审计 2026-09-26）。
      const dupTitleSeen = await waitFor(() => {
        const root = hubRoot();
        return root && root.textContent.includes("Single-cell atlas")
          ? true
          : null;
      }, 60000);
      expect(
        dupTitleSeen,
        "find-similar results rendered in the UI after the deep link",
      ).to.be.ok;

      // 服务层旁证：宿主侧回退解析主窗选中条目的同一 RPC——重复孪生以
      // 最高相似度命中。
      let similar = null;
      let similarErr = null;
      try {
        similar = await route(hubWin.__hubBridge, "semantic.findSimilar", {
          threshold: 0.5,
          limit: 5,
        });
      } catch (e) {
        similarErr = String(e?.message || e);
      }
      const findings = {
        findSimilarViaHostSelection: {
          ok: !!similar,
          error: similarErr,
          top: similar?.[0]
            ? { itemID: similar[0].itemID, similarity: similar[0].similarity }
            : null,
        },
        similarResultsRenderedInUi: !!dupTitleSeen,
      };
      await writeReport("z-matrix-deeplink.json", findings);
      expect(
        findings.findSimilarViaHostSelection.ok,
        `deep-link find-similar RPC resolves via main-window selection: ${similarErr || "ok"}`,
      ).to.be.true;
      expect(
        findings.findSimilarViaHostSelection.top?.itemID,
        "twin ranks first (the deep link's own query works)",
      ).to.equal(fixtures[fixtures.indexOf(vectorDupAId) + 1]);
    } catch (e) {
      reportError("deep-link", e);
    }
  });

  // ── S8 复制清单 / 导出 CSV ────────────────────────────────────────────
  it("copies the result list to the clipboard and exports a CSV blob", async function () {
    let pageErrors = [];
    try {
      // 自带净窗：S7 的深链会把应用留在 similar 子页，keep-alive 跨页状态
      // 下切 tab 检索不出卡（run2/run3 实测）——重开一扇（Tools 菜单入口）
      // 消掉前序状态，让本用例只验证导出链本身。
      pageErrors = [];
      await openHubViaPlugin();
      const errWin = hubWin2();
      errWin?.addEventListener("error", (e) => {
        pageErrors.push(String(e?.message || e));
      });
      const webTab = findVisibleBtn("网络搜索");
      expect(webTab, "web tab present").to.be.ok;
      if (webTab.getAttribute("aria-pressed") !== "true") {
        webTab.click();
        await Zotero.Promise.delay(900);
      }

      // React 受控输入设值 + 点「搜索」。keep-alive 让隐藏面板的输入框也挂
      // 在 DOM——必须限定可见面板（深链留下的 similar 子页会改变 DOM 顺序，
      // 全域 find 第一个会把搜索打进不可见面板）。
      const root = hubRoot();
      const input =
        Array.from(root.querySelectorAll("input")).find(
          (i) =>
            i.offsetParent !== null &&
            /研究问题|关键词|DOI|research question|keywords/i.test(
              i.placeholder || "",
            ),
        ) ||
        Array.from(root.querySelectorAll("input")).find(
          (i) => i.offsetParent !== null && i.placeholder,
        );
      expect(input, "visible web-search input present").to.be.ok;
      expect(input.offsetParent, "input is in the visible pane").to.not.be.null;
      const win = hubWin2();
      const setter = Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, "protein folding");
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
      await Zotero.Promise.delay(400);
      let anc = input.parentElement;
      let searchBtn = null;
      while (anc && anc !== root) {
        searchBtn = Array.from(anc.querySelectorAll(":scope > * button")).find(
          (b) =>
            /^(搜索|Search)$/.test((b.textContent || "").trim()) && !b.disabled,
        );
        if (searchBtn) break;
        anc = anc.parentElement;
      }
      expect(searchBtn, "search button reachable").to.be.ok;
      searchBtn.click();

      // 等结果卡（渐进检索：快源先出）；等不到时落状态条/页错误诊断
      const cardCount = await waitFor(() => {
        const n = hubDoc()?.querySelectorAll(".lit-result-journal").length;
        return n > 0 ? n : null;
      }, 150000);
      if (!cardCount) {
        const strip = hubDoc()?.querySelector(".hub-search-engine-strip");
        await writeReport("z-matrix-export-fail-diag.json", {
          pageErrors: pageErrors.slice(0, 10),
          stripText: (strip?.textContent || "").slice(0, 200),
          inputValue: input.value,
          visibleInputs: Array.from(hubRoot()?.querySelectorAll("input") || [])
            .filter((i) => i.offsetParent !== null)
            .map((i) => i.placeholder),
        });
      }
      expect(cardCount, "result cards rendered").to.be.greaterThan(0);
      // 标题元素是 .lit-result-title（.lit-result-journal 是期刊名元素，
      // 无期刊的条目显示 "—" 占位——实测踩坑）
      const firstTitle = (
        hubDoc().querySelector(".lit-result-title")?.textContent || ""
      ).trim();
      expect(firstTitle.length, "first card title captured").to.be.greaterThan(
        2,
      );

      // ── 复制清单：handleCopyList → copyText 三级回退链 ──
      // iframe 无真实用户激活时 navigator.clipboard/execCommand 必拒
      //（测试假象）——注入 Zotero.Clipboard 桩截获 copyText 首选路的真实
      // 格式化产物；若 iframe 本就带宿主 Zotero（chrome 特权），系统剪贴板
      // 回读兜底照常生效。Xray 包装会让赋值落到包装层，必须 waiveXrays。
      const winH = hubWin2();
      const captured = { text: null, hadHostZotero: null };
      try {
        const w = typeof Cu !== "undefined" ? Cu.waiveXrays(winH) : winH;
        captured.hadHostZotero = !!w.Zotero;
        w.Zotero = w.Zotero || {};
        w.Zotero.Clipboard = {
          copy: (t) => {
            captured.text = String(t ?? "");
            return true;
          },
        };
      } catch (e) {
        captured.stubError = String(e?.message || e).slice(0, 120);
      }
      const copyBtn = findVisibleBtn("复制清单");
      expect(copyBtn, "copy-list button present").to.be.ok;
      copyBtn.click();
      const toastSeen = { ok: false, fail: false };
      const clipText = await waitFor(() => {
        if (captured.text && captured.text.includes(firstTitle.slice(0, 24))) {
          return captured.text;
        }
        try {
          const text = readClipboard();
          if (text && text.includes(firstTitle.slice(0, 24))) return text;
        } catch {
          /* 读不了剪贴板就靠桩 */
        }
        const txt = hubRoot()?.textContent || "";
        if (txt.includes("复制失败")) toastSeen.fail = true;
        if (txt.includes("复制成功")) toastSeen.ok = true;
        return null;
      }, 10000);
      await writeReport("z-matrix-export.json", {
        firstTitle,
        hadHostZotero: captured.hadHostZotero,
        stubError: captured.stubError || null,
        toastSeen,
        clipboardSample: (clipText || "").slice(0, 300),
      });
      expect(
        clipText,
        `copy list captured (toast=${JSON.stringify(toastSeen)}, stubError=${captured.stubError || "-"})`,
      ).to.be.ok;
      expect(clipText).to.match(/^\s*1\./);

      // ── 导出 CSV：截获 Blob + 拦截 <a>.click（waiveXrays 后再打补丁）──
      const win2 = hubWin2();
      const w2 = typeof Cu !== "undefined" ? Cu.waiveXrays(win2) : win2;
      const blobs = [];
      const downloads = [];
      const origCreate = w2.URL.createObjectURL;
      const origRevoke = w2.URL.revokeObjectURL;
      const origClick = w2.HTMLAnchorElement.prototype.click;
      w2.URL.createObjectURL = (b) => {
        blobs.push(b);
        return "blob:zsearch-matrix";
      };
      w2.URL.revokeObjectURL = () => {};
      w2.HTMLAnchorElement.prototype.click = function () {
        downloads.push(this.download || "");
      };
      try {
        const csvBtn = findVisibleBtn(/导出 CSV|Export CSV/);
        expect(csvBtn, "export-csv button present").to.be.ok;
        csvBtn.click();
        await Zotero.Promise.delay(800);
      } finally {
        w2.URL.createObjectURL = origCreate;
        w2.URL.revokeObjectURL = origRevoke;
        w2.HTMLAnchorElement.prototype.click = origClick;
      }
      expect(blobs.length, "CSV blob created").to.be.at.least(1);
      expect(downloads[0], "download attribute set").to.match(
        /^literature-search-\d+\.csv$/,
      );
      // BOM 断言读原始字节——Blob.text() 按 UTF-8 解码会剥掉 BOM（实测踩坑）
      const csvBytes = new Uint8Array(await blobs[0].arrayBuffer());
      expect(
        csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
        `BOM keeps Excel CJK-safe (first bytes: ${Array.from(csvBytes.slice(0, 3))})`,
      ).to.be.true;
      const csv = await blobs[0].text();
      expect(csv).to.contain(firstTitle.slice(0, 24));
      expect(csv.split("\r\n").length, "one row per result").to.be.at.least(2);
    } catch (e) {
      reportError("export", e);
    }
  });

  /** chrome 特权读系统剪贴板文本。clipboard.writeText 只落 text/plain，
   *  Zotero.Clipboard.copy 落 text/unicode——两个 flavor 都试。 */
  function readClipboard() {
    const clip = Cc["@mozilla.org/widget/clipboard;1"].getService(
      Ci.nsIClipboard,
    );
    const trans = Cc["@mozilla.org/widget/transferable;1"].createInstance(
      Ci.nsITransferable,
    );
    trans.addDataFlavor("text/unicode");
    trans.addDataFlavor("text/plain");
    clip.getData(trans, clip.kGlobalClipboard);
    for (const flavor of ["text/unicode", "text/plain"]) {
      try {
        const data = trans.getTransferData(flavor);
        if (data?.value) {
          const text = data.value.QueryInterface(Ci.nsISupportsString).data;
          if (text) return text;
        }
      } catch {
        /* 下一个 flavor */
      }
    }
    return "";
  }
});
