/**
 * zoteroSql — Zotero 10 SQL 契约的两个面（静默缺陷族 A/B 的执行面）。
 *
 * ## 面 A：`queryAsync` 的「首词判定」决定是否返回行
 *
 * `Zotero.DBConnection.queryAsync` 用**原始字符串**判定语句种类：
 *
 * ```js
 * let op = sql.match(/^[^a-z]*[^ ]+/i);              // xpcom/db.js:649
 * if (op) op = op.toString().toLowerCase();
 * if (op == 'select' || op == 'pragma') { ...; return rows; }  // db.js:655-687
 * else { return; }                                  // db.js:692 —— 返回 undefined
 * ```
 *
 * 于是以下写法**都会**让 `op` 不等于 `select`：模板以换行/缩进开头
 * （`/^[^a-z]*[^ ]+/` 会把缩进一起匹配进 op，得到 `"\n        select"`）、
 * 首词后紧跟换行（`"select\n"`）、SQL 以注释开头、`WITH ... SELECT`（`op == "with"`）。
 * 语句照样执行，**行被丢弃**，`queryAsync` 解析为 `undefined`。
 * 调用方若写 `(rows || [])`，读失败就被折成「0 行」——与「空库/无命中」不可区分，
 * 模型据此断言「库里什么都没有」（实证：2026-09-16 的 `search-items` list 模式
 * 对 111 条库返回 `total:0`；见 `docs/search-recall-diagnosis-2026-09-16.md` §4/§9）。
 *
 * 本模块把契约收成两个执行点：`assertRowReturningSql()`（起点/首词正确）与
 * `queryRows()`（失败即失败，不伪装空）。静态面由
 * `scripts/check-sql-select-origin.cjs` 守；本模块守动态面。
 *
 * ## 面 B：条目类型一律**按名**判断
 *
 * 真源是 Zotero 自己的 `Zotero.Item.prototype.isRegularItem`：
 * `!(this.isNote() || this.isAttachment() || this.isAnnotation())`
 * （`xpcom/data/item.js:2447-2448`）。SQL 侧必须用 `itemTypes.typeName`：
 * Zotero 10 的 `itemTypeID` 由 `schema.json` 字母序分配（实测本机库：
 * 1=annotation、3=attachment、14=document、28=note），旧代码散布的
 * `itemTypeID NOT IN (1, 14)` 实际排除了 annotation 与 document、
 * **却保留了全部 note 与 attachment**（本机 111 条里 88 条），与本意相反；
 * `(14, 1, 42)` 变体同理（42 在 Zotero 10 中不存在）。
 *
 * @module utils/zoteroSql
 */

/** `queryAsync` 只在这两个首词下返回行数组（db.js:655）。 */
const ROW_RETURNING_OPS = new Set(["select", "pragma"]);

/**
 * 复刻宿主的首词判定（db.js:649）。返回**小写**的匹配结果，或 `null`
 * （空串/纯空白 SQL）。
 *
 * 注意它带 `^[^a-z]*`：缩进、换行、注释、`WITH` 全都会进 `op`，所以
 * 「SQL 看起来是 SELECT」与「op === 'select'」不是同一件事。
 */
export function statementOp(sql: string): string | null {
  const match = /^[^a-z]*[^ ]+/i.exec(sql);
  return match ? match[0].toLowerCase() : null;
}

/**
 * 断言这条 SQL 会被 `queryAsync` 当作行读取语句（op === 'select' | 'pragma'）。
 *
 * 抛错而不是返回布尔：这条断言的用途是**让读失败在调用点就炸**，
 * 而不是让调用方有机会再写一次 `|| []`。
 *
 * @param sql 传给 `queryAsync` 的原始字符串（未 trim）
 * @param context 出错时点名的调用点（工具名/handler 名），用于定位
 */
