/**
 * OpenAlex 鉴权参数（O7，2026-09-07 文献计量缺口批）。
 *
 * OpenAlex 已于 2026 年初废弃 mailto 礼貌池——`mailto` 参数被忽略，改为
 * 免费 API Key（`api_key` 查询参数，约 $1/天 ≈ 10 万 credits）。存量
 * `apis.openalex.apiKey` pref 值几乎都是旧 mailto（email 地址），故单字段
 * 自动识别：含 "@" 按旧 mailto 发（无效但无害，保持兼容），否则按
 * `api_key` 发。
 *
 * @module utils/openalexAuth
 */

import { getPrefDynamic } from "./prefs";

/** 读 pref 并判定鉴权形态。含 "@" → mailto（旧）；非空 → api_key（新）。 */
export function openalexAuthQuery(): string | null {
  const raw =
    (getPrefDynamic("apis.openalex.apiKey") as string | undefined) ?? "";
  const value = raw.trim();
  if (!value) return null;
  if (value.includes("@")) return `mailto=${encodeURIComponent(value)}`;
  return `api_key=${encodeURIComponent(value)}`;
}

/** 直接拼接到已有 query 的 URL（以 `&` 连接）；无鉴权时原样返回。 */
export function withOpenalexAuth(url: string): string {
  const q = openalexAuthQuery();
  return q ? `${url}&${q}` : url;
}

/**
 * 是否配置了真 API Key（api_key 形态）。会话级定时回填的守卫——无 Key 档
 * 约 $0.10/天配额，批量回填会秒级耗尽（2026-09-06 无 key 盲发防御同纪律）；
 * 手动触发的回填不受此限（用户显式选择）。
 */
export function hasOpenalexApiKey(): boolean {
  const raw =
    (getPrefDynamic("apis.openalex.apiKey") as string | undefined) ?? "";
  const value = raw.trim();
  return !!value && !value.includes("@");
}
