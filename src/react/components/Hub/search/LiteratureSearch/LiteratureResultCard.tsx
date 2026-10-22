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
import { SourceLogo } from "../SourceLogo";
import type { ArticleResult, FulltextResult, ImportResult } from "./types";
import { AVAILABLE_SOURCES } from "./types";
/* 徽章壳配方单源（2026-10-09 期刊行并入时上提）——配方与出处注释见
   ../badgeRecipes.ts，本文件不再持有副本。 */
import {
  TAG_BASE,
  TAG_KIND,
  QUARTILE_STYLE,
  QUARTILE_DOT,
} from "../badgeRecipes";

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
  /** 引文钻取（P0-2）：被引计数/参考文献入口；无 DOI 的条目不渲染入口。 */
  onCitations?: (
    article: ArticleResult,
    direction: "cited-by" | "references",
  ) => void;
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
  onCitations,
  onFetchFulltext,
  isFetchingFulltext,
  isFulltextOpen,
  fulltext,
  onOpen,
}: LiteratureResultCardProps): React.ReactElement {
  // JA-7：导入成功才有可信 itemId（ImportResult 契约），提起局部变量供收窄
  const openedItemId = importResult?.itemId;
  // 检索源徽章提示名：本地化展示名单源 AVAILABLE_SOURCES（与筛选片同源），
  // 未注册源回落原值、不设提示。
  const sourceLabelKey = AVAILABLE_SOURCES.find(
    (s) => s.value === article.source,
  )?.labelKey;
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
          className={`lit-result-checkbox mt-[var(--space-1)] [accent-color:var(--accent)] cursor-pointer w-[var(--icon-md)] h-[var(--icon-md)] flex-shrink-0${isImporting || isImported || article.inLibrary ? " opacity-40 cursor-default" : ""}`}
          checked={isSelected}
          onChange={() => onToggleSelect(key)}
          disabled={isImporting || isImported || article.inLibrary}
          aria-label={getString("aria-select-result", {
            args: { title: article.title || article.doi || "" },
          })}
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
          {/* 元信息行只留刊名——年份、IF、被引、星数已于 2026-10-22 徽章化，
              迁入下方 lit-result-metrics 行（与 JCR 分区同语法），此处不再
              持有副本。 */}
          <div className="lit-result-meta flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[color:var(--text-secondary)] mb-[var(--space-1)] opacity-80">
            <span className="lit-result-journal italic">
              {article.journal || "—"}
            </span>
          </div>
          {/* 徽章行排序（2026-10-22 徽章化时定档）：风险信号（红）置首——
              预警、掠夺性、Under Review 同为需先看见的告警，聚在一起不必在
              分类簇里辨认红色；其后依次是元数据（年份，灰）、影响数字（IF
              黄、被引灰——期刊级与文献级两个可直接扫读比较的数字）、期刊
              质量分类簇（JCR/CASS/XR 分区、顶刊、中文核心）；星数最专，收尾。
              提示口径：IF/分区/顶刊/新锐复用条目树 itemtree-metrics-*-tip
              （同一概念一处解释），预警/来源/星数/OA/PDF/PMC 用 lit-*-tip，
              年份是自明数字不设提示；掠夺性/Under Review/被引/中文核心/
              已在库此前已有提示，不动。 */}
          {(article.warningLevel ||
            article.beallsHit ||
            article.xrUnderReview ||
            article.year ||
            article.jif != null ||
            article.citationCount ||
            article.jcrQuartile ||
            article.cassQuartile ||
            article.cassIsTop ||
            article.xrQuartile ||
            article.chineseCore?.length ||
            article.stars ||
            article.cassCategory) && (
            <div className="lit-result-metrics flex flex-wrap items-center gap-[var(--space-1-5)] mb-[var(--space-1)]">
              {article.warningLevel && (
                <span
                  className={`${TAG_BASE} ${TAG_KIND.warning}`}
                  title={getString("lit-warning-tip")}
                >
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
              {/* Under Review（2026 起取代独立预警名单）同属风险信号，与
                  预警/掠夺性同组前置——红徽章聚在一起，扫读时不必在分类
                  簇里辨认红色告警。 */}
              {article.xrUnderReview && (
                <span
                  className={`${TAG_BASE} ${TAG_KIND.warning}`}
                  title={getString("journal-xr-under-review-label")}
                >
                  {getString("journal-xr-under-review-label")}
                </span>
              )}
              {article.year && (
                <span
                  className={`${TAG_BASE} ${TAG_KIND.fact} lit-result-year`}
                >
                  {article.year}
                </span>
              )}
              {article.jif != null && (
                /* IF 黄徽章（2026-08-26 用户裁决——黄强调从被引移回 IF；
                   徽章化后该色保持不动摇，与顶刊同色同配） */
                <span
                  className={`${TAG_BASE} ${TAG_KIND.if} lit-result-if`}
                  title={getString("itemtree-metrics-if-tip")}
                >
                  {getString("lit-if-label")}{" "}
                  <strong className="font-[var(--font-weight-semibold)]">
                    {article.jif.toFixed(1)}
                  </strong>
                </span>
              )}
              {/* 被引 0 不显示（审计 P2-6）：arxiv/pubmed 等源恒 0，成排「被引 0」
                  是噪音；真实计数由跨源字段合并取大后到达。有 DOI 时整枚
                  徽章即被引钻取入口。 */}
              {!!article.citationCount &&
                (onCitations && article.doi ? (
                  <button
                    type="button"
                    className={`${TAG_BASE} ${TAG_KIND.fact} lit-result-citations border-0 cursor-pointer hover:opacity-85`}
                    title={getString("lit-cited-by-tip")}
                    onClick={() => onCitations(article, "cited-by")}
                  >
                    {getString("lit-citations", {
                      args: { count: article.citationCount },
                    })}
                  </button>
                ) : (
                  <span
                    className={`${TAG_BASE} ${TAG_KIND.fact} lit-result-citations`}
                  >
                    {getString("lit-citations", {
                      args: { count: article.citationCount },
                    })}
                  </span>
                ))}
              {article.jcrQuartile && (
                <span
                  className={`${TAG_BASE} ${QUARTILE_STYLE}`}
                  title={getString("itemtree-metrics-jcr-tip")}
                >
                  {/* C3 原型 .q::before 4px 蓝点（:636） */}
                  <span aria-hidden="true" className={QUARTILE_DOT} />
                  {getString(
                    `lit-quartile-jcr-q${article.jcrQuartile.slice(1)}`,
                  )}
                </span>
              )}
              {article.cassQuartile && (
                <span
                  className={`${TAG_BASE} ${QUARTILE_STYLE}`}
                  title={getString("itemtree-metrics-cass-tip")}
                >
                  {/* C3 原型 .q::before 4px 蓝点（:636） */}
                  <span aria-hidden="true" className={QUARTILE_DOT} />
                  {getString(`lit-quartile-cass-${article.cassQuartile}`)}
                </span>
              )}
              {article.cassIsTop && (
                <span
                  className={`${TAG_BASE} ${TAG_KIND.top}`}
                  title={getString("itemtree-metrics-top-tip")}
                >
                  {getString("lit-top")}
                </span>
              )}
              {/* 新锐分区（2026 接续体系）——与 CAS 徽章同语法、独立成键，
                  文案本身带「新锐」字样区分两套分区。 */}
              {article.xrQuartile && (
                <span
                  className={`${TAG_BASE} ${QUARTILE_STYLE}`}
                  title={getString("itemtree-metrics-xr-tip")}
                >
                  <span aria-hidden="true" className={QUARTILE_DOT} />
                  {getString(`lit-quartile-xr-${article.xrQuartile}`)}
                </span>
              )}
              {/* 中文核心名单（easyScholar 可选源；P1-4）——稳定码取词 */}
              {(article.chineseCore || []).map((code) => (
                <span
                  key={`core-${code}`}
                  className={`${TAG_BASE} ${TAG_KIND.source}`}
                  title={getString("lit-chinese-core-tip")}
                >
                  {getString(`lit-core-${code}`)}
                </span>
              ))}
              {/* GitHub 仓库星数——与被引语义分离，★ 符号语言中立 */}
              {!!article.stars && (
                <span
                  className={`${TAG_BASE} ${TAG_KIND.fact} lit-result-stars`}
                  title={getString("lit-stars-tip")}
                >
                  ★ {article.stars}
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
                  {translation.truncated && (
                    <div className="lit-translation-truncated mb-[var(--space-1)] text-[length:var(--text-2xs)] text-[color:var(--signal-yellow-text)]">
                      {getString("lit-translate-truncated")}
                    </div>
                  )}
                  <div className="lit-translation-text text-[length:var(--text-sm)] text-[color:var(--text-secondary)] leading-[var(--leading-normal)] whitespace-pre-wrap break-words">
                    {translation.translatedText}
                  </div>
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
              <span
                className={`${TAG_BASE} ${TAG_KIND.pdf}`}
                title={getString("lit-tag-pdf-tip")}
              >
                {getString("lit-tag-pdf")}
              </span>
            )}
            {article.isOpenAccess && (
              <span
                className={`${TAG_BASE} ${TAG_KIND.oa}`}
                title={getString("lit-tag-oa-tip")}
              >
                {getString("lit-tag-oa")}
              </span>
            )}
            {/* PMC 编号在库 = 有开放获取全文可拉（NCBI E-utilities）——
                形态借 QUARTILE_STYLE（白底发丝边蓝点）与 OA 蓝底区分 */}
            {article.pmcid && (
              <span
                className={`${TAG_BASE} ${QUARTILE_STYLE}`}
                title={getString("lit-tag-pmc-tip")}
              >
                <span aria-hidden="true" className={QUARTILE_DOT} />
                PMC
              </span>
            )}
            <span
              className={`${TAG_BASE} ${TAG_KIND.source} inline-flex items-center gap-[var(--space-1)]`}
              title={
                sourceLabelKey
                  ? getString("lit-source-tip", {
                      args: { source: getString(sourceLabelKey) },
                    })
                  : undefined
              }
            >
              <SourceLogo source={article.source} state="hit" size={12} />
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
          {/* 参考文献钻取（P0-2）：ghost 档与追踪/全文同列 */}
          {onCitations && article.doi && (
            <Button
              variant="ghost"
              size="sm"
              ariaLabel={getString("lit-references-btn")}
              onClick={() => onCitations(article, "references")}
            >
              {getString("lit-references-btn")}
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
          ) : article.inLibrary ? (
            /* 已在库（P0-3）：DOI 命中本地条目——防重复导入。展示徽标态
               而非可点按钮；title 说明为何不可导 */
            <span title={getString("lit-in-library-tip")}>
              <Badge tone="success">{getString("lit-in-library")}</Badge>
            </span>
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
