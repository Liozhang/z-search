/**
 * useSearchHistory — 搜索词历史（跨会话持久化，供搜索行一键复用）。
 *
 * 存储：动态 pref `search.history`（JSON 字符串，与 search.importTarget 同款
 * 序列化纪律——裸对象经宿主 Zotero.Prefs.set 会字符串化成 "[object Object]"，
 * 恢复时 JSON.parse 抛错被吞）。条目按时间倒序、查询词去重（大小写不敏感），
 * 超出容量从最旧端裁剪；写失败静默——历史是便利设施，不得拖垮搜索主流程。
 *
 * @module react/hooks/useSearchHistory
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { prefsGetDynamic, prefsSetDynamic } from "../utils/prefsHelpers";
import { safeDebug } from "../../utils/logger";

export interface SearchHistoryEntry {
  /** 查询词原文（展示与回填用）。 */
  q: string;
  /** 搜索域：web=外部数据库，local=文库语义。展示侧按当前域过滤。 */
  scope: "web" | "local";
  /** 最近一次使用时间（epoch ms），新条目插到最前。 */
  ts: number;
}

const PREF_KEY = "search.history";
/** 总容量（不分域）：本地 pref 体量与选择器长度的双上限。 */
export const SEARCH_HISTORY_MAX_ENTRIES = 20;

/** pref 原始值 → 条目表（容错：非串/坏 JSON/形状不符一律回空表）。 */
export function parseSearchHistory(raw: unknown): SearchHistoryEntry[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is SearchHistoryEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as SearchHistoryEntry).q === "string" &&
        (e as SearchHistoryEntry).q.length > 0 &&
        typeof (e as SearchHistoryEntry).ts === "number",
    );
  } catch (e) {
    safeDebug("[z-search] search history parse failed: " + e);
    return [];
  }
}

/** 记录一次搜索的纯合并：同词（同域，大小写不敏感）置顶刷新时间戳，异词
 *  插到最前，超容从最旧端裁剪。空查询返回原表（调用方可据引用相等跳过落盘）。 */
export function mergeSearchHistory(
  prev: SearchHistoryEntry[],
  scope: "web" | "local",
  query: string,
  ts: number,
): SearchHistoryEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return prev;
  const lower = trimmed.toLowerCase();
  const rest = prev.filter(
    (e) => !(e.scope === scope && e.q.toLowerCase() === lower),
  );
  return [{ q: trimmed, scope, ts }, ...rest].slice(
    0,
    SEARCH_HISTORY_MAX_ENTRIES,
  );
}

/** 当前域的最近历史（新→旧）。 */
export function recentHistory(
  entries: SearchHistoryEntry[],
  scope: "web" | "local",
): SearchHistoryEntry[] {
  return entries.filter((e) => e.scope === scope);
}

export function useSearchHistory(scope: "web" | "local") {
  const [entries, setEntries] = useState<SearchHistoryEntry[]>([]);
  // 权威表放 ref：写入走单一 commit 通道（副作用留在 setState updater 之外——
  // updater 必须纯，并发渲染下会被重放，落盘副作用放里面会重复触发）。
  const entriesRef = useRef<SearchHistoryEntry[]>([]);
  const hydratedRef = useRef(false);

  const commit = useCallback((next: SearchHistoryEntry[]) => {
    if (next === entriesRef.current) return;
    entriesRef.current = next;
    setEntries(next);
    // 挂载读取完成前不回写（否则空表会覆盖磁盘上的历史）。
    if (hydratedRef.current) {
      void prefsSetDynamic(PREF_KEY, JSON.stringify(next)).catch((e) => {
        safeDebug("[z-search] search history write failed: " + e);
      });
    }
  }, []);

  // 挂载时读一次 pref（不随 scope 变化重读——全量表在内存，过滤在派生侧）。
  useEffect(() => {
    let alive = true;
    void prefsGetDynamic(PREF_KEY).then((raw) => {
      if (!alive) return;
      entriesRef.current = parseSearchHistory(raw);
      setEntries(entriesRef.current);
      hydratedRef.current = true;
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 记录一次搜索：同词置顶刷新时间戳，异词插到最前；无变化不落盘。 */
  const record = useCallback(
    (query: string) => {
      commit(mergeSearchHistory(entriesRef.current, scope, query, Date.now()));
    },
    [scope, commit],
  );

  const recent = recentHistory(entries, scope);

  const clear = useCallback(() => {
    commit(entriesRef.current.filter((e) => e.scope !== scope));
  }, [scope, commit]);

  /** 删除单条（当前域、按查询词匹配）。 */
  const remove = useCallback(
    (query: string) => {
      const lower = query.toLowerCase();
      commit(
        entriesRef.current.filter(
          (e) => !(e.scope === scope && e.q.toLowerCase() === lower),
        ),
      );
    },
    [scope, commit],
  );

  return { recent, record, clear, remove };
}
