/**
 * CitationExplorerDialog — 引文钻取弹窗（P0-2，2026-10-09 重做）。
 *
 * 从结果卡的「被引 N」或「参考文献」进入：OpenAlex cited-by / references
 * 双向钻取。此前弹窗只有裸列表——种子文献零上下文、方向写死、不可排序、
 * 不可继续下钻，回答不了「点开参考文献后应该看到什么」。
 *
 * 重做后的信息架构：
 *   - 种子卡：完整标题 + 作者/期刊/年份/被引/IF 元数据 + DOI 链接——钻取
 *     的语境（我在看谁的引文）常驻可见；
 *   - 方向切换：施引文献 / 参考文献 双向 seg，切换即重查，不必关窗重进；
 *   - 结果排序：引用最多 / 日期 / 标题（客户端稳定排序，默认引用最多）；
 *   - 行内继续钻取：任一行的「被引 N」可看它的施引文献，「参考文献」可看
 *     它的参考列表——种子栈（返回上一级）支撑层级探索；
 *   - 行内导入：复用页面的 handleImport 链路（toast/已在库/PDF 附件全套），
 *     busy 态与「已导入」回执由本组件与页面 importResults 表共同承担。
 *
 * 数据经 literature.citations RPC（宿主侧复用主检索的映射与富集管线，字段
 * 口径与主列表一致）。
 *
 * @module react/components/Hub/search/LiteratureSearch/CitationExplorerDialog
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getString } from "../../../../utils/locale";
import { semanticRequest } from "../../../../utils/semanticBridge";
import type { ArticleResult, ImportResult } from "./types";

export type CitationDirection = "cited-by" | "references";

/** 列表排序：引用最多（默认）/ 日期 / 标题。标签复用既有键。 */
type CitationSortBy = "citations" | "date" | "title";

interface CitationExplorerDialogProps {
  /** 入口种子文献（钻取对象）。null = 关闭。层级钻取的中间种子由组件内部
   *  栈管理——prop 只表达「从结果列表发起的入口」。 */
  seed: ArticleResult | null;
  /** 入口方向（被引 N → cited-by；参考文献按钮 → references）。 */
  initialDirection: CitationDirection;
  onClose: () => void;
  /** 行内导入（复用页面的 handleImport 链路：toast/已在库/PDF 附件全套）。 */
  onImport: (article: ArticleResult) => Promise<void> | void;
  /** 页面的导入回执表（键 = doi||title，与页面的 importFromCitations 同源）：
   *  行内导入成功后据此显示「已导入」并禁用按钮——后端幂等防线之外的 UI
   *  防重复。 */
  importResults: Map<string, ImportResult>;
}

interface CitationsResponse {
  direction: CitationDirection;
  total: number;
  articles: ArticleResult[];
  error?: string;
}

const TAG_BASE =
  "inline-flex items-center py-[var(--space-0-5)] px-[var(--space-1-5)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)]";

/** 行内导入/已导入判定的键：与页面 importFromCitations 的
 *  getArticleKey(article, -1) 同源（doi || title）。 */
const importKeyOf = (a: ArticleResult): string => a.doi || a.title || "";

/** 列表排序选项（标签复用既有键：引用最多/日期/标题）。 */
const CITATION_SORT_KEYS: ReadonlyArray<{
  value: CitationSortBy;
  labelKey: string;
}> = [
  { value: "citations", labelKey: "lit-sort-cited" },
  { value: "date", labelKey: "semantic-sort-date" },
  { value: "title", labelKey: "semantic-sort-title" },
];

const CITATION_SORTERS: Record<
  CitationSortBy,
  (a: ArticleResult, b: ArticleResult) => number
> = {
  citations: (a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0),
  date: (a, b) => String(b.year ?? "").localeCompare(String(a.year ?? "")),
  title: (a, b) => String(a.title ?? "").localeCompare(String(b.title ?? "")),
};

