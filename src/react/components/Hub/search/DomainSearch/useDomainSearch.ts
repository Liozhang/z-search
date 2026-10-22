/**
 * useDomainSearch — 学术子域搜索的状态机（专利/数据集）。
 *
 * 驱动 DomainSearchPage 的搜索生命周期：请求 → 结果 → 筛选 → 导入。
 * 复用 semanticRequest（bridgeRequest）与后端 domain.search / domain.import
 * RPC。纯前端逻辑，不含 UI 渲染。
 *
 * @module react/components/Hub/search/DomainSearch/useDomainSearch
 */

import { useState, useCallback, useRef } from "react";
import { getString, friendlyErrorMessage } from "../../../../utils/locale";
import { toErrorMessage } from "../../../../utils/error";
import { semanticRequest } from "../../../../utils/semanticBridge";
import { useToast } from "@/components/ui/toast";
import type { DomainResult, DomainId, DomainSearchResponse } from "./types";

/** 高级查询参数（与后端 DomainFilters 对齐）。 */
export interface DomainQueryFilters {
  year?: string;
  license?: string;
  oaType?: string;
  taskTags?: string[];
  country?: string;
  status?: string;
  /** 数据集学科 id（选择后只在该学科的源中检索） */
  discipline?: string;
  /** 显式覆盖源列表（来自学科分组的 sources） */
  sources?: string[];
}

export function useDomainSearch(domainId: DomainId) {
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<DomainResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [metadata, setMetadata] = useState<DomainSearchResponse | null>(null);
  const [filters, setFilters] = useState<DomainQueryFilters>({});

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [importResults, setImportResults] = useState<Map<string, any>>(
    new Map(),
  );

  const requestId = useRef(0);

  const handleSearch = useCallback(
    async (queryOverride?: string) => {
      const trimmed = (
        typeof queryOverride === "string" ? queryOverride : query
      ).trim();
      if (!trimmed) return;

      const myId = ++requestId.current;
      setIsSearching(true);
      setSearchError(null);
      setSearchPerformed(true);
      setSelectedIds(new Set());
      setImportResults(new Map());

      try {
        const data = await semanticRequest<DomainSearchResponse>(
          "domain.search",
          {
            domainId,
            query: trimmed,
            maxResults: 20,
            filters,
          },
          30000,
        );
        if (myId !== requestId.current) return;
        setResults(data?.articles || []);
        setMetadata(data);
      } catch (e: unknown) {
        if (myId !== requestId.current) return;
        setSearchError(friendlyErrorMessage(toErrorMessage(e)));
      } finally {
        if (myId === requestId.current) setIsSearching(false);
      }
    },
    [query, domainId, filters],
  );

  const handleClear = useCallback(() => {
    requestId.current++;
    setIsSearching(false);
    setQuery("");
    setResults([]);
    setSearchPerformed(false);
    setSearchError(null);
    setMetadata(null);
    setFilters({});
    setSelectedIds(new Set());
    setImportResults(new Map());
  }, []);

  const handleImport = useCallback(
    async (result: DomainResult) => {
      const key = result.dedupKey;
      if (!key) return;

      setImportingIds((prev) => new Set(prev).add(key));
      try {
        const data = await semanticRequest<any[]>(
          "domain.import",
          {
            domainId,
            entries: [result],
          },
          30000,
        );
        const r = data?.[0];
        if (r) {
          setImportResults((prev) => new Map(prev).set(key, r));
          if (r.imported) {
            toast.success(
              getString("domain-import-success", {
                args: { title: (result.title || "").slice(0, 40) },
              }),
            );
          }
        }
      } catch (e: unknown) {
        setImportResults((prev) =>
          new Map(prev).set(key, {
            success: false,
            title: result.title,
            error: friendlyErrorMessage(toErrorMessage(e)),
            imported: false,
          }),
        );
      } finally {
        setImportingIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [domainId, toast],
  );

  const handleBatchImport = useCallback(async () => {
    const selected = results.filter((r) => selectedIds.has(r.dedupKey));
    if (selected.length === 0) return;

    setImportingIds(new Set(selected.map((r) => r.dedupKey)));
    try {
      const data = await semanticRequest<any[]>(
        "domain.import",
        {
          domainId,
          entries: selected,
        },
        60000,
      );
      const map = new Map(importResults);
      data?.forEach((r, i) => {
        if (i < selected.length) map.set(selected[i].dedupKey, r);
      });
      setImportResults(map);
      setSelectedIds(new Set());
      const successCount = data?.filter((r) => r.imported).length ?? 0;
      toast.success(
        getString("domain-batch-import-done", {
          args: { count: successCount, total: selected.length },
        }),
      );
    } catch (e: unknown) {
      toast.error(
        getString("domain-batch-import-error", {
          args: { error: friendlyErrorMessage(toErrorMessage(e)) },
        }),
      );
    } finally {
      setImportingIds(new Set());
    }
  }, [results, selectedIds, importResults, domainId, toast]);

  const toggleSelect = useCallback((key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(
      new Set(results.filter((r) => !r.inLibrary).map((r) => r.dedupKey)),
    );
  }, [results]);

  return {
    query,
    setQuery,
    isSearching,
    searchError,
    setSearchError,
    searchPerformed,
    metadata,
    results,
    filters,
    setFilters,
    selectedIds,
    importingIds,
    importResults,
    handleSearch,
    handleClear,
    handleImport,
    handleBatchImport,
    toggleSelect,
    selectAll,
  };
}
