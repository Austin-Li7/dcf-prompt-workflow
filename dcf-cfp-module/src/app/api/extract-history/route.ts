/**
 * POST /api/extract-history
 *
 * Action-based endpoint that drives the Step 2 extraction pipeline.
 * All requests use JSON body  { action, ...payload }.
 *
 * Actions:
 *   extract-chunk  — Map phase. Process one text chunk → ChunkSummary (light schema).
 *   reduce         — Reduce phase. Merge all ChunkSummary[] → Step2StructuredResult.
 *   sanity-review  — Validate a Step2StructuredResult; add/update warnings.
 *
 * Legacy single-shot mode is still supported when action is omitted (backward-compat
 * for any callers that haven't migrated to the pipeline yet).
 */

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unpdf = require("unpdf") as typeof import("unpdf");
import {
  buildStep2StructuredFromFixtureRecords,
  recordsFromDcfInputPayload,
} from "@/lib/step2-fixture-ingest";
import { callLLM, parseStructuredJsonText, resolveApiKey } from "@/lib/llm-service";
import {
  GEMINI_STEP2_RESPONSE_SCHEMA,
  parseStep2StructuredResult,
  projectStep2StructuredToRows,
  STEP2_RESPONSE_SCHEMA,
} from "@/lib/step2-schema";
import {
  GEMINI_STEP2_BANK_RESPONSE_SCHEMA,
  parseStep2BankStructuredResult,
  projectStep2BankStructuredToRows,
  STEP2_BANK_RESPONSE_SCHEMA,
} from "@/lib/step2-bank-schema";
import {
  BANK_CHUNK_SUMMARY_SCHEMA,
  BankChunkSummarySchema,
  CHUNK_SUMMARY_SCHEMA,
  GEMINI_BANK_CHUNK_SUMMARY_SCHEMA,
  GEMINI_CHUNK_SUMMARY_SCHEMA,
  INDUSTRIAL_CHUNK_SUMMARY_SCHEMA,
  GEMINI_INDUSTRIAL_CHUNK_SUMMARY_SCHEMA,
  IndustrialChunkSummarySchema,
  ChunkSummarySchema,
  type ChunkSummary,
  type BankChunkSummary,
  type IndustrialChunkSummary,
} from "@/lib/chunk-schema";
import {
  GEMINI_STEP2_INDUSTRIAL_RESPONSE_SCHEMA,
  parseStep2IndustrialStructuredResult,
  projectStep2IndustrialStructuredToRows,
  STEP2_INDUSTRIAL_RESPONSE_SCHEMA,
} from "@/lib/step2-industrial-schema";
import type { LLMProvider, ExtractHistoryResponse } from "@/types/cfp";
import type { Step2StructuredResult } from "@/lib/step2-schema";
import type { Step2BankStructuredResult } from "@/lib/step2-bank-schema";
import type { Step2IndustrialStructuredResult } from "@/lib/step2-industrial-schema";

type WorkflowMode = "bank" | "industrial" | "industrial-pdf";
type AnyStructuredResult = Step2StructuredResult | Step2BankStructuredResult | Step2IndustrialStructuredResult;

// =============================================================================
// Shared helpers
// =============================================================================

function companyNameFromArchitecture(raw: unknown): string {
  try {
    if (typeof raw === "string") {
      const p = JSON.parse(raw) as Record<string, unknown>;
      return String(p.company_name ?? p.companyName ?? "Unknown Company");
    }
    if (raw && typeof raw === "object") {
      const p = raw as Record<string, unknown>;
      return String(p.company_name ?? p.companyName ?? "Unknown Company");
    }
  } catch {
    /* ignore */
  }
  return "Unknown Company";
}

function archToString(raw: unknown): string {
  if (typeof raw === "string") return raw;
  return JSON.stringify(raw ?? {});
}

// =============================================================================
// System prompts
// =============================================================================

const CHUNK_SYSTEM_PROMPT = [
  "You are a financial data extraction assistant.",
  "Your task is to pull every historical financial figure from the supplied data chunk.",
  "Return ALL fiscal years and quarters you find — do NOT filter to one year.",
  "Do NOT invent numbers. Use null for any figure that is not explicitly stated.",
  "Return only valid JSON matching the schema — no prose.",
].join(" ");

const BANK_CHUNK_SYSTEM_PROMPT = [
  "You are a bank financial data extraction assistant.",
  "Extract NII-driven metrics: net interest income (nii_usd_m), non-interest income, provision for credit losses,",
  "net income, book value of equity (total GAAP equity), goodwill, other intangible assets, preferred equity,",
  "total risk-weighted assets (total_rwa_usd_m),",
  "Tier 1 capital ratio (%), CET1 ratio (%), net interest margin (%), efficiency ratio (%),",
  "return on average equity (%), and total assets — per segment per quarter.",
  "goodwill_usd_m, intangible_assets_usd_m, and preferred_equity_usd_m are needed to compute",
  "Tangible Common Equity (TCE = Book Equity − Goodwill − Intangibles − Preferred) and ROATCE.",
  "Return ALL fiscal years and quarters present. Use null for figures not explicitly stated.",
  "Return only valid JSON matching the schema — no prose.",
].join(" ");

