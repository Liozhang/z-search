/**
 * ErrorState.tsx — 错误占位统一组件（spec §21.2：状态占位三件套之一）。
 *
 * 面级/区级错误占位（居中形态，与 EmptyState/LoadingState 同族）；
 * 行内错误横幅用 ErrorBanner（§10.2），两者不混用。
 * 扁平约束（§19.1）：单一分离机制——虚线边框，零投影零背景差。
 *
 * @module react/components/ui/ErrorState
 */

import * as React from "react";
import { CircleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

interface ErrorStateProps {
  /** 错误主文案（locale 解析后的字符串） */
  message: string;
  /** 错误补充说明（可选） */
  desc?: string;
  /** If provided, renders a Retry button calling this handler */
  onRetry?: () => void;
  /** 重试按钮文案（默认 locale btn-retry 由消费端传，保持组件 locale 无关） */
  retryLabel?: string;
  /** Additional className for the wrapper div */
  className?: string;
}

function ErrorState({
  message,
  desc,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps): React.ReactElement {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-destructive/40 bg-card/50 p-8 py-12 text-center",
        className,
      )}
    >
      <CircleAlertIcon
        aria-hidden="true"
        className="size-10 shrink-0 text-destructive"
      />
      <div className="text-sm font-medium text-foreground">{message}</div>
      {desc && (
        <div className="max-w-sm text-sm text-muted-foreground">{desc}</div>
      )}
      {onRetry && retryLabel && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export { ErrorState };
export default ErrorState;
