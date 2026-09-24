/**
 * originGate — iframe ↔ 宿主窗口通信的来源闸门（2026-09-10 安全批）。
 *
 * 为什么单独成文件：入站判定必须读原始 MessageEvent（e.origin），而它只存在于
 * XUL 宿主窗口脚本里；hub / chat 两份窗口脚本必须用同一套判据，故提取共享。
 *
 * ⚠ 关键约束（勿改成身份比较）：不能用 `e.source === iframe.contentWindow` 做
 * 身份判定。本仓 src/bridge/PostMessageBridge.ts:170-173 与 chatWindow.js:191-193
 * 都已记录：Gecko chrome 特权上下文里 e.source 是 XPCNativeWrapper，永不与 DOM
 * 侧窗口引用相等，会让**所有**消息静默丢失。因此判据只用字符串（origin）比较。
 *
 * 例外：`chrome:`/`file:` 窗口的 origin 判据不可靠（Firefox 把这类文档按 opaque
 * origin 处理，见下方 checkInbound），此时额外问一次**窗口身份**——但仍然不把
 * `===` 当判据，只当**证伪器**（见 sourceIsIframe：能证伪才拒，证不实维持放行）。
 *
 * 降级契约（同样勿改）：origin 读不到（跨源 / 已被销毁 / opaque "null"）时
 * **放行**并返回 enforced=false，由调用方打一次 debug 警告。理由：读不到时无法
 * 判断，宁可保持既有行为，也不赌一个会导致通信全断的猜测。反之，能读到 origin
 * 时判据是**可靠**的——合法消息必然来自该 iframe 文档，其 origin 必然相等。
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LeaderoOriginGate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  /**
   * 把「窗口 or 元素」归一成窗口。
   *
   * 宿主脚本传进来的是 <iframe> **元素**，而 `HTMLIFrameElement.location` 在 Gecko
   * 上不保证可用（可能没有该属性，也可能返回 URL 字符串而非 Location 对象）。若直接
   * 读它，`readOrigin` 会恒返回 ""，入站闸门就静默退化成「全部放行」——比漏判更隐蔽，
   * 因为表面上门还在。故先按 `contentWindow` 归一：真窗口原样返回（no-op），
   * 元素则取其 contentWindow。任何读取失败都退回原值，交由 readOrigin 兜空串。
   */
  function resolveWindow(w) {
    if (!w) return w;
    try {
      var loc = w.location;
      if (loc && typeof loc === "object" && typeof loc.origin === "string") {
        return w;
      }
    } catch (ex) {
      /* .location 读不到 —— likely an element; 继续试 contentWindow */
    }
    try {
      if (w.contentWindow) return w.contentWindow;
    } catch (ex) {
      /* ignore */
    }
    return w;
  }

  /**
   * 读取窗口的 origin。读不到或为 opaque（"null"）时返回 ""。
   * 永不抛异常。
   */
  function readOrigin(win) {
    try {
      var w = resolveWindow(win);
      var loc = w && w.location;
      var o = loc && loc.origin;
      if (typeof o === "string" && o !== "" && o !== "null") return o;
    } catch (ex) {
      /* 跨源、窗口已销毁 —— 落到 "" */
    }
    return "";
  }

  /**
   * 计算回包 targetOrigin：能确定就用精确 origin（消除 `'*'` 广播面），
   * chrome:/file: 协议在 Firefox 特权上下文里会被当作 opaque null origin 处理
   * （location.origin 返回包字符串，但 postMessage 实际拒绝非 '*' 目标），
   * 故这类协议统一退回 '*'。不能确定就退回 "*"（保持既有行为，不炸）。
   */
  function replyOrigin(win) {
    var o = readOrigin(win);
    if (o.indexOf("chrome:") === 0 || o.indexOf("file:") === 0) return "*";
    return o || "*";
  }

  /**
   * 窗口身份探针 —— 只给 chrome:/file: 的放行分支当**证伪器**用。
   *
   * 头注的教训是「不能拿 `===` 当身份判据」（XPCNativeWrapper 下永不成立，会
   * 让所有消息静默丢失）。所以这里不把它当判据，只当证伪器：
   *   true  = 确认来自目标 iframe（解包后相等，或两者文档 URL 相同）
   *   false = 确认来自别的窗口（两者 URL 都读得到且不同）
   *   null  = 无法判定 → 调用方维持原降级契约（放行）
   *
   * 所有读取失败一律落到 null，因此本探针**不可能**制造新的通信中断；它只能把
   * 「任何 origin 都放行」收窄成「能证伪才拒」。
   *
   * @param event 原始 MessageEvent（须有 .source）
   * @param iframeWin 宿主窗口持有的 <iframe> 元素（须有 .contentWindow）；
   *                  TS 侧收到的是 parent 窗口而非元素，故无此探针（见 originGate.ts 头注）。
   */
  function sourceIsIframe(event, iframeWin) {
    try {
      var src = event && event.source;
      var cw = iframeWin && iframeWin.contentWindow;
      if (!src || !cw) return null;
      if (src === cw) return true;
      // 1) 解包后身份相等 —— XPCNativeWrapper 场景的正解
      try {
        if (
          src.wrappedJSObject &&
          cw.wrappedJSObject &&
          src.wrappedJSObject === cw.wrappedJSObject
        ) {
          return true;
        }
      } catch (ex) {
        /* 不可解包 —— 继续下一条 */
      }
      // 2) 文档 URL 相同（同特权的 chrome 文档互相可读 location）
      var a = null;
      var b = null;
      try {
        a = src.location && src.location.href;
      } catch (ex) {
        a = null;
      }
      try {
        b = cw.location && cw.location.href;
      } catch (ex) {
        b = null;
      }
      if (typeof a === "string" && typeof b === "string") return a === b;
      return null;
    } catch (ex) {
      return null;
    }
  }

  /**
   * 入站消息判据。
   * @returns {{accept: boolean, enforced: boolean, reason: string}}
   *   accept=false → 调用方必须丢弃该消息
   *   enforced=false → origin 不可判定 / 身份未证，已按降级契约放行
   */
  function checkInbound(event, iframeWin) {
    var expected = readOrigin(iframeWin);
    if (!expected) {
      return { accept: true, enforced: false, reason: "origin-unknown" };
    }
    var got = (event && event.origin ? event.origin : "").trim();
    if (got === expected) {
      return { accept: true, enforced: true, reason: "ok" };
    }
    // chrome:/file: 窗口：origin 判据在这类文档上不可靠（Firefox 按 opaque origin
    // 处理，PDF.js 等第三方内容也可能注入非常规 origin，XPCNativeWrapper 会扭曲
    // origin 字符串），所以既不据 origin 放行也不据 origin 拒绝——改问**窗口身份**：
    // 能证伪才拒（=== false），证不实则维持原降级契约放行。
    //
    // 注意这里的顺序：探针必须在下面 `got === "null"` 之前跑。真实 chrome://
    // iframe 的 e.origin 通常正是 "null"，若先走 opaque 分支，探针就永远不执行，
    // 加固等于没做。
    if (expected.indexOf("chrome:") === 0 || expected.indexOf("file:") === 0) {
      var sameSource = sourceIsIframe(event, iframeWin);
      if (sameSource === false) {
        return {
          accept: false,
          enforced: true,
          reason: "chrome-file-foreign-source",
        };
      }
      if (sameSource === true) {
        return {
          accept: true,
          enforced: true,
          reason: "chrome-file-source-identity",
        };
      }
      return {
        accept: true,
        enforced: false,
        reason:
          got === "null" ? "opaque-chrome-file" : "chrome-file-any-origin",
      };
    }
    return { accept: false, enforced: true, reason: "origin-mismatch:" + got };
  }

  return {
    readOrigin: readOrigin,
    replyOrigin: replyOrigin,
    checkInbound: checkInbound,
    sourceIsIframe: sourceIsIframe,
    resolveWindow: resolveWindow,
  };
});
