"use client";
/**
 * multi-file-industrial-pipeline.ts
 *
 * Sequential multi-file extraction orchestrator for industrial (non-financial) companies.
 * Mirrors multi-file-pipeline.ts but uses industrial schemas and metrics.
 *
 * Flow per file:
 *   1. Parse PDF on server → plain text
 *   2. Chunk text
 *   3. Map phase   — extract each chunk (revenue/opIncome/grossProfit/capex/d&a/headcount)
 *   4. Reduce phase — merge summaries → Step2IndustrialStructuredResult
 *   5. Review phase — sanity-check result
 *   6. Generate hints (after first 10-K and first 10-Q)
 *   7. Update hints if later filing surfaces new table locations
 *
 * Caller injects derived Q4 rows via injectIndustrialDerivedQ4Rows() after pipeline completes.
 */

import type { LLMProvider } from "@/types/cfp";
import type { IndustrialChunkSummary } from "./chunk-schema";
import type { Step2IndustrialStructuredResult } from "./step2-industrial-schema";
import { chunkPdfText } from "./extraction-chunker";
import {
  buildHintPromptSection,
  type FilingHints,
  type FilingTypeHints,
} from "./filing-hints";
import type { DetectedFiling } from "./filing-detector";
import {
  saveMfFileResult,
  getMfFileResults,
  deleteMfSession,
} from "./extraction-state";
import { extractWithBisectRetry } from "./chunk-bisect-retry";
import {
  RateLimitError,
  UsageExhaustedError,
  generateSessionId,
  postJson,
  runWithConcurrency,
} from "./pipeline-core";

// Re-export error sentinels so callers can catch them by reference
export { RateLimitError, UsageExhaustedError };

// =============================================================================
// Public types
// =============================================================================

export type IndustrialPipelinePhase =
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

export interface IndustrialPerFileResult {
  filing: DetectedFiling;
  structuredResult: Step2IndustrialStructuredResult;
}

export interface IndustrialPipelineResult {
  fileResults: IndustrialPerFileResult[];
  hints: FilingHints;
  sessionId: string;
}

export interface IndustrialPipelineOptions {
  filings: DetectedFiling[];
  architecture: unknown;
  provider: LLMProvider;
  apiKey: string;
  companyName: string;
  seedHints?: FilingHints;
  onProgress: (p: IndustrialPipelinePhase) => void;
  sessionId?: string;
  resumeSessionId?: string;
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
  summary?: IndustrialChunkSummary;
  error?: string;
}

