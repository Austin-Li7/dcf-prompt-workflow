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

const SourceSchema = z.object({
  source_id: z.string().min(1),
  source_type: z.enum(["uploaded_file", "text_notes", "derived", "not_available"]),
  name: z.string().min(1),
  locator: z.string().min(1).nullable(),
  // Auto-truncate over-length excerpts before validation. The `locator` field
  // carries the full citation; `excerpt` is a brief proof-of-disclosure signal.
  // Rejecting the entire Step 2 reduce result over a slightly-long excerpt
  // wastes all upstream work, so we clip at the 220-char cap instead. Mirrors
  // the source_excerpt preprocess in chunk-schema.ts (chunk-row level) and
  // the nullableStr helper in step2-bank-schema.ts.
  excerpt: z.preprocess(
    (v) => (typeof v === "string" && v.length > 220 ? v.slice(0, 220) : v),
    z.string().min(1).max(220).nullable(),
  ),
});

const RowSchema = z.object({
  row_id: z.string().min(1),
  fiscal_year: z.number().int().min(1900).max(2100),
  quarter: QuarterSchema,
  segment: z.string().min(1),
  product_category: z.string().min(1),
  product_name: z.string().min(1),
  revenue_usd_m: z.number().nullable(),
  operating_income_usd_m: z.number().nullable(),
  mapped_from_step1_ids: z.array(z.string().min(1)).min(1),
  source_id: z.string().min(1),
  evidence_level: EvidenceLevelSchema,
  validation_status: z.enum([
    "verified_source",
    "needs_review",
    "external_verification_required",
    "unverified",
  ]),
  review_note: z.string().min(1).max(220),
});

const ExcludedItemSchema = z.object({
  label: z.string().min(1),
  reason: z.string().min(1).max(220),
  source_id: z.string().min(1).nullable(),
  evidence_level: EvidenceLevelSchema,
});

const ValidationWarningSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warn", "high"]),
  message: z.string().min(1).max(220),
  row_ids: z.array(z.string().min(1)).default([]),
});

export const Step2StructuredSchema = z
  .object({
    schema_version: z.literal("v5.5"),
    company_name: z.string().min(1),
    target_year: z.number().int().min(1900).max(2100),
    rows: z.array(RowSchema),
    sources: z.array(SourceSchema),
    excluded_items: z.array(ExcludedItemSchema).default([]),
    validation_warnings: z.array(ValidationWarningSchema).default([]),
    review_summary: z.object({
      one_line: z.string().min(1).max(240),
      highlights: z.array(z.string().min(1).max(180)).default([]),
      warnings: z.array(z.string().min(1).max(180)).default([]),
    }),
  })
  .superRefine((payload, ctx) => {
    const sourceIds = new Set(payload.sources.map((source) => source.source_id));
    const rowIds = new Set(payload.rows.map((row) => row.row_id));

    payload.rows.forEach((row, rowIndex) => {
      if (!sourceIds.has(row.source_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", rowIndex, "source_id"],
          message: `Unknown source_id "${row.source_id}"`,
        });
      }

      if (row.revenue_usd_m === null && row.operating_income_usd_m === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", rowIndex],
          message: "At least one financial metric must be present.",
        });
      }
    });

    payload.validation_warnings.forEach((warning, warningIndex) => {
      warning.row_ids.forEach((rowId, rowIdIndex) => {
        if (!rowIds.has(rowId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["validation_warnings", warningIndex, "row_ids", rowIdIndex],
            message: `Unknown row_id "${rowId}"`,
          });
        }
      });
    });
  });

export type Step2StructuredResult = z.infer<typeof Step2StructuredSchema>;

export function projectStep2StructuredToRows(
  result: Step2StructuredResult,
): ExtractHistoryResponse["rows"] {
  return result.rows.map((row) => {
    const source = result.sources.find((candidate) => candidate.source_id === row.source_id);
    const verified = row.validation_status === "verified_source";
    const missingMetrics = [
      row.revenue_usd_m === null ? "revenue" : "",
      row.operating_income_usd_m === null ? "operating income" : "",
    ].filter(Boolean);

    const reviewNote =
      missingMetrics.length > 0
        ? `${row.review_note} Missing ${missingMetrics.join(" and ")}; legacy table displays 0.`
        : row.review_note;

    return {
      fiscalYear: row.fiscal_year,
      quarter: row.quarter,
      segment: row.segment,
      productCategory: row.product_category,
      productName: row.product_name,
      revenue: row.revenue_usd_m,
      operatingIncome: row.operating_income_usd_m,
      notes: row.review_note,
      reviewStatus: verified ? "Review Access Data" : "External Verification Required",
      internalVerify: verified ? "Yes" : "No",
      sourceType:
        source?.source_type === "uploaded_file" || source?.source_type === "text_notes"
          ? "User Provided"
          : "Not Available",
      sourceName: source?.name ?? "Not available",
      sourceLink: source?.locator ?? "Not available",
      reviewNote,
    };
  });
}

