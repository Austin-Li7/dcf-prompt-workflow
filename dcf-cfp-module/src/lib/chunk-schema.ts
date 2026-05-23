/**
 * Intermediate ("Map phase") schema used when a file is split into chunks.
 * Much lighter than Step2StructuredResult — captures raw financial rows only.
 * The Reduce phase synthesises these into the full Step2StructuredResult.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ---------------------------------------------------------------------------
// Row extracted from one chunk (covers all fiscal years found in that chunk)
// ---------------------------------------------------------------------------
export const ChunkRowSchema = z.object({
  fiscal_year: z.number().int().min(2000).max(2100),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  segment: z.string().min(1),
  product_category: z.string().min(1),
  product_name: z.string().min(1),
  revenue_usd_m: z.number().nullable(),
  operating_income_usd_m: z.number().nullable(),
  /** Short excerpt proving where the number came from (max 160 chars). */
  // Auto-truncate to 160 chars: models routinely paste slightly-longer excerpts
  // and rejecting the whole chunk over a 5-char overflow is wasteful.
  source_excerpt: z.preprocess(
    (v) => (typeof v === "string" && v.length > 160 ? v.slice(0, 160) : v),
    z.string().max(160),
  ),
  confidence: z.enum(["high", "medium", "low"]),
});

export const ChunkSummarySchema = z.object({
  /** Echoed back from the request so the Reduce phase can track provenance. */
  chunk_id: z.string(),
  rows: z.array(ChunkRowSchema),
  /** Any data quality issues noticed in this chunk. */
  anomalies: z.array(z.string().transform((s) => s.slice(0, 500))).default([]),
});

export type ChunkRow = z.infer<typeof ChunkRowSchema>;
export type ChunkSummary = z.infer<typeof ChunkSummarySchema>;

// ---------------------------------------------------------------------------
// JSON Schema exports (for provider responseSchema fields)
// ---------------------------------------------------------------------------

const _generated = zodToJsonSchema(ChunkSummarySchema, "ChunkSummary");

export const CHUNK_SUMMARY_SCHEMA: Record<string, unknown> =
  ("definitions" in _generated && _generated.definitions
    ? _generated.definitions.ChunkSummary
    : _generated) as Record<string, unknown>;

// Gemini-safe variant (no $ref, no additionalProperties, nullable instead of anyOf null)
function sanitizeForGemini(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForGemini);
  if (!value || typeof value !== "object") return value;
  const rec = value as Record<string, unknown>;

  let hadAnyOfNull = false; // track if anyOf contained a null type

  const entries = Object.entries(rec)
    .filter(
      ([k]) =>
        !["$schema", "$ref", "definitions", "const", "additionalProperties"].includes(k),
    )
    .map(([k, v]) => {
      if (k === "type" && Array.isArray(v)) {
        const nonNull = (v as string[]).filter((t) => t !== "null");
        return [k, nonNull[0] ?? "string"] as const;
      }
      if (k === "anyOf" && Array.isArray(v)) {
        const hasNull = (v as unknown[]).some(
          (o) => o && typeof o === "object" && (o as Record<string, unknown>).type === "null",
        );
        const nonNull = (v as unknown[])
          .filter(
            (o) =>
              !(o && typeof o === "object" && (o as Record<string, unknown>).type === "null"),
          )
          .map(sanitizeForGemini);
        if (hasNull) hadAnyOfNull = true;
        if (nonNull.length === 1)
          return ["type", (nonNull[0] as Record<string, unknown>).type ?? "string"] as const;
        return [k, nonNull] as const;
      }
      return [k, sanitizeForGemini(v)] as const;
    });
  const out = Object.fromEntries(entries) as Record<string, unknown>;
  // Mark nullable when original had anyOf-with-null OR type array containing null
  if (hadAnyOfNull || (Array.isArray(rec.type) && (rec.type as string[]).includes("null"))) {
    out.nullable = true;
  }
  if (Array.isArray(out.required))
    out.required = (out.required as unknown[]).filter((e) => typeof e === "string");
  return out;
}

export const GEMINI_CHUNK_SUMMARY_SCHEMA = sanitizeForGemini(
  CHUNK_SUMMARY_SCHEMA,
) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Bank / financial mode — Map-phase schemas
// ---------------------------------------------------------------------------

