/**
 * ErrorBoundary — Catches React rendering errors to prevent blank pages.
 *
 * Displays the ErrorState panel placeholder with a retry button.
 * Used to wrap dashboard components that may receive unexpected data.
 *
 * @module react/components/ui/ErrorBoundary
 */

import React from "react";
import { getString } from "../../utils/locale";
import { ErrorState } from "./ErrorState";
import { safeDebug } from "../../../utils/logger";

interface Props {
  children: React.ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log to Zotero debug so caught crashes are not silently lost — without
    // this, a rendering crash is shown to the user but never recorded, making
    // reproduction impossible. componentStack identifies which subtree failed.
    try {
      safeDebug(`[z-search] ErrorBoundary caught: ${error.message}`);
      if (info?.componentStack) {
        safeDebug(
          `[z-search] ErrorBoundary componentStack: ${info.componentStack}`,
        );
      }
    } catch (e) {
      safeDebug("[z-search] " + e);
      // Zotero may be unavailable in test contexts — swallow.
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const message =
        this.props.fallbackMessage || getString("error-boundary-message");
      const detail = this.state.error?.message
        ? String(this.state.error.message)
        : "";
      // 面级错误占位收编 ErrorState 原语（2026-09-02 审计批）：
      // 原 fallback 手拼文案+outline 强改实心的 Retry 按钮退役，
      // 细节 error.message 走 desc 槽；flex-1 维持占满宿主面板的旧行为
      return (
        <ErrorState
          className="flex-1"
          message={message}
          desc={detail || undefined}
          onRetry={this.handleRetry}
          retryLabel={getString("btn-retry")}
        />
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
