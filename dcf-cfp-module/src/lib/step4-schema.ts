import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type {
  CapabilityPenetrationPath,
  CapitalAllocationData,
  Step4ReviewState,
  Step4WorkflowStatus,
} from "../types/cfp.ts";

/** Truncates to maxLen instead of hard-failing — same pattern as step2-bank-schema.ts */
const boundedStr = (maxLen: number) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    if (v.trim() === "") return v;
    return v.length > maxLen ? v.slice(0, maxLen) : v;
  }, z.string().min(1).max(maxLen));

const EvidenceLevelSchema = z.enum([
  "DISCLOSED",
  "STRONG_INFERENCE",
  "WEAK_INFERENCE",
  "UNSUPPORTED",
]);

const SourceQualitySchema = z.enum([
  "official_filing",
  "company_release",
  "earnings_transcript",
  "market_research",
  "news",
  "uploaded_file",
  "text_notes",
  "derived",
  "not_available",
]);

const SourceSchema = z.object({
  source_id: z.string().min(1),
  source_type: SourceQualitySchema,
  name: z.string().min(1),
  url: z.string().min(1).nullable(),
  locator: z.string().min(1).nullable(),
  excerpt: z.string().min(1).transform((value) => value.slice(0, 260)).nullable(),
});

const ClaimSchema = z.object({
  claim_id: z.string().min(1),
  text: boundedStr(300),
  source_ids: z.array(z.string().min(1)).min(1),
  evidence_level: EvidenceLevelSchema,
  source_snippet: z.string().min(1).transform((value) => value.slice(0, 220)).nullable(),
});

const FinancialSignalSchema = z.object({
  type: z.enum([
    "Revenue Enablement",
    "Margin Expansion",
    "CAC Reduction",
    "Cost Displacement",
    "product-only",
  ]),
  evidence: boundedStr(320),
  status: z.enum(["financially-material", "product-only"]),
  claim_id: z.string().min(1),
  source_ids: z.array(z.string().min(1)).min(1),
});

const FlywheelSchema = z.object({
  is_flywheel: z.boolean(),
  loop_description: boundedStr(260),
});

export const Step4SynergySchema = z.object({
  synergy_id: z.string().min(1),
  source_business: z.string().min(1),
  core_capability: boundedStr(180),
  recipient_business: z.string().min(1),
  mechanism: boundedStr(360),
  product_impact: boundedStr(360),
  competitor_constraint: boundedStr(360),
  financial_signal: FinancialSignalSchema,
  flywheel: FlywheelSchema,
  integration_verdict: z.enum(["PROVEN", "PARTIAL", "NOT_PROVEN"]),
  differentiation_verdict: z.enum(["PROVEN", "PARTIAL", "NOT_PROVEN", "SKIPPED_LIGHT_MODE"]),
  causality_verdict: z.enum(["PROVEN", "PARTIAL", "NOT_PROVEN"]),
  classification: z.enum([
    "fully_verified_synergy",
    "integration_only",
    "context_only",
    "unsupported",
  ]),
  driver_eligibility: z.enum(["FULL", "CAPPED_3PP", "CAPPED_2PP", "CONTEXT_ONLY", "NOT_ALLOWED"]),
  basis_claim_ids: z.array(z.string().min(1)).min(1),
  financial_metric_link: boundedStr(220),
  impact_score: z.number().int().min(-5).max(5),
  human_review_required: z.boolean(),
  review_rationale: boundedStr(360),
});

const CapitalMetricSchema = z.object({
  metric_id: z.string().min(1),
  pillar: boundedStr(160),
  objective: boundedStr(320),
  capital_intensity: z.enum(["Low", "Medium", "High", "Unknown"]),
  strategic_leverage: boundedStr(320),
  synergy_link: z.string().min(1),
  efficiency_score: z.number().int().min(-5).max(5),
  claim_id: z.string().min(1),
  source_ids: z.array(z.string().min(1)).min(1),
  review_note: boundedStr(320),
});

