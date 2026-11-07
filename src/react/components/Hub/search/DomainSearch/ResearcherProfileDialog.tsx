/**
 * ResearcherProfileDialog — 学者详情弹窗（researcher 域）。
 *
 * 从研究者结果卡的「详情」按钮进入：按当前来源下钻学者档案
 * （domain.profile RPC，source 定位适配器、sourceId 下钻，仅查当前来源、
 * 不做跨源聚合）。信息架构按来源实际返回条件渲染，缺的分区不显示：
 *   - 头部：姓名 + 来源徽章 + 来源 ID 外链（钻取语境常驻可见）；
 *   - 指标行：works / h-index / citations / i10Index（metrics 里有的才渲染）；
 *   - 机构履历：ORCID 履历（机构 + 职务 + 起止年）优先，回落机构名列表；
 *   - 研究方向：OpenAlex topics 或 ORCID keywords；
 *   - 简介：ORCID biography；个人主页：Semantic Scholar homepage。
 *
 * 加载三态复用状态占位三件套（LoadingState / ErrorState / EmptyState），
 * 模板对齐 CitationExplorerDialog（seed prop + useEffect 加载）。
 *
 * @module react/components/Hub/search/DomainSearch/ResearcherProfileDialog
 */

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/LoadingState";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import { getString } from "../../../../utils/locale";
import { semanticRequest } from "../../../../utils/semanticBridge";
import { openExternalUrl } from "../../../../utils/openExternal";
import type { DomainResult } from "./types";

interface ResearcherProfileDialogProps {
  /** 入口种子（从哪条结果发起下钻）。null = 关闭。 */
  seed: DomainResult | null;
  onClose: () => void;
}

/** ORCID profile() 的履历条目（见 orcid.ts profile()）。 */
interface EmploymentEntry {
  organization: string;
  role: string;
  department: string;
  startDate: string;
  endDate: string;
}

/** 分区标题（meta 字体 + 次墨色，对齐结果卡 DomainMetaRow 制式）。 */
function SectionTitle({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="[font:var(--ui-font-meta)] text-[length:var(--text-xs)] text-[color:var(--text-tertiary)] uppercase tracking-wide">
      {children}
    </div>
  );
}

/** 单条指标（数值 + 标签）。 */
function MetricItem({
  label,
  value,
}: {
  label: string;
  value: number | string;
}): React.ReactElement {
  return (
    <div className="flex items-baseline gap-[var(--space-1)]">
      <span className="text-[length:var(--text-sm)] font-[var(--font-weight-semibold)] text-[color:var(--text-primary)]">
        {value}
      </span>
      <span className="[font:var(--ui-font-meta)] text-[length:var(--text-xs)] text-[color:var(--text-secondary)]">
        {label}
      </span>
    </div>
  );
}

