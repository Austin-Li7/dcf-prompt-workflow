import { NextRequest, NextResponse } from "next/server";
import { callLLM, parseStructuredJsonText, resolveApiKey } from "@/lib/llm-service";
import {
  buildStep4ReviewState,
  GEMINI_STEP4_RESPONSE_SCHEMA,
  parseStep4StructuredResult,
  projectStep4StructuredToCapital,
  projectStep4StructuredToPaths,
  STEP4_RESPONSE_SCHEMA,
} from "@/lib/step4-schema";
import type { LLMProvider } from "@/types/cfp";
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
  "efficiency_score for bank capital entries must reflect ROATCE (Return on Average Tangible Common Equity) and/or ROAE (Return on Average Equity) rather than a generic CapEx-to-revenue calibration.",
  "Include review_summary and validation_warnings suitable for a human review UI.",
  "No markdown, commentary, or prose outside the structured response.",
].join(" ");

function buildStep4Prompt(inputs: {
  step1Architecture: unknown;
  step2Financials: unknown;
  step3Competition: unknown;
}): string {
  return [
    "Task: Produce Step 4 Synergy & Driver Eligibility plus Step 4.5 Capital Allocation.",
    "Step 1 architecture input:",
    JSON.stringify(inputs.step1Architecture, null, 2),
    "Step 2 historical financials input:",
    JSON.stringify(inputs.step2Financials || {}, null, 2),
    "Step 3 competitive landscape input:",
    JSON.stringify(inputs.step3Competition || {}, null, 2),
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
    "- EFFICIENCY SCORE: For bank capital entries, efficiency_score must reflect ROATCE (Return on Average Tangible Common Equity) and/or ROAE (Return on Average Equity). Positive = capital above cost of equity; negative = capital destruction.",
    "- REGULATORY MOAT AS SYNERGY: If a bank charter enables a segment to cross-sell under one regulated entity (reducing per-product compliance cost), classify this as a Core Integration synergy and cite the charter in the rationale.",
  ].join("\n");
}

function extractStructuredPayload(result: {
  text: string;
  structuredData?: unknown;
  finishReason?: string;
  finishMessage?: string;
}, provider: LLMProvider): unknown {
  if (result.structuredData && typeof result.structuredData === "object") {
    return result.structuredData;
  }

  return parseStructuredJsonText(result.text, {
    provider,
    finishReason: result.finishReason,
    finishMessage: result.finishMessage,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse<AnalyzeSynergiesResponse>> {
  try {
    const body = await req.json();
    const { step1Architecture, step2Financials, step3Competition, apiKey: runtimeKey, llmProvider = "claude" as LLMProvider } = body;

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
      prompt: buildStep4Prompt({ step1Architecture, step2Financials, step3Competition }),
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
    if (paths.length === 0) {
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
