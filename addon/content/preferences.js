/**
 * z-search — Zotero 设置面板脚本（搜索源管理）。
 *
 * 经 Zotero.PreferencePanes.register({scripts:[...]}) 以 Sandbox 载入——
 * Sandbox 的全局与设置窗主作用域隔离，fragment 根元素 onload 属性里的
 * 标识符在主作用域求值，**看不到本 Sandbox 里的 ZSearchPrefs**（Zotero 自带
 * 面板的脚本是 loadSubScript 进主窗作用域才可用 onload 属性；插件面板不可）。
 * 故 init 挂在 document 的 load 捕获监听上：preferences.js 的
 * _initImportedNodesPostInsert 会向 fragment 根派发不冒泡的 load 事件，
 * 捕获阶段可在 document 上收到，按 target.id 锁定本面板。
 *
 * 全局 Zotero 与 Zotero.ZSearch（addon api）经 sandboxPrototype 可达；
 * pref 读写走 api.getPrefDynamic/api.setPrefDynamic（与 Hub 侧同一条
 * utils/prefs 通路），搜索源状态与增删测试走 api.searchSources
 * （HubSearchSourceHandler 同一事实源）。
 */
"use strict";

/**
 * XUL 命名空间（设置窗文档对 HTML 名词 createElement 一律给 XHTML ns——
 * richlistitem/checkbox 等必须走 createElementNS，否则是未知 HTML 元素，
 * 不挂 XUL 自定义元素绑定：无边框无文字，DOM 里在、屏幕上没有）。
 */
var XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
function xul(tag) {
  return document.createElementNS(XUL_NS, tag);
}

/**
 * 网络区域选项（值 = region pref；文案走 FTL）。
 * 顺序即菜单顺序：auto 在最前（缺省 = 不声明）。
 */
var REGION_OPTIONS = [
  { value: "auto", labelKey: "prefs-region-auto" },
  { value: "global", labelKey: "prefs-region-global" },
  { value: "cn", labelKey: "prefs-region-cn" },
];

/**
 * 中科院分区显隐选项（值 = region.cassPartition pref；文案走 FTL）。
 * auto = 跟随网络区域（cn 显示 / global 隐藏 / 未声明沿用默认展示）。
 */
var CASS_OPTIONS = [
  { value: "auto", labelKey: "prefs-region-cass-auto" },
  { value: "show", labelKey: "prefs-region-cass-show" },
  { value: "hide", labelKey: "prefs-region-cass-hide" },
];

/**
 * 翻译引擎选项（值 = translate.engineType；引擎语义见
 * core/translation/translationEngines）。可达性是跨境用户的主要决策依据，
 * 故 label 里直接写明「免 key / 需 key」。
 */
var ENGINE_OPTIONS = [
  { value: "google", labelKey: "prefs-translate-engine-google" },
  { value: "bing-web", labelKey: "prefs-translate-engine-bing-web" },
  { value: "bing", labelKey: "prefs-translate-engine-bing" },
  { value: "deepl", labelKey: "prefs-translate-engine-deepl" },
  { value: "ai", labelKey: "prefs-translate-engine-ai" },
  { value: "custom", labelKey: "prefs-translate-engine-custom" },
  {
    value: "zotero-pdf-translate",
    labelKey: "prefs-translate-engine-zotero-pdf-translate",
  },
];

/** Azure Translator 订阅区常用值（可编辑：非列出的 region 手填即可）。 */
var AZURE_REGIONS = [
  "global",
  "chinanorth",
  "chinanorth2",
  "eastasia",
  "southeastasia",
  "westeurope",
  "eastus",
  "westus",
];

/** 区域推荐值改动的 pref 键 → 回显用 FTL 片段 key。 */
var REGION_CHANGE_LABELS = {
  "search.web.defaultProvider": "prefs-region-change-web",
  "translate.engineType": "prefs-region-change-engine",
  "translate.bing.region": "prefs-region-change-bingregion",
  "region.cassPartition": "prefs-region-change-cass",
};