export function ResearcherProfileDialog({
  seed,
  onClose,
}: ResearcherProfileDialogProps): React.ReactElement | null {
  const [profile, setProfile] = useState<DomainResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const source = seed?.source || "";
  const sourceId = seed?.sourceId || "";

  // 种子变化或重试：重置三态并拉取当前来源的学者档案。
  useEffect(() => {
    if (!seed) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    setProfile(null);
    void (async () => {
      try {
        const resp = await semanticRequest<DomainResult | null>(
          "domain.profile",
          { domainId: "researcher", source, sourceId },
          30000,
        );
        if (!alive) return;
        setProfile(resp);
      } catch (e) {
        if (alive) setErr(String((e as Error)?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [source, sourceId, retryNonce, seed]);

  if (!seed) return null;

  // 详情数据里各分区的可用性（当前源没返回的分区不显示）。
  const metrics = profile?.metrics || {};
  const extra = profile?.extra || {};
  const employments: EmploymentEntry[] = Array.isArray(extra.employments)
    ? (extra.employments as EmploymentEntry[]).filter(
        (emp) => emp && emp.organization,
      )
    : [];
  const institutions: string[] = Array.isArray(extra.institutions)
    ? (extra.institutions as string[]).filter(Boolean)
    : [];
  const topics: string[] = Array.isArray(extra.topics)
    ? (extra.topics as string[]).filter(Boolean)
    : [];
  const keywords: string[] = Array.isArray(extra.keywords)
    ? (extra.keywords as string[]).filter(Boolean)
    : [];
  const biography: string =
    typeof extra.biography === "string" ? extra.biography : "";
  const homepage: string =
    typeof extra.homepage === "string" ? extra.homepage : "";
  const hasMetrics = Object.keys(metrics).length > 0;
  const hasAnySection =
    hasMetrics ||
    employments.length > 0 ||
    institutions.length > 0 ||
    topics.length > 0 ||
    keywords.length > 0 ||
    !!biography ||
    !!homepage;

  return (
    <Dialog open={!!seed} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader>
          <DialogTitle>{getString("domain-profile-title")}</DialogTitle>
        </DialogHeader>

        {/* 头部卡：钻取语境（我在看哪位学者、来自哪个源）常驻可见。 */}
        <div className="px-[var(--space-4-5)] pt-[var(--space-2-5)] pb-[var(--space-2)] border-b border-b-[var(--hub-row-divider)]">
          <div className="flex items-start justify-between gap-[var(--space-2)]">
            <div className="min-w-0">
              <div className="text-[length:var(--text-sm)] font-[var(--font-weight-semibold)] text-[color:var(--text-primary)] leading-[var(--leading-tight)] break-words">
                {seed.title || "—"}
              </div>
              <div className="flex items-center gap-[var(--space-1-5)] flex-wrap text-[length:var(--text-xs)] text-[color:var(--text-secondary)] mt-[var(--space-0-5)]">
                <Badge tone="neutral" size="sm">
                  {seed.source}
                </Badge>
                {seed.sourceId && (
                  <span className="[font:var(--font-mono)] truncate max-w-[320px]">
                    {seed.sourceId}
                  </span>
                )}
              </div>
            </div>
            {seed.url && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => openExternalUrl(seed.url!)}
              >
                {getString("domain-profile-open-source")}
              </Button>
            )}
          </div>
        </div>

        {/* 详情主体：加载 / 错误重试 / 查无详情 / 分区内容四分支。 */}
        <div className="px-[var(--space-4-5)] py-[var(--space-2-5)] overflow-y-auto min-h-0 flex-1">
          {loading ? (
            <LoadingState title={getString("domain-profile-loading")} />
          ) : err ? (
            <ErrorState
              message={getString("domain-profile-error")}
              desc={err}
              onRetry={() => setRetryNonce((n) => n + 1)}
              retryLabel={getString("domain-profile-retry")}
            />
          ) : !profile || !hasAnySection ? (
            <EmptyState title={getString("domain-profile-empty")} />
          ) : (
            <div className="flex flex-col gap-[var(--space-3)]">
              {/* 指标行：metrics 里有的才渲染 */}
              {hasMetrics && (
                <div className="flex flex-wrap items-baseline gap-x-[var(--space-4)] gap-y-[var(--space-1)]">
                  {metrics.works != null && (
                    <MetricItem
                      label={getString("domain-profile-works")}
                      value={metrics.works}
                    />
                  )}
                  {metrics.hIndex != null && (
                    <MetricItem
                      label={getString("domain-profile-h-index")}
                      value={metrics.hIndex}
                    />
                  )}
                  {metrics.citations != null && (
                    <MetricItem
                      label={getString("domain-profile-citations")}
                      value={metrics.citations}
                    />
                  )}
                  {metrics.i10Index != null && (
                    <MetricItem
                      label={getString("domain-profile-i10-index")}
                      value={metrics.i10Index}
                    />
                  )}
                </div>
              )}

              {/* 机构履历：ORCID 履历（含职务与起止年）优先，回落机构名列表 */}
              {(employments.length > 0 || institutions.length > 0) && (
                <div className="flex flex-col gap-[var(--space-1)]">
                  <SectionTitle>
                    {getString("domain-profile-institutions")}
                  </SectionTitle>
                  {employments.length > 0
                    ? employments.map((emp, i) => (
                        <div
                          key={`emp-${i}`}
                          className="text-[length:var(--text-xs)] text-[color:var(--text-secondary)] leading-[var(--leading-normal)]"
                        >
                          <span className="text-[color:var(--text-primary)]">
                            {emp.organization}
                          </span>
                          {(emp.department || emp.role) && (
                            <span>
                              {emp.department ? ` · ${emp.department}` : ""}
                              {emp.role ? ` · ${emp.role}` : ""}
                            </span>
                          )}
                          {(emp.startDate || emp.endDate) && (
                            <span className="[font:var(--ui-font-meta)] text-[color:var(--text-tertiary)]">
                              {" "}
                              (
                              {emp.startDate ||
                                getString("domain-profile-present")}
                              {" – "}
                              {emp.endDate ||
                                getString("domain-profile-present")}
                              )
                            </span>
                          )}
                        </div>
                      ))
                    : institutions.map((inst, i) => (
                        <div
                          key={`inst-${i}`}
                          className="text-[length:var(--text-xs)] text-[color:var(--text-secondary)] leading-[var(--leading-normal)]"
                        >
                          {inst}
                        </div>
                      ))}
                </div>
              )}

              {/* 研究方向：OpenAlex topics / ORCID keywords */}
              {(topics.length > 0 || keywords.length > 0) && (
                <div className="flex flex-col gap-[var(--space-1)]">
                  <SectionTitle>
                    {getString("domain-profile-topics")}
                  </SectionTitle>
                  <div className="flex flex-wrap gap-[var(--space-1)]">
                    {(topics.length > 0 ? topics : keywords).map((topic, i) => (
                      <Badge key={`topic-${i}`} tone="neutral" size="sm">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* 简介 */}
              {biography && (
                <div className="flex flex-col gap-[var(--space-1)]">
                  <SectionTitle>
                    {getString("domain-profile-biography")}
                  </SectionTitle>
                  <p className="text-[length:var(--text-xs)] text-[color:var(--text-secondary)] leading-[var(--leading-normal)] [overflow-wrap:anywhere]">
                    {biography}
                  </p>
                </div>
              )}

              {/* 个人主页 */}
              {homepage && (
                <div className="flex flex-col gap-[var(--space-1)]">
                  <SectionTitle>
                    {getString("domain-profile-homepage")}
                  </SectionTitle>
                  <a
                    href={homepage}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => openExternalUrl(homepage)}
                    className="text-[length:var(--text-xs)] text-[color:var(--data-blue-dark)] no-underline hover:underline break-all"
                  >
                    {homepage}
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底栏：关闭 */}
        <div className="flex justify-end px-[var(--space-4-5)] py-[var(--space-2-5)] border-t border-t-[var(--hub-row-divider)]">
          <Button variant="outline" size="sm" onClick={onClose}>
            {getString("domain-profile-close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
