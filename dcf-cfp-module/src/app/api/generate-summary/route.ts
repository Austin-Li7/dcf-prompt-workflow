import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import { guardedCallLLM } from "@/lib/llm-guard";
import type { LLMProvider, HistoricalData, HistoricalMarginPoint } from "@/types/cfp";
import type {
  GenerateSummaryResponse,
  SummaryInsights,
  BankSummaryInsights,
  HybridSummaryInsights,
  AnyInsights,
} from "@/types/cfp";

// =============================================================================
// JSON Schemas for tool-use structured outputs
// =============================================================================

const INDUSTRIAL_SCHEMA = {
  type: "object",
  required: ["topEngines", "segmentCagrs", "marginProjections", "conclusion"],
  properties: {
    topEngines: {
      type: "array",
      description: "Top 3 growth engines by 5-year revenue CAGR",
      items: {
        type: "object",
        required: ["name", "cagr", "explanation"],
        properties: {
          name:        { type: "string" },
          cagr:        { type: "string", description: "e.g. '18.5%'" },
          explanation: { type: "string" },
        },
      },
    },
    segmentCagrs: {
      type: "array",
      description: "5-year revenue CAGR for every segment in the Step 5 forecast (not just the top 3)",
      items: {
        type: "object",
        required: ["segment", "cagr_pct", "explanation"],
        properties: {
          segment:     { type: "string" },
          cagr_pct:    { type: "number", description: "5-year revenue CAGR as a decimal percentage, e.g. 14.2 means 14.2%" },
          explanation: { type: "string", description: "1-sentence explanation of the primary growth driver for this segment" },
        },
      },
    },
    marginProjections: {
      type: "array",
      description: "Projected gross profit margin % and OpEx/revenue % for FY+1 through FY+5. Base projections on the historical margin trend supplied in the prompt. OpEx% = (Revenue − Operating Income) / Revenue × 100.",
      items: {
        type: "object",
        required: ["fiscal_year", "gross_margin_pct", "opex_pct"],
        properties: {
          fiscal_year:       { type: "string", description: "e.g. 'FY+1', 'FY+2', 'FY+3', 'FY+4', 'FY+5'" },
          gross_margin_pct:  { type: "number", description: "Projected gross profit / revenue × 100, e.g. 43.5" },
          opex_pct:          { type: "number", description: "Projected (Revenue − Operating Income) / Revenue × 100, e.g. 28.4" },
          rationale:         { type: "string", description: "1-sentence rationale for the projected margin movement vs. historical trend" },
        },
      },
    },
    conclusion: {
      type: "object",
      required: ["revenueShift", "ecosystemResilience"],
      properties: {
        revenueShift:         { type: "string" },
        ecosystemResilience:  { type: "string" },
      },
    },
  },
};

const BANK_SCHEMA = {
  type: "object",
  required: ["summaryMode", "topDrivers", "conclusion"],
  properties: {
    summaryMode: { type: "string", enum: ["BANK"] },
    topDrivers: {
      type: "array",
      description: "Top 3 FCFE growth drivers",
      items: {
        type: "object",
        required: ["name", "fcfe_cagr", "nim_pct", "explanation"],
        properties: {
          name:        { type: "string" },
          fcfe_cagr:   { type: "string" },
          nim_pct:     { type: "string" },
          explanation: { type: "string" },
        },
      },
    },
    conclusion: {
      type: "object",
      required: ["capitalPosition", "creditQuality", "nimOutlook", "fcfeTrajectory"],
      properties: {
        capitalPosition:  { type: "string" },
        creditQuality:    { type: "string" },
        nimOutlook:       { type: "string" },
        fcfeTrajectory:   { type: "string" },
        liquidityRisk:    { type: "string" },
      },
    },
  },
};

// =============================================================================
// Deterministic historical margin computation (no LLM)
// =============================================================================

