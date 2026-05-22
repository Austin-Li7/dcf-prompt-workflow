import { NextRequest, NextResponse } from "next/server";
import { callLLM, extractStructuredPayload, resolveApiKey } from "@/lib/llm-service";
import { guardedCallLLM } from "@/lib/llm-guard";
import {
  buildStep4ReviewState,
  GEMINI_STEP4_RESPONSE_SCHEMA,
  parseStep4StructuredResult,
  projectStep4StructuredToCapital,
  projectStep4StructuredToPaths,
  STEP4_RESPONSE_SCHEMA,
} from "@/lib/step4-schema";
import { computeCapExEfficiency, formatCapExEfficiency } from "@/lib/capex-efficiency";
import type { LLMProvider, TrendAnalysisResult } from "@/types/cfp";
import type { AnalyzeCapitalResponse, CapitalAllocationData } from "@/types/cfp";

// =============================================================================
// POST /api/analyze-capital
// =============================================================================

const emptyCapital: CapitalAllocationData = {
  investmentMatrix: [],
  checkpoints: { capexRunway: "", scaleEconomics: "", guidanceAlignment: "" },
};

const STEP4_CAPITAL_SYSTEM_PROMPT = [
  "You are revising the Step 4 Synergies and Step 4.5 Capital Allocation contract for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  'The top-level schema_version field must be exactly "v5.5".',
  "Preserve the Step 4 synergy logic unless the capital/news evidence proves it should be downgraded.",
  "Every synergy and capital metric must cite claim_id and source_ids.",
  "Use Review Prompt V2: but-for test, reciprocity, source specificity, projection rule, and capex verification.",
  "Capital allocation must use PP&E purchases/capex-style lines where available, not total investing cash flow.",
  "Do not treat management targets, forecasts, or hypothetical future outcomes as verified proof.",
  // Bank/finance-specific capital and risk guidance
  "BANK CAPITAL: For banking or financial services segments, PP&E CapEx is not the primary capital constraint.",
  "Use regulatory capital deployment metrics instead: Tier 1 capital ratio, Common Equity Tier 1 (CET1) ratio, and Risk-Weighted Asset (RWA) growth.",
  // Industrial efficiency_score: now driven by deterministic backend analysis injected into the prompt.
  "For INDUSTRIAL segments: efficiency_score is pre-computed by the backend CapEx efficiency engine (see BACKEND CAPEX EFFICIENCY ANALYSIS block below).",
  "Use the deterministic baseline score provided. You may adjust ±1 only with specific project evidence. Document adjustments in review_note.",
  // Bank efficiency_score: still LLM-computed via ROATCE
  "For BANK segments: efficiency_score must reflect ROATCE (Return on Average Tangible Common Equity).",
  "Step 2 supplies goodwill_usd_m, intangible_assets_usd_m, and preferred_equity_usd_m.",
  "Compute TCE = book_value_equity_usd_m − goodwill_usd_m − intangible_assets_usd_m − preferred_equity_usd_m.",
  "Then ROATCE = net_income_usd_m / avg(TCE). Positive score = ROATCE above cost of equity (~10–15%); negative = capital destruction.",
  "Use ROAE only as explicit fallback when TCE components are null; flag the fallback in review_note.",
  // SVB-style Asset-Liability Management (ALM) risk
  "INTEREST RATE / ALM RISK: When news mentions Federal Reserve rate decisions or the 10-year Treasury yield, assess the Asset-Liability Mismatch risk.",
  "Rising rates reduce the mark-to-market value of long-duration bond portfolios held as HTM (held-to-maturity) or AFS (available-for-sale) assets.",
  "If a bank holds a high concentration of long-term bonds funded by short-term or demand deposits, rising rates create an unrealized loss that can trigger a confidence shock and depositor run — the SVB collapse pattern.",
  "Flag this risk in validation_warnings when: (1) the news cites a rising rate environment, (2) the company holds material long-duration fixed-income securities, or (3) depositor concentration is high (e.g., single-industry or institutional depositors).",
  "Model the rate sensitivity: estimate the duration gap and potential unrealized loss per 100bps rise in the 10-year Treasury yield.",
  // Bank news topics to flag
  "BANK NEWS TOPICS: When processing recent news, flag material changes in: credit default rates, student loan policy shifts, Fed rate trajectory, 10-year Treasury yield moves, deposit outflows, capital adequacy ratios, and regulatory enforcement actions.",
  "Include review_summary and validation_warnings suitable for a human review UI.",
  "No markdown, commentary, or prose outside the structured response.",
].join(" ");