const generatedSchema = zodToJsonSchema(Step2StructuredSchema, "Step2StructuredResult");

export const STEP2_RESPONSE_SCHEMA =
  "definitions" in generatedSchema && generatedSchema.definitions
    ? generatedSchema.definitions.Step2StructuredResult
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
        ![
          "$schema",
          "$ref",
          "definitions",
          "const",
          "additionalProperties",
          "propertyNames",
        ].includes(key),
    )
    .map(([key, entryValue]) => {
      if (key === "type" && Array.isArray(entryValue)) {
        const nonNullTypes = entryValue.filter((typeName) => typeName !== "null");
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

  if (Array.isArray(record.type) && record.type.includes("null")) {
    sanitized.nullable = true;
  }

  if (Array.isArray(sanitized.required)) {
    sanitized.required = sanitized.required.filter((entry) => typeof entry === "string");
  }

  return sanitized;
}

export const GEMINI_STEP2_RESPONSE_SCHEMA = sanitizeSchemaForGemini(
  STEP2_RESPONSE_SCHEMA,
) as Record<string, unknown>;

function normalizeStep2StructuredPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const p = { ...(payload as Record<string, unknown>), schema_version: "v5.5" };

  // Recover rows with missing/empty mapped_from_step1_ids instead of hard-failing.
  if (Array.isArray(p.rows)) {
    let missingMappingCount = 0;
    p.rows = (p.rows as Record<string, unknown>[]).map((row) => {
      if (!Array.isArray(row.mapped_from_step1_ids) || (row.mapped_from_step1_ids as unknown[]).filter(Boolean).length === 0) {
        missingMappingCount++;
        return { ...row, mapped_from_step1_ids: ["unmapped"] };
      }
      return row;
    });

    if (missingMappingCount > 0) {
      const existingWarnings = Array.isArray(p.validation_warnings) ? p.validation_warnings : [];
      p.validation_warnings = [
        ...existingWarnings,
        {
          code: "rows_missing_step1_mapping",
          severity: "warn",
          message: `${missingMappingCount} row(s) had empty mapped_from_step1_ids — defaulted to ["unmapped"].`,
          row_ids: [],
        },
      ];
    }
  }

  // Prune dangling row_id references in validation_warnings rather than hard-failing.
  // The model occasionally emits a warning whose row_ids[] point at:
  //   (a) a slightly-renamed row that exists under a different row_id,
  //   (b) a row it moved to excluded_items[] instead of rows[], or
  //   (c) a row it forgot to emit.
  // The warning's message is still useful even when the pointer is bad, so we
  // drop only the unresolvable row_ids (preserving the rest) and append a
  // meta-warning describing what we cleaned up. This mirrors the
  // rows_missing_step1_mapping pattern above.
  pruneDanglingWarningRowIds(p);

  return p;
}

/**
 * Strips validation_warnings[].row_ids[] entries that don't appear in rows[].row_id.
 * Mutates `p` in place. Appends a single meta-warning when any pruning occurred,
 * including the list of original warning codes whose pointers were cleaned, so
 * the analyst can investigate (typically: row renamed, row moved to
 * excluded_items, or pointer hallucinated by the model).
 */
function pruneDanglingWarningRowIds(p: Record<string, unknown>): void {
  if (!Array.isArray(p.rows) || !Array.isArray(p.validation_warnings)) return;

  const knownRowIds = new Set(
    (p.rows as Array<Record<string, unknown>>)
      .map((row) => row.row_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  let prunedCount = 0;
  const affectedCodes: string[] = [];

  const repaired = (p.validation_warnings as Array<Record<string, unknown>>).map((warning) => {
    if (!Array.isArray(warning.row_ids)) return warning;
    const original = warning.row_ids as unknown[];
    const kept = original.filter(
      (id): id is string => typeof id === "string" && knownRowIds.has(id),
    );
    const dropped = original.length - kept.length;
    if (dropped > 0) {
      prunedCount += dropped;
      if (typeof warning.code === "string") affectedCodes.push(warning.code);
    }
    return { ...warning, row_ids: kept };
  });

  if (prunedCount > 0) {
    const uniqueCodes = Array.from(new Set(affectedCodes));
    // Keep message under the 220-char schema cap by truncating the code list.
    const codesPreview =
      uniqueCodes.join(", ").length > 120
        ? `${uniqueCodes.slice(0, 4).join(", ")}, …`
        : uniqueCodes.join(", ");
    repaired.push({
      code: "validation_warning_unknown_row_ids",
      severity: "info",
      message: `Auto-repair: removed ${prunedCount} dangling row_id reference(s) from ${uniqueCodes.length} warning(s) [${codesPreview}]; referenced rows were not in rows[].`,
      row_ids: [],
    });
  }

  p.validation_warnings = repaired;
}

export function parseStep2StructuredResult(payload: unknown): Step2StructuredResult {
  return Step2StructuredSchema.parse(normalizeStep2StructuredPayload(payload));
}
