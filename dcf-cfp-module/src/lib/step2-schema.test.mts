import test from "node:test";
import assert from "node:assert/strict";

import {
  GEMINI_STEP2_RESPONSE_SCHEMA,
  STEP2_RESPONSE_SCHEMA,
  Step2StructuredSchema,
  parseStep2StructuredResult,
  projectStep2StructuredToRows,
} from "./step2-schema.ts";

const validPayload = {
  schema_version: "v5.5",
  company_name: "Apple Inc.",
  target_year: 2025,
  rows: [
    {
      row_id: "row:2025:q1:products",
      fiscal_year: 2025,
      quarter: "Q1",
      segment: "Products",
      product_category: "Products",
      product_name: "Products",
      revenue_usd_m: 96200,
      operating_income_usd_m: null,
      mapped_from_step1_ids: ["segment:products"],
      source_id: "source:file:apple-q1",
      evidence_level: "DISCLOSED",
      validation_status: "verified_source",
      review_note: "Revenue is directly provided in uploaded source; operating income not disclosed.",
    },
  ],
  sources: [
    {
      source_id: "source:file:apple-q1",
      source_type: "uploaded_file",
      name: "apple-q1.csv",
      locator: "Sheet1 rows 2-4",
      excerpt: "Products, Q1 2025, 96200",
    },
  ],
  excluded_items: [
    {
      label: "Americas geography",
      reason: "Geographic line, not a Step 1 canonical analysis segment.",
      source_id: "source:file:apple-q1",
      evidence_level: "DISCLOSED",
    },
  ],
  validation_warnings: [
    {
      code: "MISSING_OPERATING_INCOME",
      severity: "warn",
      message: "Operating income is not provided for Products.",
      row_ids: ["row:2025:q1:products"],
    },
  ],
  review_summary: {
    one_line: "1 verified revenue row, 1 excluded item, operating income requires review.",
    highlights: ["Products revenue mapped to Step 1 canonical segment."],
    warnings: ["Operating income is missing."],
  },
};

test("parses valid Step 2 structured historical financials and projects legacy rows", () => {
  const parsed = Step2StructuredSchema.parse(validPayload);
  const rows = projectStep2StructuredToRows(parsed);

  assert.equal(parsed.schema_version, "v5.5");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fiscalYear, 2025);
  assert.equal(rows[0].quarter, "Q1");
  assert.equal(rows[0].segment, "Products");
  assert.equal(rows[0].revenue, 96200);
  assert.equal(rows[0].operatingIncome, null);
  assert.equal(rows[0].reviewStatus, "Review Access Data");
  assert.equal(rows[0].internalVerify, "Yes");
});

test("rejects rows without Step 1 mapping provenance", () => {
  const payload = structuredClone(validPayload);
  payload.rows[0].mapped_from_step1_ids = [];

  assert.throws(() => Step2StructuredSchema.parse(payload));
});

test("rejects rows whose source_id is not declared in sources", () => {
  const payload = structuredClone(validPayload);
  payload.rows[0].source_id = "source:missing";

  assert.throws(() => Step2StructuredSchema.parse(payload));
});

test("normalizes legacy model schema_version values during API parsing", () => {
  const payload = structuredClone(validPayload);
  payload.schema_version = "2.0";

  const parsed = parseStep2StructuredResult(payload);

  assert.equal(parsed.schema_version, "v5.5");
  assert.equal(parsed.target_year, 2025);
});

test("exports a response schema object for LLM structured output", () => {
  assert.equal(typeof STEP2_RESPONSE_SCHEMA, "object");
  assert.equal((STEP2_RESPONSE_SCHEMA as Record<string, unknown>).type, "object");
});

test("exports a Gemini-safe response schema without unsupported JSON Schema keywords", () => {
  const serialized = JSON.stringify(GEMINI_STEP2_RESPONSE_SCHEMA);
  const schema = GEMINI_STEP2_RESPONSE_SCHEMA as any;
  const rowProperties = schema.properties?.rows?.items?.properties;

  assert.equal(serialized.includes("\"$ref\""), false);
  assert.equal(serialized.includes("\"const\""), false);
  assert.equal(serialized.includes("\"additionalProperties\""), false);
  assert.equal(serialized.includes("\"type\":[\"number\",\"null\"]"), false);
  assert.equal(serialized.includes("\"type\":[\"string\",\"null\"]"), false);
  assert.equal(rowProperties?.revenue_usd_m?.type, "number");
  assert.equal(rowProperties?.revenue_usd_m?.nullable, true);
  assert.equal(rowProperties?.operating_income_usd_m?.type, "number");
  assert.equal(rowProperties?.operating_income_usd_m?.nullable, true);
});

