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

import type { LLMProvider, ContinuityBridge } from "@/types/cfp";
import type { ChunkSummary } from "./chunk-schema";
import type { Step2StructuredResult } from "./step2-schema";
import type { FileChunk } from "./extraction-chunker";
import { chunkFile, chunkTextNotes } from "./extraction-chunker";
import {
  saveManifest,
  updateManifest,
  updateChunkStatus,
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
  | { phase: "analyzing-continuity" }
  | { phase: "complete" }
  | { phase: "error"; message: string };

export interface PipelineYearResult {
  year: number;
  structuredResult: Step2StructuredResult;
}

export interface PipelineResult {
  years: PipelineYearResult[];
  sessionId: string;
  bridges: ContinuityBridge[];
}

export interface PipelineOptions {
  files: File[];
  textNotes: string;
  targetYears: number[];
  architecture: unknown;
  provider: LLMProvider;
  apiKey: string;
  companyName: string;
  /** Pass an existing session ID to resume a paused run. */
  resumeSessionId?: string;
  onProgress: (p: PipelinePhase) => void;
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
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
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

/**
 * Run an async factory concurrently, respecting a max-concurrency limit.
 * Results preserve input order. Errors are surfaced as Error objects in results.
 */
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

/** Pause for `ms` milliseconds. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// =============================================================================
// API call helpers
// =============================================================================

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

    // Rate limit — wait and retry
    if (res.status === 429 || res.status === 503) {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        onRateLimit(RATE_LIMIT_WAIT_MS / 1000, attempt);
        await sleep(RATE_LIMIT_WAIT_MS);
        continue;
      }
      throw new RateLimitError();
    }

    const data: T & { error?: string } = await res.json();

    if (isUsageExhausted(data)) throw new UsageExhaustedError();

    if (!res.ok) {
      throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`);
    }

    return data;
  }

  throw new RateLimitError();
}

// =============================================================================
// Map phase — extract one chunk
// =============================================================================

interface ChunkExtractionResponse {
  summary?: ChunkSummary;
  error?: string;
}

async function extractChunk(
  chunk: FileChunk,
  chunkId: string,
  options: Pick<PipelineOptions, "provider" | "apiKey" | "architecture">,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<ChunkSummary> {
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
  structuredResult?: Step2StructuredResult;
  error?: string;
}

async function reduceChunks(
  summaries: ChunkSummary[],
  targetYear: number,
  companyName: string,
  options: Pick<PipelineOptions, "provider" | "apiKey" | "architecture">,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<Step2StructuredResult> {
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
  structuredResult?: Step2StructuredResult;
  error?: string;
}

async function sanityReview(
  result: Step2StructuredResult,
  targetYear: number,
  options: Pick<PipelineOptions, "provider" | "apiKey" | "architecture">,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<Step2StructuredResult> {
  const response = await postJson<SanityReviewResponse>(
    "/api/extract-history",
    {
      action: "sanity-review",
      structuredResult: result,
      targetYear,
      architecture: options.architecture,
      provider: options.provider,
      apiKey: options.apiKey,
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
// Continuity analysis (non-fatal, runs only when ≥2 years extracted)
// =============================================================================

interface AnalyzeContinuityResponse {
  bridges?: ContinuityBridge[];
  error?: string;
}

async function analyzeContinuity(
  yearResults: PipelineYearResult[],
  options: Pick<PipelineOptions, "provider" | "apiKey" | "architecture">,
  onRateLimit: (retryIn: number, attempt: number) => void,
): Promise<ContinuityBridge[]> {
  if (yearResults.length < 2) return [];
  try {
    const response = await postJson<AnalyzeContinuityResponse>(
      "/api/extract-history",
      {
        action: "analyze-continuity",
        structuredResults: yearResults.map((y) => y.structuredResult),
        architecture: options.architecture,
        provider: options.provider,
        apiKey: options.apiKey,
      },
      onRateLimit,
    );
    return response.bridges ?? [];
  } catch (err) {
    console.warn("[pipeline] Continuity analysis failed (non-fatal):", err);
    return [];
  }
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

  const chunkResults = new Map<string, ChunkSummary>();

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

    // Mark as processing — reads latest IDB state, safe under concurrent access
    await updateChunkStatus(sessionId, chunkKey, "processing");

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

    // Mark as completed and increment counter — atomic per-chunk write, race-safe
    const updated = await updateChunkStatus(sessionId, chunkKey, "completed", true);
    if (updated) manifest = updated;
  });

  try {
    const mapResults = await runWithConcurrency(mapTasks, 3);

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

    let result: Step2StructuredResult;
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
  // Step 6 — Continuity analysis (non-fatal; requires ≥2 years)
  // ---------------------------------------------------------------------------

  let bridges: ContinuityBridge[] = [];
  if (yearResults.length >= 2) {
    onProgress({ phase: "analyzing-continuity" });
    bridges = await analyzeContinuity(yearResults, options, rateNotify);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  await updateManifest(sessionId, { status: "completed" });
  await deleteSession(sessionId);

  onProgress({ phase: "complete" });

  return { years: yearResults, sessionId, bridges };
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
