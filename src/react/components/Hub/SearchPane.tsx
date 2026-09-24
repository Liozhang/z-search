/**
 * SearchPane — Hub 搜索功能区，单页双视图（hub-redesign 基线形态）。
 *
 * 一个上置视图切换对钮切换两个 keep-alive 视图（砚法 §8.10 定式 2「视图切换
 * 对钮」：同一数据的陈列形态切换，图标对钮组，活动钮沉纸底+交互蓝图标；
 * 页签式 tab 已立法退役 §15-31——2026-08-26 的文字 seg（ToggleGroup）随
 * v1.20 改判对钮，2026-09-20 砚化批落地）：
 *
 *   - 文献（默认）: LiteratureSearchPage —— 一个输入框全域并联（库内语义
 *     + 外部数据库并行，DOI 去重后混合列表），引擎状态条逐路结算；
 *   - 期刊: JournalSearchDashboard —— 期刊对象域（指标/发现/我的库），
 *     自持输入行与三模式，不并入文献混合流。
 *
 * keep-alive（lazy mount + display 切换）保留两视图各自的检索结果/勾选/
 * 导入进度等本地 state（useKeepAlive 统一提供 mounted Set + effect）。
 */
import React, { useState } from "react";
import { getString } from "../../utils/locale";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import Button from "@/components/ui/button";
import { useKeepAlive } from "../../hooks/useKeepAlive";
import { KeepAliveSlot } from "./KeepAliveSlot";
import { LiteratureSearchPage } from "./search/LiteratureSearchPage";
import { JournalSearchDashboard } from "./search/JournalSearch/JournalSearchDashboard";
import { GridViewIconSvg, ListViewIconSvg } from "../../utils/icons";
import { ICON } from "../../utils/iconSizes";
import { PaneHeader } from "./PaneHeader";

type SearchPaneViewId = "literature" | "journal";

/** §8.10 定式 2：列表=文献混合流（行陈），矩阵=期刊对象域（卡陈）。
 *  labelKey 同时供 title 与 aria-label（§10.5 文字双通道，图标非唯一通道）。 */
const SEARCH_PANE_VIEWS: {
  id: SearchPaneViewId;
  labelKey: string;
  Icon: React.ComponentType<{ size?: number | string }>;
}[] = [
  {
    id: "literature",
    labelKey: "hub-search-seg-literature",
    Icon: ListViewIconSvg,
  },
  {
    id: "journal",
    labelKey: "hub-search-seg-journal",
    Icon: GridViewIconSvg,
  },
];

export function SearchPane({
  isActive = true,
}: {
  isActive?: boolean;
}): React.ReactElement {
  const [activeView, setActiveView] = useState<SearchPaneViewId>("literature");

  // keep-alive：子视图 lazy mount + display 切换，避免切换视图丢失状态
  // （文献页的混合结果/勾选/导入进度与期刊页的指标卡/列表均本地持有）。
  const { mounted } = useKeepAlive<SearchPaneViewId>(activeView);

  // slot: keep-alive wrapper. selfScroll=true —— 两视图均自带完整 scroll
  // 骨架（页级 flex column + 结果列表区滚动），slot 只负责显隐切换。
  const slot = (active: boolean, children: React.ReactNode) => (
    <KeepAliveSlot active={active} className="hub-search-slot is-self-scroll">
      {children}
    </KeepAliveSlot>
  );

  return (
    <ErrorBoundary>
      <div className="hub-search-pane">
        {/* 砚法 §8.0 页头法落地——页头置于视图 slot 之上（不随结果滚动）；
            pane 根自带 --page-inline-pad 轨，页头无需包裹层。
            2026-09-23 可用性审计 P1：视图切换对钮由独占行并入页头右缘动作区
            （§8.0 法定入口位），副语（hub-sub-search）退场——两行高度回收给
            结果区；副语那句功能摘要由初始空态文案承担（能力分流后仍在）。
            R14「切换器上置」约束仍成立：对钮仍在两视图之上、不随结果滚动。 */}
        <PaneHeader
          titleKey="hub-tab-search"
          actions={
            /* 视图切换对钮（砚法 §8.10 定式 2，§15-31 页签退役）：两枚 28px
               带容器图标钮（icon-sm=--ctl-h 28 档，ConceptsPane 卡/表对钮同款制式），
               active=沉纸底（--surface-zone）+交互蓝图标（--accent，§5.3 唯一
               选中语义色）；文案走 title+aria-label（§10.5 图标非唯一通道）。 */
            <div
              className="hub-search-seg hub-search-view-toggle"
              role="group"
              aria-label={getString("hub-search-page-title")}
            >
              {SEARCH_PANE_VIEWS.map((v) => (
                <Button
                  key={v.id}
                  variant="ghost"
                  size="icon-sm"
                  className={`hub-search-view-btn${
                    activeView === v.id ? " is-active" : ""
                  }`}
                  aria-pressed={activeView === v.id}
                  title={getString(v.labelKey)}
                  ariaLabel={getString(v.labelKey)}
                  onClick={() => setActiveView(v.id)}
                  icon={<v.Icon size={ICON.sm} />}
                />
              ))}
            </div>
          }
        />

        {/* View content — keep-alive（lazy mount + display 切换）保留各视图状态 */}
        {mounted.has("literature") &&
          slot(
            activeView === "literature",
            <LiteratureSearchPage isActive={isActive} />,
          )}
        {mounted.has("journal") &&
          slot(activeView === "journal", <JournalSearchDashboard />)}
      </div>
    </ErrorBoundary>
  );
}
