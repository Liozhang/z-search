/**
 * originGate — 窗口通信来源闸门的 TS 侧（2026-09-10 安全批）。
 *
 * 与 `addon/content/shared/originGate.js` 是**同判据的镜像**：宿主窗口脚本是纯
 * JS（XUL 直接 `<script src>` 加载，不经打包），无法 import 本模块，所以判据存在
 * 两份。两份的一致性由 `tests/unit/bridge/originGate.test.ts` 逐例对拍保证——
 * 改任一份必须同步改另一份，否则对拍测试变红。
 *
 * ⚠ 勿改成身份比较：`e.source === iframeWindow` 在 Gecko chrome 特权上下文里
 * 永不相等（XPCNativeWrapper；见 PostMessageBridge 头注与 chatWindow.js 同款教训）。
 * 判据只用字符串（origin）。
 *
 * **与 JS 侧的一处有意不对称（2026-09-11）**：宿主窗口脚本（JS 侧）在
 * `chrome:`/`file:` 放行分支上多一道**身份证伪器** `sourceIsIframe(event, iframeWin)`
 * ——它能拿到原始 MessageEvent 与 `<iframe>` 元素，故可"能证伪才拒"（reason
 * `chrome-file-foreign-source`）。本模块的 `checkInbound` 只收 origin 字符串与
 * parent **窗口**（非元素，无 `contentWindow`），拿不到 `event.source`，因此**没有**
 * 这道探针，在同类输入上一律返回放行（reason `chrome-file-any-origin`）。
 * 对拍测试在无 `event.source` 的输入上逐例相等，故该不对称不违反镜像契约；
 * 要为本侧补探针需先改签名（把 event 传进来），属独立设计项。
 *
 * 降级契约：origin 不可判定（跨源 / 已销毁 / opaque "null"）→ 放行，enforced=false。
 * 能判定时判据可靠：合法消息必然来自该文档，其 origin 必然相等。
 */

/**
 * 把「窗口 or 元素」归一成窗口。
 *
 * 宿主脚本传进来的是 <iframe> **元素**（见 `hubWindow.js` 的 `_checkInbound`），而
 * `HTMLIFrameElement.location` 在 Gecko 上不保证可用（可能没有该属性，也可能返回
 * URL 字符串而非 Location 对象）。若直接读它，`readOrigin` 会恒返回 ""，入站闸门就
 * 静默退化成「全部放行」——比漏判更隐蔽，因为表面上门还在。故先按 `contentWindow`
 * 归一：真窗口原样返回（no-op），元素则取其 contentWindow。
 */
export function resolveWindow(w: unknown): unknown {
  if (!w) return w;
  try {
    const loc = (w as any).location;
    if (loc && typeof loc === "object" && typeof loc.origin === "string") {
      return w;
    }
  } catch {
    /* .location 读不到 —— 可能是元素，继续试 contentWindow */
  }
  try {
    const cw = (w as any).contentWindow;
    if (cw) return cw;
  } catch {
    /* ignore */
  }
  return w;
}

/** 读窗口 origin；读不到或 opaque 时返回 ""。永不抛。 */
export function readOrigin(win: unknown): string {
  try {
    const w = resolveWindow(win) as any;
    const loc = w?.location;
    const o = loc?.origin;
    if (typeof o === "string" && o !== "" && o !== "null") return o;
  } catch {
    /* 跨源或已销毁 */
  }
  return "";
}

/** 回包 targetOrigin：能确定用精确 origin，否则 "*"（保持既有行为，不炸）。 */
/** 回包 targetOrigin：能确定用精确 origin，消除 `'*'` 广播面。
 *  chrome:/file: 协议在 Firefox 特权上下文里会被当作 opaque null origin 处理
 *  （location.origin 返回包字符串，但 postMessage 实际拒绝非 '*' 目标），
 *  故这类协议统一退回 '*'。 */
export function replyOrigin(win: unknown): string {
  const o = readOrigin(win);
  if (o.startsWith("chrome:") || o.startsWith("file:")) return "*";
  return o || "*";
}

export interface InboundVerdict {
  accept: boolean;
  enforced: boolean;
  reason: string;
}

/**
 * 入站判据。
 * @param eventOrigin 原始 MessageEvent.origin（调用方传字符串，便于镜像与单测）
 * @param expectedWin 期望来源窗口（iframe 或 parent）
 */
export function checkInbound(
  eventOrigin: string | undefined,
  expectedWin: unknown,
): InboundVerdict {
  const expected = readOrigin(expectedWin);
  if (!expected) {
    return { accept: true, enforced: false, reason: "origin-unknown" };
  }
  const got = (eventOrigin ?? "").trim();
  if (got === expected) {
    return { accept: true, enforced: true, reason: "ok" };
  }
  // chrome:/file: 窗口：origin 判据在这类文档上不可靠（Firefox 按 opaque origin
  // 处理），故既不据 origin 放行也不据 origin 拒绝。JS 侧（宿主窗口脚本）在此处
  // 另有一道身份证伪器——能证伪才拒、证实则 enforced=true、证不实则落到本分支。
  // 本模块拿不到 `event.source`，因此**恒**落到下面这条"不可判定即放行"。
  if (expected.startsWith("chrome:") || expected.startsWith("file:")) {
    return {
      accept: true,
      enforced: false,
      reason: got === "null" ? "opaque-chrome-file" : "chrome-file-any-origin",
    };
  }
  return { accept: false, enforced: true, reason: `origin-mismatch:${got}` };
}
