/**
 * Score Fusion — combines AI and heuristic scores
 *
 * Extracted from paper-scorer.ts for SRP.
 */

import { DEFAULT_AI_WEIGHT } from "../../../utils/constants";

/**
 * Fuse AI and heuristic scores
 *
 * - AI success: aiScore * aiWeight + heuristicScore * (1 - aiWeight)
 * - AI failure (aiScore === 0): heuristicScore * 0.6, capped at 50
 */
export function fuseScores(
  aiScore: number,
  heuristicScore: number,
  aiWeight: number = DEFAULT_AI_WEIGHT,
): number {
  if (aiScore === 0) {
    return Math.round(Math.min(heuristicScore * 0.6, 50));
  }
  return Math.round(aiScore * aiWeight + heuristicScore * (1 - aiWeight));
}
