/**
 * Zotero 10.0.1 compat: `Zotero.Item.prototype.getDisplayName` was removed
 * (verified on 10.0.1 — prototype has getField/getDisplayTitle but no
 * getDisplayName; it existed on earlier builds). All plugin call sites go
 * through this shim: legacy method when present, getDisplayTitle (the
 * surviving, semantically equivalent API) otherwise.
 *
 * @module utils/itemDisplayName
 */

/** Display title of an item across Zotero builds; "" when unavailable. */
export function itemDisplayName(item: any): string {
  if (!item) return "";
  if (typeof item.getDisplayName === "function") return item.getDisplayName();
  if (typeof item.getDisplayTitle === "function") return item.getDisplayTitle();
  return "";
}
