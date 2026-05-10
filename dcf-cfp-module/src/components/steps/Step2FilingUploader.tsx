"use client";
/**
 * Step2FilingUploader.tsx
 *
 * Bank-mode PDF multi-file upload panel for Step 2.
 *
 * Accepts up to 20 PDFs (5 × 10-K + 15 × 10-Q), auto-detects filing type
 * and period from the filename, processes them sequentially (oldest first),
 * generates filing structure hints after the first 10-K and first 10-Q, and
 * produces a time-series of bank metrics that the parent can confirm.
 *
 * Expected filename formats:
 *   TICKER-10K-YYYY.pdf      e.g. JPM-10K-2024.pdf
 *   TICKER-10Q-Qn-YYYY.pdf  e.g. JPM-10Q-Q1-2024.pdf
 */

import { useCallback, useRef, useState } from "react";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Trash2,
  X,
  Info,
} from "lucide-react";
import {
  detectFilings,
  summariseFilings,
  MAX_10K_FILES,
  MAX_10Q_FILES,
  MAX_TOTAL_PDF_FILES,
  type DetectedFiling,
  type FilingDetectionError,
} from "@/lib/filing-detector";
import {
  runMultiFilePipeline,
  type MultiFilePipelinePhase,
  type PerFileResult,
} from "@/lib/multi-file-pipeline";
import { injectDerivedQ4Rows } from "@/lib/filing-hints";
import { projectStep2BankStructuredToRows } from "@/lib/step2-bank-schema";
import { deleteMfSession } from "@/lib/extraction-state";
import type { FilingHints } from "@/types/cfp";
import type { HistoricalExtractionRow } from "@/types/cfp";

// =============================================================================
// Types
// =============================================================================

export interface FilingUploaderResult {
  rows: HistoricalExtractionRow[];
  stagingYears: number[];
  hints: FilingHints;
  fileResults: PerFileResult[];
}

interface Props {
  /** Step 1 architecture — passed to all pipeline calls */
  architecture: unknown;
  provider: "claude" | "gemini" | "deepseek";
  apiKey: string;
  companyName: string;
  /** Existing hints from a prior session or JSON save */
  seedHints?: FilingHints;
  /** Called when extraction is complete and rows are ready for staging */
  onComplete: (result: FilingUploaderResult) => void;
  /** Called if user dismisses / cancels the panel */
  onCancel?: () => void;
}

// =============================================================================
// Helpers
// =============================================================================

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function periodLabel(filing: DetectedFiling): string {
  return filing.period === "annual" ? "Annual" : filing.period;
}

function phaseLabel(p: MultiFilePipelinePhase, totalFiles: number): string {
  switch (p.phase) {
    case "idle": return "Ready";
    case "parsing-pdf": return `Parsing PDF ${p.fileIndex + 1}/${totalFiles}: ${p.fileName}`;
    case "chunking": return `Preparing chunks for ${p.fileName}…`;
    case "mapping":
      return `Extracting ${p.fileName} — chunk ${p.chunkIndex}/${p.totalChunks}`;
    case "reducing": return `Merging ${p.fileName} (${p.year})…`;
    case "reviewing": return `Reviewing ${p.fileName} (${p.year})…`;
    case "generating-hints":
      return `Generating ${p.filingType} hints from ${p.fileName}…`;
    case "rate-limited":
      return `Rate limited — retrying in ${p.retryIn}s (attempt ${p.attempt}/3)`;
    case "usage-exhausted": return "Usage exhausted — please try again later.";
    case "complete": return "Extraction complete!";
    case "error": return `Error: ${p.message}`;
    default: return "";
  }
}

function fileStatusIcon(
  filing: DetectedFiling,
  completedFiles: Set<string>,
  processingFile: string | null,
) {
  if (completedFiles.has(filing.fileName)) {
    return <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />;
  }
  if (processingFile === filing.fileName) {
    return <Loader2 size={14} className="shrink-0 animate-spin text-blue-400" />;
  }
  return <div className="h-3.5 w-3.5 shrink-0 rounded-full border border-zinc-600" />;
}

// =============================================================================
// Component
// =============================================================================

