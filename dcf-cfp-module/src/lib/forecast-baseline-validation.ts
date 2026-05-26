import type { ForecastState, HistoricalExtractionRow } from "@/types/cfp.ts";
import { aggregateSegmentForecastFy, getStep5StructuredResults } from "./aggregate-forecast.ts";

export interface ForecastBaselineWarning {
  segment: string;
  code: "PARTIAL_YEAR_BASELINE";
  message: string;
}

/**
 * Cross-checks each segment's Step 5 FY1 forecast against its Step 2 history to
 * catch a forecast that was anchored to a partial reporting period (a single
 * stub quarter) instead of the last complete fiscal year.
 *
 * This is the defect behind the SoFi Financial Services case: the latest Step 2
 * year held only Q1, and the FY1 forecast (~$228M) was carried forward from that
 * stub rather than the full prior year (~$3,098M), undermodeling the segment by
 * ~13x and collapsing its contribution to enterprise value.
 *
 * The check fires only when the FY1 forecast both (a) sits far below the last
 * complete historical year AND (b) closely matches the incomplete latest year.
 * Requiring the partial-year match avoids false positives on bank segments,
 * whose FY1 forecast (NII-based) is legitimately well below gross historical
 * revenue but does NOT line up with a single quarter.
 */
export function validateForecastBaseline(
  forecastState: ForecastState,
  historyRows: HistoricalExtractionRow[],
): ForecastBaselineWarning[] {
  if (!historyRows.length) return [];

  const segments = Array.from(
    new Set(
      getStep5StructuredResults(forecastState)
        .flatMap((result) => result.machine_artifact.forecast_table)
        .map((row) => row.segment)
        .filter(Boolean),
    ),
  );

  const warnings: ForecastBaselineWarning[] = [];

  for (const segment of segments) {
    const forecastFy1 = aggregateSegmentForecastFy([segment], forecastState)[0];
    if (!(forecastFy1 > 0)) continue;

    const history = summarizeSegmentHistory(segment, historyRows);
    if (history.lastCompleteRevenue === null || history.lastCompleteRevenue <= 0) continue;
    if (history.partialYear === null) continue;

    const belowLastComplete = forecastFy1 < 0.5 * history.lastCompleteRevenue;
    const matchesPartial =
      history.partialRevenue > 0 &&
      Math.abs(forecastFy1 - history.partialRevenue) <= 0.3 * history.partialRevenue;

    if (belowLastComplete && matchesPartial) {
      const pctOfFull = Math.round((forecastFy1 / history.lastCompleteRevenue) * 100);
      warnings.push({
        segment,
        code: "PARTIAL_YEAR_BASELINE",
        message:
          `${segment}: FY1 forecast ($${round(forecastFy1)}M) matches the partial ${history.partialYear} ` +
          `period ($${round(history.partialRevenue)}M) and is only ${pctOfFull}% of the last full year ` +
          `(${history.lastCompleteYear}: $${round(history.lastCompleteRevenue)}M). The Step 5 baseline may be ` +
          `a single quarter rather than the annualized figure — verify Step 2 annualization before relying on this valuation.`,
      });
    }
  }

  return warnings;
}

interface SegmentHistorySummary {
  lastCompleteYear: number | null;
  lastCompleteRevenue: number | null;
  partialYear: number | null;
  partialRevenue: number;
}

/**
 * Per-segment annual revenue from Step 2 rows. A year is "complete" when it
 * carries four quarterly rows or an annual-filing row; otherwise it is treated
 * as a partial (stub) period. Revenue falls back to NII + non-interest income
 * for bank-mode rows where the plain revenue field is null.
 */
function summarizeSegmentHistory(
  segment: string,
  historyRows: HistoricalExtractionRow[],
): SegmentHistorySummary {
  const byYear = new Map<number, { revenue: number; quarters: Set<string>; annual: boolean }>();

  for (const row of historyRows) {
    if (row.segment !== segment) continue;
    const value =
      row.revenue ?? ((row.nii_usd_m ?? 0) + (row.non_interest_income_usd_m ?? 0) || null);
    if (value === null) continue;
    const entry = byYear.get(row.fiscalYear) ?? { revenue: 0, quarters: new Set<string>(), annual: false };
    entry.revenue += value;
    if (row.quarter) entry.quarters.add(row.quarter);
    if (row.isAnnualFiling) entry.annual = true;
    byYear.set(row.fiscalYear, entry);
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  let lastCompleteYear: number | null = null;
  let lastCompleteRevenue: number | null = null;
  for (const year of years) {
    const entry = byYear.get(year)!;
    if (entry.annual || entry.quarters.size >= 4) {
      lastCompleteYear = year;
      lastCompleteRevenue = entry.revenue;
    }
  }

  const latestYear = years.length ? years[years.length - 1] : null;
  const latestEntry = latestYear !== null ? byYear.get(latestYear)! : null;
  const latestIsPartial =
    latestEntry !== null && !latestEntry.annual && latestEntry.quarters.size < 4;

  return {
    lastCompleteYear,
    lastCompleteRevenue,
    partialYear: latestIsPartial ? latestYear : null,
    partialRevenue: latestIsPartial ? latestEntry!.revenue : 0,
  };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
