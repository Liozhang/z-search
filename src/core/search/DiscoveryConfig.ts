/**
 * DiscoveryConfig — blacklist/whitelist persistence extracted from DiscoveryEngine.
 */

import {
  getPref,
  setPref,
  getPrefDynamic,
  setPrefDynamic,
} from "../../utils/prefs";
import type {
  DiscoveryBlacklist,
  DiscoveryFilterConfig,
} from "./DiscoveryTypes";
import {
  DEFAULT_BLACKLIST,
  DEFAULT_WHITELIST,
  BLACKLIST_PREF,
  WHITELIST_PREF,
} from "./DiscoveryTypes";
import { safeDebug } from "../../utils/logger";

/**
 * Get the current discovery blacklist.
 */
export function getBlacklist(): DiscoveryBlacklist {
  const raw = getPref(BLACKLIST_PREF) as string;
  if (!raw) {
    // First access: initialize with defaults
    const defaults = { ...DEFAULT_BLACKLIST };
    setPref(BLACKLIST_PREF, JSON.stringify(defaults));
    return defaults;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    safeDebug("[z-search] DiscoveryConfig.getBlacklist failed: " + e);
    return { ...DEFAULT_BLACKLIST };
  }
}

/**
 * Add a value to the blacklist.
 */
export function addToBlacklist(
  type: "domains" | "journals",
  value: string,
): void {
  const blacklist = getBlacklist();
  const normalized = value.trim().toLowerCase();
  if (!normalized) return;
  if (!blacklist[type].includes(normalized)) {
    blacklist[type].push(normalized);
    setPref(BLACKLIST_PREF, JSON.stringify(blacklist));
  }
}

/**
 * Remove a value from the blacklist.
 */
export function removeFromBlacklist(
  type: "domains" | "journals",
  value: string,
): void {
  const blacklist = getBlacklist();
  const normalized = value.trim().toLowerCase();
  blacklist[type] = blacklist[type].filter((v) => v !== normalized);
  setPref(BLACKLIST_PREF, JSON.stringify(blacklist));
}

/**
 * Get the current discovery whitelist.
 */
export function getWhitelist(): { domains: string[]; journals: string[] } {
  const raw = getPrefDynamic(WHITELIST_PREF) as string;
  if (!raw) return { ...DEFAULT_WHITELIST };
  try {
    return JSON.parse(raw);
  } catch (e) {
    safeDebug("[z-search] DiscoveryConfig.getWhitelist failed: " + e);
    return { ...DEFAULT_WHITELIST };
  }
}

/**
 * Add a value to the whitelist.
 */
export function addToWhitelist(
  type: "domains" | "journals",
  value: string,
): void {
  const whitelist = getWhitelist();
  const normalized = value.trim().toLowerCase();
  if (!normalized) return;
  if (!whitelist[type].includes(normalized)) {
    whitelist[type].push(normalized);
    setPrefDynamic(WHITELIST_PREF, JSON.stringify(whitelist));
  }
}

/**
 * Remove a value from the whitelist.
 */
export function removeFromWhitelist(
  type: "domains" | "journals",
  value: string,
): void {
  const whitelist = getWhitelist();
  const normalized = value.trim().toLowerCase();
  whitelist[type] = whitelist[type].filter((v) => v !== normalized);
  setPrefDynamic(WHITELIST_PREF, JSON.stringify(whitelist));
}

/**
 * Get combined filter config (blacklist + whitelist).
 */
export function getFilterConfig(): DiscoveryFilterConfig {
  return {
    blacklist: getBlacklist(),
    whitelist: getWhitelist(),
  };
}
