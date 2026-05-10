"use client";
/**
 * multi-file-pipeline.ts
 *
 * Sequential multi-file extraction orchestrator for bank/finance mode.
 *
 * Flow per file:
 *   1. Parse PDF on server → plain text
 *   2. Chunk text (existing chunkPdfText helper)
 *   3. Map phase   — extract each chunk (with hints injected if available)
 *   4. Reduce phase — merge summaries → Step2BankStructuredResult
 *   5. Review phase — sanity-check result
 *   6. Generate hints (after first 10-K and first 10-Q)
 *   7. Update hints if later filing returns data from a different location
 *
 * Produces one Step2BankStructuredResult per file.
 * Caller is responsible for projecting to HistoricalExtractionRow[] and
 * injecting derived Q4 rows via injectDerivedQ4Rows().
 */

import type { LLMProvider, WorkflowMode } from "@/types/cfp";
import type { BankChunkSummary } from "./chunk-schema";
import type { Step2BankStructuredResult } from "./step2-bank-schema";
import { chunkPdfText } from "./extraction-chunker";
import { buildHintPromptSection, type FilingHints, type FilingTypeHints } from "./filing-hints";
import type { DetectedFiling } from "./filing-detector";
import {
  saveManifest,
  updateManifest,
  getManifest,
  getChunkResult,
  saveChunkResult,
  getSessionChunkResults,
  deleteSession,
  saveMfFileResult,
  getMfFileResults,
  deleteMfSession,
  type PipelineManifest,
} from "./extraction-state";

// =============================================================================
// Public types
// =============================================================================

export type MultiFilePipelinePhase =
  | { phase: "idle" }
  | { phase: "parsing-pdf"; fileIndex: number; totalFiles: number; fileName: string }
  | { phase: "chunking"; fileIndex: number; totalFiles: number; fileName: string }
  | {
      phase: "mapping";
      fileIndex: number;
      totalFiles: number;
      fileName: string;
      chunkIndex: number;
      totalChunks: number;
      completedChunks: number;
    }
  | {
      phase: "reducing";
      fileIndex: number;
      totalFiles: number;
      fileName: string;
      year: number;
    }
  | {
      phase: "reviewing";
      fileIndex: number;
      totalFiles: number;
      fileName: string;
      year: number;
    }
  | {
      phase: "generating-hints";
      fileIndex: number;
      totalFiles: number;
      fileName: string;
      filingType: "10-K" | "10-Q";
    }
  | {
      phase: "rate-limited";
      retryIn: number;
      completedChunks: number;
      totalChunks: number;
      attempt: number;
    }
  | {
      phase: "usage-exhausted";
      completedChunks: number;
      totalChunks: number;
      sessionId: string;
    }
  | { phase: "complete"; hints: FilingHints }
  | { phase: "error"; message: string };

export interface PerFileResult {
  filing: DetectedFiling;
  structuredResult: Step2BankStructuredResult;
}

export interface MultiFilePipelineResult {
  fileResults: PerFileResult[];
  hints: FilingHints;
  sessionId: string;
}

export interface MultiFilePipelineOptions {
  filings: DetectedFiling[];               // already sorted chronologically
  architecture: unknown;
  provider: LLMProvider;
  apiKey: string;
  companyName: string;
  workflowMode?: WorkflowMode;             // defaults to "bank"
  /** Existing hints to seed from (e.g. loaded from a JSON save). */
  seedHints?: FilingHints;
  onProgress: (p: MultiFilePipelinePhase) => void;
  /**
   * Caller-supplied session ID for a fresh run.  If omitted, a new ID is
   * generated internally.  Pass the same ID as `resumeSessionId` (not here)
   * when you want to resume a failed run.
   */
  sessionId?: string;
  /**
   * Resume a previously interrupted run.  The pipeline loads any file results
   * already saved in IndexedDB under this ID and skips those files.
   */
  resumeSessionId?: string;
}

// =============================================================================
// Error sentinels
// =============================================================================

class RateLimitError extends Error {
  constructor() {
    super("Rate limit reached (429/503).");
    this.name = "RateLimitError";
  }
}

class UsageExhaustedError extends Error {
  constructor() {
    super("Usage limit exhausted.");
    this.name = "UsageExhaustedError";
  }
}

// =============================================================================
// Helpers
// =============================================================================

