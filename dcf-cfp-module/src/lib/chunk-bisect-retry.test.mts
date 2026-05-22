import test from "node:test";
import assert from "node:assert/strict";

import {
  bisectChunk,
  extractWithBisectRetry,
  isTruncationError,
  type ChunkSummaryLike,
} from "./chunk-bisect-retry.ts";

// =============================================================================
// isTruncationError
// =============================================================================

test("isTruncationError matches the Gemini MAX_TOKENS message from llm-service", () => {
  // This is the literal message thrown by parseStructuredJsonText in src/lib/llm-service.ts:73
  assert.equal(
    isTruncationError(
      "Structured output was truncated because Gemini hit MAX_TOKENS. Try retrying with a smaller output or a higher token limit.",
    ),
    true,
  );
});

test("isTruncationError matches the DeepSeek token-limit message", () => {
  assert.equal(
    isTruncationError(
      "Structured output was truncated because DeepSeek hit the token limit. Try retrying or reduce the number of target years.",
    ),
    true,
  );
});

test("isTruncationError does NOT match rate-limit or schema errors", () => {
  assert.equal(isTruncationError("Server error 429"), false);
  assert.equal(isTruncationError("Rate limit exceeded — retry in 30s"), false);
  assert.equal(
    isTruncationError('Unknown row_id "sofi_2022_q1_enablement"'),
    false,
  );
  assert.equal(isTruncationError("Invalid enum value. Expected 'Q1' | 'Q2'"), false);
});

// =============================================================================
// bisectChunk
// =============================================================================

test("bisectChunk splits at a quarter boundary near the midpoint", () => {
  // Build text where "Q3 2024" sits very close to the midpoint and is the
  // ONLY quarterly marker — the bisector must choose it.
  const left = "x".repeat(500) + "\n";
  const right = "y".repeat(500);
  const text = `${left}Q3 2024 financial results follow...\n${right}`;

  const [a, b] = bisectChunk(text);

  assert.equal(a + b, text, "no characters dropped");
  assert.ok(b.startsWith("Q3 2024"), `second half should start at boundary; got: "${b.slice(0, 40)}"`);
});

test("bisectChunk falls back to blank-line break when no boundary in window", () => {
  // No quarter markers anywhere — should split at the nearest \n\n to the midpoint.
  const text = "alpha ".repeat(50) + "\n\n" + "beta ".repeat(50);
  const [a, b] = bisectChunk(text);

  assert.equal(a + b, text, "no characters dropped");
  assert.ok(a.endsWith("\n\n"), `first half should end at blank line; got tail: "${a.slice(-10)}"`);
  assert.ok(b.startsWith("beta"), "second half should start with the post-blank content");
});

test("bisectChunk hard-splits at midpoint when no boundary AND no blank line", () => {
  const text = "abcdefghij".repeat(100); // 1000 chars, no boundaries, no blank lines
  const [a, b] = bisectChunk(text);

  assert.equal(a + b, text);
  assert.equal(a.length, 500, "midpoint split when nothing else matches");
});

test("bisectChunk handles tiny inputs without crashing", () => {
  assert.deepEqual(bisectChunk(""), ["", ""]);
  assert.deepEqual(bisectChunk("a"), ["a", ""]);
});

// =============================================================================
// extractWithBisectRetry
// =============================================================================

const TRUNCATION_MSG =
  "Structured output was truncated because Gemini hit MAX_TOKENS. Try retrying with a smaller output or a higher token limit.";

/** A chunk summary the size of one row, to keep the test compact. */
const row = (id: string) => ({ row_id: id, revenue: 100 });

test("extractWithBisectRetry returns the fetcher result when no truncation occurs", async () => {
  let calls = 0;
  const result = await extractWithBisectRetry<ChunkSummaryLike>(
    "small content",
    "chunk-1",
    async (_content, id) => {
      calls++;
      return { chunk_id: id, rows: [row("r1")], anomalies: ["ok"] };
    },
  );

  assert.equal(calls, 1, "no retries on a happy path");
  assert.equal(result.chunk_id, "chunk-1");
  assert.deepEqual(result.rows, [row("r1")]);
});

