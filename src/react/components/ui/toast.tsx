/**
 * Toast.tsx — Base UI Toast（保留 leadero useToast API）。
 *
 * 基于 @base-ui/react/toast，对外保持 leadero 原 useToast() API 不变
 * （show/success/error/info/warning），消费端零改动。内部用 Base UI
 * Toast.Provider + useToastManager + Viewport（portal 到 .leadero-root 内）。
 *
 * 视觉用 Tailwind 工具类（圆角 --card-radius 6px + 左色条 border-l-4，cn-toast 已退役）。
 *
 * 行为增强（Base UI 自带）：
 *   - aria-live region（priority=low → polite，high → assertive）
 *   - 自动堆叠 + 限制（limit=5，超出最旧的淡出）
 *   - 滑动手势关闭（移动端）
 *
 * 用法：
 *   // index.tsx 已挂 <ToastProvider>，消费端：
 *   const toast = useToast();
 *   toast.success('已复制');
 *   toast.error('失败', undefined, { label: '重试', onClick: retry }); // 或传显式时长+理由
 *
 * @module react/components/ui/toast
 */

import React, { createContext, useContext, useMemo, useRef } from "react";
import { Toast as BaseToast } from "@base-ui/react/toast";
import { cn } from "@/lib/utils";
import { useReuiPortal } from "@/components/ui/reui-portal";
import { XIcon } from "lucide-react";
import { ICON } from "../../utils/iconSizes";
import { getString } from "../../utils/locale";

// useToastManager 在顶层是 type-only 导出，值导出在 Toast namespace 内。
const useToastManager = BaseToast.useToastManager;

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  tone?: ToastTone;
  message: string;
  /** Auto-dismiss ms. Default: success/info=3000, error/warning=4000（单源见 DEFAULT_DURATION）. 0=no auto-dismiss. */
  duration?: number;
  /** Optional action button (e.g. Retry). */
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastApi {
  show: (opts: ToastOptions) => void;
  success: (message: string, duration?: number) => void;
  error: (
    message: string,
    duration?: number,
    action?: ToastOptions["action"],
  ) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Get the toast API. Must be used within <ToastProvider>. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used within <ToastProvider>");
  return api;
}

// D3（2026-09-17）：toast 时长单源。事实法=success/info 3000、error/warning 4000
// （全仓 16 处 error 显式 4000 / 4 处 success 显式 3000 对齐后收敛于此），
// 调用点不再散写裸毫秒；个别确需更长/驻留的调用点显式传值并注释理由。
const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 3000,
  info: 3000,
  warning: 4000,
  error: 4000,
};

/**
 * 同消息去重窗口（2026-09-07）：直调 toast.error 的路径（图谱 relationship
 * 层网关等）无自带去重，曾 2s 内堆叠 8 个同文错误（open-loops P2）。窗口内
 * 同消息只弹首条；useErrorToast 自带的去重不受影响。
 */
const DEDUP_WINDOW_MS = 2000;

/**
 * ToastProvider —— 挂 React 树顶，渲染 Base UI Toast Provider + Viewport，
 * 暴露 leadero 风格的 useToast() API。
 *
 * Viewport portal 到 .leadero-root 内的 portal-layer（与其他浮层一致），
 * 视觉样式全量使用 Tailwind 工具类，无专用 .leadero-toast* CSS。
 */
export function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const portalContainer = useReuiPortal();
  // useToastManager 必须在 Toast.Provider 子树内调用，故拆出内部组件。
  return (
    <BaseToast.Provider timeout={3000} limit={5}>
      <ToastViewport portalContainer={portalContainer} />
      <ToastApiBridge>{children}</ToastApiBridge>
    </BaseToast.Provider>
  );
}

/**
 * ToastApiBridge —— 在 Toast.Provider 内部调用 useToastManager，把 Base UI 的
 * add/close 适配为 leadero 的 show/success/error/info/warning API，注入 Context。
 */
