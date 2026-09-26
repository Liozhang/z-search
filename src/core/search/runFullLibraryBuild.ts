/**
 * runFullLibraryBuild — 提取自 HubWindowBridge / SemanticWindowBridge 的
 * semantic.buildIndex / semantic.rebuildIndex（两 bridge 各 2 处，共 4 处重复）。
 *
 * 职责（2026-09-25 审计 P0-1 起）：跑**两段**索引构建 + 通过 notify 回调发
 * progress/complete/error + 拼接失败详情列表（≤5 条 + 省略计数）。
 *   1. 条目元数据向量（EmbeddingStore.rebuildIndex，标题/作者/摘要/标签）——
 *      semantic.search 默认腿、找相似、查重全部读 zsearch_embeddings，
 *      此前该表从不被构建，三入口恒空结果。
 *   2. PDF 全文分块向量（buildFullLibraryIndex，原行为）。
 * supersede 语义（buildGeneration）与 stale-chunk 清理（rebuildIndex 独有）
 * 留在各 bridge case，本函数只管构建+通知。
 *
 * notify 回调由调用方 bind 到 bridge.sendNotifyToIframe；isCancelled 闭包由调用方
 * 捕获 myGen（这样本函数无需感知 buildGeneration）。
 */
import type { BuildResult } from "./PdfChunkIndexer";
import { toErrorMessage } from "../../utils/error";
import { safeDebug } from "../../utils/logger";

interface IndexerLike {
  buildFullLibraryIndex(
    onProgress?: (p: { current: number; total: number }) => void,
    shouldCancel?: () => boolean,
  ): Promise<BuildResult>;
}

type NotifyFn = (event: string, payload: Record<string, unknown>) => void;

/** 条目 → 嵌入用检索文本：标题 + 作者（≤10）+ 年份 + 摘要（≤1500 字符）+
 *  期刊名 + 标签（≤15），合计截 3000 字符。正文不参与（那是 PDF 分块腿的
 *  职责）——元数据腿的语义单元是「这篇文献讲什么」。 */
export function createItemSearchText(item: any): string {
  if (item.isNote?.()) {
    return String(item.note ?? "")
      .replace(/<[^>]+>/g, " ")
      .slice(0, 2000);
  }
  // PDF 注释条目（P1 批：对齐 All Search 覆盖面）——注释正文 + 批注评论。
  // 高亮/图形注释的 text 常为空，仅评论文本也值得入库。
  if (item.isAnnotation?.()) {
    const strip = (v: unknown) =>
      String(v ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const parts = [
      strip(item.annotationText),
      strip(item.annotationComment),
    ].filter(Boolean);
    return parts.join("\n").slice(0, 2000);
  }
  const parts: string[] = [];
  const push = (s: unknown) => {
    const v = String(s ?? "").trim();
    if (v) parts.push(v);
  };
  try {
    push(item.getField("title"));
  } catch {
    /* deleted item mid-iteration — skip field */
  }
  try {
    const creators = (item.getCreators?.() ?? [])
      .map((c: any) => c.lastName || c.name)
      .filter(Boolean);
    if (creators.length) push(creators.slice(0, 10).join(", "));
  } catch {
    /* no creators */
  }
  try {
    push(String(item.getField("date") ?? "").slice(0, 4));
    push((item.getField("abstractNote") ?? "").slice(0, 1500));
    push(item.getField("publicationTitle"));
  } catch {
    /* field absent on this item type */
  }
  try {
    const tags = (item.getTags?.() ?? [])
      .map((t: any) => t.tag)
      .filter(Boolean);
    if (tags.length) push(tags.slice(0, 15).join(", "));
  } catch {
    /* no tags */
  }
  return parts.join("\n").slice(0, 3000);
}

/** 阶段一：条目元数据向量（zsearch_embeddings）。embedding 未配置（API 模式
 *  无模型）时静默跳过并回报原因，不影响 PDF 阶段。 */
async function buildMetadataIndex(
  notify: NotifyFn,
  isCancelled: () => boolean,
): Promise<{ processed: number; errors: number; skipped: boolean }> {
  try {
    const { default: EM } = await import("../ai/EmbeddingsManager");
    const model = EM.getModelInfo().name; // 未配置时抛本地化错误 → 跳过
    if (!model) return { processed: 0, errors: 0, skipped: true };
    const { default: EmbeddingStore } = await import("./EmbeddingStore");
    const r = await EmbeddingStore.rebuildIndex(
      model,
      (text: string) => EM.embedText(text),
      createItemSearchText,
      (current: number, total: number) => {
        if (isCancelled()) return;
        notify("semantic.buildProgress", { current, total, phase: "metadata" });
      },
      isCancelled,
    );
    return { processed: r.processed, errors: r.errors, skipped: false };
  } catch (e) {
    // 未配置 embedding / 模型不可用：跳过本阶段（PDF 阶段有自己的降级路径）
    safeDebug("[z-search] metadata index skipped: " + toErrorMessage(e));
    return { processed: 0, errors: 0, skipped: true };
  }
}

export async function runFullLibraryBuild(
  indexer: IndexerLike,
  notify: NotifyFn,
  isCancelled: () => boolean,
): Promise<void> {
  try {
    // ── 阶段 1：条目元数据向量（快——每条一次嵌入，无 PDF 解析） ──
    const meta = await buildMetadataIndex(notify, isCancelled);

    // ── 阶段 2：PDF 全文分块向量（慢——分块 + 逐块嵌入） ──
    const buildResult = await indexer.buildFullLibraryIndex(
      (p: { current: number; total: number }) => {
        notify("semantic.buildProgress", {
          current: p.current,
          total: p.total,
          phase: "fulltext",
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
    if (meta.skipped) {
      skipCounts.set("metadata-embedding-unavailable", 1);
    }
    const skips = Array.from(skipCounts, ([reason, count]) => ({
      reason,
      count,
    })).sort((a, b) => b.count - a.count);

    notify("semantic.buildComplete", {
      processed: buildResult.processed + meta.processed,
      skipped: buildResult.skipped,
      errors: buildResult.errors + meta.errors,
      metadataProcessed: meta.processed,
      failedList,
      skips,
    });
  } catch (e: any) {
    notify("semantic.buildError", {
      error: toErrorMessage(e),
    });
  }
}