test("auto-repairs dangling row_id references in validation_warnings", () => {
  // Simulates the real failure mode: model emits a warning pointing at a
  // row_id that doesn't appear in rows[] (renamed, moved to excluded_items,
  // or hallucinated). The schema's superRefine would reject this; the
  // normalize step should drop the bad pointers and append a meta-warning.
  const payload = structuredClone(validPayload);
  payload.validation_warnings = [
    {
      code: "SEGMENT_DISCLOSURE_GAP",
      severity: "warn",
      message: "Enablement segment Q1 2022 figure could not be cross-verified.",
      // First id matches a real row, second is dangling (the SoFi-style case).
      row_ids: ["row:2025:q1:products", "sofi_2022_q1_enablement"],
    },
  ];

  const parsed = parseStep2StructuredResult(payload);

  // Original warning survives with the dangling pointer stripped.
  assert.equal(parsed.validation_warnings.length, 2);
  assert.deepEqual(parsed.validation_warnings[0].row_ids, ["row:2025:q1:products"]);
  assert.equal(parsed.validation_warnings[0].code, "SEGMENT_DISCLOSURE_GAP");

  // Meta-warning appended explaining the repair.
  const meta = parsed.validation_warnings[1];
  assert.equal(meta.code, "validation_warning_unknown_row_ids");
  assert.equal(meta.severity, "info");
  assert.match(meta.message, /Auto-repair/);
  assert.match(meta.message, /SEGMENT_DISCLOSURE_GAP/);
  assert.deepEqual(meta.row_ids, []);
});

test("does not append a meta-warning when all row_id references resolve", () => {
  // Regression guard: the happy path must not gain a spurious info warning.
  const parsed = parseStep2StructuredResult(structuredClone(validPayload));
  assert.equal(parsed.validation_warnings.length, 1);
  assert.equal(parsed.validation_warnings[0].code, "MISSING_OPERATING_INCOME");
});

// =============================================================================
// Reduce-phase sources[].excerpt auto-truncation (Issue #2 from preview logs)
// =============================================================================
// Symptom: Step 2 reduce parse failed with
//   { "code": "too_big", "maximum": 200, "path": ["sources", 0, "excerpt"] }
// when the model returned a slightly-too-long excerpt in the source manifest.
// All three Step 2 schemas should now clip the excerpt rather than reject.

test("default Step 2 schema truncates over-length sources[].excerpt instead of failing", () => {
  const payload = structuredClone(validPayload);
  payload.sources[0].excerpt = "x".repeat(260); // 40 chars over the 220 cap

  const parsed = parseStep2StructuredResult(payload);

  assert.equal(parsed.sources[0].excerpt?.length, 220, "truncated to the 220-char cap");
  assert.equal(parsed.sources[0].source_id, payload.sources[0].source_id, "other fields preserved");
});

test("default Step 2 schema still accepts null and short excerpts unchanged", () => {
  const payload = structuredClone(validPayload);
  payload.sources[0].excerpt = "short snippet";
  let parsed = parseStep2StructuredResult(payload);
  assert.equal(parsed.sources[0].excerpt, "short snippet");

  // nullable case
  const payload2 = structuredClone(validPayload) as Omit<typeof validPayload, "sources"> & {
    sources: Array<
      Omit<(typeof validPayload)["sources"][number], "excerpt"> & { excerpt: string | null }
    >;
  };
  payload2.sources[0].excerpt = null;
  parsed = parseStep2StructuredResult(payload2);
  assert.equal(parsed.sources[0].excerpt, null);
});