export const BankChunkRowSchema = z.object({
  fiscal_year: z.number().int().min(2000).max(2100),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  segment: z.string().min(1),
  nii_usd_m: z.number().nullable(),
  non_interest_income_usd_m: z.number().nullable(),
  provision_for_credit_losses_usd_m: z.number().nullable(),
  net_income_usd_m: z.number().nullable(),
  book_value_equity_usd_m: z.number().nullable(),
  // TCE components — balance-sheet items at consolidated level. Default null when LLM omits them.
  goodwill_usd_m: z.number().nullable().default(null),
  intangible_assets_usd_m: z.number().nullable().default(null),
  preferred_equity_usd_m: z.number().nullable().default(null),
  total_rwa_usd_m: z.number().nullable(),
  tier1_capital_ratio_pct: z.number().nullable(),
  cet1_ratio_pct: z.number().nullable(),
  net_interest_margin_pct: z.number().nullable(),
  efficiency_ratio_pct: z.number().nullable(),
  return_on_avg_equity_pct: z.number().nullable(),
  total_assets_usd_m: z.number().nullable(),
  // Liquidity fields
  total_loans_usd_m: z.number().nullable(),
  total_deposits_usd_m: z.number().nullable(),
  retail_insured_deposits_usd_m: z.number().nullable(),
  wholesale_uninsured_deposits_usd_m: z.number().nullable(),
  cash_and_hqla_usd_m: z.number().nullable(),
  htm_bonds_usd_m: z.number().nullable(),
  unrealized_losses_htm_usd_m: z.number().nullable(),
  // Auto-truncate to 160 chars: models routinely paste slightly-longer excerpts
  // and rejecting the whole chunk over a 5-char overflow is wasteful.
  source_excerpt: z.preprocess(
    (v) => (typeof v === "string" && v.length > 160 ? v.slice(0, 160) : v),
    z.string().max(160),
  ),
  confidence: z.enum(["high", "medium", "low"]),
});

export const BankChunkSummarySchema = z.object({
  chunk_id: z.string(),
  rows: z.array(BankChunkRowSchema),
  anomalies: z.array(z.string().transform((s) => s.slice(0, 500))).default([]),
});

export type BankChunkRow = z.infer<typeof BankChunkRowSchema>;
export type BankChunkSummary = z.infer<typeof BankChunkSummarySchema>;

const _bankGenerated = zodToJsonSchema(BankChunkSummarySchema, "BankChunkSummary");

export const BANK_CHUNK_SUMMARY_SCHEMA: Record<string, unknown> =
  ("definitions" in _bankGenerated && _bankGenerated.definitions
    ? _bankGenerated.definitions.BankChunkSummary
    : _bankGenerated) as Record<string, unknown>;

export const GEMINI_BANK_CHUNK_SUMMARY_SCHEMA = sanitizeForGemini(
  BANK_CHUNK_SUMMARY_SCHEMA,
) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Industrial mode — Map-phase schemas (revenue/margin/capex/headcount)
// ---------------------------------------------------------------------------

export const IndustrialChunkRowSchema = z.object({
  fiscal_year: z.number().int().min(2000).max(2100),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  segment: z.string().min(1),
  revenue_usd_m: z.number().nullable(),
  operating_income_usd_m: z.number().nullable(),
  gross_profit_usd_m: z.number().nullable(),
  capex_usd_m: z.number().nullable(),
  depreciation_amortization_usd_m: z.number().nullable(),
  /** Headcount as reported (integer, or null if not disclosed). */
  headcount: z.number().int().nullable(),
  /** Short excerpt proving where the number came from (max 160 chars). */
  // Auto-truncate to 160 chars: models routinely paste slightly-longer excerpts
  // and rejecting the whole chunk over a 5-char overflow is wasteful.
  source_excerpt: z.preprocess(
    (v) => (typeof v === "string" && v.length > 160 ? v.slice(0, 160) : v),
    z.string().max(160),
  ),
  confidence: z.enum(["high", "medium", "low"]),
});

export const IndustrialChunkSummarySchema = z.object({
  chunk_id: z.string(),
  rows: z.array(IndustrialChunkRowSchema).default([]),
  anomalies: z.array(z.string().transform((s) => s.slice(0, 500))).default([]),
});

export type IndustrialChunkRow = z.infer<typeof IndustrialChunkRowSchema>;
export type IndustrialChunkSummary = z.infer<typeof IndustrialChunkSummarySchema>;

const _industrialGenerated = zodToJsonSchema(IndustrialChunkSummarySchema, "IndustrialChunkSummary");

export const INDUSTRIAL_CHUNK_SUMMARY_SCHEMA: Record<string, unknown> =
  ("definitions" in _industrialGenerated && _industrialGenerated.definitions
    ? _industrialGenerated.definitions.IndustrialChunkSummary
    : _industrialGenerated) as Record<string, unknown>;

export const GEMINI_INDUSTRIAL_CHUNK_SUMMARY_SCHEMA = sanitizeForGemini(
  INDUSTRIAL_CHUNK_SUMMARY_SCHEMA,
) as Record<string, unknown>;
