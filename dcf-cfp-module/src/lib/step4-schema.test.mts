import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GEMINI_STEP4_RESPONSE_SCHEMA,
  STEP4_RESPONSE_SCHEMA,
  Step4StructuredSchema,
  buildStep4ReviewState,
  parseStep4StructuredResult,
  projectStep4StructuredToCapital,
  projectStep4StructuredToPaths,
} from "./step4-schema.ts";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../test/fixtures/step4/apple/apple-step4-synergies-capital-v55.json", import.meta.url),
    "utf8",
  ),
);

test("parses Step 4 v5.5 synergy and capital output and projects legacy UI data", () => {
  const parsed = Step4StructuredSchema.parse(fixture);
  const paths = projectStep4StructuredToPaths(parsed);
  const capital = projectStep4StructuredToCapital(parsed);

  assert.equal(parsed.schema_version, "v5.5");
  assert.equal(parsed.synergy_registry.length, 1);
  assert.equal(paths[0].sourceBusiness, "iPhone");
  assert.equal(paths[0].synergyClassification, "Material Synergy");
  assert.equal(paths[0].financialSignal.type, "Revenue Enablement");
  assert.equal(capital.investmentMatrix[0].pillar, "Core infrastructure");
  assert.equal(capital.checkpoints.capexRunway.includes("Normal"), true);
});

test("builds Step 4 review state with summary, source grounding, and editable entries", () => {
  const parsed = parseStep4StructuredResult(fixture);
  const review = buildStep4ReviewState(parsed);

  assert.equal(review.workflowStatus, "needs_review");
  assert.equal(review.summary.warnings.length, 1);
  assert.equal(review.synergies[0].humanReviewRequired, true);
  assert.equal(review.synergies[0].sources.length, 1);
  assert.equal(review.synergies[0].editable.mechanism.includes("Device ownership"), true);
  assert.equal(review.capitalMetrics[0].sources[0].source_id, "source:apple:10k:cashflow");
  assert.equal(review.capitalAllocation.assetLightExemption, true);
  assert.equal(review.validationWarnings[0].synergyIds[0], "synergy:iphone-services");
});

test("rejects synergies whose source_ids are not declared", () => {
  const payload = structuredClone(fixture);
  payload.synergy_registry[0].financial_signal.source_ids = ["source:missing"];

  assert.throws(() => Step4StructuredSchema.parse(payload));
});

test("rejects capital metrics whose claim_id is not declared", () => {
  const payload = structuredClone(fixture);
  payload.capital_allocation.capital_metrics[0].claim_id = "S4-MISSING";

  assert.throws(() => Step4StructuredSchema.parse(payload));
});

test("normalizes legacy model schema_version values and camelCase keys during API parsing", () => {
  const payload = structuredClone(fixture);
  payload.schema_version = "4.0";
  payload.synergy_registry[0].financialSignal = payload.synergy_registry[0].financial_signal;
  payload.synergy_registry[0].flywheel = {
    isFlywheel: payload.synergy_registry[0].flywheel.is_flywheel,
    loopDescription: payload.synergy_registry[0].flywheel.loop_description,
  };
  delete payload.synergy_registry[0].financial_signal;

  const parsed = parseStep4StructuredResult(payload);

  assert.equal(parsed.schema_version, "v5.5");
  assert.equal(parsed.synergy_registry[0].financial_signal.claim_id, "S4-C1");
  assert.equal(parsed.synergy_registry[0].flywheel.is_flywheel, true);
});

test("compacts verbose claim source snippets at the Step 4 schema boundary", () => {
  const payload = structuredClone(fixture);
  payload.claims[0].source_snippet = "A".repeat(360);

  const parsed = parseStep4StructuredResult(payload);

  assert.equal(parsed.claims[0].source_snippet?.length, 220);
});

test("parseStep4StructuredResult heals synergies with undeclared source_ids instead of throwing", () => {
  // Simulates the most common Step 4 error: LLM writes a source_id in a synergy
  // that it never added to the top-level sources array.
  const payload = structuredClone(fixture);
  payload.synergy_registry[0].financial_signal.source_ids = ["source:undeclared-ref"];

  // parseStep4StructuredResult (via normalizeStep4StructuredPayload) should heal it
  const parsed = parseStep4StructuredResult(payload);

  // The undeclared source_id should now exist in the sources array
  assert.ok(
    parsed.sources.some((s) => s.source_id === "source:undeclared-ref"),
    "auto-declared source should appear in sources array",
  );
  // A validation warning should be present
  assert.ok(
    parsed.validation_warnings.some((w) => w.code === "UNDECLARED_SOURCE_REFS_HEALED"),
    "should add UNDECLARED_SOURCE_REFS_HEALED warning",
  );
});

