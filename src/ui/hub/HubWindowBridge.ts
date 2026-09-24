/**
 * HubWindowBridge — Hub 搜索窗口的 host 侧 Bridge（z-search 精简版）。
 *
 * 只路由搜索相关方法族：
 *  - semantic.*       → HubSemanticHandler（库内向量/全文检索、找相似、查重、建索引）
 *  - literature.*     → HubLiteratureHandler（外部学术库检索 + 导入文献库）
 *  - journal.*        → HubLiteratureHandler（期刊检索）
 *  - searchSources.*  → HubSearchSourceHandler（网络搜索源管理）
 *  - prefs.*          → 动态 pref 读写（React 侧通用通道）
 *  - locale.*         → BaseWindowBridge 共享路由
 *
 * iframe 生命周期 / postMessage 路由 / 通知转发等基础设施全部在
 * BaseWindowBridge；本类只实现业务分发与 Hub 特有状态。
 */
import { BaseWindowBridge } from "../../bridge/BaseWindowBridge";
import { getPrefDynamic, setPrefDynamic } from "../../utils/prefs";
import { toErrorMessage } from "../../utils/error";
import { safeDebug } from "../../utils/logger";
import { handleSemanticRequest } from "./HubSemanticHandler";
import { handleLiteratureRequest } from "./HubLiteratureHandler";
import { handleSearchSourceMethod } from "./HubSearchSourceHandler";

export class HubWindowBridge extends BaseWindowBridge {
  /** 向量索引构建代际（取消用：cancelGeneration 追上即停） */
  public buildGeneration = 0;
  public cancelGeneration = -1;
  /** literature.search 的取消信号表（searchId → signal） */
  public _searchAbortSignal: Map<number, { aborted: boolean }> | null = null;
  public _searchIdCounter = 0;

  /** RM-1：深链落位回执守望（hub.setActiveTab 是单向 notify） */
  private _activeTabAckWatch: {
    timer: ReturnType<typeof setTimeout> | null;
    attempts: number;
  } | null = null;
  private _activeTabAckSeq = 0;

  initialize(win: Window): void {
    super.initialize(win, "hubBridge"); // 暴露 win.__hubBridge
  }

  /** 通知 Hub iframe 切换激活的功能标签（中心窗已开时的深链落位）。 */
  setActiveTab(
    tab: string,
    openPalette?: boolean,
    section?: string,
    seedSessionId?: string,
  ): void {
    if (!tab && !openPalette) return;
    const payload: {
      tab?: string;
      openPalette?: boolean;
      section?: string;
      seedSessionId?: string;
    } = {};
    if (tab) payload.tab = tab;
    if (openPalette) payload.openPalette = true;
    if (tab === "settings" && section) payload.section = section;
    if (seedSessionId) payload.seedSessionId = seedSessionId;
    const send = () => this.sendNotifyToIframe("hub.setActiveTab", payload);
    send(); // 立即尝试（覆盖 Hub 已打开的场景）
    // iframe 刚打开时 iframeWindow 尚未就绪，重试几次确保送达
    let attempts = 0;
    const retry = () => {
      if (this.isDestroyed() || attempts++ >= 10) return;
      if (!(this as any).iframeWindow) {
        setTimeout(retry, 300);
      } else {
        send();
      }
    };
    setTimeout(retry, 300);
    this.watchActiveTabAck(send);
  }

  /**
   * 回执守望：iframe 消费后回 hub.setActiveTabAck；静默 400ms 重发，
   * ~5s 仍无回执落 debug 日志（杜绝「回执成功、界面没动」的静默失效）。
   */
  private watchActiveTabAck(send: () => void): void {
    const watch = this._activeTabAckWatch;
    if (watch?.timer) clearTimeout(watch.timer);
    const mySeq = ++this._activeTabAckSeq;
    let attempts = 0;
    const tick = () => {
      if (this.isDestroyed() || mySeq !== this._activeTabAckSeq) return;
      if (++attempts > 12) {
        safeDebug("[z-search] hub.setActiveTab ack timeout");
        this._activeTabAckWatch = null;
        return;
      }
      send();
      this._activeTabAckWatch = {
        timer: setTimeout(tick, 400),
        attempts,
      };
    };
    this._activeTabAckWatch = { timer: setTimeout(tick, 400), attempts: 0 };
  }

