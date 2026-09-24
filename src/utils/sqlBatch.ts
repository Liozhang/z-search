/**
 * sqlBatch — SQLite 绑定参数上限的分块工具（审计 G-05 的执行面）。
 *
 * 背景：CLAUDE.md 的红线是「IN 子句 ≤ 999 绑定参数」，仓库也定义了
 * `SQLITE_MAX_VARIABLES = 999` / `SAFE_BATCH_SIZE = 900`。但这条红线在审计前
 * **没有任何执行点**——30 处 `IN (${...})` 站点里，分块与否全靠开发者自觉，
 * 已确认 5 处实越界（E-04~E-08）。
 *
 * 本模块把「按绑定参数数分块」这件事收成一个 API，让调用点不必各自手写
 * `Math.floor(SAFE_BATCH_SIZE / columns.length)`（那正是 E-05 写错的地方：它按
 * **行数**分块，而每行贡献 columns.length 个参数）。
 *
 * 用法（IN 子句）：
 *   for (const ids of chunkByParams(allIds, 1)) {
 *     const ph = ids.map(() => "?").join(",");
 *     await Zotero.DB.queryAsync(`... WHERE id IN (${ph})`, ids);
 *   }
 *
 * 用法（多列 VALUES / 复合键 IN）：
 *   // 每行 2 个参数 → 自动算成每块 ≤450 行
 *   for (const batch of chunkByParams(rows, keyColumns.length)) { ... }
 *
 * 不变量：每个返回块的 `block.length * paramsPerItem <= SAFE_BATCH_SIZE`。
 *
 * @module utils/sqlBatch
 */
import { SAFE_BATCH_SIZE, SQLITE_MAX_VARIABLES } from "./constants";

/**
 * 按「每项占用的绑定参数个数」把数组切成安全块。
 *
 * @param items 待绑定项（id 数组、行数组……）
 * @param paramsPerItem 每一项占用几个绑定参数（IN 子句 = 1；N 列 VALUES = N）
 * @returns 块数组；输入为空时返回 `[]`
 */
export function chunkByParams<T>(
  items: readonly T[],
  paramsPerItem = 1,
): T[][] {
  if (items.length === 0) return [];
  const per = Math.max(1, Math.floor(paramsPerItem));
  const size = Math.max(1, Math.floor(SAFE_BATCH_SIZE / per));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * 断言一次查询的绑定参数数没有越过红线，越线即抛出。
 *
 * 存在的意义：SQLite 自己也会抛 "too many SQL variables"，但那条消息不带调用
 * 上下文；本函数的消息指向上游（"按列数折算分块，见 SAFE_BATCH_SIZE"），
 * 让越界在开发期就是一条自解释的错误而不是一行底层报错。
 *
 * 生产路径不必逐点调用——它主要给「动态拼 SQL」的少数点与测试用。
 */
export function assertParamBudget(count: number, context: string): void {
  if (count > SQLITE_MAX_VARIABLES) {
    throw new Error(
      `SQL 绑定参数越界：${context} 需要 ${count} 个参数，上限 ${SQLITE_MAX_VARIABLES}。` +
        "请用 chunkByParams() 分块（按每项参数数折算，见 src/utils/constants.ts）。",
    );
  }
}
