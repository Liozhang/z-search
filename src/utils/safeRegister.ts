/**
 * safeRegister — register a host-facing hook (menus, toolbar, stylesheets)
 * without letting a failure propagate and abort the whole window-load sequence.
 *
 * A single throwing register call should never block the rest of plugin
 * initialization (host fault tolerance).
 */
import { safeDebug } from "./logger";

export async function safeRegister(
  name: string,
  fn: () => void | Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    safeDebug(`[z-search] register '${name}' failed: ${message}`);
  }
}
