import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ExtractHistoryResponse } from "../types/cfp.ts";

const EvidenceLevelSchema = z.enum([
  "DISCLOSED",
  "STRONG_INFERENCE",
  "WEAK_INFERENCE",
  "UNSUPPORTED",
]);

const QuarterSchema = z.enum(["Q1", "Q2", "Q3", "Q4"]);

const nullableNum = () => z.number().nullable();

const nullableStr = (maxLen?: number) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    if (v.trim() === "") return null;
    if (maxLen && v.length > maxLen) return v.slice(0, maxLen);
    return v;
  }, maxLen ? z.string().min(1).max(maxLen).nullable() : z.string().min(1).nullable());

const boundedStr = (maxLen: number, fallback = "—") =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    if (v.trim() === "") return fallback;
    if (v.length > maxLen) return v.slice(0, maxLen);
    return v;
  }, z.string().min(1).max(maxLen));

const SourceSchema = z.object({
  source_id: z.string().min(1),
  source_type: z.enum(["uploaded_file", "text_notes", "derived", "not_available"]),
  name: z.string().min(1),
  locator: nullableStr(),
  excerpt: nullableStr(220),
});

/**
 * One bank-mode extraction row.
 * Uses NII-driven capital metrics instead of revenue / operating income.
 * All 12 financial metrics are nullable (LLM may not find every figure).
 */
const BankRowSchema = z.object({
  row_id: z.string().min(1),
  fiscal_year: z.number().int().min(1900).max(2100),
  quarter: QuarterSchema,
  segment: z.string().min(1),
  // Primary income metrics
  nii_usd_m: nullableNum(),
  non_interest_income_usd_m: nullableNum(),
  provision_for_credit_losses_usd_m: nullableNum(),
  net_income_usd_m: nullableNum(),
  // Balance-sheet / capital metrics
  book_value_equity_usd_m: nullableNum(),
  total_rwa_usd_m: nullableNum(),
  tier1_capital_ratio_pct: nullableNum(),
  cet1_ratio_pct: nullableNum(),
  // Efficiency / profitability ratios (percentages)
  net_interest_margin_pct: nullableNum(),
  efficiency_ratio_pct: nullableNum(),
  return_on_avg_equity_pct: nullableNum(),
  // Size metric
  total_assets_usd_m: nullableNum(),
  mapped_from_step1_ids: z.array(z.string().min(1)).min(1),
  source_id: z.string().min(1),
  evidence_level: EvidenceLevelSchema,
  validation_status: z.enum([
    "verified_source",
    "needs_review",
    "external_verification_required",
    "unverified",
  ]),
  review_note: z.preprocess((v) => {
    if (typeof v !== "string" || v.trim() === "") return "No review note provided.";
    if (v.length > 220) return v.slice(0, 220);
    return v;
  }, z.string().min(1).max(220)),
});

const ExcludedItemSchema = z.object({
  label: z.string().min(1),
  reason: boundedStr(220),
  source_id: z.string().min(1).nullable(),
  evidence_level: EvidenceLevelSchema,
});

const ValidationWarningSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warn", "high"]),
  message: boundedStr(220),
  row_ids: z.array(z.string().min(1)).default([]),
});

export const Step2BankStructuredSchema = z
  .object({
    schema_version: z.literal("v5.5"),
    workflow: z.literal("bank"),
    company_name: z.string().min(1),
    target_year: z.number().int().min(1900).max(2100),
    rows: z.array(BankRowSchema),
    sources: z.array(SourceSchema),
    excluded_items: z.array(ExcludedItemSchema).default([]),
    validation_warnings: z.array(ValidationWarningSchema).default([]),
    review_summary: z.object({
      one_line: boundedStr(240),
      highlights: z.array(boundedStr(180)).default([]),
      warnings: z.array(boundedStr(180)).default([]),
    }),
  })
  .superRefine((payload, ctx) => {
    const sourceIds = new Set(payload.sources.map((s) => s.source_id));
    const rowIds = new Set(payload.rows.map((r) => r.row_id));

    payload.rows.forEach((row, i) => {
      if (!sourceIds.has(row.source_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", i, "source_id"],
          message: `Unknown source_id "${row.source_id}"`,
        });
      }
      // Primary-metric presence is enforced in normalizeBankPayload (pre-parse)
      // so rows reaching here already have at least one primary metric.
    });

    payload.validation_warnings.forEach((warning, wi) => {
      warning.row_ids.forEach((rowId, ri) => {
        if (!rowIds.has(rowId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["validation_warnings", wi, "row_ids", ri],
            message: `Unknown row_id "${rowId}"`,
          });
        }
      });
    });
  });