const REDUCE_SYSTEM_PROMPT = [
  "You are producing the Step 2 historical financials contract for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  'The top-level schema_version field must be exactly "v5.5".',
  "Do not invent financial values. Use null for unavailable revenue or operating income.",
  "Map rows only to Step 1 canonical analysis segments and offerings.",
  "Rows must include source_id, mapped_from_step1_ids, evidence_level, validation_status, and review_note.",
  "Keep review_note and excerpts short. No prose outside the structured response.",
].join(" ");

const BANK_REDUCE_SYSTEM_PROMPT = [
  "You are producing the Step 2 bank historical financials contract for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  'The top-level schema_version must be "v5.5" and workflow must be "bank".',
  "Do not invent financial values. Use null for any metric not explicitly disclosed.",
  "Capture NII-driven metrics: nii_usd_m, non_interest_income_usd_m, provision_for_credit_losses_usd_m,",
  "net_income_usd_m, book_value_equity_usd_m, goodwill_usd_m, intangible_assets_usd_m, preferred_equity_usd_m,",
  "total_rwa_usd_m, tier1_capital_ratio_pct, cet1_ratio_pct,",
  "net_interest_margin_pct, efficiency_ratio_pct, return_on_avg_equity_pct, total_assets_usd_m.",
  "goodwill_usd_m, intangible_assets_usd_m, and preferred_equity_usd_m are required to compute",
  "TCE = Book Equity − Goodwill − Intangibles − Preferred, which enables ROATCE for Step 4 capital efficiency.",
  "Map rows to Step 1 canonical banking segments. At least one primary income metric must be non-null per row.",
  "Be concise: keep each review_note under 100 characters, sources.excerpt under 80 characters.",
  "Omit fields that are null from source_excerpt and review_note rather than repeating them verbatim.",
  "No prose outside the structured response.",
].join(" ");

const INDUSTRIAL_CHUNK_SYSTEM_PROMPT = [
  "You are an industrial company financial data extraction assistant.",
  "Extract segment-level metrics from SEC 10-K and 10-Q filings:",
  "revenue_usd_m, operating_income_usd_m, gross_profit_usd_m, capex_usd_m,",
  "depreciation_amortization_usd_m (D&A), and headcount (if disclosed).",
  "Return ALL fiscal years and quarters present. Use null for figures not explicitly stated.",
  "All monetary values in USD millions. Headcount as integer (whole number).",
  "Return only valid JSON matching the schema — no prose.",
].join(" ");

const INDUSTRIAL_REDUCE_SYSTEM_PROMPT = [
  "You are producing the Step 2 industrial historical financials contract for a DCF workflow.",
  "Return only a compact structured JSON object matching the provided schema.",
  'The top-level schema_version must be "v5.5" and workflow must be "industrial".',
  "Do not invent financial values. Use null for any metric not explicitly disclosed.",
  "Capture: revenue_usd_m, operating_income_usd_m, gross_profit_usd_m, capex_usd_m,",
  "depreciation_amortization_usd_m (D&A), and headcount per segment per quarter.",
  "Map rows to Step 1 canonical industrial segments. At least one metric must be non-null per row.",
  "Keep review_note under 100 characters. Keep sources.excerpt under 80 characters.",
  "No prose outside the structured response.",
].join(" ");

const INDUSTRIAL_SANITY_SYSTEM_PROMPT = [
  "You are an industrial company financial data quality reviewer for a DCF workflow.",
  "Review the supplied Step 2 industrial structured result.",
  "Tasks: (1) flag implausible values (e.g. negative revenue, gross margin > 100%) as high-severity warnings,",
  "(2) verify quarter coverage, (3) confirm segment names match Step 1 canonical segments.",
  'Return the corrected result with workflow="industrial". You may add warnings but must NOT remove rows.',
  "Return only valid JSON matching the schema — no prose.",
].join(" ");

const SANITY_SYSTEM_PROMPT = [
  "You are a financial data quality reviewer for a DCF workflow.",
  "Review the supplied Step 2 structured result.",
  "Your tasks: (1) flag any hallucinated or implausible values as high-severity validation_warnings,",
  "(2) ensure every quarter claimed is actually present in the data,",
  "(3) check segment/product names match Step 1 canonical names.",
  "Return the complete corrected Step 2 JSON. You may add warnings but must NOT remove existing rows.",
  "Return only valid JSON matching the schema — no prose.",
].join(" ");

const BANK_SANITY_SYSTEM_PROMPT = [
  "You are a bank financial data quality reviewer for a DCF workflow.",
  "Review the supplied Step 2 bank structured result.",
  "Your tasks: (1) flag implausible capital ratios (e.g. CET1 > 50%) or negative NII as high-severity warnings,",
  "(2) verify quarter coverage, (3) confirm segment names match Step 1 canonical bank segments,",
  "(4) check that goodwill_usd_m, intangible_assets_usd_m, and preferred_equity_usd_m are populated",
  "where book_value_equity_usd_m is present — flag rows where these TCE components are null but equity is non-null.",
  'Return the corrected result with workflow="bank". You may add warnings but must NOT remove rows.',
  "Return only valid JSON matching the schema — no prose.",
].join(" ");

