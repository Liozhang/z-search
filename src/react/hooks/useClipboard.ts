/**
 * Cross-environment clipboard hook.
 * 三级回退链（Zotero.Clipboard → navigator.clipboard → textarea）实现在
 * utils/clipboard.ts 的纯函数 copyText 中；本 hook 仅提供组件内惯用包装。
 */

import { useCallback } from "react";
import { copyText } from "../utils/clipboard";

export function useClipboard() {
  const copy = useCallback((text: string): Promise<boolean> => {
    return copyText(text);
  }, []);

  return { copy };
}