test("industrial Step 2 schema truncates over-length sources[].excerpt instead of failing", async () => {
  // Direct import — the industrial schema isn't covered by the default test
  // payload above. We construct a minimal industrial payload that satisfies
  // the schema except for the over-length excerpt.
  const { parseStep2IndustrialStructuredResult } = await import("./step2-industrial-schema.ts");

  const industrialPayload = {
    schema_version: "v5.5" as const,
    workflow: "industrial" as const,
    company_name: "TestCo",
    target_year: 2025,
    rows: [
      {
        row_id: "row:2025:q1:seg",
        fiscal_year: 2025,
        quarter: "Q1" as const,
        segment: "Industrial",
        revenue_usd_m: 100,
        operating_income_usd_m: 20,
        gross_profit_usd_m: null,
        capex_usd_m: null,
        depreciation_amortization_usd_m: null,
        headcount: null,
        mapped_from_step1_ids: ["segment:industrial"],
        source_id: "source:1",
        evidence_level: "DISCLOSED" as const,
        validation_status: "verified_source" as const,
        review_note: "fine",
      },
    ],
    sources: [
      {
        source_id: "source:1",
        source_type: "uploaded_file" as const,
        name: "10K-2025.pdf",
        locator: "Item 7 page 32",
        excerpt: "y".repeat(260), // 60 chars over the 200 cap
      },
    ],
    excluded_items: [],
    validation_warnings: [],
    review_summary: {
      one_line: "ok",
      highlights: [],
      warnings: [],
    },
    capex_mda_split: null,
  };

  const parsed = parseStep2IndustrialStructuredResult(industrialPayload);

  assert.equal(parsed.sources[0].excerpt?.length, 200, "truncated to the 200-char cap");
});

test("bank Step 2 schema already truncated over-length excerpts (regression guard)", async () => {
  // Bank's nullableStr helper has always truncated; this test locks in that
  // behaviour so a future helper refactor can't silently regress it.
  const { parseStep2BankStructuredResult } = await import("./step2-bank-schema.ts");

  const bankPayload = {
    schema_version: "v5.5" as const,
    workflow: "bank" as const,
    company_name: "TestBank",
    target_year: 2025,
    rows: [
      {
        row_id: "row:2025:q1:lending",
        fiscal_year: 2025,
        quarter: "Q1" as const,
        segment: "Lending",
        nii_usd_m: 100,
        non_interest_income_usd_m: null,
        provision_for_credit_losses_usd_m: null,
        net_income_usd_m: 50,
        book_value_equity_usd_m: null,
        goodwill_usd_m: null,
        intangible_assets_usd_m: null,
        preferred_equity_usd_m: null,
        total_rwa_usd_m: null,
        tier1_capital_ratio_pct: null,
        cet1_ratio_pct: null,
        net_interest_margin_pct: null,
        efficiency_ratio_pct: null,
        return_on_avg_equity_pct: null,
        total_assets_usd_m: null,
        // Liquidity fields (required by schema but nullable)
        total_loans_usd_m: null,
        total_deposits_usd_m: null,
        retail_insured_deposits_usd_m: null,
        wholesale_uninsured_deposits_usd_m: null,
        cash_and_hqla_usd_m: null,
        htm_bonds_usd_m: null,
        unrealized_losses_htm_usd_m: null,
        mapped_from_step1_ids: ["seg:lending"],
        source_id: "source:1",
        evidence_level: "DISCLOSED" as const,
        validation_status: "verified_source" as const,
        review_note: "fine",
      },
    ],
    sources: [
      {
        source_id: "source:1",
        source_type: "uploaded_file" as const,
        name: "10K-2025.pdf",
        locator: "Item 7",
        excerpt: "z".repeat(260), // 40 chars over the 220 cap
      },
    ],
    excluded_items: [],
    validation_warnings: [],
    review_summary: {
      one_line: "ok",
      highlights: [],
      warnings: [],
    },
  };

  const parsed = parseStep2BankStructuredResult(bankPayload);

  assert.equal(parsed.sources[0].excerpt?.length, 220, "truncated to the 220-char cap");
});

test("preserves missing structured metrics as null instead of real zeroes", () => {
  const payload = structuredClone(validPayload) as Omit<typeof validPayload, "rows"> & {
    rows: Array<
      Omit<
        (typeof validPayload)["rows"][number],
        "revenue_usd_m" | "operating_income_usd_m"
      > & {
        revenue_usd_m: number | null;
        operating_income_usd_m: number | null;
      }
    >;
  };
  payload.rows[0].revenue_usd_m = null;
  payload.rows[0].operating_income_usd_m = 123;

  const parsed = Step2StructuredSchema.parse(payload);
  const rows = projectStep2StructuredToRows(parsed);

  assert.equal(rows[0].revenue, null);
  assert.match(rows[0].reviewNote ?? "", /Missing revenue/);
});
