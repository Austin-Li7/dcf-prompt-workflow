import { NextRequest, NextResponse } from "next/server";
import { callLLM, parseStructuredJsonText, resolveApiKey } from "@/lib/llm-service";
import {
  GEMINI_STEP3_CATEGORY_RESPONSE_SCHEMA,
  parseStep3Category,
  STEP3_CATEGORY_RESPONSE_SCHEMA,
} from "@/lib/step3-schema";
import type {
  AddCompetitorResponse,
  CategoryCompetitionEntry,
  LLMProvider,
  Step3StructuredCategory,
} from "@/types/cfp";

// =============================================================================
// POST /api/add-competitor
// =============================================================================
// Handles three related operations via the `mode` field:
//   "add-competitor"  — new competitor for an existing category
//   "add-category"    — brand-new category + competitor (AI-generated)
//   "reanalyse"       — replace current competitor, regenerate all five forces
//
// Body:
//   companyName               string  (required)
//   architecture              string  (Step 1 JSON, optional but improves quality)
//   competitor                string  (required — the new competitor name)
//   category                  string  (required — existing or new category name)
//   mode                      "add-competitor" | "add-category" | "reanalyse"
//   existingStructuredCategory  object  (optional — current structured category for reanalyse)
//   apiKey                    string  (optional runtime key)
//   llmProvider               "claude" | "gemini"
// =============================================================================

type AddMode = "add-competitor" | "add-category" | "reanalyse";

const SYSTEM_PROMPT = [
  "You are producing a single Step 3 v5.5 competitive landscape category for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  "Every Porter force must have rating, justification, claim_id, and source_ids.",
  "CRITICAL: Each force justification must be ≤ 250 characters. Be concise — one tight sentence.",
  "Validate competitor pairing by direct product/category overlap, revenue scale, and market position.",
  "If evidence is weak or overlap is partial, lower confidence and set human_review_required=true.",
  "Use source_quality=Official only when all material support comes from official filings.",
  "category_id must be a unique slug (e.g. 'cat:digital-media:salesforce').",
  "mapped_from_step1_ids must contain at least one ID; use ['manual:added'] if no Step 1 ID applies.",
  "No markdown, commentary, or prose outside the structured response.",
].join(" ");

function buildPrompt(
  companyName: string,
  architecture: string | null,
  competitor: string,
  category: string,
  mode: AddMode,
  existingContext: string | undefined,
): string {
  const lines: string[] = [];

  if (mode === "reanalyse" && existingContext) {
    lines.push(
      `Task: Re-analyse one Porter's Five Forces category for ${companyName}.`,
      `The primary competitor has changed to: ${competitor}`,
      `Category: ${category}`,
      "Regenerate ALL five forces, competitive status, basis for pairing,",
      "confidence, source quality, and verification note for the new competitor.",
      "Preserve category_id and mapped_from_step1_ids from the previous entry.",
      "Previous structured category (context only — do NOT copy its force ratings):",
      existingContext,
    );
  } else if (mode === "add-category") {
    lines.push(
      `Task: Generate a new Porter's Five Forces category for ${companyName}.`,
      `New category name: ${category}`,
      `Primary competitor: ${competitor}`,
    );
    if (architecture) {
      lines.push("Step 1 architecture (for segment context):", architecture);
    }
  } else {
    // add-competitor
    lines.push(
      `Task: Generate a Porter's Five Forces analysis for ${companyName} vs. ${competitor}.`,
      `Category: ${category}`,
    );
    if (architecture) {
      lines.push("Step 1 architecture (for segment context):", architecture);
    }
  }

  lines.push(
    "Requirements:",
    "- Analyse all five forces: competitive rivalry, threat of new entrants, supplier power, buyer power, threat of substitutes.",
    "- Every force must include a rating (Low/Medium/High), a concise justification, a claim_id, and source_ids.",
    "- Set human_review_required=true if any force relies on inference rather than disclosed data.",
    "- Competitor pairing must reflect direct segment overlap and revenue scale.",
  );

  return lines.join("\n");
}

