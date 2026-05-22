import { NextRequest, NextResponse } from "next/server";
import { callLLM, extractStructuredPayload, resolveApiKey } from "@/lib/llm-service";
import {
  buildStep4ReviewState,
  GEMINI_STEP4_RESPONSE_SCHEMA,
  parseStep4StructuredResult,
  projectStep4StructuredToCapital,
  projectStep4StructuredToPaths,
  STEP4_RESPONSE_SCHEMA,
} from "@/lib/step4-schema";
import type { LLMProvider, TrendAnalysisResult } from "@/types/cfp";
import type { AnalyzeSynergiesResponse } from "@/types/cfp";

// =============================================================================
// POST /api/analyze-synergies
// =============================================================================

const STEP4_SYSTEM_PROMPT = [
  "You are producing the Step 4 Synergies and Step 4.5 Capital Allocation contract for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  'The top-level schema_version field must be exactly "v5.5".',
  "The goal is downstream forecast safety, not narrative richness.",
  "Every synergy and capital metric must cite claim_id and source_ids.",
  "Prefer official filings, uploaded Step 2 facts, company releases, and investor transcripts. Do not fabricate URLs.",
  "Use Review Prompt V2 skepticism: but-for test, reciprocity test, attraction/moat test, internal-customer test, and projection rule.",
  "Unsupported or narrative-only synergies must be context_only or unsupported and not forecastable.",
  "Capital allocation must use PP&E purchases/capex-style lines where available, not total investing cash flow.",
  // Bank/finance-specific guidance
  "BANK SYNERGY: For banking or financial services segments, traditional CapEx synergies (PP&E sharing, manufacturing scale) do not apply.",
  "Instead, evaluate cross-sell synergies via the Financial Services Productivity Loop: a customer acquired in one product (e.g., lending) becomes a lower-CAC acquisition for adjacent products (e.g., investing, banking, insurance).",
  "Quantify the cross-sell lift using disclosed multi-product attach rates, member lifetime value, or product-per-member metrics from official filings.",
  "BANK CAPITAL: For banking/financial segments, replace PP&E CapEx with regulatory capital deployment — Tier 1 capital ratio, CET1 ratio, and Risk-Weighted Asset (RWA) growth are the relevant capital metrics.",
  // Industrial efficiency_score: driven by deterministic CapEx engine in analyze-capital (Step 4.5).
  // At the synergy stage, use 0 as a neutral placeholder — the final score is set in analyze-capital.",
  "For INDUSTRIAL segments: set efficiency_score=0 as placeholder here; the deterministic CapEx/D&A + Damodaran score is computed in Step 4.5 (analyze-capital).",
  // Bank efficiency_score: still ROATCE-based
  "For BANK segments: efficiency_score must reflect ROATCE (Return on Average Tangible Common Equity).",
  "Step 2 supplies goodwill_usd_m, intangible_assets_usd_m, and preferred_equity_usd_m.",
  "Compute TCE = book_value_equity_usd_m − goodwill_usd_m − intangible_assets_usd_m − preferred_equity_usd_m.",
  "Then ROATCE = net_income_usd_m / avg(TCE). Use ROAE (net_income / book_value_equity) only as fallback when TCE components are null.",
  "Include review_summary and validation_warnings suitable for a human review UI.",
  "No markdown, commentary, or prose outside the structured response.",
].join(" ");

function formatTrendCeilings(trendAnalysis: TrendAnalysisResult | null | undefined): string {
  if (!trendAnalysis || Object.keys(trendAnalysis.segments).length === 0) return "";

  // Same three-branch formatting as analyze-capital — see comments there for rationale.
  // Summary: do not pass CAGR-fallback negatives to the LLM as "growth limits";
  // either surface a plateau-derived ceiling, an INFORMATIONAL historical CAGR,
  // or no number at all (with explicit guidance to derive growth from other signals).
  const lines = Object.entries(trendAnalysis.segments).map(([seg, r]) => {
    if (r.fit_ok && r.calculated_plateau_ceiling_usd_m != null) {
      const ceiling = `plateau $${r.calculated_plateau_ceiling_usd_m.toFixed(0)}M`;
      const growth = r.modeled_next_year_growth_limit_pct != null
        ? `next-year growth limit ${r.modeled_next_year_growth_limit_pct.toFixed(1)}%`
        : "growth limit unknown";
      const sat = r.is_plateau_detected ? " [SATURATED]" : "";
      const quality = r.fit_quality_r2 != null ? ` R²=${r.fit_quality_r2.toFixed(2)}` : "";
      return `  - ${seg}: ${ceiling}, ${growth}${sat}${quality}`;
    }
    if (r.historical_cagr_pct != null) {
      return `  - ${seg}: no plateau fit (shape=${r.series_shape}); historical CAGR ${r.historical_cagr_pct.toFixed(1)}% [INFORMATIONAL, not a ceiling]`;
    }
    return `  - ${seg}: no reliable trend (shape=${r.series_shape}); derive growth from synergies/competition/management guidance`;
  });
  return [
    "",
    "BACKEND TREND ANALYSIS (logistic S-curve regression on Step 2 data — no LLM, deterministic):",
    ...lines,
    "STRATEGIC OVERRIDE RULE: If any synergy driver would push a segment with a plateau-derived growth limit above that limit,",
    "you MUST document a growth_justification naming the specific catalyst breaking the mathematical curve",
    "(e.g. 'Competitor bankruptcy releases 15% TAM share', 'New product launch expands addressable market').",
    "Narrative optimism without a named catalyst is not a valid override.",
    "Lines tagged [INFORMATIONAL] or 'no reliable trend' carry NO ceiling — derive growth from other Step 3/4 signals.",
  ].join("\n");
}

