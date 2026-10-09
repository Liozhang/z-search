/**
 * Badge shell recipes shared by the literature result card and the journal
 * list row (2026-10-09 用户裁决：期刊行并入文献行徽章语法，配方自
 * LiteratureResultCard 上提至此单源，两处不得再各自漂移）。
 *
 * @module react/components/Hub/search/badgeRecipes
 */

/* lit-tag 配方（原 zsearch-literature-search.css 全量迁移，文件已删除）：
   基底 + 语义色 kind。2026-08-31 C3：Q 徽标分区色阶梯（Q1 最深→Q4 最浅）退役，
   回原型 .q 徽标（:635-636）——见 QUARTILE_STYLE。 */
export const TAG_BASE =
  "text-[length:var(--text-2xs)] py-px px-[var(--space-1-5)] rounded-[var(--radius-xs)] font-medium uppercase tracking-[var(--tracking-wide)]";
export const TAG_KIND: Record<string, string> = {
  warning: "bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)]",
  /* 与 warning 同配方（同为风险信号，label 文字区分语义）——掠夺性
     （Beall's 名单精确命中），tooltip 披露名单截止时间。 */
  predatory: "bg-[var(--signal-red-bg)] text-[color:var(--signal-red-strong)]",
  top: "bg-[var(--signal-yellow-bg)] text-[color:var(--signal-yellow-text)]",
  pdf: "bg-[var(--signal-green-bg)] text-[color:var(--signal-green-dark)]",
  oa: "bg-[var(--data-blue-bg)] text-[color:var(--data-blue-dark)]",
  source: "bg-[var(--border-strong)] text-[color:var(--text-secondary)]",
};
/* 2026-08-31 C3：Q1-Q4 同形态不分级（原型 .q :635-636）——
   白底（bg-background）+ 1px 发丝边 var(--border) + 蓝字 --data-blue-dark；
   radius 归 TAG_BASE（--radius-xs）；前置 4px 蓝点在 JSX 内以 span 供给
   （4px 取 --space-1 同值）。 */
export const QUARTILE_STYLE =
  "inline-flex items-center gap-[var(--space-1)] bg-background border border-[color:var(--border)] text-[color:var(--data-blue-dark)]";
/* 原型 .q::before 4px 蓝点（--data-blue；--space-1=4px 同值） */
export const QUARTILE_DOT =
  "lit-quartile-dot w-[var(--space-1)] h-[var(--space-1)] rounded-full bg-[var(--data-blue)] flex-shrink-0";