const CapitalAllocationSchema = z.object({
  capital_metrics: z.array(CapitalMetricSchema),
  feasibility_checkpoints: z.object({
    capex_runway: boundedStr(320),
    scale_economics: boundedStr(320),
    guidance_alignment: boundedStr(320),
  }),
  step5_revenue_ceiling: z.object({
    applies: z.boolean(),
    reason: boundedStr(320),
    ceiling_revenue_usd_m: z.number().nullable(),
  }),
  asset_light_exemption: z.boolean(),
  workflow_status: z.enum(["READY", "NEEDS_REVIEW", "BLOCKED"]),
  next_action: z.enum(["PROCEED_STEP5", "HUMAN_REVIEW_CAPITAL_CONSTRAINT", "REGENERATE"]),
});

const ValidationWarningSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warn", "high"]),
  message: boundedStr(260),
  synergy_ids: z.array(z.string().min(1)).default([]),
  capital_metric_ids: z.array(z.string().min(1)).default([]),
});

export const Step4StructuredSchema = z
  .object({
    schema_version: z.literal("v5.5"),
    company_name: z.string().min(1),
    review_summary: z.object({
      one_line: boundedStr(260),
      highlights: z.array(boundedStr(220)).default([]),
      warnings: z.array(boundedStr(220)).default([]),
    }),
    sources: z.array(SourceSchema),
    claims: z.array(ClaimSchema),
    synergy_registry: z.array(Step4SynergySchema),
    capital_allocation: CapitalAllocationSchema,
    validation_warnings: z.array(ValidationWarningSchema).default([]),
  })
  .superRefine((payload, ctx) => {
    const sourceIds = new Set(payload.sources.map((source) => source.source_id));
    const claimIds = new Set(payload.claims.map((claim) => claim.claim_id));
    const synergyIds = new Set(payload.synergy_registry.map((synergy) => synergy.synergy_id));
    const capitalMetricIds = new Set(
      payload.capital_allocation.capital_metrics.map((metric) => metric.metric_id),
    );

    const ensureSourceIdsExist = (ids: string[], path: (string | number)[]) => {
      ids.forEach((sourceId, sourceIndex) => {
        if (!sourceIds.has(sourceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, sourceIndex],
            message: `Unknown source_id "${sourceId}"`,
          });
        }
      });
    };

    const ensureClaimIdsExist = (ids: string[], path: (string | number)[]) => {
      ids.forEach((claimId, claimIndex) => {
        if (!claimIds.has(claimId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, claimIndex],
            message: `Unknown claim_id "${claimId}"`,
          });
        }
      });
    };

    payload.claims.forEach((claim, claimIndex) => {
      ensureSourceIdsExist(claim.source_ids, ["claims", claimIndex, "source_ids"]);
    });

    payload.synergy_registry.forEach((synergy, synergyIndex) => {
      ensureClaimIdsExist(synergy.basis_claim_ids, [
        "synergy_registry",
        synergyIndex,
        "basis_claim_ids",
      ]);
      ensureClaimIdsExist([synergy.financial_signal.claim_id], [
        "synergy_registry",
        synergyIndex,
        "financial_signal",
        "claim_id",
      ]);
      ensureSourceIdsExist(synergy.financial_signal.source_ids, [
        "synergy_registry",
        synergyIndex,
        "financial_signal",
        "source_ids",
      ]);
    });

    payload.capital_allocation.capital_metrics.forEach((metric, metricIndex) => {
      ensureClaimIdsExist([metric.claim_id], [
        "capital_allocation",
        "capital_metrics",
        metricIndex,
        "claim_id",
      ]);
      ensureSourceIdsExist(metric.source_ids, [
        "capital_allocation",
        "capital_metrics",
        metricIndex,
        "source_ids",
      ]);
      if (!synergyIds.has(metric.synergy_link)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capital_allocation", "capital_metrics", metricIndex, "synergy_link"],
          message: `Unknown synergy_id "${metric.synergy_link}"`,
        });
      }
    });

    payload.validation_warnings.forEach((warning, warningIndex) => {
      warning.synergy_ids.forEach((synergyId, synergyIndex) => {
        if (!synergyIds.has(synergyId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["validation_warnings", warningIndex, "synergy_ids", synergyIndex],
            message: `Unknown synergy_id "${synergyId}"`,
          });
        }
      });
      warning.capital_metric_ids.forEach((metricId, metricIndex) => {
        if (!capitalMetricIds.has(metricId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["validation_warnings", warningIndex, "capital_metric_ids", metricIndex],
            message: `Unknown metric_id "${metricId}"`,
          });
        }
      });
    });
  });

