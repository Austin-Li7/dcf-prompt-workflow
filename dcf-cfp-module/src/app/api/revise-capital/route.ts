import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import type { LLMProvider } from "@/types/cfp";
import type { ReviseCapitalResponse, InvestmentMatrixEntry } from "@/types/cfp";

// =============================================================================
// POST /api/revise-capital
// =============================================================================

function parseEntry(raw: string): InvestmentMatrixEntry | null {
  const tryParse = (str: string) => {
    try {
      const p = JSON.parse(str);
      if (p && typeof p === "object" && p.pillar) return p as InvestmentMatrixEntry;
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

  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) {
    result = tryParse(objMatch[0]);
    if (result) return result;
  }

  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse<ReviseCapitalResponse>> {
  try {
    const body = await req.json();
    const { entryData, userFeedback, apiKey: runtimeKey, llmProvider = "claude" as LLMProvider } = body;

    if (!entryData || !userFeedback) {
      return NextResponse.json({ entry: entryData, error: "Entry data and feedback required." }, { status: 400 });
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json({ entry: entryData, error: "No API key found for the selected provider.", requiresApiKey: true }, { status: 401 });
    }

    const prompt = `Refine this capital allocation matrix entry based on user feedback. Keep the exact same JSON schema. Current Analysis: ${JSON.stringify(entryData)}. Feedback: ${userFeedback}. Return ONLY the updated JSON object.

Capital revision guidance:
- Do not modify the existing efficiencyScore unless the user explicitly requests a change or provides new financial data that justifies it.
- For banking or financial services segments, efficiencyScore reflects ROATCE (Return on Average Tangible Common Equity) and/or ROAE (Return on Average Equity), not a generic CapEx-to-revenue ratio.
- For bank segments, capital deployment analysis uses Tier 1 capital ratio, CET1 ratio, and RWA growth instead of PP&E CapEx lines.
- If the user provides updated Fed rate data or 10-year Treasury yield information, assess Asset-Liability Mismatch (ALM) risk: rising rates reduce mark-to-market value of long-duration bond portfolios and can trigger a liquidity crisis if depositor concentration is high. Flag this in validation context if material.`;

    const result = await callLLM({ provider: llmProvider, apiKey, prompt, maxTokens: 4096 });
    const rawText = result.text;

    const entry = parseEntry(rawText);
    if (!entry) {
      return NextResponse.json({ entry: entryData, error: "Model did not return valid JSON." }, { status: 422 });
    }

    return NextResponse.json({ entry });
  } catch (err: unknown) {
    console.error("[revise-capital] Error:", err);
    const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ entry: null as unknown as InvestmentMatrixEntry, error: msg }, { status: 500 });
  }
}
