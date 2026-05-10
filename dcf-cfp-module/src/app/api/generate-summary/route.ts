import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import type { LLMProvider } from "@/types/cfp";
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
  required: ["topEngines", "conclusion"],
  properties: {
    topEngines: {
      type: "array",
      description: "Top 3 growth engines by CAGR",
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
      },
    },
  },
};

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
  "Task 1: Identify the Top 3 Growth Engines (Categories) based strictly on the highest CAGR in the aggregated forecast data. Provide a 1-sentence explanation referencing competition and synergy data.",
  "Task 2: Write a Summary Conclusion — 2 sentences for 'Revenue Shift' (how revenue mix shifts FY1→FY5) and 2 sentences for 'Ecosystem Resilience'.",
  "Task 3: Reflect any Step 5 warnings or weak-inference flags in the explanation without inventing new numbers.",
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
  "Always set summaryMode to the string \"BANK\".",
].join("\n");

export async function POST(req: NextRequest): Promise<NextResponse<GenerateSummaryResponse>> {
  try {
    const body = await req.json();
    const {
      aggregatedTableData,
      step5ForecastArtifacts,
      step5ReviewWarnings,
      step3Competition,
      step4Complete,
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

    const dataBlock = [
      `Aggregated forecast (NII/revenue + FCFE where available): ${JSON.stringify(aggregatedTableData)}`,
      `Step 5 v5.5 forecast artifacts: ${JSON.stringify(step5ForecastArtifacts || [])}`,
      `Step 5 review warnings: ${JSON.stringify(step5ReviewWarnings || [])}`,
      `Competition: ${JSON.stringify(step3Competition || {})}`,
      `Synergies & Capital: ${JSON.stringify(step4Complete || {})}`,
    ].join("\n");

    if (mode === "INDUSTRIAL") {
      const result = await callLLM({
        provider: llmProvider,
        apiKey,
        prompt: `${INDUSTRIAL_PROMPT_TASKS}\n\n${dataBlock}`,
        maxTokens: 4096,
        responseSchema: INDUSTRIAL_SCHEMA,
        responseToolName: "submit_summary_insights",
      });
      const insights = (result.structuredData as SummaryInsights | undefined) ?? null;
      if (!insights?.topEngines || !insights?.conclusion) {
        return NextResponse.json({ insights: EMPTY_INDUSTRIAL, error: "Model did not return valid JSON." }, { status: 422 });
      }
      return NextResponse.json({ insights });
    }

    if (mode === "BANK") {
      const result = await callLLM({
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
      callLLM({
        provider: llmProvider,
        apiKey,
        prompt: `${INDUSTRIAL_PROMPT_TASKS}\n\nNote: Analyze industrial/non-financial segments only.\n\n${dataBlock}`,
        maxTokens: 4096,
        responseSchema: INDUSTRIAL_SCHEMA,
        responseToolName: "submit_summary_insights",
      }),
      callLLM({
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
    const hybridInsights: HybridSummaryInsights = { summaryMode: "HYBRID", bankInsights, industrialInsights };
    return NextResponse.json({ insights: hybridInsights });

  } catch (err: unknown) {
    console.error("[generate-summary] Error:", err);
    const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ insights: EMPTY_INDUSTRIAL as AnyInsights, error: msg }, { status: 500 });
  }
}
