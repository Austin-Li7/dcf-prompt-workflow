import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import type { LLMProvider } from "@/types/cfp";
import type { ExtractHistoryResponse } from "@/types/cfp";

// =============================================================================
// POST /api/extract-history
// =============================================================================
// Accepts multipart/form-data:
//   - targetYear    (string, required) — e.g. "2023"
//   - architecture  (string, required) — JSON from Step 1
//   - dataFiles     (File[], up to 4)  — .xlsx, .csv, or .txt
//   - textNotes     (string, optional) — free-text pasted by the user
//   - apiKey        (string, optional) — runtime key override
//   - llmProvider   ("claude" | "gemini")
//
// Pipeline:
//   Local file parsing (xlsx lib) → text representation → LLM with
//   native responseSchema (Gemini) → typed HistoricalExtractionRow[]
// =============================================================================

// ---------------------------------------------------------------------------
// Gemini responseSchema — mirrors Omit<HistoricalExtractionRow, "id"|"yoyGrowth">
// Wrapped in { rows: [] } so the top-level response is always an object,
// which Gemini structured-output handles most reliably.
// ---------------------------------------------------------------------------
const EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      description:
        "All historical financial data rows extracted and mapped from the provided source data.",
      items: {
        type: "object",
        properties: {
          fiscalYear: {
            type: "integer",
            description: "Fiscal year as a 4-digit integer (e.g. 2023).",
          },
          quarter: {
            type: "string",
            description:
              "Fiscal quarter, normalised to exactly one of: Q1, Q2, Q3, Q4.",
          },
          segment: {
            type: "string",
            description:
              "Top-level business segment name (e.g. 'Digital Media', 'Cloud Services').",
          },
          productCategory: {
            type: "string",
            description:
              "Product category within the segment (e.g. 'Creative Cloud', 'Advertising Cloud').",
          },
          productName: {
            type: "string",
            description:
              "Specific product or sub-category (e.g. 'Photoshop', 'Acrobat Pro'). " +
              "If the data has no further breakdown, repeat the segment or category name.",
          },
          revenue: {
            type: "number",
            description: "Revenue for this row in USD Millions. Use 0 if unavailable.",
          },
          operatingIncome: {
            type: "number",
            description:
              "Operating income for this row in USD Millions. Use 0 if unavailable.",
          },
          notes: {
            type: "string",
            description:
              "Optional: a brief note on what drove revenue this quarter, based on the source data.",
          },
        },
        required: [
          "fiscalYear",
          "quarter",
          "segment",
          "productCategory",
          "productName",
          "revenue",
          "operatingIncome",
          "notes",
        ],
      },
    },
  },
  required: ["rows"],
};

// ---------------------------------------------------------------------------
// Accepted file types
// ---------------------------------------------------------------------------
const XLSX_EXTS = new Set([".xlsx", ".xls", ".xlsm"]);
const CSV_EXTS = new Set([".csv"]);
const TXT_EXTS = new Set([".txt"]);

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