function formatTrendCeilings(trendAnalysis: TrendAnalysisResult | null | undefined): string {
  if (!trendAnalysis || Object.keys(trendAnalysis.segments).length === 0) return "";
  const lines = Object.entries(trendAnalysis.segments).map(([seg, r]) => {
    const ceiling = r.calculated_plateau_ceiling_usd_m != null ? `plateau $${r.calculated_plateau_ceiling_usd_m.toFixed(0)}M` : "no plateau fit";
    const growth = r.modeled_next_year_growth_limit_pct != null ? `next-year growth limit ${r.modeled_next_year_growth_limit_pct.toFixed(1)}%` : "growth limit unknown";
    const sat = r.is_plateau_detected ? " [SATURATED]" : "";
    const quality = r.fit_quality_r2 != null ? ` R²=${r.fit_quality_r2.toFixed(2)}` : "";
    return `  - ${seg}: ${ceiling}, ${growth}${sat}${quality}`;
  });
  return [
    "",
    "BACKEND TREND CEILINGS (logistic S-curve regression on Step 2 data — no LLM, deterministic):",
    ...lines,
    "STRATEGIC OVERRIDE RULE: If any synergy driver or capital allocation would push a segment's revenue above its modeled growth limit,",
    "you MUST document a growth_justification naming the specific catalyst breaking the mathematical curve",
    "(e.g. 'Competitor bankruptcy releases 15% TAM share', 'New product launch expands addressable market').",
    "Narrative optimism without a named catalyst is not a valid override.",
  ].join("\n");
}

function buildStep4CapitalPrompt(inputs: {
  step1Architecture: unknown;
  step2Financials: unknown;
  step4Synergies: unknown;
  recentNews: string;
  trendAnalysis?: TrendAnalysisResult | null;
}): string {
  const capexEfficiency = computeCapExEfficiency(inputs.step2Financials, inputs.step1Architecture);

  return [
    "Task: Produce the finalized Step 4 Synergy & Driver Eligibility plus Step 4.5 Capital Allocation structured result.",
    `Recent news / management commentary: ${inputs.recentNews}`,
    "Step 1 architecture input:",
    JSON.stringify(inputs.step1Architecture, null, 2),
    "Step 2 historical financials input:",
    JSON.stringify(inputs.step2Financials || {}, null, 2),
    "Current Step 4 synergy review input:",
    JSON.stringify(inputs.step4Synergies || [], null, 2),
    formatCapExEfficiency(capexEfficiency),
    formatTrendCeilings(inputs.trendAnalysis),
    "Review Prompt V2 capital requirements:",
    "- Use PP&E purchases / capex-specific lines. If unavailable, mark capital workflow_status NEEDS_REVIEW or BLOCKED.",
    "- The backend CapEx efficiency analysis above (BACKEND CAPEX EFFICIENCY ANALYSIS block) already computes:",
    "  (a) CapEx/D&A zone (Growth / Steady State / Underinvestment),",
    "  (b) Damodaran industry variance flag (High Intensity / In-line / Asset-Light),",
    "  (c) Deterministic efficiency_score baseline for industrial segments.",
    "- Use asset_light_exemption=true ONLY when the backend analysis shows Asset-Light flag AND CapEx/Sales < 8% is confirmed.",
    "- Show whether Step 5 revenue ceiling applies, and include a null ceiling when no hard ceiling is supported.",
    "- Keep any source-grounding gaps in validation_warnings and human review fields.",
    "",
    "Finance & Banking capital rules (apply when any segment involves lending, deposits, payments, banking, or financial products):",
    "- REGULATORY CAPITAL: Replace PP&E CapEx analysis with Tier 1 capital ratio, CET1 ratio, and RWA growth as the primary capital deployment metrics.",
    "- EFFICIENCY SCORE (BANK): Compute TCE = book_value_equity_usd_m − goodwill_usd_m − intangible_assets_usd_m − preferred_equity_usd_m (from Step 2 rows). ROATCE = net_income_usd_m / avg(TCE). A bank with ROATCE above cost of equity (~10–15%) earns a positive efficiency_score; below earns negative. Fall back to ROAE only when TCE components are null; document the fallback.",
    "- ALM / INTEREST RATE RISK: If recent news mentions Fed rate changes or 10-year Treasury yield moves, assess Asset-Liability Mismatch (ALM) risk:",
    "  (a) Estimate the duration of the bond/securities portfolio vs. the average maturity of deposit liabilities.",
    "  (b) Compute the approximate unrealized loss per 100bps rise in the 10-year Treasury yield.",
    "  (c) Assess depositor concentration risk — a single-industry depositor base (e.g., tech startups) amplifies withdrawal correlation during stress.",
    "  (d) Flag the SVB-pattern risk if: long-duration bond portfolio + rising rates + concentrated depositors → potential confidence shock → bank run.",
    "  Document the ALM assessment in validation_warnings and human review fields.",
    "- BANK NEWS TOPICS: Extract and apply material signals from news: credit default rate changes, student loan policy shifts, Fed rate trajectory, 10-year Treasury yield trend, deposit inflows/outflows, capital ratio disclosures, and regulatory enforcement actions.",
  ].join("\n");
}