  /** iframe → host 的 fire-and-forget 通知（深链回执）。 */
  protected override handleNotify(event: string, payload: any): void {
    if (event === "hub.setActiveTabAck") {
      const watch = this._activeTabAckWatch;
      if (watch) {
        if (watch.timer) clearTimeout(watch.timer);
        this._activeTabAckWatch = null;
        this._activeTabAckSeq++; // 在途重发回调全部失效
      }
      return;
    }
    void payload;
    // 其余 notify 静默丢弃（搜索面无此需求）
  }

  protected async handleRequest(
    method: string,
    payload: any,
    id: string | number,
    source: Window,
  ): Promise<void> {
    let result: any;
    let error: string | null;

    try {
      // ── 动态 pref 通道（React 侧 prefsHelpers 通用读写）──
      if (method === "prefs.getDynamic") {
        result = getPrefDynamic(payload?.key);
        this.sendResponse(id, result, null, source);
        return;
      }
      if (method === "prefs.setDynamic") {
        setPrefDynamic(payload?.key, payload?.value);
        result = { success: true };
        this.sendResponse(id, result, null, source);
        return;
      }
      if (method === "prefs.clearDynamic") {
        try {
          Zotero.Prefs.clear(
            `${_globalThis.addon.data.config.prefsPrefix}.${payload?.key}`,
            true,
          );
        } catch {
          /* 键不存在时本就 no-op */
        }
        result = { success: true };
        this.sendResponse(id, result, null, source);
        return;
      }

      // ── 搜索方法族分发 ──
      if (method.startsWith("semantic.")) {
        await handleSemanticRequest(this, method, payload, id, source);
        return;
      }
      if (method.startsWith("literature.") || method.startsWith("journal.")) {
        await handleLiteratureRequest(this as any, method, payload, id, source);
        return;
      }
      if (method.startsWith("searchSources.")) {
        const out = await handleSearchSourceMethod(method, payload);
        this.sendResponse(id, out.result, out.error, source);
        return;
      }
      if (method === "hub.open") {
        // 深链统一入口（Hub iframe 内打开/切换 tab）
        const { hubWindowManager } = await import("./HubWindowManager");
        await hubWindowManager.openHub(payload?.tab);
        result = { opened: true };
        this.sendResponse(id, result, null, source);
        return;
      }

      this.sendResponse(id, null, `Unknown method: ${method}`, source);
    } catch (e: any) {
      error = toErrorMessage(e);
      this.sendResponse(id, null, error, source);
    }
  }

  /** 搜索中止信号登记（HubLiteratureHandler 用）。 */
  public ensureSearchAbortSignal(): Map<number, { aborted: boolean }> {
    this._searchAbortSignal ??= new Map();
    return this._searchAbortSignal;
  }

  public respond(
    id: string | number,
    result: any,
    error: string | null,
    source: Window,
  ): void {
    this.sendResponse(id, result, error, source);
  }

  destroy(): void {
    // 在途深链守望随桥销毁
    const watch = this._activeTabAckWatch;
    if (watch?.timer) clearTimeout(watch.timer);
    this._activeTabAckWatch = null;
    this._activeTabAckSeq++;
    // 中止在途文献搜索
    if (this._searchAbortSignal) {
      for (const s of this._searchAbortSignal.values()) s.aborted = true;
      this._searchAbortSignal.clear();
      this._searchAbortSignal = null;
    }
    // 取消在途索引构建
    this.cancelGeneration = this.buildGeneration;
    super.destroy();
  }

  /** Public read-accessor for the protected BaseWindowBridge.destroyed flag. */
  public isDestroyed(): boolean {
    return (this as any).destroyed;
  }
}
