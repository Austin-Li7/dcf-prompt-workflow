import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import type { LLMProvider } from "@/types/cfp";
import type { AnalyzeSynergiesResponse, CapabilityPenetrationPath } from "@/types/cfp";

// =============================================================================
// POST /api/analyze-synergies
// =============================================================================

function parsePaths(raw: string): CapabilityPenetrationPath[] {
  const tryParse = (str: string) => {
    try {
      const p = JSON.parse(str);
      if (Array.isArray(p)) return p;
    } catch { /* skip */ }
    return null;
  };

  let result = tryParse(raw.trim());
  if (result) return result;

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(raw)) !== null) {
    result = tryParse(match[1].trim());
    if (result) return result;
  }

  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    result = tryParse(arrayMatch[0]);
    if (result) return result;
  }

  return [];
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

    const prompt = `You are an elite equity research analyst. Analyze Cross-Business Capability Penetration and Flywheels based on the provided data.
Architecture: ${JSON.stringify(step1Architecture)}
Financials: ${JSON.stringify(step2Financials || {})}
Competition: ${JSON.stringify(step3Competition || {})}
Task 1: Identify the single deepest core capability for each business line.
Task 2: Map Penetration Paths (Mechanism, Product Impact, Competitor Constraint).
Task 3: Trace Financial Outcomes (Revenue Enablement, Margin Expansion, CAC Reduction, Cost Displacement, or 'product-only').
Task 4: Flywheel Condition. Is it self-reinforcing?

CRITICAL OUTPUT FORMAT: Return ONLY a valid JSON array of objects. Format: [{ "sourceBusiness": "", "coreCapability": "", "recipientBusiness": "", "mechanism": "", "productImpact": "", "competitorConstraint": "", "financialSignal": { "type": "", "evidence": "", "status": "financially-material" | "product-only" }, "flywheel": { "isFlywheel": false, "loopDescription": "N/A if false" }, "impactScore": 0 }]`;

    const result = await callLLM({ provider: llmProvider, apiKey, prompt, maxTokens: 8192 });
    const rawText = result.text;

    const paths = parsePaths(rawText);

    if (paths.length === 0) {
      return NextResponse.json({ paths: [], error: "The model did not return a valid JSON array." }, { status: 422 });
    }

    return NextResponse.json({ paths });
  } catch (err: unknown) {
    console.error("[analyze-synergies] Error:", err);
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ paths: [], error: message }, { status: 500 });
  }
}