export default function Step2FilingUploader({
  architecture,
  provider,
  apiKey,
  companyName,
  seedHints,
  onComplete,
  onCancel,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File state ────────────────────────────────────────────────────────────
  const [detected, setDetected] = useState<DetectedFiling[]>([]);
  const [detectionErrors, setDetectionErrors] = useState<FilingDetectionError[]>([]);

  // ── Extraction state ──────────────────────────────────────────────────────
  const [isRunning, setIsRunning] = useState(false);
  const [phase, setPhase] = useState<MultiFilePipelinePhase>({ phase: "idle" });
  const [completedFiles, setCompletedFiles] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Session ID for the active or most-recently-failed run. Used for resume. */
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // ── Hints panel ───────────────────────────────────────────────────────────
  const [hintsOpen, setHintsOpen] = useState(false);
  const [currentHints, setCurrentHints] = useState<FilingHints | null>(seedHints ?? null);

  // ── Naming guide panel ────────────────────────────────────────────────────
  const [guideOpen, setGuideOpen] = useState(true);

  // Current file being processed (for icon state)
  const processingFile: string | null =
    phase.phase === "parsing-pdf" ||
    phase.phase === "chunking" ||
    phase.phase === "mapping" ||
    phase.phase === "reducing" ||
    phase.phase === "reviewing" ||
    phase.phase === "generating-hints"
      ? (phase as { fileName: string }).fileName
      : null;

  // ── File upload handler ───────────────────────────────────────────────────
  const handleFilesAdded = useCallback((files: File[]) => {
    const pdfFiles = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfFiles.length === 0) return;

    const { detected: newDetected, errors: newErrors } = detectFilings(pdfFiles);

    setDetected((prev) => {
      // Deduplicate by filename
      const existing = new Set(prev.map((d) => d.fileName));
      const fresh = newDetected.filter((d) => !existing.has(d.fileName));
      const combined = [...prev, ...fresh];
      combined.sort((a, b) => a.sortKey - b.sortKey);
      return combined;
    });
    setDetectionErrors((prev) => {
      const existing = new Set(prev.map((e) => e.fileName));
      return [...prev, ...newErrors.filter((e) => !existing.has(e.fileName))];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      handleFilesAdded(files);
    },
    [handleFilesAdded],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    handleFilesAdded(files);
    e.target.value = "";
  };

  const removeFiling = (fileName: string) => {
    setDetected((prev) => prev.filter((d) => d.fileName !== fileName));
  };

  const removeError = (fileName: string) => {
    setDetectionErrors((prev) => prev.filter((e) => e.fileName !== fileName));
  };

  // ── Limits ────────────────────────────────────────────────────────────────
  const tenKCount = detected.filter((d) => d.filingType === "10-K").length;
  const tenQCount = detected.filter((d) => d.filingType === "10-Q").length;
  const overLimit10K = tenKCount > MAX_10K_FILES;
  const overLimit10Q = tenQCount > MAX_10Q_FILES;
  const overLimitTotal = detected.length > MAX_TOTAL_PDF_FILES;
  const hasLimitError = overLimit10K || overLimit10Q || overLimitTotal;

  // ── Start extraction ──────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (detected.length === 0 || hasLimitError) return;

    // If the previous run failed, resume it (skip already-completed files).
    // Any other invocation (first run or after clear) starts fresh.
    const isRetry = phase.phase === "error" && activeSessionId !== null;

    let sessionId: string;
    if (isRetry) {
      sessionId = activeSessionId!;
    } else {
      // Clean up any leftover session before starting fresh
      if (activeSessionId) {
        void deleteMfSession(activeSessionId);
      }
      sessionId = `mf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      setActiveSessionId(sessionId);
      setCompletedFiles(new Set());
    }

    setIsRunning(true);
    setErrorMsg(null);
    setPhase({ phase: "idle" });

    try {
      const result = await runMultiFilePipeline({
        filings: detected,
        architecture,
        provider,
        apiKey,
        companyName,
        workflowMode: "bank",
        seedHints: currentHints ?? undefined,
        ...(isRetry
          ? { resumeSessionId: sessionId }
          : { sessionId }),
        onProgress: (p) => {
          setPhase(p);

          if (p.phase === "reviewing") {
            const f = p as { fileName: string };
            setCompletedFiles((prev) => {
              const next = new Set(prev);
              next.add(f.fileName);
              return next;
            });
          }
          if (p.phase === "complete") {
            setCurrentHints(p.hints);
            setCompletedFiles(new Set(detected.map((d) => d.fileName)));
          }
        },
      });

      // Success — clear saved session (already deleted inside pipeline, but be safe)
      setActiveSessionId(null);

      // Build staging rows
      const allRows: HistoricalExtractionRow[] = [];
      for (const { structuredResult } of result.fileResults) {
        const projected = projectStep2BankStructuredToRows(structuredResult);
        allRows.push(...projected.map((r) => ({ ...r, id: uid(), yoyGrowth: 0 })));
      }

      // Inject derived Q4 rows
      const withQ4 = injectDerivedQ4Rows(allRows, uid);

      // Distinct years covered
      const stagingYears = [...new Set(withQ4.map((r) => r.fiscalYear))].sort((a, b) => a - b);

      onComplete({
        rows: withQ4,
        stagingYears,
        hints: result.hints,
        fileResults: result.fileResults,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extraction failed.";
      setErrorMsg(msg);
      setPhase({ phase: "error", message: msg });
      // activeSessionId is intentionally preserved so Retry can resume
    } finally {
      setIsRunning(false);
    }
  }, [
    detected,
    hasLimitError,
    architecture,
    provider,
    apiKey,
    companyName,
    currentHints,
    onComplete,
    phase,
    activeSessionId,
  ]);

  // ── Progress bar fraction ─────────────────────────────────────────────────
  const progressFraction = detected.length > 0
    ? completedFiles.size / detected.length
    : 0;

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="space-y-4 rounded-xl border border-blue-800/40 bg-zinc-900/60 p-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-blue-300">
            <FileText size={15} />
            Multi-Period PDF Filing Upload
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Upload annual 10-K and quarterly 10-Q PDFs — processed sequentially,
            hints learned after first filing of each type.
          </p>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* ── Naming convention guide ────────────────────────────────────────── */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-950">
        <button
          type="button"
          onClick={() => setGuideOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          <Info size={13} className="shrink-0 text-blue-400" />
          <span className="flex-1 text-xs font-medium text-zinc-300">Filename convention</span>
          {guideOpen ? (
            <ChevronDown size={12} className="text-zinc-500" />
          ) : (
            <ChevronRight size={12} className="text-zinc-500" />
          )}
        </button>
        {guideOpen && (
          <div className="border-t border-zinc-800 px-3 pb-3 pt-2 text-xs text-zinc-400">
            <p className="mb-1.5 font-medium text-zinc-300">Required naming format:</p>
            <div className="space-y-1 rounded bg-zinc-900 p-2 font-mono text-[11px]">
              <div>
                <span className="text-amber-400">10-K&nbsp;</span>
                <span className="text-zinc-300">TICKER-10K-YYYY.pdf</span>
                <span className="ml-3 font-sans text-zinc-600">e.g. JPM-10K-2024.pdf</span>
              </div>
              <div>
                <span className="text-blue-400">10-Q&nbsp;</span>
                <span className="text-zinc-300">TICKER-10Q-Qn-YYYY.pdf</span>
                <span className="ml-3 font-sans text-zinc-600">e.g. JPM-10Q-Q2-2023.pdf</span>
              </div>
            </div>
            <ul className="mt-2 space-y-0.5 text-zinc-500">
              <li>• Up to {MAX_10K_FILES} annual (10-K) + {MAX_10Q_FILES} quarterly (10-Q) files</li>
              <li>• Q1, Q2, Q3 only — Q4 is derived automatically from Annual − Q1 − Q2 − Q3</li>
              <li>• Separators can be dash (-), underscore (_), or space</li>
            </ul>
          </div>
        )}
      </div>

      {/* ── Drop zone ─────────────────────────────────────────────────────── */}
      {!isRunning && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-700 bg-zinc-950 px-4 py-6 transition-colors hover:border-blue-600 hover:bg-blue-950/10"
        >
          <Upload size={22} className="text-zinc-600" />
          <p className="text-sm text-zinc-400">Drop PDFs here or click to browse</p>
          <p className="text-xs text-zinc-600">PDF only · max {MAX_TOTAL_PDF_FILES} files</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      )}

      {/* ── Detected file list ─────────────────────────────────────────────── */}
      {detected.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-zinc-400">
              Detected ({detected.length}) — {summariseFilings(detected)}
            </p>
            {!isRunning && (
              <button
                type="button"
                onClick={() => {
                  setDetected([]);
                  setDetectionErrors([]);
                  if (activeSessionId) {
                    void deleteMfSession(activeSessionId);
                    setActiveSessionId(null);
                  }
                  setCompletedFiles(new Set());
                  setPhase({ phase: "idle" });
                  setErrorMsg(null);
                }}
                className="text-[11px] text-zinc-600 hover:text-red-400"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Limits warnings */}
          {overLimit10K && (
            <p className="text-xs text-red-400">
              ⚠ Too many 10-K files ({tenKCount}/{MAX_10K_FILES}). Remove extras.
            </p>
          )}
          {overLimit10Q && (
            <p className="text-xs text-red-400">
              ⚠ Too many 10-Q files ({tenQCount}/{MAX_10Q_FILES}). Remove extras.
            </p>
          )}

          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {detected.map((filing) => (
              <div
                key={filing.fileName}
                className="flex items-center gap-2 rounded-md bg-zinc-800/60 px-2.5 py-1.5"
              >
                {fileStatusIcon(filing, completedFiles, processingFile)}
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
                  {filing.fileName}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    filing.filingType === "10-K"
                      ? "bg-amber-900/40 text-amber-300"
                      : "bg-blue-900/40 text-blue-300"
                  }`}
                >
                  {filing.filingType}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-500">
                  {filing.year} {periodLabel(filing)}
                </span>
                {!isRunning && (
                  <button
                    type="button"
                    onClick={() => removeFiling(filing.fileName)}
                    className="shrink-0 text-zinc-600 hover:text-red-400"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Detection errors ───────────────────────────────────────────────── */}
      {detectionErrors.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-amber-400">
            ⚠ {detectionErrors.length} file(s) could not be detected:
          </p>
          {detectionErrors.map((err) => (
            <div
              key={err.fileName}
              className="flex items-start gap-2 rounded-md bg-amber-900/20 px-2.5 py-1.5"
            >
              <AlertCircle size={12} className="mt-0.5 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-amber-300">{err.fileName}</p>
                <p className="text-[11px] text-amber-500">{err.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => removeError(err.fileName)}
                className="shrink-0 text-zinc-600 hover:text-red-400"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Hints indicator ────────────────────────────────────────────────── */}
      {(currentHints?.tenK || currentHints?.tenQ) && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-950">
          <button
            type="button"
            onClick={() => setHintsOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
          >
            <Lightbulb size={13} className="shrink-0 text-yellow-400" />
            <span className="flex-1 text-xs text-zinc-300">
              Filing hints available
              {currentHints.tenK && (
                <span className="ml-1.5 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-300">
                  10-K v{currentHints.tenK.version}
                </span>
              )}
              {currentHints.tenQ && (
                <span className="ml-1 rounded bg-blue-900/30 px-1.5 py-0.5 text-[10px] text-blue-300">
                  10-Q v{currentHints.tenQ.version}
                </span>
              )}
            </span>
            {hintsOpen ? (
              <ChevronDown size={12} className="text-zinc-500" />
            ) : (
              <ChevronRight size={12} className="text-zinc-500" />
            )}
          </button>
          {hintsOpen && (
            <div className="border-t border-zinc-800 px-3 pb-3 pt-2 text-[11px] text-zinc-500">
              {currentHints.tenK && (
                <p>
                  <span className="font-medium text-amber-400">10-K hints</span>
                  {" — "}last updated from{" "}
                  <span className="text-zinc-400">{currentHints.tenK.lastUpdatedByFile}</span>.{" "}
                  {Object.keys(currentHints.tenK.metricLocations).length} metrics mapped.
                  {currentHints.tenK.generalNotes && (
                    <span className="ml-1 text-zinc-500"> {currentHints.tenK.generalNotes}</span>
                  )}
                </p>
              )}
              {currentHints.tenQ && (
                <p className="mt-1">
                  <span className="font-medium text-blue-400">10-Q hints</span>
                  {" — "}last updated from{" "}
                  <span className="text-zinc-400">{currentHints.tenQ.lastUpdatedByFile}</span>.{" "}
                  {Object.keys(currentHints.tenQ.metricLocations).length} metrics mapped.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Progress bar (while running) ───────────────────────────────────── */}
      {isRunning && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 size={13} className="shrink-0 animate-spin text-blue-400" />
            <p className="text-xs text-zinc-300">{phaseLabel(phase, detected.length)}</p>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${Math.max(3, progressFraction * 100).toFixed(0)}%` }}
            />
          </div>
          <p className="text-[11px] text-zinc-600">
            {completedFiles.size}/{detected.length} files complete
            {phase.phase === "generating-hints" && " · generating hints…"}
          </p>
        </div>
      )}

      {/* ── Error message ──────────────────────────────────────────────────── */}
      {errorMsg && !isRunning && (
        <div className="flex items-start gap-2 rounded-lg bg-red-900/20 px-3 py-2.5 text-xs text-red-400">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ── Actions ───────────────────────────────────────────────────────── */}
      {!isRunning && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={detected.length === 0 || hasLimitError}
            onClick={handleStart}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileText size={14} />
            Start Extraction ({detected.length} file{detected.length !== 1 ? "s" : ""})
          </button>
          {phase.phase === "error" && activeSessionId && (
            <button
              type="button"
              onClick={handleStart}
              className="rounded-lg border border-blue-700/50 bg-blue-950/20 px-3 py-2.5 text-sm text-blue-300 hover:bg-blue-900/30"
              title={`Resume from where extraction stopped (${completedFiles.size}/${detected.length} files already done)`}
            >
              Resume ({completedFiles.size}/{detected.length})
            </button>
          )}
        </div>
      )}

      {isRunning && (
        <p className="text-center text-xs text-zinc-600">
          Processing sequentially — please keep this tab open.
        </p>
      )}
    </div>
  );
}