export type Step4StructuredResult = z.infer<typeof Step4StructuredSchema>;
export type Step4SynergyStructured = z.infer<typeof Step4SynergySchema>;
export type Step4CapitalMetricStructured = z.infer<typeof CapitalMetricSchema>;

const generatedSchema = zodToJsonSchema(Step4StructuredSchema, "Step4StructuredResult");

const generatedSynergySchema = zodToJsonSchema(Step4SynergySchema, "Step4SynergyStructured");
export const STEP4_SYNERGY_RESPONSE_SCHEMA =
  "definitions" in generatedSynergySchema && generatedSynergySchema.definitions
    ? generatedSynergySchema.definitions.Step4SynergyStructured
    : generatedSynergySchema;

const generatedCapitalMetricSchema = zodToJsonSchema(CapitalMetricSchema, "Step4CapitalMetricStructured");
export const STEP4_CAPITAL_METRIC_RESPONSE_SCHEMA =
  "definitions" in generatedCapitalMetricSchema && generatedCapitalMetricSchema.definitions
    ? generatedCapitalMetricSchema.definitions.Step4CapitalMetricStructured
    : generatedCapitalMetricSchema;

export const STEP4_RESPONSE_SCHEMA =
  "definitions" in generatedSchema && generatedSchema.definitions
    ? generatedSchema.definitions.Step4StructuredResult
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

  if (
    Array.isArray(record.anyOf) &&
    record.anyOf.some(
      (option) =>
        option &&
        typeof option === "object" &&
        (option as Record<string, unknown>).type === "null",
    )
  ) {
    sanitized.nullable = true;
  }

  if (Array.isArray(sanitized.required)) {
    sanitized.required = sanitized.required.filter((entry) => typeof entry === "string");
  }

  return sanitized;
}

export const GEMINI_STEP4_RESPONSE_SCHEMA = sanitizeSchemaForGemini(
  STEP4_RESPONSE_SCHEMA,
) as Record<string, unknown>;

export const GEMINI_STEP4_SYNERGY_RESPONSE_SCHEMA = sanitizeSchemaForGemini(
  STEP4_SYNERGY_RESPONSE_SCHEMA,
) as Record<string, unknown>;

export const GEMINI_STEP4_CAPITAL_METRIC_RESPONSE_SCHEMA = sanitizeSchemaForGemini(
  STEP4_CAPITAL_METRIC_RESPONSE_SCHEMA,
) as Record<string, unknown>;

function normalizeStep4StructuredPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  const normalizedWarnings: z.infer<typeof ValidationWarningSchema>[] = [];
  const synergies = Array.isArray(record.synergy_registry)
    ? record.synergy_registry.map((synergy) => {
        if (!synergy || typeof synergy !== "object" || Array.isArray(synergy)) {
          return synergy;
        }

        const synergyRecord = synergy as Record<string, unknown>;
        const financialSignal = synergyRecord.financial_signal ?? synergyRecord.financialSignal;
        const flywheel = synergyRecord.flywheel;
        const normalizedFlywheel =
          flywheel && typeof flywheel === "object" && !Array.isArray(flywheel)
            ? {
                ...(flywheel as Record<string, unknown>),
                is_flywheel:
                  (flywheel as Record<string, unknown>).is_flywheel ??
                  (flywheel as Record<string, unknown>).isFlywheel,
                loop_description:
                  (flywheel as Record<string, unknown>).loop_description ??
                  (flywheel as Record<string, unknown>).loopDescription,
              }
            : flywheel;

        return {
          ...synergyRecord,
          financial_signal: financialSignal,
          flywheel: normalizedFlywheel,
        };
      })
    : record.synergy_registry;
  const synergyIds = new Set(
    Array.isArray(synergies)
      ? synergies.flatMap((synergy) =>
          synergy &&
          typeof synergy === "object" &&
          !Array.isArray(synergy) &&
          typeof (synergy as Record<string, unknown>).synergy_id === "string"
            ? [(synergy as Record<string, unknown>).synergy_id as string]
            : [],
        )
      : [],
  );
  const capitalAllocation = record.capital_allocation ?? record.capitalAllocation;
  const normalizedCapitalAllocation =
    capitalAllocation && typeof capitalAllocation === "object" && !Array.isArray(capitalAllocation)
      ? normalizeCapitalAllocation(
          capitalAllocation as Record<string, unknown>,
          synergyIds,
          normalizedWarnings,
        )
      : capitalAllocation;
  const existingWarnings = normalizeValidationWarnings(record.validation_warnings, synergyIds);

  // ── Cross-reference healing ────────────────────────────────────────────────
  // The LLM often produces internally consistent JSON whose cross-references
  // (source_ids / claim_ids) don't perfectly match the top-level `sources` /
  // `claims` arrays — e.g. a synergy cites "src-apple-10k" but the sources
  // array has "source:apple:10k".  The superRefine in Step4StructuredSchema
  // hard-fails on any mismatch.  We auto-declare missing entries here so the
  // strict schema passes, and add validation_warnings so reviewers know.
  //
  // Also rewrites source_ids arrays that contain claim IDs (a common LLM error)
  // by expanding the claim to its actual source references.
  const { healedSources, healedClaims, healedCapAlloc, healedSynergies } = healCrossReferences(
    Array.isArray(record.sources) ? (record.sources as Record<string, unknown>[]) : [],
    Array.isArray(record.claims) ? (record.claims as Record<string, unknown>[]) : [],
    synergies,
    normalizedCapitalAllocation,
    normalizedWarnings,
  );

  return {
    ...record,
    schema_version: "v5.5",
    sources: healedSources,
    claims: healedClaims,
    synergy_registry: healedSynergies,
    capital_allocation: healedCapAlloc,
    validation_warnings: [...existingWarnings, ...normalizedWarnings],
  };
}

