/**
 * Pure (browser-free) helpers for chunk extraction resilience.
 *
 * Why this module exists: the bank and industrial multi-file pipelines both
 * need the same MAX_TOKENS recovery behaviour (bisect the chunk, retry each
 * half, merge results). Originally that logic lived inside each pipeline
 * module — but those modules import IndexedDB-backed state, so they can't
 * be loaded under `node --test`. Moving the recovery logic here means it
 * has no browser deps and is unit-testable in isolation.
 */

// =============================================================================
// Truncation detection
// =============================================================================

/**
 * Returns true when an error message indicates the provider truncated its
 * output and we should retry-with-split rather than hard-fail.
 *
 * Matches the canonical messages produced by `parseStructuredJsonText` in
 * llm-service.ts (Gemini: "Structured output was truncated because Gemini hit
 * MAX_TOKENS"; DeepSeek: "...DeepSeek hit the token limit"). The patterns are
 * specific enough that a rate-limit error message won't accidentally match.
 */
export function isTruncationError(message: string): boolean {
  return /Structured output was truncated|MAX_TOKENS|hit the token limit/i.test(message);
}

// =============================================================================
// Chunk bisection
// =============================================================================

/**
 * Split chunk text roughly in half, preferring a quarter/section boundary
 * near the midpoint so each half is self-coherent. Falls back to a blank-line
 * break, then to a hard character split.
 *
 * Returns [firstHalf, secondHalf]. Concatenating them reproduces the input
 * (no characters are dropped).
 */
export function bisectChunk(text: string): [string, string] {
  if (text.length < 2) return [text, ""];

  const mid = Math.floor(text.length / 2);
  const window = Math.floor(text.length * 0.1); // ±10% search window
  const lo = Math.max(0, mid - window);
  const hi = Math.min(text.length, mid + window);
  const slice = text.slice(lo, hi);

  // Prefer a "Q1 2024" / "FY 2023" / "Three months ended" boundary.
  const boundary =
    /(Q[1-4]\s+20\d{2}|FY\s*20\d{2}|First Quarter|Second Quarter|Third Quarter|Fourth Quarter|Three [Mm]onths [Ee]nded|Six [Mm]onths [Ee]nded|Nine [Mm]onths [Ee]nded|Fiscal [Yy]ear [Ee]nded)/g;
  let match: RegExpExecArray | null;
  let bestOffset: number | null = null;
  while ((match = boundary.exec(slice)) !== null) {
    const abs = lo + match.index;
    if (bestOffset === null || Math.abs(abs - mid) < Math.abs(bestOffset - mid)) {
      bestOffset = abs;
    }
  }

  // Fallback to a blank-line break near the midpoint.
  if (bestOffset === null) {
    const blank = slice.indexOf("\n\n");
    if (blank >= 0) bestOffset = lo + blank + 2;
  }

  const cut = bestOffset ?? mid;
  return [text.slice(0, cut), text.slice(cut)];
}

// =============================================================================
// Retry-with-bisect orchestrator
// =============================================================================

/**
 * Minimal shape the merge step requires. Real chunk summaries (BankChunkSummary,
 * IndustrialChunkSummary) all conform to this.
 */
export interface ChunkSummaryLike {
  chunk_id: string;
  rows: unknown[];
  anomalies?: unknown[];
}

export interface BisectRetryOptions {
  /**
   * Max recursive split depth. depth=0 → no bisect. depth=2 → up to 4
   * sub-extractions per original chunk (2^2). Default 2.
   */
  maxSplitDepth?: number;

  /**
   * Below this character count, bisecting won't help (the chunk is already
   * small enough that the truncation is from something other than input
   * volume — e.g. a runaway schema). Default 4000 characters (~1k tokens).
   */
  minChunkChars?: number;
}

/**
 * Call `fetcher` to extract `chunkContent`. If it throws a truncation error,
 * bisect the content and retry each half recursively, merging results.
 *
 * `fetcher` receives the (possibly halved) content and a freshly-derived
 * chunk id. It returns a chunk summary or throws — this helper only catches
 * truncation; other errors propagate unchanged (rate-limit, usage, schema).
 */
export async function extractWithBisectRetry<S extends ChunkSummaryLike>(
  chunkContent: string,
  chunkId: string,
  fetcher: (content: string, id: string) => Promise<S>,
  options: BisectRetryOptions = {},
): Promise<S> {
  const maxSplitDepth = options.maxSplitDepth ?? 2;
  const minChunkChars = options.minChunkChars ?? 4000;

  return inner(chunkContent, chunkId, 0);

  async function inner(content: string, id: string, depth: number): Promise<S> {
    try {
      return await fetcher(content, id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isTruncationError(msg) || depth >= maxSplitDepth || content.length <= minChunkChars) {
        throw err;
      }

      // eslint-disable-next-line no-console
      console.warn(
        `[chunk-bisect-retry] ${id} hit truncation at depth ${depth}; bisecting and retrying.`,
      );

      const [firstHalf, secondHalf] = bisectChunk(content);
      const subA = await inner(firstHalf, `${id}__a${depth}`, depth + 1);
      const subB = await inner(secondHalf, `${id}__b${depth}`, depth + 1);

      return {
        ...subA,
        chunk_id: id,
        rows: [...subA.rows, ...subB.rows],
        anomalies: [...(subA.anomalies ?? []), ...(subB.anomalies ?? [])],
      } as S;
    }
  }
}
