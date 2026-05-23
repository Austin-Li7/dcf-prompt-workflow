import type { HistoricalExtractionRow, TrendAnalysisResult } from "@/types/cfp";

type SegmentMode = "bank" | "industrial" | "unknown";

interface AnnualValues {
  revenue_usdm: number | null;
  nii_usdm: number | null;
  nim_pct: number | null;
  op_margin_pct: number | null; // operatingIncome / revenue
}

/** Pick one representative row per fiscal year per segment (annual filing > Q4 > last seen). */
function pickAnnualRows(
  rows: HistoricalExtractionRow[],
  segment: string,
): Map<number, HistoricalExtractionRow> {
  const byYear = new Map<number, HistoricalExtractionRow>();
  for (const row of rows) {
    if (row.segment !== segment) continue;
    const existing = byYear.get(row.fiscalYear);
    if (!existing) {
      byYear.set(row.fiscalYear, row);
    } else if (row.isAnnualFiling && !existing.isAnnualFiling) {
      byYear.set(row.fiscalYear, row);
    } else if (row.quarter === "Q4" && existing.quarter !== "Q4" && !existing.isAnnualFiling) {
      byYear.set(row.fiscalYear, row);
    }
  }
  return byYear;
}

function extractAnnualValues(row: HistoricalExtractionRow): AnnualValues {
  const opMargin =
    row.operatingIncome != null && row.revenue != null && row.revenue > 0
      ? Math.round((row.operatingIncome / row.revenue) * 1000) / 10
      : null;
  return {
    revenue_usdm: row.revenue ?? null,
    nii_usdm: row.nii_usd_m ?? null,
    nim_pct: row.net_interest_margin_pct ?? null,
    op_margin_pct: opMargin,
  };
}

/** 3-year CAGR using up to 4 annual data points (3-year span). Returns null when <2 points. */
function computeCagr(sortedPoints: { year: number; value: number }[]): number | null {
  if (sortedPoints.length < 2) return null;
  const pts = sortedPoints.slice(-4); // last 4 → 3-year span max
  const first = pts[0];
  const last = pts[pts.length - 1];
  const years = last.year - first.year;
  if (years === 0 || first.value <= 0) return null;
  return Math.round((Math.pow(last.value / first.value, 1 / years) - 1) * 1000) / 10;
}

function inferMode(rows: HistoricalExtractionRow[]): SegmentMode {
  for (const r of rows) {
    if (r.workflow_mode === "bank") return "bank";
    if (r.workflow_mode === "industrial") return "industrial";
  }
  return "unknown";
}

function fmtUsd(v: number | null): string {
  if (v === null) return "n/a";
  return `$${(v / 1000 >= 1 ? `${(v / 1000).toFixed(2)}B` : `${Math.round(v)}M`)}`;
}

function fmtPct(v: number | null, precision = 1): string {
  if (v === null) return "n/a";
  return `${v >= 0 ? "+" : ""}${v.toFixed(precision)}%`;
}

/**
 * Builds a compact text block summarising Step 2 financial data by segment.
 * Injected into the Step 3 competitive analysis prompt so the LLM can
 * benchmark competitive forces against actual financials rather than
 * producing qualitative-only narrative.
 *
 * Returns null when rows is empty (Step 2 was skipped) — callers omit the block.
 */
export function buildStep2FinancialSummary(
  rows: HistoricalExtractionRow[],
  trendAnalysis?: TrendAnalysisResult | null,
): string | null {
  if (!rows || rows.length === 0) return null;

  // Group by segment
  const segments = [...new Set(rows.map((r) => r.segment))].filter(Boolean);
  if (segments.length === 0) return null;

  const lines: string[] = [
    "--- STEP 2 FINANCIAL BASELINE (use these numbers when benchmarking competitive forces) ---",
  ];

  for (const seg of segments) {
    const segRows = rows.filter((r) => r.segment === seg);
    const mode = inferMode(segRows);
    const annualRows = pickAnnualRows(rows, seg);
    if (annualRows.size === 0) continue;

    const sortedYears = [...annualRows.keys()].sort((a, b) => a - b);
    const latestYear = sortedYears[sortedYears.length - 1];
    const latestVals = extractAnnualValues(annualRows.get(latestYear)!);

    // CAGR: use NII for bank, revenue for industrial
    const metricPoints = sortedYears
      .map((y) => {
        const v = extractAnnualValues(annualRows.get(y)!);
        const val = mode === "bank" ? v.nii_usdm : v.revenue_usdm;
        return val != null && val > 0 ? { year: y, value: val } : null;
      })
      .filter((p): p is { year: number; value: number } => p !== null);

    const cagr = computeCagr(metricPoints);
    const trend = trendAnalysis?.segments[seg];

    const modeLabel = mode === "bank" ? "bank" : mode === "industrial" ? "industrial" : "?";
    lines.push(`\n${seg} [${modeLabel}, FY${latestYear}]:`);

    if (mode === "bank") {
      lines.push(`  NII: ${fmtUsd(latestVals.nii_usdm)} | NIM: ${latestVals.nim_pct != null ? `${latestVals.nim_pct.toFixed(2)}%` : "n/a"} | 3yr NII CAGR: ${fmtPct(cagr)}`);
    } else {
      lines.push(`  Revenue: ${fmtUsd(latestVals.revenue_usdm)} | Op. margin: ${latestVals.op_margin_pct != null ? `${latestVals.op_margin_pct.toFixed(1)}%` : "n/a"} | 3yr rev CAGR: ${fmtPct(cagr)}`);
    }

    if (trend?.fit_ok) {
      lines.push(
        `  S-curve ceiling: ${fmtUsd(trend.calculated_plateau_ceiling_usd_m)} | ` +
        `Next-year growth limit: ${fmtPct(trend.modeled_next_year_growth_limit_pct)} | ` +
        `Plateau: ${trend.is_plateau_detected ? "DETECTED" : "not yet"}`,
      );
    } else if (trend) {
      lines.push(`  S-curve: no reliable fit (${trend.review_note ?? "insufficient data"})`);
    }
  }

  lines.push("\n--- END STEP 2 BASELINE ---");
  return lines.join("\n");
}
