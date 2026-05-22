/**
 * Logistic (S-curve) regression for revenue trend analysis.
 *
 * Model: f(t) = L / (1 + exp(-k * (t - t0)))
 *   L  = carrying capacity / plateau
 *   k  = steepness (growth rate in exponential phase)
 *   t0 = inflection year (where growth is fastest)
 *
 * Fitting strategy: linearise over a grid of candidate L values, then pick
 * the L that minimises residual sum of squares on the original scale.
 *
 * All monetary values in USD millions.
 */

export interface TrendPoint {
  year: number;
  value: number; // revenue or NII in USD M
}

export interface LogisticFitResult {
  L: number;            // plateau / carrying capacity (USD M)
  k: number;            // growth steepness parameter
  t0: number;           // inflection year (may be fractional)
  r_squared: number;    // goodness-of-fit (0–1)
  inflection_year: number; // Math.round(t0)
  fit_ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const ssXX = xs.reduce((a, x) => a + (x - meanX) ** 2, 0);
  const ssXY = xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0);
  if (ssXX === 0) return { slope: 0, intercept: meanY };
  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

function logistic(t: number, L: number, k: number, t0: number): number {
  return L / (1 + Math.exp(-k * (t - t0)));
}

function computeSSE(data: TrendPoint[], L: number, k: number, t0: number): number {
  return data.reduce((acc, d) => acc + (d.value - logistic(d.year, L, k, t0)) ** 2, 0);
}

function computeR2(data: TrendPoint[], L: number, k: number, t0: number): number {
  const meanY = data.reduce((a, d) => a + d.value, 0) / data.length;
  const sst = data.reduce((a, d) => a + (d.value - meanY) ** 2, 0);
  if (sst === 0) return 1;
  const sse = computeSSE(data, L, k, t0);
  return Math.max(0, 1 - sse / sst);
}

// ---------------------------------------------------------------------------
// Core fitting function
// ---------------------------------------------------------------------------

/**
 * Fit a logistic curve to `data`. Returns fit_ok=false when data is
 * insufficient (<3 points) or numerically degenerate.
 */
export function fitLogistic(data: TrendPoint[]): LogisticFitResult {
  // Filter out zero/negative values — logistic only models positive growth.
  const valid = data.filter((d) => d.value > 0).sort((a, b) => a.year - b.year);

  if (valid.length < 3) {
    return { L: 0, k: 0, t0: 0, r_squared: 0, inflection_year: 0, fit_ok: false, error: "Need ≥3 positive data points to fit logistic curve" };
  }

  const yMax = Math.max(...valid.map((d) => d.value));
  const tMin = valid[0].year;
  const tMax = valid[valid.length - 1].year;

  // Grid search: candidate L values from 5% above max observed to 5× max.
  // Use 60 steps on a log scale for coverage without being expensive.
  const L_MIN_FACTOR = 1.05;
  const L_MAX_FACTOR = 5;
  const GRID_STEPS = 60;

  let bestL = yMax * 1.5;
  let bestK = 0.3;
  let bestT0 = (tMin + tMax) / 2;
  let bestSSE = Infinity;

  for (let i = 0; i <= GRID_STEPS; i++) {
    const frac = i / GRID_STEPS;
    const L = yMax * Math.exp(Math.log(L_MIN_FACTOR) + frac * (Math.log(L_MAX_FACTOR) - Math.log(L_MIN_FACTOR)));

    // Linearise: z_i = ln(L/y_i - 1) = -k*(t_i - t0)
    // Only valid when y_i < L.
    if (valid.some((d) => d.value >= L)) continue;

    const ts = valid.map((d) => d.year);
    const zs = valid.map((d) => Math.log(L / d.value - 1));

    // Guard against NaN/Infinity in z
    if (zs.some((z) => !isFinite(z))) continue;

    const { slope, intercept } = linearRegression(ts, zs);

    // slope = -k, intercept = k * t0
    const k = -slope;
    if (k <= 0) continue; // degenerate (declining or flat trend)

    const t0 = intercept / k;

    const sse = computeSSE(valid, L, k, t0);
    if (sse < bestSSE) {
      bestSSE = sse;
      bestL = L;
      bestK = k;
      bestT0 = t0;
    }
  }

  if (!isFinite(bestSSE) || bestSSE === Infinity) {
    return { L: 0, k: 0, t0: 0, r_squared: 0, inflection_year: 0, fit_ok: false, error: "Grid search found no valid fit — all candidate plateaus exceeded observed values" };
  }

  const r2 = computeR2(valid, bestL, bestK, bestT0);

  return {
    L: bestL,
    k: bestK,
    t0: bestT0,
    r_squared: r2,
    inflection_year: Math.round(bestT0),
    fit_ok: true,
  };
}

// ---------------------------------------------------------------------------
// Derived metrics
// ---------------------------------------------------------------------------

/**
 * Discrete growth rate the logistic model predicts from lastYear → lastYear+1.
 * Returns percentage (e.g. 12.5 means 12.5%).
 */
