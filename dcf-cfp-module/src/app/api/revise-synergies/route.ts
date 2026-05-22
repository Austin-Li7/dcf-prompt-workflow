import { NextRequest, NextResponse } from "next/server";
import { callLLM, extractStructuredPayload, resolveApiKey } from "@/lib/llm-service";
import { guardedCallLLM } from "@/lib/llm-guard";
import {
  GEMINI_STEP4_SYNERGY_RESPONSE_SCHEMA,
  parseStep4Synergy,
  projectStep4SynergyToPath,
  STEP4_SYNERGY_RESPONSE_SCHEMA,
} from "@/lib/step4-schema";
import type { LLMProvider } from "@/types/cfp";
import type { ReviseSynergiesResponse } from "@/types/cfp";

// =============================================================================
// POST /api/revise-synergies
// =============================================================================

const REVISE_SYNERGIES_SYSTEM_PROMPT = [
  "You are refining a single Step 4 v5.5 synergy entry for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  "Use materiality compression: only update fields that the user feedback explicitly addresses.",
  "Preserve synergy_id, basis_claim_ids, and source_ids where the data is unchanged.",
  "Apply Review Prompt V2: but-for test, reciprocity test, projection rule.",
  "If evidence is insufficient after revision, lower driver_eligibility and set human_review_required=true.",
  "Do not treat management targets or hypothetical future outcomes as verified proof.",
  "BANK SYNERGIES: For banking/financial segments, evaluate cross-sell via the Financial Services Productivity Loop.",
  "If synergy relies on shared regulatory infrastructure (bank charter), classify as fully_verified_synergy and note the moat.",
  "No markdown, commentary, or prose outside the structured response.",
].join(" ");

export async function POST(req: NextRequest): Promise<NextResponse<ReviseSynergiesResponse>> {
  try {
    const body = await req.json();
    const {
      pathData,
      structuredSynergy,
      userFeedback,
      apiKey: runtimeKey,
      llmProvider = "claude" as LLMProvider,
    } = body;

    if (!pathData || !userFeedback) {
      return NextResponse.json(
        { path: pathData, error: "Path data and feedback are required." },
        { status: 400 },
      );
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json(
        { path: pathData, error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    const currentSynergy = structuredSynergy ?? {
      synergy_id: `synergy:legacy:${String(pathData.sourceBusiness ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      source_business: pathData.sourceBusiness,
      core_capability: pathData.coreCapability,
      recipient_business: pathData.recipientBusiness,
      mechanism: pathData.mechanism,
      product_impact: pathData.productImpact,
      competitor_constraint: pathData.competitorConstraint,
      financial_signal: {
        type: pathData.financialSignal?.type ?? "Revenue Enablement",
        evidence: pathData.financialSignal?.evidence ?? "",
        status: pathData.financialSignal?.status ?? "product-only",
        claim_id: "legacy:claim",
        source_ids: ["legacy:source"],
      },
      flywheel: {
        is_flywheel: pathData.flywheel?.isFlywheel ?? false,
        loop_description: pathData.flywheel?.loopDescription ?? "",
      },
      integration_verdict: "PARTIAL",
      differentiation_verdict: "PARTIAL",
      causality_verdict: "PARTIAL",
      classification: "context_only",
      driver_eligibility: "CONTEXT_ONLY",
      basis_claim_ids: ["legacy:claim"],
      financial_metric_link: "",
      impact_score: pathData.impactScore ?? 0,
      human_review_required: true,
      review_rationale: pathData.reviewRationale ?? "Legacy synergy revised without full source grounding.",
    };

    const prompt = [
      "Refine this Step 4 v5.5 synergy entry based on user feedback.",
      "Current structured synergy:",
      JSON.stringify(currentSynergy, null, 2),
      "User feedback:",
      userFeedback,
      "Task:",
      "- Update only fields affected by the user feedback.",
      "- Preserve synergy_id, basis_claim_ids, and source grounding where unchanged.",
      "- Re-evaluate driver_eligibility after revision: FULL only for proven integration + differentiation + causality.",
      "- Set human_review_required=true if any verdict is PARTIAL or evidence relies on inference.",
      "- Do NOT modify impact_score unless the user explicitly asks.",
      "",
      "Finance & Banking guidance (apply when segment involves lending, banking, deposits, or payments):",
      "- Traditional CapEx sharing does not apply to bank segments.",
      "- Evaluate cross-sell via the Financial Services Productivity Loop (multi-product attach rates, CAC reduction).",
      "- If synergy relies on bank charter (regulatory moat), classify fully_verified_synergy and document in review_rationale.",
      "- Preserve step5_revenue_ceiling consistency — do not infer new revenue ceilings from this single synergy.",
    ].join("\n");

    const result = await guardedCallLLM({
      provider: llmProvider,
      apiKey,
      systemPrompt: REVISE_SYNERGIES_SYSTEM_PROMPT,
      prompt,
      maxTokens: 4096,
      responseSchema:
        llmProvider === "gemini"
          ? GEMINI_STEP4_SYNERGY_RESPONSE_SCHEMA
          : STEP4_SYNERGY_RESPONSE_SCHEMA,
      responseToolName: "submit_step4_synergy_revision",
      responseToolDescription:
        "Submit the revised Step 4 synergy entry preserving source grounding and driver eligibility.",
    });

    const revisedStructured = parseStep4Synergy(extractStructuredPayload(result, llmProvider));
    const path = {
      ...projectStep4SynergyToPath(revisedStructured),
      impactScore: pathData.impactScore,
    };

    return NextResponse.json({ path, structuredSynergy: revisedStructured });
  } catch (err: unknown) {
    console.error("[revise-synergies] Error:", err);
    let message = err instanceof Error ? err.message : "An unexpected error occurred.";
    if (message.startsWith("[") || message.startsWith("{")) {
      message = "The revision response didn't match the expected format. Please try again.";
    }
    return NextResponse.json(
      { path: null as never, error: message },
      { status: 500 },
    );
  }
}
