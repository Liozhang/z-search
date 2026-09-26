/**
 * EasyScholarClient — 中文核心期刊标识的可选数据源（P1-4）。
 *
 * easyScholar 提供 100+ 期刊等级数据集（北大核心 / CSCD / 南大核心 CSSCI /
 * 科技核心……），免费 key 于 easyscholar.cc 控制台自助申请。端点与回执
 * schema 以 Green Frog（zotero-updateifsE）生态的公开用法为准——本客户端
 * 对回执做**防御式解析**：容忍 map 形态（{"北大核心":"2023"}）与数组形态
 * （[{rankName,…}]）两种已知形状，任何不识别的形状静默返回未命中，
 * 绝不猜测。未配置 key 时整条链路短路（零请求）。
 *
 * @module core/data/EasyScholarClient
 */

import { normalizeJournalName } from "./utils/normalize";
import { safeDebug } from "../../utils/logger";

/** 归一化刊名 → 命中的中文核心名单（稳定码，文案由前端按 locale 取）。 */
export type ChineseCoreCode = "pku" | "cscd" | "cssci" | "tech";

/** 会话级缓存：命中、未命中都缓存（未命中也值得缓存——避免重复打 API）。 */
const cache = new Map<string, ChineseCoreCode[]>();
let inflight = new Map<string, Promise<ChineseCoreCode[]>>();

/** 并发闸：礼貌限流（免费 key 配额敏感）。 */
let active = 0;
const MAX_CONCURRENT = 4;

const ENDPOINT = "https://www.easyscholar.cc/openapi/api/paper/query";

/** 名单名（API 返回的中文键）→ 稳定码。别名容忍不同版本的键名。 */
const LIST_NAME_TO_CODE: Array<[RegExp, ChineseCoreCode]> = [
  [/北大核心|中文核心/, "pku"],
  [/CSCD/, "cscd"],
  [/南大核心|CSSCI/, "cssci"],
  [/科技核心|统计源/, "tech"],
];

/** 防御式解析：map / array 两种形态都认，其它形状返回空。 */
export function parseCoreRanks(data: unknown): ChineseCoreCode[] {
  const codes: ChineseCoreCode[] = [];
  const consume = (name: string, value: unknown) => {
    // 值为空 / "-" / null 视为未上榜
    if (value == null || value === "" || value === "-") return;
    for (const [re, code] of LIST_NAME_TO_CODE) {
      if (re.test(name) && !codes.includes(code)) {
        codes.push(code);
        return;
      }
    }
  };
  if (data && typeof data === "object") {
    if (Array.isArray(data)) {
      for (const ent of data) {
        if (!ent || typeof ent !== "object") continue;
        const rec = ent as Record<string, unknown>;
        const name = String(
          rec.rankName ?? rec.rank_name ?? rec.name ?? rec.title ?? "",
        );
        consume(name, rec.rankValue ?? rec.rank_value ?? rec.value ?? "1");
      }
    } else {
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        consume(k, v);
      }
    }
  }
  return codes;
}

/** 读取 key（未配置返回 null——调用方据此短路）。 */
function readKey(): string | null {
  try {
    const v = (globalThis as any).Zotero?.Prefs?.get(
      "extensions.zotero.zsearch.apis.easyscholar.apiKey",
      true,
    );
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

async function fetchCore(
  name: string,
  key: string,
): Promise<ChineseCoreCode[]> {
  while (active >= MAX_CONCURRENT) {
    await new Promise((r) => setTimeout(r, 50));
  }
  active++;
  try {
    const resp = await Zotero.HTTP.request(
      "GET",
      `${ENDPOINT}?searchName=${encodeURIComponent(name)}&key=${encodeURIComponent(key)}`,
      { headers: { Accept: "application/json" }, timeout: 15000 },
    );
    const body = JSON.parse(resp.responseText ?? "{}");
    if (body?.code != null && Number(body.code) !== 200) return [];
    // 已知形态：data.rankDicts / data.rankMsgs / data 直接是 map
    const d = body?.data;
    return parseCoreRanks(d?.rankDicts ?? d?.rankMsgs ?? d ?? null);
  } catch (e) {
    safeDebug("[z-search] easyScholar lookup failed: " + e);
    return [];
  } finally {
    active--;
  }
}

/**
 * 批量查中文核心名单。未配置 key 返回空 Map（零网络）；命中/未命中都会
 * 写入会话缓存，重复刊名只打一次。
 */
export async function batchLookupChineseCore(
  names: string[],
): Promise<Map<string, ChineseCoreCode[]>> {
  const out = new Map<string, ChineseCoreCode[]>();
  const key = readKey();
  if (!key) return out;
  const todo: string[] = [];
  for (const raw of names) {
    const norm = normalizeJournalName(String(raw || ""));
    if (!norm) continue;
    if (cache.has(norm)) {
      const hit = cache.get(norm)!;
      if (hit.length) out.set(norm, hit);
      continue;
    }
    if (!todo.includes(norm)) todo.push(norm);
  }
  if (todo.length > 0) {
    await Promise.all(
      todo.map(async (norm) => {
        let p = inflight.get(norm);
        if (!p) {
          p = fetchCore(norm, key).then((codes) => {
            cache.set(norm, codes);
            inflight.delete(norm);
            return codes;
          });
          inflight.set(norm, p);
        }
        const codes = await p;
        if (codes.length) out.set(norm, codes);
      }),
    );
  }
  return out;
}

/** 是否已配置 key（设置面板提示用）。 */
export function easyScholarConfigured(): boolean {
  return readKey() != null;
}

/** 测试专用：清空会话缓存。 */
export function _clearCacheForTests(): void {
  cache.clear();
  inflight = new Map();
}