export function computeNextYearGrowthPct(fit: LogisticFitResult, lastYear: number): number {
  const y_now = logistic(lastYear, fit.L, fit.k, fit.t0);
  const y_next = logistic(lastYear + 1, fit.L, fit.k, fit.t0);
  if (y_now <= 0) return 0;
  return ((y_next - y_now) / y_now) * 100;
}

/**
 * True when the segment is at ≥80% of its modeled plateau — i.e. saturation
 * is the dominant constraint rather than market development.
 */
export function isPlateau(fit: LogisticFitResult, lastValue: number): boolean {
  return fit.L > 0 && lastValue / fit.L >= 0.8;
}

/**
 * Naive two-point CAGR between the first and last positive data points.
 * **Deprecated for trend-analysis use** because it gives meaningless results
 * for any non-monotone series (segment rebrand, divestiture, cyclical decline,
 * one-time spike). Retained only for callers that explicitly want the legacy
 * behaviour; prefer `computeLogLinearGrowthPct` paired with `classifySeriesShape`.
 *
 * Returns null when data is insufficient.
 */
export function computeCagr(data: TrendPoint[]): number | null {
  const valid = data.filter((d) => d.value > 0).sort((a, b) => a.year - b.year);
  if (valid.length < 2) return null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const years = last.year - first.year;
  if (years === 0 || first.value <= 0) return null;
  return ((last.value / first.value) ** (1 / years) - 1) * 100;
}

// ---------------------------------------------------------------------------
// Shape classifier — preconditions for trustable fallback growth estimates
// ---------------------------------------------------------------------------

/**
 * Shape of a per-segment time series, used to decide whether a fallback
 * historical growth rate is meaningful or whether the segment's history
 * is too discontinuous to anchor a forecast.
 *
 *   "increasing"   — monotone non-decreasing; log-linear CAGR is meaningful.
 *   "decreasing"   — monotone non-increasing; likely scope change, divestiture,
 *                    or sunset segment — no forecast anchor should be derived.
 *   "non_monotone" — peak or trough strictly inside the window — likely scope
 *                    change, accounting reclassification, or one-time event.
 *   "insufficient" — fewer than 3 positive data points — no shape can be
 *                    inferred at all.
 *
 * Threshold: a year-over-year change within ±2 % is treated as "flat" so that
 * trivial measurement noise does not flip the shape classification.
 */
export type SeriesShape = "increasing" | "decreasing" | "non_monotone" | "insufficient";

export function classifySeriesShape(data: TrendPoint[]): SeriesShape {
  const valid = data.filter((d) => d.value > 0).sort((a, b) => a.year - b.year);
  if (valid.length < 3) return "insufficient";

  const FLAT_THRESHOLD = 0.02; // ±2 % YoY counts as flat
  let sawIncrease = false;
  let sawDecrease = false;

  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1].value;
    const curr = valid[i].value;
    const change = (curr - prev) / prev;
    if (change > FLAT_THRESHOLD) sawIncrease = true;
    if (change < -FLAT_THRESHOLD) sawDecrease = true;
  }

  if (sawIncrease && sawDecrease) return "non_monotone";
  if (sawIncrease) return "increasing";
  if (sawDecrease) return "decreasing";
  // All YoY changes were within ±2 % — treat as effectively flat / increasing
  // so the log-linear CAGR (≈ 0 %) gets through as a valid signal.
  return "increasing";
}

// ---------------------------------------------------------------------------
// Robust growth estimator — log-linear regression
// ---------------------------------------------------------------------------

/**
 * Annualised growth rate estimated by fitting ln(y) = α + β·t across ALL
 * data points and returning `(exp(β) - 1) × 100`. Unlike `computeCagr`, this
 * uses every observation and is robust to a single outlier year — much closer
 * to what an analyst means by "historical growth rate".
 *
 * Returns null when fewer than 2 positive data points are available or when
 * the regression is numerically degenerate (zero variance in years).
 *
 * Note: this still requires positive values; segments that hit zero at any
 * point are filtered out (logarithm undefined). Callers should classify the
 * series with `classifySeriesShape` first — for a strictly declining series
 * the regression slope will be negative and the result will be a negative
 * growth rate that should not be used to anchor a forward forecast.
 */
export function computeLogLinearGrowthPct(data: TrendPoint[]): number | null {
  const valid = data.filter((d) => d.value > 0).sort((a, b) => a.year - b.year);
  if (valid.length < 2) return null;

  // Need at least 2 distinct years — otherwise the regression is degenerate
  // (zero variance in x), which our linearRegression helper silently returns
  // as slope=0 rather than NaN. Refuse explicitly so callers get null
  // (the "no signal" path) instead of a fake 0% growth rate.
  const distinctYears = new Set(valid.map((d) => d.year));
  if (distinctYears.size < 2) return null;

  const ts = valid.map((d) => d.year);
  const ys = valid.map((d) => Math.log(d.value));
  const { slope } = linearRegression(ts, ys);

  if (!isFinite(slope)) return null;
  return (Math.exp(slope) - 1) * 100;
}
