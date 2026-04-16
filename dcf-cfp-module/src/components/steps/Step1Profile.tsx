"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload,
  FileText,
  Loader2,
  Download,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import StepShell from "./StepShell";
import { useSettings } from "@/context/SettingsContext";
import { useCFP } from "@/context/CFPContext";
import type { AnalyzeCompanyResponse } from "@/types/cfp";

// =============================================================================
// Step 1 — Company Profile: SEC Filing Upload & LLM Analysis
// =============================================================================

export default function Step1Profile() {
  const { state, dispatch } = useCFP();

  // ---------- Local form state ----------
  const [companyName, setCompanyName] = useState(state.profile.companyName || "");
  const [tenKFile, setTenKFile] = useState<File | null>(null);
  const [tenQFile, setTenQFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ---------- Settings (centralized API key) ----------
  const { settings, activeApiKey } = useSettings();

  // ---------- File input refs (to reset programmatically) ----------
  const tenKInputRef = useRef<HTMLInputElement>(null);
  const tenQInputRef = useRef<HTMLInputElement>(null);

  // Has analysis result been received?
  const hasResult = state.profile.rawAnalysisMarkdown.length > 0;

  // ------------------------------------------------------------------
  // Submit handler — calls POST /api/analyze-company
  // ------------------------------------------------------------------
  const handleSubmit = useCallback(
    async () => {
      const name = companyName.trim();
      if (!name) {
        setErrorMsg("Please enter a company name.");
        return;
      }
      if (!tenKFile && !tenQFile) {
        setErrorMsg("Please upload at least one SEC filing (10-K or 10-Q).");
        return;
      }

      setErrorMsg(null);
      setIsAnalyzing(true);

      try {
        const formData = new FormData();
        formData.append("companyName", name);
        if (tenKFile) formData.append("tenK", tenKFile);
        if (tenQFile) formData.append("tenQ", tenQFile);

        formData.append("apiKey", activeApiKey);
        formData.append("llmProvider", settings.llmProvider);

        const res = await fetch("/api/analyze-company", {
          method: "POST",
          body: formData,
        });

        const data: AnalyzeCompanyResponse = await res.json();

        if (!res.ok) {
          if (data.requiresApiKey) {
            throw new Error("No API key configured. Open Settings (gear icon) to add your key.");
          }
          throw new Error(data.error || `Server error (${res.status})`);
        }

        // Persist to global context
        dispatch({ type: "UPDATE_PROFILE", payload: { companyName: name } });
        dispatch({
          type: "SET_PROFILE_ANALYSIS",
          payload: {
            rawMarkdown: data.rawMarkdown,
            architectureJson: data.architectureJson,
          },
        });
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : "Analysis failed.");
      } finally {
        setIsAnalyzing(false);
      }
    },
    [companyName, tenKFile, tenQFile, activeApiKey, settings.llmProvider, dispatch],
  );

  // ------------------------------------------------------------------
  // Download handler — .txt blob download
  // ------------------------------------------------------------------
  const handleDownload = () => {
    const md = state.profile.rawAnalysisMarkdown;
    if (!md) return;

    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const yyyy = now.getFullYear();
    const safeName = (state.profile.companyName || "company")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .toLowerCase();
    const filename = `${safeName}-step1-${mm}-${dd}-${yyyy}.txt`;

    const blob = new Blob([md], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ------------------------------------------------------------------
  // File picker helpers
  // ------------------------------------------------------------------
  const clearFile = (which: "tenK" | "tenQ") => {
    if (which === "tenK") {
      setTenKFile(null);
      if (tenKInputRef.current) tenKInputRef.current.value = "";
    } else {
      setTenQFile(null);
      if (tenQInputRef.current) tenQInputRef.current.value = "";
    }
  };

  // ==========================================================================
  // Render
  // ==========================================================================
  return (
    <StepShell
      stepNumber={1}
      title="Company Profile"
      subtitle="Upload SEC filings to generate a business architecture analysis powered by Claude."
    >
      {/* -------- INPUT FORM -------- */}
      {!hasResult && (
        <div className="space-y-6">
          {/* Company Name */}
          <div>
            <label
              htmlFor="company-name"
              className="mb-1.5 block text-sm font-medium text-zinc-300"
            >
              Company Name
            </label>
            <input
              id="company-name"
              type="text"
              placeholder="e.g. Apple Inc."
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={isAnalyzing}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>

          {/* File inputs — side by side on larger screens */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* 10-K */}
            <FileUploadCard
              id="tenK"
              label="Form 10-K"
              sublabel="Annual report (Max 1 file)"
              file={tenKFile}
              inputRef={tenKInputRef}
              disabled={isAnalyzing}
              onFileChange={(f) => setTenKFile(f)}
              onClear={() => clearFile("tenK")}
            />

            {/* 10-Q */}
            <FileUploadCard
              id="tenQ"
              label="Form 10-Q"
              sublabel="Quarterly report (Max 1 file)"
              file={tenQFile}
              inputRef={tenQInputRef}
              disabled={isAnalyzing}
              onFileChange={(f) => setTenQFile(f)}
              onClear={() => clearFile("tenQ")}
            />
          </div>

          {/* Error */}
          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-950/30 p-3 text-sm text-red-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={() => handleSubmit()}
            disabled={isAnalyzing}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {isAnalyzing ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Analyzing filings...
              </>
            ) : (
              "Analyze SEC Filings"
            )}
          </button>
        </div>
      )}

      {/* -------- RESULT VIEW -------- */}
      {hasResult && (
        <div className="space-y-6">
          {/* Success header */}
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 size={20} />
            <span className="text-sm font-medium">
              Analysis complete for <strong>{state.profile.companyName}</strong>
            </span>
          </div>

          {/* Rendered markdown */}
          <article className="prose prose-invert prose-sm max-w-none rounded-lg border border-zinc-800 bg-zinc-950 p-5 prose-headings:text-zinc-200 prose-p:text-zinc-400 prose-strong:text-zinc-200 prose-code:rounded prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-blue-300 prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-li:text-zinc-400">
            <ReactMarkdown>{state.profile.rawAnalysisMarkdown}</ReactMarkdown>
          </article>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Download */}
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-5 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-600/20"
            >
              <Download size={16} />
              Download Text Report
            </button>

            {/* Re-analyze */}
            <button
              onClick={() => {
                dispatch({
                  type: "SET_PROFILE_ANALYSIS",
                  payload: { rawMarkdown: "", architectureJson: null },
                });
                setErrorMsg(null);
              }}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
            >
              <Trash2 size={16} />
              Start Over
            </button>
          </div>

          {/* Architecture JSON preview */}
          {state.profile.architectureJson && (
            <details className="group rounded-lg border border-zinc-800 bg-zinc-950">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100">
                Parsed Architecture JSON (click to expand)
              </summary>
              <pre className="max-h-80 overflow-auto border-t border-zinc-800 p-4 text-xs text-zinc-400">
                {JSON.stringify(state.profile.architectureJson, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </StepShell>
  );
}

// =============================================================================
// Reusable File Upload Card
// =============================================================================
function FileUploadCard({
  id,
  label,
  sublabel,
  file,
  inputRef,
  disabled,
  onFileChange,
  onClear,
}: {
  id: string;
  label: string;
  sublabel: string;
  file: File | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onFileChange: (file: File | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
      <p className="text-sm font-medium text-zinc-200">{label}</p>
      <p className="mb-3 text-xs text-zinc-500">{sublabel}</p>

      {!file ? (
        <label
          htmlFor={`file-${id}`}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-zinc-700 py-6 text-center transition-colors hover:border-blue-500/50 hover:bg-zinc-800 ${disabled ? "pointer-events-none opacity-50" : ""}`}
        >
          <Upload size={24} className="text-zinc-500" />
          <span className="text-xs text-zinc-500">
            Click to upload PDF
          </span>
          <input
            ref={inputRef}
            id={`file-${id}`}
            type="file"
            accept=".pdf,application/pdf"
            multiple={false}
            disabled={disabled}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              onFileChange(f);
            }}
          />
        </label>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2">
          <FileText size={16} className="shrink-0 text-blue-400" />
          <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
            {file.name}
          </span>
          <span className="shrink-0 text-xs text-zinc-600">
            {(file.size / 1024 / 1024).toFixed(1)} MB
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 rounded p-0.5 text-zinc-600 hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
