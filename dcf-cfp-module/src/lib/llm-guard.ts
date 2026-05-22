/**
 * LLM Guard — three-layer quality wrapper around callLLM.
 *
 * Layer 1 — Input capacity:
 *   Estimates prompt tokens. If over the provider's context limit, splits
 *   the data section into chunks and processes each independently, then
 *   merges the results before proceeding.
 *
 * Layer 2 — Understanding confirmation:
 *   After every main call, sends a lightweight text-only follow-up asking
 *   the LLM to confirm it received and understood the full request. If the
 *   LLM reports data gaps, the original prompt is resent as a supplement
 *   and the results are merged.
 *
 * Layer 3 — Response completeness:
 *   Inspects finishReason. On truncation (max_tokens / length / MAX_TOKENS),
 *   re-runs the call with the prompt split into smaller halves and merges
 *   the structured results. Falls back to text continuation for non-structured
 *   calls.
 *
 * Usage:
 *   import { guardedCallLLM } from "@/lib/llm-guard";
 *
 *   const result = await guardedCallLLM({
 *     provider, apiKey, prompt, systemPrompt, maxTokens,
 *     responseSchema, responseToolName, responseToolDescription,
 *     dataSectionStart: "<documents>",     // optional — marks start of data block
 *     mergeStructuredResults: mergeMyFn,   // optional — required for Layer 3 split
 *     skipConfirmation: false,             // default false = Layer 2 always runs
 *   });
 *   // result.guardLog has diagnostics; result.text / .structuredData work identically
 *   // to a plain callLLM result.
 */

import { callLLM } from "./llm-service.ts";
import type { CallLLMOptions, CallLLMResult } from "./llm-service.ts";
import type { LLMProvider } from "@/types/cfp";

// =============================================================================
// Token estimation (same heuristic as extraction-chunker.ts)
// =============================================================================

/** 4 chars ≈ 1 token for English / financial text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// =============================================================================
// Provider input limits (safety margins below the hard cap)
// =============================================================================

const INPUT_TOKEN_LIMITS: Record<LLMProvider, number> = {
  claude:   180_000,  // hard cap 200k; leave 20k for system prompt + output
  gemini:   900_000,  // hard cap 1M
  deepseek:  50_000,  // hard cap 64k; leave headroom for system prompt + output
};

// =============================================================================
// Truncation detection
// =============================================================================

export const TRUNCATION_REASON_RE = /max_tokens|^length$|MAX_TOKENS/i;

export function isTruncated(result: { finishReason?: string }): boolean {
  return TRUNCATION_REASON_RE.test(result.finishReason ?? "");
}

// =============================================================================
// Prompt splitting
// =============================================================================

/**
 * Split `prompt` so that each part fits within `targetTokensPerPart`.
 *
 * When `dataSectionStart` is provided and found in the prompt, only the
 * content *after* that marker is split.  The instructions prefix (everything
 * up to and including the marker) is prepended verbatim to every part so the
 * LLM always receives the full task context alongside its data slice.
 *
 * Falls back to splitting the entire prompt string when no marker is found.
 */
export function splitPromptIntoParts(
  prompt: string,
  targetTokensPerPart: number,
  dataSectionStart?: string,
): string[] {
  let instructionPrefix = "";
  let dataBody = prompt;

  if (dataSectionStart) {
    const idx = prompt.indexOf(dataSectionStart);
    if (idx !== -1) {
      instructionPrefix = prompt.slice(0, idx + dataSectionStart.length);
      dataBody = prompt.slice(idx + dataSectionStart.length);
    }
  }

  const charLimit = targetTokensPerPart * 4;
  if (dataBody.length <= charLimit) {
    return [prompt]; // entire prompt fits — no split needed
  }

  const totalParts = Math.ceil(dataBody.length / charLimit);
  const parts: string[] = [];

  for (let i = 0; i < totalParts; i++) {
    const start = i * charLimit;
    const end = Math.min(start + charLimit, dataBody.length);
    const header = `[Part ${i + 1} of ${totalParts} — process this section and return results for these data points only]\n`;
    parts.push(instructionPrefix + header + dataBody.slice(start, end));
  }

  return parts;
}

// =============================================================================
// Result merging
// =============================================================================

function mergeCallResults(
  results: CallLLMResult[],
  mergeStructuredFn?: (payloads: unknown[]) => unknown,
): CallLLMResult {
  // Prefer non-truncated results as the base
  const base = results.find((r) => !isTruncated(r)) ?? results[0];

  const structuredPayloads = results
    .map((r) => r.structuredData)
    .filter((d): d is unknown => d != null);

  const mergedStructured =
    mergeStructuredFn && structuredPayloads.length > 0
      ? mergeStructuredFn(structuredPayloads)
      : base.structuredData;

  return {
    ...base,
    text: results.map((r) => r.text).join("\n\n"),
    structuredData: mergedStructured,
    // Clear the truncation signal once we've successfully merged
    finishReason: isTruncated(base) ? "stop" : (base.finishReason ?? "stop"),
  };
}

