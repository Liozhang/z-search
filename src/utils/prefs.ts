import { config } from "../../package.json";
import { warn as logWarn } from "./logger";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;

/**
 * 敏感 pref 键（安全批 S-02，2026-09-10）：这些键决定「写操作是否需要用户
 * 批准」以及「任意代码执行是否开启」。
 *
 * **闸门才是防线，本条只是留痕**（2026-09-11 核实批修正措辞）：原注释断言
 * 「根因已由 bridge 来源闸门关闭」——但那个断言在当时**不成立**：宿主侧
 * `readOrigin` 读的是 `<iframe>` **元素**的 `.location.origin`，而 Gecko 上
 * `HTMLIFrameElement` 没有 `location` 属性，于是恒得空串 → 走 `origin-unknown`
 * 早退 → 闸门全程空转（详见 `docs/audit-full-2026-09-10.md` §11.7.1）。
 * 该缺陷已在 2026-09-11 修复（`originGate` 两侧加 `resolveWindow` 归一 + 宿主侧
 * 身份证伪器），并**真机实证**：真实 iframe → `chrome-file-source-identity`，
 * 伪造来源 → 拒绝。所以「根因已关闭」这句话现在是**有实证支撑**的。
 *
 * 本条仍只读不拦：拦会破坏设置页（SecuritySection / AdvancedSection 是这些键的
 * 合法写入方，且与攻击者走的是同一个 bridge 面——只拦通用 key 写路径只会把攻击者
 * 逼到 `settings.setGlobalParams`，属化妆性修复）。真正的边界是「外部网页拿不到
 * chrome:// 窗口句柄」+ 闸门只放行本窗口来源，见 `docs/security.md`。
 */
const SENSITIVE_PREF_KEYS: ReadonlySet<string> = new Set([
  "security.bypassMode",
  "security.bypassModeKind",
  "security.bypassWhitelist",
  "security.autoApproveReadOps",
  "security.codeExec.enabled",
  "security.codeExec.whitelist",
  "devTools",
]);

function auditSensitiveWrite(
  key: string,
  value: string | number | boolean,
): void {
  if (!SENSITIVE_PREF_KEYS.has(key)) return;
  try {
    logWarn("pref.sensitive.write", { key, value: String(value) });
  } catch {
    /* 日志不得影响写 pref */
  }
}

export function getPref<K extends keyof PluginPrefsMap>(key: K) {
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true) as PluginPrefsMap[K];
}

export function setPref<K extends keyof PluginPrefsMap>(
  key: K,
  value: PluginPrefsMap[K],
) {
  auditSensitiveWrite(String(key), value as any);
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

/**
 * Set a preference without type checking (for dynamic/string keys not in PluginPrefsMap)
 */
export function setPrefDynamic(key: string, value: string | number | boolean) {
  auditSensitiveWrite(key, value);
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

export function getPrefDynamic(key: string) {
  if (typeof Zotero === "undefined" || !Zotero?.Prefs) return undefined;
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true);
}

/**
 * 清除一个 dynamic pref。用途是**迁移期清扫孤儿键**（子系统退役后，已装过旧版的
 * 用户 pref 分支里仍留着那些键——代码不再读，无害，但会永久占位并误导排查）。
 * best-effort：键不存在时 Zotero 侧本就是 no-op，故本函数天然幂等，可反复调用。
 */
export function clearPrefDynamic(key: string): void {
  if (typeof Zotero === "undefined" || !Zotero?.Prefs) return;
  try {
    Zotero.Prefs.clear(`${PREFS_PREFIX}.${key}`, true);
  } catch {
    /* 清理是 best-effort，绝不影响启动 */
  }
}

/**
 * 清除一个**根级**（无 `extensions.zotero.leadero.` 前缀）的 pref。
 *
 * 只为清扫一种特定残留存在：退役的远程执行子系统当年把 `remote.daemonPort` /
 * `remote.timeout` / `security.remoteExec.enabled` 写到了**根分支**（未加前缀），
 * 所以 `clearPrefDynamic` 够不着它们（2026-09-11 真机核实：profile 的 prefs.js 里
 * 这三条确实在根级、值与旧默认一致，且 Zotero 源码与全部依赖均无同名声明）。
 *
 * ⚠ 根分支是**跨插件共享命名空间**，故本函数只应被迁移步用于「已确证归属我方」的
 * 具名键，不要拿它做通用清理。
 */
export function clearRootPref(name: string): void {
  if (typeof Zotero === "undefined" || !Zotero?.Prefs) return;
  try {
    Zotero.Prefs.clear(name, true);
  } catch {
    /* best-effort，同上 */
  }
}
