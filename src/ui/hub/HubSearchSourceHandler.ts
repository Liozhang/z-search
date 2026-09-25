/**
 * HubSearchSourceHandler — searchSources.* RPC 家族（搜索源管理批）。
 *
 * 搜索源「启用并测试」管理面的数据 + 写入口：
 * - list：13 源全量（fields 配置态 + 健康态 + added/default）
 * - test：单源真实搜索一次，失败分类（auth = key 被拒 / unreachable = 网络不可达 / error）
 * - add / remove / setDefault：addedSources 清单与默认源（remove 默认源自动落级）
 *
 * key 值的读写不经此层（React 走既有 prefsSetDynamic 通道）；本层只管
 * addedSources / defaultProvider 两个管理性 pref。惰性迁移：addedSources
 * 为空的存量用户首次 list 时播种为「已配置 key 的源」。
 *
 * @module ui/hub/HubSearchSourceHandler
 */

import { getPref, setPref, getPrefDynamic } from "../../utils/prefs";
import {
  WEB_SOURCE_DEFS,
  findWebSource,
} from "../../core/search/webSourceRegistry";

export interface SearchSourceHandlerResult {
  result: any;
  error: string | null;
}

type SearchSourceHandler = (payload: any) => Promise<SearchSourceHandlerResult>;

const ADDED_SOURCES_KEY = "search.web.addedSources";
const DEFAULT_PROVIDER_KEY = "search.web.defaultProvider";

function readAddedList(): string[] {
  try {
    const raw = getPref(ADDED_SOURCES_KEY);
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeAddedList(ids: string[]): void {
  setPref(ADDED_SOURCES_KEY, JSON.stringify([...new Set(ids)]));
}

/** 源是否已配置（全部必填字段非空）。 */
function isConfigured(id: string): boolean {
  const def = findWebSource(id);
  if (!def) return false;
  if (def.noKey) return true;
  return def.fields.every((f) => {
    const v = getPrefDynamic(f.prefKey);
    return typeof v === "string" && v.trim().length > 0;
  });
}

const SEARCH_SOURCE_HANDLERS: Record<string, SearchSourceHandler> = {
  "searchSources.list": async () => {
    const result: any = {};
    let error: string | null = null;
    try {
      // 惰性迁移：存量用户 addedSources 为空时播种为已配置 key 的源
      //（免 key 源不自动播种——不替用户启用不可达源）。
      let added = readAddedList();
      if (added.length === 0) {
        const configured = WEB_SOURCE_DEFS.filter(
          (s) => !s.noKey && isConfigured(s.id),
        ).map((s) => s.id);
        if (configured.length > 0) {
          added = configured;
          writeAddedList(added);
        }
      }
      const { default: providerHealthChecker } =
        await import("../../core/search/ProviderHealthChecker");
      result.defaultProvider = String(
        getPref(DEFAULT_PROVIDER_KEY) || "duckduckgo",
      );
      result.addedSources = added;
      result.sources = WEB_SOURCE_DEFS.map((def) => ({
        id: def.id,
        label: def.label,
        noKey: !!def.noKey,
        fields: def.fields.map((f) => ({
          key: f.key,
          prefKey: f.prefKey,
          label: f.label,
          secret: !!f.secret,
          value: String(getPrefDynamic(f.prefKey) ?? ""),
        })),
        configured: isConfigured(def.id),
        added: added.includes(def.id),
        health: providerHealthChecker.getStatus(def.id),
      }));
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    return { result, error };
  },

  "searchSources.test": async (payload) => {
    let result: any;
    const _error: string | null = null;
    try {
      const id = String(payload?.id || "");
      if (!findWebSource(id)) {
        return { result: null, error: `unknown source: ${id}` };
      }
      const { default: webSearchProvider } =
        await import("../../core/search/WebSearchProvider");
      const { default: providerHealthChecker } =
        await import("../../core/search/ProviderHealthChecker");
      // 手动测试前清旧判罚：unreachable 状态会让 search() 直接短路返回
      // 缓存错误，真实请求永远发不出去——测试成了自证预言（审计 P1-4）
      providerHealthChecker.invalidateStatus(id);
      const outcome = await webSearchProvider.search({
        query: "zsearch connectivity test",
        provider: id,
        maxResults: 1,
      });
      if (outcome.error) {
        const err = String(outcome.error).toLowerCase();
        // 分类顺序：missing-key 在 auth 之前——「未填 key」的错误串同样含
        // "api key" 字样，误归 auth 会误导用户去查一个根本没填的 key
        const kind =
          /requires an api key|no api key|api key is (required|missing|not set)/.test(
            err,
          )
            ? "missing-key"
            : /401|403|unauthorized|forbidden|invalid.{0,12}key|api key|quota|429/.test(
                  err,
                )
              ? "auth"
              : /timeout|timed out|network|unreachable|econn|dns|resolve|000/.test(
                    err,
                  )
                ? "unreachable"
                : "error";
        result = {
          ok: false,
          kind,
          detail: String(outcome.error).slice(0, 300),
        };
        // 结果回写健康缓存：列表页 health 徽标此前永远停在 "untested"
        providerHealthChecker.setStatus(
          id,
          kind === "unreachable" ? "unreachable" : "untested",
        );
      } else {
        result = { ok: true, count: outcome.results.length };
        providerHealthChecker.setStatus(id, "ok");
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const kind = /timeout|timed out|network|unreachable|econn|dns/i.test(msg)
        ? "unreachable"
        : "error";
      result = { ok: false, kind, detail: msg.slice(0, 300) };
    }
    return { result, error: null };
  },

  "searchSources.add": async (payload) => {
    const result: any = {};
    let error: string | null = null;
    try {
      const id = String(payload?.id || "");
      if (!findWebSource(id)) {
        return { result: null, error: `unknown source: ${id}` };
      }
      const added = readAddedList();
      if (!added.includes(id)) writeAddedList([...added, id]);
      result.ok = true;
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    return { result, error };
  },

  "searchSources.remove": async (payload) => {
    const result: any = {};
    let error: string | null = null;
    try {
      const id = String(payload?.id || "");
      if (!findWebSource(id)) {
        return { result: null, error: `unknown source: ${id}` };
      }
      const added = readAddedList().filter((s) => s !== id);
      writeAddedList(added);
      // 移除的是默认源 → 落级到剩余第一个已启用源（无则回出厂默认）。
      if (getPref(DEFAULT_PROVIDER_KEY) === id) {
        const fallback = added[0] ?? "duckduckgo";
        setPref(DEFAULT_PROVIDER_KEY, fallback);
        result.defaultProvider = fallback;
      }
      result.ok = true;
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    return { result, error };
  },

  "searchSources.setDefault": async (payload) => {
    const result: any = {};
    let error: string | null = null;
    try {
      const id = String(payload?.id || "");
      if (!findWebSource(id)) {
        return { result: null, error: `unknown source: ${id}` };
      }
      setPref(DEFAULT_PROVIDER_KEY, id);
      result.ok = true;
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
    return { result, error };
  },
};

export async function handleSearchSourceMethod(
  method: string,
  payload: any,
): Promise<SearchSourceHandlerResult> {
  const handler = SEARCH_SOURCE_HANDLERS[method];
  if (!handler) {
    return { result: null, error: `Unknown searchSources method: ${method}` };
  }
  return handler(payload);
}
