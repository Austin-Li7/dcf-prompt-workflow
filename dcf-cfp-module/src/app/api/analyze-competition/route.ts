import { NextRequest, NextResponse } from "next/server";
import { extractStructuredPayload, resolveApiKey } from "@/lib/llm-service";
import { guardedCallLLM } from "@/lib/llm-guard";
import {
  buildStep3ReviewState,
  GEMINI_STEP3_RESPONSE_SCHEMA,
  parseStep3StructuredResult,
  projectStep3StructuredToCategories,
  STEP3_RESPONSE_SCHEMA,
} from "@/lib/step3-schema";
import { buildStep2FinancialSummary } from "@/lib/step3-financial-context";
import type {
  LLMProvider,
  AnalyzeCompetitionResponse,
  BusinessArchitecture,
  HistoricalExtractionRow,
  TrendAnalysisResult,
} from "@/types/cfp";

// =============================================================================
// POST /api/analyze-competition
// =============================================================================
// Accepts JSON body:
//   - companyName         (string)
//   - architecture        (BusinessArchitecture — Step 1 architecture JSON)
//   - companyType         (string | null — e.g. "hybrid", "financial_bank", "industrial")
//   - step2Rows           (HistoricalExtractionRow[], optional — confirmed Step 2 history rows)
//   - step2TrendAnalysis  (TrendAnalysisResult | null, optional — S-curve fit results)
//   - apiKey              (string, optional)
// =============================================================================

const STEP3_SYSTEM_PROMPT = [
  "You are producing the Step 3 competitive landscape contract for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  'The top-level schema_version field must be exactly "v5.5".',
  // Segment coverage requirement — most important rule
  "SEGMENT COVERAGE REQUIREMENT: Generate AT LEAST ONE Porter's Five Forces category for EVERY top-level segment listed in the Step 1 architecture.",
  "Do NOT collapse multiple segments into a single category.",
  "For a hybrid company that has both bank-mode segments (lending, deposits, NII-driven) and industrial-mode segments (SaaS, platform, revenue-driven), each segment arm requires its own separate category with its own competitor pairing and five-force ratings.",
  "Within each segment you may use materiality to pick the single most material business line as the representative category — but you must cover every segment.",
  // Competitive status framing
  "competitive_status describes the SUBJECT company — i.e. whether the subject is the Leader or Challenger in that category, measured RELATIVE TO primary_competitor. It is NOT the competitor's own standing. Use 'Unclear' only when the subject's relative position genuinely cannot be determined from sources.",
  "Prefer official filings, company releases, and reputable market research. Do not fabricate URLs.",
  "If evidence is weak or overlap is partial, set lower confidence and human_review_required=true.",
  "Every category, pairing basis, and force must cite claim_id and source_ids.",
  "Include a review_summary and validation_warnings suitable for a human review UI.",
  // Workflow-mode-aware force ratings
  "BANK-MODE SEGMENTS (workflow_mode=bank — lending, deposits, NII-driven): Threat of New Entrants should be LOW when the subject holds a national bank charter (OCC/FDIC), because replication of the charter, capital requirements, and compliance infrastructure is a durable barrier. Flag if competitors lack charter access and must use BaaS arrangements. Depositors are the primary capital suppliers — rate Supplier Power MEDIUM or HIGH when crypto/stablecoins offer alternative capital channels.",
  "INDUSTRIAL-MODE SEGMENTS (workflow_mode=industrial — SaaS, platform, technology): Threat of New Entrants reflects technology barriers, switching costs, and network effects — not regulatory moats. Supplier Power reflects talent, cloud infra, and data access. Buyer Power reflects customer concentration and API lock-in.",
  // DeFi awareness
  "NEW TECHNOLOGY IMPACT: For lending, payments, or deposit-taking segments, DeFi platforms and stablecoins may lower switching costs and introduce non-bank substitutes. Mark Threat of Substitutes at least MEDIUM for any such segment.",
  "No markdown, commentary, or prose outside the structured response.",
].join(" ");

/** Build the segment coverage table shown to the LLM — one row per segment with its workflow_mode. */
function buildSegmentTable(architecture: BusinessArchitecture): string {
  const rows = architecture.architecture.map((seg, i) => {
    const mode = seg.workflow_mode ?? "unspecified";
    const lines = seg.businessLines.map((bl) => bl.name).join(", ");
    return `  ${i + 1}. "${seg.segment}" (workflow_mode=${mode}) — business lines: ${lines}`;
  });
  return rows.join("\n");
}

