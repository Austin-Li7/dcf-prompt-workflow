import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import type { LLMProvider } from "@/types/cfp";
import type { AnalyzeCompetitionResponse, CategoryCompetitionEntry } from "@/types/cfp";

// =============================================================================
// POST /api/analyze-competition
// =============================================================================
// Accepts JSON body:
//   - companyName       (string)
//   - architecture      (string — JSON of Step 1 architecture)
//   - apiKey            (string, optional)
// =============================================================================

function parseCategories(raw: string): CategoryCompetitionEntry[] {
  // Try direct parse
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) return parsed;
  } catch { /* not raw JSON */ }

  // Try extracting from fenced block
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(raw)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }
  }

  // Try finding any JSON array
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* give up */ }
  }

  return [];
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

    const prompt = `Conduct a Porter's Five Forces analysis for each Product Category in this Architecture: ${JSON.stringify(architecture)}. Identify the primary competitor (and state your basis for pairing). Rate each of the 5 forces (Low, Medium, High) with a 1-sentence justification.

CRITICAL OUTPUT FORMAT: Return ONLY a valid JSON array of objects. Format: [{ "category": "", "primaryCompetitor": "", "competitiveStatus": "", "basisForPairing": "", "forces": { "rivalry": { "rating": "", "justification": "" }, "newEntrants": { "rating": "", "justification": "" }, "suppliers": { "rating": "", "justification": "" }, "buyers": { "rating": "", "justification": "" }, "substitutes": { "rating": "", "justification": "" } } }]`;

    const result = await callLLM({ provider: llmProvider, apiKey, prompt, maxTokens: 8192 });
    const rawText = result.text;

    const categories = parseCategories(rawText);

    if (categories.length === 0) {
      return NextResponse.json(
        { categories: [], error: "The model did not return a valid JSON array. Please try again." },
        { status: 422 },
      );
    }

    return NextResponse.json({ categories });
  } catch (err: unknown) {
    console.error("[analyze-competition] Error:", err);
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ categories: [], error: message }, { status: 500 });
  }
}
