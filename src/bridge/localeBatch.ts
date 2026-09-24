/**
 * Batch-resolve all locale keys via Fluent for Bridge locale.getAll handlers.
 *
 * Replaces per-window XXX_LOCALE_KEYS arrays. Reads the generated ALL_LOCALE_KEYS
 * list (derived at build time from typings/i10n.d.ts) so Bridges never miss a key.
 *
 * @module bridge/localeBatch
 */

import { config } from "../../package.json";
import { ALL_LOCALE_KEYS } from "../locale-keys.generated";

/**
 * Locale keys that are Fluent selectors (need a count arg to resolve to a
 * concrete string). When these are batch-resolved via locale.getAll without a
 * count arg, Fluent falls through to the `*[other]` branch with `$count`
 * rendered as empty — producing broken strings like " citations" or
 * "Export ()".
 *
 * 注册这里的 key 在 batch 预解析时注入一个**可识别占位符** `"{count}"`（而非
 * 真实数字），让 Fluent 选 `*[other]` 分支并把 `{$count}` 替换成字面量
 * `{count}`。这样快照里保留的是 `"{count} citations"`（带占位符），消费端
 * (react/utils/locale.ts getFromCache) 再用真实 count 做运行时替换。
 *
 * 旧实现注入 count=1 会把占位符烘焙成字面量 "1"，导致前端无法再用真实
 * 数字替换 —— iframe 下所有复数文案永远显示 "1"（如 "1 minute ago" /
 * "1 citations" / "Export (1)"），无论实际数量是多少。
 *
 * 占位符形态用 `{count}`（无 `$`）：前端 getFromCache 的正则
 * `/\{\s*\$?\s*count\s*\}/g` 中 `\$?` 可选，同时匹配 `{$count}` 与 `{count}`。
 */
const PLURAL_KEYS = new Set([
  // Real Fluent selectors ({$count -> ...})
  "time-minutes-ago",
  "time-hours-ago",
  "time-days-ago",
  "brain-export",
  "itemtree-items-count",
  "paper-graph-citations",
  "research-warnings-title",
  "research-warning-retracted",
  "research-warning-epistemic",
  "tracker-state-n-unread",
  "usage-calls-label",
  "usage-tokens-label",
  // Plain {$count} placeholders (保留占位符给运行时替换)
  "codeblock-show-all",
  "arg-badge-items",
  "arg-badge-more",
  "arg-badge-fields",
  "btn-show-more-results",
  "drop-item-count",
  "status-tokens",
]);

/**
 * Resolve every known locale key to its formatted value in the current locale.
 *
 * Fast path: 若主窗口 onStartup 已预热 cacheSnapshot，直接返回，避免每次重新
 * 加载 FTL + 解析 ~3068 个 key（这是各 dashboard 打开慢的根因之一）。
 *
 * @param pluralKeys - Keys that are Fluent selectors requiring a count arg.
 *   When provided, these keys are pre-resolved with count=1 so consumers
 *   receive a concrete string instead of a template placeholder.
 */
export function resolveAllLocaleKeys(
  pluralKeys: Set<string> = PLURAL_KEYS,
): Record<string, string> {
  // 通过 Zotero 全局获取 addon 实例（跨 realm 可靠）。
  // 不能用 _globalThis.addon：bridge 实例方法被 XPCNativeWrapper 跨 realm
  // 调用时，_globalThis 可能解析到子窗口 ctx 而非主窗口，读不到预热的 snapshot。
  // Zotero[addonInstance] 是 Zotero 全局对象属性，所有 chrome window 共享。
  const addonInstance =
    (Zotero as any)[config.addonInstance] ?? (_globalThis as any).addon;

  // Fast path: 返回预热的 snapshot（主窗口 onStartup 时构建）
  const snapshot = addonInstance?.data?.locale?.cacheSnapshot;
  if (snapshot) return snapshot;

  let loc = addonInstance?.data?.locale?.current;
  if (!loc) {
    // Child windows (brain, usage, research, etc.) no longer load leadero.js,
    // so addon is not in their global scope.  Fallback: create a standalone
    // Localization instance — Zotero.getGlobal("Localization") is always
    // available in chrome:// context.
    const Loc =
      typeof Localization !== "undefined"
        ? Localization
        : Zotero.getGlobal("Localization");
    loc = new Loc(
      [
        `${config.addonRef}-addon.ftl`,
        `${config.addonRef}-preferences.ftl`,
        // 2026-09-16 C-3 批：tracking.ftl（与 utils/locale.ts 的 initLocale 清单同步）
        `${config.addonRef}-tracking.ftl`,
      ],
      true,
    );
  }

  const ids = ALL_LOCALE_KEYS.map((k) => ({
    id: `${config.addonRef}-${k}`,
    // 注入可识别占位符 "{count}"（非数字 → Fluent 选 *[other] 分支，占位符保留
    // 为字面量 {count}）。前端 getFromCache 再用真实 count 替换。
    // 见 PLURAL_KEYS 注释说明为何不能用真实数字（会烘焙死占位符）。
    args: pluralKeys.has(k) ? { $count: "{count}" } : undefined,
  }));
  const msgs = loc.formatMessagesSync(ids);
  const map: Record<string, string> = {};
  for (let i = 0; i < ALL_LOCALE_KEYS.length; i++) {
    const msg = msgs?.[i];
    let value = msg?.value;
    if (!value && msg?.attributes) {
      // Attribute-only FTL messages (e.g. pref-*-placeholder =\n .placeholder = …)
      // have no value — fall back to the .placeholder attribute instead of the
      // bare key, mirroring getString()'s attribute fallback in utils/locale.ts.
      for (const attr of msg.attributes) {
        if (attr.name === "placeholder") {
          value = attr.value;
          break;
        }
      }
    }
    map[ALL_LOCALE_KEYS[i]] = value || ALL_LOCALE_KEYS[i];
  }
  // Cache the freshly built map so subsequent calls (and child windows reading
  // the same addon instance) hit the fast path — this replaces the synchronous
  // startup-time preload, deferring the 2290-key parse to first child-window use.
  try {
    if (addonInstance?.data?.locale) {
      addonInstance.data.locale.cacheSnapshot = map;
    }
  } catch {
    // Zotero integration: cross-realm write is best-effort
  }
  return map;
}