/**
 * Collect every source_id and claim_id referenced in the normalised synergies
 * and capital_allocation, then ensure each one is present in `sources` / `claims`.
 * Any that are absent get a synthetic placeholder entry and a validation warning.
 *
 * Special case — claim ID used as source ID:
 *   The LLM sometimes puts claim IDs (e.g. "claim_1") into a `source_ids` array
 *   that expects source document IDs.  When detected, the offending claim ID is
 *   expanded to the real source_ids that the claim itself cites — preserving the
 *   correct citation chain rather than creating a misleading synthetic source.
 *
 * This runs BEFORE Step4StructuredSchema.parse(), so the strict superRefine
 * cross-reference check always passes — even when the LLM was inconsistent.
 */
function healCrossReferences(
  rawSources: Record<string, unknown>[],
  rawClaims: Record<string, unknown>[],
  synergies: unknown,
  normalizedCapAlloc: unknown,
  warnings: z.infer<typeof ValidationWarningSchema>[],
): { healedSources: Record<string, unknown>[]; healedClaims: Record<string, unknown>[]; healedCapAlloc: unknown; healedSynergies: unknown } {
  const healedSources = [...rawSources];
  const healedClaims = [...rawClaims];

  const knownSourceIds = new Set(
    healedSources.flatMap((s) => (typeof s.source_id === "string" ? [s.source_id] : [])),
  );
  const knownClaimIds = new Set(
    healedClaims.flatMap((c) => (typeof c.claim_id === "string" ? [c.claim_id] : [])),
  );

  // Build claim_id → source_ids map so we can expand claim refs in source_ids arrays.
  const claimToSourceIds = new Map<string, string[]>();
  rawClaims.forEach((c) => {
    if (typeof c.claim_id === "string" && Array.isArray(c.source_ids)) {
      claimToSourceIds.set(
        c.claim_id,
        c.source_ids.filter((id): id is string => typeof id === "string"),
      );
    }
  });

  /**
   * Expand a source_ids array: replace any entry that is actually a claim_id
   * with the real source_ids that claim cites.  Entries that are neither a
   * known source_id nor a known claim_id are left as-is (they will be
   * auto-declared below).  De-duplicates the result.
   *
   * Returns { expanded, claimIdsFound } — claimIdsFound used for the warning.
   */
  function expandSourceIds(arr: unknown): { expanded: string[]; claimIdsFound: string[] } {
    if (!Array.isArray(arr)) return { expanded: [], claimIdsFound: [] };
    const result: string[] = [];
    const claimIdsFound: string[] = [];
    for (const entry of arr) {
      if (typeof entry !== "string") continue;
      if (knownClaimIds.has(entry)) {
        // This is a claim ID sitting where a source ID should be.
        // Expand it to the claim's actual source_ids.
        claimIdsFound.push(entry);
        const resolved = claimToSourceIds.get(entry) ?? [];
        result.push(...resolved);
      } else {
        result.push(entry);
      }
    }
    // De-duplicate while preserving order
    return { expanded: [...new Set(result)], claimIdsFound };
  }

  // ── Rewrite source_ids arrays that contain claim IDs ───────────────────────
  const allClaimIdsFoundInSourceArrays: string[] = [];

  // Rewrite capital metrics
  const capAlloc = normalizedCapAlloc as Record<string, unknown> | null | undefined;
  let healedCapAlloc: unknown = normalizedCapAlloc;
  if (capAlloc && Array.isArray(capAlloc.capital_metrics)) {
    let rewritten = false;
    const newMetrics = capAlloc.capital_metrics.map((m: unknown) => {
      if (!m || typeof m !== "object") return m;
      const mr = m as Record<string, unknown>;
      const { expanded, claimIdsFound } = expandSourceIds(mr.source_ids);
      if (claimIdsFound.length === 0) return m;
      rewritten = true;
      allClaimIdsFoundInSourceArrays.push(...claimIdsFound);
      return { ...mr, source_ids: expanded.length > 0 ? expanded : mr.source_ids };
    });
    if (rewritten) {
      healedCapAlloc = { ...capAlloc, capital_metrics: newMetrics };
    }
  }

  // Rewrite synergy financial_signal.source_ids
  let healedSynergies: unknown = synergies;
  if (Array.isArray(synergies)) {
    let rewritten = false;
    const newSynergies = synergies.map((s) => {
      if (!s || typeof s !== "object") return s;
      const sr = s as Record<string, unknown>;
      const fs = sr.financial_signal as Record<string, unknown> | undefined;
      if (!fs) return s;
      const { expanded, claimIdsFound } = expandSourceIds(fs.source_ids);
      if (claimIdsFound.length === 0) return s;
      rewritten = true;
      allClaimIdsFoundInSourceArrays.push(...claimIdsFound);
      return {
        ...sr,
        financial_signal: {
          ...fs,
          source_ids: expanded.length > 0 ? expanded : fs.source_ids,
        },
      };
    });
    if (rewritten) healedSynergies = newSynergies;
  }

  if (allClaimIdsFoundInSourceArrays.length > 0) {
    const unique = [...new Set(allClaimIdsFoundInSourceArrays)];
    warnings.push({
      code: "CLAIM_ID_USED_AS_SOURCE_REF",
      severity: "warn",
      message: `LLM placed claim ID(s) in source_ids arrays — expanded to actual source references: ${unique.slice(0, 4).join(", ")}`,
      synergy_ids: [],
      capital_metric_ids: [],
    });
  }

  // ── Collect all source_ids and claim_ids still referenced ─────────────────
  const referencedSourceIds = new Set<string>();
  const referencedClaimIds = new Set<string>();

  const addStr = (set: Set<string>, v: unknown) => {
    if (typeof v === "string" && v.length > 0) set.add(v);
  };
  const addArr = (set: Set<string>, arr: unknown) => {
    if (Array.isArray(arr)) arr.forEach((v) => addStr(set, v));
  };

  // From claims
  rawClaims.forEach((c) => addArr(referencedSourceIds, c.source_ids));
  // From synergies (use healedSynergies so expanded arrays are counted)
  if (Array.isArray(healedSynergies)) {
    healedSynergies.forEach((s) => {
      if (!s || typeof s !== "object") return;
      const sr = s as Record<string, unknown>;
      addArr(referencedClaimIds, sr.basis_claim_ids);
      const fs = sr.financial_signal as Record<string, unknown> | undefined;
      if (fs) {
        addStr(referencedClaimIds, fs.claim_id);
        addArr(referencedSourceIds, fs.source_ids);
      }
    });
  }
  // From capital metrics (use healedCapAlloc)
  const hcap = healedCapAlloc as Record<string, unknown> | null | undefined;
  if (hcap && Array.isArray(hcap.capital_metrics)) {
    hcap.capital_metrics.forEach((m: unknown) => {
      if (!m || typeof m !== "object") return;
      const mr = m as Record<string, unknown>;
      addStr(referencedClaimIds, mr.claim_id);
      addArr(referencedSourceIds, mr.source_ids);
    });
  }

  // ── Auto-declare any still-missing source_ids ──────────────────────────────
  const missingSources = [...referencedSourceIds].filter((id) => !knownSourceIds.has(id));
  if (missingSources.length > 0) {
    for (const id of missingSources) {
      healedSources.push({
        source_id: id,
        source_type: "derived",
        name: `[Auto-declared] ${id.slice(0, 80)}`,
        url: null,
        locator: null,
        excerpt: null,
      });
      knownSourceIds.add(id);
    }
    warnings.push({
      code: "UNDECLARED_SOURCE_REFS_HEALED",
      severity: "warn",
      message: `${missingSources.length} source reference(s) auto-declared (LLM omitted from sources array): ${missingSources.slice(0, 3).join(", ")}`,
      synergy_ids: [],
      capital_metric_ids: [],
    });
  }

  // ── Auto-declare missing claim_ids ─────────────────────────────────────────
  const missingClaims = [...referencedClaimIds].filter((id) => !knownClaimIds.has(id));
  if (missingClaims.length > 0) {
    // Pick the first known source_id as the fallback citation; create a
    // synthetic one if the sources array is somehow also empty.
    const fallbackSourceId = [...knownSourceIds][0] ?? "synthetic:no-source";
    if (!knownSourceIds.has(fallbackSourceId)) {
      healedSources.push({
        source_id: fallbackSourceId,
        source_type: "derived",
        name: "[Auto-declared] fallback source",
        url: null,
        locator: null,
        excerpt: null,
      });
      knownSourceIds.add(fallbackSourceId);
    }
    for (const id of missingClaims) {
      healedClaims.push({
        claim_id: id,
        text: `[Auto-declared] Undeclared claim reference: ${id.slice(0, 120)}`,
        source_ids: [fallbackSourceId],
        evidence_level: "UNSUPPORTED",
        source_snippet: null,
      });
    }
    warnings.push({
      code: "UNDECLARED_CLAIM_REFS_HEALED",
      severity: "warn",
      message: `${missingClaims.length} claim reference(s) auto-declared (LLM omitted from claims array): ${missingClaims.slice(0, 3).join(", ")}`,
      synergy_ids: [],
      capital_metric_ids: [],
    });
  }

  return { healedSources, healedClaims, healedCapAlloc, healedSynergies };
}

