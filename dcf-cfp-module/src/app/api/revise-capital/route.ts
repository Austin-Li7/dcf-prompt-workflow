import { NextRequest, NextResponse } from "next/server";
import { callLLM, extractStructuredPayload, resolveApiKey } from "@/lib/llm-service";
import {
  GEMINI_STEP4_CAPITAL_METRIC_RESPONSE_SCHEMA,
  parseStep4CapitalMetric,
  STEP4_CAPITAL_METRIC_RESPONSE_SCHEMA,
} from "@/lib/step4-schema";
import type { LLMProvider, InvestmentMatrixEntry } from "@/types/cfp";
import type { ReviseCapitalResponse } from "@/types/cfp";

// =============================================================================
// POST /api/revise-capital
// =============================================================================

const REVISE_CAPITAL_SYSTEM_PROMPT = [
  "You are refining a single Step 4.5 v5.5 capital allocation metric for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  "Use materiality compression: only update fields that the user feedback explicitly addresses.",
  "Preserve metric_id, claim_id, and source_ids where the data is unchanged.",
  "Do not modify step5_revenue_ceiling or capital workflow_status unless the user explicitly addresses it.",
  "Apply Review Prompt V2: but-for test, source specificity, and projection rule.",
  "BANK CAPITAL: For banking/financial segments, use regulatory capital metrics (Tier 1 ratio, CET1, RWA growth) not PP&E CapEx.",
  "efficiency_score must reflect ROATCE/ROAE for bank segments; positive = above cost of equity.",
  "ALM RISK: If the user mentions rate changes or Treasury yield moves, assess Asset-Liability Mismatch risk in review_note.",
  "No markdown, commentary, or prose outside the structured response.",
].join(" ");

export async function POST(req: NextRequest): Promise<NextResponse<ReviseCapitalResponse>> {
  try {
    const body = await req.json();
    const {
      entryData,
      structuredMetric,
      userFeedback,
      apiKey: runtimeKey,
      llmProvider = "claude" as LLMProvider,
    } = body;

    if (!entryData || !userFeedback) {
      return NextResponse.json(
        { entry: entryData, error: "Entry data and feedback required." },
        { status: 400 },
      );
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json(
        { entry: entryData, error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    const currentMetric = structuredMetric ?? {
      metric_id: `metric:legacy:${String(entryData.pillar ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      pillar: entryData.pillar,
      objective: entryData.objective,
      capital_intensity: entryData.capitalIntensity ?? "Unknown",
      strategic_leverage: entryData.strategicLeverage,
      synergy_link: entryData.synergyLink,
      efficiency_score: entryData.efficiencyScore ?? 0,
      claim_id: "legacy:claim",
      source_ids: ["legacy:source"],
      review_note: "Legacy metric revised without full source grounding.",
    };

    const prompt = [
      "Refine this Step 4.5 v5.5 capital allocation metric based on user feedback.",
      "Current structured metric:",
      JSON.stringify(currentMetric, null, 2),
      "User feedback:",
      userFeedback,
      "Task:",
      "- Update only fields affected by the user feedback.",
      "- Preserve metric_id, claim_id, source_ids, and synergy_link unless user explicitly changes them.",
      "- Do NOT modify efficiency_score unless the user explicitly requests it or provides new financial data.",
      "- Do NOT infer or modify step5_revenue_ceiling from this single metric revision.",
      "",
      "Finance & Banking capital rules (apply when segment involves lending, banking, deposits, or payments):",
      "- Use Tier 1 capital ratio, CET1 ratio, and RWA growth — not PP&E CapEx — for bank capital metrics.",
      "- efficiency_score for bank entries reflects ROATCE and/or ROAE. Positive = above cost of equity (typically 10-15%).",
      "- ALM / Interest Rate Risk: if user provides Fed rate or Treasury yield data, assess Asset-Liability Mismatch.",
      "  Estimate unrealized loss per 100bps rise; flag SVB-pattern risk (long-duration bonds + concentrated depositors).",
      "  Document findings in review_note.",
    ].join("\n");

    const result = await callLLM({
      provider: llmProvider,
      apiKey,
      systemPrompt: REVISE_CAPITAL_SYSTEM_PROMPT,
      prompt,
      maxTokens: 4096,
      responseSchema:
        llmProvider === "gemini"
          ? GEMINI_STEP4_CAPITAL_METRIC_RESPONSE_SCHEMA
          : STEP4_CAPITAL_METRIC_RESPONSE_SCHEMA,
      responseToolName: "submit_step4_capital_metric_revision",
      responseToolDescription:
        "Submit the revised Step 4.5 capital metric preserving source grounding and synergy links.",
    });

    const revisedStructured = parseStep4CapitalMetric(extractStructuredPayload(result, llmProvider));

    const entry: InvestmentMatrixEntry = {
      pillar: revisedStructured.pillar,
      objective: revisedStructured.objective,
      capitalIntensity: revisedStructured.capital_intensity,
      strategicLeverage: revisedStructured.strategic_leverage,
      synergyLink: revisedStructured.synergy_link,
      efficiencyScore: entryData.efficiencyScore,
    };

    return NextResponse.json({ entry, structuredMetric: revisedStructured });
  } catch (err: unknown) {
    console.error("[revise-capital] Error:", err);
    let message = err instanceof Error ? err.message : "An unexpected error occurred.";
    if (message.startsWith("[") || message.startsWith("{")) {
      message = "The revision response didn't match the expected format. Please try again.";
    }
    return NextResponse.json(
      { entry: null as never, error: message },
      { status: 500 },
    );
  }
}
