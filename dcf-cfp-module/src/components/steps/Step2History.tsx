"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  Upload,
  FileText,
  FileSpreadsheet,
  Braces,
  Loader2,
  Download,
  Trash2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database,
  Plus,
  X,
  RefreshCw,
  Pause,
  RotateCcw,
} from "lucide-react";
import * as XLSX from "xlsx";
import StepShell from "./StepShell";
import { useSettings } from "@/context/SettingsContext";
import { useCFP } from "@/context/CFPContext";
import {
  detectFiscalYearsFromRecords,
  detectFiscalYearsFromText,
  mergeHistoryYears,
  normalizeFiscalYearSelection,
} from "@/lib/step2-baseline";
import {
  recordsFromDcfInputPayload,
  summarizeDcfInputPayload,
  type DcfInputSummary,
} from "@/lib/step2-fixture-ingest";
import {
  runExtractionPipeline,
  type PipelinePhase,
  type PipelineYearResult,
} from "@/lib/extraction-pipeline";
import Step2FilingUploader, {
  type FilingUploaderResult,
} from "./Step2FilingUploader";
import {
  getIncompleteManifests,
  clearAllSessions,
  type PipelineManifest,
} from "@/lib/extraction-state";
import { projectStep2StructuredToRows } from "@/lib/step2-schema";
import { projectStep2BankStructuredToRows } from "@/lib/step2-bank-schema";
import type { Step2BankStructuredResult } from "@/lib/step2-bank-schema";
import type { Step2StructuredResult } from "@/lib/step2-schema";
import type { HistoricalExtractionRow, ExtractHistoryResponse, WorkflowMode } from "@/types/cfp";

// =============================================================================
// Constants
// =============================================================================
const MAX_YEARS = 5;
const MAX_FILES = 4;
const ACCEPTED_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/json",
  ".json",
  "text/csv",
  "text/plain",
].join(",");

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm" || ext === "csv") {
    return <FileSpreadsheet size={14} className="shrink-0 text-emerald-400" />;
  }
  if (ext === "json") {
    return <Braces size={14} className="shrink-0 text-violet-400" />;
  }
  return <FileText size={14} className="shrink-0 text-blue-400" />;
}

function formatNullableMetric(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function parseNullableMetric(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type Step2StructuredResultForReview = NonNullable<ExtractHistoryResponse["structuredResult"]>;

async function detectFiscalYearsFromFile(file: File): Promise<number[]> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "txt") {
    return detectFiscalYearsFromText(await file.text());
  }

  if (ext === "json") {
    const text = await file.text();
    try {
      const records = recordsFromDcfInputPayload(JSON.parse(text));
      if (records.length > 0) {
        return detectFiscalYearsFromRecords(records, Number.MAX_SAFE_INTEGER);
      }
    } catch {
      // Fall back to text scanning for loosely structured JSON-like notes.
    }
    return detectFiscalYearsFromText(text);
  }

  if (ext === "csv" || ext === "xlsx" || ext === "xls" || ext === "xlsm") {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const years: number[] = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      years.push(...detectFiscalYearsFromRecords(records, Number.MAX_SAFE_INTEGER));
    }

    return normalizeFiscalYearSelection(years);
  }

  return [];
}

async function summarizeDcfInputFromFile(file: File): Promise<DcfInputSummary | null> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext !== "json") return null;

  try {
    return summarizeDcfInputPayload(JSON.parse(await file.text()));
  } catch {
    return null;
  }
}

