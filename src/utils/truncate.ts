/**
 * Unified text truncation utility.
 *
 * Replaces scattered `slice(0, N) + '...'` / `substring(0, N) + '...'` inline
 * patterns. Use the `transform` option for preprocessing (e.g. strip HTML tags)
 * and `suffix` for custom trailing markers like '...[truncated]'.
 */

export interface TruncateOptions {
  /** Trailing marker for truncated text. Defaults to '...'. */
  suffix?: string;
  /** Preprocess input before length check and slicing (e.g. strip HTML tags). */
  transform?: (input: string) => string;
  /** Truncate from the end instead of the beginning. Prefix with suffix. */
  tail?: boolean;
}

/**
 * Truncate `text` to at most `maxLen` characters.
 *
 * - When `transform` is provided, the transformed string is sliced, but the
 *   short-circuit return value is the ORIGINAL text (preserving any formatting
 *   the caller may rely on) — matching the historical inline ternary behavior.
 * - Otherwise the input itself is sliced.
 *
 * Note: when no truncation is needed and `transform` is set, the original
 * (un-transformed) text is returned, since the historical patterns did the same.
 */
export function truncate(
  text: string,
  maxLen: number,
  options?: TruncateOptions,
): string {
  if (!text) return text;
  const processed = options?.transform ? options.transform(text) : text;
  if (processed.length <= maxLen) return text;
  if (options?.tail) {
    return (options?.suffix ?? "...") + processed.slice(-maxLen);
  }
  return processed.slice(0, maxLen) + (options?.suffix ?? "...");
}
