import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import type { LLMProvider } from "@/types/cfp";
import type { AnalyzeCapitalResponse, CapitalAllocationData } from "@/types/cfp";

// =============================================================================
// POST /api/analyze-capital
// =============================================================================

function parseCapitalData(raw: string): CapitalAllocationData | null {
  const tryParse = (str: string) => {
    try {
      const p = JSON.parse(str);
      if (p && p.investmentMatrix && p.checkpoints) return p as CapitalAllocationData;
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

export async function POST(req: NextRequest): Promise<NextResponse<AnalyzeCapitalResponse>> {
  try {
    const body = await req.json();
    const { step1Architecture, step2Financials, step4Synergies, recentNews, apiKey: runtimeKey, llmProvider = "claude" as LLMProvider } = body;

    if (!step1Architecture) {
      return NextResponse.json(
        { data: { investmentMatrix: [], checkpoints: { capexRunway: "", subsidiaryMargin: "", investmentEfficiency: "" } }, error: "Step 1 architecture is required." },
        { status: 400 },
      );
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json(
        { data: { investmentMatrix: [], checkpoints: { capexRunway: "", subsidiaryMargin: "", investmentEfficiency: "" } }, error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    const newsBlock = recentNews && typeof recentNews === "string" && recentNews.trim()
      ? recentNews.trim()
      : "No recent news provided.";

    const prompt = `Analyze Capital Allocation, Subsidiary Leverage, and Investment Moats based on the architecture, financials, synergies, AND the following breaking news/context: ${newsBlock}.
Architecture: ${JSON.stringify(step1Architecture)}
Financials: ${JSON.stringify(step2Financials || {})}
Synergies: ${JSON.stringify(step4Synergies || [])}
Task 1: Build a Strategic Investment Matrix mapping Core Infrastructure, Subsidiaries, and M&A to their Capital Intensity and Strategic Leverage. Link to Synergies. Factor in the recent news.
Task 2: Evaluate Financial Feasibility checkpoints: CapEx Runway, Subsidiary Margin, and Investment Efficiency.

CRITICAL OUTPUT FORMAT: Return ONLY a valid JSON object: { "investmentMatrix": [ { "pillar": "", "objective": "", "capitalIntensity": "", "strategicLeverage": "", "synergyLink": "", "efficiencyScore": 0 } ], "checkpoints": { "capexRunway": "", "subsidiaryMargin": "", "investmentEfficiency": "" } }`;

    const result = await callLLM({ provider: llmProvider, apiKey, prompt, maxTokens: 8192 });
    const rawText = result.text;

    const data = parseCapitalData(rawText);

    if (!data) {
      return NextResponse.json(
        { data: { investmentMatrix: [], checkpoints: { capexRunway: "", subsidiaryMargin: "", investmentEfficiency: "" } }, error: "Model did not return valid JSON." },
        { status: 422 },
      );
    }

    return NextResponse.json({ data });
  } catch (err: unknown) {
    console.error("[analyze-capital] Error:", err);
    const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json(
      { data: { investmentMatrix: [], checkpoints: { capexRunway: "", subsidiaryMargin: "", investmentEfficiency: "" } }, error: msg },
      { status: 500 },
    );
  }
}