function normalizeCapitalAllocation(
  capitalAllocation: Record<string, unknown>,
  synergyIds: Set<string>,
  normalizedWarnings: z.infer<typeof ValidationWarningSchema>[],
): Record<string, unknown> {
  const rawMetrics = capitalAllocation.capital_metrics ?? capitalAllocation.capitalMetrics;
  const capitalMetrics = Array.isArray(rawMetrics)
    ? rawMetrics.map((metric) => {
        if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
          return metric;
        }

        const metricRecord = metric as Record<string, unknown>;
        const rawLink = metricRecord.synergy_link ?? metricRecord.synergyLink;
        const normalizedLink = normalizeSynergyLink(rawLink, synergyIds);
        if (
          typeof rawLink === "string" &&
          typeof normalizedLink === "string" &&
          normalizedLink !== rawLink
        ) {
          const metricId =
            typeof metricRecord.metric_id === "string" ? metricRecord.metric_id : undefined;
          normalizedWarnings.push({
            code: "CAPITAL_SYNERGY_LINK_NORMALIZED",
            severity: "warn",
            message: `Capital metric ${metricId ?? "unknown"} linked multiple or non-canonical synergies; defaulted to ${normalizedLink} for human review.`,
            synergy_ids: [normalizedLink],
            capital_metric_ids: metricId ? [metricId] : [],
          });
        }

        return {
          ...metricRecord,
          synergy_link: normalizedLink ?? rawLink,
        };
      })
    : rawMetrics;

  return {
    ...capitalAllocation,
    capital_metrics: capitalMetrics,
    workflow_status:
      normalizedWarnings.some((warning) => warning.code === "CAPITAL_SYNERGY_LINK_NORMALIZED")
        ? "NEEDS_REVIEW"
        : capitalAllocation.workflow_status ?? capitalAllocation.workflowStatus,
    next_action:
      normalizedWarnings.some((warning) => warning.code === "CAPITAL_SYNERGY_LINK_NORMALIZED")
        ? "HUMAN_REVIEW_CAPITAL_CONSTRAINT"
        : capitalAllocation.next_action ?? capitalAllocation.nextAction,
  };
}

