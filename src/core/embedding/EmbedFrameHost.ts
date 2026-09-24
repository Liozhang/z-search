/**
 * EmbedFrameHost — main-process host for the off-screen embed iframe.
 *
 * Owns the lifecycle of the hidden about:blank iframe (attached to the main
 * Zotero window) that runs embed-standalone.js — @huggingface/transformers
 * plus the ORT wasm backend inside a real window context, where dynamic
 * import() works (see embed-frame.ts for why the bootstrap sandbox cannot).
 *
 * Mirrors DiagramRenderer's iframe pattern: off-screen positioning (not
 * display:none), chrome:// script URL, direct cross-compartment calls on the
 * frame window global, thread-safe lazy init, and one re-init retry if the
 * frame dies (main window closed / zone collapsed).
 *
 * @module core/embedding/EmbedFrameHost
 */

import type { EmbedFrameRequest, EmbedFrameError } from "./embedFrameLogic";
import { toErrorMessage } from "../../utils/error";
import { safeDebug } from "../../utils/logger";

interface EmbedFrameGlobal {
  embed(req: EmbedFrameRequest): Promise<{
    vector?: number[];
    error?: EmbedFrameError;
  }>;
  dispose(modelName: string): void;
}

interface FrameHandle {
  iframe: HTMLIFrameElement;
  api: EmbedFrameGlobal;
}

class EmbedFrameHostImpl {
  private frame: FrameHandle | null = null;
  private initPromise: Promise<FrameHandle> | null = null;

  /**
   * Readied lazily per embed() call. `rootURI` (bootstrap global) addresses
   * the shipped script; absent outside the plugin runtime (vitest), init
   * fails with an actionable error — callers surface it through the historic
   * "Failed to load local embedding model" wrapping.
   */
  async ensure(): Promise<FrameHandle> {
    // FD-09：成功 init 后 frame 死亡（主窗关闭/zone 折叠致 contentWindow 卸载）
    // 时，initPromise 仍是那个已 resolve 的旧 promise——ensure 会永远返回死
    // handle，"can't access dead object" 直至重启。显式丢弃死 handle 才能让
    // 注释宣称的 re-init 生效。frame 为 null 且 initPromise 在场的并发路径
    // （另一调用正在 init）行为不变：返回同一 promise。
    if (this.frame && !this.isAlive(this.frame)) {
      this.frame = null;
      this.initPromise = null;
    }
    if (this.frame) return this.frame;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    try {
      this.frame = await this.initPromise;
      return this.frame;
    } catch (e) {
      // Allow a later retry (e.g. main window was not ready yet).
      this.initPromise = null;
      throw e;
    }
  }

  private isAlive(f: FrameHandle): boolean {
    try {
      return !!(
        f.iframe.contentWindow &&
        (f.iframe.contentWindow as any).zsearchEmbedFrame
      );
    } catch {
      return false;
    }
  }

  private async _initialize(): Promise<FrameHandle> {
    const win = Zotero.getMainWindow();
    const parentDoc = win?.document as Document | undefined;
    if (!parentDoc) {
      throw new Error("EmbedFrameHost: no main window document available");
    }
    if (typeof rootURI === "undefined") {
      throw new Error(
        "EmbedFrameHost: rootURI unavailable outside the plugin runtime",
      );
    }

    // 父文档类型决定元素命名空间：XUL 主窗里 XHTML 命名空间的 iframe 拿不到
    // frame loader（contentWindow 恒 null，真机第4轮实锤），必须用 chrome 标准
    // 的 xul:iframe；HTML 文档（如 vitest/未来 HTML 宿主）保持 DiagramRenderer
    // 同款的 XHTML iframe。
    const isXulDoc =
      parentDoc.documentElement?.namespaceURI ===
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    const iframe = (
      isXulDoc
        ? parentDoc.createElement("iframe")
        : parentDoc.createElementNS("http://www.w3.org/1999/xhtml", "iframe")
    ) as HTMLIFrameElement;
    iframe.setAttribute("src", "about:blank");
    iframe.setAttribute("id", "leadero-embed-frame");
    iframe.style.cssText =
      "position:absolute;top:-9999px;left:-9999px;width:900px;height:600px;border:none;";

    const root = parentDoc.documentElement || parentDoc.body;
    if (!root) {
      throw new Error("embed iframe: main window document has no root");
    }
    root.appendChild(iframe);

    // FD-28：初始化失败（contentWindow 轮询超时/脚本装载失败/ready 超时/API
    // 缺失）时摘除已挂载的 iframe——否则帧环境持续坏时每次调用都会往主窗
    // 再挂一个同 id 离屏 docshell，累积泄漏。
    try {
      return await this._readyFrame(iframe);
    } catch (e) {
      try {
        iframe.remove();
      } catch {
        /* 主窗已不在：无需清理 */
      }
      throw e;
    }
  }

