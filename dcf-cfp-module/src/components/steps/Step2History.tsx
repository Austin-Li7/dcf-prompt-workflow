"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import {
  Upload,
  FileText,
  FileSpreadsheet,
  Loader2,
  Download,
  Trash2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Plus,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import StepShell from "./StepShell";
import { useSettings } from "@/context/SettingsContext";
import { useCFP } from "@/context/CFPContext";
import type { HistoricalExtractionRow, ExtractHistoryResponse } from "@/types/cfp";

// =============================================================================
// Constants
// =============================================================================
const MAX_YEARS = 5;
const MAX_FILES = 4;
const ACCEPTED_EXTS = [".xlsx", ".xls", ".xlsm", ".csv", ".txt"];
const ACCEPTED_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
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
  return <FileText size={14} className="shrink-0 text-blue-400" />;
}

// =============================================================================
// Step 2 — Historical Financials
// =============================================================================
export default function Step2History() {
  const { state, dispatch } = useCFP();
  const { settings, activeApiKey } = useSettings();

  const hasArchitecture = !!state.profile.architectureJson;

  // ── Form inputs ─────────────────────────────────────────────────────────────
  const [targetYear, setTargetYear] = useState("");
  const [dataFiles, setDataFiles] = useState<File[]>([]);
  const [textNotes, setTextNotes] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Extraction state ─────────────────────────────────────────────────────────
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Staging rows (editable before confirming to master) ──────────────────────
  const [stagingRows, setStagingRows] = useState<HistoricalExtractionRow[]>([]);

  // ── Master history from context ──────────────────────────────────────────────
  const masterRows = state.history.rows;
  const confirmedYears = state.history.confirmedYears;
  const canAddMoreYears = confirmedYears.length < MAX_YEARS;

  const hasStagingData = stagingRows.length > 0;

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
  // Extract handler — POST to /api/extract-history
  // ============================================================================
  const handleExtract = useCallback(async () => {
    const year = targetYear.trim();

    if (!year || isNaN(Number(year))) {
      setErrorMsg("Please enter a valid fiscal year (e.g. 2023).");
      return;
    }
    if (confirmedYears.includes(Number(year))) {
      setErrorMsg(`Year ${year} has already been confirmed in the Master History.`);
      return;
    }
    if (!canAddMoreYears) {
      setErrorMsg(`Maximum of ${MAX_YEARS} distinct years reached. Remove history to add more.`);
      return;
    }
    if (dataFiles.length === 0 && !textNotes.trim()) {
      setErrorMsg("Please upload a file or paste text notes.");
      return;
    }

    setErrorMsg(null);
    setIsExtracting(true);
    setStagingRows([]);

    try {
      const formData = new FormData();
      formData.append("targetYear", year);
      formData.append("architecture", JSON.stringify(state.profile.architectureJson));
      for (const f of dataFiles) {
        formData.append("dataFiles", f);
      }
      if (textNotes.trim()) {
        formData.append("textNotes", textNotes.trim());
      }
      formData.append("apiKey", activeApiKey);
      formData.append("llmProvider", settings.llmProvider);

      const res = await fetch("/api/extract-history", {
        method: "POST",
        body: formData,
      });

      const data: ExtractHistoryResponse = await res.json();

      if (!res.ok) {
        if (data.requiresApiKey) {
          throw new Error("No API key configured. Open Settings (⚙) to add your key.");
        }
        throw new Error(data.error ?? `Server error (${res.status})`);
      }

      if (data.rows.length === 0) {
        throw new Error("No rows were extracted. Check your file contains segment revenue data.");
      }

      setStagingRows(
        data.rows.map((r) => ({ ...r, id: uid(), yoyGrowth: 0 })),
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Extraction failed.");
    } finally {
      setIsExtracting(false);
    }
  }, [
    targetYear,
    dataFiles,
    textNotes,
    activeApiKey,
    settings.llmProvider,
    state.profile.architectureJson,
    confirmedYears,
    canAddMoreYears,
  ]);

  // ── Staging: edit a cell ─────────────────────────────────────────────────────
  const updateStagingCell = (
    id: string,
    field: keyof HistoricalExtractionRow,
    value: string | number,
  ) => {
    setStagingRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  // ── Confirm staging → append to master ──────────────────────────────────────
  const handleConfirm = () => {
    if (stagingRows.length === 0) return;
    dispatch({
      type: "APPEND_HISTORY_ROWS",
      payload: { year: Number(targetYear.trim()), rows: stagingRows },
    });
    setStagingRows([]);
    setTargetYear("");
    setDataFiles([]);
    setTextNotes("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Excel download ───────────────────────────────────────────────────────────
  const handleExcelDownload = () => {
    if (masterRows.length === 0) return;
    const exportData = masterRows.map(({ id: _id, ...rest }) => rest);
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
                Extract Year Data
              </h3>
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

            {/* Year input */}
            <div className="max-w-xs">
              <label htmlFor="target-year" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Target Fiscal Year
              </label>
              <input
                id="target-year"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 2023"
                value={targetYear}
                onChange={(e) => setTargetYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                disabled={isExtracting || !canAddMoreYears}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            {/* File upload area */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">
                Data Files
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  .xlsx · .csv · .txt (max {MAX_FILES})
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
                    Excel exports, quarterly CSV, or pasted-as-txt
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

            {/* Error banner */}
            {errorMsg && (
              <div className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-950/30 p-3 text-sm text-red-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {errorMsg}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleExtract}
              disabled={isExtracting || !canAddMoreYears}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
            >
              {isExtracting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Extracting &amp; mapping data…
                </>
              ) : (
                <>
                  <Plus size={16} />
                  Extract &amp; Map Data
                </>
              )}
            </button>
          </section>

          {/* ================================================================ */}
          {/*  STAGING AREA (editable before confirming to master)             */}
          {/* ================================================================ */}
          {hasStagingData && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400">
                  Staging Area — FY {targetYear}
                </h3>
                <span className="rounded bg-amber-900/30 px-2 py-0.5 text-xs text-amber-300">
                  {stagingRows.length} rows — review &amp; edit before confirming
                </span>
              </div>

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
                            value={row.revenue}
                            onChange={(e) =>
                              updateStagingCell(row.id, "revenue", Number(e.target.value))
                            }
                            className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-xs text-zinc-100 outline-none focus:border-blue-500"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="number"
                            step="any"
                            value={row.operatingIncome}
                            onChange={(e) =>
                              updateStagingCell(row.id, "operatingIncome", Number(e.target.value))
                            }
                            className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-xs text-zinc-100 outline-none focus:border-blue-500"
                          />
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
                Confirm &amp; Append to Master History
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
              </div>
            </section>
          )}

        </div>
      )}
    </StepShell>
  );
}

// =============================================================================
// SegmentGroup — collapsible accordion for Master History
// =============================================================================
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
                    {row.revenue.toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-zinc-200">
                    {row.operatingIncome.toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
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
