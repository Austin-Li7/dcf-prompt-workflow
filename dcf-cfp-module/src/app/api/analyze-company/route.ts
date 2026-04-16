import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import { extractPdfText } from "@/lib/pdf-extract";
import type { LLMProvider } from "@/types/cfp";
import type { AnalyzeCompanyResponse, BusinessArchitecture } from "@/types/cfp";

// =============================================================================
// POST /api/analyze-company
// =============================================================================
// Accepts multipart/form-data:
//   - companyName  (string, required)
//   - tenK         (single PDF, optional)
//   - tenQ         (single PDF, optional)
//   - apiKey       (string, optional — runtime override when env var is absent)
// =============================================================================

const MAX_PAGES = 50;

/** Pull the JSON code block from the LLM markdown response. */
function extractArchitectureJson(markdown: string): BusinessArchitecture | null {
  const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = jsonBlockRegex.exec(markdown)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && (parsed.architecture || parsed.sources)) {
        return parsed as BusinessArchitecture;
      }
    } catch {
      // Try next block
    }
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse<AnalyzeCompanyResponse>> {
  try {
    const formData = await req.formData();

    // ---- Extract company name ----
    const companyName = formData.get("companyName");
    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
      return NextResponse.json(
        { rawMarkdown: "", architectureJson: null, error: "Company name is required." },
        { status: 400 },
      );
    }

    // ---- Validate file counts (max 1 each) ----
    const tenKFiles = formData.getAll("tenK");
    const tenQFiles = formData.getAll("tenQ");

    if (tenKFiles.length > 1) {
      return NextResponse.json(
        { rawMarkdown: "", architectureJson: null, error: "Only one 10-K file is allowed per request." },
        { status: 400 },
      );
    }
    if (tenQFiles.length > 1) {
      return NextResponse.json(
        { rawMarkdown: "", architectureJson: null, error: "Only one 10-Q file is allowed per request." },
        { status: 400 },
      );
    }

    // ---- Parse PDFs ----
    const documentTexts: string[] = [];

    const parsePdfFile = async (file: FormDataEntryValue | null, label: string) => {
      if (!file || !(file instanceof File) || file.size === 0) return;
      const arrayBuffer = await file.arrayBuffer();
      const text = await extractPdfText(arrayBuffer, MAX_PAGES);
      if (text.trim()) {
        documentTexts.push(`--- ${label} ---\n${text}`);
      }
    };

    await parsePdfFile(tenKFiles[0] ?? null, "Form 10-K");
    await parsePdfFile(tenQFiles[0] ?? null, "Form 10-Q");

    if (documentTexts.length === 0) {
      return NextResponse.json(
        { rawMarkdown: "", architectureJson: null, error: "At least one PDF (10-K or 10-Q) is required." },
        { status: 400 },
      );
    }

    const extractedPdfText = documentTexts.join("\n\n");

    // ---- Resolve API key ----
    const runtimeKey = formData.get("apiKey") as string | null;
    const llmProvider = (formData.get("llmProvider") as LLMProvider) || "claude";
    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey ?? undefined);

    if (needsKey) {
      return NextResponse.json(
        { rawMarkdown: "", architectureJson: null, error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    // ---- Build prompt ----
    const prompt = [
      "Task: Build a comprehensive business architecture breakdown of the company.",
      `Company: ${companyName.trim()}`,
      `Document Text: ${extractedPdfText}`,
      "Scope: Provide a complete mapping of reported operating segments, business lines within each segment, product families, specific commercial offerings, and revenue generation mechanics.",
      "Rules: Base segmentation strictly on how the company reports it. Clearly distinguish between Reported operating segments, Revenue categories, and Product groupings. Do not estimate revenue contribution. Do not analyze margins, growth, or performance. Do not provide valuation commentary.",
      "Required Output Format:",
      "Part 1: Segment-Level Product Architecture (Major Categories, Sub-products, Customer Type, Data Source).",
      "Part 2: Source References.",
      "Part 3: Structured JSON List. At the very end, summarize the entire architecture into a markdown JSON code block with two distinct sections: 'architecture' (for product mapping) and 'sources' (for document links).",
    ].join("\n");

    // ---- Call LLM ----
    const result = await callLLM({ provider: llmProvider, apiKey, prompt, maxTokens: 8192 });
    const rawMarkdown = result.text;

    // ---- Parse architecture JSON from LLM output ----
    const architectureJson = extractArchitectureJson(rawMarkdown);

    return NextResponse.json({ rawMarkdown, architectureJson });
  } catch (err: unknown) {
    console.error("[analyze-company] Error:", err);
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json(
      { rawMarkdown: "", architectureJson: null, error: message },
      { status: 500 },
    );
  }
}
