/**
 * capex-efficiency.ts
 *
 * Deterministic CapEx efficiency engine — no LLM involved.
 *
 * Implements the two-task analysis defined in the project spec:
 *
 *   Task 2: CapEx-to-D&A Ratio (internal investment baseline)
 *     > 1.15  → Growth Phase
 *     0.85–1.15 → Maintenance / Steady State
 *     < 0.85  → Underinvestment / Potential Decay (flag)
 *
 *   Task 3: Damodaran Industry Benchmarking
 *     CapEx/Sales vs. industry average
 *     > 20% above avg → High Capital Intensity (verify MD&A)
 *     > 20% below avg → Asset-Light / Underinvestment (verify)
 *     ±20%            → In-line with peers
 *
 * Outputs a deterministic efficiency_score (-5 to +5) for use in
 * Step 4 capital_metrics, replacing the prior LLM-judged score.
 */

import {
  getDamodaranCapExBenchmark,
  resolveDamodaranCapExIndustry,
} from "./damodaran-capex";

// =============================================================================
// Types
// =============================================================================

export type CapExZone =
  | "growth"         // CapEx/D&A > 1.15
  | "steady_state"   // CapEx/D&A 0.85 – 1.15
  | "underinvestment"// CapEx/D&A < 0.85
  | "insufficient_data";

export type CapExIntensityFlag =
  | "high_intensity"     // >20% above Damodaran industry avg
  | "in_line"            // within ±20%
  | "asset_light"        // >20% below industry avg
  | "insufficient_data"; // no Damodaran benchmark available

export interface CapExEfficiencyResult {
  // ── Task 2: CapEx / D&A ─────────────────────────────────────────────────
  capex_usd_m: number | null;
  da_usd_m: number | null;
  capex_to_da_ratio: number | null;
  capex_da_zone: CapExZone;

  // ── Task 3: Damodaran benchmarking ───────────────────────────────────────
  revenue_usd_m: number | null;
  capex_to_sales_ratio: number | null;
  damodaran_industry: string | null;
  damodaran_avg_capex_to_sales: number | null;
  damodaran_avg_capex_to_da: number | null;
  /** Percentage variance: (company − industry) / industry × 100 */
  variance_vs_industry_pct: number | null;
  intensity_flag: CapExIntensityFlag;

  // ── Task 1B: MD&A qualitative split (from Step 2 extraction) ─────────────
  capex_maintenance_usd_m: number | null;
  capex_growth_usd_m: number | null;
  capex_guidance_note: string | null;

  // ── Derived deterministic score ──────────────────────────────────────────
  /** Integer −5 to +5 replacing the prior LLM-judged efficiency_score */
  efficiency_score: number;
  score_rationale: string;
}

// =============================================================================
// Zone classification (Task 2)
// =============================================================================

const DA_GROWTH_THRESHOLD = 1.15;
const DA_UNDERINVEST_THRESHOLD = 0.85;

function classifyCapExZone(capexToDaRatio: number): CapExZone {
  if (capexToDaRatio > DA_GROWTH_THRESHOLD) return "growth";
  if (capexToDaRatio >= DA_UNDERINVEST_THRESHOLD) return "steady_state";
  return "underinvestment";
}

// =============================================================================
// Intensity flag (Task 3)
// =============================================================================

const INTENSITY_VARIANCE_THRESHOLD = 0.20; // ±20%

function classifyIntensityFlag(
  companyRatio: number,
  industryAvgRatio: number,
): CapExIntensityFlag {
  const variance = (companyRatio - industryAvgRatio) / industryAvgRatio;
  if (variance > INTENSITY_VARIANCE_THRESHOLD) return "high_intensity";
  if (variance < -INTENSITY_VARIANCE_THRESHOLD) return "asset_light";
  return "in_line";
}

// =============================================================================
// Deterministic efficiency_score mapping
// =============================================================================

/**
 * Two-dimensional score lookup:
 *
 * Zone          | asset_light | in_line | high_intensity
 * --------------|-------------|---------|---------------
 * growth        |     +4      |   +3    |      +1
 * steady_state  |     +1      |    0    |      -2
 * underinvestment|    -2      |   -3    |      -5
 *
 * Rationale:
 *   - Growth + asset_light = +4: investing aggressively AND below peers → best efficiency
 *   - Growth + high_intensity = +1: growing but expensive vs. peers
 *   - Underinvestment + high_intensity = -5: spending a lot but still not maintaining → worst case
 *   - Underinvestment + asset_light = -2: may be intentional outsourcing, less severe
 */