test("extractWithBisectRetry bisects on MAX_TOKENS and merges sub-summaries", async () => {
  // Build a chunk long enough to exceed the 4000-char min, with a clear
  // quarter boundary so bisectChunk has something to split on.
  const left = "L".repeat(2200);
  const right = "R".repeat(2200);
  const chunkContent = `${left}\nQ3 2024 results follow\n${right}`;

  const calls: Array<{ id: string; len: number }> = [];

  const result = await extractWithBisectRetry<ChunkSummaryLike>(
    chunkContent,
    "chunk-A",
    async (content, id) => {
      calls.push({ id, len: content.length });
      // First call (full content) throws MAX_TOKENS; sub-calls succeed.
      if (id === "chunk-A") {
        throw new Error(TRUNCATION_MSG);
      }
      // Sub-call result identifies which half ran.
      return { chunk_id: id, rows: [row(id)], anomalies: [`from ${id}`] };
    },
  );

  // 3 fetcher invocations: original + 2 halves.
  assert.equal(calls.length, 3, `expected 3 calls (1 original + 2 halves); got ${calls.length}`);
  assert.equal(calls[0].id, "chunk-A", "first call uses the original id");
  assert.equal(calls[1].id, "chunk-A__a0", "second call is the first half");
  assert.equal(calls[2].id, "chunk-A__b0", "third call is the second half");

  // Merged result carries the original chunk_id and the union of sub-rows/anomalies.
  assert.equal(result.chunk_id, "chunk-A");
  assert.deepEqual(result.rows, [row("chunk-A__a0"), row("chunk-A__b0")]);
  assert.deepEqual(result.anomalies, ["from chunk-A__a0", "from chunk-A__b0"]);
});

test("extractWithBisectRetry bisects recursively when sub-halves also truncate", async () => {
  // Chunk large enough to survive two halvings (each half still > 4000 chars).
  const chunkContent = "x".repeat(20000) + "\nQ1 2024 break\n" + "y".repeat(20000);

  let totalCalls = 0;
  const result = await extractWithBisectRetry<ChunkSummaryLike>(
    chunkContent,
    "deep-chunk",
    async (_content, id) => {
      totalCalls++;
      // Depth 0 and depth 1 both fail; depth 2 (the leaves) succeed.
      // Ids look like: deep-chunk, deep-chunk__a0, deep-chunk__b0,
      //                deep-chunk__a0__a1, deep-chunk__a0__b1, ...
      const depth = (id.match(/__/g) ?? []).length;
      if (depth < 2) throw new Error(TRUNCATION_MSG);
      return { chunk_id: id, rows: [row(id)], anomalies: [] };
    },
  );

  // Expected call tree:
  //   1 (root) + 2 (depth 1) + 4 (depth 2 leaves) = 7
  assert.equal(totalCalls, 7, `expected 7 fetcher calls across the bisect tree; got ${totalCalls}`);
  assert.equal(result.rows.length, 4, "four leaf summaries merged");
});

test("extractWithBisectRetry stops bisecting at maxSplitDepth and rethrows", async () => {
  // When every call truncates, retry short-circuits on first leaf failure:
  // the depth-2 leaf rethrows (depth >= maxSplitDepth), and that throw
  // propagates up through `await inner(...)` — sibling halves are never
  // tried. Call tree: root(1) → left-child(1) → left-leaf(1) = 3 attempts.
  // This is intentional: partial extraction failure should fail the whole
  // chunk, not return a half-result.
  let totalCalls = 0;
  const chunkContent = "x".repeat(20000) + "\nQ1 2024\n" + "y".repeat(20000);

  await assert.rejects(
    extractWithBisectRetry<ChunkSummaryLike>(chunkContent, "doomed", async () => {
      totalCalls++;
      throw new Error(TRUNCATION_MSG);
    }),
    /MAX_TOKENS/,
  );

  assert.equal(
    totalCalls,
    3,
    "short-circuit on first leaf failure (root → left-child → left-leaf rethrows)",
  );
});