// =============================================================================
// Route handler
// =============================================================================

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const contentType = req.headers.get("content-type") ?? "";

    // ------------------------------------------------------------------
    // JSON body path (pipeline actions: extract-chunk | reduce | sanity-review)
    // ------------------------------------------------------------------
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      const action = body.action as string | undefined;

      if (action === "extract-chunk") return await handleExtractChunk(body);
      if (action === "reduce") return await handleReduce(body);
      if (action === "sanity-review") return await handleSanityReview(body);
      if (action === "generate-hints") return await handleGenerateHints(body);

      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // ------------------------------------------------------------------
    // Multipart form-data path
    // ------------------------------------------------------------------
    if (contentType.includes("multipart")) {
      const formData = await req.formData();
      const multipartAction = formData.get("action") as string | null;
      if (multipartAction === "parse-pdf") return await handleParsePdf(formData);
      // Fall through to legacy handler
      return await handleLegacy(req);
    }

    return await handleLegacy(req);
  } catch (err: unknown) {
    console.error("[extract-history] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "An unexpected server error occurred.";
    // Surface Gemini/provider 503s as HTTP 503 so the client rate-limit retry fires.
    const isProviderRateLimit =
      /503|service.{0,20}unavailable|429|too.{0,10}many.{0,10}request/i.test(message);
    return NextResponse.json(
      { rows: [], error: message },
      { status: isProviderRateLimit ? 503 : 500 },
    );
  }
}

// =============================================================================
// Action: extract-chunk  (Map phase)
// =============================================================================

async function handleExtractChunk(body: Record<string, unknown>): Promise<NextResponse> {
  const chunkContent = body.chunkContent as string | undefined;
  const chunkMetadata = body.chunkMetadata as {
    chunkId?: string;
    sourceFile?: string;
    chunkIndex?: number;
    totalChunks?: number;
  } | undefined;
  const architecture = body.architecture;
  const provider = (body.provider as LLMProvider) ?? "gemini";
  const runtimeKey = body.apiKey as string | null | undefined;
  const workflowMode: WorkflowMode = (body.workflowMode as WorkflowMode) ?? "industrial";
  const isBank = workflowMode === "bank";
  const isIndustrialPdf = workflowMode === "industrial-pdf";
  /** Optional pre-built hints string injected at the top of the user prompt. */
  const hintsText = typeof body.hintsText === "string" && body.hintsText.trim()
    ? body.hintsText.trim()
    : null;

  if (!chunkContent?.trim()) {
    return NextResponse.json({ error: "chunkContent is required." }, { status: 400 });
  }

  const { apiKey, needsKey } = resolveApiKey(provider, runtimeKey ?? undefined);
  if (needsKey) {
    return NextResponse.json(
      { error: "No API key found.", requiresApiKey: true },
      { status: 401 },
    );
  }

  const sourceFile = chunkMetadata?.sourceFile ?? "unknown";
  const chunkIndex = chunkMetadata?.chunkIndex ?? 0;
  const totalChunks = chunkMetadata?.totalChunks ?? 1;
  const chunkId = chunkMetadata?.chunkId ?? `${sourceFile}__${chunkIndex}`;

  const userPrompt = isBank
    ? [
        hintsText ?? "",
        `Extract ALL historical bank financial metrics from this data segment.`,
        `Source file: ${sourceFile} (chunk ${chunkIndex + 1} of ${totalChunks})`,
        `Chunk ID: ${chunkId}`,
        architecture
          ? `Step 1 bank segments (use these canonical names):\n${archToString(architecture)}`
          : "",
        `Metrics to extract per segment per quarter (USD millions for monetary values, % for ratios):`,
        `nii_usd_m, non_interest_income_usd_m, provision_for_credit_losses_usd_m, net_income_usd_m,`,
        `book_value_equity_usd_m, goodwill_usd_m, intangible_assets_usd_m, preferred_equity_usd_m,`,
        `total_rwa_usd_m, tier1_capital_ratio_pct, cet1_ratio_pct,`,
        `net_interest_margin_pct, efficiency_ratio_pct, return_on_avg_equity_pct, total_assets_usd_m.`,
        `(goodwill_usd_m, intangible_assets_usd_m, preferred_equity_usd_m enable TCE and ROATCE in Step 4.)`,
        `Set chunk_id to "${chunkId}". Use null for any figure not explicitly stated.`,
        `source_excerpt: copy the exact text snippet (≤ 160 chars) proving the figure.`,
        ``,
        `Data:`,
        chunkContent,
      ].filter(Boolean).join("\n")
    : isIndustrialPdf
    ? [
        hintsText ?? "",
        `Extract ALL historical segment financial metrics from this SEC filing data segment.`,
        `Source file: ${sourceFile} (chunk ${chunkIndex + 1} of ${totalChunks})`,
        `Chunk ID: ${chunkId}`,
        architecture
          ? `Step 1 segments (use these canonical names):\n${archToString(architecture)}`
          : "",
        `Metrics to extract per segment per quarter (USD millions for monetary; integer for headcount):`,
        `revenue_usd_m, operating_income_usd_m, gross_profit_usd_m, capex_usd_m,`,
        `depreciation_amortization_usd_m (D&A), headcount (if disclosed).`,
        `Rules:`,
        `- Include every fiscal year and quarter present in this chunk.`,
        `- Use null for any metric not explicitly stated.`,
        `- source_excerpt: copy the exact text snippet (≤ 160 chars) proving the figure.`,
        `- Set chunk_id to "${chunkId}".`,
        ``,
        `Data:`,
        chunkContent,
      ].filter(Boolean).join("\n")
    : [
        hintsText ?? "",
        `Extract ALL historical financial rows from this data segment.`,
        `Source file: ${sourceFile} (chunk ${chunkIndex + 1} of ${totalChunks})`,
        `Chunk ID: ${chunkId}`,
        architecture
          ? `Step 1 architecture (use these canonical segment/product names):\n${archToString(architecture)}`
          : "",
        `Rules:`,
        `- Include every fiscal year and quarter present in this chunk.`,
        `- Include ALL named segments/entities even if revenue_usd_m is null.`,
        `- revenue_usd_m and operating_income_usd_m must be in USD millions.`,
        `- Use null for any figure not explicitly stated.`,
        `- source_excerpt: copy the exact text snippet (≤ 160 chars) that proves the figure.`,
        `- Set chunk_id to "${chunkId}".`,
        ``,
        `Data:`,
        chunkContent,
      ].filter(Boolean).join("\n");

  const systemPrompt = isBank
    ? BANK_CHUNK_SYSTEM_PROMPT
    : isIndustrialPdf
    ? INDUSTRIAL_CHUNK_SYSTEM_PROMPT
    : CHUNK_SYSTEM_PROMPT;

  const responseSchema = isBank
    ? (provider === "gemini" ? GEMINI_BANK_CHUNK_SUMMARY_SCHEMA : BANK_CHUNK_SUMMARY_SCHEMA)
    : isIndustrialPdf
    ? (provider === "gemini" ? GEMINI_INDUSTRIAL_CHUNK_SUMMARY_SCHEMA : INDUSTRIAL_CHUNK_SUMMARY_SCHEMA)
    : (provider === "gemini" ? GEMINI_CHUNK_SUMMARY_SCHEMA : CHUNK_SUMMARY_SCHEMA);

  const llmResult = await callLLM({
    provider,
    apiKey,
    prompt: userPrompt,
    systemPrompt,
    maxTokens: isBank ? 32768 : isIndustrialPdf ? 32768 : 8192,
    responseSchema,
    responseToolName: "submit_chunk_summary",
    responseToolDescription: "Return the extracted financial rows for this data chunk.",
  });

  let summary: ChunkSummary | BankChunkSummary | IndustrialChunkSummary;
  try {
    const payload =
      llmResult.structuredData && typeof llmResult.structuredData === "object"
        ? llmResult.structuredData
        : parseStructuredJsonText(llmResult.text, {
            provider,
            finishReason: llmResult.finishReason,
            finishMessage: llmResult.finishMessage,
          });
    summary = isBank
      ? BankChunkSummarySchema.parse(payload)
      : isIndustrialPdf
      ? IndustrialChunkSummarySchema.parse(payload)
      : ChunkSummarySchema.parse(payload);
  } catch (err) {
    console.error("[extract-history/extract-chunk] Parse error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Model did not return valid ChunkSummary JSON.",
      },
      { status: 422 },
    );
  }

  return NextResponse.json({ summary });
}

