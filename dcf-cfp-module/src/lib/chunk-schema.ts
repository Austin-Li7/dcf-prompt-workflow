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
  source_excerpt: z.string().max(160),
  confidence: z.enum(["high", "medium", "low"]),
});

export const ChunkSummarySchema = z.object({
  /** Echoed back from the request so the Reduce phase can track provenance. */
  chunk_id: z.string(),
  rows: z.array(ChunkRowSchema),
  /** Any data quality issues noticed in this chunk. */
  anomalies: z.array(z.string().max(200)).default([]),
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
        const nonNull = (v as unknown[])
          .filter(
            (o) =>
              !(
                o &&
                typeof o === "object" &&
                (o as Record<string, unknown>).type === "null"
              ),
          )
          .map(sanitizeForGemini);
        if (nonNull.length === 1)
          return ["type", (nonNull[0] as Record<string, unknown>).type ?? "string"] as const;
        return [k, nonNull] as const;
      }
      return [k, sanitizeForGemini(v)] as const;
    });
  const out = Object.fromEntries(entries) as Record<string, unknown>;
  if (Array.isArray(rec.type) && (rec.type as string[]).includes("null")) out.nullable = true;
  if (Array.isArray(out.required))
    out.required = (out.required as unknown[]).filter((e) => typeof e === "string");
  return out;
}

export const GEMINI_CHUNK_SUMMARY_SCHEMA = sanitizeForGemini(
  CHUNK_SUMMARY_SCHEMA,
) as Record<string, unknown>;