// =============================================================================
// Step 2 — Historical Financials
// =============================================================================
export default function Step2History() {
  const { state, dispatch } = useCFP();
  const { settings, activeApiKey } = useSettings();

  const step1Input = state.profile.step1StructuredResult ?? state.profile.architectureJson;
  const hasArchitecture = !!step1Input;

  // ── Form inputs ─────────────────────────────────────────────────────────────
  const [targetYear, setTargetYear] = useState("");
  const [detectedYears, setDetectedYears] = useState<number[]>([]);
  const [dcfInputSummary, setDcfInputSummary] = useState<DcfInputSummary | null>(null);
  const [dataFiles, setDataFiles] = useState<File[]>([]);
  const [textNotes, setTextNotes] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Pipeline state ────────────────────────────────────────────────────────────
  const [isExtracting, setIsExtracting] = useState(false);
  const [pipelinePhase, setPipelinePhase] = useState<PipelinePhase>({ phase: "idle" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Session that can be resumed (found in IndexedDB on mount). */
  const [incompleteSession, setIncompleteSession] = useState<PipelineManifest | null>(null);
  /** Session ID of the currently paused run (usage-exhausted). */
  const [pausedSessionId, setPausedSessionId] = useState<string | null>(null);

  // Keep extractingYear alias for legacy progress label compatibility
  const extractingYear: number | null =
    pipelinePhase.phase === "reducing"
      ? pipelinePhase.year
      : pipelinePhase.phase === "reviewing"
        ? pipelinePhase.year
        : null;

  // ── Staging rows (editable before confirming to master) ──────────────────────
  const [stagingRows, setStagingRows] = useState<HistoricalExtractionRow[]>([]);
  const [stagingYears, setStagingYears] = useState<number[]>([]);
  const [structuredResults, setStructuredResults] = useState<Step2StructuredResultForReview[]>([]);

  // ── Bank/finance mode detection for PDF uploader ────────────────────────────
  const companyTypeForPdf = state.profile.step1StructuredResult?.company_type;
  const isBankOrFinancial =
    companyTypeForPdf === "financial_bank" ||
    companyTypeForPdf === "financial_insurance" ||
    companyTypeForPdf === "financial_other" ||
    companyTypeForPdf === "hybrid";
  const [showPdfUploader, setShowPdfUploader] = useState(isBankOrFinancial);

  // Auto-enable PDF mode when company_type is resolved to a financial/hybrid type
  // (handles JSON-restore and any other path where context updates while Step 2 is mounted)
  useEffect(() => {
    if (isBankOrFinancial) setShowPdfUploader(true);
  }, [isBankOrFinancial]);

  // ── Master history from context ──────────────────────────────────────────────
  const masterRows = state.history.rows;
  const confirmedYears = state.history.confirmedYears;
  const canAddMoreYears = confirmedYears.length < MAX_YEARS;

  const hasStagingData = stagingRows.length > 0;
  const yearsToExtract = useMemo(() => {
    const manualYear = Number(targetYear.trim());
    if (targetYear.trim() && Number.isInteger(manualYear)) {
      return normalizeFiscalYearSelection([manualYear], 1);
    }
    return detectedYears.filter((year) => !confirmedYears.includes(year));
  }, [confirmedYears, detectedYears, targetYear]);

  // ── On mount: check for incomplete sessions in IndexedDB ──────────────────
  useEffect(() => {
    getIncompleteManifests()
      .then((manifests) => {
        if (manifests.length > 0) {
          // Show the most recent incomplete session
          const latest = manifests.sort((a, b) => b.updatedAt - a.updatedAt)[0];
          setIncompleteSession(latest);
        }
      })
      .catch((err) => console.warn("[Step2History] Could not read IndexedDB:", err));
  }, []);

  // ── Fiscal year detection from uploaded files ───────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function detectYears() {
      const years: number[] = [];
      let nextDcfInputSummary: DcfInputSummary | null = null;
      years.push(...detectFiscalYearsFromText(textNotes));

      for (const file of dataFiles) {
        years.push(...(await detectFiscalYearsFromFile(file)));
        nextDcfInputSummary ??= await summarizeDcfInputFromFile(file);
      }

      if (!cancelled) {
        setDetectedYears(normalizeFiscalYearSelection(years));
        setDcfInputSummary(nextDcfInputSummary);
      }
    }

    void detectYears().catch((error) => {
      console.warn("[Step2History] Failed to detect fiscal years:", error);
      if (!cancelled) {
        setDetectedYears([]);
        setDcfInputSummary(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [dataFiles, textNotes]);

  // Group master rows by segment for the read-only accordion
  const groupedMaster = useMemo(() => {
    const groups: Record<string, HistoricalExtractionRow[]> = {};
    const sorted = [...masterRows].sort((a, b) => {
      if (a.segment !== b.segment) return a.segment.localeCompare(b.segment);
      if (a.fiscalYear !== b.fiscalYear) return a.fiscalYear - b.fiscalYear;
      return a.quarter.localeCompare(b.quarter);
    });
    for (const row of sorted) {
      const key = row.segment || "Unassigned";
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }
    return groups;
  }, [masterRows]);

  // ============================================================================
  // Pipeline extraction handler
  // ============================================================================
  const handleExtract = useCallback(
    async (resumeSessionId?: string) => {
      const selectedYears = yearsToExtract;

      if (!resumeSessionId) {
        if (selectedYears.length === 0) {
          setErrorMsg(
            targetYear.trim()
              ? "Please enter a valid fiscal year (e.g. 2025)."
              : "Upload a file or paste notes containing fiscal years, such as 2021-2025.",
          );
          return;
        }
        const duplicateYears = selectedYears.filter((year) => confirmedYears.includes(year));
        if (duplicateYears.length > 0) {
          setErrorMsg(
            `Year ${duplicateYears.join(", ")} already exists in the historical baseline.`,
          );
          return;
        }
        if (confirmedYears.length + selectedYears.length > MAX_YEARS) {
          setErrorMsg(
            `Maximum of ${MAX_YEARS} distinct years reached. Remove history to add more.`,
          );
          return;
        }
        if (dataFiles.length === 0 && !textNotes.trim()) {
          setErrorMsg("Please upload a file or paste text notes.");
          return;
        }
      }

      setErrorMsg(null);
      setIsExtracting(true);
      setPipelinePhase({ phase: "preparing", step: 1, totalSteps: 1, detail: "Starting…" });
      setStagingRows([]);
      setStagingYears([]);
      setStructuredResults([]);
      setPausedSessionId(null);

      try {
        const companyType = state.profile.step1StructuredResult?.company_type;
        const allSegments = state.profile.step1StructuredResult?.analysis_view.segments ?? [];
        const bankSegments = allSegments.filter((s) => s.workflow_mode === "bank");
        const industrialSegments = allSegments.filter((s) => s.workflow_mode !== "bank");
        const isHybrid =
          companyType === "hybrid" && bankSegments.length > 0 && industrialSegments.length > 0;
        const isFinancial =
          companyType === "financial_bank" ||
          companyType === "financial_insurance" ||
          companyType === "financial_other";

        const resolvedCompanyName =
          (step1Input &&
            typeof step1Input === "object" &&
            "company_name" in (step1Input as object) &&
            typeof (step1Input as unknown as Record<string, unknown>).company_name === "string"
            ? (step1Input as unknown as Record<string, unknown>).company_name as string
            : null) ?? "Unknown Company";

        const basePipelineOptions = {
          files: dataFiles,
          textNotes,
          targetYears: selectedYears,
          provider: settings.llmProvider,
          apiKey: activeApiKey,
          companyName: resolvedCompanyName,
          onProgress: (phase: PipelinePhase) => {
            setPipelinePhase(phase);
          },
        };

        const nextRows: HistoricalExtractionRow[] = [];
        const nextStructuredResults: Step2StructuredResultForReview[] = [];

        const appendYearResults = (
          years: PipelineYearResult[],
          mode: WorkflowMode,
        ) => {
          for (const yearResult of years) {
            const rows =
              mode === "bank"
                ? projectStep2BankStructuredToRows(
                    yearResult.structuredResult as Step2BankStructuredResult,
                  )
                : projectStep2StructuredToRows(
                    yearResult.structuredResult as Step2StructuredResult,
                  );
            nextRows.push(...rows.map((r) => ({ ...r, id: uid(), yoyGrowth: 0 })));
            nextStructuredResults.push(yearResult.structuredResult);
          }
        };

        if (isHybrid) {
          // Run bank and industrial pipelines in parallel
          const [bankResult, industrialResult] = await Promise.all([
            runExtractionPipeline({
              ...basePipelineOptions,
              architecture: step1Input,
              workflowMode: "bank",
              onProgress: (phase) => setPipelinePhase(phase),
            }),
            runExtractionPipeline({
              ...basePipelineOptions,
              architecture: step1Input,
              workflowMode: "industrial",
              onProgress: (phase) => setPipelinePhase(phase),
            }),
          ]);
          appendYearResults(bankResult.years, "bank");
          appendYearResults(industrialResult.years, "industrial");
        } else {
          const workflowMode: WorkflowMode =
            isFinancial || companyType === "hybrid" ? "bank" : "industrial";
          const result = await runExtractionPipeline({
            ...basePipelineOptions,
            architecture: step1Input,
            workflowMode,
            resumeSessionId,
          });
          appendYearResults(result.years, workflowMode);
        }

        if (nextRows.length === 0) {
          setErrorMsg("No rows were extracted across all target years.");
          return;
        }

        setStagingRows(nextRows);
        setStagingYears(selectedYears);
        setStructuredResults(nextStructuredResults);
        setIncompleteSession(null);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "UsageExhaustedError") {
          // Session ID is already emitted via onProgress — don't overwrite
          return;
        }
        const msg = err instanceof Error ? err.message : "Extraction failed.";
        setErrorMsg(msg);
        setPipelinePhase({ phase: "error", message: msg });
      } finally {
        setIsExtracting(false);
      }
    },
    [
      targetYear,
      yearsToExtract,
      dataFiles,
      textNotes,
      activeApiKey,
      settings.llmProvider,
      step1Input,
      confirmedYears,
      state.profile.step1StructuredResult,
    ],
  );

  // Handle usage-exhausted paused session ID from pipeline progress
  useEffect(() => {
    if (pipelinePhase.phase === "usage-exhausted") {
      setPausedSessionId(pipelinePhase.sessionId);
    }
  }, [pipelinePhase]);

  // ── Staging: edit a cell ─────────────────────────────────────────────────────
  const updateStagingCell = (
    id: string,
    field: keyof HistoricalExtractionRow,
    value: string | number | null,
  ) => {
    setStagingRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  // ── PDF uploader completion handler ─────────────────────────────────────────
  const handlePdfUploaderComplete = useCallback(
    (result: FilingUploaderResult) => {
      // Stage rows for review
      setStagingRows(result.rows);
      setStagingYears(result.stagingYears);
      setStructuredResults(result.fileResults.map((fr) => fr.structuredResult));

      // Persist hints to context so they survive JSON save/reload
      dispatch({ type: "SET_FILING_HINTS", payload: result.hints });

      // Scroll to staging section
      setTimeout(() => {
        document.getElementById("step2-staging")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    },
    [dispatch],
  );

  // ── Confirm staging → append to master ──────────────────────────────────────
  const handleConfirm = () => {
    if (stagingRows.length === 0) return;
    dispatch({
      type: "SET_HISTORY",
      payload: {
        rows: [...masterRows, ...stagingRows],
        confirmedYears: mergeHistoryYears(confirmedYears, stagingYears),
        structuredResults: [
          ...(state.history.structuredResults ?? []),
          ...structuredResults,
        ],
        // Preserve hints when confirming
        filingHints: state.history.filingHints,
      },
    });
    setStagingRows([]);
    setStagingYears([]);
    setStructuredResults([]);
    setTargetYear("");
    setDataFiles([]);
    setTextNotes("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Excel download ───────────────────────────────────────────────────────────
  const handleExcelDownload = () => {
    if (masterRows.length === 0) return;
    const exportData = masterRows.map((row) => ({
      fiscalYear: row.fiscalYear,
      quarter: row.quarter,
      segment: row.segment,
      productCategory: row.productCategory,
      productName: row.productName,
      revenue: row.revenue,
      yoyGrowth: row.yoyGrowth,
      operatingIncome: row.operatingIncome,
      notes: row.notes,
      reviewStatus: row.reviewStatus,
      internalVerify: row.internalVerify,
      sourceType: row.sourceType,
      sourceName: row.sourceName,
      sourceLink: row.sourceLink,
      reviewNote: row.reviewNote,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master History");
    const now = new Date();
    const safeName = (state.profile.companyName || "company")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .toLowerCase();
    XLSX.writeFile(
      wb,
      `${safeName}-step2-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${now.getFullYear()}.xlsx`,
    );
  };

  // ── File picker ──────────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files ?? []);
    setDataFiles((prev) => {
      const merged = [...prev, ...incoming];
      return merged.slice(0, MAX_FILES);
    });
    // Reset the input so the same file can be re-added after removal
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setDataFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <StepShell
      stepNumber={2}
      title="Historical Financials"
      subtitle="Upload Excel, CSV, or text exports and let the AI map them to segment data."
    >
      {/* ── Architecture gate ──────────────────────────────────────────────── */}
      {!hasArchitecture && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/30 p-4 text-sm text-amber-300">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Step 1 architecture not found</p>
            <p className="mt-1 text-xs text-amber-400/70">
              Complete Step 1 first — the segment architecture guides data extraction.
            </p>
          </div>
        </div>
      )}

      {hasArchitecture && (
        <div className="space-y-8">

          {/* ================================================================ */}
          {/*  EXTRACTION FORM                                                 */}
          {/* ================================================================ */}
          <section className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Build Historical Baseline
              </h3>
              <div className="flex items-center gap-3">
                {/* Mode toggle: only shown for bank/finance companies */}
                {isBankOrFinancial && (
                  <button
                    type="button"
                    onClick={() => setShowPdfUploader((v) => !v)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      showPdfUploader
                        ? "bg-blue-700/30 text-blue-300 hover:bg-blue-700/50"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                    title={
                      companyTypeForPdf === "hybrid"
                        ? showPdfUploader
                          ? "Switch to Dual Pipeline — runs bank + industrial extraction from uploaded files"
                          : "Switch to PDF Mode — extracts bank segment metrics from 10-K/10-Q filings"
                        : showPdfUploader
                          ? "Switch to manual/spreadsheet upload"
                          : "Switch to PDF multi-filing upload"
                    }
                  >
                    {showPdfUploader
                      ? "📄 PDF Mode"
                      : companyTypeForPdf === "hybrid" ? "📊 Dual Pipeline" : "📊 Standard Mode"}
                  </button>
                )}
                <span className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono">
                    {confirmedYears.length}/{MAX_YEARS}
                  </span>
                  years confirmed
                  {confirmedYears.length > 0 && (
                    <span className="text-zinc-600">({confirmedYears.join(", ")})</span>
                  )}
                </span>
              </div>
            </div>

            {/* ── PDF Multi-File Uploader (bank/hybrid bank segments) ───────── */}
            {isBankOrFinancial && showPdfUploader && (
              <>
                <Step2FilingUploader
                  architecture={step1Input}
                  provider={settings.llmProvider}
                  apiKey={activeApiKey}
                  companyName={
                    (step1Input &&
                      typeof step1Input === "object" &&
                      "company_name" in (step1Input as object)
                      ? String((step1Input as unknown as Record<string, unknown>).company_name ?? "")
                      : null) ??
                    state.profile.companyName ??
                    "Unknown Company"
                  }
                  seedHints={state.history.filingHints}
                  onComplete={handlePdfUploaderComplete}
                  onCancel={() => setShowPdfUploader(false)}
                />
                {/* Hybrid: warn that PDF mode covers bank segments only */}
                {companyTypeForPdf === "hybrid" && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400/80">
                    <span className="shrink-0">⚡</span>
                    <span>
                      Hybrid company detected. PDF mode extracts <strong className="text-amber-300">bank segment</strong> metrics only.{" "}
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-amber-300"
                        onClick={() => setShowPdfUploader(false)}
                      >
                        Switch to Dual Pipeline
                      </button>{" "}
                      to also run industrial segment extraction from uploaded files.
                    </span>
                  </div>
                )}
              </>
            )}

            {/* WorkflowModePanel — always visible for non-industrial companies in both modes */}
            {state.profile.step1StructuredResult?.company_type &&
              state.profile.step1StructuredResult.company_type !== "industrial" && (
                <WorkflowModePanel
                  companyType={state.profile.step1StructuredResult.company_type}
                  segments={state.profile.step1StructuredResult.analysis_view.segments}
                  onToggle={(segmentId, workflowMode) =>
                    dispatch({ type: "UPDATE_SEGMENT_WORKFLOW_MODE", payload: { segmentId, workflowMode } })
                  }
                  disabled={isExtracting}
                />
              )}

            {/* ── Standard upload form (hidden when PDF mode is active for bank) ── */}
            {(!isBankOrFinancial || !showPdfUploader) && (
              <>

            {/* Year detection */}
            <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
              <div>
                <p className="text-sm font-medium text-zinc-200">Detected fiscal years</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Upload a full history file or complete DCF JSON and Step 2 will extract the
                  latest five fiscal years into one DCF baseline.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detectedYears.length > 0 ? (
                    detectedYears.map((year) => (
                      <span
                        key={year}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          confirmedYears.includes(year)
                            ? "bg-emerald-600/15 text-emerald-300"
                            : "bg-blue-600/15 text-blue-300"
                        }`}
                      >
                        FY {year}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-500">
                      No years detected yet
                    </span>
                  )}
                </div>
              </div>
              <div>
              <label htmlFor="target-year" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Optional single-year override
              </label>
              <input
                id="target-year"
                type="text"
                inputMode="numeric"
                placeholder="Leave blank for full baseline"
                value={targetYear}
                onChange={(e) => setTargetYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                disabled={isExtracting || !canAddMoreYears}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
              <p className="mt-1.5 text-xs text-zinc-600">
                Use only when you want to re-run one fiscal year.
              </p>
              </div>
            </div>

            <DcfInputPackageSummary summary={dcfInputSummary} compact />

            {/* File upload area */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">
                Data Files
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  .json · .xlsx · .csv · .txt (max {MAX_FILES})
                </span>
              </label>

              {/* Drop zone */}
              {dataFiles.length < MAX_FILES && (
                <label
                  htmlFor="data-files"
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-700 py-6 text-sm text-zinc-500 transition-colors hover:border-blue-500/50 hover:text-zinc-300 ${isExtracting ? "pointer-events-none opacity-50" : ""}`}
                >
                  <Upload size={22} className="text-zinc-600" />
                  <span>
                    Drag &amp; drop or{" "}
                    <span className="text-blue-400 underline-offset-2 hover:underline">
                      browse
                    </span>
                  </span>
                  <span className="text-xs text-zinc-600">
                    Complete DCF JSON, Excel exports, quarterly CSV, or pasted-as-txt
                  </span>
                  <input
                    ref={fileInputRef}
                    id="data-files"
                    type="file"
                    accept={ACCEPTED_MIME}
                    multiple
                    disabled={isExtracting}
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>
              )}

              {/* File list */}
              {dataFiles.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {dataFiles.map((f, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-1.5"
                    >
                      {fileIcon(f.name)}
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
                        {f.name}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-600">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                      {!isExtracting && (
                        <button
                          onClick={() => removeFile(i)}
                          className="shrink-0 text-zinc-600 hover:text-red-400"
                          aria-label={`Remove ${f.name}`}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Text notes textarea */}
            <div>
              <label htmlFor="text-notes" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Text Notes
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  optional — paste raw data or context here
                </span>
              </label>
              <textarea
                id="text-notes"
                rows={5}
                placeholder={
                  "Paste any raw financial text, copied table rows, or analyst notes here…\n\n" +
                  "Example:\nQ1 2023 — Creative Cloud: $1,233M revenue, $456M operating income\n" +
                  "Q2 2023 — Document Cloud: $741M revenue, $302M operating income"
                }
                value={textNotes}
                onChange={(e) => setTextNotes(e.target.value)}
                disabled={isExtracting}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 font-mono leading-relaxed resize-y"
              />
            </div>

            {/* Resume banner — shown when an incomplete session exists in IndexedDB */}
            {incompleteSession && !isExtracting && (
              <ResumeBanner
                manifest={incompleteSession}
                onResume={() => {
                  setIncompleteSession(null);
                  void handleExtract(incompleteSession.sessionId);
                }}
                onDiscard={async () => {
                  const { deleteSession } = await import("@/lib/extraction-state");
                  await deleteSession(incompleteSession.sessionId);
                  setIncompleteSession(null);
                }}
              />
            )}

            {/* Pipeline progress */}
            {isExtracting && pipelinePhase.phase !== "idle" && (
              <PipelineProgressDisplay phase={pipelinePhase} />
            )}

            {/* Usage-exhausted banner */}
            {pipelinePhase.phase === "usage-exhausted" && !isExtracting && (
              <UsageExhaustedBanner
                phase={pipelinePhase}
                onAutoResume={() => {
                  void handleExtract(pipelinePhase.sessionId);
                }}
                onSaveAndClose={() => {
                  setPausedSessionId(pipelinePhase.sessionId);
                  setPipelinePhase({ phase: "idle" });
                }}
              />
            )}

            {/* Error banner */}
            {errorMsg && (
              <div className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-950/30 p-3 text-sm text-red-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {errorMsg}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={() => void handleExtract()}
              disabled={isExtracting || !canAddMoreYears}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
            >
              {isExtracting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  {extractingYear ? `Processing FY ${extractingYear}…` : "Running pipeline…"}
                </>
              ) : (
                <>
                  <Plus size={16} />
                  Extract Full Historical Baseline
                </>
              )}
            </button>

            </> /* end standard-upload conditional */
            )}
          </section>

          {/* ================================================================ */}
          {/*  STAGING AREA (editable before confirming to master)             */}
          {/* ================================================================ */}
          {hasStagingData && (
            <section id="step2-staging" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
                  Historical Baseline Staging {stagingYears.length > 0 ? `— FY ${stagingYears.join(", ")}` : ""}
                </h3>
                <span className="rounded bg-amber-900/30 px-2 py-0.5 text-xs text-amber-300">
                  {stagingRows.length} rows · {stagingYears.length} year(s) — review before confirming
                </span>
              </div>

              <Step2ReviewSummary results={structuredResults} />

              <DcfInputPackageSummary summary={dcfInputSummary} />

              <div className="overflow-x-auto rounded-lg border border-zinc-700">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-800 text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Qtr</th>
                      <th className="px-3 py-2 font-medium">Segment</th>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 font-medium text-right">Revenue ($M)</th>
                      <th className="px-3 py-2 font-medium text-right">Op. Income ($M)</th>
                      <th className="px-3 py-2 font-medium">Internal?</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Review Note</th>
                      <th className="px-3 py-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {stagingRows.map((row) => (
                      <tr key={row.id} className="bg-zinc-900/50 hover:bg-zinc-800/50">
                        <td className="px-3 py-1.5 text-zinc-300">{row.quarter}</td>
                        <td className="px-3 py-1.5 text-zinc-300">{row.segment}</td>
                        <td className="px-3 py-1.5 text-zinc-400">{row.productCategory}</td>
                        <td className="px-3 py-1.5 text-zinc-400">{row.productName}</td>
                        <td className="px-1 py-1">
                          <input
                            type="number"
                            step="any"
                            value={row.revenue ?? ""}
                            onChange={(e) =>
                              updateStagingCell(row.id, "revenue", parseNullableMetric(e.target.value))
                            }
                            placeholder="—"
                            className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-xs text-zinc-100 outline-none focus:border-blue-500"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="number"
                            step="any"
                            value={row.operatingIncome ?? ""}
                            onChange={(e) =>
                              updateStagingCell(
                                row.id,
                                "operatingIncome",
                                parseNullableMetric(e.target.value),
                              )
                            }
                            placeholder="—"
                            className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-xs text-zinc-100 outline-none focus:border-blue-500"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-zinc-400">
                          {row.internalVerify ?? "No"}
                        </td>
                        <td
                          className="max-w-[140px] truncate px-3 py-1.5 text-zinc-400"
                          title={row.sourceLink && row.sourceLink !== "Not available"
                            ? `${row.sourceName ?? "Not available"} — ${row.sourceLink}`
                            : row.sourceName ?? "Not available"}
                        >
                          {row.sourceName ?? "Not available"}
                        </td>
                        <td
                          className="max-w-[180px] truncate px-3 py-1.5 text-amber-300/80"
                          title={row.reviewNote ?? row.reviewStatus ?? ""}
                        >
                          {row.reviewNote ?? row.reviewStatus ?? "External Verification Required"}
                        </td>
                        <td
                          className="max-w-[140px] truncate px-3 py-1.5 text-zinc-500"
                          title={row.notes}
                        >
                          {row.notes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={handleConfirm}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                <CheckCircle2 size={16} />
                Confirm Historical Baseline
              </button>
            </section>
          )}

          {/* ================================================================ */}
          {/*  MASTER HISTORY (read-only, grouped by segment)                  */}
          {/* ================================================================ */}
          {masterRows.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-400">
                  Master History
                </h3>
                <span className="text-xs text-zinc-500">
                  {masterRows.length} rows · {confirmedYears.length} year(s)
                </span>
              </div>

              <div className="space-y-3">
                {Object.entries(groupedMaster).map(([segment, rows]) => (
                  <SegmentGroup key={segment} segment={segment} rows={rows} />
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={handleExcelDownload}
                  className="flex items-center gap-2 rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-5 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-600/20"
                >
                  <Download size={16} />
                  Download Master Excel Sheet
                </button>
                <button
                  onClick={() => dispatch({ type: "CLEAR_HISTORY" })}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm text-zinc-400 transition-colors hover:border-red-700/50 hover:text-red-400"
                >
                  <Trash2 size={16} />
                  Clear All History
                </button>
                <button
                  onClick={async () => {
                    await clearAllSessions();
                    setIncompleteSession(null);
                    setPausedSessionId(null);
                    setPipelinePhase({ phase: "idle" });
                  }}
                  className="flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm text-zinc-500 transition-colors hover:border-amber-700/50 hover:text-amber-400"
                  title="Clear IndexedDB pipeline cache (use for troubleshooting)"
                >
                  <RotateCcw size={15} />
                  Clear Cache
                </button>
              </div>
            </section>
          )}

        </div>
      )}
    </StepShell>
  );
}

// =============================================================================
// PipelineProgressDisplay
// =============================================================================
function PipelineProgressDisplay({ phase }: { phase: PipelinePhase }) {
  if (phase.phase === "idle" || phase.phase === "complete") return null;

  let label = "";
  let detail = "";
  let pct = 0;

  if (phase.phase === "preparing") {
    label = `Step ${phase.step}/${phase.totalSteps} — Preparing`;
    detail = phase.detail;
    pct = Math.round((phase.step / phase.totalSteps) * 30);
  } else if (phase.phase === "mapping") {
    const overall = phase.totalAllChunks > 0
      ? Math.round((phase.completedChunks / phase.totalAllChunks) * 60)
      : 0;
    label = `Extracting — ${phase.fileName}`;
    detail = `Chunk ${phase.chunkIndex}/${phase.totalChunks} · ${phase.completedChunks}/${phase.totalAllChunks} total`;
    pct = 30 + overall;
  } else if (phase.phase === "reducing") {
    label = `Merging FY ${phase.year}`;
    detail = `Year ${phase.yearIndex}/${phase.totalYears}`;
    pct = 90 + Math.round((phase.yearIndex / phase.totalYears) * 5);
  } else if (phase.phase === "reviewing") {
    label = `Sanity review FY ${phase.year}`;
    detail = `Year ${phase.yearIndex}/${phase.totalYears}`;
    pct = 95 + Math.round((phase.yearIndex / phase.totalYears) * 5);
  } else if (phase.phase === "rate-limited") {
    label = `Rate limit hit (attempt ${phase.attempt}/3) — retrying in ${phase.retryIn}s`;
    detail = `${phase.completedChunks}/${phase.totalChunks} chunks saved`;
    pct = Math.round((phase.completedChunks / Math.max(phase.totalChunks, 1)) * 80);
  } else if (phase.phase === "error") {
    label = "Pipeline error";
    detail = phase.message;
    pct = 0;
  }

  const isError = phase.phase === "error";
  const isRateLimit = phase.phase === "rate-limited";

  return (
    <div
      className={`space-y-2 rounded-lg border p-4 text-sm ${
        isError
          ? "border-red-700/40 bg-red-950/20"
          : isRateLimit
            ? "border-amber-700/40 bg-amber-950/20"
            : "border-blue-700/30 bg-blue-950/15"
      }`}
    >
      <div className="flex items-center gap-2">
        {isError ? (
          <AlertCircle size={15} className="shrink-0 text-red-400" />
        ) : isRateLimit ? (
          <Pause size={15} className="shrink-0 text-amber-400" />
        ) : (
          <Loader2 size={15} className="shrink-0 animate-spin text-blue-400" />
        )}
        <span
          className={`font-medium ${isError ? "text-red-300" : isRateLimit ? "text-amber-300" : "text-blue-200"}`}
        >
          {label}
        </span>
      </div>
      {detail && (
        <p className={`ml-5 text-xs ${isError ? "text-red-400/70" : "text-zinc-500"}`}>{detail}</p>
      )}
      {!isError && pct > 0 && (
        <div className="ml-5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all ${isRateLimit ? "bg-amber-500" : "bg-blue-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ResumeBanner
// =============================================================================
function ResumeBanner({
  manifest,
  onResume,
  onDiscard,
}: {
  manifest: PipelineManifest;
  onResume: () => void;
  onDiscard: () => void;
}) {
  const ago = Math.round((Date.now() - manifest.updatedAt) / 60_000);
  const agoLabel = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
  const pct = manifest.totalChunks > 0
    ? Math.round((manifest.completedChunks / manifest.totalChunks) * 100)
    : 0;

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-blue-700/40 bg-blue-950/20 p-4 text-sm">
      <div className="flex min-w-0 items-start gap-3">
        <RefreshCw size={16} className="mt-0.5 shrink-0 text-blue-400" />
        <div className="min-w-0">
          <p className="font-medium text-blue-200">Incomplete extraction found</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {agoLabel} · {pct}% complete ({manifest.completedChunks}/{manifest.totalChunks} chunks) ·{" "}
            FY {manifest.targetYears.join(", ")} · {manifest.files.map((f) => f.fileName).join(", ")}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={onResume}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
        >
          Resume
        </button>
        <button
          onClick={onDiscard}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-red-400"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// UsageExhaustedBanner
// =============================================================================
function UsageExhaustedBanner({
  phase,
  onAutoResume,
  onSaveAndClose,
}: {
  phase: Extract<PipelinePhase, { phase: "usage-exhausted" }>;
  onAutoResume: () => void;
  onSaveAndClose: () => void;
}) {
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(id);
          onAutoResume();
          return 0;
        }
        return c - 1;
      });
    }, 1_000);
    return () => clearInterval(id);
  }, [onAutoResume]);

  const pct =
    phase.totalChunks > 0
      ? Math.round((phase.completedChunks / phase.totalChunks) * 100)
      : 0;

  return (
    <div className="space-y-3 rounded-lg border border-red-700/40 bg-red-950/20 p-4 text-sm">
      <div className="flex items-start gap-2">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
        <div>
          <p className="font-medium text-red-200">Usage limit reached</p>
          <p className="mt-1 text-xs text-zinc-500">
            {pct}% of data processed and saved to local cache ({phase.completedChunks}/
            {phase.totalChunks} chunks). Session ID: {phase.sessionId.slice(0, 12)}…
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onAutoResume}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
        >
          <RefreshCw size={13} />
          [A] Auto-resume now {countdown > 0 && `(${countdown}s)`}
        </button>
        <button
          onClick={onSaveAndClose}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200"
        >
          [B] Save progress &amp; resume later
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// SegmentGroup — collapsible accordion for Master History
// =============================================================================
function DcfInputPackageSummary({
  summary,
  compact = false,
}: {
  summary: DcfInputSummary | null;
  compact?: boolean;
}) {
  if (!summary) return null;

  const baseYearLabel = summary.baseYearFiscalYear ? `FY ${summary.baseYearFiscalYear}` : "Base year";
  const packageName = [summary.ticker, summary.companyName].filter(Boolean).join(" · ");
  const readinessLabel = summary.readinessComplete ? "Complete DCF package" : "Partial DCF package";
  const moduleLabels = summary.availableModules.length
    ? summary.availableModules.join(" · ")
    : "No DCF modules detected";

  if (compact) {
    return (
      <section className="rounded-lg border border-violet-800/50 bg-violet-950/15 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Database size={18} className="shrink-0 text-violet-300" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-violet-100">
                {readinessLabel}
                {packageName ? ` — ${packageName}` : ""}
              </p>
              <p className="mt-0.5 truncate text-xs text-violet-200/60">{moduleLabels}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-violet-200">
              {summary.quarterlyRows} quarterly rows
            </span>
            <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-violet-200">
              {summary.annualDriverYears} annual driver years
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-violet-800/50 bg-violet-950/15">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-violet-900/40 px-4 py-3">
        <div className="flex min-w-0 gap-3">
          <Database size={18} className="mt-0.5 shrink-0 text-violet-300" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-violet-100">
              Complete DCF Input Package
              {packageName ? ` — ${packageName}` : ""}
            </p>
            <p className="mt-1 text-xs text-violet-200/60">
              Shows the data modules available beyond the Step 2 quarterly table.
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            summary.readinessComplete
              ? "bg-emerald-600/15 text-emerald-300"
              : "bg-amber-600/15 text-amber-300"
          }`}
        >
          {readinessLabel}
        </span>
      </div>

      <div className="grid gap-0 divide-y divide-violet-900/30 text-sm sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="space-y-2 px-4 py-3">
          <DataLine label="Quarterly baseline" value={`${summary.quarterlyRows} rows`} />
          <DataLine label="Annual DCF drivers" value={`${summary.annualDriverYears} years`} />
          <DataLine label="Normalized base year" value={baseYearLabel} />
          <DataLine
            label="Forecast assumptions"
            value={summary.hasForecastAssumptions ? "Included" : "Missing"}
          />
          <DataLine
            label="WACC / terminal assumptions"
            value={summary.hasValuationAssumptions ? "Included" : "Missing"}
          />
        </div>
        <div className="space-y-2 px-4 py-3">
          <DataLine
            label="Base revenue"
            value={
              summary.baseYearRevenueUsdM === null
                ? "—"
                : `$${formatNullableMetric(summary.baseYearRevenueUsdM)}M`
            }
          />
          <DataLine
            label="Base EBIT"
            value={
              summary.baseYearEbitUsdM === null
                ? "—"
                : `$${formatNullableMetric(summary.baseYearEbitUsdM)}M`
            }
          />
          <DataLine
            label="Base free cash flow"
            value={
              summary.baseYearFreeCashFlowUsdM === null
                ? "—"
                : `$${formatNullableMetric(summary.baseYearFreeCashFlowUsdM)}M`
            }
          />
          <DataLine
            label="Cash + marketable securities"
            value={
              summary.cashAndMarketableSecuritiesUsdM === null
                ? "—"
                : `$${formatNullableMetric(summary.cashAndMarketableSecuritiesUsdM)}M`
            }
          />
          <DataLine
            label="Debt / shares"
            value={
              summary.totalDebtUsdM === null || summary.commonSharesOutstandingM === null
                ? "—"
                : `$${formatNullableMetric(summary.totalDebtUsdM)}M debt · ${formatNullableMetric(summary.commonSharesOutstandingM)}M shares`
            }
          />
        </div>
      </div>
    </section>
  );
}

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-right text-xs font-medium text-zinc-200">{value}</span>
    </div>
  );
}

function Step2ReviewSummary({
  results,
}: {
  results: Step2StructuredResultForReview[];
}) {
  if (results.length === 0) return null;

  const rowCount = results.reduce((total, result) => total + result.rows.length, 0);
  const sourceMap = new Map<string, Step2StructuredResultForReview["sources"][number]>();
  for (const result of results) {
    for (const source of result.sources) sourceMap.set(source.source_id, source);
  }
  const sources = Array.from(sourceMap.values());
  const warningCount = results.reduce(
    (total, result) => total + result.validation_warnings.length,
    0,
  );
  const excludedItems = results.flatMap((result) => result.excluded_items);
  const years = results.map((result) => result.target_year).sort((a, b) => a - b);
  const summaryLine =
    results.length === 1
      ? results[0].review_summary.one_line
      : `${rowCount} verified historical rows across FY ${years[0]}-${years[years.length - 1]}; ready to anchor the DCF forecast baseline.`;
  const warnings = results.flatMap((result) => result.review_summary.warnings);

  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-100">DCF Historical Baseline Review</p>
          <p className="mt-1 text-sm text-zinc-400">{summaryLine}</p>
        </div>
        <span className="rounded-full bg-amber-600/15 px-3 py-1 text-xs font-semibold text-amber-300">
          Review baseline
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
          {rowCount} extracted row(s)
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
          {sources.length} source(s)
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
          {warningCount} warning(s)
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-200">
          {Array.from(new Set(warnings)).slice(0, 3).map((warning, i) => (
            <p key={i}>{warning}</p>
          ))}
        </div>
      )}

      <details className="rounded-lg border border-zinc-800 bg-zinc-950">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100">
          Source and excluded item audit
        </summary>
        <div className="space-y-3 border-t border-zinc-800 p-4 text-xs text-zinc-400">
          {sources.slice(0, 8).map((source) => (
            <p key={source.source_id}>
              {source.name}: {source.locator ?? "No locator"}
            </p>
          ))}
          {excludedItems.slice(0, 8).map((item, i) => (
            <p key={i} className="text-amber-300/80">
              Excluded: {item.label} - {item.reason}
            </p>
          ))}
        </div>
      </details>
    </section>
  );
}

function SegmentGroup({
  segment,
  rows,
}: {
  segment: string;
  rows: HistoricalExtractionRow[];
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-zinc-200 hover:bg-zinc-900"
      >
        <span>
          {segment}
          <span className="ml-2 text-xs font-normal text-zinc-500">
            ({rows.length} rows)
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900 text-zinc-500">
              <tr>
                <th className="px-3 py-1.5 font-medium">Year</th>
                <th className="px-3 py-1.5 font-medium">Qtr</th>
                <th className="px-3 py-1.5 font-medium">Category</th>
                <th className="px-3 py-1.5 font-medium">Product</th>
                <th className="px-3 py-1.5 font-medium text-right">Revenue ($M)</th>
                <th className="px-3 py-1.5 font-medium text-right">Op. Income ($M)</th>
                <th className="px-3 py-1.5 font-medium">Review</th>
                <th className="px-3 py-1.5 font-medium">Source</th>
                <th className="px-3 py-1.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-900/50">
                  <td className="px-3 py-1.5 text-zinc-300">{row.fiscalYear}</td>
                  <td className="px-3 py-1.5 text-zinc-300">{row.quarter}</td>
                  <td className="px-3 py-1.5 text-zinc-400">{row.productCategory}</td>
                  <td className="px-3 py-1.5 text-zinc-400">{row.productName}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-200">
                    {formatNullableMetric(row.revenue)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-200">
                    {formatNullableMetric(row.operatingIncome)}
                  </td>
                  <td
                    className="max-w-[160px] truncate px-3 py-1.5 text-amber-300/80"
                    title={row.reviewNote ?? row.reviewStatus ?? ""}
                  >
                    {row.reviewStatus ?? "External Verification Required"}
                  </td>
                  <td
                    className="max-w-[140px] truncate px-3 py-1.5 text-zinc-500"
                    title={row.sourceLink && row.sourceLink !== "Not available"
                      ? `${row.sourceName ?? "Not available"} — ${row.sourceLink}`
                      : row.sourceName ?? "Not available"}
                  >
                    {row.sourceName ?? "Not available"}
                  </td>
                  <td
                    className="max-w-[140px] truncate px-3 py-1.5 text-zinc-500"
                    title={row.notes}
                  >
                    {row.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// WorkflowModePanel — shown in Step 2 when company_type is not industrial
// Lets the user review and override the workflow_mode tag per segment before
// the extraction pipeline runs.
// =============================================================================

import type { CompanyType, Step1AnalysisSegment } from "@/types/cfp";

interface WorkflowModePanelProps {
  companyType: CompanyType | undefined;
  segments: Step1AnalysisSegment[];
  onToggle: (segmentId: string, mode: WorkflowMode) => void;
  disabled: boolean;
}

function WorkflowModePanel({
  companyType,
  segments,
  onToggle,
  disabled,
}: WorkflowModePanelProps) {
  if (!companyType || companyType === "industrial" || segments.length === 0) return null;

  const modeLabel: Record<WorkflowMode, string> = {
    bank: "Bank / Finance",
    industrial: "Industrial",
  };

  const modeBadge = (mode: WorkflowMode) =>
    mode === "bank"
      ? "bg-blue-600/20 text-blue-300 border border-blue-600/30"
      : "bg-zinc-700/50 text-zinc-300 border border-zinc-600/40";

  const companyTypeLabel: Record<CompanyType, string> = {
    financial_bank: "Finance Mode — Bank",
    financial_insurance: "Finance Mode — Insurance",
    financial_other: "Finance Mode — Financial",
    hybrid: "Finance Mode — Hybrid",
    industrial: "",
  };

  return (
    <div className="rounded-lg border border-blue-700/30 bg-blue-950/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-blue-600/20 border border-blue-600/30 px-3 py-1 text-xs font-semibold text-blue-300">
          {companyTypeLabel[companyType] ?? "Finance Mode"}
        </span>
        <p className="text-sm text-zinc-400">
          The LLM tagged each segment below. You can change the tag before extraction.
        </p>
      </div>

      <div className="space-y-2">
        {segments.map((seg) => {
          const current: WorkflowMode = seg.workflow_mode ?? "industrial";
          const next: WorkflowMode = current === "bank" ? "industrial" : "bank";
          return (
            <div
              key={seg.id}
              className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-2 gap-3"
            >
              <span className="text-sm text-zinc-200 truncate flex-1">{seg.canonical_name}</span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${modeBadge(current)}`}>
                {modeLabel[current]}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggle(seg.id, next)}
                className="shrink-0 text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-40 underline underline-offset-2"
              >
                Switch to {modeLabel[next]}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