// ---------------------------------------------------------------------------
// Parse a single uploaded file → plain-text representation
// ---------------------------------------------------------------------------
async function parseFile(file: File): Promise<string> {
  const ext = fileExtension(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (TXT_EXTS.has(ext)) {
    return buffer.toString("utf-8");
  }

  if (XLSX_EXTS.has(ext) || CSV_EXTS.has(ext)) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return "(empty workbook)";
    const ws = wb.Sheets[sheetName];
    // Convert to JSON for maximum LLM readability
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
    return JSON.stringify(json, null, 2);
  }

  throw new Error(`Unsupported file type: ${file.name} (${ext})`);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest): Promise<NextResponse<ExtractHistoryResponse>> {
  try {
    const formData = await req.formData();

    // ── Target year ─────────────────────────────────────────────────────────
    const targetYear = formData.get("targetYear");
    if (!targetYear || typeof targetYear !== "string" || !targetYear.trim()) {
      return NextResponse.json(
        { rows: [], error: "Target fiscal year is required." },
        { status: 400 },
      );
    }

    // ── Architecture from Step 1 ─────────────────────────────────────────────
    const architectureRaw = formData.get("architecture");
    if (!architectureRaw || typeof architectureRaw !== "string") {
      return NextResponse.json(
        { rows: [], error: "Step 1 architecture JSON is required." },
        { status: 400 },
      );
    }

    // ── Data files ───────────────────────────────────────────────────────────
    const dataFiles = formData.getAll("dataFiles").filter(
      (f): f is File => f instanceof File && f.size > 0,
    );

    // ── Optional free-text notes ─────────────────────────────────────────────
    const textNotes = (formData.get("textNotes") as string | null)?.trim() ?? "";

    if (dataFiles.length === 0 && !textNotes) {
      return NextResponse.json(
        { rows: [], error: "Please upload at least one data file or paste text notes." },
        { status: 400 },
      );
    }
    if (dataFiles.length > 4) {
      return NextResponse.json(
        { rows: [], error: "Maximum 4 files allowed per request." },
        { status: 400 },
      );
    }

    // ── Provider & API key ───────────────────────────────────────────────────
    const llmProvider = (formData.get("llmProvider") as LLMProvider) || "gemini";
    const runtimeKey = formData.get("apiKey") as string | null;
    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey ?? undefined);

    if (needsKey) {
      return NextResponse.json(
        { rows: [], error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    // ── Parse all uploaded files locally ────────────────────────────────────
    const parsedSections: string[] = [];

    for (const file of dataFiles) {
      try {
        const content = await parseFile(file);
        parsedSections.push(`--- FILE: ${file.name} ---\n${content}`);
        console.log(
          `[extract-history] Parsed ${file.name} → ${content.length} chars`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[extract-history] Skipping ${file.name}: ${msg}`);
      }
    }

    if (parsedSections.length === 0 && !textNotes) {
      return NextResponse.json(
        { rows: [], error: "Could not parse any of the uploaded files." },
        { status: 400 },
      );
    }

    if (textNotes) {
      parsedSections.push(`--- TEXT NOTES ---\n${textNotes}`);
    }

    // ── Build prompt ─────────────────────────────────────────────────────────
    const systemPrompt =
      "You are an expert financial data architect specialising in SEC filings and corporate earnings data. " +
      "Your only job is to extract structured financial data and map it precisely to the requested JSON schema. " +
      "Do not add commentary. Do not skip rows. Fill every required field.";

    const userPrompt = [
      "I am providing you with raw data extracted from Excel/CSV files, along with optional text notes.",
      "Your job is to locate the historical segment revenue and operating income, and map it strictly to the provided JSON schema.",
      "Ensure quarters are normalised (Q1, Q2, Q3, Q4). Revenue and Operating Income must be in USD Millions.",
      "",
      `Target Fiscal Year: ${targetYear.trim()}`,
      `Business Architecture (use this to guide segment/category/product mapping):`,
      architectureRaw,
      "",
      "=== SOURCE DATA ===",
      parsedSections.join("\n\n"),
    ].join("\n");

    // ── Call LLM with structured output ──────────────────────────────────────
    const result = await callLLM({
      provider: llmProvider,
      apiKey,
      prompt: userPrompt,
      systemPrompt,
      maxTokens: 16384,
      // Gemini will enforce the schema; Claude falls back to prompt-only JSON
      responseSchema: llmProvider === "gemini" ? EXTRACTION_RESPONSE_SCHEMA : undefined,
    });

    // ── Parse the response ───────────────────────────────────────────────────
    // Gemini with responseSchema returns guaranteed JSON.
    // Claude returns a JSON string if the prompt worked correctly.
    let rows: ExtractHistoryResponse["rows"] = [];

    try {
      const parsed = JSON.parse(result.text.trim());

      // Unwrap { rows: [...] } wrapper
      const rawArr: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.rows)
          ? parsed.rows
          : [];

      rows = rawArr.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          fiscalYear: Number(row.fiscalYear) || Number(targetYear),
          quarter: normalizeQuarter(String(row.quarter ?? "")),
          segment: String(row.segment ?? ""),
          productCategory: String(row.productCategory ?? ""),
          productName: String(row.productName ?? ""),
          revenue: Number(row.revenue) || 0,
          operatingIncome: Number(row.operatingIncome) || 0,
          notes: String(row.notes ?? ""),
        };
      });
    } catch {
      console.error("[extract-history] Failed to parse LLM response:", result.text.slice(0, 500));
      return NextResponse.json(
        { rows: [], error: "The model did not return a valid JSON response. Please try again." },
        { status: 422 },
      );
    }

    if (rows.length === 0) {
      return NextResponse.json(
        {
          rows: [],
          error:
            "No data rows could be extracted from the provided files. " +
            "Make sure your file contains segment revenue data.",
        },
        { status: 422 },
      );
    }

    console.log(`[extract-history] Extracted ${rows.length} rows for FY ${targetYear}.`);
    return NextResponse.json({ rows });
  } catch (err: unknown) {
    console.error("[extract-history] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ rows: [], error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Quarter string normaliser — handles "Q1", "Quarter 1", "1", "q2", etc.
// ---------------------------------------------------------------------------
function normalizeQuarter(raw: string): string {
  if (!raw) return "Q1";
  const upper = raw.toUpperCase().trim();
  if (/^Q[1-4]$/.test(upper)) return upper;
  const match = upper.match(/[1-4]/);
  return match ? `Q${match[0]}` : "Q1";
}