// =============================================================================
// Action: reduce  (Reduce phase)
// =============================================================================

async function handleReduce(body: Record<string, unknown>): Promise<NextResponse> {
  const chunkSummaries = body.chunkSummaries as Array<Record<string, unknown>> | undefined;
  const targetYear = Number(body.targetYear);
  const companyName = (body.companyName as string | undefined) ?? "Unknown Company";
  const architecture = body.architecture;
  const provider = (body.provider as LLMProvider) ?? "gemini";
  const runtimeKey = body.apiKey as string | null | undefined;
  const workflowMode: WorkflowMode = (body.workflowMode as WorkflowMode) ?? "industrial";
  const isBank = workflowMode === "bank";
  const isIndustrialPdf = workflowMode === "industrial-pdf";
  const hintsText = typeof body.hintsText === "string" && body.hintsText.trim()
    ? body.hintsText.trim()
    : null;

  if (!Array.isArray(chunkSummaries) || chunkSummaries.length === 0) {
    return NextResponse.json({ error: "chunkSummaries array is required." }, { status: 400 });
  }
  if (!Number.isInteger(targetYear) || targetYear < 2000) {
    return NextResponse.json({ error: "Valid targetYear is required." }, { status: 400 });
  }

  const { apiKey, needsKey } = resolveApiKey(provider, runtimeKey ?? undefined);
  if (needsKey) {
    return NextResponse.json(
      { error: "No API key found.", requiresApiKey: true },
      { status: 401 },
    );
  }

  // Filter summaries to rows for targetYear
  const relevantSummaries = chunkSummaries.map((s) => ({
    ...s,
    rows: Array.isArray(s.rows)
      ? (s.rows as Array<Record<string, unknown>>).filter(
          (r) => r.fiscal_year === targetYear || r.fiscal_year === 0,
        )
      : [],
  })).filter((s) => s.rows.length > 0);

  // Strip source_excerpt from chunk rows before reduce (reduces token count)
  const summariesForPrompt = (isBank || isIndustrialPdf)
    ? relevantSummaries.map((s) => ({
        ...s,
        rows: (s.rows as Array<Record<string, unknown>>).map(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          ({ source_excerpt: _x, ...rest }) => rest,
        ),
      }))
    : relevantSummaries;

  const userPrompt = isBank
    ? [
        hintsText ?? "",
        `Task: Synthesise the bank chunk summaries into the Step 2 bank historical baseline for FY ${targetYear}.`,
        `Company: ${companyName}`,
        `Target Fiscal Year: ${targetYear}`,
        ``,
        `Step 1 banking segments:`,
        archToString(architecture),
        ``,
        `Rules:`,
        `- Include ONLY rows where fiscal_year = ${targetYear}.`,
        `- Merge duplicate (quarter, segment) rows — prefer higher confidence figures.`,
        `- schema_version must be "v5.5", workflow must be "bank".`,
        `- Monetary values in USD millions; ratio fields are percentages (e.g. 12.5 for 12.5%).`,
        `- At least one of nii_usd_m, non_interest_income_usd_m, net_income_usd_m must be non-null per row.`,
        `- Keep review_note under 100 characters per row. Keep sources.excerpt under 80 characters.`,
        ``,
        `Chunk summaries (${summariesForPrompt.length} chunks with FY ${targetYear} rows):`,
        JSON.stringify(summariesForPrompt, null, 2),
      ].join("\n")
    : isIndustrialPdf
    ? [
        hintsText ?? "",
        `Task: Synthesise the industrial chunk summaries into the Step 2 industrial historical baseline for FY ${targetYear}.`,
        `Company: ${companyName}`,
        `Target Fiscal Year: ${targetYear}`,
        ``,
        `Step 1 segments:`,
        archToString(architecture),
        ``,
        `Rules:`,
        `- Include ONLY rows where fiscal_year = ${targetYear}.`,
        `- Merge duplicate (quarter, segment) rows — prefer higher confidence figures.`,
        `- schema_version must be "v5.5", workflow must be "industrial".`,
        `- Monetary values in USD millions. Headcount as integer.`,
        `- At least one metric must be non-null per row.`,
        `- Keep review_note under 100 characters per row. Keep sources.excerpt under 80 characters.`,
        ``,
        `Chunk summaries (${summariesForPrompt.length} chunks with FY ${targetYear} rows):`,
        JSON.stringify(summariesForPrompt, null, 2),
      ].join("\n")
    : [
        hintsText ?? "",
        `Task: Synthesise the chunk extraction summaries below into the complete Step 2 DCF`,
        `historical baseline for FY ${targetYear}.`,
        ``,
        `Company: ${companyName}`,
        `Target Fiscal Year: ${targetYear}`,
        ``,
        `Step 1 architecture:`,
        archToString(architecture),
        ``,
        `Rules:`,
        `- Include ONLY rows where fiscal_year = ${targetYear}.`,
        `- Merge duplicates by (quarter, segment, product_name) — prefer higher confidence.`,
        `- Where two chunks conflict on a value, add a validation_warning.`,
        `- Use source_id references derived from the chunk_id of each summary.`,
        `- Units: USD millions. schema_version must be "v5.5".`,
        ``,
        `Chunk summaries (${summariesForPrompt.length} chunks with FY ${targetYear} rows):`,
        JSON.stringify(summariesForPrompt, null, 2),
      ].join("\n");

  const systemPrompt = isBank
    ? BANK_REDUCE_SYSTEM_PROMPT
    : isIndustrialPdf
    ? INDUSTRIAL_REDUCE_SYSTEM_PROMPT
    : REDUCE_SYSTEM_PROMPT;

  const responseSchema = isBank
    ? (provider === "gemini" ? GEMINI_STEP2_BANK_RESPONSE_SCHEMA : STEP2_BANK_RESPONSE_SCHEMA)
    : isIndustrialPdf
    ? (provider === "gemini" ? GEMINI_STEP2_INDUSTRIAL_RESPONSE_SCHEMA : STEP2_INDUSTRIAL_RESPONSE_SCHEMA)
    : (provider === "gemini" ? GEMINI_STEP2_RESPONSE_SCHEMA : STEP2_RESPONSE_SCHEMA);

  const llmResult = await callLLM({
    provider,
    apiKey,
    prompt: userPrompt,
    systemPrompt,
    maxTokens: isBank ? 65536 : isIndustrialPdf ? 65536 : 16384,
    responseSchema,
    responseToolName: "submit_step2_structured_result",
    responseToolDescription: "Return the complete Step 2 structured result.",
  });

  let structuredResult: AnyStructuredResult;
  try {
    const payload =
      llmResult.structuredData && typeof llmResult.structuredData === "object"
        ? llmResult.structuredData
        : parseStructuredJsonText(llmResult.text, {
            provider,
            finishReason: llmResult.finishReason,
            finishMessage: llmResult.finishMessage,
          });
    structuredResult = isBank
      ? parseStep2BankStructuredResult(payload)
      : isIndustrialPdf
      ? parseStep2IndustrialStructuredResult(payload)
      : parseStep2StructuredResult(payload);
  } catch (err) {
    console.error("[extract-history/reduce] Parse error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Model did not return valid Step2StructuredResult JSON.",
      },
      { status: 422 },
    );
  }

  return NextResponse.json({ structuredResult });
}

