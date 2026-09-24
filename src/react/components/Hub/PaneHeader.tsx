/**
 * PaneHeader — Hub 顶层功能区页头法定件（砚法 §8.0 页头法）。
 *
 * 法定构成（§8.0 页头法：标题+副语+动作区+下发丝线）：
 * - h1 页名：--ui-font-title 焦墨，字号 --text-lg 档；
 * - 副语：caption / tertiary 档（hub-sub-* 三语键，一句功能摘要）；
 * - 右缘动作区（ml-auto，法定入口位）；
 * - 底部发丝线（border-b --line-faint）。
 *
 * 2026-09-22 用户裁决：形式徽标 pill（「形式⑥ · 搜索陈列」制式）全面退役——
 * 该批注系原型文档的归型示意（供评审对照 IA §0 形式集），非产品信息，
 * 生产界面不得呈现。IA §0 的归型结论只活在文档与评审语境。
 *
 * 横向无内距：各 pane 滚动结构不同（1440 轨 / 全幅壳 / 贴边侧栏三态），对齐
 * 轨由消费方包裹层承担（消费 --page-inline-pad / --page-content-padding 同源
 * 令牌），本件不锁死——防双轨叠加（graph/search 等 pane 根已自带 inline-pad）。
 * 页头由消费方置于 pane 自带滚动容器之上（§8.0：页头不随内容滚走）。
 *
 * @module react/components/Hub/PaneHeader
 */

import React from "react";
import { getString } from "../../utils/locale";

export function PaneHeader({
  titleKey,
  subtitleKey,
  actions,
}: {
  /** 页名 FTL 键（与侧栏导航同源，如 hub-tab-home / brain-nav-concepts）。 */
  titleKey: string;
  /** 副语 FTL 键（hub-sub-*；一句 8-16 字功能摘要，三语）。 */
  subtitleKey?: string;
  /** 页头右缘动作区（法定入口位；本轮仅设置页分区搜索框接线）。 */
  actions?: React.ReactNode;
}): React.ReactElement {
  return (
    <header className="flex flex-wrap items-center gap-[var(--space-3)] border-b border-[color:var(--line-faint)] pb-[var(--space-3)] pt-[var(--space-5)]">
      <div className="flex min-w-0 flex-col gap-[var(--space-0-5)]">
        {/* h1 字号：--ui-font-title 是含字号的 font 简写令牌，text-lg 档经
            style 直给——Tailwind 任意值工具与 font 简写的发射序不保证先后，
            内联声明必胜（值取令牌，非硬编码 px）。 */}
        <h1
          className="[font:var(--ui-font-title)] text-[color:var(--ink-scorch)]"
          style={{ fontSize: "var(--text-lg)" }}
        >
          {getString(titleKey)}
        </h1>
        {subtitleKey ? (
          <p className="[font:var(--ui-font-caption)] text-[color:var(--text-tertiary)]">
            {getString(subtitleKey)}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-[var(--space-2)]">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