function buildStep3Prompt(
  companyName: string,
  architecture: BusinessArchitecture,
  companyType: string | null,
  financialSummary: string | null,
): string {
  const segmentCount = architecture.architecture.length;
  const hybridNote =
    companyType === "hybrid"
      ? `\nCOMPANY TYPE: hybrid — this company has BOTH bank-mode segments (NII/charter-regulated) AND industrial-mode segments (platform/SaaS revenue). The downstream valuation uses a Sum-of-the-Parts (SOTP) model, so each segment arm must be competitively benchmarked independently.`
      : companyType === "financial_bank"
      ? `\nCOMPANY TYPE: financial_bank — all segments are NII-driven and charter-regulated. Apply bank-mode Porter force logic throughout.`
      : "";

  const financialBlock = financialSummary
    ? [
        "",
        financialSummary,
        "FINANCIAL BENCHMARKING INSTRUCTIONS:",
        "- Where a segment's NIM or revenue CAGR is materially above peer median, acknowledge the financial premium in verification_note and factor it into Competitive Rivalry and competitive_status ratings.",
        "- Where an S-curve plateau is DETECTED, flag growth constraint risk in the category's verification_note.",
        "- Prefer these Step 2 numbers over general industry estimates when sizing scale relative to competitors.",
        "- Do NOT fabricate competitor financials — if competitor revenue is unknown, state so and lower confidence.",
      ].join("\n")
    : "";

  return [
    "Task: Produce Step 3 Competitive Landscape and Porter's Five Forces.",
    `Company: ${companyName}`,
    companyType ? `Company type: ${companyType}` : "",
    hybridNote,
    financialBlock,
    "",
    `MANDATORY: Produce exactly ${segmentCount} or more Porter categories — one per segment below. Do NOT merge segments.`,
    "Segment coverage table (each segment MUST have its own category in your output):",
    buildSegmentTable(architecture),
    "",
    "Full Step 1 architecture (for business line detail):",
    JSON.stringify(architecture, null, 2),
    "",
    "Review Prompt V2 requirements:",
    "- Validate competitor pairing by direct product/category overlap, revenue scale, and market position.",
    "- Use SEC/official filings for company and competitor segment scale where available.",
    "- Use reputable market share or industry sources for leader/challenger status.",
    "- Force ratings must reflect current economics and cite the source/claim used.",
    "- Apply workflow_mode-aware force logic: bank-mode segments get charter-moat treatment; industrial-mode segments get tech-barrier treatment.",
    "- Put material uncertainty into verification_note, confidence, source_quality, and human_review_required.",
    "- Use source_quality=Official only when all material support comes from official disclosures; use Mixed when any market/industry source is needed.",
    "- Categories lacking enough quantitative or source grounding should be marked Low confidence and human_review_required=true.",
    "- Set pairing_status=VALIDATED when both company and competitor segments are confirmed by official filings.",
    "- Set pairing_status=PROVISIONAL when pairing relies on market research or inference.",
    "- Set pairing_status=LOW_EVIDENCE when overlap is speculative or the competitor's segment scale is unverified.",
  ].filter(Boolean).join("\n");
}


export async function POST(req: NextRequest): Promise<NextResponse<AnalyzeCompetitionResponse>> {
  try {
    const body = await req.json();
    const {
      companyName,
      architecture,
      companyType = null,
      step2Rows = [],
      step2TrendAnalysis = null,
      apiKey: runtimeKey,
      llmProvider = "claude" as LLMProvider,
    }: {
      companyName: string;
      architecture: BusinessArchitecture;
      companyType?: string | null;
      step2Rows?: HistoricalExtractionRow[];
      step2TrendAnalysis?: TrendAnalysisResult | null;
      apiKey?: string;
      llmProvider?: LLMProvider;
    } = body;

    if (!companyName || !architecture) {
      return NextResponse.json(
        { categories: [], error: "Company name and architecture are required." },
        { status: 400 },
      );
    }

    const financialSummary = buildStep2FinancialSummary(step2Rows, step2TrendAnalysis);

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json(
        { categories: [], error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    // Retry once — models occasionally return malformed JSON on large structured outputs.
    let structuredResult: ReturnType<typeof parseStep3StructuredResult> | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await guardedCallLLM({
          provider: llmProvider,
          apiKey,
          systemPrompt: STEP3_SYSTEM_PROMPT,
          prompt: buildStep3Prompt(companyName, architecture, companyType, financialSummary),
          maxTokens: 12288,
          responseSchema:
            llmProvider === "gemini" ? GEMINI_STEP3_RESPONSE_SCHEMA : STEP3_RESPONSE_SCHEMA,
          responseToolName: "submit_step3_structured_result",
          responseToolDescription:
            "Submit the Step 3 structured competition result with categories, sources, claims, and review summary.",
        });
        const structuredPayload = extractStructuredPayload(result, llmProvider);
        structuredResult = parseStep3StructuredResult(structuredPayload);
        break;
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          console.warn(`[analyze-competition] Attempt ${attempt} failed, retrying:`, err instanceof Error ? err.message : err);
        }
      }
    }
    if (!structuredResult) throw lastError;

    // Check every segment has at least one Porter category — run unconditionally so a
    // model that produces the right *count* but covers one segment twice still gets caught.
    const segmentCount = Array.isArray(architecture?.architecture) ? architecture.architecture.length : 0;
    if (segmentCount > 0) {
      const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const missing = architecture.architecture
        .filter((seg) => !structuredResult!.categories.some((c) =>
          c.mapped_from_step1_ids.some((id) => {
            const idLower = id.toLowerCase();
            const segLower = seg.segment.toLowerCase();
            return idLower.includes(segLower) || idLower.includes(slugify(seg.segment));
          }) ||
          c.category.toLowerCase().includes(seg.segment.toLowerCase())
        ))
        .map((seg) => seg.segment);
      if (missing.length > 0) {
        structuredResult.validation_warnings.push({
          code: "SEGMENT_COVERAGE_INCOMPLETE",
          severity: "high",
          message: `Porter analysis missing for segment(s): ${missing.join(", ")}. Add categories for these segments before proceeding.`,
          category_ids: [],
        });
      }
    }

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