async function extractChunk(
  chunkContent: string,
  chunkId: string,
  sourceFile: string,
  chunkIndex: number,
  totalChunks: number,
  options: Pick<IndustrialPipelineOptions, "provider" | "apiKey" | "architecture">,
  hintsText: string | null,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<IndustrialChunkSummary> {
  // Delegate MAX_TOKENS recovery to the shared helper (chunk-bisect-retry.ts).
  // The fetcher closure encapsulates the HTTP call; the helper handles
  // truncation detection, chunk halving, recursive retry, and result merging.
  // postJson throws on non-2xx, so the truncation message from the route's
  // 422 response surfaces as a thrown Error which the helper inspects.
  return extractWithBisectRetry<IndustrialChunkSummary>(
    chunkContent,
    chunkId,
    async (content, id) => {
      const response = await postJson<ChunkExtractionResponse>(
        "/api/extract-history",
        {
          action: "extract-chunk",
          chunkContent: content,
          chunkMetadata: { chunkId: id, sourceFile, chunkIndex, totalChunks },
          architecture: options.architecture,
          provider: options.provider,
          apiKey: options.apiKey,
          workflowMode: "industrial-pdf",
          hintsText: hintsText ?? undefined,
        },
        onRateLimit,
      );

      if (!response.summary) {
        throw new Error(response.error ?? "No summary returned from extract-chunk.");
      }
      return response.summary as IndustrialChunkSummary;
    },
  );
}

// =============================================================================
// Step: Reduce
// =============================================================================

interface ReduceResponse {
  structuredResult?: Step2IndustrialStructuredResult;
  error?: string;
}

async function reduceChunks(
  summaries: IndustrialChunkSummary[],
  targetYear: number,
  options: Pick<IndustrialPipelineOptions, "provider" | "apiKey" | "architecture" | "companyName">,
  hintsText: string | null,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<Step2IndustrialStructuredResult> {
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
      workflowMode: "industrial-pdf",
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
  structuredResult?: Step2IndustrialStructuredResult;
  error?: string;
}

async function sanityReview(
  result: Step2IndustrialStructuredResult,
  targetYear: number,
  options: Pick<IndustrialPipelineOptions, "provider" | "apiKey" | "architecture">,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<Step2IndustrialStructuredResult> {
  const response = await postJson<SanityReviewResponse>(
    "/api/extract-history",
    {
      action: "sanity-review",
      structuredResult: result,
      targetYear,
      architecture: options.architecture,
      provider: options.provider,
      apiKey: options.apiKey,
      workflowMode: "industrial-pdf",
    },
    onRateLimit,
  );

  if (!response.structuredResult) {
    console.warn("[multi-file-industrial-pipeline] Sanity review failed, using un-reviewed result:", response.error);
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
  structuredResult: Step2IndustrialStructuredResult,
  filing: DetectedFiling,
  options: Pick<IndustrialPipelineOptions, "provider" | "apiKey" | "companyName">,
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
        workflowMode: "industrial-pdf",
      },
      onRateLimit,
    );
    return response.hints ?? null;
  } catch (err) {
    console.warn("[multi-file-industrial-pipeline] Hints generation failed:", err);
    return null;
  }
}

// =============================================================================
// Main pipeline
// =============================================================================

export async function runIndustrialPipeline(
  options: IndustrialPipelineOptions,
): Promise<IndustrialPipelineResult> {
  const { filings, provider, apiKey, companyName, onProgress, seedHints, resumeSessionId } = options;

  const sessionId = resumeSessionId ?? options.sessionId ?? generateSessionId();
  const fileResults: IndustrialPerFileResult[] = [];

  const hints: FilingHints = seedHints
    ? { ...seedHints }
    : { companyName, tenK: null, tenQ: null, industrialTenK: null, industrialTenQ: null };

  // ── Resume: load previously saved file results ──────────────────────────────
  const savedResults = resumeSessionId ? await getMfFileResults(resumeSessionId) : [];
  const savedFileMap = new Map(savedResults.map((r) => [r.chunkKey, r.result]));

  if (savedResults.length > 0) {
    const lastWithHints = [...savedResults].reverse().find((r) => r.result.hints !== null);
    if (lastWithHints?.result.hints) {
      Object.assign(hints, lastWithHints.result.hints as Partial<FilingHints>);
    }
  }

  for (const filing of filings) {
    const saved = savedFileMap.get(filing.fileName);
    if (saved) {
      fileResults.push({
        filing,
        structuredResult: saved.structuredResult as Step2IndustrialStructuredResult,
      });
    }
  }

  let totalProcessedChunks = 0;
  let totalChunksAllFiles = 0;

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
    const is10K = filing.filingType === "10-K";
    const filingType = filing.filingType;

    if (savedFileMap.has(filing.fileName)) {
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
    onProgress({ phase: "parsing-pdf", fileIndex: fileIdx, totalFiles, fileName: filing.fileName });

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
    onProgress({ phase: "chunking", fileIndex: fileIdx, totalFiles, fileName: filing.fileName });

    const chunks = chunkPdfText(pdfText, filing.fileName, provider, options.architecture, filing.year);
    totalChunksAllFiles += chunks.length;

    // ── 3. Build hints string ─────────────────────────────────────────────────
    const typeHints = is10K ? hints.industrialTenK : hints.industrialTenQ;
    const hintsText = buildHintPromptSection(typeHints, filingType) || null;

    // ── 4. Map phase (concurrency ≤ 3) ───────────────────────────────────────
    const chunkSummaries: IndustrialChunkSummary[] = new Array(chunks.length);

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

    let firstChunkError: string | null = null;
    for (const r of mapResults) {
      if (r instanceof RateLimitError || r instanceof UsageExhaustedError) throw r;
      if (r instanceof Error) {
        if (!firstChunkError) firstChunkError = r.message;
        console.warn(`[multi-file-industrial-pipeline] Chunk error in ${filing.fileName}:`, r.message);
      }
    }

    const validSummaries = chunkSummaries.filter(Boolean);
    if (validSummaries.length === 0) {
      const reason = firstChunkError ? ` Reason: ${firstChunkError}` : "";
      throw new Error(`All chunks failed for "${filing.fileName}". Cannot produce a result.${reason}`);
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

    // ── Save completed file result to IDB ────────────────────────────────────
    try {
      await saveMfFileResult(sessionId, filing.fileName, structuredResult, { ...hints });
    } catch (saveErr) {
      console.warn("[multi-file-industrial-pipeline] Could not save file result to IDB:", saveErr);
    }

    // ── 7. Generate hints ────────────────────────────────────────────────────
    const needsTenKHints = is10K && hints.industrialTenK === null;
    const needsTenQHints = !is10K && hints.industrialTenQ === null;

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
        if (is10K) hints.industrialTenK = newHints;
        else hints.industrialTenQ = newHints;
      }
    } else if (typeHints && typeHints.version > 0) {
      // Update hints if later filing surfaces new table sections
      const knownSections = new Set(
        Object.values(typeHints.metricLocations).map((h) => h?.section ?? ""),
      );
      const resultSections = structuredResult.sources.map((s) => s.name ?? "");
      const hasNewSection = resultSections.some(
        (s) => s && !knownSections.has(s) && !s.toLowerCase().includes("unknown"),
      );

      if (hasNewSection) {
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
          if (is10K) hints.industrialTenK = updated;
          else hints.industrialTenQ = updated;
        }
      }
    }
  }

  onProgress({ phase: "complete", hints });

  try {
    await deleteMfSession(sessionId);
  } catch {
    // Non-fatal
  }

  return { fileResults, hints, sessionId };
}