function buildStep4Prompt(inputs: {
  step1Architecture: unknown;
  step2Financials: unknown;
  step3Competition: unknown;
  trendAnalysis?: TrendAnalysisResult | null;
}): string {
  return [
    "Task: Produce Step 4 Synergy & Driver Eligibility plus Step 4.5 Capital Allocation.",
    "Step 1 architecture input:",
    JSON.stringify(inputs.step1Architecture, null, 2),
    "Step 2 historical financials input:",
    JSON.stringify(inputs.step2Financials || {}, null, 2),
    "Step 3 competitive landscape input:",
    JSON.stringify(inputs.step3Competition || {}, null, 2),
    formatTrendCeilings(inputs.trendAnalysis),
    "Review Prompt V2 requirements:",
    "- Apply the but-for test: if the source business disappeared, would the recipient need to change pricing, product, or cost model?",
    "- Apply reciprocity: distinguish true functional interdependency from adjacent revenue.",
    "- Apply attraction/moat: identify proprietary distribution, data, CAC, infrastructure, or switching-cost advantages versus Step 3 competitors.",
    "- Apply internal-customer logic where one segment tests or consumes another segment's output.",
    "- Apply projection rule: only historical/current disclosed data can verify a claim; targets and hypothetical outcomes are not proof.",
    "- Assign driver_eligibility conservatively: FULL only for proven integration/differentiation/causality; CAPPED for partial evidence; CONTEXT_ONLY or NOT_ALLOWED for narrative-only claims.",
    "- Add capital_allocation even if preliminary; mark workflow_status NEEDS_REVIEW when source support or ceiling math is incomplete.",
    "",
    "Finance & Banking rules (apply when any segment involves lending, deposits, payments, banking, or financial products):",
    "- CROSS-SELL SYNERGY: Evaluate the Financial Services Productivity Loop — a member acquired in lending becomes a lower-CAC target for investing, banking, and insurance products. Use disclosed multi-product attach rates or product-per-member metrics to quantify.",
    "- CAPITAL (NO CAPEX): Do not model PP&E CapEx for bank/financial segments. Instead use regulatory capital deployment: Tier 1 capital ratio, CET1 ratio, and RWA growth are the capital efficiency metrics.",
    "- EFFICIENCY SCORE (INDUSTRIAL): Set efficiency_score=0 as placeholder — the deterministic score (CapEx/D&A zone + Damodaran variance) is finalized in Step 4.5 (analyze-capital).",
    "- EFFICIENCY SCORE (BANK): Compute TCE = book_value_equity_usd_m − goodwill_usd_m − intangible_assets_usd_m − preferred_equity_usd_m (from Step 2 rows). ROATCE = net_income_usd_m / avg(TCE). A bank with ROATCE > cost of equity (~10–15%) earns a positive efficiency_score; below earns negative. Fall back to ROAE only if TCE components are null; flag in review_note.",
    "- REGULATORY MOAT AS SYNERGY: If a bank charter enables a segment to cross-sell under one regulated entity (reducing per-product compliance cost), classify this as a Core Integration synergy and cite the charter in the rationale.",
  ].join("\n");
}

export async function POST(req: NextRequest): Promise<NextResponse<AnalyzeSynergiesResponse>> {
  try {
    const body = await req.json();
    const { step1Architecture, step2Financials, step3Competition, trendAnalysis, apiKey: runtimeKey, llmProvider = "claude" as LLMProvider } = body;

    if (!step1Architecture) {
      return NextResponse.json({ paths: [], error: "Step 1 architecture is required." }, { status: 400 });
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json({ paths: [], error: "No API key found for the selected provider.", requiresApiKey: true }, { status: 401 });
    }

    const result = await callLLM({
      provider: llmProvider,
      apiKey,
      systemPrompt: STEP4_SYSTEM_PROMPT,
      prompt: buildStep4Prompt({ step1Architecture, step2Financials, step3Competition, trendAnalysis: trendAnalysis as TrendAnalysisResult | null }),
      maxTokens: 12288,
      responseSchema:
        llmProvider === "gemini" ? GEMINI_STEP4_RESPONSE_SCHEMA : STEP4_RESPONSE_SCHEMA,
      responseToolName: "submit_step4_structured_result",
      responseToolDescription:
        "Submit the Step 4 structured synergy and capital allocation result with sources, claims, and review summary.",
    });

    const structuredPayload = extractStructuredPayload(result, llmProvider);
    const structuredResult = parseStep4StructuredResult(structuredPayload);
    const paths = projectStep4StructuredToPaths(structuredResult);
    const capital = projectStep4StructuredToCapital(structuredResult);
    const step4Review = buildStep4ReviewState(structuredResult);

    // Single-segment companies legitimately have zero synergy paths — the v5.5
    // spec instructs the model to set workflow_status=READY and return an empty
    // synergy_registry. Only fail hard when paths are absent AND the result does
    // not indicate it's intentionally empty.
    if (paths.length === 0 && structuredResult.capital_allocation.workflow_status !== "READY") {
      return NextResponse.json(
        {
          paths: [],
          structuredResult: null,
          step4Review: null,
          capital: null,
          error: "The model did not return any Step 4 synergies. Please try again.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ paths, structuredResult, step4Review, capital });
  } catch (err: unknown) {
    console.error("[analyze-synergies] Error:", err);
    let message = err instanceof Error ? err.message : "An unexpected error occurred.";
    // ZodError messages are raw JSON arrays — surface a friendlier message instead.
    if (message.startsWith("[") || message.startsWith("{")) {
      message = "The analysis response didn't match the expected format. Please try again.";
    }
    return NextResponse.json({ paths: [], error: message }, { status: 500 });
  }
}
