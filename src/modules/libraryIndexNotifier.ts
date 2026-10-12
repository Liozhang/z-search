/**
 * libraryIndexNotifier — 条目删除 → 检索索引清理的接线。
 *
 * 此前插件没有注册任何 Notifier 观察者，删除 API（PdfChunkStore.deleteChunks、
 * EmbeddingStore.deleteEmbeddingsByItemId）全部无人调用：条目删除后分块文本、
 * 全文检索行与嵌入向量永久残留，语义搜索继续命中已删除条目。
 *
 * 本模块注册 item 观察者：
 *  - delete 事件（永久删除/清空回收站）：逐条清理分块与嵌入向量。
 *  - 进回收站不清理（条目仍在库，恢复后应可再被检索）；查询侧以
 *    item.deleted 过滤兜底。
 *  - 启动时跑一次孤儿清理，覆盖"绕过通知器的删除"（同步还原、
 *    父条目删除时附件级联等）。
 */

import { safeDebug } from "../utils/logger";

let registeredId: string | null = null;

/** 条目删除后清理其索引数据。单条失败只记日志，不阻断其余条目。 */
async function handleItemsDeleted(itemIds: number[]): Promise<void> {
  if (itemIds.length === 0) return;
  try {
    const [{ default: PdfChunkStore }, { default: EmbeddingStore }] =
      await Promise.all([
        import("../core/search/PdfChunkStore"),
        import("../core/search/EmbeddingStore"),
      ]);
    for (const id of itemIds) {
      try {
        await PdfChunkStore.deleteChunks(id);
      } catch (e) {
        safeDebug(`[z-search] index cleanup: deleteChunks(${id}) failed: ${e}`);
      }
      try {
        await EmbeddingStore.deleteEmbeddingsByItemId(id);
      } catch (e) {
        safeDebug(
          `[z-search] index cleanup: deleteEmbeddingsByItemId(${id}) failed: ${e}`,
        );
      }
    }
  } catch (e) {
    safeDebug(`[z-search] index cleanup: module load failed: ${e}`);
  }
}

/** 注册观察者。幂等；在 servicesInit 里调用。 */
export function registerLibraryIndexNotifier(): void {
  if (registeredId) return;
  const observer = {
    notify: async (
      event: string,
      type: string,
      ids: Array<string | number>,
      _extraData: { [key: string]: any },
    ) => {
      if (type !== "item" || event !== "delete") return;
      const itemIds = ids
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v > 0);
      await handleItemsDeleted(itemIds);
    },
  };
  registeredId = Zotero.Notifier.registerObserver(
    observer,
    ["item"],
    "zsearch-index-cleanup",
    1,
  );
}

/** 注销观察者。在 onShutdown 里调用。 */
export function unregisterLibraryIndexNotifier(): void {
  if (!registeredId) return;
  try {
    Zotero.Notifier.unregisterObserver(registeredId);
  } catch (e) {
    safeDebug(`[z-search] index cleanup: unregister failed: ${e}`);
  }
  registeredId = null;
}

/**
 * 孤儿索引行清理（启动时跑一次）：分块表经 item_id NOT IN items 一条
 * SQL 即可；嵌入表在外部库，无法跨库联表，按 ID 集合比对。幂等。
 */
export async function removeOrphanIndexRows(): Promise<void> {
  try {
    const { default: PdfChunkStore } =
      await import("../core/search/PdfChunkStore");
    const removedChunks = await PdfChunkStore.deleteOrphans();
    if (removedChunks > 0) {
      safeDebug(`[z-search] index cleanup: ${removedChunks} orphan chunks`);
    }
  } catch (e) {
    safeDebug(`[z-search] index cleanup: orphan chunks failed: ${e}`);
  }
  try {
    const { default: EmbeddingStore } =
      await import("../core/search/EmbeddingStore");
    const removedEmbeddings = await EmbeddingStore.deleteOrphanEmbeddings();
    if (removedEmbeddings > 0) {
      safeDebug(
        `[z-search] index cleanup: ${removedEmbeddings} orphan embeddings`,
      );
    }
  } catch (e) {
    safeDebug(`[z-search] index cleanup: orphan embeddings failed: ${e}`);
  }
}
