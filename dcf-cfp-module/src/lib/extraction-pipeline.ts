"use client";
/**
 * Step 2 Extraction Pipeline — client-side orchestrator.
 *
 * Flow:
 *   1. Prepare  — parse + chunk all uploaded files
 *   2. Map      — send each chunk to /api/extract-history?action=extract-chunk (concurrency ≤ 3)
 *   3. Reduce   — merge all ChunkSummary[] → Step2StructuredResult per year
 *   4. Review   — sanity-check each year's result
 *   5. Cleanup  — auto-delete IndexedDB session on success
 *
 * Rate-limit handling:
 *   HTTP 429/503 or "usage exhausted" body → 60 s wait → auto-retry (up to 3 attempts).
 *   After 3 failed attempts the pipeline pauses and notifies the caller via onProgress.
 */

import type { LLMProvider, WorkflowMode } from "@/types/cfp";
import type { ChunkSummary, BankChunkSummary } from "./chunk-schema";
import type { Step2StructuredResult } from "./step2-schema";
import type { Step2BankStructuredResult } from "./step2-bank-schema";
import type { FileChunk } from "./extraction-chunker";
import {
  RateLimitError,
  UsageExhaustedError,
  isUsageExhausted,
  sleep,
  RATE_LIMIT_WAIT_MS,
  MAX_RETRY_ATTEMPTS,
  postJson,
  runWithConcurrency,
} from "./pipeline-core";

export { RateLimitError, UsageExhaustedError };

type AnySummary = ChunkSummary | BankChunkSummary;
type AnyStructuredResult = Step2StructuredResult | Step2BankStructuredResult;
import { chunkFile, chunkTextNotes } from "./extraction-chunker";
import {
  saveManifest,
  updateManifest,
  getManifest,
  getChunkResult,
  saveChunkResult,
  getSessionChunkResults,
  deleteSession,
  type PipelineManifest,
  type ManifestChunk,
} from "./extraction-state";

// =============================================================================
// Public types
// =============================================================================

export type PipelinePhase =
  | { phase: "idle" }
  | { phase: "preparing"; step: number; totalSteps: number; detail: string }
  | {
      phase: "mapping";
      fileName: string;
      chunkIndex: number;
      totalChunks: number;
      completedChunks: number;
      totalAllChunks: number;
    }
  | { phase: "reducing"; year: number; yearIndex: number; totalYears: number }
  | { phase: "reviewing"; year: number; yearIndex: number; totalYears: number }
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
  | { phase: "complete" }
  | { phase: "error"; message: string };

export interface PipelineYearResult {
  year: number;
  structuredResult: AnyStructuredResult;
}

export interface PipelineResult {
  years: PipelineYearResult[];
  sessionId: string;
}