/**
 * Computes company-level gross profit margin % and OpEx/revenue % per fiscal
 * year from Step 2 industrial history rows.
 *
 * Aggregation strategy:
 *   - Per (fiscal_year, segment): keep the row with the highest revenue value.
 *     This lets an annual 10-K row dominate individual 10-Q rows for the same
 *     segment and year, avoiding double-counting.
 *   - Sum across segments to get company-level totals.
 *   - gross_margin_pct = sum(gross_profit_usd_m) / sum(revenue) × 100
 *   - opex_pct = (sum(revenue) − sum(operating_income)) / sum(revenue) × 100
 *
 * Bank-mode rows are skipped — gross margin and OpEx% are industrial concepts.
 * Returns an empty array when no industrial rows are present.
 */
function computeHistoricalMargins(
  step2History: HistoricalData | null | undefined,
): HistoricalMarginPoint[] {
  const rows = step2History?.rows ?? [];
  if (rows.length === 0) return [];

  // Step 1: per (fiscal_year × segment), keep the highest-revenue row.
  const bestBySegYear = new Map<string, HistoricalData["rows"][number]>();
  for (const row of rows) {
    if (row.workflow_mode === "bank") continue;
    const key = `${row.fiscalYear}|${row.segment}`;
    const existing = bestBySegYear.get(key);
    if (!existing || (row.revenue ?? 0) > (existing.revenue ?? 0)) {
      bestBySegYear.set(key, row);
    }
  }

  // Step 2: aggregate across segments per fiscal year.
  const byYear = new Map<number, {
    revenue: number;
    grossProfit: number; hasGp: boolean;
    operatingIncome: number; hasOi: boolean;
  }>();

  for (const row of bestBySegYear.values()) {
    const yr = row.fiscalYear;
    if (!byYear.has(yr)) {
      byYear.set(yr, { revenue: 0, grossProfit: 0, hasGp: false, operatingIncome: 0, hasOi: false });
    }
    const entry = byYear.get(yr)!;
    entry.revenue += row.revenue ?? 0;
    if (typeof row.gross_profit_usd_m === "number") {
      entry.grossProfit += row.gross_profit_usd_m;
      entry.hasGp = true;
    }
    if (typeof row.operatingIncome === "number") {
      entry.operatingIncome += row.operatingIncome;
      entry.hasOi = true;
    }
  }

  // Step 3: compute margin ratios and return sorted by year ascending.
  return Array.from(byYear.entries())
    .sort(([a], [b]) => a - b)
    .map(([fiscal_year, d]) => ({
      fiscal_year,
      gross_margin_pct:
        d.hasGp && d.revenue > 0
          ? Math.round((d.grossProfit / d.revenue) * 1000) / 10
          : null,
      opex_pct:
        d.hasOi && d.revenue > 0
          ? Math.round(((d.revenue - d.operatingIncome) / d.revenue) * 1000) / 10
          : null,
    }));
}

// =============================================================================
// POST /api/generate-summary
// =============================================================================

function detectSummaryMode(artifacts: unknown[]): "INDUSTRIAL" | "BANK" | "HYBRID" {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return "INDUSTRIAL";
  const list = artifacts as Record<string, unknown>[];
  const hasBankResult = list.some((a) => {
    // Check top-level valuation_method OR nested machine_artifact.forecast_mode
    const ma = a?.machine_artifact as Record<string, unknown> | undefined;
    return a?.valuation_method === "FCFE" || ma?.forecast_mode === "bank";
  });
  const hasIndustrialResult = list.some((a) => {
    const ma = a?.machine_artifact as Record<string, unknown> | undefined;
    return (
      !a?.valuation_method ||
      a?.valuation_method === "FCFF" ||
      (ma?.forecast_mode && ma?.forecast_mode !== "bank")
    );
  });
  if (hasBankResult && hasIndustrialResult) return "HYBRID";
  if (hasBankResult) return "BANK";
  return "INDUSTRIAL";
}

const EMPTY_INDUSTRIAL: SummaryInsights = { topEngines: [], conclusion: { revenueShift: "", ecosystemResilience: "" } };

