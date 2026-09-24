/**
 * VersionedStore — Abstract base class for versioned SQLite schema stores.
 *
 * Subclasses provide:
 *   SCHEMA_VERSION — target version number
 *   SCHEMA_NAME — unique name identifier in zsearch_schema_versions table
 *   createSchema() — CREATE TABLE / CREATE INDEX statements
 *   migrate(fromVersion)? — optional version-specific migration steps
 *
 * The base class handles:
 *   - Reading current version from SQLite (zsearch_schema_versions table)
 *   - Wrapping DDL + version write in executeTransaction (atomic)
 *   - Running migrations when stored version < SCHEMA_VERSION
 *   - Idempotent initialization (safe to call multiple times)
 *   - Throwing on failure rather than silently catching
 */

import { safeDebug } from "../../utils/logger";
import { assertParamBudget } from "../../utils/sqlBatch";

abstract class VersionedStore {
  /** Target schema version — override in subclass */
  protected abstract SCHEMA_VERSION: number;

  /** Unique schema name for the zsearch_schema_versions table — override in subclass */
  protected abstract SCHEMA_NAME: string;

  /**
   * Tables this store owns — override in subclass. Used for self-heal: a
   * current version row is only trusted if these tables still exist (plugin
   * table reset, partial WebDAV restore, manual DROP). If any is missing the
   * store re-runs the full fresh-install path.
   */
  protected abstract SCHEMA_TABLES: readonly string[];

  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Ensure schema is up to date. Idempotent — safe to call multiple times.
   * Resets on failure so the next call retries.
   */
  async ensureSchema(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doEnsureSchema();
    try {
      await this.initPromise;
    } catch (e) {
      this.initPromise = null;
      throw e instanceof Error
        ? e
        : new Error(String(e ?? "Schema initialization failed"));
    }
  }

  private async _doEnsureSchema(): Promise<void> {
    let currentVersion = 0;
    try {
      const rows = await Zotero.DB.queryAsync(
        "SELECT version FROM zsearch_schema_versions WHERE name = ?",
        [this.SCHEMA_NAME],
      );
      currentVersion = ((rows as unknown[])[0] as any)?.version ?? 0;
    } catch (e) {
      safeDebug("[z-search] " + e);
      // Table may not exist on first install
    }

    if (currentVersion >= this.SCHEMA_VERSION) {
      const missing = await VersionedStore._missingTables(this.SCHEMA_TABLES);
      if (missing.length > 0) {
        safeDebug(
          `[z-search] ${this.SCHEMA_NAME}: version row current but tables missing ` +
            `(${missing.join(", ")}) — re-running full schema init`,
        );
        currentVersion = 0;
      }
    }

    if (currentVersion < this.SCHEMA_VERSION) {
      await Zotero.DB.executeTransaction(async () => {
        // Ensure version tracking table exists
        await Zotero.DB.queryAsync(
          `CREATE TABLE IF NOT EXISTS zsearch_schema_versions (
            name TEXT PRIMARY KEY,
            version INTEGER NOT NULL
          )`,
        );

        await this.createSchema();
        if (this.migrate) {
          await this.migrate(currentVersion);
        }

        // Write version inside transaction — atomic with schema changes
        await Zotero.DB.queryAsync(
          "INSERT OR REPLACE INTO zsearch_schema_versions (name, version) VALUES (?, ?)",
          [this.SCHEMA_NAME, this.SCHEMA_VERSION],
        );
      });
    }

    // Idempotent maintenance DDL (e.g. late-added indexes) — runs on every
    // init so existing installs pick it up without a version bump.
    if (this.postSchema) {
      await this.postSchema();
    }

    this.initialized = true;
  }

  private static async _missingTables(
    tableNames: readonly string[],
  ): Promise<string[]> {
    if (tableNames.length === 0) return [];
    // 2026-09-10（审计 G-05）：tableNames 由子类给出，签名无上界 —— 显式设界。
    assertParamBudget(tableNames.length, "VersionedStore._missingTables");
    const placeholders = tableNames.map(() => "?").join(",");
    const rows = (await Zotero.DB.queryAsync(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`,
      [...tableNames],
    )) as unknown[] | undefined;
    const present = new Set(
      ((rows as any[]) ?? []).map((r: any) => r?.name).filter(Boolean),
    );
    return tableNames.filter((n) => !present.has(n));
  }

  /**
   * Override to create tables and indexes.
   * Use CREATE IF NOT EXISTS for safe re-execution.
   */
  protected abstract createSchema(): Promise<void>;

  /**
   * Override (optional) for version-specific migration.
   * Called with the old version number when stored version < SCHEMA_VERSION.
   * Runs inside the same transaction as createSchema().
   */
  protected migrate?(fromVersion: number): Promise<void> | void;

  /**
   * Override (optional) for idempotent maintenance DDL that must also apply
   * to installs whose version row is already current (e.g. late-added
   * indexes). Runs on every ensureSchema, outside the version-gated
   * transaction; keep each statement IF NOT EXISTS / guarded.
   */
  protected postSchema?(): Promise<void> | void;
}

export default VersionedStore;
