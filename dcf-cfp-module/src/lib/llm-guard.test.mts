import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateTokens,
  isTruncated,
  parseConfirmation,
  splitPromptIntoParts,
  TRUNCATION_REASON_RE,
  guardedCallLLM,
} from "./llm-guard.ts";
import type { CallLLMResult } from "./llm-service.ts";

// =============================================================================
// estimateTokens
// =============================================================================

test("estimateTokens: 4 chars ≈ 1 token", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("a".repeat(8000)), 2000);
});

// =============================================================================
// isTruncated / TRUNCATION_REASON_RE
// =============================================================================

test("isTruncated: matches Claude max_tokens", () => {
  assert.ok(isTruncated({ finishReason: "max_tokens" }));
});

test("isTruncated: matches DeepSeek / OpenAI length", () => {
  assert.ok(isTruncated({ finishReason: "length" }));
});

test("isTruncated: matches Gemini MAX_TOKENS", () => {
  assert.ok(isTruncated({ finishReason: "MAX_TOKENS" }));
});

test("isTruncated: does NOT match normal stop reasons", () => {
  assert.equal(isTruncated({ finishReason: "stop" }), false);
  assert.equal(isTruncated({ finishReason: "end_turn" }), false);
  assert.equal(isTruncated({ finishReason: "tool_use" }), false);
  assert.equal(isTruncated({}), false);
});

test("TRUNCATION_REASON_RE does not match empty string", () => {
  assert.equal(TRUNCATION_REASON_RE.test(""), false);
});

// =============================================================================
// parseConfirmation
// =============================================================================

test("parseConfirmation: ok when no gap signals present", () => {
  const r = parseConfirmation("1. Analyze company. 2. Filing text received. 3. NO");
  assert.equal(r.ok, true);
  assert.equal(r.gapDescription, null);
});

test("parseConfirmation: flags gap on 'yes,' prefix", () => {
  const r = parseConfirmation("3. YES, the financial tables were missing.");
  assert.equal(r.ok, false);
  assert.ok(r.gapDescription);
});

test("parseConfirmation: flags gap on 'missing' keyword", () => {
  const r = parseConfirmation("There was missing segment data in the input.");
  assert.equal(r.ok, false);
});

test("parseConfirmation: does not flag 'no missing' phrase", () => {
  const r = parseConfirmation("3. NO missing data detected.");
  assert.equal(r.ok, true);
});

test("parseConfirmation: flags gap on 'did not receive'", () => {
  const r = parseConfirmation("I did not receive the Q3 earnings table.");
  assert.equal(r.ok, false);
});

// =============================================================================
// splitPromptIntoParts
// =============================================================================

test("splitPromptIntoParts: no split when prompt fits in one chunk", () => {
  const prompt = "Short prompt.";
  const parts = splitPromptIntoParts(prompt, 10_000);
  assert.equal(parts.length, 1);
  assert.equal(parts[0], prompt);
});

test("splitPromptIntoParts: splits large prompt across multiple parts", () => {
  const bigPrompt = "x".repeat(210_000); // ~52 500 tokens — exceeds deepseek 50k limit
  const parts = splitPromptIntoParts(bigPrompt, 50_000);
  assert.ok(parts.length > 1, "should split into multiple parts");
});

test("splitPromptIntoParts: prepends instruction prefix to every part when dataSectionStart given", () => {
  const prefix = "INSTRUCTIONS\n<documents>";
  const data = "D".repeat(210_000);
  const prompt = prefix + data;
  const parts = splitPromptIntoParts(prompt, 50_000, "<documents>");
  assert.ok(parts.length > 1, "should split");
  for (const part of parts) {
    assert.ok(part.startsWith("INSTRUCTIONS"), "every part should start with the prefix");
    assert.ok(part.includes("<documents>"), "every part should include the data marker");
  }
});

test("splitPromptIntoParts: part headers indicate total count", () => {
  const bigPrompt = "x".repeat(210_000);
  const parts = splitPromptIntoParts(bigPrompt, 50_000);
  const totalParts = parts.length;
  for (let i = 0; i < parts.length; i++) {
    assert.ok(
      parts[i].includes(`[Part ${i + 1} of ${totalParts}`),
      `part ${i + 1} header should reference total ${totalParts}`,
    );
  }
});

// =============================================================================
// guardedCallLLM — integration via _callFn injection
// =============================================================================

function makeResult(overrides: Partial<CallLLMResult> = {}): CallLLMResult {
  return { text: "ok", finishReason: "stop", ...overrides };
}

function makeOpts(
  overrides: Partial<Parameters<typeof guardedCallLLM>[0]> = {},
): Parameters<typeof guardedCallLLM>[0] {
  return {
    provider: "claude" as const,
    apiKey: "test-key",
    prompt: "Analyze this company.",
    skipConfirmation: true,
    ...overrides,
  };
}

// ─── Layer 1 ──────────────────────────────────────────────────────────────────

test("Layer 1: passes through with single call when prompt fits", async () => {
  let calls = 0;
  const result = await guardedCallLLM(
    makeOpts({
      _callFn: async () => { calls++; return makeResult(); },
    }),
  );
  assert.equal(calls, 1);
  assert.equal(result.guardLog.inputSplit, false);
  assert.equal(result.guardLog.inputChunks, 1);
});