const INDUSTRIAL_PROMPT_TASKS = [
  "You are an elite Chief Investment Officer reviewing a completed 5-year financial model.",
  "Task 1: Identify the Top 3 Growth Engines (Categories) based strictly on the highest 5-year revenue CAGR in the aggregated forecast data. Provide a 1-sentence explanation referencing competition and synergy data.",
  "Task 2: List the 5-year revenue CAGR for EVERY segment in the forecast (segmentCagrs). Include all segments, not just the top 3. Compute each CAGR from FY+1 base revenue to FY+5 base revenue in the Step 5 artifacts.",
  "Task 3: Project gross profit margin % and OpEx/revenue % (where OpEx = Revenue − Operating Income) for FY+1 through FY+5 (marginProjections). Use the historical margin data provided in HISTORICAL MARGIN DATA as your baseline. Project realistic trends: account for scale effects, synergy drivers, and any Step 5 weak-inference flags. Do not extrapolate aggressively without evidence. Include a 1-sentence rationale per year.",
  "Task 4: Write a Summary Conclusion — 2 sentences for 'Revenue Shift' (how revenue mix shifts FY1→FY5) and 2 sentences for 'Ecosystem Resilience'.",
  "Task 5: Reflect any Step 5 warnings or weak-inference flags in explanations without inventing new numbers.",
].join("\n");

const BANK_PROMPT_TASKS = [
  "You are an elite Chief Investment Officer reviewing a completed 5-year bank/financial services model.",
  "The aggregated NII (Net Interest Income) table shows income-generating capacity by segment. FCFE columns (fcfe_fy1–fcfe_fy5) show Free Cash Flow to Equity = Net Income − Increase in Regulatory Capital.",
  "Task 1: Identify the Top 3 FCFE Growth Drivers from the forecast data. For each, provide the driver name, projected FCFE CAGR (from fcfe_fy1 to fcfe_fy5 where available), average NIM%, and a 1-sentence explanation citing member growth, deposit APY, or loan origination volume.",
  "Task 2: Write a 4-part Summary Conclusion:",
  "  - capitalPosition: 2-sentence assessment of Tier 1/CET1 adequacy relative to loan growth (FY1–FY5).",
  "  - creditQuality: 2-sentence assessment of Provision for Credit Losses (PCL) trajectory and default rate risk.",
  "  - nimOutlook: 2-sentence NIM compression/expansion assessment referencing rate environment and competitive data.",
  "  - fcfeTrajectory: 2-sentence narrative of FCFE evolution FY1→FY5, noting any capital-constrained early periods.",
  "Task 3: Flag material ALM or interest rate risks from Step 5 review warnings.",
  "Task 4: If a liquidityRiskRating is provided (HIGH or CRITICAL), write a 2-sentence 'liquidityRisk' assessment in the conclusion describing the funding vulnerability, HTM loss exposure, and Ke spread impact on FCFE discounting. For LOW/MODERATE ratings, write a brief 1-sentence note that liquidity appears adequate.",
  "Always set summaryMode to the string \"BANK\".",
].join("\n");

