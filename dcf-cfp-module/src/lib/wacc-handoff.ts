import type { BusinessArchitecture, ForecastState, Step5ForecastRow } from "../types/cfp.ts";
import type { WACCSegmentRow } from "../types/wacc.ts";
import { getStep5StructuredResults } from "./aggregate-forecast.ts";

// =============================================================================
// Industry beta lookup (Damodaran Jan 2025 median unlevered betas)
// =============================================================================

/**
 * Ordered [keyword, unleveredBeta] pairs.  First match wins.
 * Segment names are lower-cased and punctuation-stripped before matching.
 * Order matters: more-specific terms must precede overlapping broader ones
 * (e.g. "semiconductor" before "tech", "manufacturing" before "retail").
 */
const INDUSTRY_BETA_KEYWORDS: Array<[string, number]> = [
  // Insurance (before "financial" / "investment")
  ["insurance",       0.55],
  // Railroads (before "rail" substring appears in other words)
  ["railroad",        0.80],
  ["rail",            0.80],
  // Utilities — regulated (before generic "energy")
  ["utility",         0.35],
  ["utilities",       0.35],
  // Oil & Gas & Energy
  ["oil",             0.70],
  ["gas",             0.65],
  ["energy",          0.65],
  // Semiconductor (before broader "tech")
  ["semiconductor",   1.25],
  ["chip",            1.20],
  // Biotech (before "health" and "tech")
  ["biotech",         1.50],
  ["biopharm",        1.30],
  // Software / SaaS / Cloud (before generic "tech")
  ["software",        1.15],
  ["saas",            1.20],
  ["cloud",           1.15],
  // Hardware / Electronics (before generic "tech")
  ["hardware",        1.05],
  ["electronics",     1.05],
  // Technology — broad
  ["technology",      1.10],
  ["tech",            1.10],
  ["digital",         1.05],
  // Pharma / Healthcare
  ["pharma",          1.00],
  ["health",          0.90],
  ["medical",         0.85],
  // Aerospace / Defense
  ["aerospace",       0.85],
  ["defense",         0.80],
  // Automotive (before short "auto" prefix)
  ["automotive",      0.90],
  ["auto",            0.90],
  // Industrial / Manufacturing — MUST precede "retail" so "manufacturing_service_retailing" hits here
  ["manufacturing",   0.90],
  ["industrial",      0.90],
  // Gaming / Media / Entertainment
  ["gaming",          1.10],
  ["game",            1.10],
  ["media",           0.95],
  ["entertainment",   0.95],
  // Telecom / Wireless
  ["telecom",         0.70],
  ["wireless",        0.75],
  // Real Estate / REIT
  ["real estate",     0.65],
  ["reit",            0.65],
  // Financial services (after "insurance")
  ["investment",      0.65],
  ["financial",       0.65],
  ["banking",         0.65],
  ["bank",            0.65],
  // Travel / Hospitality
  ["travel",          0.85],
  ["hotel",           0.90],
  ["hospitality",     0.90],
  // E-commerce (before plain "retail")
  ["ecommerce",       1.05],
  // Food / Beverage — lower beta than generic distribution; must precede "distribution"
  ["food",            0.60],
  ["beverage",        0.65],
  // Distribution / Wholesale (before "retail")
  ["distribution",    0.70],
  ["wholesale",       0.70],
  // Retail (after distribution/wholesale/manufacturing)
  ["retail",          0.75],
  // Consumer — broad
  ["consumer",        0.85],
  // Advertising
  ["advertising",     1.00],
];

/**
 * Estimate an unlevered beta for a segment from its name alone.
 * Normalises the name (lower-case, punctuation → spaces) then returns the
 * beta for the first matching keyword.  Falls back to 1.0 when no keyword
 * matches.
 */
export function inferUnleveredBeta(segmentName: string): number {
  const normalized = segmentName
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [keyword, beta] of INDUSTRY_BETA_KEYWORDS) {
    if (normalized.includes(keyword)) return beta;
  }
  return 1.0;
}

export function buildWaccSegmentsFromCFP(
  architecture: BusinessArchitecture | null | undefined,
  forecast: ForecastState,
  makeId: (segmentName: string) => string,
): WACCSegmentRow[] {
  const segments = architecture?.architecture ?? [];
  return segments.map((segment) => ({
    id: makeId(segment.segment),
    name: segment.segment,
    unleveredBeta: inferUnleveredBeta(segment.segment),
    estimatedValue: Math.round(
      structuredFy5RevenueForSegment(forecast, segment.segment) ??
      legacyFy5RevenueForSegment(forecast, segment.segment),
    ),
  }));
}

function structuredFy5RevenueForSegment(
  forecast: ForecastState,
  segmentName: string,
): number | null {
  const rows = getStep5StructuredResults(forecast).flatMap(
    (result) => result.machine_artifact.forecast_table,
  );
  const fy5Rows = rows.filter(
    (row) => segmentNamesMatch(row.segment, segmentName) && forecastYearIndex(row) === 5,
  );

  if (fy5Rows.length === 0) return null;
  return fy5Rows.reduce((sum, row) => sum + row.revenue_base_usd_m, 0);
}

function legacyFy5RevenueForSegment(forecast: ForecastState, segmentName: string): number {
  const matchingForecast = forecast.segments.find((segment) =>
    segmentNamesMatch(segment.segment, segmentName),
  );
  if (!matchingForecast) return 0;

  return matchingForecast.products.reduce(
    (segmentTotal, product) =>
      segmentTotal +
      product.forecast
        .filter((point) => point.year === 5)
        .reduce((productTotal, point) => productTotal + point.revenueM, 0),
    0,
  );
}

function forecastYearIndex(row: Step5ForecastRow): number | null {
  const plusMatch = row.fiscal_year.match(/FY\+?(\d+)/i);
  if (plusMatch) return Number(plusMatch[1]);

  const plainMatch = row.fiscal_year.match(/Y(?:ear)?\s*(\d+)/i);
  if (plainMatch) return Number(plainMatch[1]);

  const numericMatch = row.fiscal_year.match(/(\d+)/);
  if (numericMatch) return Number(numericMatch[1]);

  return null;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isHardwareLike(value: string): boolean {
  const normalized = normalizeName(value);
  return normalized.includes("hardware") || normalized === "products";
}

function segmentNamesMatch(source: string, target: string): boolean {
  const sourceName = normalizeName(source);
  const targetName = normalizeName(target);
  if (sourceName === targetName) return true;
  return isHardwareLike(source) && isHardwareLike(target);
}