function ToastApiBridge({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const { add } = useToastManager();
  const lastShownAtRef = useRef(new Map<string, number>());

  const api = useMemo<ToastApi>(() => {
    const show = (opts: ToastOptions) => {
      const tone = opts.tone ?? "info";
      const timeout = opts.duration ?? DEFAULT_DURATION[tone];
      // 窗口内同消息丢弃重复；表超限时顺手清掉已出窗的旧条目
      const shownAt = lastShownAtRef.current;
      const now = Date.now();
      const last = shownAt.get(opts.message);
      if (last !== undefined && now - last < DEDUP_WINDOW_MS) return;
      shownAt.set(opts.message, now);
      if (shownAt.size > 64) {
        for (const [msg, at] of shownAt) {
          if (now - at >= DEDUP_WINDOW_MS) shownAt.delete(msg);
        }
      }
      // 2026-09-07 尺寸审计：存在未截断插值家族（裸 String(e)/r.error 灌入，~8 文件），
      // 后端异常带长 payload 时 toast 高度失控；通道级单点截断护住全部 203 调用点，
      // 全文细节归 ErrorState/内联错误行（§24.3 反馈通道立法）。120 = 调用点既有 slice 惯例值。
      const title =
        opts.message.length > 120
          ? opts.message.slice(0, 119) + "…"
          : opts.message;
      add({
        title,
        type: tone,
        timeout,
        // error 用高优先级（读屏紧急播报）
        priority: tone === "error" ? "high" : "low",
        actionProps: opts.action
          ? {
              onClick: opts.action.onClick,
              children: opts.action.label,
            }
          : undefined,
      });
    };
    return {
      show,
      success: (message, duration) =>
        show({ tone: "success", message, duration }),
      error: (message, duration, action) =>
        show({ tone: "error", message, duration, action }),
      info: (message, duration) => show({ tone: "info", message, duration }),
      warning: (message, duration) =>
        show({ tone: "warning", message, duration }),
    };
  }, [add]);

  return <ToastContext.Provider value={api}>{children}</ToastContext.Provider>;
}

/**
 * ToastViewport —— 渲染 Toast 容器（portal 到 portal-layer）。
 * 遍历 toasts，每个用 Base UI Toast.Root/Content 渲染，样式全量 Tailwind 工具类。
 *
 * portalContainer 可能为 null（useReuiPortal 无 Provider 时回退），此时 Base UI
 * Portal 回退到 document.body。
 */
function ToastViewport({
  portalContainer,
}: {
  portalContainer: React.RefObject<HTMLElement | null> | null;
}): React.ReactElement {
  const { toasts } = useToastManager();
  return (
    <BaseToast.Portal container={portalContainer?.current ?? undefined}>
      <BaseToast.Viewport
        /* 2026-09-04 content-box 审计：w-full+p-4 在窄容器（<sm 断点，如聊天侧栏）
           右锚定向左溢 32px 被窗缘裁；box-border 归位 */
        className="fixed bottom-0 right-0 z-topmost flex max-h-screen box-border w-full flex-col-reverse gap-2 p-4 sm:max-w-[344px]"
        role="region"
        aria-label={getString("toast-viewport-label")}
      >
        {toasts.map((t) => (
          <BaseToast.Root
            key={t.id}
            toast={t}
            className={cn(
              // 2026-09-07 样式审计：表面 bg-background 暗色=0.147 与页面背景同值，浮起感只剩边框；
              // bg-popover 对齐浮层家族（dropdown/combobox/select 全 bg-popover）+ §11.2 立法
              // + §3 L2（--card-bg 暗色=popover 同值 0.216）。
              // 2026-09-07 布局审计：box-border——Root 自身 content-box，w-full+p-4+border-l-4
              // 越出 Viewport 右缘 5px 被 fixed 窗缘静默裁（viewport 修件的子级残留）。
              "pointer-events-auto box-border rounded-[var(--card-radius)] flex w-full items-center justify-between gap-[var(--space-2-5)] border border-border bg-popover p-4 text-foreground shadow-[var(--shadow-pop)]",
              // 2026-08-31 C5：Base UI Toast 无自带动画，镜像 dialog.tsx:95 / tooltip.tsx:83-84 的
              // data-starting/ending-style 过渡范式补进出动画（原型 .toast animation toast-in .18s，redesign-prototype.html:414）。
              "transition-all motion-reduce:transition-none",
              "data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0",
              "data-[ending-style]:translate-y-2 data-[ending-style]:opacity-0",
              t.type === "success" && "border-l-4 border-l-success",
              t.type === "error" && "border-l-4 border-l-destructive",
              t.type === "warning" && "border-l-4 border-l-warning",
              t.type === "info" && "border-l-4 border-l-info",
            )}
          >
            {/* 2026-09-07 样式审计：error 详情常内嵌 120 字符级无空格长串（URL/路径/token），
                flex 子项默认 min-width:auto 不收缩，会把 Action/Close 顶出 344px 盒（静默溢出族） */}
            <BaseToast.Title className="min-w-0 break-words text-[length:var(--text-control)]" />
            {t.actionProps && (
              <BaseToast.Action
                {...t.actionProps}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-transparent px-3 text-[length:var(--text-control)] font-medium outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
              />
            )}
            <BaseToast.Close
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground/60 outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
              aria-label={getString("common-close")}
            >
              <XIcon size={ICON.base} />
            </BaseToast.Close>
          </BaseToast.Root>
        ))}
      </BaseToast.Viewport>
    </BaseToast.Portal>
  );
}

export default ToastProvider;
