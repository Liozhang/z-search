/**
 * BackendEventNotifier —— 订阅后端通知事件并以 Zotero 原生通知呈现。
 *
 * 当前处理：
 *   - navigateToPdfFailed：点击 `[[itemId:N]]` 引用后，后端找不到对应文献
 *     或 PDF 附件时推送。此前为静默失败（用户无任何反馈）。
 *   - recommend_added / recommend_add_failed：推荐面板右键「添加到集合」
 *     的入库结果反馈（成功/失败均推送）。
 *
 * 设计为 children 透传，便于在挂载点包裹一次即可。
 *
 * @module react/components/ui/BackendEventNotifier
 */

import React, { useEffect } from "react";
import { onBackendEvent } from "../../utils/bridge";
import { getString } from "../../utils/locale";
import { zoteroNotify } from "@/utils/zoteroNotification";

export function BackendEventNotifier({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  useEffect(() => {
    // 引用点击失败：区分"文献未找到"与"无 PDF 附件"两种情况。
    const offNav = onBackendEvent("navigateToPdfFailed", (payload: any) => {
      const reason = payload?.reason;
      const message =
        reason === "no-pdf-attachment"
          ? getString("chat-citation-nav-no-pdf")
          : getString("chat-citation-nav-not-found");
      zoteroNotify(message);
    });
    // 推荐面板右键入库：成功提示（面板自身监听同一 progress 事件刷新列表）
    const offProgress = onBackendEvent("progress", (event: any) => {
      if (event?.type === "recommend_added") {
        zoteroNotify(
          getString("recommend-add-success", {
            args: { title: event?.title || event?.doi || "" },
          }),
        );
      } else if (event?.type === "recommend_add_failed") {
        zoteroNotify(
          event?.error ||
            getString("recommend-add-failed", { args: { title: "" } }),
        );
      }
    });
    return () => {
      offNav();
      offProgress();
    };
  });

  return <>{children}</>;
}