export async function POST(req: NextRequest): Promise<NextResponse<AnalyzeCapitalResponse>> {
  try {
    const body = await req.json();
    const { step1Architecture, step2Financials, step4Synergies, recentNews, trendAnalysis, apiKey: runtimeKey, llmProvider = "claude" as LLMProvider } = body;

    if (!step1Architecture) {
      return NextResponse.json(
        { data: emptyCapital, error: "Step 1 architecture is required." },
        { status: 400 },
      );
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json(
        { data: emptyCapital, error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    const newsBlock = recentNews && typeof recentNews === "string" && recentNews.trim()
      ? recentNews.trim()
      : "No recent news provided.";

    const result = await guardedCallLLM({
      provider: llmProvider,
      apiKey,
      systemPrompt: STEP4_CAPITAL_SYSTEM_PROMPT,
      prompt: buildStep4CapitalPrompt({
        step1Architecture,
        step2Financials,
        step4Synergies,
        recentNews: newsBlock,
        trendAnalysis: trendAnalysis as TrendAnalysisResult | null,
      }),
      maxTokens: 12288,
      responseSchema:
        llmProvider === "gemini" ? GEMINI_STEP4_RESPONSE_SCHEMA : STEP4_RESPONSE_SCHEMA,
      responseToolName: "submit_step4_structured_result",
      responseToolDescription:
        "Submit the Step 4 structured synergy and capital allocation result with sources, claims, and review summary.",
    });

    const structuredPayload = extractStructuredPayload(result, llmProvider);
    const structuredResult = parseStep4StructuredResult(structuredPayload);
    const data = projectStep4StructuredToCapital(structuredResult);
    const paths = projectStep4StructuredToPaths(structuredResult);
    const step4Review = buildStep4ReviewState(structuredResult);

    if (data.investmentMatrix.length === 0) {
      return NextResponse.json(
        {
          data: emptyCapital,
          structuredResult: null,
          step4Review: null,
          error: "The model did not return any Step 4 capital metrics. Please try again.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ data, paths, structuredResult, step4Review });
  } catch (err: unknown) {
    console.error("[analyze-capital] Error:", err);
    const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json(
      { data: emptyCapital, error: msg },
      { status: 500 },
    );
  }
}