// =============================================================================
// Layer 2 — Understanding confirmation
// =============================================================================

const CONFIRMATION_MAX_TOKENS = 400;

function buildConfirmationPrompt(originalPrompt: string): string {
  // Send the first 600 chars as a task anchor so the LLM can refer back
  const anchor = originalPrompt.slice(0, 600).replace(/\n{3,}/g, "\n\n").trim();
  return [
    "You just completed a task. Briefly confirm your understanding with three answers:",
    "1. What was the primary task you were asked to complete? (one sentence)",
    "2. List the key data inputs you received. (max 5 bullet points)",
    "3. Were there any data gaps or missing sections that prevented a complete response? Answer YES or NO. If YES, describe what was missing.",
    "",
    "Task context (first portion of the original request):",
    anchor,
  ].join("\n");
}

interface ConfirmationOutcome {
  ok: boolean;
  gapDescription: string | null;
  rawText: string;
}

export function parseConfirmation(text: string): ConfirmationOutcome {
  const lower = text.toLowerCase();
  // Look for signals that the LLM flagged a gap after answering question 3
  const flagged =
    lower.includes("yes, ") ||
    lower.includes("yes —") ||
    lower.includes("yes:") ||
    (lower.includes("missing") && !lower.includes("no missing")) ||
    lower.includes("did not receive") ||
    lower.includes("not provided") ||
    lower.includes("incomplete data") ||
    lower.includes("data gap");

  return {
    ok: !flagged,
    gapDescription: flagged ? text : null,
    rawText: text,
  };
}

// =============================================================================
// Guard log — available on every result for debugging / monitoring
// =============================================================================

export interface GuardLog {
  /** Estimated input tokens before any splitting. */
  inputTokensEstimated: number;
  /** True when Layer 1 split the prompt across multiple sub-calls. */
  inputSplit: boolean;
  /** Number of input chunks (1 = no split). */
  inputChunks: number;
  /** True when the Layer 2 confirmation call ran. */
  confirmationRan: boolean;
  /** Null when confirmation was skipped; true/false after it ran. */
  confirmationOk: boolean | null;
  /** Raw text from the confirmation call. */
  confirmationText: string | null;
  /** True when the main response was truncated (Layer 3 triggered). */
  outputTruncated: boolean;
  /** True when Layer 3 re-ran the call with a split prompt. */
  outputSplitRetry: boolean;
}

// =============================================================================
// Public interface
// =============================================================================

export interface GuardedCallOptions extends CallLLMOptions {
  /**
   * String marker in the prompt that separates task instructions from the
   * data payload.  Only content *after* this marker is split across chunks
   * when the prompt is too large.  The full prefix is always prepended to
   * every chunk.
   *
   * Example values: `"<documents>"`, `"--- HISTORICAL DATA ---"`
   *
   * When omitted, the guard splits the entire prompt string.
   */
  dataSectionStart?: string;

  /**
   * Merge function for structured outputs when multiple sub-calls were made
   * (Layer 1 or Layer 3 split).  Receives an array of `structuredData`
   * payloads — one per sub-call — and must return a single merged payload.
   *
   * When omitted, Layer 3 falls back to text continuation for non-structured
   * calls; for structured calls it returns the first non-truncated payload.
   */
  mergeStructuredResults?: (payloads: unknown[]) => unknown;

  /**
   * When true, skips Layer 2 (understanding confirmation).
   * Use only for lightweight / low-stakes routes where the added latency is
   * unacceptable.  Defaults to false.
   */
  skipConfirmation?: boolean;

  /**
   * Override the underlying LLM call function.  Used in tests to inject a
   * mock without needing module mocking.  Defaults to `callLLM` from
   * llm-service.
   */
  _callFn?: (opts: CallLLMOptions) => Promise<CallLLMResult>;
}

export interface GuardedCallResult extends CallLLMResult {
  guardLog: GuardLog;
}

// =============================================================================
// Main guard
// =============================================================================