function projectStructuredToLegacy(cat: Step3StructuredCategory): CategoryCompetitionEntry {
  return {
    category: cat.category,
    primaryCompetitor: cat.primary_competitor,
    competitiveStatus: cat.competitive_status,
    basisForPairing: cat.basis_for_pairing,
    forces: {
      rivalry: { rating: cat.forces.rivalry.rating, justification: cat.forces.rivalry.justification },
      newEntrants: { rating: cat.forces.new_entrants.rating, justification: cat.forces.new_entrants.justification },
      suppliers: { rating: cat.forces.suppliers.rating, justification: cat.forces.suppliers.justification },
      buyers: { rating: cat.forces.buyers.rating, justification: cat.forces.buyers.justification },
      substitutes: { rating: cat.forces.substitutes.rating, justification: cat.forces.substitutes.justification },
    },
    verificationNote: cat.verification_note ?? undefined,
    sourceQuality: cat.source_quality,
    confidence: cat.confidence,
  };
}

function extractStructuredPayload(
  result: { text: string; structuredData?: unknown; finishReason?: string; finishMessage?: string },
  provider: LLMProvider,
): unknown {
  if (result.structuredData && typeof result.structuredData === "object") {
    return result.structuredData;
  }
  return parseStructuredJsonText(result.text, {
    provider,
    finishReason: result.finishReason,
    finishMessage: result.finishMessage,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse<AddCompetitorResponse>> {
  try {
    const body = await req.json();
    const {
      companyName,
      architecture,
      competitor,
      category,
      mode = "add-competitor" as AddMode,
      existingStructuredCategory,
      apiKey: runtimeKey,
      llmProvider = "claude" as LLMProvider,
    } = body as {
      companyName: string;
      architecture?: string;
      competitor: string;
      category: string;
      mode?: AddMode;
      existingStructuredCategory?: unknown;
      apiKey?: string;
      llmProvider?: LLMProvider;
    };

    if (!companyName || !competitor || !category) {
      return NextResponse.json(
        {
          category: null,
          structuredCategory: null,
          error: "companyName, competitor, and category are required.",
        },
        { status: 400 },
      );
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json(
        {
          category: null,
          structuredCategory: null,
          error: "No API key found for the selected provider.",
          requiresApiKey: true,
        },
        { status: 401 },
      );
    }

    const existingContext = existingStructuredCategory
      ? JSON.stringify(existingStructuredCategory, null, 2)
      : undefined;

    const prompt = buildPrompt(
      companyName,
      architecture ?? null,
      competitor,
      category,
      mode,
      existingContext,
    );

    const result = await callLLM({
      provider: llmProvider,
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      maxTokens: 4096,
      responseSchema:
        llmProvider === "gemini"
          ? GEMINI_STEP3_CATEGORY_RESPONSE_SCHEMA
          : STEP3_CATEGORY_RESPONSE_SCHEMA,
      responseToolName: "submit_step3_category",
      responseToolDescription:
        "Submit a single Step 3 structured category with Porter's Five Forces analysis.",
    });

    const structuredCategory = parseStep3Category(extractStructuredPayload(result, llmProvider));
    const categoryEntry = projectStructuredToLegacy(structuredCategory);

    return NextResponse.json({ category: categoryEntry, structuredCategory });
  } catch (err: unknown) {
    console.error("[add-competitor] Error:", err);
    let message = err instanceof Error ? err.message : "An unexpected error occurred.";
    // ZodError messages are raw JSON arrays — surface a friendlier message instead.
    if (message.startsWith("[") || message.startsWith("{")) {
      message = "The analysis response didn't match the expected format. Please try again.";
    }
    return NextResponse.json(
      { category: null, structuredCategory: null, error: message },
      { status: 500 },
    );
  }
}
