/* eslint-disable no-undef, no-restricted-globals */
var { Zotero } = ChromeUtils.importESModule(
  "chrome://zotero/content/zotero.mjs",
);

var _XHTML = "http://www.w3.org/1999/xhtml";

var _bridge = null;
var _iframe = null;
var _initError = null;
var _initFailed = false;
var _initTimerId = null;
var _fallbackTimerId = null;
var _readyHandler = null;
var _themeObserver = null;

/** Tag for injected base-font style — removed on re-injection (font-size change) */
var _THEME_STYLE_CLASS = "leadero-theme-inject";

/** Sync the XUL host root font-size into the iframe html so rem calculations
 *  match Zotero (user font-size / UI-density preference). This is the ONLY
 *  runtime style sync left: since the 2026-08-25 decoupling batch, leadero
 *  CSS variables are fully static and light/dark follows prefers-color-scheme
 *  (driven by Zotero's browser.theme.toolbar-theme) purely in CSS — no
 *  variable snapshot is injected anymore. */
function injectBaseFont(iframeDoc) {
  try {
    // Idempotent: drop the previous style before appending a fresh one
    var stale = iframeDoc.querySelectorAll("head style." + _THEME_STYLE_CLASS);
    for (var k = 0; k < stale.length; k++) stale[k].remove();
    var cs = window.getComputedStyle(document.documentElement);
    var rootFontSize = cs.getPropertyValue("font-size").trim() || "13px";
    var htmlStyle = iframeDoc.createElement("style");
    htmlStyle.setAttribute("class", _THEME_STYLE_CLASS);
    htmlStyle.textContent = "html { font-size: " + rootFontSize + "; }";
    iframeDoc.head.appendChild(htmlStyle);
  } catch (ex) {
    /* cross-origin or not ready */
  }
}

function createHubIframe() {
  var container = document.getElementById("zsearch-hub-iframe-container");
  if (!container) return;

  var initialized = false;
  var initRetries = 0;
  var MAX_INIT_RETRIES = 100; // 100 × 50ms = 5s max
  _initFailed = false; // Reset on each iframe creation (handles window reuse)

  function initialize() {
    if (initialized) return;
    _bridge = _bridge || window.__hubBridge;
    if (!_bridge) {
      if (++initRetries < MAX_INIT_RETRIES && !window.__hubDestroyed) {
        clearTimeout(_initTimerId);
        _initTimerId = setTimeout(initialize, 50);
      }
      return;
    }
    initialized = true;
    try {
      if (_bridge.setIframeWindow) {
        _bridge.setIframeWindow(_iframe.contentWindow);
      }
      _iframe.contentWindow.postMessage(
        {
          type: "zsearch-hub-init",
        },
        "*",
      );
    } catch (ex) {
      initialized = false;
      _initError = ex.message || String(ex);
      if (++initRetries < MAX_INIT_RETRIES && !window.__hubDestroyed) {
        clearTimeout(_initTimerId);
        _initTimerId = setTimeout(initialize, 100);
      }
    }
  }

  var iframe = document.createElementNS(_XHTML, "iframe");
  iframe.setAttribute("src", "chrome://zsearch/content/hub/hub.html");
  iframe.setAttribute(
    "style",
    "width:100%;height:100%;border:none;display:block;flex:1;",
  );
  iframe.setAttribute("id", "zsearch-hub-iframe");

  var readyHandler = function (e) {
    if (e.data && e.data.type === "zsearch-hub-ready") {
      window.removeEventListener("message", readyHandler);
      _readyHandler = null;
      initialize();
    }
  };
  _readyHandler = readyHandler;
  window.addEventListener("message", readyHandler);

  iframe.addEventListener("load", function () {
    if (_readyHandler === readyHandler) {
      window.removeEventListener("message", readyHandler);
      _readyHandler = null;
    }
    try {
      injectBaseFont(_iframe.contentDocument);
    } catch (ex) {}
    initialize();
  });

  // 10-second fallback: show error if init never completed
  clearTimeout(_fallbackTimerId);
  _fallbackTimerId = setTimeout(function () {
    if (initialized) return;
    _initFailed = true;
    if (_readyHandler === readyHandler) {
      window.removeEventListener("message", readyHandler);
      _readyHandler = null;
    }
    var container = document.getElementById("zsearch-hub-iframe-container");
    try {
      var winName =
        document.l10n.formatValueSync("zsearch-hub-window.title") || "Leadero";
      var failMsg =
        document.l10n.formatValueSync("window-init-failed", {
          name: winName,
        }) || winName + " failed to initialize.";
      var retryMsg =
        document.l10n.formatValueSync("window-init-failed-retry") ||
        "Please try closing and reopening the window.";
      var root = _iframe
        ? _iframe.contentDocument &&
          _iframe.contentDocument.getElementById("root")
        : null;
      if (root) {
        var detail = _initError ? "<br><br>Error: " + _initError : "";
        // iframe contentDocument：token 全静态（2026-08-25 脱钩），错误分支直接写死色值，
        // 不引用 token（此分支仅在初始化失败时触发，React 未挂载时 token 可能不可用）。
        root.innerHTML =
          '<div style="padding:40px;color:#dc2626;font-family:sans-serif;text-align:center;">' +
          "<b>" +
          failMsg +
          "</b>" +
          detail +
          "<br><br>" +
          retryMsg +
          "</div>";
      } else if (container) {
        var errorDiv = container.ownerDocument.createElementNS(_XHTML, "div");
        // 错误兜底页直接写死色值（2026-08-25 脱钩批：不再引用 Zotero 原生 token；
        // 浅灰底 #f5f5f5 在亮暗主题下均可读，错误红 #dc2626）。
        errorDiv.setAttribute(
          "style",
          "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#f5f5f5;color:#dc2626;font:13px sans-serif;",
        );
        errorDiv.innerHTML =
          '<div style="padding:40px;text-align:center;">' +
          '<b style="font-size:18px;display:block;margin-bottom:8px;">' +
          failMsg +
          "</b>" +
          "<span>" +
          retryMsg +
          "</span></div>";
        container.appendChild(errorDiv);
      }
    } catch {
      /* cross-origin or destroyed */
    }
  }, 10000);

  container.appendChild(iframe);
  _iframe = iframe;
}

