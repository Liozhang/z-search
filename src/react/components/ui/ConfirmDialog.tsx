/**
 * ConfirmDialog — 公用确认弹窗（modal overlay），命令式 API。
 *
 * 替代 window.confirm / Services.prompt（在 chat iframe 内焦点割裂、风格不一致）。
 * 基于 Base UI Dialog（经 leadero 封装，portal 到 .leadero-root 内），
 * 复用现有 .leadero-dialog-overlay / .leadero-dialog CSS。
 *
 * 用法：
 *   // 1. 树顶挂 Provider（index.tsx，包住所有 dashboard）
 *   <ConfirmProvider><App /></ConfirmProvider>
 *
 *   // 2. 任意组件调用
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: '删除任务', message: '确定删除？', danger: true });
 *   if (ok) doDelete();
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import Button from "./button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { getString } from "../../utils/locale";

export interface ConfirmOptions {
  /** 弹窗标题（可选，无则不渲染 h3） */
  title?: string;
  /** 正文消息 */
  message: string;
  /** 确认按钮文字 */
  confirmLabel?: string;
  /** 取消按钮文字 */
  cancelLabel?: string;
  /** danger=true 时确认按钮用红色实心（删除/破坏性操作） */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * 获取 confirm 函数。必须在 <ConfirmProvider> 内使用。
 * @returns confirm(opts) => Promise<boolean>，true=用户确认，false=取消
 */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return fn;
}

interface PendingConfirm {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

/**
 * Provider：挂 React 树顶，提供 confirm 函数 + 渲染 modal 容器。
 * 同一时间只显示一个确认弹窗（后调用的等前一个 resolve）。
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ opts, resolve });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    setPending((p) => {
      if (p) p.resolve(ok);
      return null;
    });
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmDialog
          open
          title={pending.opts.title}
          message={pending.opts.message}
          confirmLabel={pending.opts.confirmLabel}
          cancelLabel={pending.opts.cancelLabel}
          danger={pending.opts.danger}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 声明式 modal 组件（可直接用，也可通过 useConfirm 命令式调用）。
 * 基于 Base UI Dialog（经 baseui/Dialog 封装）。
 *
 * Base UI 自带：focus trap、restore focus、scroll lock、Escape 关闭、
 * 点击 overlay/外部关闭。无需手写 useDialogFocus / keydown / click 处理。
 * 复用 .leadero-dialog-overlay / .leadero-dialog CSS（视觉零变化）。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement | null {
  // onOpenChange：open=true→false 时（Escape / 点击外部 / 点击 Close）触发 onCancel。
  // open=false→true 不应发生（受控，open 由上层 pending 状态驱动）。
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) onCancel();
    },
    [onCancel],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        // 2026-09-02 值级批：删 sm:max-w-[424px]——424 系八档进一误登（原 420）；
        // 回落 dialog 基座 --form-dialog-width 440（=原型 :496 .dlg min(440px,92vw) 全族单源）
        className="leadero-confirm-dialog w-full gap-0 p-0"
        ariaLabel={title || message}
      >
        {title && (
          // 2026-08-31 C5：删 text-sm override，回落 dialog 基座 text-lg 16px（=原型 .dlg-title）
          // head 收编 DialogHeader 原语（18px 横距制）；关闭钮热区扩到 size-6 后预留
          // pr-10→pr-12 同步（2026-09-11 拥挤审计；预留已收进 DialogHeader 基座）
          <DialogHeader className="pr-12">
            <DialogTitle render={<h3 />}>{title}</DialogTitle>
          </DialogHeader>
        )}
        <DialogBody>
          <p className="text-[length:var(--text-sm)] text-[color:var(--text-secondary)]">
            {message}
          </p>
        </DialogBody>
        {/* 2026-08-31 C5：foot 按钮 default(32px)→sm(28px)，对齐原型 .dlg-confirm foot btn-sm（redesign-prototype.html:3254） */}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel || getString("common-cancel")}
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel || getString("common-confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmDialog;
