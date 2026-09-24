/**
 * Global declarations for Zotero plugin environment
 *
 * Zotero's XUL+HTML hybrid environment provides `document` and `window`
 * but they have different types depending on context (XUL vs HTML).
 * We declare them as `any` to avoid type conflicts.
 */

declare const document: any;
declare const window: any;
declare const navigator: any;

// Browser APIs (available in Zotero's HTML windows)
declare function requestAnimationFrame(callback: FrameRequestCallback): number;
declare function confirm(message: string): boolean;
declare function alert(message: string): void;

// XUL specific
declare const Components: any;

// Browser/DOM APIs (used in HTML contexts)
declare var DOMParser: any;
declare var requestAnimationFrame: any;
declare var confirm: any;
declare var alert: any;

// Zotero-specific globals (typed as any to avoid strict checking)
declare const ZoteroPane: any;
declare function parseSoulMarkdown(text: string): any;

// Third-party module declarations (no bundled types)
declare module 'pako' {
  export function inflate(data: Uint8Array, options?: { raw?: boolean }): Uint8Array;
  export function deflate(data: Uint8Array, options?: { level?: number }): Uint8Array;
}
