/**
 * Shared error-to-message utility.
 * Normalizes a thrown value (Error / string / number / unknown) to a string message,
 * replacing the scattered `e.message || String(e)` and
 * `e instanceof Error ? e.message : String(e)` idioms.
 *
 * @param e - The error value to normalize
 * @param fallback - Fallback string if the error cannot be normalized to a non-empty string
 */
export function toErrorMessage(e: unknown, fallback?: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string" && e.length > 0) return e;
  if (typeof e === "number") return String(e);
  if (typeof e === "string") return fallback ?? "Unknown error";
  if (fallback) return fallback;
  return String(e);
}
