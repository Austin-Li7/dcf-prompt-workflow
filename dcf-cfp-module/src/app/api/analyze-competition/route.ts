import { NextRequest, NextResponse } from "next/server";
import { callLLM, extractStructuredPayload, resolveApiKey } from "@/lib/llm-service";
import {
  buildStep3ReviewState,
  GEMINI_STEP3_RESPONSE_SCHEMA,
  parseStep3StructuredResult,
  projectStep3StructuredToCategories,
  STEP3_RESPONSE_SCHEMA,
} from "@/lib/step3-schema";
import type { LLMProvider, AnalyzeCompetitionResponse } from "@/types/cfp";

// =============================================================================
// POST /api/analyze-competition
// =============================================================================
// Accepts JSON body:
//   - companyName       (string)
//   - architecture      (string — JSON of Step 1 architecture)
//   - apiKey            (string, optional)
// =============================================================================

const STEP3_SYSTEM_PROMPT = [
  "You are producing the Step 3 competitive landscape contract for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  'The top-level schema_version field must be exactly "v5.5".',
  "Use materiality compression: analyze only categories that can affect forecast assumptions.",
  "Every competitor pairing must be grounded in direct segment overlap, revenue scale, or verified market position.",
  "competitive_status describes the SUBJECT company (the company named in the task) — i.e. whether the subject is the Leader or Challenger in that category, measured RELATIVE TO primary_competitor. It is NOT the competitor's own standing. Use 'Unclear' only when the subject's relative position genuinely cannot be determined from sources.",
  "Prefer official filings, company releases, and reputable market research. Do not fabricate URLs.",
  "If evidence is weak or overlap is partial, set lower confidence and human_review_required=true.",
  "Every category, pairing basis, and force must cite claim_id and source_ids.",
  "Include a review_summary and validation_warnings suitable for a human review UI.",
  // Regulatory & technology awareness
  "REGULATORY ENVIRONMENT: For every segment, assess whether licensing, charters, or regulatory approval creates a structural moat or barrier.",
  "A national bank charter (e.g., OCC-approved) dramatically raises the regulatory moat — weight Threat of New Entrants LOW for chartered segments because replication of the charter, capital requirements, and compliance infrastructure is time-consuming and costly.",
  "Flag if competitors lack charter access and must rely on bank-sponsor (BaaS) arrangements, which creates dependency risk (supplier power).",
  // New-tech / DeFi awareness
  "NEW TECHNOLOGY IMPACT: Evaluate whether blockchain, decentralized finance (DeFi), or programmable ledger protocols are a credible substitute or new entrant in each segment.",
  "For lending, payments, or deposit-taking segments, DeFi platforms and stablecoins may lower switching costs (Bargaining Power of Buyers) and introduce non-bank substitutes (Threat of Substitutes).",
  "If a segment competes with crypto-native products, mark Threat of Substitutes at least MEDIUM and explain the DeFi mechanism in the justification.",
  // Finance-specific supplier rule
  "BANK SUPPLIER POWER: For banking, lending, or deposit-gathering segments, depositors are the primary capital suppliers.",
  "When the supply of capital includes non-currency assets such as crypto assets, tokenized securities, or stablecoins — depositor bargaining power increases because customers have more alternative channels to allocate capital.",
  "Reflect this in Bargaining Power of Suppliers with MEDIUM or HIGH rating and document the alternative capital channels in the justification.",
  "No markdown, commentary, or prose outside the structured response.",
].join(" ");

function buildStep3Prompt(companyName: string, architecture: unknown): string {
  return [
    "Task: Produce Step 3 Competitive Landscape and Porter's Five Forces.",
    `Company: ${companyName}`,
    "Step 1 architecture input:",
    typeof architecture === "string" ? architecture : JSON.stringify(architecture, null, 2),
    "",
    "Review Prompt V2 requirements:",
    "- Validate competitor pairing by direct product/category overlap, revenue scale, and market position.",
    "- Use SEC/official filings for company and competitor segment scale where available.",
    "- Use reputable market share or industry sources for leader/challenger status.",
    "- Force ratings must reflect current economics and cite the source/claim used.",
    "- Put material uncertainty into verification_note, confidence, source_quality, and human_review_required.",
    "- Use source_quality=Official only when all material support comes from official disclosures; use Mixed when any market/industry source is needed.",
    "- Categories lacking enough quantitative or source grounding should be marked Low confidence and human_review_required=true.",
    "- Set pairing_status=VALIDATED when both company and competitor segments are confirmed by official filings.",
    "- Set pairing_status=PROVISIONAL when pairing relies on market research or inference.",
    "- Set pairing_status=LOW_EVIDENCE when overlap is speculative or the competitor's segment scale is unverified.",
  ].join("\n");
}


export async function POST(req: NextRequest): Promise<NextResponse<AnalyzeCompetitionResponse>> {
  try {
    const body = await req.json();
    const { companyName, architecture, apiKey: runtimeKey, llmProvider = "claude" as LLMProvider } = body;

    if (!companyName || !architecture) {
      return NextResponse.json(
        { categories: [], error: "Company name and architecture are required." },
        { status: 400 },
      );
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json(
        { categories: [], error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    const result = await callLLM({
      provider: llmProvider,
      apiKey,
      systemPrompt: STEP3_SYSTEM_PROMPT,
      prompt: buildStep3Prompt(companyName, architecture),
      maxTokens: 12288,
      responseSchema:
        llmProvider === "gemini" ? GEMINI_STEP3_RESPONSE_SCHEMA : STEP3_RESPONSE_SCHEMA,
      responseToolName: "submit_step3_structured_result",
      responseToolDescription:
        "Submit the Step 3 structured competition result with categories, sources, claims, and review summary.",
    });

    const structuredPayload = extractStructuredPayload(result, llmProvider);
    const structuredResult = parseStep3StructuredResult(structuredPayload);
    const categories = projectStep3StructuredToCategories(structuredResult);
    const step3Review = buildStep3ReviewState(structuredResult);

    if (categories.length === 0) {
      return NextResponse.json(
        {
          categories: [],
          structuredResult: null,
          step3Review: null,
          error: "The model did not return any Step 3 categories. Please try again.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ categories, structuredResult, step3Review });
  } catch (err: unknown) {
    console.error("[analyze-competition] Error:", err);
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ categories: [], error: message }, { status: 500 });
  }
}
