import { NextRequest, NextResponse } from "next/server";
import {
  fitLogistic,
  computeNextYearGrowthPct,
  isPlateau,
  computeCagr,
  type TrendPoint,
} from "@/lib/logistic-regression";
import type { HistoricalExtractionRow, SegmentTrendResult, TrendAnalysisResult } from "@/types/cfp";

// =============================================================================
// POST /api/trend-analysis
//
// Runs a logistic S-curve regression on the Step 2 historical timeline per
// segment. Returns deterministic plateau ceiling, saturation flag, and growth
// limit — no LLM involved. Claude receives this as hard boundary conditions
// for Steps 4 and 5.
// =============================================================================

interface TrendAnalysisRequest {
  rows: HistoricalExtractionRow[];
  steady_growth_start_year?: number | null; // user override; null = auto-detect
  workflow_mode?: "industrial" | "bank";
}

export interface TrendAnalysisApiResponse {
  result: TrendAnalysisResult | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Primary metric resolver
// ---------------------------------------------------------------------------
// For bank mode use NII as the primary metric (equivalent to revenue).
// For industrial use the standard revenue field.

function resolveMetric(row: HistoricalExtractionRow): number | null {
  if (row.workflow_mode === "bank") {
    return row.nii_usd_m ?? null;
  }
  return row.revenue ?? null;
}

// ---------------------------------------------------------------------------
// Per-segment time series builder
// ---------------------------------------------------------------------------

function buildSegmentSeries(
  rows: HistoricalExtractionRow[],
): Map<string, TrendPoint[]> {
  const map = new Map<string, TrendPoint[]>();

  for (const row of rows) {
    const value = resolveMetric(row);
    if (value == null || value <= 0) continue;

    const seg = row.segment;
    if (!map.has(seg)) map.set(seg, []);

    // Aggregate by year (Q1–Q4 rolled up if needed — pick annual if available)
    const existing = map.get(seg)!;
    const sameYear = existing.find((p) => p.year === row.fiscalYear);
    if (sameYear) {
      // Keep maximum value per year (annual rows dominate quarterly)
      if (value > sameYear.value) sameYear.value = value;
    } else {
      existing.push({ year: row.fiscalYear, value });
    }
  }

  // Sort each series by year ascending
  for (const [, series] of map) {
    series.sort((a, b) => a.year - b.year);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Auto-detect steady growth year
// Returns the inflection year if most segments have it, else the first data year.
// ---------------------------------------------------------------------------

function autoDetectSteadyGrowthYear(
  segmentResults: Record<string, SegmentTrendResult>,
): number | null {
  const inflections = Object.values(segmentResults)
    .map((r) => r.inflection_year)
    .filter((y): y is number => y != null);

  if (inflections.length === 0) return null;

  // Use the median inflection year across segments
  inflections.sort((a, b) => a - b);
  return inflections[Math.floor(inflections.length / 2)];
}

// ---------------------------------------------------------------------------
// Fit one segment
// ---------------------------------------------------------------------------

function fitSegment(
  segName: string,
  series: TrendPoint[],
  userSteadyYear: number | null,
): SegmentTrendResult {
  const lastPoint = series[series.length - 1];
  const lastYear = lastPoint.year;
  const lastValue = lastPoint.value;

  // --- Attempt logistic fit ---
  const fit = fitLogistic(series);

  if (fit.fit_ok) {
    const growthLimitPct = computeNextYearGrowthPct(fit, lastYear);
    const saturated = isPlateau(fit, lastValue);

    // Steady growth year: user override > inflection year (auto)
    const steadyYear = userSteadyYear ?? fit.inflection_year;

    return {
      calculated_plateau_ceiling_usd_m: Math.round(fit.L * 100) / 100,
      is_plateau_detected: saturated,
      modeled_next_year_growth_limit_pct: Math.round(growthLimitPct * 100) / 100,
      inflection_year: fit.inflection_year,
      steady_growth_start_year: steadyYear,
      data_points_used: series.length,
      fit_quality_r2: Math.round(fit.r_squared * 10000) / 10000,
      fit_ok: true,
      review_note: buildReviewNote(segName, fit.r_squared, saturated, growthLimitPct),
    };
  }

  // --- Fallback: CAGR when logistic fit failed ---
  const cagr = computeCagr(series);
  const steadyYear = userSteadyYear ?? lastYear;

  return {
    calculated_plateau_ceiling_usd_m: null,
    is_plateau_detected: false,
    modeled_next_year_growth_limit_pct: cagr != null ? Math.round(cagr * 100) / 100 : null,
    inflection_year: null,
    steady_growth_start_year: steadyYear,
    data_points_used: series.length,
    fit_quality_r2: null,
    fit_ok: false,
    review_note: `Logistic fit failed (${fit.error ?? "unknown reason"}). ${
      cagr != null
        ? `CAGR fallback used: ${cagr.toFixed(1)}%.`
        : "Insufficient data for any growth estimate."
    }`,
  };
}

function buildReviewNote(
  segName: string,
  r2: number,
  saturated: boolean,
  growthLimitPct: number,
): string {
  const quality = r2 >= 0.9 ? "High" : r2 >= 0.7 ? "Moderate" : "Low";
  const satNote = saturated ? " Segment appears saturated (≥80% of plateau)." : "";
  return `${segName}: ${quality} fit quality (R²=${r2.toFixed(3)}). Next-year growth ceiling: ${growthLimitPct.toFixed(1)}%.${satNote}`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse<TrendAnalysisApiResponse>> {
  try {
    const body = (await req.json()) as TrendAnalysisRequest;
    const { rows, steady_growth_start_year = null } = body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ result: null, error: "rows array is required and must not be empty." }, { status: 400 });
    }

    const seriesMap = buildSegmentSeries(rows);

    if (seriesMap.size === 0) {
      return NextResponse.json({ result: null, error: "No segments with positive revenue data found in rows." }, { status: 422 });
    }

    const segments: Record<string, SegmentTrendResult> = {};
    for (const [segName, series] of seriesMap) {
      segments[segName] = fitSegment(segName, series, steady_growth_start_year ?? null);
    }

    const autoYear = autoDetectSteadyGrowthYear(segments);

    const result: TrendAnalysisResult = {
      segments,
      auto_detected_steady_growth_year: autoYear,
      user_override_steady_growth_year: steady_growth_start_year ?? null,
      analysis_timestamp: new Date().toISOString(),
    };

    return NextResponse.json({ result });
  } catch (err: unknown) {
    console.error("[trend-analysis] Error:", err);
    const msg = err instanceof Error ? err.message : "Unexpected error during trend analysis.";
    return NextResponse.json({ result: null, error: msg }, { status: 500 });
  }
}
