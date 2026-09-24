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
import { safeDebug } from "../../utils/logger";

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
        await Zotero.DB.executeTransaction(async () => {
          for (const step of steps) {
            await step();
          }
        });

        Zotero.Prefs.set(def.prefKey, def.version, true);
        initialized = true;
      } catch (e) {
        safeDebug("[z-search] " + def.prefKey + " initialize error: " + e);
      }
    },
  };
}