export function assertRowReturningSql(sql: string, context: string): void {
  const op = statementOp(sql);
  if (op !== null && ROW_RETURNING_OPS.has(op)) return;
  throw new Error(
    `SQL 首词判定失败（${context}）：Zotero 10 用 sql.match(/^[^a-z]*[^ ]+/i) ` +
      `判定语句种类，只有结果等于 'select' 或 'pragma' 才返回行数组` +
      `（xpcom/db.js:649-692）。本次判定为 ${JSON.stringify(op)}，行会被丢弃且 ` +
      `queryAsync 返回 undefined。修法：让 SELECT/PRAGMA 从第 0 列开始` +
      `（模板不要以换行/缩进开头）、首词后紧跟空格、不要在 SQL 前放注释。` +
      `静态守卫：scripts/check-sql-select-origin.cjs；诊断：` +
      `docs/search-recall-diagnosis-2026-09-16.md §4/§9。`,
  );
}

/**
 * 读行：`queryAsync` 的显式契约版。
 *
 * - SQL 起点/首词不正确 → 抛（见 `assertRowReturningSql`）
 * - 返回 `undefined`/`null` → 抛（读失败不是空结果）
 * - 返回 `false` → 容忍为无行（`false` 是 `valueQueryAsync` 的「无结果」语义，
 *   `queryAsync` 不会返回它；保留容忍以不改动既有行为）
 * - 返回 `[]` → 合法的空结果
 *
 * @param template 请传 `sql.match` 能看到原样的字符串字面量（守卫才能静态检查）
 * @param context 出错时点名的调用点
 */
export async function queryRows<T = Record<string, any>>(
  sql: string,
  params?: any[],
  context = "queryRows",
): Promise<T[]> {
  assertRowReturningSql(sql, context);
  const raw: unknown = await Zotero.DB.queryAsync(sql, params as any);
  if (raw === undefined || raw === null) {
    throw new Error(
      `行读取失败（${context}）：Zotero.DB.queryAsync 未返回行数组。` +
        `undefined/null 表示语句没有按 SELECT 执行，**不是**空结果——` +
        `把它归一化成「0 行」会让上游把读失败当成空库/无命中。` +
        `见 src/utils/zoteroSql.ts 与 docs/search-recall-diagnosis-2026-09-16.md §4/§9。`,
    );
  }
  return (raw === false ? [] : raw) as T[];
}

/** `isRegularItem()` 的补集，按名列出（见模块头）。 */
const NON_REGULAR_ITEM_TYPE_NAMES = "'note', 'attachment', 'annotation'";

/**
 * 「这是书目条目」的 SQL 谓词（Zotero `isRegularItem()` 的 SQL 面，见模块头）。
 *
 * 用 `NOT IN (SELECT …)` 而非 `JOIN itemTypes`：本仓相关站点的 items 别名一律是
 * `i`，而 `it` 在 tags 家族里已表示 `itemTags`——子查询形式不引入别名冲突，
 * 也是 `manageTrash.ts` 既有的「按名查类型」写法。子查询非相关，SQLite 会
 * 物化一次当查找表（itemTypes 只有 40 行）。子查询内部用自己的别名 `ityp`
 * （不叫 `it`），避免与外层 `itemTags it` 同名遮蔽。
 *
 * 前提：查询里 `items` 的别名是 `i`。
 */
export const SQL_IS_REGULAR_ITEM =
  "i.itemTypeID NOT IN (SELECT ityp.itemTypeID FROM itemTypes ityp WHERE ityp.typeName IN (" +
  // 用 `+` 而非模板插值：这里插的是**编译期常量**（类型名），不是绑定参数。
  // 写成模板插值（`ITEM_LIST` 那种形态）会与 check-sql-batching 的「IN 子句
  // ≤999 绑定参数」判据误撞——那条判据只该管参数数组（见 src/utils/sqlBatch.ts）。
  NON_REGULAR_ITEM_TYPE_NAMES +
  "))";
