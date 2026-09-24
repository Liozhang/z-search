import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";
import { formatDate } from "./dateFormat";

export { initLocale, getString, getLocaleID, formatRelativeTime };

function initLocale() {
  // iframe bundle 里没有 rspack/esbuild banner 注入的 _globalThis（主进程 bootstrap
  // 专有全局）：react 树的 locale 走 react/utils/locale 的 bridge 快照，这里直接跳过，
  // 避免 ReferenceError（typings 把 _globalThis 声明为恒存在，运行时并非如此）。
  if (typeof _globalThis === "undefined") return;
  const l10n = new (
    typeof Localization === "undefined"
      ? Zotero.getGlobal("Localization")
      : Localization
  )(
    // 2026-09-16 起 FTL 按主题拆文件（C-3 批新建 tracking.ftl）：新文件必须
    // 同时登记在 localeBatch.ts 的 fallback 清单，否则 locale.getAll 快照缺键。
    [
      `${config.addonRef}-addon.ftl`,
      `${config.addonRef}-preferences.ftl`,
      `${config.addonRef}-tracking.ftl`,
    ],
    true,
  );
  _globalThis.addon.data.locale = {
    current: l10n,
  };
}

function getString(localString: FluentMessageId): string;
function getString(localString: FluentMessageId, branch: string): string;
function getString(
  localeString: FluentMessageId,
  options: {
    branch?: string | undefined;
    args?: Record<string, unknown>;
    fallback?: string;
  },
): string;
function getString(...inputs: any[]) {
  if (inputs.length === 1) {
    return _getString(inputs[0]);
  } else if (inputs.length === 2) {
    if (typeof inputs[1] === "string") {
      return _getString(inputs[0], { branch: inputs[1] });
    } else {
      return _getString(inputs[0], inputs[1]);
    }
  } else {
    throw new Error("Invalid arguments");
  }
}

function _getString(
  localeString: FluentMessageId,
  options: {
    branch?: string | undefined;
    args?: Record<string, unknown>;
    fallback?: string;
  } = {},
): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const { branch, args, fallback } = options;
  // 按缺翻译降级的两种情形（typings 把 _globalThis 声明为恒存在，运行时并非如此）：
  // 1. iframe bundle（Hub/聊天窗 reactBundle）无 banner 注入的 _globalThis；
  // 2. locale 未初始化（addon.data.locale 缺席，如单测环境）。
  const localeData =
    typeof _globalThis === "undefined" ? undefined : _globalThis.addon?.data;
  if (!localeData?.locale?.current) {
    return fallback || localStringWithPrefix;
  }
  const pattern = localeData.locale.current.formatMessagesSync([
    { id: localStringWithPrefix, args },
  ])[0];

  // No translation found or empty pattern
  if (!pattern) {
    return fallback || localStringWithPrefix;
  }

  if (branch && pattern.attributes) {
    for (const attr of pattern.attributes) {
      if (attr.name === branch) {
        return attr.value;
      }
    }
    return pattern.attributes[branch] || fallback || localStringWithPrefix;
  } else {
    // pattern.value can be empty string for multi-line FTL values; treat as missing if so
    const value = pattern.value;
    if (value) return value;
    // FTL messages may store placeholder text in a .placeholder attribute when
    // the message value is intentionally left empty (e.g. pref-*-placeholder keys).
    if (pattern.attributes) {
      for (const attr of pattern.attributes) {
        if (attr.name === "placeholder") {
          return attr.value;
        }
      }
    }
    return fallback || localStringWithPrefix;
  }
}

function getLocaleID(id: FluentMessageId) {
  return `${config.addonRef}-${id}`;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return getString("time-just-now");
  if (minutes < 60)
    return getString("time-minutes-ago", { args: { count: minutes } });
  if (hours < 24)
    return getString("time-hours-ago", { args: { count: hours } });
  if (days < 7) return getString("time-days-ago", { args: { count: days } });
  // H-4（2026-09-15 部署包评审）：与 react 侧 formatRelativeTime 统一到
  // leaf 模块的 ISO 格式，消除「2026/9/8 vs 2026-09-04」双制。
  return formatDate(timestamp);
}
