/**
 * HubWindowManager — Hub 搜索窗口单例（z-search 精简版）。
 *
 * windowtype: zsearch:hub
 * 唯一 name: zsearch-hub-window-${Date.now()}（避免 Gecko 复用）
 */
import { HubWindowBridge } from "./HubWindowBridge";

/** dev-only 可观测出口（Zotero.debug 在 XUL 上下文之外可能不存在）。 */
function debugOut(msg: string): void {
  try {
    Zotero.debug(`[z-search] HubWindowManager: ${msg}`);
  } catch {
    /* debug unavailable */
  }
}

class HubWindowManager {
  private hubWin: Window | null = null;
  private bridge: HubWindowBridge | null = null;

  /**
   * 解析活窗的 bridge：优先读窗口自身的 __hubBridge（hubWindow.js 同源真值），
   * 回退 this.bridge（本 manager 建窗时的引用）——热重载后 manager 单例重置
   * 而旧窗仍在时 this.bridge 为 null。
   */
  private resolveBridge(existing: Window | null): HubWindowBridge | null {
    const live = existing
      ? ((existing as any).__hubBridge as HubWindowBridge | undefined)
      : undefined;
    if (live && typeof (live as any).setActiveTab === "function") {
      if (this.bridge !== live) this.bridge = live;
      return live;
    }
    return this.bridge;
  }

  /** 深链落位（含死桥防护：跨上下文死对象调用会抛 dead object，不能外溢）。 */
  private deliver(
    bridge: HubWindowBridge,
    tab: string,
    openPalette?: boolean,
    section?: string,
    seedSessionId?: string,
    action?: string,
  ): void {
    try {
      if (bridge.isDestroyed()) {
        debugOut(`deep-link dropped: live bridge destroyed (tab=${tab})`);
        return;
      }
      bridge.setActiveTab(tab, openPalette, section, seedSessionId, action);
    } catch (e) {
      debugOut(`deep-link failed on live bridge (tab=${tab}): ${e}`);
    }
  }

  /**
   * 打开 Hub 窗口。
   * @param tab 可选：打开后直达的功能区（'search' / 'settings'）。
   */
  async openHub(tab?: string): Promise<void> {
    const wm = Components.classes[
      "@mozilla.org/appshell/window-mediator;1"
    ].getService(Components.interfaces.nsIWindowMediator);

    // Focus 保护：用 nsIWindowMediator 重新查找（fresh 引用，.closed 准确）。
    const existing = wm.getMostRecentWindow("zsearch:hub");
    if (existing && !existing.closed) {
      existing.focus();
      if (tab) {
        const bridge = this.resolveBridge(existing);
        if (!bridge) {
          debugOut(
            `deep-link dropped: window open but no live bridge (tab=${tab})`,
          );
          return;
        }
        this.deliver(bridge, tab);
      }
      return;
    }
    const mainWindow = wm.getMostRecentWindow("navigator:browser");
    if (!mainWindow) return;

    // 创建 Bridge + 同步 initialize（openDialog 前构造，避免竞态）
    this.bridge = new HubWindowBridge();

    const hubWin = mainWindow.openDialog(
      "chrome://zsearch/content/hub/hubWindow.xhtml",
      `zsearch-hub-window-${Date.now()}`,
      "chrome,resizable,dialog=false,width=1280,height=860",
    );

    if (!hubWin) return;

    this.bridge.initialize(hubWin);
    this.hubWin = hubWin;
    if (tab) this.bridge.setActiveTab(tab);

    // unload 清理 Manager 状态（bridge.destroy 由 hubWindow.js 处理）。
    hubWin.addEventListener(
      "unload",
      () => {
        if (this.hubWin === hubWin) {
          this.hubWin = null;
          this.bridge = null;
        }
      },
      { once: true },
    );
  }

  /** 供 hubWindow.js 取 bridge（转发 iframe message） */
  getBridge(): HubWindowBridge | null {
    return this.bridge;
  }

  /**
   * 深链统一入口（hub.open RPC 用）：解析活窗 + 活桥后落位，
   * 参数面与 HubWindowBridge.setActiveTab 一致。窗口未开时先开窗。
   */
  async deepLink(
    tab: string,
    openPalette?: boolean,
    section?: string,
    seedSessionId?: string,
    action?: string,
  ): Promise<void> {
    await this.openHub();
    const wm = Components.classes[
      "@mozilla.org/appshell/window-mediator;1"
    ].getService(Components.interfaces.nsIWindowMediator);
    const existing = wm.getMostRecentWindow("zsearch:hub");
    const bridge = this.resolveBridge(
      existing && !existing.closed ? existing : null,
    );
    if (!bridge) {
      debugOut("deep-link dropped: no live bridge after openHub");
      return;
    }
    this.deliver(bridge, tab, openPalette, section, seedSessionId, action);
  }

  /**
   * 右键菜单「查找相似文献」入口（2026-09-25 审计 P1-3）：开 Hub 并让
   * iframe 自动发起找相似（RPC 侧回退到主窗选中条目）。仅普通条目有效。
   */
  async findSimilarFromMenu(): Promise<void> {
    await this.deepLink(
      "search",
      undefined,
      undefined,
      undefined,
      "findSimilar",
    );
  }

  /**
   * 关闭所有 Hub 窗口（shutdown 路径）。
   *
   * 走 nsIWindowMediator 枚举而非 this.hubWin：disable/enable（热部署、
   * 插件更新）后，旧插件上下文的 Hub 窗口可能残留——本 manager 实例从未
   * 打开过它。残留窗口处于半死态：RPC 仍响应但事件转发链已断。与其留一个
   * 看似活着的僵尸窗口，不如随插件一起关闭。
   */
  closeAll(): void {
    const wm = Components.classes[
      "@mozilla.org/appshell/window-mediator;1"
    ].getService(Components.interfaces.nsIWindowMediator);
    const orphaned: Window[] = [];
    const en = wm.getEnumerator("zsearch:hub");
    while (en.hasMoreElements()) {
      orphaned.push(en.getNext() as Window);
    }
    // 枚举完再关：迭代中关窗会使枚举器失效
    for (const win of orphaned) {
      try {
        if (!(win as any).closed) win.close();
      } catch {
        /* 窗口已销毁 */
      }
    }
    this.hubWin = null;
    this.bridge = null;
  }
}

export const hubWindowManager = new HubWindowManager();