export interface PipelineOptions {
  files: File[];
  textNotes: string;
  targetYears: number[];
  architecture: unknown;
  provider: LLMProvider;
  apiKey: string;
  companyName: string;
  /** Routes the pipeline to bank-mode chunk/reduce/review prompts when set to "bank". */
  workflowMode?: WorkflowMode;
  /** Pass an existing session ID to resume a paused run. */
  resumeSessionId?: string;
  onProgress: (p: PipelinePhase) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function generateSessionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// =============================================================================
// API call helpers
// =============================================================================

// =============================================================================
// Map phase — extract one chunk
// =============================================================================

interface ChunkExtractionResponse {
  summary?: AnySummary;
  error?: string;
}

async function extractChunk(
  chunk: FileChunk,
  chunkId: string,
  options: Pick<PipelineOptions, "provider" | "apiKey" | "architecture" | "workflowMode">,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<AnySummary> {
  const response = await postJson<ChunkExtractionResponse>(
    "/api/extract-history",
    {
      action: "extract-chunk",
      chunkContent: chunk.content,
      chunkMetadata: {
        chunkId,
        sourceFile: chunk.sourceFile,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
      },
      architecture: options.architecture,
      provider: options.provider,
      apiKey: options.apiKey,
      workflowMode: options.workflowMode ?? "industrial",
    },
    onRateLimit,
  );

  if (!response.summary) {
    throw new Error(response.error ?? "No summary returned from extract-chunk.");
  }
  return response.summary;
}

// =============================================================================
// Reduce phase — merge ChunkSummary[] → Step2StructuredResult
// =============================================================================

interface ReduceResponse {
  structuredResult?: AnyStructuredResult;
  error?: string;
}

async function reduceChunks(
  summaries: AnySummary[],
  targetYear: number,
  companyName: string,
  options: Pick<PipelineOptions, "provider" | "apiKey" | "architecture" | "workflowMode">,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<AnyStructuredResult> {
  const response = await postJson<ReduceResponse>(
    "/api/extract-history",
    {
      action: "reduce",
      chunkSummaries: summaries,
      targetYear,
      companyName,
      architecture: options.architecture,
      provider: options.provider,
      apiKey: options.apiKey,
      workflowMode: options.workflowMode ?? "industrial",
    },
    onRateLimit,
  );

  if (!response.structuredResult) {
    throw new Error(response.error ?? "No structured result returned from reduce.");
  }
  return response.structuredResult;
}

// =============================================================================
// Sanity review — validate final result
// =============================================================================

interface SanityReviewResponse {
  structuredResult?: AnyStructuredResult;
  error?: string;
}

async function sanityReview(
  result: AnyStructuredResult,
  targetYear: number,
  options: Pick<PipelineOptions, "provider" | "apiKey" | "architecture" | "workflowMode">,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<AnyStructuredResult> {
  const response = await postJson<SanityReviewResponse>(
    "/api/extract-history",
    {
      action: "sanity-review",
      structuredResult: result,
      targetYear,
      architecture: options.architecture,
      provider: options.provider,
      apiKey: options.apiKey,
      workflowMode: options.workflowMode ?? "industrial",
    },
    onRateLimit,
  );

  if (!response.structuredResult) {
    // Sanity review failure is non-fatal — return original
    console.warn("[pipeline] Sanity review failed, using un-reviewed result:", response.error);
    return result;
  }
  return response.structuredResult;
}

// =============================================================================
// Main pipeline
// =============================================================================

export async function runExtractionPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const {
    files,
    textNotes,
    targetYears,
    provider,
    companyName,
    onProgress,
    resumeSessionId,
  } = options;

  const totalFiles = files.length + (textNotes.trim() ? 1 : 0);
  const totalSteps = 2 + targetYears.length * 2; // prepare + map + (reduce + review) × years

  // ---------------------------------------------------------------------------
  // Step 1 — Prepare: parse + chunk all files
  // ---------------------------------------------------------------------------

  onProgress({ phase: "preparing", step: 1, totalSteps, detail: `Parsing ${totalFiles} file(s)…` });

  const allChunks: FileChunk[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress({
      phase: "preparing",
      step: 1,
      totalSteps,
      detail: `Chunking ${file.name} (${i + 1}/${totalFiles})…`,
    });
    const chunks = await chunkFile(file, provider);
    allChunks.push(...chunks);
  }

  if (textNotes.trim()) {
    onProgress({
      phase: "preparing",
      step: 1,
      totalSteps,
      detail: `Chunking text notes (${totalFiles}/${totalFiles})…`,
    });
    allChunks.push(...chunkTextNotes(textNotes, provider));
  }

  const totalChunks = allChunks.length;

  // ---------------------------------------------------------------------------
  // Step 2 — Create or restore manifest
  // ---------------------------------------------------------------------------

  const sessionId = resumeSessionId ?? generateSessionId();
  let manifest: PipelineManifest;

  if (resumeSessionId) {
    const existing = await getManifest(resumeSessionId);
    if (existing) {
      manifest = existing;
      manifest.status = "running";
      await saveManifest(manifest);
    } else {
      manifest = buildManifest(sessionId, provider, targetYears, companyName, files, textNotes, allChunks);
      await saveManifest(manifest);
    }
  } else {
    manifest = buildManifest(sessionId, provider, targetYears, companyName, files, textNotes, allChunks);
    await saveManifest(manifest);
  }

  // Build a set of already-completed chunk keys from the manifest
  const completedKeys = new Set(
    manifest.chunks.filter((c) => c.status === "completed").map((c) => c.chunkKey),
  );
  let completedCount = completedKeys.size;

  // ---------------------------------------------------------------------------
  // Shared rate-limit notifier
  // ---------------------------------------------------------------------------

  const rateNotify = (retryIn: number, attempt: number) => {
    onProgress({
      phase: "rate-limited",
      retryIn,
      completedChunks: completedCount,
      totalChunks,
      attempt,
    });
  };

  // ---------------------------------------------------------------------------
  // Step 3 — Map phase: extract all chunks (max 3 concurrent)
  // ---------------------------------------------------------------------------

  const chunkResults = new Map<string, AnySummary>();

  // Reload already-saved results from IndexedDB (resume path)
  if (completedKeys.size > 0) {
    const saved = await getSessionChunkResults<ChunkSummary>(sessionId);
    for (const { chunkKey, result } of saved) {
      chunkResults.set(chunkKey, result);
    }
  }

  const mapTasks = allChunks.map((chunk) => async (): Promise<void> => {
    const chunkKey = `${chunk.sourceFile}__${chunk.chunkIndex}`;

    // Skip already-completed chunks
    if (completedKeys.has(chunkKey)) {
      return;
    }

    onProgress({
      phase: "mapping",
      fileName: chunk.sourceFile,
      chunkIndex: chunk.chunkIndex + 1,
      totalChunks: chunk.totalChunks,
      completedChunks: completedCount,
      totalAllChunks: totalChunks,
    });

    // Mark as processing in manifest
    await updateManifest(sessionId, {
      chunks: manifest.chunks.map((c) =>
        c.chunkKey === chunkKey ? { ...c, status: "processing" as const } : c,
      ),
    });

    const summary = await extractChunk(
      chunk,
      chunkKey,
      options,
      rateNotify,
    );

    // Save to IndexedDB immediately
    await saveChunkResult(sessionId, chunkKey, summary);
    chunkResults.set(chunkKey, summary);
    completedKeys.add(chunkKey);
    completedCount++;

    // Update manifest
    const updated = await updateManifest(sessionId, {
      chunks: manifest.chunks.map((c) =>
        c.chunkKey === chunkKey ? { ...c, status: "completed" as const } : c,
      ),
      completedChunks: completedCount,
    });
    if (updated) manifest = updated;
  });

  let mapResults: Array<void | Error> = [];
  try {
    mapResults = await runWithConcurrency(mapTasks, 3);

    // Surface first fatal error (rate limit / usage exhausted)
    for (const r of mapResults) {
      if (r instanceof RateLimitError || r instanceof UsageExhaustedError) throw r;
    }
  } catch (err) {
    if (err instanceof UsageExhaustedError) {
      await updateManifest(sessionId, { status: "paused" });
      onProgress({
        phase: "usage-exhausted",
        completedChunks: completedCount,
        totalChunks,
        sessionId,
      });
      throw err;
    }
    // Other errors propagate normally
    await updateManifest(sessionId, { status: "failed" });
    throw err;
  }

  // ---------------------------------------------------------------------------
  // Steps 4 & 5 — Reduce + Review per target year
  // ---------------------------------------------------------------------------

  const allSummaries = Array.from(chunkResults.values());

  if (allSummaries.length === 0) {
    await updateManifest(sessionId, { status: "failed" });
    const firstChunkError = mapResults.find((r): r is Error => r instanceof Error);
    throw firstChunkError ?? new Error(
      "No data could be extracted from the provided files. Check that the files contain readable financial data and try again.",
    );
  }
  const yearResults: PipelineYearResult[] = [];

  for (let yi = 0; yi < targetYears.length; yi++) {
    const year = targetYears[yi];

    // Reduce
    onProgress({
      phase: "reducing",
      year,
      yearIndex: yi + 1,
      totalYears: targetYears.length,
    });

    let result: AnyStructuredResult;
    try {
      result = await reduceChunks(allSummaries, year, companyName, options, rateNotify);
    } catch (err) {
      if (err instanceof UsageExhaustedError) {
        await updateManifest(sessionId, { status: "paused" });
        onProgress({
          phase: "usage-exhausted",
          completedChunks: completedCount,
          totalChunks,
          sessionId,
        });
      } else {
        await updateManifest(sessionId, { status: "failed" });
      }
      throw err;
    }

    // Sanity review
    onProgress({
      phase: "reviewing",
      year,
      yearIndex: yi + 1,
      totalYears: targetYears.length,
    });

    try {
      result = await sanityReview(result, year, options, rateNotify);
    } catch {
      // Non-fatal — keep unreviewd result
    }

    yearResults.push({ year, structuredResult: result });
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  await updateManifest(sessionId, { status: "completed" });
  await deleteSession(sessionId);

  onProgress({ phase: "complete" });

  return { years: yearResults, sessionId };
}

// =============================================================================
// Manifest builder
// =============================================================================

function buildManifest(
  sessionId: string,
  provider: LLMProvider,
  targetYears: number[],
  companyName: string,
  files: File[],
  textNotes: string,
  allChunks: FileChunk[],
): PipelineManifest {
  const fileList = files.map((f, i) => ({
    fileIndex: i,
    fileName: f.name,
    fileSize: f.size,
    totalChunks: allChunks.filter((c) => c.sourceFile === f.name).length,
  }));

  if (textNotes.trim()) {
    fileList.push({
      fileIndex: files.length,
      fileName: "text-notes",
      fileSize: textNotes.length,
      totalChunks: allChunks.filter((c) => c.sourceFile === "text-notes").length,
    });
  }

  const chunkList: ManifestChunk[] = allChunks.map((chunk, globalIdx) => ({
    chunkKey: `${chunk.sourceFile}__${chunk.chunkIndex}`,
    fileIndex: fileList.findIndex((f) => f.fileName === chunk.sourceFile),
    chunkIndex: chunk.chunkIndex,
    totalChunks: chunk.totalChunks,
    fileName: chunk.sourceFile,
    status: "pending",
    globalIndex: globalIdx,
  }));

  return {
    sessionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    provider,
    targetYears,
    companyName,
    files: fileList,
    chunks: chunkList,
    status: "running",
    totalChunks: allChunks.length,
    completedChunks: 0,
  };
}