test("extractWithBisectRetry refuses to bisect chunks below the size floor", async () => {
  let calls = 0;
  await assert.rejects(
    extractWithBisectRetry<ChunkSummaryLike>("tiny content", "small-chunk", async () => {
      calls++;
      throw new Error(TRUNCATION_MSG);
    }),
    /MAX_TOKENS/,
  );

  // Chunk is 12 chars, far below the 4000-char floor — must NOT bisect.
  assert.equal(calls, 1, "only the original attempt; no retry on too-small input");
});

// =============================================================================
// chunk-schema source_excerpt auto-truncation
// =============================================================================

test("chunk schemas truncate over-length source_excerpt instead of failing", async () => {
  // The "real" failure mode reported: model returns a source_excerpt > 160 chars.
  // The preprocess in chunk-schema.ts must clip to 160 *before* the max(160)
  // validator runs, so .parse() returns a valid row instead of throwing.
  const { ChunkSummarySchema, BankChunkSummarySchema, IndustrialChunkSummarySchema } =
    await import("./chunk-schema.ts");

  const longExcerpt = "x".repeat(220);

  // --- Default schema -------------------------------------------------------
  const defaultPayload = {
    chunk_id: "test-chunk",
    rows: [
      {
        fiscal_year: 2024,
        quarter: "Q1",
        segment: "Lending",
        product_category: "Personal Loans",
        product_name: "Personal Loans",
        revenue_usd_m: 100,
        operating_income_usd_m: 50,
        source_excerpt: longExcerpt,
        confidence: "high",
      },
    ],
  };
  const defaultParsed = ChunkSummarySchema.parse(defaultPayload);
  assert.equal(defaultParsed.rows[0].source_excerpt.length, 160, "default schema truncates");

  // --- Bank schema ----------------------------------------------------------
  const bankPayload = {
    chunk_id: "test-chunk",
    rows: [
      {
        fiscal_year: 2024,
        quarter: "Q1",
        segment: "Lending",
        nii_usd_m: 100,
        non_interest_income_usd_m: null,
        provision_for_credit_losses_usd_m: null,
        net_income_usd_m: null,
        book_value_equity_usd_m: null,
        total_rwa_usd_m: null,
        tier1_capital_ratio_pct: null,
        cet1_ratio_pct: null,
        net_interest_margin_pct: null,
        efficiency_ratio_pct: null,
        return_on_avg_equity_pct: null,
        total_assets_usd_m: null,
        total_loans_usd_m: null,
        total_deposits_usd_m: null,
        retail_insured_deposits_usd_m: null,
        wholesale_uninsured_deposits_usd_m: null,
        cash_and_hqla_usd_m: null,
        htm_bonds_usd_m: null,
        unrealized_losses_htm_usd_m: null,
        source_excerpt: longExcerpt,
        confidence: "high",
      },
    ],
  };
  const bankParsed = BankChunkSummarySchema.parse(bankPayload);
  assert.equal(bankParsed.rows[0].source_excerpt.length, 160, "bank schema truncates");

  // --- Industrial schema ----------------------------------------------------
  const industrialPayload = {
    chunk_id: "test-chunk",
    rows: [
      {
        fiscal_year: 2024,
        quarter: "Q1",
        segment: "Lending",
        revenue_usd_m: 100,
        operating_income_usd_m: 50,
        gross_profit_usd_m: null,
        capex_usd_m: null,
        depreciation_amortization_usd_m: null,
        headcount: null,
        source_excerpt: longExcerpt,
        confidence: "high",
      },
    ],
  };
  const industrialParsed = IndustrialChunkSummarySchema.parse(industrialPayload);
  assert.equal(industrialParsed.rows[0].source_excerpt.length, 160, "industrial schema truncates");
});

test("extractWithBisectRetry propagates non-truncation errors without retry", async () => {
  let calls = 0;
  await assert.rejects(
    extractWithBisectRetry<ChunkSummaryLike>(
      "x".repeat(10000),
      "schema-fail",
      async () => {
        calls++;
        throw new Error('Unknown row_id "sofi_2022_q1_enablement"');
      },
    ),
    /Unknown row_id/,
  );

  assert.equal(calls, 1, "schema errors must not trigger bisect");
});
