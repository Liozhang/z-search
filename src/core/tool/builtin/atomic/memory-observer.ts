/**
 * memory-observer — 记忆系统轻量桩（z-search）。
 *
 * leadero 的记忆系统（fact-manager / profile-reader / memory-search）不属于
 * 搜索能力，本插件不复制。DiscoveryEngine 的「研究方向积累 / 库建议」两个
 * 可选特性在无记忆系统时优雅降级：rememberFact 静默成功、getFacts 返回空
 * （概念不足 3 个 → 库建议直接返回空数组）。
 */

export interface MemoryFact {
  key: string;
  content: string;
  ttl?: string;
  category?: string;
}

/** 静默 no-op：无记忆系统可写。 */
export async function rememberFact(
  _key: string,
  _content: string,
  _ttl?: string,
  _category?: string,
): Promise<MemoryFact | null> {
  return null;
}

/** 无记忆可读。 */
export async function getFacts(_category?: string): Promise<MemoryFact[]> {
  return [];
}

/** 静默 no-op。 */
export async function forgetFact(_key: string): Promise<boolean> {
  return true;
}

/** 无画像摘要。 */
export async function getProfileSummary(): Promise<string> {
  return "";
}

export interface MemorySearchResult {
  results: Array<{ key: string; content: string; score: number }>;
}

/** 无记忆可检索。 */
export async function searchMemory(
  _query: string,
  _limit?: number,
): Promise<MemorySearchResult> {
  return { results: [] };
}
