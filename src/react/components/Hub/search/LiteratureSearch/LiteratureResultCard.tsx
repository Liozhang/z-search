/**
 * LiteratureResultCard — one external-database article result card.
 *
 * Presentational component for external hits in the Hub merged search page
 * (interleaved with library hits from Semantic ResultItem).
 * All per-key state (selection / expand / translate) arrives via props.
 *
 * @module react/components/Hub/search/LiteratureSearch/LiteratureResultCard
 */

import { Card } from "@/components/ui/card";
import React from "react";
import { getString } from "../../../../utils/locale";
import { Icon } from "../../../../utils/icons";
import Button from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { ICON } from "../../../../utils/iconSizes";
import { highlightSegments } from "../../../../utils/highlight";
import type { ArticleResult, FulltextResult, ImportResult } from "./types";

/* lit-tag 配方（原 leadero-literature-search.css 全量迁移，文件已删除）：
   基底 + 语义色 kind。2026-08-31 C3：Q 徽标分区色阶梯（Q1 最深→Q4 最浅）退役，
   回原型 .q 徽标（:635-636）——见 QUARTILE_STYLE。 */
const TAG_BASE =
  "text-[length:var(--text-2xs)] py-px px-[var(--space-1-5)] rounded-[var(--radius-xs)] font-medium uppercase tracking-[var(--tracking-wide)]";
/* 2026-08-31 C3：Q1-Q4 同形态不分级（原型 .q :635-636）——
   白底（bg-background）+ 1px 发丝边 var(--border) + 蓝字 --data-blue-dark；
   radius 归 TAG_BASE（--radius-xs）；前置 4px 蓝点在 JSX 内以 span 供给
   （4px 取 --space-1 同值）。原 Record 分级实底查找表退役。 */
const QUARTILE_STYLE =
  "inline-flex items-center gap-[var(--space-1)] bg-background border border-[color:var(--border)] text-[color:var(--data-blue-dark)]";
/* 原型 .q::before 4px 蓝点（--data-blue；--space-1=4px 同值） */
const QUARTILE_DOT =
  "lit-quartile-dot w-[var(--space-1)] h-[var(--space-1)] rounded-full bg-[var(--data-blue)] flex-shrink-0";
const TAG_KIND: Record<string, string> = {
  warning: "bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)]",
  /* 与 warning 同配方（同为风险信号，label 文字区分语义）——掠夺性
     （Beall's 名单精确命中），tooltip 披露名单截止时间。 */
  predatory: "bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)]",
  top: "bg-[var(--signal-yellow-bg)] text-[color:var(--signal-yellow-text)]",
  pdf: "bg-[var(--signal-green-bg)] text-[color:var(--signal-green-dark)]",
  oa: "bg-[var(--data-blue-bg)] text-[color:var(--data-blue-dark)]",
  source: "bg-[var(--border-strong)] text-[color:var(--text-secondary)]",
};

/** 全文来源（resolveArticleFullText 的 source）→ 展示文案键。 */
const FULLTEXT_SOURCE_KEYS: Record<string, string> = {
  "pmc-jats": "lit-fulltext-source-pmc",
  "openalex-grobid": "lit-fulltext-source-grobid",
  html: "lit-fulltext-source-html",
};

export interface LiteratureResultCardProps {
  article: ArticleResult;
  /** Stable identity key (doi / title / positional) — computed by the caller. */
  articleKey: string;
  /** 当前检索词——标题命中片段以品牌红呈现（原型 .q 条款）。缺省不高亮。 */
  query?: string;
  isSelected: boolean;
  isImporting: boolean;
  isImported: boolean;
  importResult?: ImportResult;
  isExpanded: boolean;
  isTranslating: boolean;
  translation?: {
    status: "loading" | "success" | "error";
    translatedText?: string;
    truncated?: boolean;
    error?: string;
  };
  onToggleSelect: (key: string) => void;
  onToggleExpand: (key: string) => void;
  onTranslate: (article: ArticleResult, key: string) => void;
  onImport: (article: ArticleResult, key: string) => void;
  /**
   * 全文按需拉取（PMC 开放获取 JATS XML 优先，OA 网页兜底）。已成功的文章
   * 再调用一次即切换展开/收起（hook 内做开关分流）。无任何可用标识
   * （doi/pmid/pmcid/oaUrl 皆空）时按钮禁用。
   */
  onFetchFulltext?: (article: ArticleResult, key: string) => void;
  isFetchingFulltext?: boolean;
  isFulltextOpen?: boolean;
  fulltext?: FulltextResult;
  /**
   * JA-2（§30.2 文献条目出口「追踪」）：行内追踪动作，handler 在页面层。
   * 有 DOI → 论文引用追踪；无 DOI → 标题作检索式的主题追踪（tooltip 说实话）。
   * 作者/期刊名需宿主侧 OpenAlex 解析才有可信标识——该类动作不显示，不硬造。
   */
  onTrack?: (article: ArticleResult, key: string) => void;
  isTracking?: boolean;
  /**
   * JA-7（§4.9 批5）：导入成功行的「打开」出口。宿主回执 ImportResult.itemId
   * （新建 Zotero 条目 id）经此打开原文，通道与库内行同一（semantic.openItem，
   * 页面层注入）；itemId 缺席（导入失败/旧宿主）不渲染，不硬造。
   */
  onOpen?: (itemId: number) => void;
}

