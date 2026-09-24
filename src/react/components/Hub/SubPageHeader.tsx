/**
 * SubPageHeader — 次级页页头法定件（IA 附法 §0 层级规则 2/5）。
 *
 * 构成（砚法法定件，各次级页不得自行拼装）：
 * - 返回上级钮：带容器，页头左缘第一位（btn-back 三语键 + ArrowLeftIconSvg）；
 * - 面包屑：`首页 › 主页面名 › 次级页面名`——根节点=首页永远可点（onSwitchFunc），
 *   主页面名可点返回上级视图，当前级 b 加重并 aria-current="page"；
 *   分隔符淡墨（--ink-clear 档）、层级越深越淡（砚法 ink-wash-breadcrumb 语义）。
 *
 * 审计 2026-09-20（砚法 Hub 逐页对照批）：此前 BrainOverview AnalysisSubPage /
 * CompletedResearchView / LearningPathView / LiteratureSearchPage 各自手写返回行，
 * 面包屑普遍缺根节点「首页」且分隔符无淡墨分层——收口为本共享件防逐页漂移。
 *
 * 2026-09-22 用户裁决：形式徽标 pill 同 PaneHeader 一并退役——原型归型批注
 * 不得进入生产界面（IA §0 结论只活在文档语境）。
 *
 * @module react/components/Hub/SubPageHeader
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { getString } from "../../utils/locale";
import { ArrowLeftIconSvg } from "../../utils/icons";
import { ICON } from "../../utils/iconSizes";

/** 淡墨分隔符（aria-hidden，读屏走 nav 语义不读符号）。 */
function CrumbSep(): React.ReactElement {
  return (
    <span aria-hidden="true" className="shrink-0 text-[color:var(--ink-clear)]">
      ›
    </span>
  );
}

export function SubPageHeader({
  parentLabel,
  currentLabel,
  onBack,
  onNavigateHome,
  actions,
}: {
  /** 主页面级名（如「深度研究」「学术脑」），可点=返回上级视图。 */
  parentLabel: string;
  /** 当前次级页名（加重呈现，aria-current="page"）。 */
  currentLabel: string;
  /** 返回上级视图（与「主页面名」点击同效）。 */
  onBack: () => void;
  /** 根节点「首页」点击（层级规则：根节点=首页永远可点，直达时面包屑仍成立）。 */
  onNavigateHome: () => void;
  /** 页头右缘动作区（快捷钮等，法定入口位）。 */
  actions?: React.ReactNode;
}): React.ReactElement {
  // 面包屑链接基类（整串内联：守卫 check-tsx-interaction-states 静态扫描
  // JSX className 字面量，插值常量会漏检 hover/focus-visible 交互态）。
  // 交互态（§8.2/§10.1）：hover 下划线 + focus-visible 交互蓝 1px 外描边。
  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        aria-label={getString("btn-back")}
      >
        <ArrowLeftIconSvg size={ICON.sm} />
        {getString("btn-back")}
      </Button>
      <nav
        aria-label={getString("aria-breadcrumb")}
        className="flex min-w-0 flex-wrap items-center gap-[var(--space-1)] [font:var(--ui-font-caption)]"
      >
        {/* 根节点=首页：永远可点（层级规则 2）。link 变体=无边框文字钮
            （check-ui-adoption 要求交互件走 ui/button 基件）。 */}
        <Button
          variant="link"
          size="sm"
          onClick={onNavigateHome}
          className="h-auto min-w-0 truncate border-0 bg-transparent px-[var(--space-0-5)] py-[var(--space-0-5)] text-left [font:var(--ui-font-caption)] text-[color:var(--accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--accent)]"
        >
          {getString("hub-tab-home")}
        </Button>
        <CrumbSep />
        <Button
          variant="link"
          size="sm"
          onClick={onBack}
          className="h-auto min-w-0 truncate border-0 bg-transparent px-[var(--space-0-5)] py-[var(--space-0-5)] text-left [font:var(--ui-font-caption)] text-[color:var(--ink-heavy)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--accent)]"
        >
          {parentLabel}
        </Button>
        <CrumbSep />
        <b
          aria-current="page"
          className="min-w-0 truncate font-semibold text-[color:var(--text-primary)]"
        >
          {currentLabel}
        </b>
      </nav>
      {/* 动作区占右缘（ml-auto）；缺省时不渲染空壳。 */}
      {actions ? (
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-[var(--space-2)]">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
