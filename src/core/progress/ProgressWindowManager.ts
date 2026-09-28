/**
 * Zotero Progress API Integration
 *
 * Host-side one-shot progress/notification window manager. iframe bundle
 * （Hub reactBundle）无 Zotero 主进程全局：create() 显式降级返回 0——iframe
 * 侧经 zoteroNotify 上行、宿主 HubWindowBridge 代发，不靠 shim 形状。
 *
 * 注：Zotero ProgressWindow 没有 X 关闭钮/canClose 属性——原生交互是
 * closeOnClick（点击窗体即关），无需也无法额外管理（2026-09-28 审计：曾
 * 存在的 canClose 赋值与 onWindowClose「X 钮关闭探测」均非真实 API）。
 */

import { safeDebug } from "../../utils/logger";

/** 进度窗来源小字（品牌标识）。Zotero 的 changeHeadline 只接受 CSS 图标键，
 *  不接受图片 URI，所以标题行没有品牌图标——只有这个小字（2026-09-23）。 */
const BRAND_SOURCE = "z-search";

export interface ProgressLine {
  text: string;
  icon?: string;
}

export interface ProgressWindowOptions {
  title?: string;
}

class ProgressWindowManager {
  private activeWindows = new Map<number, Zotero.ProgressWindow>();
  private nextID = 1;

  create(options: ProgressWindowOptions = {}): number {
    if (
      typeof Zotero === "undefined" ||
      typeof Zotero.getMainWindow !== "function"
    ) {
      return 0;
    }
    try {
      const win = Zotero.getMainWindow();
      if (!win) {
        throw new Error("No active window");
      }

      const progressWindow = new win.Zotero.ProgressWindow();
      const windowID = this.nextID++;

      if (options.title) {
        // changeHeadline(text, cssIconKey, postText)：注意第二个参数是
        // Zotero 的 CSS 图标键（'collection'/'library' 这类），不是图片
        // URI——传 chrome://...svg 会被拼成 icon-chrome://... 这个不存在的
        // 类，静默不画（2026-09-23 实机核实）。故这里只传标题 + 来源小字。
        progressWindow.changeHeadline(options.title, "", BRAND_SOURCE);
      }

      progressWindow.show();
      this.activeWindows.set(windowID, progressWindow);

      return windowID;
    } catch (_e) {
      safeDebug("[z-search] ProgressWindowManager.create failed: " + _e);
      return 0;
    }
  }

  addLines(windowID: number, lines: string | string[] | ProgressLine[]): void {
    const win = this.activeWindows.get(windowID);
    if (!win) return;

    let linesArray: string[];
    if (typeof lines === "string") {
      linesArray = [lines];
    } else {
      linesArray = lines.map((l) =>
        typeof l === "string" ? l : l.icon ? `${l.icon} ${l.text}` : l.text,
      );
    }

    // Zotero ProgressWindow.addLines(labels, icons) expects two array arguments
    (win as any).addLines(
      linesArray,
      linesArray.map((): undefined => undefined),
    );
  }

  close(windowID: number): void {
    const win = this.activeWindows.get(windowID);
    if (win) {
      win.close();
      this.activeWindows.delete(windowID);
    }
  }
}

const progressWindowManager = new ProgressWindowManager();

export default progressWindowManager;
