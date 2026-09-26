/**
 * CitationExplorerDialog — 引文钻取弹窗（P0-2）。
 *
 * 从结果卡的「被引 N」或「参考文献」进入：OpenAlex cited-by / references
 * 双向钻取，行内保留 IF/分区徽章与「已在库」状态，支持直接导入。数据经
 * literature.citations RPC（宿主侧复用主检索的映射与富集管线，字段口径
 * 与主列表一致）。
 *
 * @module react/components/Hub/search/LiteratureSearch/CitationExplorerDialog
 */

import React, { useEffect, useState } from "react";
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
import { getString } from "../../../../utils/locale";
import { semanticRequest } from "../../../../utils/semanticBridge";
import type { ArticleResult } from "./types";

export type CitationDirection = "cited-by" | "references";

interface CitationExplorerDialogProps {
  /** 种子文献（钻取对象）。null = 关闭。 */
  seed: ArticleResult | null;
  direction: CitationDirection;
  onClose: () => void;
  /** 行内导入（复用页面的 handleImport 链路：toast/已在库/PDF 附件全套）。 */
  onImport: (article: ArticleResult) => void;
  importingTitles: Set<string>;
}

interface CitationsResponse {
  direction: CitationDirection;
  total: number;
  articles: ArticleResult[];
  error?: string;
}

const TAG_BASE =
  "inline-flex items-center py-[var(--space-0-5)] px-[var(--space-1-5)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)]";

export function CitationExplorerDialog({
  seed,
  direction,
  onClose,
  onImport,
  importingTitles,
}: CitationExplorerDialogProps): React.ReactElement | null {
  const [data, setData] = useState<CitationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!seed?.doi) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    setData(null);
    void (async () => {
      try {
        const resp = await semanticRequest<CitationsResponse>(
          "literature.citations",
          { doi: seed.doi, direction },
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
  }, [seed?.doi, direction]);

  if (!seed) return null;
  const titleKey =
    direction === "cited-by" ? "lit-cited-by-title" : "lit-references-title";

  return (
    <Dialog open={!!seed} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto [scrollbar-width:thin]">
        <DialogHeader>
          <DialogTitle>
            {getString(titleKey, {
              args: { title: (seed.title || "").slice(0, 60) },
            })}
          </DialogTitle>
          <DialogDescription>
            {loading
              ? getString("lit-citations-loading")
              : data
                ? getString("lit-citations-count", {
                    args: {
                      count: data.articles.length,
                      total: data.total,
                    },
                  })
                : ""}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-[var(--space-2)] p-[var(--space-4)] text-[color:var(--text-secondary)]">
            <Spinner size={16} />
            {getString("lit-citations-loading")}
          </div>
        )}
        {err && !loading && (
          <div className="p-[var(--space-2)] m-[var(--space-2)] bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)]">
            {err}
          </div>
        )}
        {!loading && !err && data?.articles?.length === 0 && (
          <div className="p-[var(--space-4)] text-[color:var(--text-secondary)]">
            {getString("lit-citations-empty")}
          </div>
        )}

        <div className="flex flex-col">
          {(data?.articles || []).map((a, idx) => {
            const busy = importingTitles.has(a.title);
            return (
              <div
                key={`${a.doi || a.title}-${idx}`}
                className="flex items-start justify-between gap-[var(--space-2)] py-[var(--space-2)] border-t border-t-[var(--hub-row-divider)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-[var(--space-1-5)] flex-wrap">
                    <span className="text-[length:var(--text-sm)] font-[var(--font-weight-medium)] text-[color:var(--text-primary)]">
                      {a.title}
                    </span>
                    {!!a.citationCount && (
                      <span className="lit-result-citations text-[length:var(--text-xs)] text-[color:var(--text-secondary)]">
                        {getString("lit-citations", {
                          args: { count: a.citationCount },
                        })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-[var(--space-1-5)] flex-wrap text-[length:var(--text-xs)] text-[color:var(--text-secondary)] mt-[var(--space-0-5)]">
                    {a.journal && <span className="truncate">{a.journal}</span>}
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
                  </div>
                </div>
                <div className="flex items-center gap-[var(--space-1)] shrink-0">
                  {a.inLibrary ? (
                    <span title={getString("lit-in-library-tip")}>
                      <Badge tone="success">
                        {getString("lit-in-library")}
                      </Badge>
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || (!a.doi && !a.title)}
                      onClick={() => onImport(a)}
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
      </DialogContent>
    </Dialog>
  );
}

export default CitationExplorerDialog;