export async function guardedCallLLM(
  options: GuardedCallOptions,
): Promise<GuardedCallResult> {
  const {
    provider,
    apiKey,
    prompt,
    systemPrompt,
    dataSectionStart,
    mergeStructuredResults,
    skipConfirmation = false,
    _callFn,
    ...rest
  } = options;

  const invoke = _callFn ?? callLLM;

  const inputText = (systemPrompt ?? "") + prompt;
  const inputTokens = estimateTokens(inputText);
  const limit = INPUT_TOKEN_LIMITS[provider];

  const log: GuardLog = {
    inputTokensEstimated: inputTokens,
    inputSplit: false,
    inputChunks: 1,
    confirmationRan: false,
    confirmationOk: null,
    confirmationText: null,
    outputTruncated: false,
    outputSplitRetry: false,
  };

  // ─── Layer 1: Input capacity check ────────────────────────────────────────
  let mainResult: CallLLMResult;

  if (inputTokens > limit) {
    // 80 % of the limit per chunk — leaves room for the instruction prefix
    const tokensPerChunk = Math.floor(limit * 0.8);
    const chunks = splitPromptIntoParts(prompt, tokensPerChunk, dataSectionStart);

    log.inputSplit = chunks.length > 1;
    log.inputChunks = chunks.length;

    console.info(
      `[llm-guard] Layer 1: input ${inputTokens.toLocaleString()} tokens exceeds ${limit.toLocaleString()} limit — splitting into ${chunks.length} chunks`,
    );

    const chunkResults = await Promise.all(
      chunks.map((chunkPrompt) =>
        invoke({ provider, apiKey, prompt: chunkPrompt, systemPrompt, ...rest }),
      ),
    );
    mainResult = mergeCallResults(chunkResults, mergeStructuredResults);
  } else {
    mainResult = await invoke({ provider, apiKey, prompt, systemPrompt, ...rest });
  }

  // ─── Layer 2: Understanding confirmation ──────────────────────────────────
  if (!skipConfirmation) {
    log.confirmationRan = true;
    let confirmText: string;

    try {
      const confirmCall = await invoke({
        provider,
        apiKey,
        prompt: buildConfirmationPrompt(prompt),
        maxTokens: CONFIRMATION_MAX_TOKENS,
        // No schema — plain text only so the LLM can describe gaps freely
      });
      confirmText = confirmCall.text;
    } catch (err) {
      // Confirmation call failure should not abort the main result
      console.warn("[llm-guard] Layer 2: confirmation call failed —", err);
      confirmText = "(confirmation call failed)";
    }

    const outcome = parseConfirmation(confirmText);
    log.confirmationOk = outcome.ok;
    log.confirmationText = confirmText;

    if (!outcome.ok && outcome.gapDescription) {
      console.info("[llm-guard] Layer 2: gap detected — resending full prompt as supplement");

      try {
        const supplementResult = await invoke({
          provider,
          apiKey,
          prompt: [
            "The previous response may have been incomplete due to missing input data.",
            "Here is the complete original request. Please provide a full response, ensuring",
            "every required section is covered:",
            "",
            prompt,
          ].join("\n"),
          systemPrompt,
          ...rest,
        });

        if (
          mergeStructuredResults &&
          mainResult.structuredData != null &&
          supplementResult.structuredData != null
        ) {
          mainResult = {
            ...mainResult,
            structuredData: mergeStructuredResults([
              mainResult.structuredData,
              supplementResult.structuredData,
            ]),
          };
        } else if (mainResult.structuredData == null) {
          // Text-only path: concatenate
          mainResult = {
            ...mainResult,
            text: mainResult.text + "\n\n" + supplementResult.text,
          };
        }
        // When mainResult already has structuredData but no mergeStructuredResults,
        // keep the original — it is the best we have.
      } catch (err) {
        console.warn("[llm-guard] Layer 2: supplement call failed —", err);
      }
    }
  }

  // ─── Layer 3: Response completeness check ─────────────────────────────────
  if (isTruncated(mainResult)) {
    log.outputTruncated = true;
    console.info(
      `[llm-guard] Layer 3: response truncated (finishReason=${mainResult.finishReason}) — retrying with split`,
    );

    if (mergeStructuredResults) {
      // Re-run with halved chunk size so each sub-call fits within the output cap
      log.outputSplitRetry = true;
      const halfTokens = Math.floor(limit * 0.4);
      const halves = splitPromptIntoParts(prompt, halfTokens, dataSectionStart);

      const halfResults = await Promise.all(
        halves.map((halfPrompt) =>
          invoke({ provider, apiKey, prompt: halfPrompt, systemPrompt, ...rest }),
        ),
      );
      mainResult = mergeCallResults(halfResults, mergeStructuredResults);
    } else {
      // Text-only path: ask the LLM to continue from where it stopped
      try {
        const continuation = await invoke({
          provider,
          apiKey,
          prompt:
            "Continue from exactly where you left off. Do not repeat what you already provided. Pick up mid-sentence if needed.",
          systemPrompt,
          maxTokens: rest.maxTokens,
        });
        mainResult = {
          ...mainResult,
          text: mainResult.text + continuation.text,
          finishReason: continuation.finishReason,
        };
      } catch (err) {
        console.warn("[llm-guard] Layer 3: continuation call failed —", err);
      }
    }
  }

  return { ...mainResult, guardLog: log };
}