test("Layer 1: splits and multi-calls when prompt exceeds deepseek limit", async () => {
  const bigPrompt = "x".repeat(220_000); // ~55 000 tokens, exceeds 50 000 limit
  const calls: string[] = [];
  await guardedCallLLM(
    makeOpts({
      provider: "deepseek",
      prompt: bigPrompt,
      _callFn: async (o) => { calls.push((o as { prompt: string }).prompt.slice(0, 10)); return makeResult(); },
    }),
  );
  assert.ok(calls.length > 1, "should make multiple calls");
});

test("Layer 1: inputSplit=true when prompt was split", async () => {
  const bigPrompt = "x".repeat(220_000);
  const result = await guardedCallLLM(
    makeOpts({
      provider: "deepseek",
      prompt: bigPrompt,
      _callFn: async () => makeResult(),
    }),
  );
  assert.equal(result.guardLog.inputSplit, true);
  assert.ok(result.guardLog.inputChunks > 1);
});

// ─── Layer 2 ──────────────────────────────────────────────────────────────────

test("Layer 2: confirmation call runs by default", async () => {
  const prompts: string[] = [];
  const result = await guardedCallLLM(
    makeOpts({
      skipConfirmation: false,
      _callFn: async (o) => {
        prompts.push((o as { prompt: string }).prompt);
        return makeResult({ text: "1. Task. 2. Data. 3. NO" });
      },
    }),
  );
  assert.equal(result.guardLog.confirmationRan, true);
  assert.ok(prompts.some((p) => p.startsWith("You just completed")), "confirmation prompt should run");
});

test("Layer 2: skipped when skipConfirmation=true", async () => {
  const prompts: string[] = [];
  const result = await guardedCallLLM(
    makeOpts({
      skipConfirmation: true,
      _callFn: async (o) => { prompts.push((o as { prompt: string }).prompt); return makeResult(); },
    }),
  );
  assert.equal(result.guardLog.confirmationRan, false);
  assert.ok(!prompts.some((p) => p.startsWith("You just completed")));
});

test("Layer 2: sends supplement when gap flagged", async () => {
  const prompts: string[] = [];
  await guardedCallLLM(
    makeOpts({
      skipConfirmation: false,
      _callFn: async (o) => {
        const p = (o as { prompt: string }).prompt;
        prompts.push(p);
        if (p.startsWith("You just completed")) {
          return makeResult({ text: "3. YES, missing financial segment data." });
        }
        return makeResult();
      },
    }),
  );
  assert.ok(
    prompts.some((p) => p.startsWith("The previous response may have been incomplete")),
    "supplement prompt should be sent when gap flagged",
  );
});

test("Layer 2: confirmation failure does not throw", async () => {
  let mainCalled = false;
  const result = await guardedCallLLM(
    makeOpts({
      skipConfirmation: false,
      _callFn: async (o) => {
        const p = (o as { prompt: string }).prompt;
        if (p.startsWith("You just completed")) throw new Error("network fail");
        mainCalled = true;
        return makeResult({ text: "main-result" });
      },
    }),
  );
  assert.ok(mainCalled);
  assert.equal(result.text, "main-result");
  assert.equal(result.guardLog.confirmationText, "(confirmation call failed)");
});

// ─── Layer 3 ──────────────────────────────────────────────────────────────────

test("Layer 3: detects truncation and sets outputTruncated=true", async () => {
  let call = 0;
  const result = await guardedCallLLM(
    makeOpts({
      _callFn: async () => {
        call++;
        if (call === 1) return makeResult({ finishReason: "max_tokens" });
        return makeResult({ text: "continued" });
      },
    }),
  );
  assert.equal(result.guardLog.outputTruncated, true);
});

test("Layer 3: text continuation on truncation without mergeStructuredResults", async () => {
  let call = 0;
  const result = await guardedCallLLM(
    makeOpts({
      _callFn: async () => {
        call++;
        if (call === 1) return makeResult({ text: "Part A.", finishReason: "max_tokens" });
        return makeResult({ text: " Part B." });
      },
    }),
  );
  assert.ok(result.text.includes("Part A."), "should include first part");
  assert.ok(result.text.includes("Part B."), "should include continuation");
});

test("Layer 3: split retry merges structured results when mergeStructuredResults provided", async () => {
  let call = 0;
  const result = await guardedCallLLM(
    makeOpts({
      mergeStructuredResults: (payloads) => ({
        rows: (payloads as Array<{ rows: string[] }>).flatMap((p) => p.rows),
      }),
      _callFn: async () => {
        call++;
        if (call === 1) return makeResult({ structuredData: { rows: ["a"] }, finishReason: "max_tokens" });
        return makeResult({ structuredData: { rows: ["b"] } });
      },
    }),
  );
  assert.equal(result.guardLog.outputTruncated, true);
  assert.equal(result.guardLog.outputSplitRetry, true);
  const merged = result.structuredData as { rows: string[] };
  assert.ok(Array.isArray(merged.rows));
  assert.ok(merged.rows.includes("b"));
});

// ─── guardLog fields ──────────────────────────────────────────────────────────

test("guardLog is present on every result", async () => {
  const result = await guardedCallLLM(
    makeOpts({ _callFn: async () => makeResult() }),
  );
  const log = result.guardLog;
  assert.ok(typeof log.inputTokensEstimated === "number");
  assert.ok(typeof log.inputSplit === "boolean");
  assert.ok(typeof log.inputChunks === "number");
  assert.ok(typeof log.confirmationRan === "boolean");
  assert.ok(typeof log.outputTruncated === "boolean");
  assert.ok(typeof log.outputSplitRetry === "boolean");
});