// =============================================================================
// Action: sanity-review  (Review phase)
// =============================================================================

async function handleSanityReview(body: Record<string, unknown>): Promise<NextResponse> {
  const inputResult = body.structuredResult as AnyStructuredResult | undefined;
  const targetYear = Number(body.targetYear);
  const architecture = body.architecture;
  const provider = (body.provider as LLMProvider) ?? "gemini";
  const runtimeKey = body.apiKey as string | null | undefined;
  const workflowMode: WorkflowMode = (body.workflowMode as WorkflowMode) ?? "industrial";
  const isBank = workflowMode === "bank";
  const isIndustrialPdf = workflowMode === "industrial-pdf";

  if (!inputResult) {
    return NextResponse.json({ error: "structuredResult is required." }, { status: 400 });
  }

  const { apiKey, needsKey } = resolveApiKey(provider, runtimeKey ?? undefined);
  if (needsKey) {
    return NextResponse.json(
      { error: "No API key found.", requiresApiKey: true },
      { status: 401 },
    );
  }

  const modeLabel = isBank ? "bank " : isIndustrialPdf ? "industrial " : "";
  const archLabel = isBank ? "banking segments" : "segments";
  const userPrompt = [
    `Perform a sanity review on this Step 2 ${modeLabel}historical baseline for FY ${targetYear}.`,
    ``,
    `Step 1 ${archLabel} (for canonical name validation):`,
    archToString(architecture),
    ``,
    `Current Step 2 result to review:`,
    JSON.stringify(inputResult, null, 2),
    ``,
    `Return the corrected Step 2 result. You may ADD validation_warnings but must NOT`,
    `remove existing rows. Correct obviously wrong values only if you have high confidence.`,
  ].join("\n");

  const systemPrompt = isBank
    ? BANK_SANITY_SYSTEM_PROMPT
    : isIndustrialPdf
    ? INDUSTRIAL_SANITY_SYSTEM_PROMPT
    : SANITY_SYSTEM_PROMPT;

  const responseSchema = isBank
    ? (provider === "gemini" ? GEMINI_STEP2_BANK_RESPONSE_SCHEMA : STEP2_BANK_RESPONSE_SCHEMA)
    : isIndustrialPdf
    ? (provider === "gemini" ? GEMINI_STEP2_INDUSTRIAL_RESPONSE_SCHEMA : STEP2_INDUSTRIAL_RESPONSE_SCHEMA)
    : (provider === "gemini" ? GEMINI_STEP2_RESPONSE_SCHEMA : STEP2_RESPONSE_SCHEMA);

  const llmResult = await callLLM({
    provider,
    apiKey,
    prompt: userPrompt,
    systemPrompt,
    maxTokens: isBank ? 65536 : isIndustrialPdf ? 65536 : 16384,
    responseSchema,
    responseToolName: "submit_step2_structured_result",
    responseToolDescription: "Return the reviewed Step 2 structured result.",
  });

  let structuredResult: AnyStructuredResult;
  try {
    const payload =
      llmResult.structuredData && typeof llmResult.structuredData === "object"
        ? llmResult.structuredData
        : parseStructuredJsonText(llmResult.text, {
            provider,
            finishReason: llmResult.finishReason,
            finishMessage: llmResult.finishMessage,
          });
    structuredResult = isBank
      ? parseStep2BankStructuredResult(payload)
      : isIndustrialPdf
      ? parseStep2IndustrialStructuredResult(payload)
      : parseStep2StructuredResult(payload);
  } catch (err) {
    // Sanity review failure is non-fatal — return the original
    console.warn("[extract-history/sanity-review] Parse failed, returning original:", err);
    return NextResponse.json({ structuredResult: inputResult });
  }

  return NextResponse.json({ structuredResult });
}

