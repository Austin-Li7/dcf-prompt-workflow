/**
 * step2-industrial-schema.ts
 *
 * Zod schema for the Step 2 industrial (non-financial) extraction result.
 * Mirrors step2-bank-schema.ts in structure but captures industrial metrics:
 * revenue, operating income, gross profit, CapEx, D&A, and headcount.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { HistoricalExtractionRow } from "@/types/cfp";

// ---------------------------------------------------------------------------
// Helpers (mirrors step2-bank-schema.ts pattern)
// ---------------------------------------------------------------------------

const nullableNum = z.number().nullable();
const boundedStr = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(max).nullable(),
  );

// ---------------------------------------------------------------------------
// Row schema
// ---------------------------------------------------------------------------

export const Step2IndustrialRowSchema = z.object({
  row_id: z.string().min(1),
  fiscal_year: z.number().int().min(2000).max(2100),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  segment: z.string().min(1),
  // Core income-statement metrics
  revenue_usd_m: nullableNum,
  operating_income_usd_m: nullableNum,
  gross_profit_usd_m: nullableNum,
  // Cash-flow / capex metrics
  capex_usd_m: nullableNum,
  depreciation_amortization_usd_m: nullableNum,
  // Operational KPI — stock metric (year-end snapshot)
  headcount: z.number().int().nullable(),
  // Provenance & quality
  mapped_from_step1_ids: z.array(z.string().min(1)).default([]),
  source_id: z.string().min(1),
  evidence_level: z.enum(["DISCLOSED", "STRONG_INFERENCE", "WEAK_INFERENCE", "UNSUPPORTED"]),
  validation_status: z.enum([
    "verified_source",
    "needs_review",
    "external_verification_required",
    "unverified",
  ]),
  review_note: z.preprocess(
    (v) => (v === "" ? "No review note provided." : v),
    z.string().max(220),
  ),
});

const SourceSchema = z.object({
  source_id: z.string().min(1),
  source_type: z.enum(["uploaded_file", "text_notes", "derived", "not_available"]),
  name: z.string().min(1),
  locator: boundedStr(200),
  excerpt: boundedStr(200),
});

const ExcludedItemSchema = z.object({
  label: z.string().min(1),
  reason: z.string().min(1),
  source_id: z.string().min(1).nullable(),
  evidence_level: z.enum(["DISCLOSED", "STRONG_INFERENCE", "WEAK_INFERENCE", "UNSUPPORTED"]),
});

const ValidationWarningSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warn", "high"]),
  message: z.string().min(1),
  row_ids: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// MD&A CapEx split — company-level for the fiscal year (Task 1B)
// ---------------------------------------------------------------------------

/**
 * Captures the management-disclosed maintenance vs. growth CapEx split from
 * Item 7 (10-K) or Item 2 (10-Q) MD&A narrative.  All fields are nullable —
 * most companies do not explicitly disclose this breakdown.
 */
const CapExMdaSplitSchema = z.object({
  /** Management-disclosed maintenance / sustaining CapEx for the year (USD millions) */
  maintenance_usd_m: z.number().nullable(),
  /** Management-disclosed growth / expansion CapEx for the year (USD millions) */
  growth_usd_m: z.number().nullable(),
  /** Forward-looking CapEx guidance text extracted from MD&A (max 320 chars) */
  guidance_note: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(320).nullable(),
  ),
  /** source_id of the MD&A section where this data was found */
  source_id: z.string().min(1).nullable(),
});

// ---------------------------------------------------------------------------
// Top-level result schema
// ---------------------------------------------------------------------------

export const Step2IndustrialStructuredSchema = z.object({
  schema_version: z.literal("v5.5"),
  workflow: z.literal("industrial"),
  company_name: z.string().min(1),
  target_year: z.number().int().min(2000),
  rows: z.array(Step2IndustrialRowSchema).default([]),
  sources: z.array(SourceSchema).default([]),
  excluded_items: z.array(ExcludedItemSchema).default([]),
  validation_warnings: z.array(ValidationWarningSchema).default([]),
  review_summary: z.object({
    one_line: z.string().min(1),
    highlights: z.array(z.string()).default([]),
    warnings: z.array(z.string()).default([]),
  }),
  /**
   * MD&A management split between maintenance and growth CapEx.
   * Null when management did not explicitly disclose the breakdown.
   */
  capex_mda_split: CapExMdaSplitSchema.nullable().default(null),
});

export type Step2IndustrialRow = z.infer<typeof Step2IndustrialRowSchema>;
export type Step2IndustrialStructuredResult = z.infer<typeof Step2IndustrialStructuredSchema>;

// ---------------------------------------------------------------------------
// JSON Schema exports
// ---------------------------------------------------------------------------

