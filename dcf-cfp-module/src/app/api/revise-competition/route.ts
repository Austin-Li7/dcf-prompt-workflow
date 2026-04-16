import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import type { LLMProvider } from "@/types/cfp";
import type { ReviseCompetitionResponse, CategoryCompetitionEntry } from "@/types/cfp";

// =============================================================================
// POST /api/revise-competition
// =============================================================================
// Accepts JSON body:
//   - categoryData   (current CategoryCompetitionEntry object)
//   - userFeedback   (string)
//   - apiKey         (string, optional)
// =============================================================================

function parseCategoryObject(raw: string): CategoryCompetitionEntry | null {
  // Try direct parse
  try {
    const parsed = JSON.parse(raw.trim());
    if (parsed && typeof parsed === "object" && parsed.category) return parsed;
  } catch { /* not raw JSON */ }

  // Try fenced block
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(raw)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && typeof parsed === "object" && parsed.category) return parsed;
    } catch { /* continue */ }
  }

  // Try finding any JSON object
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed && typeof parsed === "object" && parsed.category) return parsed;
    } catch { /* give up */ }
  }

  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse<ReviseCompetitionResponse>> {
  try {
    const body = await req.json();
    const { categoryData, userFeedback, apiKey: runtimeKey, llmProvider = "claude" as LLMProvider } = body;

    if (!categoryData || !userFeedback) {
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

    const prompt = `You are refining a Porter's Five Forces analysis based on user feedback.
Current Analysis: ${JSON.stringify(categoryData)}
User Feedback/Correction: ${userFeedback}
Task: Update the analysis to perfectly reflect the user's feedback. Keep the exact same JSON schema as the input. Return ONLY the updated JSON object.`;

    const result = await callLLM({ provider: llmProvider, apiKey, prompt, maxTokens: 4096 });
    const rawText = result.text;

    const category = parseCategoryObject(rawText);

    if (!category) {
      return NextResponse.json(
        { category: categoryData, error: "The model did not return a valid JSON object. Please try again." },
        { status: 422 },
      );
    }

    return NextResponse.json({ category });
  } catch (err: unknown) {
    console.error("[revise-competition] Error:", err);
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json(
      { category: null as unknown as CategoryCompetitionEntry, error: message },
      { status: 500 },
    );
  }
}