export async function POST(req: NextRequest): Promise<NextResponse<GenerateSummaryResponse>> {
  try {
    const body = await req.json();
    const {
      aggregatedTableData,
      step2History,
      step5ForecastArtifacts,
      step5ReviewWarnings,
      step3Competition,
      step4Complete,
      liquidityRiskRating,
      apiKey: runtimeKey,
      llmProvider = "claude" as LLMProvider,
    } = body;

    if (!aggregatedTableData) {
      return NextResponse.json({ insights: EMPTY_INDUSTRIAL, error: "Aggregated data required." }, { status: 400 });
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json(
        { insights: EMPTY_INDUSTRIAL, error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    const mode = detectSummaryMode(step5ForecastArtifacts ?? []);

    // Compute historical margins deterministically (industrial mode only).
    const historicalMargins =
      mode !== "BANK"
        ? computeHistoricalMargins(step2History as HistoricalData | null)
        : [];

    const historicalMarginBlock =
      historicalMargins.length > 0
        ? `\nHISTORICAL MARGIN DATA (deterministic from Step 2 filings — use as baseline for Task 3):\n${JSON.stringify(historicalMargins)}`
        : "";

    const liquidityRatingBlock =
      liquidityRiskRating
        ? `\nStep 7 Liquidity Risk Rating: ${liquidityRiskRating}`
        : "";

    const dataBlock = [
      `Aggregated forecast (NII/revenue + FCFE where available): ${JSON.stringify(aggregatedTableData)}`,
      `Step 5 v5.5 forecast artifacts: ${JSON.stringify(step5ForecastArtifacts || [])}`,
      `Step 5 review warnings: ${JSON.stringify(step5ReviewWarnings || [])}`,
      `Competition: ${JSON.stringify(step3Competition || {})}`,
      `Synergies & Capital: ${JSON.stringify(step4Complete || {})}`,
      historicalMarginBlock,
      liquidityRatingBlock,
    ].join("\n");

    if (mode === "INDUSTRIAL") {
      const result = await guardedCallLLM({
        provider: llmProvider,
        apiKey,
        prompt: `${INDUSTRIAL_PROMPT_TASKS}\n\n${dataBlock}`,
        maxTokens: 6144,
        responseSchema: INDUSTRIAL_SCHEMA,
        responseToolName: "submit_summary_insights",
      });
      const insights = (result.structuredData as SummaryInsights | undefined) ?? null;
      if (!insights?.topEngines || !insights?.conclusion) {
        return NextResponse.json({ insights: EMPTY_INDUSTRIAL, error: "Model did not return valid JSON." }, { status: 422 });
      }
      // Attach deterministic historical margins (not produced by the LLM).
      if (historicalMargins.length > 0) insights.historicalMargins = historicalMargins;
      return NextResponse.json({ insights });
    }

    if (mode === "BANK") {
      const result = await guardedCallLLM({
        provider: llmProvider,
        apiKey,
        prompt: `${BANK_PROMPT_TASKS}\n\n${dataBlock}`,
        maxTokens: 4096,
        responseSchema: BANK_SCHEMA,
        responseToolName: "submit_bank_summary_insights",
      });
      const insights = (result.structuredData as BankSummaryInsights | undefined) ?? null;
      if (!insights?.topDrivers || !insights?.conclusion) {
        return NextResponse.json({ insights: EMPTY_INDUSTRIAL as AnyInsights, error: "Model did not return valid bank JSON." }, { status: 422 });
      }
      // Ensure summaryMode is set even if model omits it
      insights.summaryMode = "BANK";
      return NextResponse.json({ insights });
    }

    // HYBRID: run industrial + bank prompts in parallel
    const [industrialResult, bankResult] = await Promise.all([
      guardedCallLLM({
        provider: llmProvider,
        apiKey,
        prompt: `${INDUSTRIAL_PROMPT_TASKS}\n\nNote: Analyze industrial/non-financial segments only.\n\n${dataBlock}`,
        maxTokens: 6144,
        responseSchema: INDUSTRIAL_SCHEMA,
        responseToolName: "submit_summary_insights",
      }),
      guardedCallLLM({
        provider: llmProvider,
        apiKey,
        prompt: `${BANK_PROMPT_TASKS}\n\nNote: Analyze bank/financial segments only.\n\n${dataBlock}`,
        maxTokens: 4096,
        responseSchema: BANK_SCHEMA,
        responseToolName: "submit_bank_summary_insights",
      }),
    ]);

    const industrialInsights = industrialResult.structuredData as SummaryInsights | undefined;
    const bankInsights = bankResult.structuredData as BankSummaryInsights | undefined;

    if (!industrialInsights?.topEngines || !bankInsights?.topDrivers) {
      return NextResponse.json(
        {
          insights: EMPTY_INDUSTRIAL as AnyInsights,
          error: `Hybrid summary failed: ${!industrialInsights?.topEngines ? "industrial" : "bank"} model did not return valid JSON.`,
        },
        { status: 422 },
      );
    }

    bankInsights.summaryMode = "BANK";
    // Attach deterministic historical margins to the industrial half of a hybrid result.
    if (historicalMargins.length > 0) industrialInsights.historicalMargins = historicalMargins;
    const hybridInsights: HybridSummaryInsights = { summaryMode: "HYBRID", bankInsights, industrialInsights };
    return NextResponse.json({ insights: hybridInsights });

  } catch (err: unknown) {
    console.error("[generate-summary] Error:", err);
    const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ insights: EMPTY_INDUSTRIAL as AnyInsights, error: msg }, { status: 500 });
  }
}