const SCORE_TABLE: Record<CapExZone, Record<CapExIntensityFlag, number>> = {
  growth:          { asset_light: 4,  in_line: 3,  high_intensity: 1,  insufficient_data: 2  },
  steady_state:    { asset_light: 1,  in_line: 0,  high_intensity: -2, insufficient_data: 0  },
  underinvestment: { asset_light: -2, in_line: -3, high_intensity: -5, insufficient_data: -2 },
  insufficient_data:{ asset_light: 0, in_line: 0,  high_intensity: 0,  insufficient_data: 0  },
};

function deriveEfficiencyScore(
  zone: CapExZone,
  flag: CapExIntensityFlag,
): { score: number; rationale: string } {
  const score = SCORE_TABLE[zone][flag];
  const clamped = Math.max(-5, Math.min(5, score));

  const zoneLabel: Record<CapExZone, string> = {
    growth: "Growth (CapEx/D&A > 1.15)",
    steady_state: "Steady State (CapEx/D&A 0.85–1.15)",
    underinvestment: "Underinvestment (CapEx/D&A < 0.85)",
    insufficient_data: "Insufficient Data",
  };
  const flagLabel: Record<CapExIntensityFlag, string> = {
    high_intensity: "High Intensity (>20% above industry avg)",
    in_line: "In-line with industry (±20%)",
    asset_light: "Asset-Light (<20% below industry avg)",
    insufficient_data: "No Damodaran benchmark available",
  };

  return {
    score: clamped,
    rationale: `${zoneLabel[zone]} + ${flagLabel[flag]} → score ${clamped}`,
  };
}

// =============================================================================
// Step 2 data extraction helpers
// =============================================================================

interface AggregatedCapExInputs {
  capex_usd_m: number | null;
  da_usd_m: number | null;
  revenue_usd_m: number | null;
  capex_maintenance_usd_m: number | null;
  capex_growth_usd_m: number | null;
  capex_guidance_note: string | null;
}

/**
 * Aggregates CapEx, D&A, and Revenue from Step 2 history for the most recent
 * fiscal year that has at least one non-null CapEx figure.
 *
 * Accepts the raw `state.history` object (HistoricalData shape) — handles both
 * the v5.5 structuredResults artifacts and the legacy rows[] array.
 */