const _generated = zodToJsonSchema(Step2IndustrialStructuredSchema, "Step2IndustrialStructuredResult");

export const STEP2_INDUSTRIAL_RESPONSE_SCHEMA: Record<string, unknown> =
  ("definitions" in _generated && _generated.definitions
    ? _generated.definitions.Step2IndustrialStructuredResult
    : _generated) as Record<string, unknown>;

// Gemini sanitizer (removes $ref, additionalProperties, handles anyOf null)
function sanitizeForGemini(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForGemini);
  if (!value || typeof value !== "object") return value;
  const rec = value as Record<string, unknown>;

  let hadAnyOfNull = false;

  const entries = Object.entries(rec)
    .filter(([k]) =>
      !["$schema", "$ref", "definitions", "const", "additionalProperties", "propertyNames"].includes(k),
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
  if (hadAnyOfNull || (Array.isArray(rec.type) && (rec.type as string[]).includes("null"))) {
    out.nullable = true;
  }
  if (Array.isArray(out.required))
    out.required = (out.required as unknown[]).filter((e) => typeof e === "string");
  return out;
}

export const GEMINI_STEP2_INDUSTRIAL_RESPONSE_SCHEMA = sanitizeForGemini(
  STEP2_INDUSTRIAL_RESPONSE_SCHEMA,
) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Normalization (runs before Zod parse — cleans up common LLM output quirks)
// ---------------------------------------------------------------------------

export function normalizeIndustrialPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;

  // Force correct discriminators
  const normalized: Record<string, unknown> = {
    ...obj,
    schema_version: "v5.5",
    workflow: "industrial",
  };

  // Drop rows where all numeric metrics are null — they carry no information
  if (Array.isArray(normalized.rows)) {
    normalized.rows = (normalized.rows as Array<Record<string, unknown>>).filter((row) => {
      const metrics: Array<keyof typeof row> = [
        "revenue_usd_m",
        "operating_income_usd_m",
        "gross_profit_usd_m",
        "capex_usd_m",
        "depreciation_amortization_usd_m",
        "headcount",
      ];
      return metrics.some((k) => row[k] !== null && row[k] !== undefined);
    });

    // Ensure mapped_from_step1_ids is always an array
    normalized.rows = (normalized.rows as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      mapped_from_step1_ids: Array.isArray(row.mapped_from_step1_ids)
        ? row.mapped_from_step1_ids
        : [],
    }));
  }

  // Normalise capex_mda_split — treat missing/empty object as null
  if (
    "capex_mda_split" in normalized &&
    normalized.capex_mda_split !== null &&
    typeof normalized.capex_mda_split === "object"
  ) {
    const split = normalized.capex_mda_split as Record<string, unknown>;
    const hasAnyValue =
      split.maintenance_usd_m != null ||
      split.growth_usd_m != null ||
      (typeof split.guidance_note === "string" && split.guidance_note.trim().length > 0);
    if (!hasAnyValue) {
      normalized.capex_mda_split = null;
    }
  }

  return normalized;
}

export function parseStep2IndustrialStructuredResult(payload: unknown): Step2IndustrialStructuredResult {
  return Step2IndustrialStructuredSchema.parse(normalizeIndustrialPayload(payload));
}

// ---------------------------------------------------------------------------
// Projection → HistoricalExtractionRow[]
// ---------------------------------------------------------------------------

export function projectStep2IndustrialStructuredToRows(
  result: Step2IndustrialStructuredResult,
  filingType?: "10-K" | "10-Q",
): Omit<HistoricalExtractionRow, "id" | "yoyGrowth">[] {
  const sourceMap = new Map(result.sources.map((s) => [s.source_id, s]));
  const isAnnualFiling = filingType === "10-K";

  return result.rows.map((row) => {
    const source = sourceMap.get(row.source_id);
    return {
      fiscalYear: row.fiscal_year,
      quarter: row.quarter,
      segment: row.segment,
      productCategory: row.segment,
      productName: row.segment,
      revenue: row.revenue_usd_m,
      operatingIncome: row.operating_income_usd_m,
      notes: row.review_note,
      reviewStatus: row.validation_status === "verified_source" ? "Verified" : "Review Access Data",
      internalVerify: row.validation_status === "verified_source" ? "Yes" : "No",
      sourceType: "Internal" as const,
      sourceName: source?.name ?? "PDF",
      reviewNote: row.review_note,
      workflow_mode: "industrial" as const,
      isAnnualFiling,
      // Industrial-specific fields
      gross_profit_usd_m: row.gross_profit_usd_m,
      capex_usd_m: row.capex_usd_m,
      depreciation_amortization_usd_m: row.depreciation_amortization_usd_m,
      headcount: row.headcount,
    };
  });
}
