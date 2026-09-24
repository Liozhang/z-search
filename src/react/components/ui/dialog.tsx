/**
 * dialog.tsx — shadcn/ui Dialog（官方 v4 形态，Base UI 底座）。
 *
 * 基于 @base-ui/react/dialog，flat 子组件导出（DialogContent / DialogClose）。
 * 类串对齐 v4.shadcn.com 注册表；官方 tw-animate-css 动画类翻译为 Base UI 的
 * data-starting/ending-style 过渡。Portal 经 useReuiPortal 注入 `.leadero-root`
 * 作用域（overlay 否则丢失令牌）。
 *
 * leadero 扩展（消费点 API 冻结）：
 *   - DialogContent: overlayClassName / showCloseButton / ariaLabel
 *   - DialogTitle 支持 Base UI render prop（ConfirmDialog 用 render={<h3/>}）
 *
 * Base UI 自带（modal=true）：focus trap + restore focus、scroll lock、
 * Escape 关闭、点击 Backdrop 关闭、完整 WAI-ARIA modal 模式。
 *
 * @module react/components/ui/dialog
 */

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useReuiPortal } from "@/components/ui/reui-portal";
import { getString } from "../../utils/locale";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  const portalContainer = useReuiPortal();
  // 解 ref 值：当 ref.current 为 null（Provider 未挂载/div 未 commit）时，
  // 不传 container，让 Base UI 回退到 document.body。
  // 传 RefObject 本身会导致 floating-ui 的 tabbable 扫描 getComputedStyle(null) 崩溃。
  return (
    <DialogPrimitive.Portal
      data-slot="dialog-portal"
      container={portalContainer?.current ?? undefined}
      {...props}
    />
  );
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // v1.73：遮罩单源——bg-black/50 硬编码改挂法定 token --overlay-bg
        // （D2 终裁 0.4，abolished-laws 无关；此前 50/40 两档遮罩并存）
        "fixed inset-0 z-modal bg-[var(--overlay-bg)] transition-opacity duration-200 motion-reduce:transition-none data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  overlayClassName,
  showCloseButton = true,
  ariaLabel,
  ...props
}: Omit<DialogPrimitive.Popup.Props, "title"> & {
  /** 覆盖层 className（透传到 Backdrop）。 */
  overlayClassName?: string;
  /** 是否显示右上角关闭按钮（默认 true）。 */
  showCloseButton?: boolean;
  /** aria-label（无可见标题时用于可访问名）。 */
  ariaLabel?: string;
}) {
  const dismissProxyRef = React.useRef<HTMLButtonElement | null>(null);
  // D3/SH-9（2026-09-11）：keep-alive 切 pane 时 portal 弹窗残留。shell 在
  // func 变化时广播 hub:dismiss-dialogs；在此处统一接听并程序化点击隐藏的
  // Close——走 Base UI Root 的 openChange 标准流程（受控/非受控、各消费点
  // 自带的 onClose 清理逻辑全部照常触发），一处修覆盖全部 Dialog 消费点，
  // 取代此前逐 Dialog 手补 4 行 listener 的方案（13 处仅 1 处接入）。
  React.useEffect(() => {
    const dismiss = () => dismissProxyRef.current?.click();
    window.addEventListener("hub:dismiss-dialogs", dismiss);
    return () => window.removeEventListener("hub:dismiss-dialogs", dismiss);
  }, []);

  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          /* v1.65 矩阵 ⑤（2026-08-25 裁决，原型 .dlg）：440 基线宽 + 80vh 上限 +
               head/body/foot 三区结构（分割线与内距由 DialogHeader/DialogBody/
               DialogFooter 承担，弹层本体无 padding）。CSS 类驱动的宽弹窗
               （palette 等）为 un-layered 规则，恒胜本层的宽度/内距工具类。 */
          /* 2026-09-07 用户拍板：表面 bg-background→bg-popover——暗色 0.147 与页面
               背景同值失浮起，对齐浮层家族（dropdown/Toast）；§6.1 bg-popover 行本就
               如此立法。浅色两值恒等白零变化。 */
          "fixed top-[50%] left-[50%] z-modal flex max-h-[80vh] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] flex-col overflow-y-auto rounded-[var(--card-radius)] border bg-popover shadow-[var(--shadow-md)] duration-200 outline-none",
          "transition-[opacity,transform] motion-reduce:transition-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
          "sm:max-w-[var(--form-dialog-width)]",
          className,
        )}
        aria-label={ariaLabel}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          ref={dismissProxyRef}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          data-dialog-dismiss-proxy=""
        />
        {showCloseButton && (
          // §1.5 ring 立法（2026-08-31 C5）：focus: 鼠标点击也出环且带 offset 老制双修——改 focus-visible 环单法 ring-[3px] ring-ring（button.tsx:26 范式）
          <DialogPrimitive.Close
            data-slot="dialog-close"
            // 2026-09-11 拥挤审计 P1：热区 16×16 → size-6（24×24，§1.11.2 下限；
            // 对照 toast 关闭钮 h-6 w-6），图标仍 16px 居中。占位 right/top 16→40px，
            // DialogHeader 基座以 pr-12 预留对应空间。
            className="absolute top-4 right-4 flex size-6 items-center justify-center rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{getString("ux3-misc-sr-close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        /* v1.65 矩阵 ⑤：head 区 12/18 内距 + 底分割线（原型 .dlg-head）。
           2026-09-11 拥挤审计 P1：pr-12 为右上角关闭钮（size-6，占位至 40px）
           预留 8px 净距——此前预留责任落在各消费点，全仓 6 处仅 ConfirmDialog
           传了 pr-10，长标题必压钮下；收进基座一处修。 */
        "flex flex-col gap-2 border-b border-border px-[var(--space-4-5)] pr-12 pt-[var(--space-3)] pb-[var(--space-3)] text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn(
        /* v1.65 矩阵 ⑤：body 区 2/18/12 内距 + 独立滚动（原型 .dlg-body） */
        "min-h-0 flex-1 overflow-y-auto px-[var(--space-4-5)] pt-[var(--space-0-5)] pb-[var(--space-3)]",
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        /* v1.65 矩阵 ⑤：foot 区 10/18 内距 + 顶分割线（原型 .dlg-foot） */
        "mt-auto flex flex-col-reverse gap-2 border-t border-border px-[var(--space-4-5)] py-[var(--space-2-5)] sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      /* 2026-09-11 拥挤审计：leading-none 折两行时行间零空隙（CJK 长标题必现），
         放宽到 leading-tight。 */
      className={cn("text-lg leading-tight font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
