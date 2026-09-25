/**
 * HubLiteratureHandler — literature.* + journal.* RPC handlers（z-search 精简版）。
 *
 * 从 leadero 复制时移除 translate（依赖整体翻译 API）与 chat.open
 * （聊天窗不属于本插件）。
 */

import type { HubWindowBridge } from "./HubWindowBridge";
import { toErrorMessage } from "../../utils/error";
import type { ImportResult } from "../../types/literatureSearch";
import academicSearch from "../../core/tool/builtin/handlers/academic-search/index";
import { safeDebug } from "../../utils/logger";
import {
  normalizeDoi,
  enrichJournalMetrics,
} from "../../core/search/literatureSearchHelpers";
import { isSourceAvailable } from "../../core/sources/academic-search/utils";

const {
  callSearchAPI,
  deduplicateArticles,
  importArticle: doImportArticle,
} = academicSearch;

export async function handleLiteratureRequest(
  bridge: HubWindowBridge,
  method: string,
  payload: any,
  id: string | number,
  source: Window,
): Promise<void> {
  let result: any = null;
  let error: string | null = null;

  try {
    switch (method) {
      case "literature.search": {
        if (!payload?.query) {
          error = "literature.search: missing query";
          break;
        }

        const maxResults = payload.maxResults ?? 20;
        // 默认源表 = UI 可选全集。「全不选」走这里。
        const sources = payload.sources || [
          "openalex",
          "semantic-scholar",
          "crossref",
          "arxiv",
          "biorxiv",
          "medrxiv",
          "doaj",
          "zenodo",
          "hal",
          "core",
          "europe-pmc",
          "pubmed",
          "github",
        ];

        bridge._searchAbortSignal ??= new Map();
        const searchId = ++bridge._searchIdCounter;
        const signal: { aborted: boolean } = { aborted: false };
        bridge._searchAbortSignal.set(searchId, signal);

        const allArticles: any[] = [];
        // 未真正产出结果的源，分开记账（2026-09-23 可观测性修复：此前两者
        // 都只进 safeDebug，前端看到「正在检索 8 个来源」却不知哪几个没跑，
        // 静默降级）：
        //   skippedNoKey  = 缺 API Key，本配置下不发起请求（与 SearchPipeline
        //                   的 isSourceAvailable 语义对齐）
        //   failedSources = 发起了请求但抛错（网络/限流/解析）
        const skippedNoKey: string[] = [];
        const failedSources: string[] = [];
        try {
          // 并发扇出（2026-09-23）：Hub 搜索页前端已改为逐源并行 RPC
          // （每次单源调用，本循环体只跑一轮）；这里的并发化服务于仍传
          // 多源 sources 的调用方——总耗时从「各源之和」降到「最慢单源」。
          // 取消语义不变：signal.aborted 的源直接跳过，结算后统一上报。
          const responses = await Promise.all(
            sources.map(async (src: string) => {
              if (signal.aborted) return null;
              if (!isSourceAvailable(src)) {
                skippedNoKey.push(src);
                return null;
              }
              try {
                return await callSearchAPI(
                  src,
                  payload.query,
                  payload.year,
                  maxResults,
                  {
                    author: payload.author,
                    journal: payload.journal,
                    sort: payload.sort || "relevance",
                  },
                );
              } catch (e) {
                safeDebug("[z-search] " + e);
                failedSources.push(src);
                /* skip failed source */
                return null;
              }
            }),
          );
          for (const resp of responses) {
            if (resp?.articles?.length) {
              allArticles.push(...resp.articles);
            } else if (resp && resp.success === false) {
              // 适配器失败不抛错（httpJsonGet 一律 return {ok:false}）——
              // success:false 必须点名进 failedSources，否则「源全挂」被
              // 谎报成「0 条结果」（2026-09-25 审计 P1-1）
              failedSources.push(resp.source || "unknown");
            }
          }

          if (signal.aborted) {
            result = { aborted: true };
            break;
          }

          const deduped = deduplicateArticles(allArticles);
          // 期刊指标/风险富集（JCR/CASS/预警/Beall's）——本地查表、原地写回，
          // 内部吞错，绝不拖垮主检索。
          await enrichJournalMetrics(deduped);
          result = {
            articles: deduped.slice(0, maxResults).map((a: any) => ({
              title: a.title || "",
              authors: a.authors || "",
              // 源侧字段名不统一：Europe PMC/PubMed 回 journalName 或
              // containerTitle，只有旧 arch 源带 journal——三者取齐，否则
              // 卡片期刊位恒空。
              journal: a.journal || a.journalName || a.containerTitle || "",
              // 多数适配器的 year 是 number（crossref date-parts / openalex /
              // arxiv getFullYear）——字符串化：前端排序的 localeCompare 只在
              // string 原型上存在（审计 P0-4）
              year: a.year != null ? String(a.year) : "",
              // DOI 归一化：源站会回填 https://doi.org/ 全 URL——不剥前缀则
              // 展示冗余、href 二次拼接、导入标识带壳。
              doi: normalizeDoi(a.doi),
              issn: a.issn || undefined,
              citationCount: a.citationCount ?? a.citations ?? 0,
              pdfUrl: a.pdfUrl || a.pdf_url || "",
              isOpenAccess: a.isOpenAccess || a.openAccess || false,
              abstract: a.abstract || "",
              source: a.source || "",
              // 全文解析标识（PMC 标签与「全文」按钮的可用性依据）。
              pmid: a.pmid || undefined,
              pmcid: a.pmcid || undefined,
              oaUrl: a.oaUrl || undefined,
              // 期刊指标/风险徽章数据（富集未命中则全 undefined，卡片静默不显示）
              jif: a.jif,
              jcrQuartile: a.jcrQuartile,
              cassQuartile: a.cassQuartile,
              cassCategory: a.cassCategory,
              cassIsTop: a.cassIsTop,
              warningLevel: a.warningLevel,
              beallsHit: a.beallsHit,
              stars: a.stars,
            })),
            skippedNoKey,
            failedSources,
          };
        } finally {
          bridge._searchAbortSignal.delete(searchId);
        }
        break;
      }

      case "literature.searchCancel": {
        if (bridge._searchAbortSignal) {
          for (const s of bridge._searchAbortSignal.values()) {
            s.aborted = true;
          }
          bridge._searchAbortSignal.clear();
        }
        result = { cancelled: true };
        break;
      }

      case "literature.import": {
        // 两种入参：identifiers（DOI 等直采标识，旧契约）或 entries（支持
        // 无 DOI 条目——标题走 crossrefTitleToDoi→s2TitleToDoi 回退解析）。
        // 返回数组与入参逐位对齐，未解析条目位返回 success:false。
        const rawEntries: Array<{
          doi?: string;
          title?: string;
          year?: string;
        }> = [];
        if (Array.isArray(payload?.entries)) {
          for (const e of payload.entries) {
            if (e && typeof e === "object") {
              rawEntries.push({
                doi:
                  typeof e.doi === "string" && e.doi.trim()
                    ? // 归一化：消费方可能透传带前缀的 article.doi（幂等）。
                      normalizeDoi(e.doi) || undefined
                    : undefined,
                title: typeof e.title === "string" ? e.title : undefined,
                year: typeof e.year === "string" ? e.year : undefined,
              });
            }
          }
        } else if (
          Array.isArray(payload?.identifiers) &&
          payload.identifiers.length > 0
        ) {
          for (const id2 of payload.identifiers) {
            rawEntries.push({ doi: String(id2) });
          }
        }
        if (rawEntries.length === 0) {
          error = "literature.import: missing identifiers/entries array";
          break;
        }

        let collectionId: number | undefined;
        try {
          const pane = Zotero.getActiveZoteroPane?.();
          const selected = pane?.getSelectedCollectionID?.();
          if (typeof selected === "number" && selected > 0) {
            collectionId = selected;
          }
        } catch (e) {
          safeDebug("[z-search] " + e);
          /* pane not ready — fall back to My Library root */
        }

        const importResults: ImportResult[] = new Array(rawEntries.length);
        const doiJobs: Array<{ idx: number; doi: string; title: string }> = [];
        // 标题→DOI 解析并行化（审计 P2-7）：串行最坏 63s/条，批量 120s RPC
        // 超时下后段条目必超时（前端 toast 失败、后端继续建条目 → 重复导入）。
        // 并发 5 兼顾 Crossref 礼貌池；解析带年份优先吻合候选。
        const RESOLVE_CONCURRENCY = 5;
        for (let i = 0; i < rawEntries.length; i += RESOLVE_CONCURRENCY) {
          const chunk = rawEntries
            .slice(i, i + RESOLVE_CONCURRENCY)
            .map((e, j) => ({ e, idx: i + j }));
          await Promise.all(
            chunk.map(async ({ e, idx }) => {
              let doi = e.doi;
              if (!doi && e.title) {
                try {
                  const lookup =
                    await import("../../core/tool/builtin/handlers/items/citations/doiLookup");
                  doi =
                    (await lookup.crossrefTitleToDoi(e.title, e.year)) ??
                    (await lookup.s2TitleToDoi(e.title, e.year)) ??
                    undefined;
                } catch (lookupErr) {
                  safeDebug("[z-search] title→doi lookup failed: " + lookupErr);
                }
              }
              if (doi) {
                doiJobs.push({ idx, doi, title: e.title || doi });
              } else {
                importResults[idx] = {
                  success: false,
                  title: e.title || "",
                  error: "DOI not found",
                  imported: false,
                };
              }
            }),
          );
        }

        if (doiJobs.length > 0) {
          try {
            const r = await doImportArticle({
              identifiers: doiJobs.map((j) => j.doi),
              type: payload.type,
              collectionId,
            });
            const itemResults = r.results ?? [];
            for (const [j, itemResult] of itemResults.entries()) {
              const job = doiJobs[j];
              if (!job) continue;
              importResults[job.idx] = {
                success: itemResult?.success || false,
                itemId: itemResult?.itemId,
                title: itemResult?.title || job.title,
                error: itemResult?.error,
                imported: itemResult?.imported || false,
              };
            }
          } catch (e: any) {
            for (const job of doiJobs) {
              importResults[job.idx] = {
                success: false,
                title: job.title,
                error: toErrorMessage(e),
                imported: false,
              };
            }
          }
        }
        result = importResults;
        break;
      }

      case "literature.fetchFulltext": {
        // 单篇全文按需拉取（结果卡片「全文」按钮）：PMC 开放获取 JATS XML
        // （NCBI E-utilities，DOI/PMID/PMCID 三入口 + OA 网页兜底，见
        // FullTextResolver）优先结构化路径——拿到的是无导航噪声的章节化正文。
        if (
          !payload?.doi &&
          !payload?.pmid &&
          !payload?.pmcid &&
          !payload?.oaUrl
        ) {
          error = "literature.fetchFulltext: missing identifier";
          break;
        }

        try {
          const { resolveArticleFullText } =
            await import("../../core/search/FullTextResolver");
          const resolved = await resolveArticleFullText(
            {
              doi: payload.doi,
              pmid: payload.pmid,
              pmcid: payload.pmcid,
              url: payload.url,
              oaUrl: payload.oaUrl,
            },
            {
              strategy: "structured-first",
              maxChars: Math.min(payload.maxChars ?? 20_000, 60_000),
            },
          );
          if (!resolved) {
            // 不可得（非开放获取 / 无 PMCID / 网页也不可抓）——回执
            // success:false 由 UI 用 lit-fulltext-empty 说实话，不抛错。
            result = { success: false, reason: "unavailable" };
          } else {
            result = { success: true, ...resolved };
          }
        } catch (e: any) {
          result = {
            success: false,
            reason: "error",
            error: toErrorMessage(e),
          };
        }
        break;
      }

      case "literature.translate": {
        // 摘要翻译：走统一翻译引擎（默认 Google 免费端点，无需配 key；
        // 可在 translate.engineType 切 AI/Bing/DeepL/custom）。
        if (!payload?.text || typeof payload.text !== "string") {
          error = "literature.translate: missing text";
          break;
        }
        try {
          const { createTranslator } =
            await import("../../core/translation/translationEngines");
          const targetLanguage =
            payload.targetLanguage || (Zotero as any).locale || "zh-CN";
          const translate = createTranslator(
            targetLanguage,
            payload.sourceLanguage,
          );
          const translatedText = await translate(
            payload.text,
            targetLanguage,
            payload.sourceLanguage,
          );
          if (translatedText) {
            result = { success: true, translatedText };
          } else {
            result = { success: false, error: "Translation returned empty" };
          }
        } catch (e: any) {
          result = { success: false, error: toErrorMessage(e) };
        }
        break;
      }

      case "journal.search": {
        if (
          !payload?.mode ||
          !["metric", "discover", "library"].includes(payload.mode)
        ) {
          error = "journal.search: invalid mode";
          break;
        }
        const { default: JournalSearchService } =
          await import("../../core/search/JournalSearchService");
        try {
          result = await JournalSearchService.search({
            mode: payload.mode,
            query: payload.query,
            limit: payload.limit,
            sortBy: payload.sortBy,
          });
        } catch (e: any) {
          error = toErrorMessage(e);
        }
        break;
      }
    }
  } catch (e: any) {
    error = toErrorMessage(e);
  }

  bridge.respond(id, result, error, source);
}