function onIframeMessage(e) {
  if (!_iframe) return;
  var data = e.data;
  if (!data || typeof data !== "object") return;
  var t = data.type || "";
  if (t !== "zsearch-req" && t !== "zsearch-notify") return;

  // 来源闸门（2026-09-10 安全批）：只接受来自本 iframe 文档的消息。判据用
  // origin 字符串而非 e.source 身份比较——XPCNativeWrapper 陷阱见
  // shared/originGate.js 头注。origin 不可判定时按降级契约放行并打一次警告。
  var gate = _checkInbound(e);
  if (!gate.accept) return;
  if (!gate.enforced && !_originUnknownWarned) {
    _originUnknownWarned = true;
    try {
      Zotero.debug(
        "[Leadero] hubWindow: iframe origin unreadable — inbound origin check skipped (" +
          gate.reason +
          ")",
      );
    } catch (ex) {
      /* debug unavailable */
    }
  }

  var bridge = _bridge || window.__hubBridge;
  if (bridge && bridge.handleIframeMessage) {
    _bridge = bridge;
    bridge.handleIframeMessage(data, e.source || _iframe.contentWindow);
  }
}

var _originUnknownWarned = false;

/** 来源闸门调用：originGate.js 缺失时降级为放行，绝不因守卫缺失而断通信。 */
function _checkInbound(e) {
  var g = window.LeaderoOriginGate;
  if (!g || typeof g.checkInbound !== "function") {
    return { accept: true, enforced: false, reason: "gate-missing" };
  }
  return g.checkInbound(e, _iframe);
}

async function onLoad() {
  await Zotero.initializationPromise;
  await Zotero.uiReadyPromise;

  Zotero.UIProperties.registerRoot(document.documentElement);

  // Localize window title via Fluent
  try {
    if (document.l10n) {
      await document.l10n.ready;
      document.l10n.translateRoot?.();
      var hubTitle = document.l10n.formatValueSync("zsearch-hub-window.title");
      if (hubTitle) document.title = hubTitle;
    }
  } catch {
    /* best-effort */
  }

  window.addEventListener("keydown", function (event) {
    var isMac = Zotero.isMac;
    var isClose = isMac
      ? event.key === "w" &&
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      : event.key === "w" && event.ctrlKey && !event.altKey && !event.shiftKey;
    if (isClose) {
      event.preventDefault();
      window.close();
    }
  });

  _bridge = window.__hubBridge || null;

  window.addEventListener("message", onIframeMessage);
  createHubIframe();

  // Watch for Zotero font-size / UI-density changes (root style mutations)
  // and re-sync the base font so the Hub iframe follows without a reopen.
  // Light/dark switches need no JS: leadero tokens are fully static since the
  // 2026-08-25 decoupling batch, and in chrome documents prefers-color-scheme
  // follows Zotero's theme pref (browser.theme.toolbar-theme, incl. auto mode
  // tracking the OS), so the CSS @media dark overrides switch on their own.
  _themeObserver = new MutationObserver(function () {
    if (_iframe && _iframe.contentDocument) {
      try {
        injectBaseFont(_iframe.contentDocument);
      } catch (ex) {}
    }
  });
  _themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class"],
  });
}

function onUnload() {
  window.__hubDestroyed = true;
  clearTimeout(_initTimerId);
  clearTimeout(_fallbackTimerId);
  if (_themeObserver) {
    _themeObserver.disconnect();
    _themeObserver = null;
  }
  if (_readyHandler) {
    window.removeEventListener("message", _readyHandler);
    _readyHandler = null;
  }
  window.removeEventListener("message", onIframeMessage);
  if (_bridge) {
    _bridge.destroy();
    _bridge = null;
  }
  _iframe = null;
}

window.addEventListener("load", onLoad, { once: true });
window.addEventListener("unload", onUnload, { once: true });
