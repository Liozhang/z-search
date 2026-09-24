/**
 * HubSemanticHandler — semantic.* RPC handlers extracted from HubWindowBridge.
 */

import { runFullLibraryBuild } from "../../core/search/runFullLibraryBuild";
import { toErrorMessage } from "../../utils/error";
import { safeDebug } from "../../utils/logger";

/** Handler registry（巨型分发器拆解第四片：switch 表化，行为逐条等价——
 * break→return {result,error} 语义等价变换；先响应后后台的 case 返 _earlyResponse 标记。） */
const SEMANTIC_ACTIONS: Record<
  string,
  (
    bridge: any,
    payload: any,
    _id: string | number,
    _source: Window,
  ) => Promise<{ result: any; error: string | null }>
> = {
  "semantic.search": async (
    bridge: any,
    payload: any,
    _id: string | number,
    _source: Window,
  ): Promise<{ result: any; error: string | null }> => {
    let result: any = null;
    let error: string | null = null;
    if (!payload?.query) {
      error = "semantic.search: missing query";
      return { result, error };
    }
    const { default: SemanticSearch } =
      await import("../../core/search/SemanticSearch");
    const threshold = payload.threshold ?? 0.75;
    const limit = payload.limit ?? 10;
    const useFullText = payload.fulltext ?? false;

    if (useFullText) {
      result = await SemanticSearch.searchFullText(payload.query, {
        threshold,
        limit,
        sectionCategory: payload.sectionCategory,
        // UI 默认走融合通道：向量可用时两路融合，向量不可用（未配
        // embedding/本地模型跑不了）时自动退化为 BM25-only，而不是
        // vector 模式下对 text-only 库返回空结果。
        retrieval: payload.retrieval ?? "hybrid",
        bm25Weight: payload.bm25Weight,
      });
    } else {
      result = await SemanticSearch.searchByQuery(payload.query, {
        threshold,
        limit,
      });
    }
    return { result, error };
  },
  "semantic.findSimilar": async (
    bridge: any,
    payload: any,
    _id: string | number,
    _source: Window,
  ): Promise<{ result: any; error: string | null }> => {
    let result: any = null;
    let error: string | null = null;
    let itemID = payload?.itemID;
    if (!itemID) {
      const zoteroPane = (Zotero as any).getActiveZoteroPane?.();
      if (!zoteroPane) {
        error = "No active Zotero pane";
        return { result, error };
      }
      const selected = zoteroPane.getSelectedItems?.() ?? [];
      if (selected.length === 0) {
        error = "No item selected";
        return { result, error };
      }
      itemID = selected[0].id;
    }
    const { default: SS } = await import("../../core/search/SemanticSearch");
    result = await SS.findSimilarItems(itemID, {
      threshold: payload.threshold ?? 0.8,
      limit: payload.limit ?? 10,
    });
    return { result, error };
  },
  "semantic.scanDuplicates": async (
    bridge: any,
    payload: any,
    id: string | number,
    source: Window,
  ): Promise<{ result: any; error: string | null }> => {
    const { default: SS2 } = await import("../../core/search/SemanticSearch");
    const result: any = { started: true };
    bridge.respond(id, result, null, source);

    (async () => {
      try {
        const duplicates = await SS2.scanLibraryForDuplicates(
          payload?.threshold ?? 0.9,
          (current: number, total: number) => {
            bridge.sendNotifyToIframe("semantic.scanProgress", {
              current,
              total,
            });
          },
        );
        const mapped = duplicates.map(
          (d: {
            itemID: number;
            duplicateIDs: number[];
            confidence: number;
            reason: string;
          }) => ({
            itemID: d.itemID,
            duplicateIDs: d.duplicateIDs,
            confidence: d.confidence,
            title: d.reason,
          }),
        );
        bridge.sendNotifyToIframe("semantic.scanComplete", {
          results: mapped,
        });
      } catch (e: any) {
        bridge.sendNotifyToIframe("semantic.scanError", {
          error: toErrorMessage(e),
        });
      }
    })();

    return { result: { _earlyResponse: true }, error: null };
  },
  "semantic.buildIndex": async (
    bridge: any,
    payload: any,
    id: string | number,
    source: Window,
  ): Promise<{ result: any; error: string | null }> => {
    const PdfChunkIndexer = await import("../../core/search/PdfChunkIndexer");
    const result: any = { started: true };
    bridge.respond(id, result, null, source);

    const myGen = ++bridge.buildGeneration;
    bridge.cancelGeneration = myGen - 1;

    void runFullLibraryBuild(
      PdfChunkIndexer.default,
      (event, payload) => bridge.sendNotifyToIframe(event, payload),
      () => bridge.cancelGeneration >= myGen || bridge.isDestroyed(),
    );

    return { result: { _earlyResponse: true }, error: null };
  },
  "semantic.cancelBuild": async (
    bridge: any,
    _payload: any,
    _id: string | number,
    _source: Window,
  ): Promise<{ result: any; error: string | null }> => {
    const error: string | null = null;
    bridge.cancelGeneration = bridge.buildGeneration;
    const result: any = { cancelled: true };
    return { result, error };
  },
  "semantic.rebuildIndex": async (
    bridge: any,
    payload: any,
    id: string | number,
    source: Window,
  ): Promise<{ result: any; error: string | null }> => {
    const { default: EM } = await import("../../core/ai/EmbeddingsManager");
    const PdfChunkStore = await import("../../core/search/PdfChunkStore");
    const PdfChunkIndexer2 = await import("../../core/search/PdfChunkIndexer");
    const model = EM.getModelInfo().name;

    try {
      const rows = await Zotero.DB.queryAsync(
        `SELECT DISTINCT model FROM zsearch_pdf_chunks WHERE model != ?`,
        [model],
      );
      for (const r of rows || []) {
        await PdfChunkStore.default.deleteChunksByModel(r.model);
      }
    } catch (e) {
      safeDebug("[z-search] " + e);
      /* cleanup failed — non-fatal */
    }

    const result: any = { started: true };
    bridge.respond(id, result, null, source);

    const myGen = ++bridge.buildGeneration;
    bridge.cancelGeneration = myGen - 1;

    void runFullLibraryBuild(
      PdfChunkIndexer2.default,
      (event, payload) => bridge.sendNotifyToIframe(event, payload),
      () => bridge.cancelGeneration >= myGen || bridge.isDestroyed(),
    );

    return { result: { _earlyResponse: true }, error: null };
  },
  "semantic.getModelInfo": async (
    _bridge: any,
    _payload: any,
    _id: string | number,
    _source: Window,
  ): Promise<{ result: any; error: string | null }> => {
    const error: string | null = null;
    const { default: EM2 } = await import("../../core/ai/EmbeddingsManager");
    const PdfChunkStore2 = await import("../../core/search/PdfChunkStore");
    // Status read for panel display: if API mode has no embedding model
    // assigned, getModelInfo() throws a localized error. Degrade to an
    // empty shape (panel renders its "configure embedding" state) with a
    // debug note; the actionable error surfaces when the user runs a
    // search/build action.
    let info: { name: string; dimension: number } = { name: "", dimension: 0 };
    try {
      info = EM2.getModelInfo();
    } catch (e) {
      safeDebug(`[z-search] semantic.getModelInfo: ${e}`);
    }
    const hasStale = await PdfChunkStore2.default.hasStaleChunks(info.name);
    const result: any = { ...info, hasStaleChunks: hasStale };
    return { result, error };
  },
  "semantic.getIndexStatus": async (
    _bridge: any,
    _payload: any,
    _id: string | number,
    _source: Window,
  ): Promise<{ result: any; error: string | null }> => {
    const error: string | null = null;
    const { default: EM3 } = await import("../../core/ai/EmbeddingsManager");
    const PdfChunkStore3 = await import("../../core/search/PdfChunkStore");
    const EmbeddingStore3 = await import("../../core/search/EmbeddingStore");
    // Same catch-and-degrade as getModelInfo: unconfigured API embedding
    // yields zero counts (nothing indexed) instead of rejecting the RPC.
    let modelName = "";
    try {
      modelName = EM3.getModelInfo().name;
    } catch (e) {
      safeDebug(`[z-search] semantic.getIndexStatus: ${e}`);
    }
    const [metadataCount, chunkCount, bm25ChunkCount] = await Promise.all([
      EmbeddingStore3.default.getEmbeddingCount(modelName),
      PdfChunkStore3.default.countChunks(modelName),
      // BM25-only rows (text-only indexing, dimension 0) don't count as
      // vector chunks but DO make keyword search fully usable — surface
      // them so the UI can show an honest index state.
      PdfChunkStore3.default.countAllChunks(),
    ]);
    const result: any = { metadataCount, chunkCount, bm25ChunkCount };
    return { result, error };
  },
  "semantic.openItem": async (
    bridge: any,
    payload: any,
    _id: string | number,
    _source: Window,
  ): Promise<{ result: any; error: string | null }> => {
    let result: any = null;
    let error: string | null = null;
    if (!payload?.itemID) {
      error = "semantic.openItem: missing itemID";
      return { result, error };
    }
    const item = Zotero.Items.get(payload.itemID);
    if (!item) {
      error = "Item not found";
      return { result, error };
    }
    const zoteroPane = (Zotero as any).getActiveZoteroPane?.();
    if (zoteroPane) {
      zoteroPane.selectItems([payload.itemID]);
    }
    // JA-3（§31.2）：选中的落点在 Zotero 主窗，而 Hub 是独立窗
    // （HubWindowManager，windowtype zsearch:hub，常与主窗并列或被遮挡）——
    // 只 selectItems 不聚焦，用户在 Hub 点完这一下就是「什么都没发生」。
    // 手法核对：主窗对象 `.focus()` 是本仓既有 chrome 窗聚焦惯例
    // （HubWindowManager.ts:76 的 `existing.focus()`、ChatWindowManager.ts:257
    // 的 `nativeWindow.focus()`）；zotero-types 侧 `Zotero.getMainWindow()`
    // 返回 `_ZoteroTypes.MainWindow extends Window`（internal.d.ts:20），
    // focus() 可用。⛔ 只聚焦、不动位置/尺寸——历史教训：程序化改窗尺寸把
    // 病态高度写进 xulstore.json（hub-real-machine-ui-comprehensive-audit
    // -2026-09-15 §113），禁用 MoveWindow/SetWindowPos 类操作。
    let focused = false;
    try {
      const mainWin: any = (Zotero as any).getMainWindow?.();
      if (mainWin && !mainWin.closed && typeof mainWin.focus === "function") {
        mainWin.focus();
        focused = true;
      }
    } catch (e) {
      // 聚焦失败绝不能让「选中」这个主功能报错——吞掉，只落诊断日志。
      safeDebug(`[z-search] semantic.openItem: focus main window failed: ${e}`);
    }
    // 契约不破：既有 opened:true 保留（消费方零改动），新增 focused
    // （聚焦请求是否发出成功：主窗存在、未关闭、调用未抛错；非 OS 层保证）
    // 供前端判定回执措辞。
    result = { opened: true, focused };
    return { result, error };
  },
};

export async function handleSemanticRequest(
  bridge: any,
  method: string,
  payload: any,
  id: string | number,
  source: Window,
): Promise<void> {
  const handler = SEMANTIC_ACTIONS[method];
  if (!handler) {
    bridge.respond(id, null, `Unknown semantic method: ${method}`, source);
    return;
  }
  let out;
  try {
    out = (await handler(bridge, payload, id, source)) ?? {
      result: null,
      error: null,
    };
  } catch (e: any) {
    out = { result: null, error: toErrorMessage(e) };
  }
  if (out.result?._earlyResponse) return;
  bridge.respond(id, out.result, out.error, source);
}