function aggregateCapExInputs(step2Financials: unknown): AggregatedCapExInputs {
  const empty: AggregatedCapExInputs = {
    capex_usd_m: null, da_usd_m: null, revenue_usd_m: null,
    capex_maintenance_usd_m: null, capex_growth_usd_m: null,
    capex_guidance_note: null,
  };

  if (!step2Financials || typeof step2Financials !== "object") return empty;
  const history = step2Financials as Record<string, unknown>;

  // ── Try v5.5 structuredResults first ──────────────────────────────────────
  const structuredResults = Array.isArray(history.structuredResults)
    ? history.structuredResults
    : [];

  for (const artifact of [...structuredResults].reverse()) {
    if (!artifact || typeof artifact !== "object") continue;
    const art = artifact as Record<string, unknown>;
    if (art.workflow !== "industrial" && art.workflow !== undefined) continue; // skip bank artifacts

    const rows = Array.isArray(art.rows) ? art.rows : [];
    const capexRows = rows.filter(
      (r: unknown) =>
        r &&
        typeof r === "object" &&
        (r as Record<string, unknown>).capex_usd_m != null,
    );
    if (capexRows.length === 0) continue;

    const sumField = (field: string): number | null => {
      const vals = rows
        .map((r: unknown) => (r as Record<string, unknown>)[field])
        .filter((v): v is number => typeof v === "number");
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
    };

    // MD&A split from result-level capex_mda_split
    const split = art.capex_mda_split as Record<string, unknown> | null | undefined;

    return {
      capex_usd_m: sumField("capex_usd_m"),
      da_usd_m: sumField("depreciation_amortization_usd_m"),
      revenue_usd_m: sumField("revenue_usd_m"),
      capex_maintenance_usd_m:
        typeof split?.maintenance_usd_m === "number" ? split.maintenance_usd_m : null,
      capex_growth_usd_m:
        typeof split?.growth_usd_m === "number" ? split.growth_usd_m : null,
      capex_guidance_note:
        typeof split?.guidance_note === "string" ? split.guidance_note : null,
    };
  }

  // ── Fallback: legacy rows[] (HistoricalExtractionRow[]) ───────────────────
  const rows = Array.isArray(history.rows) ? history.rows : [];
  const capexRows = rows.filter(
    (r: unknown) =>
      r &&
      typeof r === "object" &&
      (r as Record<string, unknown>).capex_usd_m != null,
  );
  if (capexRows.length === 0) return empty;

  // Use the most recent fiscal year that has capex data
  const years = capexRows
    .map((r: unknown) => (r as Record<string, unknown>).fiscalYear as number)
    .filter((y): y is number => typeof y === "number");
  const latestYear = Math.max(...years);
  const yearRows = rows.filter(
    (r: unknown) =>
      r &&
      typeof r === "object" &&
      (r as Record<string, unknown>).fiscalYear === latestYear,
  );

  const sumLegacy = (field: string): number | null => {
    const vals = yearRows
      .map((r: unknown) => (r as Record<string, unknown>)[field])
      .filter((v): v is number => typeof v === "number");
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
  };

  return {
    capex_usd_m: sumLegacy("capex_usd_m"),
    da_usd_m: sumLegacy("depreciation_amortization_usd_m"),
    revenue_usd_m: sumLegacy("revenue"),
    capex_maintenance_usd_m: null,
    capex_growth_usd_m: null,
    capex_guidance_note: null,
  };
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Compute the deterministic CapEx efficiency result from Step 2 data.
 *
 * @param step2Financials  Raw state.history object (HistoricalData)
 * @param step1Architecture  Raw architectureJson from Step 1
 * @returns CapExEfficiencyResult — always returns, never throws
 */
export function computeCapExEfficiency(
  step2Financials: unknown,
  step1Architecture: unknown,
): CapExEfficiencyResult {
  // ── Extract inputs ─────────────────────────────────────────────────────────
  const inputs = aggregateCapExInputs(step2Financials);

  // ── Identify industry from Step 1 ─────────────────────────────────────────
  let companyType: string | null = null;
  let primarySegment: string | null = null;
  try {
    if (step1Architecture && typeof step1Architecture === "object") {
      const arch = step1Architecture as Record<string, unknown>;
      companyType = typeof arch.company_type === "string" ? arch.company_type : null;
      const segments = Array.isArray(arch.architecture) ? arch.architecture : [];
      const first = segments[0] as Record<string, unknown> | undefined;
      primarySegment = typeof first?.segment === "string" ? first.segment : null;
    }
  } catch {
    // ignore — proceed with nulls
  }

  const damodaranIndustry = resolveDamodaranCapExIndustry(companyType, primarySegment);
  const benchmark = getDamodaranCapExBenchmark(damodaranIndustry);

  // ── Task 2: CapEx / D&A zone ───────────────────────────────────────────────
  const capexToDaRatio =
    inputs.capex_usd_m != null && inputs.da_usd_m != null && inputs.da_usd_m > 0
      ? inputs.capex_usd_m / inputs.da_usd_m
      : null;

  const capexDaZone: CapExZone =
    capexToDaRatio != null ? classifyCapExZone(capexToDaRatio) : "insufficient_data";

  // ── Task 3: CapEx / Sales vs. Damodaran ───────────────────────────────────
  const capexToSalesRatio =
    inputs.capex_usd_m != null && inputs.revenue_usd_m != null && inputs.revenue_usd_m > 0
      ? inputs.capex_usd_m / inputs.revenue_usd_m
      : null;

  let varianceVsIndustryPct: number | null = null;
  let intensityFlag: CapExIntensityFlag = "insufficient_data";

  if (capexToSalesRatio != null && benchmark != null) {
    varianceVsIndustryPct =
      ((capexToSalesRatio - benchmark.capexToSales) / benchmark.capexToSales) * 100;
    intensityFlag = classifyIntensityFlag(capexToSalesRatio, benchmark.capexToSales);
  }

  // ── Derive deterministic efficiency_score ─────────────────────────────────
  const { score, rationale } = deriveEfficiencyScore(capexDaZone, intensityFlag);

  return {
    capex_usd_m: inputs.capex_usd_m,
    da_usd_m: inputs.da_usd_m,
    capex_to_da_ratio: capexToDaRatio,
    capex_da_zone: capexDaZone,

    revenue_usd_m: inputs.revenue_usd_m,
    capex_to_sales_ratio: capexToSalesRatio,
    damodaran_industry: damodaranIndustry,
    damodaran_avg_capex_to_sales: benchmark?.capexToSales ?? null,
    damodaran_avg_capex_to_da: benchmark?.capexToDa ?? null,
    variance_vs_industry_pct: varianceVsIndustryPct,
    intensity_flag: intensityFlag,

    capex_maintenance_usd_m: inputs.capex_maintenance_usd_m,
    capex_growth_usd_m: inputs.capex_growth_usd_m,
    capex_guidance_note: inputs.capex_guidance_note,

    efficiency_score: score,
    score_rationale: rationale,
  };
}

// =============================================================================
// Prompt formatter — injected into Step 4 prompts (same pattern as trend ceilings)
// =============================================================================

export function formatCapExEfficiency(result: CapExEfficiencyResult | null): string {
  if (!result) return "";

  const pct = (v: number | null) =>
    v != null ? (v * 100).toFixed(1) + "%" : "n/a";
  const num = (v: number | null, decimals = 2) =>
    v != null ? v.toFixed(decimals) : "n/a";

  const lines: string[] = [
    "",
    "BACKEND CAPEX EFFICIENCY ANALYSIS (deterministic — computed from Step 2 data + Damodaran benchmarks, no LLM):",
    "",
    "  Task 2 — CapEx / D&A Internal Baseline:",
    `    CapEx: $${num(result.capex_usd_m, 0)}M  |  D&A: $${num(result.da_usd_m, 0)}M`,
    `    CapEx/D&A Ratio: ${num(result.capex_to_da_ratio)} → Zone: ${result.capex_da_zone.toUpperCase().replace("_", " ")}`,
    `    (Growth >1.15 | Steady State 0.85–1.15 | Underinvestment <0.85)`,
  ];

  lines.push(
    "",
    "  Task 3 — Damodaran Industry Benchmarking:",
    `    Company CapEx/Sales: ${pct(result.capex_to_sales_ratio)}`,
    `    Damodaran Industry: ${result.damodaran_industry ?? "Not identified"}`,
    `    Industry Avg CapEx/Sales: ${pct(result.damodaran_avg_capex_to_sales)}`,
    `    Industry Avg CapEx/D&A: ${num(result.damodaran_avg_capex_to_da)}`,
    `    Variance vs. Industry: ${result.variance_vs_industry_pct != null ? result.variance_vs_industry_pct.toFixed(1) + "%" : "n/a"} → Flag: ${result.intensity_flag.toUpperCase().replace(/_/g, " ")}`,
    `    (>+20% = High Intensity | ±20% = In-line | <-20% = Asset-Light)`,
  );

  if (result.capex_maintenance_usd_m != null || result.capex_growth_usd_m != null) {
    lines.push(
      "",
      "  Task 1B — MD&A Management Split:",
      `    Maintenance CapEx: $${num(result.capex_maintenance_usd_m, 0)}M`,
      `    Growth CapEx: $${num(result.capex_growth_usd_m, 0)}M`,
    );
  }
  if (result.capex_guidance_note) {
    lines.push(`    Forward Guidance: ${result.capex_guidance_note}`);
  }

  lines.push(
    "",
    `  DETERMINISTIC efficiency_score: ${result.efficiency_score > 0 ? "+" : ""}${result.efficiency_score} / 5`,
    `  Rationale: ${result.score_rationale}`,
    "",
    "EFFICIENCY SCORE RULE:",
    `  Use ${result.efficiency_score > 0 ? "+" : ""}${result.efficiency_score} as the baseline efficiency_score for ALL capital_metrics in this analysis.`,
    "  You MAY adjust ±1 point per individual metric ONLY when specific project-level evidence from Step 2",
    "  or the recent news justifies a deviation (e.g. a single high-return project vs. one wasteful program).",
    "  Document any adjustment in review_note. Do NOT override the baseline without citing specific evidence.",
    "  For bank segments, continue using ROATCE as the efficiency measure — this CapEx analysis does not apply.",
  );

  return lines.join("\n");
}