function normalizeSynergyLink(rawLink: unknown, synergyIds: Set<string>): string | unknown {
  if (typeof rawLink !== "string") return rawLink;
  if (synergyIds.has(rawLink)) return rawLink;

  const candidates = rawLink
    .split(/[,\n;|]+|\s+and\s+/i)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const directCandidate = candidates.find((candidate) => synergyIds.has(candidate));
  if (directCandidate) return directCandidate;

  const embeddedCandidate = Array.from(synergyIds).find((synergyId) =>
    rawLink.includes(synergyId),
  );
  return embeddedCandidate ?? rawLink;
}

function normalizeValidationWarnings(
  rawWarnings: unknown,
  synergyIds: Set<string>,
): z.infer<typeof ValidationWarningSchema>[] {
  if (!Array.isArray(rawWarnings)) return [];

  return rawWarnings.map((warning) => {
    if (!warning || typeof warning !== "object" || Array.isArray(warning)) {
      return warning;
    }

    const warningRecord = warning as Record<string, unknown>;
    const warningSynergyIds = Array.isArray(warningRecord.synergy_ids)
      ? warningRecord.synergy_ids
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => normalizeSynergyLink(entry, synergyIds))
          .filter((entry): entry is string => typeof entry === "string" && synergyIds.has(entry))
      : [];

    return {
      ...warningRecord,
      synergy_ids: Array.from(new Set(warningSynergyIds)),
    };
  }).filter((warning): warning is z.infer<typeof ValidationWarningSchema> =>
    !!warning && typeof warning === "object" && !Array.isArray(warning),
  );
}

