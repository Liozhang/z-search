/**
 * runFullLibraryBuild — 提取自 HubWindowBridge / SemanticWindowBridge 的
 * semantic.buildIndex / semantic.rebuildIndex（两 bridge 各 2 处，共 4 处重复）。
 *
 * 职责：跑 buildFullLibraryIndex + 通过 notify 回调发 progress/complete/error，
 * + 拼接失败详情列表（≤5 条 + 省略计数）。supersede 语义（buildGeneration）
 * 与 stale-chunk 清理（rebuildIndex 独有）留在各 bridge case，本函数只管构建+通知。
 *
 * notify 回调由调用方 bind 到 bridge.sendNotifyToIframe；isCancelled 闭包由调用方
 * 捕获 myGen（这样本函数无需感知 buildGeneration）。
 */
import type { BuildResult } from "./PdfChunkIndexer";
import { toErrorMessage } from "../../utils/error";

interface IndexerLike {
  buildFullLibraryIndex(
    onProgress?: (p: { current: number; total: number }) => void,
    shouldCancel?: () => boolean,
  ): Promise<BuildResult>;
}

type NotifyFn = (event: string, payload: Record<string, unknown>) => void;

export async function runFullLibraryBuild(
  indexer: IndexerLike,
  notify: NotifyFn,
  isCancelled: () => boolean,
): Promise<void> {
  try {
    const buildResult = await indexer.buildFullLibraryIndex(
      (p: { current: number; total: number }) => {
        notify("semantic.buildProgress", {
          current: p.current,
          total: p.total,
        });
      },
      isCancelled,
    );

    const failedDetails = (buildResult.skippedDetails ?? []).filter(
      (d: { reason: string }) => d.reason.startsWith("error:"),
    );
    const failedList =
      failedDetails.length > 0
        ? failedDetails
            .slice(0, 5)
            .map(
              (d: { itemId: number; reason: string }) =>
                `  • Item ${d.itemId}: ${d.reason.slice(0, 80)}`,
            )
            .join("\n") +
          (failedDetails.length > 5
            ? `\n  • … and ${failedDetails.length - 5} more`
            : "")
        : "";

    // 跳过明细（2026-09-16 审计 B4）：非错误跳过原先只剩一个计数——
    // 「跳过 9 篇」无任何理由出口，全跳过时用户点构建→横幅原样→死循环。
    // 按原因码聚合计数上抛，UI 侧本地化渲染；error: 前缀仍走 failedList。
    const skipCounts = new Map<string, number>();
    for (const d of buildResult.skippedDetails ?? []) {
      if (d.reason.startsWith("error:")) continue;
      skipCounts.set(d.reason, (skipCounts.get(d.reason) ?? 0) + 1);
    }
    const skips = Array.from(skipCounts, ([reason, count]) => ({
      reason,
      count,
    })).sort((a, b) => b.count - a.count);

    notify("semantic.buildComplete", {
      processed: buildResult.processed,
      skipped: buildResult.skipped,
      errors: buildResult.errors,
      failedList,
      skips,
    });
  } catch (e: any) {
    notify("semantic.buildError", {
      error: toErrorMessage(e),
    });
  }
}