var ZSearchPrefs = {
  /** searchSources.list 的结果快照。 */
  data: null,
  /** 当前选中的源 id（richlistbox select）。 */
  selectedId: null,
  /** 测试进行中的源 id。 */
  testingId: null,
  /** 密钥区是否显示明文。 */
  keysVisible: false,

  /** FTL 取词直连（api.t）。 */
  t(key, args) {
    var api =
      window.Zotero && window.Zotero.ZSearch && window.Zotero.ZSearch.api;
    return api && api.t ? api.t(key, args) : key;
  },

  init() {
    var doc = document;
    // 静态文案本地化
    var cap = doc.getElementById("zsearch-sources-title");
    cap.textContent = this.t("hub-settings-section-search-sources");
    var desc = doc.getElementById("zsearch-sources-desc");
    desc.textContent = this.t("search-sources-desc");
    doc
      .getElementById("zsearch-source-test")
      .setAttribute("label", this.t("search-sources-test"));
    doc
      .getElementById("zsearch-default-label")
      .setAttribute("value", this.t("search-sources-default"));
    var keysCap = doc.getElementById("zsearch-keys-title");
    keysCap.textContent = this.t("prefs-keys-title");
    var keysDesc = doc.getElementById("zsearch-keys-desc");
    keysDesc.textContent = this.t("prefs-keys-desc");
    var academicCap = doc.getElementById("zsearch-academic-keys-title");
    academicCap.textContent = this.t("prefs-academic-keys-title");
    var academicDesc = doc.getElementById("zsearch-academic-keys-desc");
    academicDesc.textContent = this.t("prefs-academic-keys-desc");
    doc
      .getElementById("zsearch-show-keys")
      .setAttribute("label", this.t("prefs-show-keys"));
    doc.getElementById("zsearch-show-keys").setAttribute("checked", "false");

    doc
      .getElementById("zsearch-show-keys")
      .addEventListener("command", () => this.toggleKeysVisible());
    doc
      .getElementById("zsearch-source-test")
      .addEventListener("command", () => this.runTestSelected());
    doc
      .getElementById("zsearch-source-list")
      .addEventListener("select", () => this.onSelect());
    doc
      .getElementById("zsearch-default-popup")
      .addEventListener("popuphidden", () => this.onDefaultPicked());

    // ── 通用开关：入口与导入行为（pref 直绑，command 即写）──
    var gCap = doc.getElementById("zsearch-general-title");
    gCap.textContent = this.t("prefs-general-title");
    var tbCb = doc.getElementById("zsearch-toolbar-button");
    tbCb.setAttribute("label", this.t("prefs-toolbar-button"));
    doc.getElementById("zsearch-toolbar-button-desc").textContent = this.t(
      "prefs-toolbar-button-desc",
    );
    var pdfCb = doc.getElementById("zsearch-import-pdf");
    pdfCb.setAttribute("label", this.t("prefs-import-pdf"));
    doc.getElementById("zsearch-import-pdf-desc").textContent = this.t(
      "prefs-import-pdf-desc",
    );
    var prefApi =
      window.Zotero && window.Zotero.ZSearch && window.Zotero.ZSearch.api;
    var bindCheckbox = function (el, key, dflt) {
      var cur = prefApi.getPrefDynamic && prefApi.getPrefDynamic(key);
      if (cur === undefined || cur === null) cur = dflt;
      el.setAttribute("checked", cur ? "true" : "false");
      el.addEventListener("command", function () {
        var on = el.getAttribute("checked") === "true";
        if (prefApi.setPrefDynamic) prefApi.setPrefDynamic(key, on);
      });
    };
    // 工具栏按钮：写完 pref 即时同步主窗（显式直调，确定性优于 pref 观察者）
    (function () {
      var cur =
        prefApi.getPrefDynamic &&
        prefApi.getPrefDynamic("search.toolbarButton");
      if (cur === undefined || cur === null) cur = true;
      tbCb.setAttribute("checked", cur ? "true" : "false");
      tbCb.addEventListener("command", function () {
        var on = tbCb.getAttribute("checked") === "true";
        if (prefApi.setPrefDynamic)
          prefApi.setPrefDynamic("search.toolbarButton", on);
        if (prefApi.syncToolbarButton) prefApi.syncToolbarButton();
      });
    })();
    bindCheckbox(pdfCb, "search.importAttachPdf", true);

    this.initRegion();
    this.initEndpoints();
    this.initTranslate();

    void this.refresh();
  },

  // ── 网络区域 ═══════════════════════════════════════════════════════════

  /** 区域组静态文案 + 菜单 + 两个写入口（切选即套用推荐值 / 按钮 force 重套）。 */
  initRegion() {
    var doc = document;
    doc.getElementById("zsearch-region-title").textContent =
      this.t("prefs-region-title");
    doc.getElementById("zsearch-region-desc").textContent =
      this.t("prefs-region-desc");
    doc
      .getElementById("zsearch-region-label")
      .setAttribute("value", this.t("prefs-region-label"));
    var btn = doc.getElementById("zsearch-region-apply");
    btn.setAttribute("label", this.t("prefs-region-apply"));
    doc
      .getElementById("zsearch-cass-label")
      .setAttribute("value", this.t("prefs-region-cass-label"));
    this.renderRegionMenu();
    doc
      .getElementById("zsearch-region-popup")
      .addEventListener("popuphidden", () => this.onRegionPicked());
    btn.addEventListener("command", () => this.applyRegion(true));
    this.renderCassMenu();
    doc
      .getElementById("zsearch-cass-popup")
      .addEventListener("popuphidden", () => this.onCassPicked());
  },

  // ── 区域限定端点 ═══════════════════════════════════════════════════════

  initEndpoints() {
    var doc = document;
    doc.getElementById("zsearch-endpoints-title").textContent = this.t(
      "prefs-endpoints-title",
    );
    doc.getElementById("zsearch-endpoints-desc").textContent = this.t(
      "prefs-endpoints-desc",
    );
    this.renderEndpoints();
  },

  // ── 翻译引擎 ═══════════════════════════════════════════════════════════

  initTranslate() {
    var doc = document;
    doc.getElementById("zsearch-translate-title").textContent = this.t(
      "prefs-translate-title",
    );
    doc.getElementById("zsearch-translate-desc").textContent = this.t(
      "prefs-translate-desc",
    );
    doc
      .getElementById("zsearch-translate-engine-label")
      .setAttribute("value", this.t("prefs-translate-engine-label"));
    doc
      .getElementById("zsearch-translate-bingregion-label")
      .setAttribute("value", this.t("prefs-translate-bingregion-label"));
    doc.getElementById("zsearch-translate-note").textContent = this.t(
      "prefs-translate-note",
    );
    this.renderTranslateEngine();
    this.renderTranslateBingRegion();
    var api = window.Zotero.ZSearch.api;
    doc
      .getElementById("zsearch-translate-engine-popup")
      .addEventListener("popuphidden", () => {
        var engine =
          doc.getElementById("zsearch-translate-engine").value || "google";
        api.setPrefDynamic("translate.engineType", engine);
        this.syncBingRegionEnabled(engine);
      });
    // 可编辑菜单：手输 region 未必触发 popuphidden，change 事件兜底落盘
    doc
      .getElementById("zsearch-translate-bingregion")
      .addEventListener("change", () => {
        var ml = doc.getElementById("zsearch-translate-bingregion");
        api.setPrefDynamic("translate.bing.region", ml.value.trim());
      });

    // ── 持久缓存与截断上限（2026-09-30 优化批）──
    doc
      .getElementById("zsearch-translate-cache-enabled")
      .setAttribute("label", this.t("prefs-translate-cache-enabled"));
    doc.getElementById("zsearch-translate-cache-desc").textContent = this.t(
      "prefs-translate-cache-desc",
    );
    doc
      .getElementById("zsearch-translate-maxchars-label")
      .setAttribute("value", this.t("prefs-translate-maxchars-label"));
    doc
      .getElementById("zsearch-translate-cache-maxmb-label")
      .setAttribute("value", this.t("prefs-translate-cache-maxmb-label"));

    var cacheCb = doc.getElementById("zsearch-translate-cache-enabled");
    var cacheOn = api.getPrefDynamic("translate.cache.enabled");
    if (cacheOn === undefined || cacheOn === null) cacheOn = true;
    cacheCb.setAttribute("checked", cacheOn ? "true" : "false");
    cacheCb.addEventListener("command", function () {
      var on = cacheCb.getAttribute("checked") === "true";
      api.setPrefDynamic("translate.cache.enabled", on);
    });

    var bindNum = function (inputId, prefKey, dflt, min) {
      var input = doc.getElementById(inputId);
      var cur = Number(api.getPrefDynamic(prefKey));
      if (!Number.isFinite(cur)) cur = dflt;
      input.value = String(cur);
      input.addEventListener("change", function () {
        var n = parseInt(input.value, 10);
        if (!Number.isFinite(n) || n < min) {
          input.value = String(cur); // 非法输入回退原值
          return;
        }
        cur = n;
        api.setPrefDynamic(prefKey, n);
      });
    };
    // 截断上限：0 = 不限长（handler 只在 maxChars > 0 时截断）
    bindNum("zsearch-translate-maxchars", "translate.maxChars", 10000, 0);
    // 缓存容量：必须 ≥ 1——想关缓存请用上面的开关，别把容量清零
    bindNum(
      "zsearch-translate-cache-maxmb",
      "translate.cache.maxSizeMB",
      200,
      1,
    );
  },

  // ── 数据 ────────────────────────────────────────────────────────────────

  /**
   * searchSources RPC 解包调用：handler 返回 {result, error} 信封（与 bridge
   * 分发层不同——那是桥负责剥壳）。error 非空按抛异常处理，UI 统一走 catch。
   */
  async call(method, payload) {
    var resp = await window.Zotero.ZSearch.api.searchSources(method, payload);
    if (resp && resp.error) throw new Error(String(resp.error));
    return resp ? resp.result : null;
  },

  /**
   * 重拉 list 快照并全量重渲。keepNote=true 时保留调用方刚写入的提示
   * （测试结果/切换确认）——否则本方法的清空会把提示秒擦掉。
   */
  async refresh(keepNote) {
    try {
      this.data = await this.call("searchSources.list", {});
      this.render();
      if (!keepNote)
        this.setNote(this.emptyHint(), this.emptyHint() ? "warn" : "");
    } catch (e) {
      this.data = { sources: [], addedSources: [], defaultProvider: "" };
      this.render();
      this.setNote(
        this.t("search-sources-test-failed", {
          detail: String(e && e.message ? e.message : e).slice(0, 120),
        }),
        "bad",
      );
    }
  },

  sources() {
    return (this.data && this.data.sources) || [];
  },

  addedIds() {
    return (this.data && this.data.addedSources) || [];
  },

  defaultProvider() {
    return (this.data && this.data.defaultProvider) || "duckduckgo";
  },

  /** 一个源都没启用时的引导语（空串=不提示）。 */
  emptyHint() {
    return this.addedIds().length === 0 ? this.t("search-sources-empty") : "";
  },

  // ── 渲染 ────────────────────────────────────────────────────────────────

  /**
   * 行状态：文本 + 色档（idle=未启用 / accent=默认 / warn=未填 key /
   * ok=可达 / bad=不可达）。noKey 源未启用时给「免 key」提示而非空挂。
   */
  statusOf(s) {
    if (!s.added) {
      return s.noKey
        ? { text: this.t("prefs-status-not-added-nokey"), tone: "idle" }
        : { text: this.t("prefs-status-not-added"), tone: "idle" };
    }
    if (s.id === this.defaultProvider())
      return { text: this.t("search-sources-default"), tone: "accent" };
    if (!s.configured)
      return { text: this.t("search-sources-not-configured"), tone: "warn" };
    if (s.health === "ok")
      return {
        // 行状态只说「可达」——真实条数只在「测试」按钮的即时回执里
        // （runTestSelected 的 setNote）；此前这里硬编码 count:1 谎报条数。
        text: this.t("search-sources-reachable"),
        tone: "ok",
      };
    if (s.health === "unreachable")
      return { text: this.t("search-sources-test-unreachable"), tone: "bad" };
    return { text: this.t("prefs-status-enabled"), tone: "idle" };
  },

  render() {
    var list = document.getElementById("zsearch-source-list");
    // 清空旧行
    while (list.firstChild) list.removeChild(list.firstChild);

    var self = this;
    this.sources().forEach(function (s) {
      var item = xul("richlistitem");
      item.setAttribute("class", "source-row" + (s.added ? " is-added" : ""));
      item.setAttribute("value", s.id);
      if (s.id === self.selectedId) item.setAttribute("selected", "true");

      var cb = xul("checkbox");
      cb.setAttribute("class", "source-check");
      cb.setAttribute("checked", s.added ? "true" : "false");
      cb.setAttribute("label", s.label);
      cb.setAttribute("tooltiptext", s.id);
      cb.addEventListener("command", function () {
        self.toggleAdded(s.id);
      });
      item.appendChild(cb);

      var st = self.statusOf(s);
      var status = xul("label");
      status.setAttribute("class", "source-status tone-" + st.tone);
      // XUL label：赋值 .value 属性对象（Zotero 偏好窗自身同款做法）才走
      // 绑定渲染；setAttribute 对动态创建元素不刷新视觉。
      status.value = st.text;
      status.setAttribute("flex", "1");
      item.appendChild(status);
      list.appendChild(item);
    });

    this.renderDefaultMenu();
    this.renderKeys();
    this.syncTestButton();
  },

  renderDefaultMenu() {
    var popup = document.getElementById("zsearch-default-popup");
    while (popup.firstChild) popup.removeChild(popup.firstChild);
    var ids = this.addedIds();
    var def = this.defaultProvider();
    var ml = document.getElementById("zsearch-default-provider");
    if (ids.length === 0) {
      ml.setAttribute("disabled", "true");
      var empty = xul("menuitem");
      empty.setAttribute("label", "—");
      empty.setAttribute("disabled", "true");
      popup.appendChild(empty);
      return;
    }
    ml.removeAttribute("disabled");
    ids.forEach(function (id) {
      var mi = xul("menuitem");
      mi.setAttribute("label", id);
      mi.setAttribute("value", id);
      if (id === def) mi.setAttribute("selected", "true");
      popup.appendChild(mi);
    });
  },

  renderKeys() {
    var rows = document.getElementById("zsearch-keys-rows");
    while (rows.firstChild) rows.removeChild(rows.firstChild);
    var self = this;
    var api = window.Zotero.ZSearch.api;
    this.sources().forEach(function (s) {
      (s.fields || []).forEach(function (f) {
        var row = xul("hbox");
        row.setAttribute("class", "key-row");
        row.setAttribute("align", "center");

        var label = xul("label");
        label.setAttribute("class", "key-label");
        label.value = s.label + " · " + f.label;
        label.setAttribute("flex", "1");
        row.appendChild(label);

        var input = xul("textbox");
        input.setAttribute("class", "key-input");
        input.setAttribute("type", self.keysVisible ? "text" : "password");
        input.setAttribute("size", "28");
        input.setAttribute("flex", "1");
        input.value = f.value || "";
        // 即填即存（Zotero 设置面字段级秒存制式）；写路径走 api，不经
        // <preference> 绑定（动态行 + 统一审计通路）。
        input.addEventListener("change", function () {
          api.setPrefDynamic(f.prefKey, input.value);
          // key/实例 URL/cx 变更即失效该源健康判罚——旧 unreachable 会短路
          // 后续搜索/测试（此前只匹配 *.apiKey：SearXNG instanceUrl 与
          // Google cx 改动不触发，行状态仍显 bad 需重启或手动测试才恢复）。
          var m = /^search\.web\.([^.]+)\.(apiKey|instanceUrl|cx)$/.exec(
            f.prefKey,
          );
          if (m) void self.call("searchSources.invalidate", { id: m[1] });
          void self.refresh();
        });
        row.appendChild(input);
        rows.appendChild(row);
      });
    });

    this.renderAcademicKeys();
  },

  /**
   * 学术检索源的 key 行（第二组）：字段表走 api.getAcademicKeyFields
   * （apiKeySchema.academic + keyFields 的 required 标注），当前值走
   * api.getPrefDynamic——与网页源同一条 pref 通路。
   *
   * 状态列是重点：required 且未填时给 warn 色档。那三个源（CORE /
   * Semantic Scholar / Dimensions）在无 key 时直接整源跳过，若不标注，
   * 用户只会感到「结果莫名变少」。
   */
  renderAcademicKeys() {
    var rows = document.getElementById("zsearch-academic-keys-rows");
    if (!rows) return;
    while (rows.firstChild) rows.removeChild(rows.firstChild);
    var self = this;
    var api = window.Zotero.ZSearch.api;
    var fields =
      (api && api.getAcademicKeyFields && api.getAcademicKeyFields()) || [];

    fields.forEach(function (f) {
      var value = String(
        (api.getPrefDynamic && api.getPrefDynamic(f.prefKey)) || "",
      );
      var filled = value.length > 0;

      var row = xul("hbox");
      row.setAttribute("class", "key-row");
      row.setAttribute("align", "center");

      var label = xul("label");
      label.setAttribute("class", "key-label");
      label.value = self.t(f.labelKey);
      label.setAttribute("flex", "1");
      row.appendChild(label);

      var input = xul("textbox");
      input.setAttribute("class", "key-input");
      input.setAttribute(
        "type",
        f.type === "text" || self.keysVisible ? "text" : "password",
      );
      input.setAttribute("size", "28");
      input.setAttribute("flex", "1");
      // XUL textbox 不渲染 placeholder 属性（Zotero 自身也只给 html:input
      // 用），取键途径/限速提示改走 tooltiptext——原生 XUL 的悬停说明位。
      input.setAttribute("tooltiptext", self.t(f.placeholderKey));
      input.value = value;
      input.addEventListener("change", function () {
        api.setPrefDynamic(f.prefKey, input.value);
        // 只重渲本组：整面板重渲会打断正在编辑的另一行
        self.renderAcademicKeys();
      });
      row.appendChild(input);

      var status = xul("label");
      status.setAttribute("class", "key-status");
      if (filled) {
        status.value = self.t("prefs-key-set");
        status.setAttribute("class", "key-status tone-ok");
      } else if (f.required) {
        status.value =
          self.t("prefs-key-missing") + " · " + self.t("prefs-key-required");
        status.setAttribute("class", "key-status tone-warn");
      } else {
        status.value =
          self.t("prefs-key-missing") + " · " + self.t("prefs-key-optional");
        status.setAttribute("class", "key-status tone-idle");
      }
      row.appendChild(status);
      rows.appendChild(row);
    });
  },

  syncTestButton() {
    var btn = document.getElementById("zsearch-source-test");
    if (this.testingId) {
      btn.setAttribute("disabled", "true");
      btn.setAttribute("label", this.t("search-sources-test") + "…");
    } else {
      btn.removeAttribute("disabled");
      btn.setAttribute("label", this.t("search-sources-test"));
    }
  },

  /** 状态行（测试结果/错误）：文本 + 色档，具名 tone-*。 */
  setNote(text, tone) {
    this.setNoteEl(document.getElementById("zsearch-source-note"), text, tone);
  },

  /** 具名提示行：区域/端点/翻译三组各占一行，互不擦写。 */
  setNoteEl(el, text, tone) {
    if (!el) return;
    el.textContent = text || "";
    el.setAttribute("class", "pane-note" + (tone ? " tone-" + tone : ""));
  },

  // ── 网络区域 ────────────────────────────────────────────────────────────

  /** 区域菜单项（label 走 FTL，值即 region pref）。 */
  renderRegionMenu() {
    var popup = document.getElementById("zsearch-region-popup");
    while (popup.firstChild) popup.removeChild(popup.firstChild);
    var self = this;
    var cur = this.regionValue();
    REGION_OPTIONS.forEach(function (o) {
      var mi = xul("menuitem");
      mi.setAttribute("label", self.t(o.labelKey));
      mi.setAttribute("value", o.value);
      if (o.value === cur) mi.setAttribute("selected", "true");
      popup.appendChild(mi);
    });
    document.getElementById("zsearch-region-picker").value = cur;
  },

  regionValue() {
    var api = window.Zotero.ZSearch.api;
    var v = api.getNetworkRegion && api.getNetworkRegion();
    return v === "global" || v === "cn" ? v : "auto";
  },

  /** 区域选项的中文/英文显示名（回显用）。 */
  regionLabel(value) {
    for (var i = 0; i < REGION_OPTIONS.length; i++) {
      if (REGION_OPTIONS[i].value === value)
        return this.t(REGION_OPTIONS[i].labelKey);
    }
    return String(value || "auto");
  },

  /**
   * 切换区域：写 pref + 套用该区域的推荐默认值。
   *
   * 套用是守门的（宿主侧只改「仍是出厂默认」的键）——用户自己选过的搜索源/
   * 引擎不被区域选择推翻；按钮的「重新应用」才 force 覆盖。
   *
   * popuphidden 在「点开又 Esc 关掉」时也会 onto，故这里按值去重：只有区域
   * 真的变了才写 pref、才动提示行。
   */
  async onRegionPicked() {
    var ml = document.getElementById("zsearch-region-picker");
    var region = ml.value || "auto";
    var api = window.Zotero.ZSearch.api;
    if (region === this.regionValue()) return;
    if (api.setNetworkRegion) api.setNetworkRegion(region);
    await this.applyRegion(false);
  },

  async applyRegion(force) {
    var self = this;
    var api = window.Zotero.ZSearch.api;
    var ml = document.getElementById("zsearch-region-picker");
    var region = ml.value || "auto";
    var note = document.getElementById("zsearch-region-note");
    var written =
      (api.applyRegionRecommendations &&
        api.applyRegionRecommendations(region, !!force)) ||
      [];
    if (!written.length) {
      this.setNoteEl(
        note,
        this.t("prefs-region-nochange", { region: this.regionLabel(region) }),
        "warn",
      );
    } else {
      var parts = written.map(function (k) {
        var v = String(api.getPrefDynamic(k) ?? "");
        return self.t(REGION_CHANGE_LABELS[k], { value: v || "—" });
      });
      this.setNoteEl(
        note,
        this.t("prefs-region-applied", {
          region: this.regionLabel(region),
          changes: parts.join(" · "),
        }),
        "ok",
      );
    }
    // 默认搜索源可能被推荐值改写 → 重拉 list 让默认源菜单跟上（keepNote：
    // 不擦上面刚写的提示）。
    await this.refresh(true);
  },

  // ── 中科院分区显隐（region.cassPartition）──────────────────────────────

  /** 分区显隐菜单项（label 走 FTL，值即 region.cassPartition pref）。 */
  renderCassMenu() {
    var popup = document.getElementById("zsearch-cass-popup");
    while (popup.firstChild) popup.removeChild(popup.firstChild);
    var self = this;
    var cur = this.cassValue();
    CASS_OPTIONS.forEach(function (o) {
      var mi = xul("menuitem");
      mi.setAttribute("label", self.t(o.labelKey));
      mi.setAttribute("value", o.value);
      if (o.value === cur) mi.setAttribute("selected", "true");
      popup.appendChild(mi);
    });
    document.getElementById("zsearch-cass-picker").value = cur;
  },

  cassValue() {
    var api = window.Zotero.ZSearch.api;
    var v = String(api.getPrefDynamic("region.cassPartition") ?? "auto");
    return v === "show" || v === "hide" ? v : "auto";
  },

  /** 显隐选项的显示名（回显用）。 */
  cassLabel(value) {
    for (var i = 0; i < CASS_OPTIONS.length; i++) {
      if (CASS_OPTIONS[i].value === value)
        return this.t(CASS_OPTIONS[i].labelKey);
    }
    return String(value || "auto");
  },

  /**
   * 切换分区显隐：写 pref 即生效（后续检索/评分/徽章按新值取数）。
   * 与区域切换同样按值去重——「点开又 Esc 关掉」不落盘、不动提示行。
   */
  onCassPicked() {
    var ml = document.getElementById("zsearch-cass-picker");
    var value = ml.value || "auto";
    var api = window.Zotero.ZSearch.api;
    if (value === this.cassValue()) return;
    api.setPrefDynamic("region.cassPartition", value);
    this.setNoteEl(
      document.getElementById("zsearch-region-note"),
      this.t("prefs-region-cass-applied", { value: this.cassLabel(value) }),
      "ok",
    );
  },

  // ── 区域限定端点 ────────────────────────────────────────────────────────

  /**
   * 端点覆盖行（easyScholar / MinerU 云 / 维基百科域名）。
   *
   * 留空 = 用内置端点；校验形状后才落盘（非法值不写，提示行报错）——
   * 这三个字段都会被拼进请求 URL，坏值必须当场拦住。
   */
  renderEndpoints() {
    var rows = document.getElementById("zsearch-endpoints-rows");
    if (!rows) return;
    while (rows.firstChild) rows.removeChild(rows.firstChild);
    var self = this;
    var api = window.Zotero.ZSearch.api;
    var fields = (api.getEndpointFields && api.getEndpointFields()) || [];
    fields.forEach(function (f) {
      var row = xul("hbox");
      row.setAttribute("class", "key-row");
      row.setAttribute("align", "center");

      var label = xul("label");
      label.setAttribute("class", "key-label");
      label.value = self.t(f.labelKey);
      label.setAttribute("flex", "1");
      row.appendChild(label);

      var input = xul("textbox");
      input.setAttribute("class", "key-input");
      input.setAttribute("type", "text");
      input.setAttribute("size", "28");
      input.setAttribute("flex", "1");
      input.setAttribute("tooltiptext", self.t(f.placeholderKey));
      input.value = String(api.getPrefDynamic(f.prefKey) ?? "");
      input.addEventListener("change", function () {
        var raw = input.value;
        // 校验与归一化都问宿主（endpointSchema 单一事实源）：面板沙箱不持正则，
        // 非法值不落盘，提示行报错。
        var bad = api.validateEndpointValue
          ? api.validateEndpointValue(f.fieldId, raw)
          : "";
        if (bad) {
          self.setNoteEl(
            document.getElementById("zsearch-endpoints-note"),
            self.t(bad),
            "bad",
          );
          return;
        }
        var value = api.normalizeEndpointValue
          ? api.normalizeEndpointValue(f.fieldId, raw)
          : String(raw || "").trim();
        api.setPrefDynamic(f.prefKey, value);
        self.setNoteEl(
          document.getElementById("zsearch-endpoints-note"),
          "",
          "",
        );
      });
      row.appendChild(input);
      rows.appendChild(row);
    });
  },

  // ── 翻译引擎 ────────────────────────────────────────────────────────────

  renderTranslateEngine() {
    var popup = document.getElementById("zsearch-translate-engine-popup");
    while (popup.firstChild) popup.removeChild(popup.firstChild);
    var self = this;
    var api = window.Zotero.ZSearch.api;
    var cur =
      String(api.getPrefDynamic("translate.engineType") ?? "") || "google";
    ENGINE_OPTIONS.forEach(function (o) {
      var mi = xul("menuitem");
      mi.setAttribute("label", self.t(o.labelKey));
      mi.setAttribute("value", o.value);
      if (o.value === cur) mi.setAttribute("selected", "true");
      popup.appendChild(mi);
    });
    var ml = document.getElementById("zsearch-translate-engine");
    ml.value = cur;
    this.syncBingRegionEnabled(cur);
  },

  /** Azure 订阅区只对 Azure Translator 引擎有意义——其余引擎置灰。 */
  syncBingRegionEnabled(engine) {
    var ml = document.getElementById("zsearch-translate-bingregion");
    var lab = document.getElementById("zsearch-translate-bingregion-label");
    if (engine === "bing") {
      ml.removeAttribute("disabled");
      if (lab) lab.removeAttribute("disabled");
    } else {
      ml.setAttribute("disabled", "true");
      if (lab) lab.setAttribute("disabled", "true");
    }
  },

  renderTranslateBingRegion() {
    var popup = document.getElementById("zsearch-translate-bingregion-popup");
    while (popup.firstChild) popup.removeChild(popup.firstChild);
    var api = window.Zotero.ZSearch.api;
    var cur =
      String(api.getPrefDynamic("translate.bing.region") ?? "") || "global";
    AZURE_REGIONS.forEach(function (r) {
      var mi = xul("menuitem");
      mi.setAttribute("label", r);
      mi.setAttribute("value", r);
      if (r === cur) mi.setAttribute("selected", "true");
      popup.appendChild(mi);
    });
    document.getElementById("zsearch-translate-bingregion").value = cur;
  },

  // ── 交互 ────────────────────────────────────────────────────────────────

  onSelect() {
    var list = document.getElementById("zsearch-source-list");
    var item = list.selectedItem;
    this.selectedId = item ? item.getAttribute("value") : null;
  },

  async toggleAdded(id) {
    var api = window.Zotero.ZSearch.api;
    var added = this.addedIds().indexOf(id) >= 0;
    try {
      await this.call(added ? "searchSources.remove" : "searchSources.add", {
        id,
      });
    } catch (e) {
      this.setNote(
        this.t("search-sources-test-failed", {
          detail: String(e && e.message ? e.message : e).slice(0, 120),
        }),
        "bad",
      );
    }
    await this.refresh(true);
  },

  async runTestSelected() {
    var id = this.selectedId;
    if (!id) {
      this.setNote(this.t("prefs-select-source"), "warn");
      return;
    }
    this.testingId = id;
    this.syncTestButton();
    this.setNote(id + " …", "busy");
    try {
      var r = await this.call("searchSources.test", { id });
      if (r && r.ok) {
        this.setNote(
          this.t("search-sources-test-ok", { count: r.count || 1 }),
          "ok",
        );
      } else if (r && r.kind === "missing-key") {
        this.setNote(this.t("search-sources-test-missing-key"), "warn");
      } else if (r && r.kind === "auth") {
        this.setNote(this.t("search-sources-test-auth"), "bad");
      } else if (r && r.kind === "unreachable") {
        this.setNote(this.t("search-sources-test-unreachable"), "bad");
      } else {
        this.setNote(
          this.t("search-sources-test-failed", {
            detail: String(r && r.detail ? r.detail : ""),
          }),
          "bad",
        );
      }
    } catch (e) {
      this.setNote(
        this.t("search-sources-test-failed", {
          detail: String(e && e.message ? e.message : e).slice(0, 120),
        }),
        "bad",
      );
    }
    this.testingId = null;
    this.syncTestButton();
    await this.refresh(true);
  },

  async onDefaultPicked() {
    var ml = document.getElementById("zsearch-default-provider");
    var id = ml.value;
    if (!id) return;
    try {
      await this.call("searchSources.setDefault", { id });
      var picked = null;
      this.sources().forEach(function (x) {
        if (x.id === id) picked = x;
      });
      this.setNote(
        this.t("prefs-default-set", { name: picked ? picked.label : id }),
        "ok",
      );
    } catch (e) {
      this.setNote(
        this.t("search-sources-test-failed", {
          detail: String(e && e.message ? e.message : e).slice(0, 120),
        }),
        "bad",
      );
    }
    await this.refresh(true);
  },

  toggleKeysVisible() {
    this.keysVisible = document.getElementById("zsearch-show-keys").checked;
    this.renderKeys();
    this.renderAcademicKeys();
  },
};

// fragment 根 load 事件捕获（本 Sandbox 符号不进主作用域，勿用 onload 属性）。
// 面板只加载一次；重复触发时 init 幂等（render 全量重建）。
document.addEventListener(
  "load",
  function (e) {
    var t = e.target;
    if (t && t.id === "zsearch-prefpane") {
      ZSearchPrefs.init();
    }
  },
  true,
);