export function parseStep4StructuredResult(payload: unknown): Step4StructuredResult {
  return Step4StructuredSchema.parse(normalizeStep4StructuredPayload(payload));
}

export function parseStep4Synergy(payload: unknown): Step4SynergyStructured {
  return Step4SynergySchema.parse(payload);
}

export function parseStep4CapitalMetric(payload: unknown): Step4CapitalMetricStructured {
  return CapitalMetricSchema.parse(payload);
}

function classificationForPath(
  synergy: Step4StructuredResult["synergy_registry"][number],
): CapabilityPenetrationPath["synergyClassification"] {
  if (synergy.classification === "fully_verified_synergy") return "Material Synergy";
  if (synergy.classification === "unsupported") return "Disputed";
  if (synergy.driver_eligibility === "NOT_ALLOWED") return "Disputed";
  if (synergy.driver_eligibility === "CONTEXT_ONLY") return "Adjacent Revenue";
  return "Material Synergy";
}

export function projectStep4SynergyToPath(
  synergy: Step4StructuredResult["synergy_registry"][number],
): CapabilityPenetrationPath {
  return {
    sourceBusiness: synergy.source_business,
    coreCapability: synergy.core_capability,
    recipientBusiness: synergy.recipient_business,
    mechanism: synergy.mechanism,
    productImpact: synergy.product_impact,
    competitorConstraint: synergy.competitor_constraint,
    financialSignal: {
      type: synergy.financial_signal.type,
      evidence: synergy.financial_signal.evidence,
      status: synergy.financial_signal.status,
    },
    flywheel: {
      isFlywheel: synergy.flywheel.is_flywheel,
      loopDescription: synergy.flywheel.loop_description,
    },
    impactScore: synergy.impact_score,
    synergyClassification: classificationForPath(synergy),
    reviewRationale: synergy.review_rationale,
    driverEligibility: synergy.driver_eligibility,
  };
}

export function projectStep4StructuredToPaths(
  result: Step4StructuredResult,
): CapabilityPenetrationPath[] {
  return result.synergy_registry.map((synergy) => projectStep4SynergyToPath(synergy));
}

