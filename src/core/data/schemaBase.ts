/**
 * SchemaBase — Shared database schema initialization pattern.
 *
 * Encapsulates the common pattern that all zsearch_* Schema files share:
 * version-pref gate, self-heal, transaction wrapper, and error handling.
 *
 * Each Schema provides its DDL and migration steps via the SchemaDef interface.
 *
 * @module core/data/schemaBase
 */

import {} from "./utils/schema";
import { safeDebug, warn } from "../../utils/logger";

/**
 * Schema definition passed to createSchema().
 */
export interface SchemaDef {
  /** Target schema version (incremented when DDL changes) */
  readonly version: number;
  /** Pref key for persisting the current schema version */
  readonly prefKey: string;
  /**
   * Self-heal check: returns true if tables are missing and full re-migration
   * is needed. Called only when currentVersion >= 1.
   * Omit (undefined) to skip self-heal entirely.
   */
  readonly selfHeal?: (currentVersion: number) => Promise<boolean>;
  /**
   * Migration steps to execute when currentVersion < version.
   * Each step is a function that performs DDL/DML inside the transaction.
   * @param from Current version (from pref, after self-heal)
   * @param to Target version (def.version)
   */
  readonly up: (
    from: number,
    to: number,
  ) => readonly (() => Promise<unknown>)[];
}

/**
 * Create a Schema initializer from a declarative definition.
 *
 * Usage:
 *   export default createSchema({
 *     version: 2,
 *     prefKey: "cass.schemaVersion",
 *     selfHeal: async () => !(await tableExists("zsearch_cass_quartiles")),
 *     up: (from, to) => {
 *       const steps: (() => Promise<void>)[] = [];
 *       if (from < 1) { steps.push(() => Zotero.DB.queryAsync(`CREATE TABLE ...`)); }
 *       if (from < 2) { steps.push(() => Zotero.DB.queryAsync(`CREATE INDEX ...`)); }
 *       return steps;
 *     },
 *   });
 */
export function createSchema(def: SchemaDef) {
  let initialized = false;

  return {
    async initialize(): Promise<void> {
      if (initialized) return;

      let currentVersion = (Zotero.Prefs.get(def.prefKey, true) as number) ?? 0;

      // Self-heal: pref may claim "migrated" while tables are missing
      // (DB reset, manual DROP, profile pref/DB desync).
      if (currentVersion >= 1 && def.selfHeal) {
        const needsHeal = await def.selfHeal(currentVersion);
        if (needsHeal) currentVersion = 0;
      }

      if (currentVersion >= def.version) {
        initialized = true;
        return;
      }

      try {
        const steps = def.up(currentVersion, def.version);
        await Zotero.DB.executeTransaction(
          async () => {
            for (const step of steps) {
              await step();
            }
          },
          {
            // 建表与数据导入同处启动窗口，同样与宿主长事务争主库写锁。
            // Zotero 默认只等 30 秒（db.js waitTimeout）；争用窗口内建表
            // 超时后四张表缺席，下游各导入 stage 会以「no such table」快速
            // 全失败。DDL 幂等（CREATE IF NOT EXISTS），多等好过失败，
            // 与 crud.importRows 对齐放宽到 120 秒。
            waitTimeout: 120_000,
          } as any,
        );

        Zotero.Prefs.set(def.prefKey, def.version, true);
        initialized = true;
      } catch (e) {
        // 失败必须冒泡：吞掉后调用方（journalDataImport 的 allSettled）
        // 收不到 rejection，四张表缺席只会以晦涩的「no such table」暴露，
        // 且此处只有 debug 级日志——生产默认完全静默，横幅失败无从诊断。
        warn("startup.journal_schema_failed", {
          prefKey: def.prefKey,
          error: String((e as any)?.message ?? e).slice(0, 300),
        });
        safeDebug("[z-search] " + def.prefKey + " initialize error: " + e);
        throw e;
      }
    },
  };
}