export type Step2BankStructuredResult = z.infer<typeof Step2BankStructuredSchema>;

/**
 * Maps a bank structured result row to the flat HistoricalExtractionRow shape
 * (without id / yoyGrowth which are assigned client-side).
 * - revenue  ← nii_usd_m   (so existing table column renders a meaningful figure)
 * - operatingIncome ← net_income_usd_m
 * - All 12 bank fields are also stored on the row for the bank-mode table.
 */
export function projectStep2BankStructuredToRows(
  result: Step2BankStructuredResult,
): ExtractHistoryResponse["rows"] {
  return result.rows.map((row) => {
    const source = result.sources.find((s) => s.source_id === row.source_id);
    const verified = row.validation_status === "verified_source";

    return {
      fiscalYear: row.fiscal_year,
      quarter: row.quarter,
      segment: row.segment,
      productCategory: "Banking",
      productName: row.segment,
      revenue: row.nii_usd_m,
      operatingIncome: row.net_income_usd_m,
      notes: row.review_note,
      reviewStatus: verified ? "Review Access Data" : "External Verification Required",
      internalVerify: verified ? "Yes" : "No",
      sourceType:
        source?.source_type === "uploaded_file" || source?.source_type === "text_notes"
          ? "User Provided"
          : "Not Available",
      sourceName: source?.name ?? "Not available",
      sourceLink: source?.locator ?? "Not available",
      reviewNote: row.review_note,
      // Bank-mode fields
      workflow_mode: "bank" as const,
      nii_usd_m: row.nii_usd_m,
      non_interest_income_usd_m: row.non_interest_income_usd_m,
      provision_for_credit_losses_usd_m: row.provision_for_credit_losses_usd_m,
      net_income_usd_m: row.net_income_usd_m,
      book_value_equity_usd_m: row.book_value_equity_usd_m,
      total_rwa_usd_m: row.total_rwa_usd_m,
      tier1_capital_ratio_pct: row.tier1_capital_ratio_pct,
      cet1_ratio_pct: row.cet1_ratio_pct,
      net_interest_margin_pct: row.net_interest_margin_pct,
      efficiency_ratio_pct: row.efficiency_ratio_pct,
      return_on_avg_equity_pct: row.return_on_avg_equity_pct,
      total_assets_usd_m: row.total_assets_usd_m,
    };
  });
}

const generatedSchema = zodToJsonSchema(Step2BankStructuredSchema, "Step2BankStructuredResult");

export const STEP2_BANK_RESPONSE_SCHEMA =
  "definitions" in generatedSchema && generatedSchema.definitions
    ? generatedSchema.definitions.Step2BankStructuredResult
    : generatedSchema;

function sanitizeSchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSchemaForGemini(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.$ref === "string") {
    const refTarget = record.$ref.split("/").pop();
    if (refTarget && generatedSchema.definitions && refTarget in generatedSchema.definitions) {
      return sanitizeSchemaForGemini(
        generatedSchema.definitions[refTarget as keyof typeof generatedSchema.definitions],
      );
    }
  }

  const nextEntries = Object.entries(record)
    .filter(
      ([key]) =>
        !["$schema", "$ref", "definitions", "const", "additionalProperties", "propertyNames"].includes(key),
    )
    .map(([key, entryValue]) => {
      if (key === "type" && Array.isArray(entryValue)) {
        const nonNullTypes = (entryValue as string[]).filter((t) => t !== "null");
        return [key, nonNullTypes[0] ?? "string"] as const;
      }

      if (key === "type" && entryValue === "null") {
        return [key, "string"] as const;
      }

      if (key === "anyOf" && Array.isArray(entryValue)) {
        const nonNullOptions = entryValue
          .filter(
            (option) =>
              !(option && typeof option === "object" && (option as Record<string, unknown>).type === "null"),
          )
          .map((option) => sanitizeSchemaForGemini(option));

        if (nonNullOptions.length === 1) {
          const option = nonNullOptions[0] as Record<string, unknown>;
          return ["type", option.type ?? "string"] as const;
        }

        return [key, nonNullOptions] as const;
      }

      return [key, sanitizeSchemaForGemini(entryValue)] as const;
    });

  const sanitized = Object.fromEntries(nextEntries) as Record<string, unknown>;

  if (Array.isArray(record.type) && (record.type as string[]).includes("null")) {
    sanitized.nullable = true;
  }

  if (Array.isArray(sanitized.required)) {
    sanitized.required = sanitized.required.filter((entry) => typeof entry === "string");
  }

  return sanitized;
}