export function LiteratureResultCard({
  article,
  articleKey: key,
  query,
  isSelected,
  isImporting,
  isImported,
  importResult,
  isExpanded,
  isTranslating,
  translation,
  onToggleSelect,
  onToggleExpand,
  onTranslate,
  onImport,
  onFetchFulltext,
  isFetchingFulltext,
  isFulltextOpen,
  fulltext,
  onTrack,
  isTracking,
  onOpen,
}: LiteratureResultCardProps): React.ReactElement {
  // JA-7：导入成功才有可信 itemId（ImportResult 契约），提起局部变量供收窄
  const openedItemId = importResult?.itemId;
  // 全文解析可用标识（任有其一即可尝试 PMC/DOI 解析或 OA 网页抓取）。
  const hasFulltextSource = !!(
    article.doi ||
    article.pmid ||
    article.pmcid ||
    article.oaUrl
  );
  const fulltextOpen = isFulltextOpen && fulltext?.status === "success";
  return (
    /* 竖条（§10.6 白名单②选中态=交互蓝 2px，走 tokens --hub-indicator-color
       单源；§5.3 品牌红禁入 UI）：「已导入」绿竖条非白名单三用，退役——
       已导入态由行尾 success Badge（lit-imported）承担，颜色非唯一通道。 */
    <Card
      className={`lit-result-card box-border bg-transparent border-0 border-b border-b-[var(--hub-row-divider)] border-l-[var(--stroke-edge)] border-l-transparent rounded-none px-0 py-[var(--space-3)] transition-colors duration-[var(--transition-fast)] hover:bg-[var(--hub-bg-hover)]${isSelected ? " !border-l-[var(--hub-indicator-color)]" : ""}`}
    >
      <div className="lit-result-main flex items-start gap-[var(--space-3)]">
        <Checkbox
          className={`lit-result-checkbox mt-[var(--space-1)] [accent-color:var(--accent)] cursor-pointer w-[var(--icon-md)] h-[var(--icon-md)] flex-shrink-0${isImporting || isImported ? " opacity-40 cursor-default" : ""}`}
          checked={isSelected}
          onChange={() => onToggleSelect(key)}
          disabled={isImporting || isImported}
        />
        <div className="lit-result-content flex-1 min-w-0">
          {/* 2026-08-31 C3：标题色 --data-blue-dark → --text-primary
              （原型 .result-title ink-strong :280；命中片段品牌红保留 :280 `.q` 条款） */}
          <div
            className={`lit-result-title text-[length:var(--text-base)] font-[var(--font-weight-semibold)] font-[family-name:var(--ui-family-display)] text-[color:var(--text-primary)] leading-[var(--leading-tight)] mb-[var(--space-1)] break-words${article.abstract ? " expandable cursor-pointer flex items-baseline gap-[var(--space-1)] hover:opacity-85" : ""}`}
            onClick={article.abstract ? () => onToggleExpand(key) : undefined}
            role={article.abstract ? "button" : undefined}
            tabIndex={article.abstract ? 0 : undefined}
            onKeyDown={
              article.abstract
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggleExpand(key);
                    }
                  }
                : undefined
            }
          >
            {highlightSegments(article.title, query ?? "").map((seg, i) =>
              seg.hit ? (
                <span key={i} className="text-[color:var(--accent)]">
                  {seg.text}
                </span>
              ) : (
                <React.Fragment key={i}>{seg.text}</React.Fragment>
              ),
            )}
            {article.abstract && (
              <span className="lit-expand-icon text-[length:var(--text-xs)] text-[color:var(--text-secondary)] flex-shrink-0">
                {isExpanded ? (
                  <Icon name="chevronDown" size={ICON.sm} />
                ) : (
                  <Icon name="chevronRight" size={ICON.sm} />
                )}
              </span>
            )}
          </div>
          {/* 2026-08-31 C3：作者行 13px（--text-sm）→ 11px --text-xs
              （原型 .result-meta 11px 内 tag 档 :283；两行截断保留） */}
          <div className="lit-result-authors text-[length:var(--text-xs)] text-[color:var(--text-secondary)] mb-[var(--space-1)] [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden">
            {article.authors || "—"}
          </div>
          <div className="lit-result-meta flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[color:var(--text-secondary)] mb-[var(--space-1)] opacity-80">
            <span className="lit-result-journal italic">
              {article.journal || "—"}
            </span>
            {article.year && (
              <span className="lit-result-year opacity-70">
                ({article.year})
              </span>
            )}
            {article.jif != null && (
              /* IF 黄字（原型 :1663；2026-08-26 用户裁决——黄强调从被引移回 IF） */
              <span className="lit-result-if text-[color:var(--signal-yellow-text)] font-[var(--font-weight-medium)]">
                {getString("lit-if-label")}{" "}
                <strong className="font-[var(--font-weight-semibold)]">
                  {article.jif.toFixed(1)}
                </strong>
              </span>
            )}
            {/* 被引 0 不显示（审计 P2-6）：arxiv/pubmed 等源恒 0，成排「被引 0」
                是噪音；真实计数由跨源字段合并取大后到达 */}
            {!!article.citationCount && (
              <span className="lit-result-citations">
                {getString("lit-citations", {
                  args: { count: article.citationCount },
                })}
              </span>
            )}
          </div>
          {(article.warningLevel ||
            article.beallsHit ||
            article.jcrQuartile ||
            article.cassQuartile ||
            article.cassIsTop ||
            article.cassCategory) && (
            <div className="lit-result-metrics flex flex-wrap items-center gap-[var(--space-1-5)] mb-[var(--space-1)]">
              {article.warningLevel && (
                <span className={`${TAG_BASE} ${TAG_KIND.warning}`}>
                  ⚠ {getString("lit-warning")}
                </span>
              )}
              {article.beallsHit && (
                <span
                  className={`${TAG_BASE} ${TAG_KIND.predatory}`}
                  title={getString("journal-predatory-data-year")}
                >
                  {getString("journal-predatory-label")}
                </span>
              )}
              {article.jcrQuartile && (
                <span className={`${TAG_BASE} ${QUARTILE_STYLE}`}>
                  {/* C3 原型 .q::before 4px 蓝点（:636） */}
                  <span aria-hidden="true" className={QUARTILE_DOT} />
                  {getString(
                    `lit-quartile-jcr-q${article.jcrQuartile.slice(1)}`,
                  )}
                </span>
              )}
              {article.cassQuartile && (
                <span className={`${TAG_BASE} ${QUARTILE_STYLE}`}>
                  {/* C3 原型 .q::before 4px 蓝点（:636） */}
                  <span aria-hidden="true" className={QUARTILE_DOT} />
                  {getString(`lit-quartile-cass-${article.cassQuartile}`)}
                </span>
              )}
              {article.cassIsTop && (
                <span className={`${TAG_BASE} ${TAG_KIND.top}`}>
                  {getString("lit-top")}
                </span>
              )}
              {article.cassCategory && (
                <span className="lit-result-category text-[length:var(--text-xs)] text-[color:var(--text-secondary)] opacity-[var(--opacity-secondary)]">
                  {article.cassCategory}
                </span>
              )}
            </div>
          )}
          {article.doi && (
            <div className="lit-result-doi text-[length:var(--text-xs)] text-[color:var(--text-secondary)] opacity-60 font-[var(--font-mono)] mb-[var(--space-1-5)] [overflow-wrap:anywhere]">
              {getString("common-doi")}:{" "}
              <a
                href={`https://doi.org/${article.doi}`}
                target="_blank"
                rel="noreferrer"
                className="lit-result-doi-link focus-ring-subtle text-[color:var(--data-blue-dark)] no-underline hover:underline"
              >
                {article.doi}
              </a>
            </div>
          )}
          {isExpanded && article.abstract && (
            <div className="lit-result-abstract mt-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2-5)] bg-[var(--data-blue-faint)] rounded-[var(--radius)]">
              <div className="lit-abstract-label text-[length:var(--text-2xs)] text-[color:var(--text-secondary)] uppercase tracking-[var(--tracking-wider)] font-[var(--font-weight-semibold)] mb-[var(--space-1)]">
                {getString("lit-abstract-label")}
              </div>
              {/* 审计 2026-08-31 P1：摘要=--text-prose 13.5/1.65 消费点（tokens.css:103 立法登记 .result-abs），原 13px text-base 双偏差 */}
              <div className="lit-abstract-text font-[family-name:var(--font-serif)] text-[length:var(--text-prose)] text-[color:var(--text-secondary)] leading-[var(--leading-prose)] max-w-[68ch] whitespace-pre-wrap break-words">
                {article.abstract}
              </div>
              <div className="lit-abstract-actions mt-[var(--space-2)]">
                {isTranslating ? (
                  <span className="lit-translating inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[color:var(--text-secondary)]">
                    <Spinner size={12} /> {getString("lit-translating")}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="lit-translate-btn bg-transparent border-none text-[color:var(--data-blue-dark)] text-[length:var(--text-xs)] cursor-pointer py-[var(--space-0-5)] font-[var(--font-sans)] hover:underline"
                    onClick={() => onTranslate(article, key)}
                  >
                    {getString("lit-translate-btn")}
                  </Button>
                )}
              </div>
              {translation?.status === "success" && (
                <div className="lit-translation mt-[var(--space-3)] pt-[var(--space-2)]">
                  <div className="lit-translation-text text-[length:var(--text-sm)] text-[color:var(--text-secondary)] leading-[var(--leading-normal)] whitespace-pre-wrap break-words">
                    {translation.translatedText}
                  </div>
                  {translation.truncated && (
                    <div className="lit-translation-truncated mt-[var(--space-1)] text-[length:var(--text-2xs)] text-[color:var(--signal-yellow-text)]">
                      {getString("lit-translate-truncated")}
                    </div>
                  )}
                </div>
              )}
              {translation?.status === "error" && (
                <div className="lit-translation-error mt-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1-5)] bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)] rounded-[var(--radius-xs)] text-[length:var(--text-xs)]">
                  {translation.error}
                </div>
              )}
            </div>
          )}
          <div className="lit-result-tags flex gap-[var(--space-1-5)] flex-wrap">
            {article.pdfUrl && (
              <span className={`${TAG_BASE} ${TAG_KIND.pdf}`}>
                {getString("lit-tag-pdf")}
              </span>
            )}
            {article.isOpenAccess && (
              <span className={`${TAG_BASE} ${TAG_KIND.oa}`}>
                {getString("lit-tag-oa")}
              </span>
            )}
            {/* PMC 编号在库 = 有开放获取全文可拉（NCBI E-utilities）——
                形态借 QUARTILE_STYLE（白底发丝边蓝点）与 OA 蓝底区分 */}
            {article.pmcid && (
              <span className={`${TAG_BASE} ${QUARTILE_STYLE}`}>
                <span aria-hidden="true" className={QUARTILE_DOT} />
                PMC
              </span>
            )}
            <span className={`${TAG_BASE} ${TAG_KIND.source}`}>
              {article.source}
            </span>
          </div>
          {/* 全文拉取失败条（不可得/网络错）——与导入错误条同制式 */}
          {fulltext?.status === "error" && fulltext.error && (
            <div className="lit-fulltext-error mt-[var(--space-1-5)] px-[var(--space-2)] py-[var(--space-1)] bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)] rounded-[var(--radius-xs)] text-[length:var(--text-xs)]">
              {fulltext.error}
            </div>
          )}
          {/* 全文正文区（PMC JATS 章节化文本或 OA 网页提取文本） */}
          {fulltextOpen && fulltext.text && (
            <div className="lit-fulltext mt-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2-5)] bg-[var(--data-blue-faint)] rounded-[var(--radius)]">
              <div className="lit-fulltext-header flex flex-wrap items-center gap-[var(--space-2)] mb-[var(--space-1)]">
                <span className="lit-fulltext-label text-[length:var(--text-2xs)] text-[color:var(--text-secondary)] uppercase tracking-[var(--tracking-wider)] font-[var(--font-weight-semibold)]">
                  {getString("lit-fulltext-title")}
                </span>
                {fulltext.source && FULLTEXT_SOURCE_KEYS[fulltext.source] && (
                  <span className="lit-fulltext-source text-[length:var(--text-2xs)] text-[color:var(--data-blue-dark)]">
                    {getString(FULLTEXT_SOURCE_KEYS[fulltext.source])}
                  </span>
                )}
                {fulltext.wordCount != null && (
                  <span className="lit-fulltext-words text-[length:var(--text-2xs)] text-[color:var(--text-secondary)] [font-variant-numeric:tabular-nums]">
                    {getString("lit-fulltext-words", {
                      args: { count: fulltext.wordCount },
                    })}
                  </span>
                )}
                <Button
                  variant="link"
                  size="xs"
                  className="lit-fulltext-collapse ml-auto text-[color:var(--data-blue-dark)] text-[length:var(--text-2xs)] cursor-pointer py-0"
                  onClick={() => onFetchFulltext?.(article, key)}
                >
                  {getString("lit-fulltext-collapse")}
                </Button>
              </div>
              {/* 正文 = --text-prose 摘要同档（tokens.css:103 立法登记消费点） */}
              <div className="lit-fulltext-text font-[family-name:var(--font-serif)] text-[length:var(--text-prose)] text-[color:var(--text-secondary)] leading-[var(--leading-prose)] max-w-[68ch] whitespace-pre-wrap break-words">
                {fulltext.text}
              </div>
              {fulltext.truncated && (
                <div className="lit-fulltext-truncated mt-[var(--space-1)] text-[length:var(--text-2xs)] text-[color:var(--signal-yellow-text)]">
                  {getString("lit-fulltext-truncated")}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="lit-result-action flex items-center flex-shrink-0 ml-[var(--space-2)] gap-[var(--space-1)]">
          {/* JA-2：追踪动作与导入同列（既有动作列形态，不另起范式）；ghost 不抢导入的主位 */}
          {onTrack && (
            <Button
              variant="ghost"
              size="sm"
              loading={isTracking}
              disabled={isTracking}
              tooltip={
                article.doi
                  ? getString("semantic-track-paper-tip")
                  : getString("semantic-track-topic-tip")
              }
              ariaLabel={getString("semantic-track-action")}
              onClick={() => onTrack(article, key)}
            >
              {getString("semantic-track-action")}
            </Button>
          )}
          {/* 全文按需拉取（PMC 开放获取 JATS XML 优先）——ghost 不抢主位；
              成功后同一按钮切换展开/收起（hook 内分流） */}
          {onFetchFulltext && (
            <Button
              variant="ghost"
              size="sm"
              loading={isFetchingFulltext}
              disabled={isFetchingFulltext || !hasFulltextSource}
              tooltip={
                hasFulltextSource
                  ? getString("lit-fulltext-tip")
                  : getString("lit-fulltext-no-id")
              }
              ariaLabel={getString("lit-fulltext-btn")}
              onClick={() => onFetchFulltext(article, key)}
            >
              {isFetchingFulltext
                ? getString("lit-fulltext-fetching")
                : fulltextOpen
                  ? getString("lit-fulltext-collapse")
                  : getString("lit-fulltext-btn")}
            </Button>
          )}
          {isImported ? (
            <>
              {/* JA-7：ghost 与追踪动作同档，不抢已导入徽标的主位 */}
              {onOpen && openedItemId != null && (
                <Button
                  variant="ghost"
                  size="sm"
                  ariaLabel={getString("btn-open")}
                  onClick={() => onOpen(openedItemId)}
                >
                  {getString("btn-open")}
                </Button>
              )}
              <Badge tone="success">{getString("lit-imported")}</Badge>
            </>
          ) : isImporting ? (
            <Button variant="outline" size="sm" disabled>
              <Spinner size={12} />
              {getString("lit-importing")}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              /* 无 DOI 也可导入：handleImport 走 entries 契约的标题→DOI
                 回退（与批量导入同链路）——只缺 DOI 与标题才禁用（审计 P1-5） */
              disabled={!article.doi && !article.title}
              onClick={() => onImport(article, key)}
            >
              {getString("lit-import-btn")}
            </Button>
          )}
        </div>
      </div>
      {importResult?.error && (
        <div className="lit-result-error mt-[var(--space-2)] p-[var(--space-2)] bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)] rounded-[var(--radius-sm)] text-[length:var(--text-xs)]">
          {importResult.error}
        </div>
      )}
    </Card>
  );
}

export default LiteratureResultCard;
