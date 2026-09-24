/*
 * shiki 子路径类型垫片（借鉴 ZCode 批 2026-09-07）。
 * shiki v4 只通过 package.json exports 暴露子路径（dist/*.d.mts），
 * 本仓 tsc 走 node10 解析读不到 exports —— 在这里给用到的子路径补
 * 最小类型声明。真实 API 见 node_modules/shiki/dist/*.d.mts；
 * 全部 shiki 访问收敛在 src/react/utils/codeHighlighter.ts。
 */

declare module "shiki/core" {
  export interface HighlighterCore {
    codeToHtml(code: string, options: Record<string, unknown>): string;
  }
  export interface HighlighterCoreOptions {
    themes: unknown[];
    langs: unknown[];
    engine: unknown;
  }
  export function createHighlighterCore(
    options: HighlighterCoreOptions,
  ): Promise<HighlighterCore>;
}

declare module "shiki/engine/javascript" {
  export interface JavaScriptRegexEngineOptions {
    forgiving?: boolean;
  }
  export function createJavaScriptRegexEngine(
    options?: JavaScriptRegexEngineOptions,
  ): unknown;
}

declare module "shiki/langs/*" {
  const langRegistration: unknown;
  export default langRegistration;
}

declare module "shiki/themes/*" {
  const themeRegistration: unknown;
  export default themeRegistration;
}