  /** _initialize 的后半段：iframe 已挂载，等待 contentWindow → 装载脚本 → 就绪。 */
  private async _readyFrame(iframe: HTMLIFrameElement): Promise<FrameHandle> {
    // ⚠️ NO load-event wait here: in the XUL main window the about:blank
    // iframe neither fires load nor reaches complete within any useful
    // window (真机实测：15s 超时 + 探针早前见 readyState 数分钟后才变
    // complete）。The frame is empty by construction — appending the script
    // into a loading about:blank document is safe and is what executes it.
    // (mermaid needs a load wait for SVG layout; embedding has no layout
    // dependency, so the wait is pure liability.)

    // xul:iframe 的 about:blank docshell 初始化对空文档是同步的，但真机轮次的
    // 教训是「同步假设必须带界」：有界轮询 5s，拿不到就是结构错误。
    if (!iframe.contentDocument || !iframe.contentWindow) {
      await new Promise<void>((resolve, reject) => {
        const t0 = Date.now();
        const poll = () => {
          if (iframe.contentDocument && iframe.contentWindow) return resolve();
          if (Date.now() - t0 > 5000) {
            return reject(
              new Error("embed iframe never acquired a content window"),
            );
          }
          setTimeout(poll, 50);
        };
        setTimeout(poll, 0);
      });
    }
    const frameWin = iframe.contentWindow!;

    // <script> 元素路径真机第5轮证明不可靠：chrome:// 子资源挂进 xul:iframe
    // 的 about:blank 文档后 onload 20s 不触发（docshell 脚本装载管线挂起，
    // 无 onload/onerror 任何事件）。loadSubScript 绕过整条事件管线——同步读
    // URI、同步求值，bootstrap.js 装载插件本体用的就是它。帧窗口是真 window
    // （自带 ScriptLoader），帧内动态 import() 因此可解析——这正是 iframe 化
    // 的立意。try 界定：失败即刻可行动错误，不悬死。
    try {
      const Services = (globalThis as any).Services;
      if (!Services?.scriptloader) {
        throw new Error("Services.scriptloader unavailable in this context");
      }
      Services.scriptloader.loadSubScript(
        "chrome://zsearch/content/scripts/embed-standalone.js",
        frameWin,
        "UTF-8",
      );
    } catch (e) {
      throw new Error(`embed frame script load failed: ${toErrorMessage(e)}`, {
        cause: e,
      });
    }

    // The entry module kicks off the transformers import immediately; expose
    // the API only after that settles so the first embed never races it.
    // 60s cap — the transformers import is in-bundle (fast), a longer wait
    // means the frame environment is broken and the caller should see why.
    const ready = (frameWin as any).zsearchEmbedFrameReady as
      Promise<void> | undefined;
    if (ready) {
      // Timer 必须在竞态决出后回收：ready 先胜时若留着未清的 60s 定时器，
      // 它会持着帧窗口闭包到点才释放（一次性 no-op 拒绝）。finally 覆盖两条
      // 分支，超时那条也一并清掉自己。
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          ready,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("embed frame init timed out (60s)")),
              60000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    const api = (frameWin as any).zsearchEmbedFrame as EmbedFrameGlobal;
    if (!api || typeof api.embed !== "function") {
      throw new Error("embed frame API missing after script load");
    }
    return { iframe, api };
  }

  /**
   * Run one embed request in the frame. Errors come back structured and are
   * THROWN here as plain Errors carrying the frame message — the provider
   * wraps them with its historic per-kind texts.
   */
  async embed(req: EmbedFrameRequest): Promise<number[]> {
    const { api } = await this.ensure();
    const res = await api.embed(req);
    if (res.error) {
      throw new Error(`${res.error.kind}: ${res.error.message}`);
    }
    return res.vector ?? [];
  }

  dispose(modelName: string): void {
    const f = this.frame;
    if (!f || !this.isAlive(f)) return;
    try {
      f.api.dispose(modelName);
    } catch (e) {
      safeDebug("[z-search] EmbedFrameHost: " + e);
    }
  }
}

export const EmbedFrameHost = new EmbedFrameHostImpl();
export type { EmbedFrameRequest, EmbedFrameError };
