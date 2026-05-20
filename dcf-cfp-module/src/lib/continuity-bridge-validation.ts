import type { ContinuityBridge } from "@/types/cfp";

// Percentage weights are stored as 0–100. Allow 0.01pp floating-point tolerance.
const WEIGHT_SUM_EPSILON = 0.01;

export class WeightValidationError extends Error {
  readonly bridge: ContinuityBridge;
  readonly oldSegment: string;
  readonly actualSum: number;

  constructor(bridge: ContinuityBridge, oldSegment: string, actualSum: number) {
    const detail = `Weights for old segment "${oldSegment}" sum to ${actualSum.toFixed(4)}% — must be 100% ± ${WEIGHT_SUM_EPSILON}%`;
    super(`[ContinuityBridge ${bridge.id}] Weight leak/duplication detected. ${detail}`);
    this.name = "WeightValidationError";
    this.bridge = bridge;
    this.oldSegment = oldSegment;
    this.actualSum = actualSum;
  }
}

/**
 * Validates that for split events every old segment's weights sum to 100%.
 *
 * Splits: weights[oldSeg][*] must sum to 100 ± EPSILON per old segment.
 * Merges/renames/discontinuations: each old segment maps 100% to exactly one
 * destination, so they trivially pass, but we still validate for defense-in-depth.
 *
 * Throws WeightValidationError on the first violation found.
 */
export function validateContinuityBridgeWeights(bridge: ContinuityBridge): void {
  // Only weight-bearing events need validation; if weights is empty, skip.
  if (Object.keys(bridge.weights).length === 0) return;

  for (const oldSegment of Object.keys(bridge.weights)) {
    const mapping = bridge.weights[oldSegment];
    const sum = Object.values(mapping).reduce((acc, v) => acc + v, 0);

    if (Math.abs(sum - 100) > WEIGHT_SUM_EPSILON) {
      throw new WeightValidationError(bridge, oldSegment, sum);
    }
  }
}

/**
 * Validates all bridges in a list. Throws on the first weight violation.
 */
export function validateAllBridgeWeights(bridges: ContinuityBridge[]): void {
  for (const bridge of bridges) {
    validateContinuityBridgeWeights(bridge);
  }
}
