import { NextRequest, NextResponse } from "next/server";

// =============================================================================
// POST /api/fetch-news
// =============================================================================
// Uses Gemini's native Google Search grounding to fetch recent financial news
// for a company, filtered to topics relevant to capital structure analysis.
// Always calls Gemini regardless of the user's primary LLM provider, since
// Google Search grounding is only available on Gemini.
//
// Body:
//   - company        (string — company name, e.g. "SoFi Technologies")
//   - companyType    (string | null — "hybrid" | "financial_bank" | "industrial" | ...)
//   - segments       (string[] — list of segment names for topic targeting)
//   - apiKey         (string, optional — Gemini key; falls back to GEMINI_API_KEY env)
// =============================================================================

export interface FetchNewsResponse {
  summary: string;
  sources: { title: string; url: string }[];
  error?: string;
  requiresApiKey?: boolean;
}

/** Build the list of search topics based on company type. */
function buildNewsTopics(companyType: string | null, segments: string[]): string[] {
  const bankTopics = [
    "Federal Reserve interest rate decisions and rate trajectory",
    "10-year Treasury yield moves and bond market conditions",
    "Net interest margin (NIM) trends and outlook",
    "Credit default rates and loan loss provisions",
    "Student loan policy changes (if applicable)",
    "Depositor concentration and deposit outflow risk",
    "CET1 and Tier 1 capital ratio disclosures",
    "Asset-liability management (ALM) commentary from earnings",
    "Regulatory enforcement actions or capital adequacy reviews",
  ];

  const industrialTopics = [
    "Capital expenditure guidance and spending plans",
    "Revenue guidance and forward outlook",
    "Market share gains or losses vs. competitors",
    "M&A announcements or strategic partnerships",
    "Technology investments or platform expansion",
    "Pricing pressure or competitive dynamics",
  ];

  const isBank =
    companyType === "financial_bank" ||
    companyType === "financial_other" ||
    companyType === "financial_insurance";
  const isHybrid = companyType === "hybrid";

  const topics = isHybrid
    ? [...bankTopics, ...industrialTopics]
    : isBank
    ? bankTopics
    : industrialTopics;

  // Append segment-specific context
  if (segments.length > 0) {
    topics.push(`Segment-specific news: ${segments.slice(0, 4).join(", ")}`);
  }

  return topics;
}

/** Format the prompt for Gemini Google Search grounding. */
function buildNewsPrompt(company: string, topics: string[]): string {
  return [
    `Search for the most recent news and earnings commentary (last 90 days) about ${company}.`,
    "",
    "Focus specifically on these capital-structure-relevant topics:",
    topics.map((t, i) => `${i + 1}. ${t}`).join("\n"),
    "",
    "Format your response as a structured summary with the following sections:",
    "## Macro & Rate Environment",
    "(Fed decisions, Treasury yield moves, and their impact on the company)",
    "",
    "## Capital & Balance Sheet",
    "(CET1 ratio, RWA growth, ALM risk, deposit trends, capital adequacy)",
    "",
    "## Revenue & Growth Signals",
    "(NIM trends, segment revenue guidance, product attach rates, capex plans)",
    "",
    "## Risk Flags",
    "(credit quality, regulatory actions, student loan policy, competitive threats)",
    "",
    "## Management Commentary",
    "(Key quotes from recent earnings calls or press releases)",
    "",
    "Be concise and factual. Only include information you found via search — do not fabricate.",
    "If a section has no recent news, write 'No material news found in the last 90 days.'",
  ].join("\n");
}

export async function POST(req: NextRequest): Promise<NextResponse<FetchNewsResponse>> {
  try {
    const body = await req.json();
    const {
      company,
      companyType = null,
      segments = [],
      apiKey: runtimeKey,
    }: {
      company: string;
      companyType?: string | null;
      segments?: string[];
      apiKey?: string;
    } = body;

    if (!company || typeof company !== "string" || !company.trim()) {
      return NextResponse.json(
        { summary: "", sources: [], error: "Company name is required." },
        { status: 400 },
      );
    }

    // Always use Gemini — Google Search grounding is Gemini-exclusive
    const apiKey =
      (typeof runtimeKey === "string" && runtimeKey.trim()) ||
      process.env.GEMINI_API_KEY ||
      "";

    if (!apiKey) {
      return NextResponse.json(
        {
          summary: "",
          sources: [],
          error: "Gemini API key required for Google Search news fetch. Add your Gemini key in Settings.",
          requiresApiKey: true,
        },
        { status: 401 },
      );
    }

    const topics = buildNewsTopics(companyType, segments);
    const prompt = buildNewsPrompt(company.trim(), topics);

    // Call Gemini REST API directly — the @google/generative-ai SDK does not yet
    // expose a fully typed interface for Google Search grounding responses.
    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            // Raised from 2048: with Google Search grounding + dynamic thinking,
            // the prior ceiling was consumed by thinking tokens, leaving an empty
            // visible text part (finishReason MAX_TOKENS) → "returned no content".
            maxOutputTokens: 8192,
            // -1 = dynamic thinking: the model sizes its own thinking budget and
            // still reserves room for visible output within maxOutputTokens.
            thinkingConfig: { thinkingBudget: -1 },
          },
        }),
      },
    );

    if (!geminiResp.ok) {
      const errBody = await geminiResp.text();
      console.error("[fetch-news] Gemini API error:", errBody);
      return NextResponse.json(
        { summary: "", sources: [], error: `Gemini search failed (${geminiResp.status}). Check your API key.` },
        { status: 502 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await geminiResp.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Extract grounding citations from groundingMetadata
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const groundingChunks: any[] =
      data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

    const sources: { title: string; url: string }[] = groundingChunks
      .filter((c: unknown) => c && typeof c === "object" && "web" in (c as object))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => ({
        title: typeof c.web?.title === "string" ? c.web.title : "Source",
        url: typeof c.web?.uri === "string" ? c.web.uri : "",
      }))
      .filter((s) => s.url);

    if (!text.trim()) {
      return NextResponse.json(
        { summary: "", sources: [], error: "Gemini search returned no content. Try again." },
        { status: 422 },
      );
    }

    return NextResponse.json({ summary: text, sources });
  } catch (err: unknown) {
    console.error("[fetch-news] Error:", err);
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ summary: "", sources: [], error: message }, { status: 500 });
  }
}
