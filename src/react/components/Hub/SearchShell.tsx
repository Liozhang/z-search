/**
 * SearchShell — z-search 的 Hub 外壳（单页版）。
 *
 * 2026-09-22 布局修正（用户裁决「搜索页只需要有一页，不需要侧边栏」）：原
 * 「外壳页头 + 胶囊切换行 + 240px 侧栏」三件套全部退役——页头与 SearchPane
 * 页头重复、顶层切换抢占据内容区。回归 leadero 基线：本壳只承载唯一一页
 * SearchPane（文献/期刊双视图 keep-alive），页头/视图对钮/内容全部由
 * SearchPane 自持（leadero SearchPane 同结构）。
 *
 * 深链：宿主 openHub(tab) 经 hub.setActiveTab notify 落位；本壳仅一页，
 * 收到即回执（界面无需切换，杜绝 acks 静默超时）。
 */
import React, { useEffect } from "react";
import { getString } from "../../utils/locale";
import { onBridgeReady } from "../../utils/bridge";
import { hubNotify } from "../../utils/hubBridge";
import { SearchPane } from "./SearchPane";
import ErrorBoundary from "@/components/ui/ErrorBoundary";

export function SearchShell(): React.ReactElement {
  // 深链回执订阅：桥可能尚未 attach——onBridgeReady 事件驱动唤醒（替代自写轮询）。
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const attach = () => {
      const bridge = (window as any).__hubBridge;
      if (!bridge || typeof bridge.on !== "function") return;
      const off = bridge.on("hub.setActiveTab", (payload: { tab?: string }) => {
        void hubNotify("hub.setActiveTabAck", { tab: payload?.tab });
      });
      unsub = off;
    };
    if ((window as any).__hubBridge) attach();
    else {
      const off = onBridgeReady(attach);
      unsub = () => off();
    }
    return () => unsub?.();
  }, []);

  return (
    <ErrorBoundary fallbackMessage={getString("error-hub-render")}>
      <div className="leadero-root hub-shell flex flex-col h-full bg-surface">
        <SearchPane isActive />
      </div>
    </ErrorBoundary>
  );
}

export default SearchShell;
