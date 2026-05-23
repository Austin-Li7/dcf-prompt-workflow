import { NextRequest, NextResponse } from "next/server";
import { callLLM, extractStructuredPayload, resolveApiKey } from "@/lib/llm-service";
import { guardedCallLLM } from "@/lib/llm-guard";
import {
  GEMINI_STEP3_CATEGORY_RESPONSE_SCHEMA,
  parseStep3Category,
  projectStep3CategoryToLegacy,
  STEP3_CATEGORY_RESPONSE_SCHEMA,
} from "@/lib/step3-schema";
import type {
  CategoryCompetitionEntry,
  LLMProvider,
  ReviseCompetitionResponse,
} from "@/types/cfp";

// =============================================================================
// POST /api/revise-competition
// =============================================================================
// Accepts JSON body:
//   - categoryData   (current CategoryCompetitionEntry object)
//   - userFeedback   (string)
//   - apiKey         (string, optional)
// =============================================================================

const REVISE_SYSTEM_PROMPT = [
  "You are producing a revised Step 3 v5.5 competitive landscape category for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  'The schema_version field (if present) must be exactly "v5.5".',
  "Use materiality compression: only update fields that the user feedback explicitly addresses.",
  "Every competitor pairing must be grounded in direct segment overlap, revenue scale, or verified market position.",
  "If evidence is weak or overlap is partial, lower confidence and set human_review_required=true.",
  "Every force must cite claim_id and source_ids — preserve existing IDs where the data is unchanged.",
  "REGULATORY ENVIRONMENT: For chartered bank/lender segments, a national bank charter is a structural moat — weight Threat of New Entrants LOW.",
  "Flag if competitors lack charter access and must rely on bank-sponsor (BaaS) arrangements.",
  "NEW TECHNOLOGY IMPACT: For lending, payments, or deposit-taking segments, DeFi platforms and stablecoins may lower switching costs and introduce non-bank substitutes.",
  "BANK SUPPLIER POWER: When capital supply includes crypto assets, tokenized securities, or stablecoins, depositor bargaining power increases — rate Suppliers MEDIUM or HIGH.",
  "No markdown, commentary, or prose outside the structured response.",
].join(" ");

export async function POST(req: NextRequest): Promise<NextResponse<ReviseCompetitionResponse>> {
  try {
    const body = await req.json();
    const {
      categoryData,
      structuredCategory,
      userFeedback,
      apiKey: runtimeKey,
      llmProvider = "claude" as LLMProvider,
    } = body;

    if ((!categoryData && !structuredCategory) || !userFeedback) {
      return NextResponse.json(
        { category: categoryData, error: "Category data and user feedback are required." },
        { status: 400 },
      );
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json(
        { category: categoryData, error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    const categoryForRevision = structuredCategory ?? {
      category_id: `category:${String(categoryData.category ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      category: categoryData.category,
      mapped_from_step1_ids: ["legacy:unknown"],
      materiality: "HIGH",
      primary_competitor: categoryData.primaryCompetitor,
      competitive_status: categoryData.competitiveStatus,
      basis_for_pairing: categoryData.basisForPairing,
      basis_claim_ids: ["legacy:claim"],
      source_ids: ["legacy:source"],
      source_quality: categoryData.sourceQuality ?? "Unverified",
      confidence: categoryData.confidence ?? "Low",
      human_review_required: true,
      verification_note: categoryData.verificationNote ?? "Legacy category revised without full Step 3 source grounding.",
      forces: {
        rivalry: { ...categoryData.forces.rivalry, claim_id: "legacy:claim", source_ids: ["legacy:source"] },
        new_entrants: { ...categoryData.forces.newEntrants, claim_id: "legacy:claim", source_ids: ["legacy:source"] },
        suppliers: { ...categoryData.forces.suppliers, claim_id: "legacy:claim", source_ids: ["legacy:source"] },
        buyers: { ...categoryData.forces.buyers, claim_id: "legacy:claim", source_ids: ["legacy:source"] },
        substitutes: { ...categoryData.forces.substitutes, claim_id: "legacy:claim", source_ids: ["legacy:source"] },
      },
    };

    const prompt = [
      "You are refining one Step 3 v5.5 competitive landscape category based on user feedback.",
      "Current structured category:",
      JSON.stringify(categoryForRevision, null, 2),
      "User feedback/correction:",
      userFeedback,
      "Task:",
      "- Update only fields affected by the user feedback.",
      "- competitive_status reflects the SUBJECT company's standing in this category (Leader / Challenger / Unclear) RELATIVE TO primary_competitor — never the competitor's own standing.",
      "- Preserve category_id, category, mapped_from_step1_ids, existing claim/source identifiers, and the structured shape.",
      "- Keep Review Prompt V2 honesty: if evidence is weak, lower confidence/source_quality and set human_review_required=true.",
      "- Competitor pairing must still be judged by direct overlap, revenue scale, and market position.",
      "- Return only the updated structured category matching the schema.",
      "",
      "Finance & Regulatory guidance (apply when the category involves lending, banking, deposits, payments, or insurance):",
      "- THREAT OF NEW ENTRANTS: Weight the regulatory moat heavily. A national bank charter (OCC/FDIC) is a durable barrier — rate Low when the subject holds a charter competitors cannot easily replicate.",
      "  Rate Medium when BaaS/partner-bank arrangements allow indirect entry. Rate High only when no license is required.",
      "- BARGAINING POWER OF SUPPLIERS: Depositors are capital suppliers. When crypto assets, stablecoins, or DeFi yield alternatives are accessible, supplier power increases.",
      "  Rate Medium for nascent DeFi alternatives, High when they are widely accessible with competitive yields. Name specific protocols or assets in the justification.",
      "- THREAT OF SUBSTITUTES: DeFi protocols, blockchain lending, and stablecoin payment rails are credible substitutes. Rate at least Medium for any lending, payments, or savings category even if current adoption is small.",
      "- Always note in verification_note: licenses held (bank charter, money transmitter, broker-dealer), and any pending regulation that could shift the competitive dynamic.",
    ].join("\n");

    const result = await guardedCallLLM({
      provider: llmProvider,
      apiKey,
      systemPrompt: REVISE_SYSTEM_PROMPT,
      prompt,
      maxTokens: 4096,
      responseSchema:
        llmProvider === "gemini"
          ? GEMINI_STEP3_CATEGORY_RESPONSE_SCHEMA
          : STEP3_CATEGORY_RESPONSE_SCHEMA,
      responseToolName: "submit_step3_category_revision",
      responseToolDescription:
        "Submit the revised Step 3 structured category while preserving source grounding fields.",
      skipConfirmation: true,
      skipContextCompression: true,
    });

    const revisedStructuredCategory = parseStep3Category(
      extractStructuredPayload(result, llmProvider),
    );
    const category = projectStep3CategoryToLegacy(revisedStructuredCategory);

    return NextResponse.json({ category, structuredCategory: revisedStructuredCategory });
  } catch (err: unknown) {
    console.error("[revise-competition] Error:", err);
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json(
      { category: null as unknown as CategoryCompetitionEntry, error: message },
      { status: 500 },
    );
  }
}
