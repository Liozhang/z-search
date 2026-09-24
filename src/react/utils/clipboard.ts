import { safeDebug } from "../../utils/logger";
/**
 * clipboard — 跨环境剪贴板复制（纯函数实现）。
 *
 * 三级回退链：Zotero.Clipboard → navigator.clipboard → 隐藏 textarea。
 * useClipboard hook 与模块级调用点（openExternalLink 等）共用本实现，
 * 单一来源——此前 9 处组件直接裸调 navigator.clipboard，在 GCS/主窗口
 * 等非安全上下文会静默丢失 Zotero 回退（docs/component-audit-2026-08-14.md M-1）。
 *
 * @module react/utils/clipboard
 */

export async function copyText(text: string): Promise<boolean> {
  // Strategy 1: Zotero clipboard（宿主环境首选，绕过安全上下文限制）
  try {
    const zotero = (window as any).Zotero;
    if (zotero?.Clipboard?.copy) {
      zotero.Clipboard.copy(text);
      return true;
    }
  } catch (e) {
    safeDebug("[z-search] " + e);
    // Not in Zotero context
  }

  // Strategy 2: Navigator clipboard API
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    safeDebug("[z-search] " + e);
    // Clipboard API may fail in non-secure contexts
  }

  // Strategy 3: Hidden textarea fallback
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch (e) {
    safeDebug("[z-search] " + e);
    return false;
  }
}
