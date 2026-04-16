import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import type { LLMProvider } from "@/types/cfp";
import type { GenerateForecastResponse, ProductForecast } from "@/types/cfp";

// =============================================================================
// POST /api/generate-forecast
// =============================================================================

function parseProducts(raw: string): ProductForecast[] {
  const tryArr = (s: string) => {
    try { const p = JSON.parse(s); if (Array.isArray(p)) return p; } catch { /* skip */ }
    return null;
  };

  let r = tryArr(raw.trim());
  if (r) return r;

  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(raw)) !== null) { r = tryArr(m[1].trim()); if (r) return r; }

  const arr = raw.match(/\[[\s\S]*\]/);
  if (arr) { r = tryArr(arr[0]); if (r) return r; }

  return [];
}

export async function POST(req: NextRequest): Promise<NextResponse<GenerateForecastResponse>> {
  try {
    const body = await req.json();
    const { step1Architecture, step2History, step3Competition, step4Complete, targetSegment, apiKey: runtimeKey, llmProvider = "claude" as LLMProvider } = body;

    if (!step1Architecture || !targetSegment) {
      return NextResponse.json({ products: [], error: "Architecture and target segment are required." }, { status: 400 });
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json({ products: [], error: "No API key found for the selected provider.", requiresApiKey: true }, { status: 401 });
    }

    const prompt = `You are the lead quantitative modeler. Project 20 consecutive quarters (5 fiscal years) of revenue for EVERY product inside the requested targetSegment: ${targetSegment}.
Use the historical baseline (${JSON.stringify(step2History || {})}) to anchor Y1 Q1. Apply competitive resistance (${JSON.stringify(step3Competition || {})}) and synergy multipliers (${JSON.stringify(step4Complete || {})}) to adjust growth rates.

CRITICAL OUTPUT FORMAT: Return ONLY a valid JSON array. Format:
[{ "productName": "", "categoryName": "", "forecast": [ { "year": 1, "quarter": "Q1", "revenueM": 0, "yoyGrowth": 0, "strategicDriver": "Explanation" } ] }] (Note: The forecast array MUST contain exactly 20 objects).`;

    const result = await callLLM({ provider: llmProvider, apiKey, prompt, maxTokens: 16384 });
    const rawText = result.text;

    const products = parseProducts(rawText);

    if (products.length === 0) {
      return NextResponse.json({ products: [], error: "Model did not return a valid JSON array." }, { status: 422 });
    }

    return NextResponse.json({ products });
  } catch (err: unknown) {
    console.error("[generate-forecast] Error:", err);
    const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ products: [], error: msg }, { status: 500 });
  }
}
