// Patch Web Streams API globals before ai@7 loads (see ./polyfills/streams.ts for why
// this is a dedicated module and why we use the ponyfill entry, not /polyfill).
import "./polyfills/streams";
// Patch AbortController before any tool/pipeline code runs (the bootstrap
// loadSubScript scope has no Web platform APIs — see the module header).
import "./polyfills/abortController";
import Addon from "./addon";
import { config } from "../package.json";

// 无条件赋值：原 `if (!Zotero[config.addonInstance])` 守卫在「上次 shutdown
// 未清 Zotero.ZSearch」（升级/热重载竞态）时会跳过赋值 → onStartup 第一处
// 即炸。重载防重由 hooks.onStartup 的 initialized 再入闩承担。
_globalThis.addon = new Addon();
// @ts-expect-error - Zotero is a global in Zotero environment
Zotero[config.addonInstance] = _globalThis.addon;