export const GEMINI_STEP2_BANK_RESPONSE_SCHEMA = sanitizeSchemaForGemini(
  STEP2_BANK_RESPONSE_SCHEMA,
) as Record<string, unknown>;

function normalizeBankPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const p = { ...(payload as Record<string, unknown>) };
  p.schema_version = "v5.5";
  p.workflow = "bank";

  // Rows that have no primary banking metric can't anchor a DCF forecast.
  // Move them to excluded_items and add a validation_warning so the analyst
  // knows why they were dropped, rather than hard-failing the whole parse.
  if (Array.isArray(p.rows)) {
    const validRows: unknown[] = [];
    const droppedItems: Array<{
      label: string;
      reason: string;
      source_id: string | null;
      evidence_level: string;
    }> = [];
    let missingMappingCount = 0;

    for (const row of p.rows as Record<string, unknown>[]) {
      const hasPrimary =
        (row.nii_usd_m !== null && row.nii_usd_m !== undefined) ||
        (row.non_interest_income_usd_m !== null && row.non_interest_income_usd_m !== undefined) ||
        (row.net_income_usd_m !== null && row.net_income_usd_m !== undefined);

      if (!hasPrimary) {
        droppedItems.push({
          label: `${row.fiscal_year ?? "?"} ${row.quarter ?? "?"} — ${row.segment ?? "Unknown segment"}`,
          reason: "No primary banking metric found (NII, non-interest income, or net income)",
          source_id: typeof row.source_id === "string" ? row.source_id : null,
          evidence_level: typeof row.evidence_level === "string" ? row.evidence_level : "UNSUPPORTED",
        });
        continue;
      }

      // Recover rows with missing/empty mapped_from_step1_ids instead of hard-failing.
      if (!Array.isArray(row.mapped_from_step1_ids) || (row.mapped_from_step1_ids as unknown[]).filter(Boolean).length === 0) {
        row.mapped_from_step1_ids = ["unmapped"];
        missingMappingCount++;
      }

      validRows.push(row);
    }

    p.rows = validRows;

    const existingExcluded = Array.isArray(p.excluded_items) ? p.excluded_items : [];
    const existingWarnings = Array.isArray(p.validation_warnings) ? p.validation_warnings : [];
    const newWarnings: typeof existingWarnings = [];

    if (droppedItems.length > 0) {
      p.excluded_items = [...existingExcluded, ...droppedItems];
      newWarnings.push({
        code: "rows_missing_primary_metric",
        severity: "warn",
        message: `${droppedItems.length} row(s) moved to excluded: no NII, non-interest income, or net income found.`,
        row_ids: [],
      });
    }

    if (missingMappingCount > 0) {
      newWarnings.push({
        code: "rows_missing_step1_mapping",
        severity: "warn",
        message: `${missingMappingCount} row(s) had empty mapped_from_step1_ids — defaulted to ["unmapped"].`,
        row_ids: [],
      });
    }

    if (newWarnings.length > 0) {
      p.validation_warnings = [...existingWarnings, ...newWarnings];
    }
  }

  return p;
}

export function parseStep2BankStructuredResult(payload: unknown): Step2BankStructuredResult {
  return Step2BankStructuredSchema.parse(normalizeBankPayload(payload));
}
