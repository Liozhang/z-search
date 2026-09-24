/**
 * TokenBudgetEstimator — Dynamic chars-per-token estimation.
 *
 * Starts at 2.5 (Chinese-mixed text average) and self-calibrates
 * using actual token counts from API responses via exponential moving average.
 */

const INITIAL_CHARS_PER_TOKEN = 2.5;
const EMA_ALPHA = 0.3; // weight of new observation

/**
 * C2 (2026-09-14): content-aware chars-per-token sampling — moved here from
 * ConceptExtractor so every budget consumer shares one estimator. Fixed 2.5
 * underestimates token counts for CJK-heavy text (~1.5-2 chars/token),
 * oversizing the input budget until the API rejects the call; English runs
 * ~4. Sampling keeps this O(sample).
 */
export function estimateCharsPerToken(text: string): number {
  const sample =
    text.length > 40000 ? text.slice(0, 20000) + text.slice(-20000) : text;
  let cjk = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0xac00 && code <= 0xd7af) // Hangul
    ) {
      cjk++;
    }
  }
  const cjkRatio = sample.length > 0 ? cjk / sample.length : 0;
  // Pure English ≈ 4 chars/token, pure CJK ≈ 1.6; linear blend between them.
  return 4 - 2.4 * cjkRatio;
}

class TokenBudgetEstimator {
  private charsPerToken = INITIAL_CHARS_PER_TOKEN;

  /**
   * Calibrate the ratio using actual API response data.
   * Call after each API round with the input character count and reported tokens.
   */
  calibrate(totalChars: number, actualInputTokens: number): void {
    if (actualInputTokens <= 0 || totalChars <= 0) return;
    const measured = totalChars / actualInputTokens;
    // Clamp to reasonable range (1..6 chars/token)
    const clamped = Math.max(1, Math.min(6, measured));
    this.charsPerToken =
      this.charsPerToken * (1 - EMA_ALPHA) + clamped * EMA_ALPHA;
  }

  /**
   * Estimate token count from character count using the calibrated ratio.
   */
  estimate(chars: number): number {
    return Math.ceil(chars / this.charsPerToken);
  }

  /**
   * C2: content-aware estimate for callers that hold the actual text —
   * samples the CJK ratio instead of assuming the blended default ratio.
   */
  estimateText(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / estimateCharsPerToken(text));
  }

  /**
   * Get the current chars-per-token ratio (for debugging/testing).
   */
  getCharsPerToken(): number {
    return this.charsPerToken;
  }

  /**
   * Reset to initial ratio (e.g., on session switch).
   */
  reset(): void {
    this.charsPerToken = INITIAL_CHARS_PER_TOKEN;
  }
}

export default new TokenBudgetEstimator();
