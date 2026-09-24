/**
 * SectionHeader — settings section 统一页头。
 *
 * 收敛此前 30 处 `<header class="hub-settings-view-header"><h2 …/></header>`
 * + 可选 `<p class="hub-settings-view-desc">` 的惯例重复 markup
 * （docs/component-audit-2026-08-14.md M-2）。视觉零变化——同一组类名，
 * 只是单一来源。
 *
 * children = header 内 h2 之后的尾部元素（操作按钮 / Badge）。
 *
 * @module react/components/Hub/settings/SectionHeader
 */
import React from "react";
import { cn } from "@/lib/utils";

export function SettingsSectionHeader({
  title,
  desc,
  children,
  className,
}: {
  /** h2 标题内容。 */
  title: React.ReactNode;
  /** 可选描述段（渲染为 header 的兄弟 p.hub-settings-view-desc）。 */
  desc?: React.ReactNode;
  /** header 内 h2 之后的尾部元素（如重置/删除按钮、统计 Badge）。 */
  children?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className="hub-settings-view-header-wrapper">
      <header className={cn("hub-settings-view-header", className)}>
        <h2 className="hub-settings-view-title">{title}</h2>
        {children}
      </header>
      {desc !== undefined && desc !== null && (
        <p className="hub-settings-view-desc">{desc}</p>
      )}
    </div>
  );
}
