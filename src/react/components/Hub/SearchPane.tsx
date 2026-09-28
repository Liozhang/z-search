/**
 * SearchPane — Hub 搜索功能区，单页三段 tab（hub-redesign 基线形态）。
 *
 * 页下首行三段 tab 切换搜索域（2026-09-28 用户裁决）：
 *
 *   - 网络搜索（默认）: LiteratureSearchPage scope=web —— 外部数据库并行
 *     检索，DOI 去重混合列表，引擎状态条逐路结算；
 *   - 本地搜索: LiteratureSearchPage scope=local —— 库内语义检索 + 找相似/
 *     查重锚点工具；
 *   - 期刊: JournalSearchDashboard —— 期刊对象域（指标/发现/我的库），
 *     自持检索模式 seg 与输入行，不并入文献混合流。
 *
 * 前史：域切换原由页头右缘「文献/期刊」图标对钮承担（砚法 §8.10 定式 2，
 * 2026-09-23 并入页头），2026-09-28 用户裁决退役——列表/网格图标在惯例中
 * 读作「同一内容的陈列形态切换」，与实际「跨功能域跳转」冲突，被误读为
 * 列表/卡片转换。域切换并入 tab 行后，图标对钮在本 pane 不再有「同一数据
 * 双陈列」的合法用例；原 §15-31「页签退役」改判由本三段 tab 承接（R14
 * 「切换器上置」不变：tab 行仍在两视图之上、不随结果滚动）。
 *
 * keep-alive（lazy mount + display 切换）保留两视图各自的检索结果/勾选/
 * 导入进度等本地 state（useKeepAlive 统一提供 mounted Set + effect）。
 */
import React, { useEffect, useRef, useState } from "react";
import { getString } from "../../utils/locale";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useKeepAlive } from "../../hooks/useKeepAlive";
import { KeepAliveSlot } from "./KeepAliveSlot";
import {
  LiteratureSearchPage,
  type SearchScope,
} from "./search/LiteratureSearchPage";
import { JournalSearchDashboard } from "./search/JournalSearch/JournalSearchDashboard";
import { PaneHeader } from "./PaneHeader";

/** 三段 tab：web/local 两段同落 LiteratureSearchPage（scope 受控），
 *  journal 独占 JournalSearchDashboard。 */
type SearchTab = "web" | "local" | "journal";

/** keep-alive 仍按视图粒度（两槽）：web/local 同属文献视图，互切不换槽。 */
type SearchPaneViewId = "literature" | "journal";

const SEARCH_TABS: ReadonlyArray<{ id: SearchTab; labelKey: string }> = [
  { id: "web", labelKey: "hub-search-tab-web" },
  { id: "local", labelKey: "hub-search-tab-local" },
  { id: "journal", labelKey: "hub-search-seg-journal" },
];

export function SearchPane({
  isActive = true,
}: {
  isActive?: boolean;
}): React.ReactElement {
  const [activeTab, setActiveTab] = useState<SearchTab>("web");
  // 文献腿自己的 scope：进期刊 tab 时挂起（视图隐藏但 keep-alive），回文献
  // 时原样恢复——切去看期刊再回来，不该丢用户停驻的 网络/本地 腿。
  const [litScope, setLitScope] = useState<SearchScope>("web");

  // 右键菜单「查找相似文献」深链（zsearch:find-similar，SearchShell 派发）：
  // 文献页自身的监听只挂 similar 结果视图——停留在期刊视图时窗前置后界面
  // 无可见变化（README 承诺「直达找相似」落空）。pane 级 tab 必须联动切回
  // 本地（切换经由 switchTab，scope 随之对齐）。
  useEffect(() => {
    const onFindSimilar = () => switchTab("local");
    window.addEventListener("zsearch:find-similar", onFindSimilar);
    return () =>
      window.removeEventListener("zsearch:find-similar", onFindSimilar);
  }, []);

  // tab 即域：web/local 点击即改文献腿 scope；期刊只换视图不动文献腿。
  // 文献页的程序化写回（深链切本地/navigateHome 回网络）走 changeLitScope，
  // tab 行高亮随真实 scope 走，避免两处状态各说各话。
  const switchTab = (tab: SearchTab) => {
    setActiveTab(tab);
    if (tab !== "journal") setLitScope(tab);
  };
  const changeLitScope = (scope: SearchScope) => {
    setLitScope(scope);
    setActiveTab(scope);
  };

  // keep-alive 切视图时广播关闭 portal 弹窗（dialog.tsx D3/SH-9 接听）：
  // 隐藏视图的筛选/引文等 Dialog 是 portal 挂载，不随 display:none 消失，
  // 此前广播端从未实现，切回时会残留。web/local 互切同视图不广播——
  // 与原页内 tab 行为一致（弹层开着时 tab 本就不可达）。
  const activeView: SearchPaneViewId =
    activeTab === "journal" ? "journal" : "literature";
  const prevViewRef = useRef(activeView);
  useEffect(() => {
    if (prevViewRef.current !== activeView) {
      prevViewRef.current = activeView;
      window.dispatchEvent(new CustomEvent("hub:dismiss-dialogs"));
    }
  }, [activeView]);

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
            2026-09-28 起 actions 撤空：右缘图标对钮退役，域切换下行到页下
            首行三段 tab（缘由见模块头注）。 */}
        <PaneHeader titleKey="hub-tab-search" />

        {/* ═══ 域 tab 行：网络/本地/期刊（2026-09-28 三段化）═══
            pane 级唯一域切换器，页头之下、视图之上（R14 上置不变）。默认
            白片 seg 制式，与期刊页检索模式 seg 同款；单选清空 no-op 防御
            同款。顶距沿用原文献页 tab 行的 --space-6 节奏。 */}
        <div className="shrink-0 pt-[var(--space-6)]">
          <ToggleGroup
            multiple={false}
            className="self-start"
            value={[activeTab]}
            onValueChange={(v) => {
              if (!v.length) return;
              switchTab(v[0] as SearchTab);
            }}
            aria-label={getString("hub-search-tab-label")}
          >
            {SEARCH_TABS.map((t) => (
              <ToggleGroupItem key={t.id} value={t.id}>
                {getString(t.labelKey)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {/* View content — keep-alive（lazy mount + display 切换）保留各视图状态 */}
        {mounted.has("literature") &&
          slot(
            activeView === "literature",
            <LiteratureSearchPage
              isActive={isActive}
              scope={activeTab === "journal" ? litScope : activeTab}
              onScopeChange={changeLitScope}
            />,
          )}
        {mounted.has("journal") &&
          slot(activeView === "journal", <JournalSearchDashboard />)}
      </div>
    </ErrorBoundary>
  );
}