test("parseStep4StructuredResult heals synergies with undeclared claim_ids instead of throwing", () => {
  const payload = structuredClone(fixture);
  payload.synergy_registry[0].basis_claim_ids = ["S4-MISSING-CLAIM"];

  const parsed = parseStep4StructuredResult(payload);

  assert.ok(
    parsed.claims.some((c) => c.claim_id === "S4-MISSING-CLAIM"),
    "auto-declared claim should appear in claims array",
  );
  assert.ok(
    parsed.validation_warnings.some((w) => w.code === "UNDECLARED_CLAIM_REFS_HEALED"),
    "should add UNDECLARED_CLAIM_REFS_HEALED warning",
  );
});

test("parseStep4StructuredResult heals capital metrics with undeclared source_ids", () => {
  const payload = structuredClone(fixture);
  payload.capital_allocation.capital_metrics[0].source_ids = ["source:capital-missing"];

  const parsed = parseStep4StructuredResult(payload);

  assert.ok(
    parsed.sources.some((s) => s.source_id === "source:capital-missing"),
    "auto-declared capital metric source should appear in sources array",
  );
  assert.ok(
    parsed.validation_warnings.some((w) => w.code === "UNDECLARED_SOURCE_REFS_HEALED"),
  );
});

test("parseStep4StructuredResult expands claim IDs found in capital metric source_ids arrays", () => {
  // This is the exact error pattern from real LLM output:
  //   capital_metrics[x].source_ids = ["src:real", "claim_1", "claim_9"]
  // The LLM confuses the two ID namespaces.  The healer should expand claim_1
  // to its actual source_ids from the claims array, not create a synthetic source.
  const payload = structuredClone(fixture);
  // claim S4-C1 already cites "source:apple:10k:services" in the fixture
  const realClaimId = payload.claims[0].claim_id; // e.g. "S4-C1"
  const realSourceFromClaim = payload.claims[0].source_ids[0]; // e.g. "source:apple:10k:services"

  // Inject the claim ID where a source ID should be
  payload.capital_allocation.capital_metrics[0].source_ids = [realClaimId];

  const parsed = parseStep4StructuredResult(payload);

  // The capital metric's source_ids should have been expanded to the claim's actual sources
  const metricSourceIds = parsed.capital_allocation.capital_metrics[0].source_ids;
  assert.ok(
    metricSourceIds.includes(realSourceFromClaim),
    `source_ids should be expanded from claim ${realClaimId} to its actual sources`,
  );
  assert.equal(
    metricSourceIds.includes(realClaimId),
    false,
    "the raw claim_id should no longer appear in source_ids after expansion",
  );
  assert.ok(
    parsed.validation_warnings.some((w) => w.code === "CLAIM_ID_USED_AS_SOURCE_REF"),
    "should add CLAIM_ID_USED_AS_SOURCE_REF warning",
  );
});

test("Step4StructuredSchema.parse still rejects undeclared refs when called directly (superRefine still strict)", () => {
  // Ensures that parseStep4StructuredResult healing is in the normalize layer,
  // not in the schema itself — so calling the schema directly still hard-fails.
  const payload = structuredClone(fixture);
  payload.synergy_registry[0].financial_signal.source_ids = ["source:missing"];

  assert.throws(() => Step4StructuredSchema.parse(payload));
});

test("normalizes multi-id capital synergy links instead of blocking Step 4", () => {
  const payload = structuredClone(fixture);
  payload.synergy_registry = [
    { ...payload.synergy_registry[0], synergy_id: "S-01" },
    { ...payload.synergy_registry[0], synergy_id: "S-02" },
    { ...payload.synergy_registry[0], synergy_id: "S-03" },
  ];
  payload.capital_allocation.capital_metrics = [
    {
      ...payload.capital_allocation.capital_metrics[0],
      metric_id: "CM-01",
      synergy_link: "S-01, S-02",
    },
    {
      ...payload.capital_allocation.capital_metrics[0],
      metric_id: "CM-02",
      synergy_link: "S-01, S-03",
    },
  ];

  const parsed = parseStep4StructuredResult(payload);

  assert.equal(parsed.capital_allocation.capital_metrics[0].synergy_link, "S-01");
  assert.equal(parsed.capital_allocation.capital_metrics[1].synergy_link, "S-01");
  assert.equal(
    parsed.validation_warnings.some((warning) => warning.code === "CAPITAL_SYNERGY_LINK_NORMALIZED"),
    true,
  );
  assert.equal(parsed.capital_allocation.workflow_status, "NEEDS_REVIEW");
});

test("exports response schemas for structured LLM output", () => {
  assert.equal(typeof STEP4_RESPONSE_SCHEMA, "object");
  assert.equal((STEP4_RESPONSE_SCHEMA as Record<string, unknown>).type, "object");
});

test("exports a Gemini-safe Step 4 response schema without unsupported keywords", () => {
  const serialized = JSON.stringify(GEMINI_STEP4_RESPONSE_SCHEMA);

  assert.equal(serialized.includes("\"$ref\""), false);
  assert.equal(serialized.includes("\"const\""), false);
  assert.equal(serialized.includes("\"additionalProperties\""), false);
  assert.equal(serialized.includes("\"type\":[\"number\",\"null\"]"), false);
  assert.equal(serialized.includes("\"type\":[\"string\",\"null\"]"), false);
});
