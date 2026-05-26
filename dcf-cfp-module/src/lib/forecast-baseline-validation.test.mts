import test from "node:test";
import assert from "node:assert/strict";

import { validateForecastBaseline } from "./forecast-baseline-validation.ts";
import type { ForecastState, HistoricalExtractionRow, Step5StructuredResult } from "../types/cfp.ts";

function annualForecast(segment: string, fy1: number): Step5StructuredResult {
  const values = [fy1, fy1 * 1.05, fy1 * 1.1, fy1 * 1.15, fy1 * 1.2];
  return {
    schema_version: "v5.5",
    company_name: "SoFi Technologies, Inc.",
    review_summary: { one_line: "", highlights: [], warnings: [] },
    machine_artifact: {
      forecast_mode: "SEGMENT_ANNUAL",
      assumptions: [],
      forecast_table: [2026, 2027, 2028, 2029, 2030].map((year, index) => ({
        segment,
        category: segment,
        product: null,
        fiscal_year: String(year),
        quarter: null,
        revenue_low_usd_m: values[index] * 0.95,
        revenue_base_usd_m: values[index],
        revenue_high_usd_m: values[index] * 1.05,
        yoy_growth_pct: 5,
        assumption_ids: [],
        driver_quality: "DISCLOSED",
        flags: [],
      })),
      weak_inference_sensitivity: [],
      confidence_summary: {
        total_fy5_revenue_base_usd_m: values[4],
        disclosed_driver_revenue_pct: 100,
        strong_driver_revenue_pct: 0,
        weak_driver_revenue_pct: 0,
        high_uncertainty_flags: 0,
      },
      workflow_status: "READY",
      next_action: "PROCEED_STEP7",
    },
  };
}

function histRow(segment: string, year: number, quarter: string, revenue: number): HistoricalExtractionRow {
  return {
    id: `${segment}-${year}-${quarter}`,
    fiscalYear: year,
    quarter,
    segment,
    productCategory: segment,
    productName: segment,
    revenue,
    yoyGrowth: 0,
    operatingIncome: null,
    notes: "",
  };
}

/** Four quarters summing to `annual` for a complete year. */
function completeYear(segment: string, year: number, annual: number): HistoricalExtractionRow[] {
  return ["Q1", "Q2", "Q3", "Q4"].map((q) => histRow(segment, year, q, annual / 4));
}

test("flags a segment whose FY1 forecast matches a partial-year stub instead of the full prior year", () => {
  const forecast: ForecastState = {
    approved: true,
    segments: [],
    structuredResults: [
      // Financial Services anchored to the Q1-2026 stub (~228) rather than full 2025 (~3098).
      annualForecast("Financial Services", 228),
      // Lending forecast (NII-based ~1762) is far below gross history but does NOT match its stub (500).
      annualForecast("Lending", 1762),
    ],
  };

  const history: HistoricalExtractionRow[] = [
    ...completeYear("Financial Services", 2024, 1968),
    ...completeYear("Financial Services", 2025, 3098),
    histRow("Financial Services", 2026, "Q1", 228), // partial latest year
    ...completeYear("Lending", 2024, 3900),
    ...completeYear("Lending", 2025, 5061),
    histRow("Lending", 2026, "Q1", 500), // partial — does not match 1762 forecast
  ];

  const warnings = validateForecastBaseline(forecast, history);

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].segment, "Financial Services");
  assert.equal(warnings[0].code, "PARTIAL_YEAR_BASELINE");
  assert.match(warnings[0].message, /partial 2026/);
  assert.match(warnings[0].message, /7% of the last full year/);
});

test("does not flag when the latest historical year is complete", () => {
  const forecast: ForecastState = {
    approved: true,
    segments: [],
    structuredResults: [annualForecast("Financial Services", 228)],
  };
  const history: HistoricalExtractionRow[] = [
    ...completeYear("Financial Services", 2024, 1968),
    ...completeYear("Financial Services", 2025, 3098), // complete, no stub
  ];

  assert.equal(validateForecastBaseline(forecast, history).length, 0);
});

test("does not flag a healthy forecast that continues the full-year trend", () => {
  const forecast: ForecastState = {
    approved: true,
    segments: [],
    structuredResults: [annualForecast("Financial Services", 3300)],
  };
  const history: HistoricalExtractionRow[] = [
    ...completeYear("Financial Services", 2024, 1968),
    ...completeYear("Financial Services", 2025, 3098),
    histRow("Financial Services", 2026, "Q1", 850),
  ];

  assert.equal(validateForecastBaseline(forecast, history).length, 0);
});