// =============================================================================
// Action: parse-pdf  (PDF text extraction — multipart upload)
// =============================================================================

async function handleParsePdf(formData: FormData): Promise<NextResponse> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "A PDF file is required." }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const pdf = await unpdf.getDocumentProxy(new Uint8Array(buffer));
    const { totalPages, text } = await unpdf.extractText(pdf, { mergePages: false });

    // Build page-delimited text for downstream chunking
    let fullText: string;
    if (Array.isArray(text)) {
      fullText = (text as string[])
        .map((pageText, idx) => `--- Page ${idx + 1} ---\n${pageText}`)
        .join("\n\n");
    } else {
      fullText = text as string;
    }

    return NextResponse.json({ text: fullText, pages: totalPages, fileName: file.name });
  } catch (err) {
    console.error("[extract-history/parse-pdf] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to extract PDF text." },
      { status: 422 },
    );
  }
}

// =============================================================================
// Action: generate-hints  (generate filing structure map from first result)
// =============================================================================

const GENERATE_HINTS_SYSTEM_PROMPT = [
  "You are a financial filing analyst.",
  "Your task is to create a concise location map of where specific metrics were found in a SEC filing.",
  "This map will be used to speed up extraction from future filings of the same company.",
  "Return ONLY valid JSON. No prose, no markdown.",
].join(" ");