function generateSessionId(): string {
  return `mf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const USAGE_EXHAUSTED_PATTERNS = [
  /insufficient.{0,20}credit/i,
  /usage.{0,20}limit/i,
  /quota.{0,20}exceed/i,
  /out.{0,10}of.{0,10}credit/i,
  /billing/i,
];

function isUsageExhausted(body: unknown): boolean {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return USAGE_EXHAUSTED_PATTERNS.some((re) => re.test(text));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_RETRY_ATTEMPTS = 3;

async function postJson<T>(
  path: string,
  body: unknown,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status === 503) {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        onRateLimit(RATE_LIMIT_WAIT_MS / 1000, attempt);
        await sleep(RATE_LIMIT_WAIT_MS);
        continue;
      }
      throw new RateLimitError();
    }

    const text = await res.text();
    if (!text.trim()) {
      throw new Error(`Server returned empty response (HTTP ${res.status}). Try again.`);
    }

    let data: T & { error?: string };
    try {
      data = JSON.parse(text) as T & { error?: string };
    } catch {
      throw new Error(`Server returned invalid JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }

    if (isUsageExhausted(data)) throw new UsageExhaustedError();

    if (!res.ok) {
      throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`);
    }

    return data;
  }
  throw new RateLimitError();
}

// =============================================================================
// Step: Parse PDF on server
// =============================================================================

async function parsePdfOnServer(
  file: File,
  apiKey: string,
  provider: string,
): Promise<{ text: string; pages: number }> {
  const formData = new FormData();
  formData.append("action", "parse-pdf");
  formData.append("file", file);
  formData.append("provider", provider);
  formData.append("apiKey", apiKey);

  const res = await fetch("/api/extract-history", {
    method: "POST",
    body: formData,
  });

  const text = await res.text();
  const data = JSON.parse(text) as { text?: string; pages?: number; error?: string };

  if (!res.ok || !data.text) {
    throw new Error(data.error ?? "PDF parsing failed.");
  }

  return { text: data.text, pages: data.pages ?? 0 };
}

// =============================================================================
// Step: Extract one chunk
// =============================================================================

interface ChunkExtractionResponse {
  summary?: BankChunkSummary;
  error?: string;
}

async function extractChunk(
  chunkContent: string,
  chunkId: string,
  sourceFile: string,
  chunkIndex: number,
  totalChunks: number,
  options: Pick<MultiFilePipelineOptions, "provider" | "apiKey" | "architecture">,
  hintsText: string | null,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<BankChunkSummary> {
  const response = await postJson<ChunkExtractionResponse>(
    "/api/extract-history",
    {
      action: "extract-chunk",
      chunkContent,
      chunkMetadata: { chunkId, sourceFile, chunkIndex, totalChunks },
      architecture: options.architecture,
      provider: options.provider,
      apiKey: options.apiKey,
      workflowMode: "bank",
      hintsText: hintsText ?? undefined,
    },
    onRateLimit,
  );

  if (!response.summary) {
    throw new Error(response.error ?? "No summary returned from extract-chunk.");
  }
  return response.summary as BankChunkSummary;
}

// =============================================================================
// Step: Reduce
// =============================================================================

interface ReduceResponse {
  structuredResult?: Step2BankStructuredResult;
  error?: string;
}

async function reduceChunks(
  summaries: BankChunkSummary[],
  targetYear: number,
  options: Pick<MultiFilePipelineOptions, "provider" | "apiKey" | "architecture" | "companyName">,
  hintsText: string | null,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<Step2BankStructuredResult> {
  const response = await postJson<ReduceResponse>(
    "/api/extract-history",
    {
      action: "reduce",
      chunkSummaries: summaries,
      targetYear,
      companyName: options.companyName,
      architecture: options.architecture,
      provider: options.provider,
      apiKey: options.apiKey,
      workflowMode: "bank",
      hintsText: hintsText ?? undefined,
    },
    onRateLimit,
  );

  if (!response.structuredResult) {
    throw new Error(response.error ?? "No structured result returned from reduce.");
  }
  return response.structuredResult;
}

// =============================================================================
// Step: Sanity review
// =============================================================================

interface SanityReviewResponse {
  structuredResult?: Step2BankStructuredResult;
  error?: string;
}

async function sanityReview(
  result: Step2BankStructuredResult,
  targetYear: number,
  options: Pick<MultiFilePipelineOptions, "provider" | "apiKey" | "architecture">,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<Step2BankStructuredResult> {
  const response = await postJson<SanityReviewResponse>(
    "/api/extract-history",
    {
      action: "sanity-review",
      structuredResult: result,
      targetYear,
      architecture: options.architecture,
      provider: options.provider,
      apiKey: options.apiKey,
      workflowMode: "bank",
    },
    onRateLimit,
  );

  if (!response.structuredResult) {
    console.warn("[multi-file-pipeline] Sanity review failed, using un-reviewed result:", response.error);
    return result;
  }
  return response.structuredResult;
}

// =============================================================================
// Step: Generate hints
// =============================================================================

interface GenerateHintsResponse {
  hints?: FilingTypeHints;
  error?: string;
}

async function generateHints(
  structuredResult: Step2BankStructuredResult,
  filing: DetectedFiling,
  options: Pick<MultiFilePipelineOptions, "provider" | "apiKey" | "companyName">,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<FilingTypeHints | null> {
  try {
    const response = await postJson<GenerateHintsResponse>(
      "/api/extract-history",
      {
        action: "generate-hints",
        structuredResult,
        filingType: filing.filingType,
        fileName: filing.fileName,
        companyName: options.companyName,
        provider: options.provider,
        apiKey: options.apiKey,
      },
      onRateLimit,
    );
    return response.hints ?? null;
  } catch (err) {
    // Hints generation is non-fatal
    console.warn("[multi-file-pipeline] Hints generation failed:", err);
    return null;
  }
}

// =============================================================================
// Concurrency helper (max 3 concurrent chunk extractions)
// =============================================================================

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<Array<T | Error>> {
  const results: Array<T | Error> = new Array(tasks.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) break;
      try {
        results[index] = await tasks[index]();
      } catch (err) {
        results[index] = err instanceof Error ? err : new Error(String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// =============================================================================
// Main pipeline
// =============================================================================

export async function runMultiFilePipeline(
  options: MultiFilePipelineOptions,
): Promise<MultiFilePipelineResult> {
  const { filings, provider, apiKey, companyName, onProgress, seedHints, resumeSessionId } = options;

  const sessionId = resumeSessionId ?? options.sessionId ?? generateSessionId();
  const fileResults: PerFileResult[] = [];

  // Initialise hints (from seed or empty)
  const hints: FilingHints = seedHints
    ? { ...seedHints }
    : { companyName, tenK: null, tenQ: null };

  // ── Resume: load previously saved file results ───────────────────────────────
  const savedResults = resumeSessionId ? await getMfFileResults(resumeSessionId) : [];
  const savedFileMap = new Map(
    savedResults.map((r) => [r.chunkKey, r.result]),
  );

  // Restore hints from the most-recently saved file that has hints
  if (savedResults.length > 0) {
    const lastWithHints = [...savedResults]
      .reverse()
      .find((r) => r.result.hints !== null);
    if (lastWithHints?.result.hints) {
      Object.assign(hints, lastWithHints.result.hints as Partial<FilingHints>);
    }
  }

  // Pre-populate fileResults with already-completed files (preserves ordering)
  for (const filing of filings) {
    const saved = savedFileMap.get(filing.fileName);
    if (saved) {
      fileResults.push({
        filing,
        structuredResult: saved.structuredResult as Step2BankStructuredResult,
      });
    }
  }

  // Track counts for rate-limit progress reporting
  let totalProcessedChunks = 0;
  let totalChunksAllFiles = 0; // will be updated as we go

  const rateNotify = (retryIn: number, attempt: number) => {
    onProgress({
      phase: "rate-limited",
      retryIn,
      completedChunks: totalProcessedChunks,
      totalChunks: totalChunksAllFiles,
      attempt,
    });
  };

  for (let fileIdx = 0; fileIdx < filings.length; fileIdx++) {
    const filing = filings[fileIdx];
    const totalFiles = filings.length;
    const isBank10K = filing.filingType === "10-K";
    const filingType = filing.filingType;

    // ── Skip already-completed files when resuming ────────────────────────────
    if (savedFileMap.has(filing.fileName)) {
      // Report the file as already reviewed so the UI marks it complete
      onProgress({
        phase: "reviewing",
        fileIndex: fileIdx,
        totalFiles,
        fileName: filing.fileName,
        year: filing.year,
      });
      continue;
    }

    // ── 1. Parse PDF ─────────────────────────────────────────────────────────
    onProgress({
      phase: "parsing-pdf",
      fileIndex: fileIdx,
      totalFiles,
      fileName: filing.fileName,
    });

    let pdfText: string;
    try {
      const parsed = await parsePdfOnServer(filing.file, apiKey, provider);
      pdfText = parsed.text;
    } catch (err) {
      throw new Error(
        `Failed to parse PDF "${filing.fileName}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ── 2. Chunk ─────────────────────────────────────────────────────────────
    onProgress({
      phase: "chunking",
      fileIndex: fileIdx,
      totalFiles,
      fileName: filing.fileName,
    });

    const chunks = chunkPdfText(pdfText, filing.fileName, provider);
    totalChunksAllFiles += chunks.length;

    // ── 3. Build hints string for prompt injection ───────────────────────────
    const typeHints = isBank10K ? hints.tenK : hints.tenQ;
    const hintsText = buildHintPromptSection(typeHints, filingType) || null;

    // ── 4. Map phase (concurrency ≤ 3) ──────────────────────────────────────
    const chunkSummaries: BankChunkSummary[] = new Array(chunks.length);

    const mapTasks = chunks.map((chunk, i) => async (): Promise<void> => {
      const chunkId = `${filing.fileName}__${i}`;

      onProgress({
        phase: "mapping",
        fileIndex: fileIdx,
        totalFiles,
        fileName: filing.fileName,
        chunkIndex: i + 1,
        totalChunks: chunks.length,
        completedChunks: totalProcessedChunks,
      });

      const summary = await extractChunk(
        chunk.content,
        chunkId,
        filing.fileName,
        i,
        chunks.length,
        { provider, apiKey, architecture: options.architecture },
        hintsText,
        rateNotify,
      );

      chunkSummaries[i] = summary;
      totalProcessedChunks++;
    });

    const mapResults = await runWithConcurrency(mapTasks, 3);

    // Surface fatal errors
    for (const r of mapResults) {
      if (r instanceof RateLimitError || r instanceof UsageExhaustedError) throw r;
      if (r instanceof Error) {
        // Non-fatal chunk errors: log and continue (the summary slot remains undefined)
        console.warn(`[multi-file-pipeline] Chunk error in ${filing.fileName}:`, r.message);
      }
    }

    // Filter out failed chunks (undefined slots)
    const validSummaries = chunkSummaries.filter(Boolean);
    if (validSummaries.length === 0) {
      throw new Error(`All chunks failed for "${filing.fileName}". Cannot produce a result.`);
    }

    // ── 5. Reduce ────────────────────────────────────────────────────────────
    onProgress({
      phase: "reducing",
      fileIndex: fileIdx,
      totalFiles,
      fileName: filing.fileName,
      year: filing.year,
    });

    let structuredResult = await reduceChunks(
      validSummaries,
      filing.year,
      { provider, apiKey, architecture: options.architecture, companyName },
      hintsText,
      rateNotify,
    );

    // ── 6. Sanity review ─────────────────────────────────────────────────────
    onProgress({
      phase: "reviewing",
      fileIndex: fileIdx,
      totalFiles,
      fileName: filing.fileName,
      year: filing.year,
    });

    structuredResult = await sanityReview(
      structuredResult,
      filing.year,
      { provider, apiKey, architecture: options.architecture },
      rateNotify,
    );

    fileResults.push({ filing, structuredResult });

    // ── Save completed file result to IDB (enables resume if later file fails) ─
    try {
      await saveMfFileResult(sessionId, filing.fileName, structuredResult, { ...hints });
    } catch (saveErr) {
      // Non-fatal: if IDB save fails, resume won't skip this file but extraction continues
      console.warn("[multi-file-pipeline] Could not save file result to IDB:", saveErr);
    }

    // ── 7. Generate hints (first 10-K or first 10-Q) ─────────────────────────
    const needsTenKHints = isBank10K && hints.tenK === null;
    const needsTenQHints = !isBank10K && hints.tenQ === null;

    if (needsTenKHints || needsTenQHints) {
      onProgress({
        phase: "generating-hints",
        fileIndex: fileIdx,
        totalFiles,
        fileName: filing.fileName,
        filingType,
      });

      const newHints = await generateHints(
        structuredResult,
        filing,
        { provider, apiKey, companyName },
        rateNotify,
      );

      if (newHints) {
        if (isBank10K) {
          hints.tenK = newHints;
        } else {
          hints.tenQ = newHints;
        }
      }
    } else if (typeHints && typeHints.version > 0) {
      // ── 8. Update hints if a later file surfaces different locations ────────
      // Light check: if this file's sources reference sections not in current hints,
      // bump the hints version and note the update. Full regeneration is too expensive;
      // instead we just track that an update happened and let the user know.
      const knownSections = new Set(
        Object.values(typeHints.metricLocations).map((h) => h?.section ?? ""),
      );
      const resultSections = structuredResult.sources.map((s) => s.name ?? "");
      const hasNewSection = resultSections.some(
        (s) => s && !knownSections.has(s) && !s.toLowerCase().includes("unknown"),
      );

      if (hasNewSection) {
        // Regenerate hints so subsequent files benefit from updated locations
        onProgress({
          phase: "generating-hints",
          fileIndex: fileIdx,
          totalFiles,
          fileName: filing.fileName,
          filingType,
        });

        const updatedHints = await generateHints(
          structuredResult,
          filing,
          { provider, apiKey, companyName },
          rateNotify,
        );

        if (updatedHints) {
          const updated: FilingTypeHints = {
            ...updatedHints,
            version: typeHints.version + 1,
            lastUpdatedByFile: filing.fileName,
          };
          if (isBank10K) {
            hints.tenK = updated;
          } else {
            hints.tenQ = updated;
          }
        }
      }
    }
  }

  onProgress({ phase: "complete", hints });

  // Clean up per-file IDB records now that the full run succeeded
  try {
    await deleteMfSession(sessionId);
  } catch {
    // Non-fatal — stale records will be ignored on next run
  }

  return { fileResults, hints, sessionId };
}
