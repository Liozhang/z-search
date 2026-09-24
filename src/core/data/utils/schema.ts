/**
 * Schema-layer helpers shared by *Schema initializers.
 *
 * @module core/data/utils/schema
 */

/**
 * Check whether a table exists in the Zotero DB (via sqlite_master).
 *
 * Schema initializers gate `CREATE TABLE IF NOT EXISTS` behind a version pref
 * ("if currentVersion >= SCHEMA_VERSION, skip"). That gate assumes the pref
 * being set implies the table exists — an invariant that breaks when the DB is
 * reset, a table is dropped manually, or a profile reuses a stale pref. When it
 * breaks, the schema no-ops forever and the table stays missing.
 *
 * Schemas call this to self-heal: if the pref says "migrated" but the table is
 * gone, force a full re-migration. `CREATE TABLE IF NOT EXISTS` is idempotent,
 * so re-running is always safe.
 */
export async function tableExists(tableName: string): Promise<boolean> {
  const rows = await Zotero.DB.queryAsync(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    [tableName],
  );
  return Array.isArray(rows) && rows.length > 0;
}