async function handleGenerateHints(body: Record<string, unknown>): Promise<NextResponse> {
  const structuredResult = body.structuredResult;
  const filingType = (body.filingType as string) ?? "10-K";
  const fileName = (body.fileName as string) ?? "unknown";
  const companyName = (body.companyName as string) ?? "Unknown Company";
  const provider = (body.provider as LLMProvider) ?? "claude";
  const runtimeKey = body.apiKey as string | null | undefined;
  const workflowMode = (body.workflowMode as string) ?? "bank";
  const isIndustrialPdf = workflowMode === "industrial-pdf";

  if (!structuredResult) {
    return NextResponse.json({ error: "structuredResult is required." }, { status: 400 });
  }

  const { apiKey, needsKey } = resolveApiKey(provider, runtimeKey ?? undefined);
  if (needsKey) {
    return NextResponse.json({ error: "No API key found.", requiresApiKey: true }, { status: 401 });
  }

  const userPrompt = isIndustrialPdf
    ? [
        `Analyze the following Step 2 industrial extraction result from ${companyName}'s ${filingType} filing (${fileName}).`,
        `Generate a filing hints JSON object that maps each extracted metric to its location in the filing.`,
        ``,
        `Extraction result:`,
        JSON.stringify(structuredResult, null, 2),
        ``,
        `Return a JSON object with this EXACT structure (omit metrics not clearly identified):`,
        `{`,
        `  "metricLocations": {`,
        `    "revenue_usd_m": { "section": "section/table name", "labelVariants": ["label1", "label2"], "notes": "optional" },`,
        `    "operating_income_usd_m": { "section": "...", "labelVariants": ["..."] },`,
        `    "gross_profit_usd_m": { "section": "...", "labelVariants": ["..."] },`,
        `    "capex_usd_m": { "section": "...", "labelVariants": ["..."] },`,
        `    "depreciation_amortization_usd_m": { "section": "...", "labelVariants": ["..."] },`,
        `    "headcount": { "section": "...", "labelVariants": ["..."] }`,
        `  },`,
        `  "generalNotes": "brief notes about filing structure, fiscal year end, currency, segment reporting",`,
        `  "keyTableKeywords": ["keyword1", "keyword2"],`,
        `  "version": 1,`,
        `  "lastUpdatedByFile": "${fileName}"`,
        `}`,
        ``,
        `Rules: section values should be the exact table/statement heading from the filing.`,
        `labelVariants should include all synonyms used (e.g. "Revenue", "Net revenues", "Total revenues").`,
        `keyTableKeywords: 2-5 table header strings that the LLM should search for first.`,
      ].join("\n")
    : [
        `Analyze the following Step 2 bank extraction result from ${companyName}'s ${filingType} filing (${fileName}).`,
        `Generate a filing hints JSON object that maps each extracted metric to its location.`,
        ``,
        `Extraction result:`,
        JSON.stringify(structuredResult, null, 2),
        ``,
        `Return a JSON object with this EXACT structure (omit metrics not clearly identified):`,
        `{`,
        `  "metricLocations": {`,
        `    "nii_usd_m": { "section": "section/table name", "labelVariants": ["label1", "label2"], "notes": "optional" },`,
        `    "non_interest_income_usd_m": { "section": "...", "labelVariants": ["..."] },`,
        `    "provision_for_credit_losses_usd_m": { "section": "...", "labelVariants": ["..."] },`,
        `    "net_income_usd_m": { "section": "...", "labelVariants": ["..."] },`,
        `    "book_value_equity_usd_m": { "section": "...", "labelVariants": ["..."] },`,
        `    "goodwill_usd_m": { "section": "...", "labelVariants": ["Goodwill", "Goodwill, net"] },`,
        `    "intangible_assets_usd_m": { "section": "...", "labelVariants": ["Other intangible assets", "Intangible assets, net"] },`,
        `    "preferred_equity_usd_m": { "section": "...", "labelVariants": ["Preferred stock", "Preferred equity", "Series A preferred"] },`,
        `    "total_rwa_usd_m": { "section": "...", "labelVariants": ["..."] },`,
        `    "tier1_capital_ratio_pct": { "section": "...", "labelVariants": ["..."] },`,
        `    "cet1_ratio_pct": { "section": "...", "labelVariants": ["..."] },`,
        `    "net_interest_margin_pct": { "section": "...", "labelVariants": ["..."] },`,
        `    "efficiency_ratio_pct": { "section": "...", "labelVariants": ["..."] },`,
        `    "return_on_avg_equity_pct": { "section": "...", "labelVariants": ["..."] },`,
        `    "total_assets_usd_m": { "section": "...", "labelVariants": ["..."] }`,
        `  },`,
        `  "generalNotes": "brief notes about filing structure, fiscal year end, currency",`,
        `  "keyTableKeywords": ["keyword1", "keyword2"],`,
        `  "version": 1,`,
        `  "lastUpdatedByFile": "${fileName}"`,
        `}`,
        ``,
        `Rules: section values should be the exact table/statement heading from the filing.`,
        `labelVariants should include all synonyms used (e.g. "Net interest income", "NII").`,
        `keyTableKeywords: 2-5 table header strings that the LLM should search for first.`,
      ].join("\n");

  const llmResult = await callLLM({
    provider,
    apiKey,
    prompt: userPrompt,
    systemPrompt: GENERATE_HINTS_SYSTEM_PROMPT,
    maxTokens: 4096,
  });

  let hints: unknown;
  try {
    const text = llmResult.text.trim();
    // Strip possible markdown fences
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    hints = JSON.parse(clean);
  } catch (err) {
    console.error("[extract-history/generate-hints] Parse error:", err);
    return NextResponse.json(
      { error: "Model did not return valid hints JSON.", raw: llmResult.text.slice(0, 500) },
      { status: 422 },
    );
  }

  return NextResponse.json({ hints });
}

// =============================================================================
// Legacy single-shot handler (multipart/form-data)
// Keeps backward-compat for any direct callers not yet on the pipeline.
// =============================================================================

const XLSX_EXTS = new Set([".xlsx", ".xls", ".xlsm"]);
const CSV_EXTS = new Set([".csv"]);
const TXT_EXTS = new Set([".txt"]);
const JSON_EXTS = new Set([".json"]);

type ParsedFile = {
  name: string;
  content: string;
  records: Array<Record<string, unknown>>;
};

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