export function CitationExplorerDialog({
  seed,
  initialDirection,
  onClose,
  onImport,
  importResults,
}: CitationExplorerDialogProps): React.ReactElement | null {
  // 种子栈：入口文献在栈底，行内钻取压栈，「返回上一级」出栈。
  const [stack, setStack] = useState<ArticleResult[]>([]);
  const [direction, setDirection] = useState<CitationDirection>("cited-by");
  const [sortBy, setSortBy] = useState<CitationSortBy>("citations");
  const [data, setData] = useState<CitationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  // 入口种子/方向变化（从结果列表重新发起）：重置栈与方向。行内钻取不经
  // prop，栈自持，不触发本 effect。
  useEffect(() => {
    setStack(seed ? [seed] : []);
    setDirection(initialDirection);
    setBusyKeys(new Set());
  }, [seed, initialDirection]);

  // 拉取当前种子的引文（direction 变化重查；seed.doi 变化=钻取/返回）。
  useEffect(() => {
    if (!current?.doi) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    setData(null);
    void (async () => {
      try {
        const resp = await semanticRequest<CitationsResponse>(
          "literature.citations",
          { doi: current.doi, direction },
          90000,
        );
        if (!alive) return;
        if (resp?.error) setErr(resp.error);
        else setData(resp);
      } catch (e) {
        if (alive) setErr(String((e as Error)?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [current?.doi, direction]);

  const articles = useMemo(() => {
    const list = [...(data?.articles || [])];
    return list.sort(CITATION_SORTERS[sortBy]);
  }, [data, sortBy]);

  const drillDown = (article: ArticleResult, dir: CitationDirection) => {
    if (!article.doi) return;
    setDirection(dir);
    setStack((prev) => [...prev, article]);
  };

  const importRow = async (article: ArticleResult) => {
    const key = importKeyOf(article);
    if (!key || busyKeys.has(key)) return;
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      await onImport(article);
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  if (!seed) return null;

  return (
    <Dialog open={!!seed} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader>
          <DialogTitle>
            {getString(
              direction === "cited-by"
                ? "lit-cited-by-title"
                : "lit-references-title",
              {
                args: { title: (current?.title || "").slice(0, 60) },
              },
            )}
          </DialogTitle>
          <DialogDescription>
            {!loading && data
              ? getString("lit-citations-count", {
                  args: {
                    count: data.articles.length,
                    total: data.total,
                  },
                })
              : ""}
          </DialogDescription>
        </DialogHeader>

        {/* 种子卡：钻取语境（我在看谁的引文）常驻；栈深 &gt;1 时提供返回。 */}
        {current && (
          <div className="px-[var(--space-4-5)] pt-[var(--space-2-5)] pb-[var(--space-2)] border-b border-b-[var(--hub-row-divider)]">
            <div className="flex items-start justify-between gap-[var(--space-2)]">
              <div className="min-w-0">
                <div className="text-[length:var(--text-sm)] font-[var(--font-weight-semibold)] text-[color:var(--text-primary)] leading-[var(--leading-tight)] break-words">
                  {current.title || "—"}
                </div>
                <div className="flex items-center gap-[var(--space-1-5)] flex-wrap text-[length:var(--text-xs)] text-[color:var(--text-secondary)] mt-[var(--space-0-5)]">
                  {current.authors && (
                    <span className="truncate max-w-[420px]">
                      {current.authors}
                    </span>
                  )}
                  {current.journal && (
                    <span className="italic">{current.journal}</span>
                  )}
                  {current.year && <span>({current.year})</span>}
                  {!!current.citationCount && (
                    <span>
                      {getString("lit-citations", {
                        args: { count: current.citationCount },
                      })}
                    </span>
                  )}
                </div>
                {current.doi && (
                  <a
                    href={`https://doi.org/${current.doi}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[length:var(--text-xs)] text-[color:var(--data-blue-dark)] no-underline hover:underline [overflow-wrap:anywhere]"
                  >
                    DOI: {current.doi}
                  </a>
                )}
              </div>
              {stack.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    setStack((prev) =>
                      prev.length > 1 ? prev.slice(0, -1) : prev,
                    )
                  }
                >
                  {getString("lit-citations-back")}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* 方向切换 + 排序行：切换即重查；排序为客户端稳定排序。 */}
        <div className="flex flex-wrap items-center gap-[var(--space-2)] px-[var(--space-4-5)] py-[var(--space-2)]">
          <ToggleGroup
            variant="filter"
            multiple={false}
            value={[direction]}
            onValueChange={(v) => {
              if (!v.length) return;
              const found = ["cited-by", "references"].find((x) => x === v[0]);
              if (found) setDirection(found as CitationDirection);
            }}
          >
            <ToggleGroupItem value="cited-by">
              {getString("lit-citations-tab-cited-by")}
            </ToggleGroupItem>
            <ToggleGroupItem value="references">
              {getString("lit-citations-tab-references")}
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="ml-auto flex items-center gap-[var(--space-1-5)]">
            <span className="[font:var(--ui-font-meta)] text-[color:var(--text-tertiary)]">
              {getString("semantic-sort-label")}
            </span>
            <ToggleGroup
              variant="filter"
              multiple={false}
              value={[sortBy]}
              onValueChange={(v) => {
                if (!v.length) return;
                const found = CITATION_SORT_KEYS.find((x) => x.value === v[0]);
                if (found) setSortBy(found.value);
              }}
              aria-label={getString("semantic-sort-label")}
            >
              {CITATION_SORT_KEYS.map((o) => (
                <ToggleGroupItem key={o.value} value={o.value}>
                  {getString(o.labelKey)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] px-[var(--space-4-5)] pb-[var(--space-3)]">
          {loading && (
            <div className="flex items-center gap-[var(--space-2)] p-[var(--space-4)] text-[color:var(--text-secondary)]">
              <Spinner size={16} />
              {getString("lit-citations-loading")}
            </div>
          )}
          {err && !loading && (
            <div className="p-[var(--space-2)] my-[var(--space-2)] bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)]">
              {err}
            </div>
          )}
          {!loading && !err && articles.length === 0 && (
            <div className="p-[var(--space-4)] text-[color:var(--text-secondary)]">
              {getString("lit-citations-empty")}
            </div>
          )}

          <div className="flex flex-col">
            {articles.map((a, idx) => {
              const key = importKeyOf(a);
              const busy = key ? busyKeys.has(key) : false;
              // 与页面 importFromCitations 的 key 同源（doi || title）；导入
              // 回执命中即视为已导入。
              const imported = key ? !!importResults.get(key)?.imported : false;
              return (
                <div
                  key={`${a.doi || a.title}-${idx}`}
                  className="flex items-start justify-between gap-[var(--space-2)] py-[var(--space-2)] border-t border-t-[var(--hub-row-divider)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-[var(--space-1-5)] flex-wrap">
                      <span className="text-[length:var(--text-sm)] font-[var(--font-weight-medium)] text-[color:var(--text-primary)] break-words">
                        {a.title || "—"}
                      </span>
                      {!!a.citationCount &&
                        (a.doi ? (
                          <button
                            type="button"
                            className="lit-result-citations underline decoration-[var(--border)] underline-offset-2 hover:text-[color:var(--accent)] cursor-pointer bg-transparent border-0 p-0 text-[length:var(--text-xs)] text-[color:var(--text-secondary)]"
                            title={getString("lit-cited-by-tip")}
                            onClick={() => drillDown(a, "cited-by")}
                          >
                            {getString("lit-citations", {
                              args: { count: a.citationCount },
                            })}
                          </button>
                        ) : (
                          <span className="lit-result-citations text-[length:var(--text-xs)] text-[color:var(--text-secondary)]">
                            {getString("lit-citations", {
                              args: { count: a.citationCount },
                            })}
                          </span>
                        ))}
                    </div>
                    {a.authors && (
                      <div className="text-[length:var(--text-xs)] text-[color:var(--text-secondary)] mt-[var(--space-0-5)] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
                        {a.authors}
                      </div>
                    )}
                    <div className="flex items-center gap-[var(--space-1-5)] flex-wrap text-[length:var(--text-xs)] text-[color:var(--text-secondary)] mt-[var(--space-0-5)]">
                      {a.journal && <span className="italic">{a.journal}</span>}
                      {a.year && <span>({a.year})</span>}
                      {a.jif != null && (
                        <span className="text-[color:var(--signal-yellow-text)] font-[var(--font-weight-medium)]">
                          {getString("lit-if-label")} {a.jif.toFixed(1)}
                        </span>
                      )}
                      {a.jcrQuartile && (
                        <span
                          className={`${TAG_BASE} border border-[var(--border)]`}
                        >
                          JCR {a.jcrQuartile}
                        </span>
                      )}
                      {a.cassQuartile && (
                        <span
                          className={`${TAG_BASE} border border-[var(--border)]`}
                        >
                          {getString("lit-quartile-cass-" + a.cassQuartile)}
                        </span>
                      )}
                      {a.isOpenAccess && (
                        <span
                          className={`${TAG_BASE} bg-[var(--data-blue-bg)] text-[color:var(--data-blue-dark)]`}
                        >
                          {getString("lit-tag-oa")}
                        </span>
                      )}
                      {a.doi && (
                        <a
                          href={`https://doi.org/${a.doi}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[color:var(--data-blue-dark)] no-underline hover:underline [overflow-wrap:anywhere]"
                        >
                          DOI: {a.doi}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-[var(--space-1)] shrink-0">
                    {a.doi && (
                      <Button
                        variant="ghost"
                        size="sm"
                        ariaLabel={getString("lit-references-btn")}
                        onClick={() => drillDown(a, "references")}
                      >
                        {getString("lit-references-btn")}
                      </Button>
                    )}
                    {a.inLibrary || imported ? (
                      <span title={getString("lit-in-library-tip")}>
                        <Badge tone="success">
                          {getString(
                            imported ? "lit-imported" : "lit-in-library",
                          )}
                        </Badge>
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || (!a.doi && !a.title)}
                        onClick={() => void importRow(a)}
                      >
                        {busy ? (
                          <Spinner size={12} />
                        ) : (
                          getString("lit-import-btn")
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CitationExplorerDialog;