export function projectStep4StructuredToCapital(
  result: Step4StructuredResult,
): CapitalAllocationData {
  return {
    investmentMatrix: result.capital_allocation.capital_metrics.map((metric) => ({
      pillar: metric.pillar,
      objective: metric.objective,
      capitalIntensity: metric.capital_intensity,
      strategicLeverage: metric.strategic_leverage,
      synergyLink: metric.synergy_link,
      efficiencyScore: metric.efficiency_score,
    })),
    checkpoints: {
      capexRunway: result.capital_allocation.feasibility_checkpoints.capex_runway,
      scaleEconomics: result.capital_allocation.feasibility_checkpoints.scale_economics,
      guidanceAlignment: result.capital_allocation.feasibility_checkpoints.guidance_alignment,
    },
  };
}

const HARD_STOP_CODES_S4 = new Set(["UNSUPPORTED_SYNERGY_FORECASTABLE", "CAPITAL_BLOCKED"]);

function deriveStep4WorkflowStatus(result: Step4StructuredResult): Step4WorkflowStatus {
  const hasHardStop =
    result.validation_warnings.some(
      (w) => w.severity === "high" && HARD_STOP_CODES_S4.has(w.code),
    ) || result.capital_allocation.workflow_status === "BLOCKED";
  if (hasHardStop) return "blocked";

  const needsReview =
    result.synergy_registry.some((synergy) => synergy.human_review_required) ||
    result.capital_allocation.workflow_status === "NEEDS_REVIEW" ||
    result.validation_warnings.some((warning) => warning.severity === "high");

  return needsReview ? "needs_review" : "can_continue";
}

export function buildStep4ReviewState(result: Step4StructuredResult): Step4ReviewState {
  const sourceById = new Map(result.sources.map((source) => [source.source_id, source]));

  return {
    workflowStatus: deriveStep4WorkflowStatus(result),
    approved: false,
    approvedAt: null,
    summary: {
      oneLine: result.review_summary.one_line,
      highlights: result.review_summary.highlights,
      warnings: result.review_summary.warnings,
    },
    synergies: result.synergy_registry.map((synergy) => ({
      id: synergy.synergy_id,
      sourceBusiness: synergy.source_business,
      recipientBusiness: synergy.recipient_business,
      integrationVerdict: synergy.integration_verdict,
      differentiationVerdict: synergy.differentiation_verdict,
      causalityVerdict: synergy.causality_verdict,
      classification: synergy.classification,
      driverEligibility: synergy.driver_eligibility,
      humanReviewRequired: synergy.human_review_required,
      basisClaimIds: synergy.basis_claim_ids,
      sourceIds: synergy.financial_signal.source_ids,
      sources: synergy.financial_signal.source_ids
        .map((sourceId) => sourceById.get(sourceId))
        .filter((source): source is Step4StructuredResult["sources"][number] => Boolean(source)),
      editable: {
        mechanism: synergy.mechanism,
        productImpact: synergy.product_impact,
        competitorConstraint: synergy.competitor_constraint,
        financialMetricLink: synergy.financial_metric_link,
        reviewRationale: synergy.review_rationale,
      },
    })),
    capitalMetrics: result.capital_allocation.capital_metrics.map((metric) => ({
      id: metric.metric_id,
      pillar: metric.pillar,
      capitalIntensity: metric.capital_intensity,
      synergyLink: metric.synergy_link,
      claimId: metric.claim_id,
      sourceIds: metric.source_ids,
      sources: metric.source_ids
        .map((sourceId) => sourceById.get(sourceId))
        .filter((source): source is Step4StructuredResult["sources"][number] => Boolean(source)),
      reviewNote: metric.review_note,
      editable: {
        objective: metric.objective,
        strategicLeverage: metric.strategic_leverage,
      },
    })),
    capitalAllocation: {
      assetLightExemption: result.capital_allocation.asset_light_exemption,
      workflowStatus: result.capital_allocation.workflow_status,
      nextAction: result.capital_allocation.next_action,
      step5RevenueCeiling: result.capital_allocation.step5_revenue_ceiling,
    },
    validationWarnings: result.validation_warnings.map((warning) => ({
      code: warning.code,
      severity: warning.severity,
      message: warning.message,
      synergyIds: warning.synergy_ids,
      capitalMetricIds: warning.capital_metric_ids,
    })),
  };
}