async function parseFile(file: File): Promise<ParsedFile> {
  const ext = fileExtension(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (TXT_EXTS.has(ext)) {
    return { name: file.name, content: buffer.toString("utf-8"), records: [] };
  }
  if (JSON_EXTS.has(ext)) {
    const content = buffer.toString("utf-8");
    const payload = JSON.parse(content) as unknown;
    const records = recordsFromDcfInputPayload(payload);
    return {
      name: file.name,
      content: records.length > 0 ? JSON.stringify(records, null, 2) : content,
      records,
    };
  }
  if (XLSX_EXTS.has(ext) || CSV_EXTS.has(ext)) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const records: Array<Record<string, unknown>> = [];
    for (const sheetName of wb.SheetNames) {
      records.push(
        ...XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" }),
      );
    }
    if (records.length === 0) return { name: file.name, content: "(empty workbook)", records: [] };
    return { name: file.name, content: JSON.stringify(records, null, 2), records };
  }
  throw new Error(`Unsupported file type: ${file.name} (${ext})`);
}

async function handleLegacy(req: NextRequest): Promise<NextResponse<ExtractHistoryResponse>> {
  const formData = await req.formData();

  const targetYear = formData.get("targetYear");
  if (!targetYear || typeof targetYear !== "string" || !targetYear.trim()) {
    return NextResponse.json({ rows: [], error: "Target fiscal year is required." }, { status: 400 });
  }

  const architectureRaw = formData.get("architecture");
  if (!architectureRaw || typeof architectureRaw !== "string") {
    return NextResponse.json(
      { rows: [], error: "Step 1 architecture JSON is required." },
      { status: 400 },
    );
  }

  const dataFiles = formData
    .getAll("dataFiles")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const textNotes = (formData.get("textNotes") as string | null)?.trim() ?? "";

  if (dataFiles.length === 0 && !textNotes) {
    return NextResponse.json(
      { rows: [], error: "Please upload at least one data file or paste text notes." },
      { status: 400 },
    );
  }

  const llmProvider = (formData.get("llmProvider") as LLMProvider) || "gemini";
  const runtimeKey = formData.get("apiKey") as string | null;

  const parsedSections: string[] = [];
  const parsedFiles: ParsedFile[] = [];

  for (const file of dataFiles) {
    try {
      const pf = await parseFile(file);
      parsedFiles.push(pf);
      parsedSections.push(`--- FILE: ${file.name} ---\n${pf.content}`);
    } catch (err) {
      console.warn(`[extract-history/legacy] Skipping ${file.name}:`, err);
    }
  }

  if (textNotes) parsedSections.push(`--- TEXT NOTES ---\n${textNotes}`);

  if (parsedSections.length === 0) {
    return NextResponse.json(
      { rows: [], error: "Could not parse any of the uploaded files." },
      { status: 400 },
    );
  }

  const targetYearNumber = Number(targetYear.trim());
  for (const pf of parsedFiles) {
    const fixtureResult = buildStep2StructuredFromFixtureRecords(
      pf.records,
      targetYearNumber,
      pf.name,
    );
    if (fixtureResult) {
      const rows = projectStep2StructuredToRows(fixtureResult);
      return NextResponse.json({ rows, structuredResult: fixtureResult });
    }
  }

  const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey ?? undefined);
  if (needsKey) {
    return NextResponse.json(
      { rows: [], error: "No API key found.", requiresApiKey: true },
      { status: 401 },
    );
  }

  const companyName = companyNameFromArchitecture(architectureRaw);

  const systemPrompt = [
    "You are producing the Step 2 historical financials contract for a DCF workflow.",
    "Return only a compact structured JSON object matching the provided schema.",
    'The top-level schema_version field must be exactly "v5.5".',
    "Do not invent financial values. Use null for unavailable revenue or operating income.",
    "Map rows only to Step 1 canonical analysis segments and offerings.",
    "Rows must include source_id, mapped_from_step1_ids, evidence_level, validation_status, and review_note.",
    "Keep review_note and excerpts short. No prose outside the structured response.",
  ].join(" ");

  const userPrompt = [
    "Task: Extract historical quarterly financial rows for the target fiscal year.",
    `Company: ${companyName}`,
    `Target Fiscal Year: ${targetYear.trim()}`,
    "Step 1 architecture input:",
    architectureRaw,
    "Rules:",
    "- Use canonical Step 1 names for segment/product mapping.",
    "- If a value is present in uploaded data, validation_status is verified_source.",
    "- If a value is missing or inferred, keep it null and add a validation warning.",
    "- Put geographic-only lines, subtotals, duplicate rows, and unmapped labels into excluded_items.",
    "- Units must be USD millions.",
    "Source data:",
    parsedSections.join("\n\n"),
  ].join("\n");

  const result = await callLLM({
    provider: llmProvider,
    apiKey,
    prompt: userPrompt,
    systemPrompt,
    maxTokens: 16384,
    responseSchema:
      llmProvider === "gemini" ? GEMINI_STEP2_RESPONSE_SCHEMA : STEP2_RESPONSE_SCHEMA,
  });

  let structuredResult;
  try {
    const payload =
      result.structuredData && typeof result.structuredData === "object"
        ? result.structuredData
        : parseStructuredJsonText(result.text, {
            provider: llmProvider,
            finishReason: result.finishReason,
            finishMessage: result.finishMessage,
          });
    structuredResult = parseStep2StructuredResult(payload);
  } catch (err) {
    return NextResponse.json(
      {
        rows: [],
        structuredResult: null,
        error:
          err instanceof Error
            ? err.message
            : "The model did not return valid Step 2 structured JSON.",
      },
      { status: 422 },
    );
  }

  const rows = projectStep2StructuredToRows(structuredResult);
  return NextResponse.json({ rows, structuredResult });
}
