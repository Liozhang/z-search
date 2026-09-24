/**
 * LoadingState.tsx — 加载占位统一组件（spec §21.2：状态占位三件套之一）。
 *
 * 区级 = EmptyState busy + GlobeSpinner 22（原型 .globe · 图谱/首页加载家族）；
 * inline = Spinner 16（OrbitRings 视觉）。具名单一来源（§15.6 SectionLoading 同源收编）。
 * 消费点禁止再手写 spinner/骨架 div 作加载占位。
 *
 * 两种形态：
 *   默认     = 区级占位（居中、虚线卡、py-12）——页面/面板无内容时
 *   `inline` = 紧凑行（Spinner + 文案、左对齐、无卡壳）——密集列表/工具行语境
 *              （§21.3：信息密集区不使用呼吸留白）
 *
 * @module react/components/ui/LoadingState
 */

import * as React from "react";

import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { GlobeSpinner } from "./GlobeSpinner";
import { Spinner } from "./Spinner";

interface LoadingStateProps {
  /** 加载文案（locale key 解析后的字符串；不传则纯 spinner） */
  title?: React.ReactNode;
  /** 紧凑行形态（密集列表语境），默认为区级居中占位 */
  inline?: boolean;
  /** 追加到容器的类 */
  className?: string;
  /** 自定义图标（默认：区级 = GlobeSpinner 22（原型 .globe · 36s 慢转）；
   *  inline = Spinner 16（OrbitRings 视觉），对齐 §15.6 收敛后的尺寸档） */
  icon?: React.ReactNode;
}

function LoadingState({
  title,
  inline = false,
  className,
  icon,
}: LoadingStateProps): React.ReactElement {
  const defaultIcon = inline ? (
    <Spinner size={16} />
  ) : (
    <GlobeSpinner size={22} />
  );
  if (inline) {
    return (
      <div
        data-slot="loading-state"
        role="status"
        aria-busy="true"
        className={cn(
          "flex items-center gap-[var(--space-2)] py-[var(--space-2-5)] text-[color:var(--text-tertiary)]",
          className,
        )}
      >
        {icon ?? defaultIcon}
        {title && <span>{title}</span>}
      </div>
    );
  }
  return (
    <EmptyState
      busy
      icon={icon ?? defaultIcon}
      title={title}
      className={cn("py-12", className)}
    />
  );
}

export { LoadingState };
export default LoadingState;
