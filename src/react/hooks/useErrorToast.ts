/**
 * useErrorToast — 错误统一 toast 化（2026-09-01 用户裁决：ErrorBanner 二段迁移）。
 *
 * 文献页范式收编为共享 hook：同一错误串只弹一次（ref 去重），错误清除后可重弹；
 * 传入 retry 时在 toast 上挂「重试」按钮（点击先清去重标记再执行，失败重现可再弹）。
 * duration 0 = 不自动消失（错误需用户处置）。
 *
 * @module react/hooks/useErrorToast
 */
import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { getString } from "../utils/locale";

export function useErrorToast(error: string | null, retry?: () => void): void {
  const toast = useToast();
  const notifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!error) {
      notifiedRef.current = null;
      return;
    }
    if (notifiedRef.current === error) return;
    notifiedRef.current = error;
    toast.error(
      error,
      0,
      retry
        ? {
            label: getString("btn-retry"),
            onClick: () => {
              notifiedRef.current = null;
              retry();
            },
          }
        : undefined,
    );
  }, [error, retry, toast]);
}
