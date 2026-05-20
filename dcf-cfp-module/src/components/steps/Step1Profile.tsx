"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload,
  FileText,
  Loader2,
  Download,
  Trash2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Check,
  ArrowRight,
  Plus,
  GitBranch,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import StepShell from "./StepShell";
import { useSettings } from "@/context/SettingsContext";
import { useCFP } from "@/context/CFPContext";
import { applyStep1ApprovalEdits, buildStep1ReviewState, markStep1ReviewApproved } from "@/lib/step1-review";
import { projectStructuredStep1ToArchitecture } from "@/lib/step1-schema";
import type {
  AnalyzeCompanyResponse,
  BusinessArchitecture,
  CompanyType,
  Step1OmissionReviewEntry,
  Step1ReportedNodeReviewEntry,
  Step1ValidationMatrixRow,
} from "@/types/cfp";

// =============================================================================
// Step 1 — Company Profile: SEC Filing Upload, Analysis, and Review Gate
// =============================================================================
const MAX_VISIBLE_REPORTED_NODES = 8;
const MAX_VISIBLE_OMISSION_ROWS = 4;
const MAX_VISIBLE_PRODUCTS = 2;

export default function Step1Profile() {
  const { state, dispatch } = useCFP();
  const review = state.profile.step1Review;

  // ---------- Local form state ----------
  const [companyName, setCompanyName] = useState(state.profile.companyName || "");
  const [tenKFile, setTenKFile] = useState<File | null>(null);
  const [tenQFile, setTenQFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tickerInput, setTickerInput] = useState(state.profile.ticker || "");
  const [segmentNames, setSegmentNames] = useState<Record<string, string>>({});
  const [businessLineNames, setBusinessLineNames] = useState<Record<string, string>>({});
  const [businessLineTargets, setBusinessLineTargets] = useState<Record<string, string>>({});
  const [userAddedSegments, setUserAddedSegments] = useState<string[]>([]);
  const [addSegmentInput, setAddSegmentInput] = useState("");
  const [showAddSegmentForm, setShowAddSegmentForm] = useState(false);

  // ---------- Settings (centralized API key) ----------
  const { settings, activeApiKey } = useSettings();

  // ---------- File input refs (to reset programmatically) ----------
  const tenKInputRef = useRef<HTMLInputElement>(null);
  const tenQInputRef = useRef<HTMLInputElement>(null);

  // Has analysis result been received?
  const hasResult = state.profile.rawAnalysisMarkdown.length > 0;

  useEffect(() => {
    setTickerInput(state.profile.ticker || "");
  }, [state.profile.ticker]);

  useEffect(() => {
    if (!review) {
      setSegmentNames({});
      setBusinessLineNames({});
      setBusinessLineTargets({});
      return;
    }

    setSegmentNames(
      Object.fromEntries(
        review.analysisView.segments.map((segment) => [segment.id, segment.suggestedName]),
      ),
    );
    setBusinessLineNames(
      Object.fromEntries(
        review.analysisView.segments.flatMap((segment) =>
          segment.offerings.map((line) => [line.id, line.suggestedName]),
        ),
      ),
    );
    setBusinessLineTargets(
      Object.fromEntries(
        review.analysisView.segments.flatMap((segment) =>
          segment.offerings.map((line) => [line.id, line.targetSegment]),
        ),
      ),
    );
    setUserAddedSegments([]);
    setAddSegmentInput("");
    setShowAddSegmentForm(false);
  }, [review]);

  // ------------------------------------------------------------------
  // Submit handler — calls POST /api/analyze-company
  // ------------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
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

      dispatch({ type: "UPDATE_PROFILE", payload: { companyName: name } });
      dispatch({
        type: "SET_PROFILE_ANALYSIS",
        payload: {
          rawMarkdown: data.rawMarkdown,
          structuredResult: data.structuredResult,
          architectureJson: data.architectureJson,
          step1Review: data.step1Review,
        },
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }, [companyName, tenKFile, tenQFile, activeApiKey, settings.llmProvider, dispatch]);

  const handleApproveReview = useCallback(() => {
    if (!state.profile.step1StructuredResult || !review) return;
    if (review.approved) return; // B3: no-op if already approved

    const approvedStructuredResult = applyStep1ApprovalEdits(
      state.profile.step1StructuredResult,
      {
        segments: review.analysisView.segments.map((segment) => ({
          id: segment.id,
          canonicalName: segmentNames[segment.id]?.trim() || segment.suggestedName,
        })),
        offerings: review.analysisView.segments.flatMap((segment) =>
          segment.offerings.map((line) => ({
            id: line.id,
            canonicalName: businessLineNames[line.id]?.trim() || line.suggestedName,
            targetSegment:
              businessLineTargets[line.id]?.trim() || line.targetSegment,
          })),
        ),
      },
    );

    const approvedArchitecture = projectStructuredStep1ToArchitecture(approvedStructuredResult);
    // Inject user-added segments (empty business lines — segments the LLM merged but user wants separate)
    const validUserSegments = userAddedSegments.map((s) => s.trim()).filter(Boolean);
    if (validUserSegments.length > 0) {
      approvedArchitecture.architecture = [
        ...approvedArchitecture.architecture,
        ...validUserSegments.map((name) => ({ segment: name, businessLines: [] })),
      ];
    }
    // B6: use immutable helper instead of post-hoc mutation
    const approvedReview = markStep1ReviewApproved(buildStep1ReviewState(approvedStructuredResult));

    dispatch({
      type: "UPDATE_PROFILE",
      payload: {
        ticker: tickerInput.trim() || state.profile.ticker, // U6: persist user-confirmed ticker
        step1StructuredResult: approvedStructuredResult,
        architectureJson: approvedArchitecture,
        step1Review: approvedReview,
      },
    });
    dispatch({ type: "NEXT_STEP" });
  }, [
    businessLineNames,
    businessLineTargets,
    dispatch,
    review,
    segmentNames,
    state.profile.step1StructuredResult,
    state.profile.ticker,
    tickerInput,
    userAddedSegments,
  ]);

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
      {!hasResult && (
        <div className="space-y-6">
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

          <div className="grid gap-4 sm:grid-cols-2">
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

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-950/30 p-3 text-sm text-red-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleSubmit}
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

      {hasResult && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-emerald-400">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={20} />
              <span className="text-sm font-medium">
                Analysis complete for <strong>{state.profile.companyName}</strong>
              </span>
            </div>
            <FinanceModeIndicator
              companyType={state.profile.step1StructuredResult?.company_type}
            />
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="ticker-input" className="shrink-0 text-sm text-zinc-400">
              Ticker
            </label>
            <input
              id="ticker-input"
              type="text"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder="e.g. AAPL"
              className="w-28 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            {state.profile.step1StructuredResult?.ticker && (
              <span className="text-xs text-zinc-500">Inferred by Claude — confirm or correct before approving</span>
            )}
            {!state.profile.step1StructuredResult?.ticker && (
              <span className="text-xs text-amber-400">Ticker not inferred — enter manually for WACC step</span>
            )}
          </div>

          <LineageNote
            approved={state.profile.step1Review?.approved ?? false}
            companyType={state.profile.step1StructuredResult?.company_type}
            ticker={tickerInput || state.profile.ticker || null}
            architecture={state.profile.architectureJson}
          />

          {review && (
            <section className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Step 1 Review Gate</p>
                  <p className="mt-1 text-sm text-zinc-400">{review.summary.oneLine}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    review.approved
                      ? "bg-emerald-600/15 text-emerald-300"
                      : "bg-amber-600/15 text-amber-300"
                  }`}
                >
                  {review.approved ? "Approved for Step 2" : "Awaiting review"}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {review.summary.highlights.map((highlight) => (
                  <div
                    key={highlight}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300"
                  >
                    {highlight}
                  </div>
                ))}
              </div>

              {review.summary.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-300">
                    <AlertTriangle size={16} />
                    Review warnings
                  </div>
                  <ul className="space-y-1 text-sm text-amber-200/90">
                    {review.summary.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <ValidationMatrix rows={review.validationMatrix} />

              {!review.approved && (
                <>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-200">Canonical segment names</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        These names will become the anchor names for Step 2 and every downstream step.
                      </p>
                    </div>
                    {review.analysisView.segments.map((segment) => (
                      <div
                        key={segment.id}
                        className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                      >
                        <div>
                          <p className="text-xs uppercase tracking-wide text-zinc-500">Analysis segment</p>
                          <p className="mt-1 text-sm text-zinc-200">{segment.originalName}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            Offerings: {segment.offeringCount} · Evidence: {segment.evidenceLevel}
                          </p>
                        </div>
                        <label className="text-sm text-zinc-300">
                          Canonical name
                          <input
                            type="text"
                            value={segmentNames[segment.id] ?? segment.suggestedName}
                            onChange={(event) =>
                              setSegmentNames((current) => ({
                                ...current,
                                [segment.id]: event.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </label>
                      </div>
                    ))}

                    {/* User-added segments */}
                    {userAddedSegments.map((name, i) => (
                      <div
                        key={`user-seg-${i}`}
                        className="grid gap-3 rounded-lg border border-blue-800/40 bg-blue-950/20 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0">
                            <p className="text-xs uppercase tracking-wide text-blue-400">User-added segment</p>
                            <p className="mt-1 text-xs text-zinc-500">Not from LLM — will appear as an empty segment in Step 5</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <label className="min-w-0 flex-1 text-sm text-zinc-300">
                            Segment name
                            <input
                              type="text"
                              value={name}
                              onChange={(e) =>
                                setUserAddedSegments((prev) =>
                                  prev.map((s, j) => (j === i ? e.target.value : s)),
                                )
                              }
                              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => setUserAddedSegments((prev) => prev.filter((_, j) => j !== i))}
                            className="mt-6 shrink-0 rounded p-1.5 text-zinc-500 hover:text-red-400"
                            title="Remove segment"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Add segment controls */}
                    {showAddSegmentForm ? (
                      <div className="flex gap-2 rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
                        <input
                          type="text"
                          autoFocus
                          placeholder="e.g. Royalty Revenue"
                          value={addSegmentInput}
                          onChange={(e) => setAddSegmentInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && addSegmentInput.trim()) {
                              setUserAddedSegments((prev) => [...prev, addSegmentInput.trim()]);
                              setAddSegmentInput("");
                              setShowAddSegmentForm(false);
                            }
                            if (e.key === "Escape") {
                              setAddSegmentInput("");
                              setShowAddSegmentForm(false);
                            }
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (addSegmentInput.trim()) {
                              setUserAddedSegments((prev) => [...prev, addSegmentInput.trim()]);
                              setAddSegmentInput("");
                              setShowAddSegmentForm(false);
                            }
                          }}
                          className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddSegmentInput(""); setShowAddSegmentForm(false); }}
                          className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowAddSegmentForm(true)}
                        className="flex items-center gap-1.5 self-start rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-blue-600/50 hover:text-blue-400"
                      >
                        <Plus size={13} /> Add Segment
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-200">Offering naming and placement</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Rename ambiguous offerings and reassign them if the current analysis mapping looks wrong.
                      </p>
                    </div>
                    {review.analysisView.segments.flatMap((segment) =>
                      segment.offerings.map((line) => (
                      <div
                        key={line.id}
                        className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]"
                      >
                        <div>
                          <p className="text-xs uppercase tracking-wide text-zinc-500">Analysis offering</p>
                          <p className="mt-1 text-sm text-zinc-200">{line.originalName}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            Current segment: {line.parentSegment} · Products: {line.productCount} · Evidence: {line.evidenceLevel}
                          </p>
                        </div>
                        <label className="text-sm text-zinc-300">
                          Canonical name
                          <input
                            type="text"
                            value={businessLineNames[line.id] ?? line.suggestedName}
                            onChange={(event) =>
                              setBusinessLineNames((current) => ({
                                ...current,
                                [line.id]: event.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                        </label>
                        <label className="text-sm text-zinc-300">
                          Target segment
                          <select
                            value={businessLineTargets[line.id] ?? line.targetSegment}
                            onChange={(event) =>
                              setBusinessLineTargets((current) => ({
                                ...current,
                                [line.id]: event.target.value,
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          >
                            {review.analysisView.segments.map((segment) => (
                              <option
                                key={segment.id}
                                value={segmentNames[segment.id] ?? segment.suggestedName}
                              >
                                {segmentNames[segment.id] ?? segment.suggestedName}
                              </option>
                            ))}
                            {userAddedSegments.filter(Boolean).map((name, i) => (
                              <option key={`user-seg-opt-${i}`} value={name}>
                                {name} (user-added)
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      )),
                    )}
                  </div>

                  <ReportedViewAudit
                    nodes={review.reportedView.nodes}
                    viewType={review.reportedView.viewType}
                  />

                  {review.omissionReview.length > 0 && (
                    <OmissionReview items={review.omissionReview} />
                  )}

                  <button
                    onClick={handleApproveReview}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                  >
                    <Check size={16} />
                    Approve Step 1 and continue to Step 2
                    <ArrowRight size={16} />
                  </button>
                </>
              )}
            </section>
          )}

          <details className="group rounded-lg border border-zinc-800 bg-zinc-950">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100">
              Raw Step 1 analysis report (click to expand)
            </summary>
            <article className="prose prose-invert prose-sm max-w-none border-t border-zinc-800 p-5 prose-headings:text-zinc-200 prose-p:text-zinc-400 prose-strong:text-zinc-200 prose-code:rounded prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-blue-300 prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-li:text-zinc-400">
              <ReactMarkdown>{state.profile.rawAnalysisMarkdown}</ReactMarkdown>
            </article>
          </details>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-5 py-2.5 text-sm font-medium text-emerald-400 transition-colors hover:bg-emerald-600/20"
            >
              <Download size={16} />
              Download Text Report
            </button>

            <button
              onClick={() => {
                dispatch({
                  type: "SET_PROFILE_ANALYSIS",
                  payload: {
                    rawMarkdown: "",
                    structuredResult: null,
                    architectureJson: null,
                    step1Review: null,
                  },
                });
                setCompanyName("");
                setTenKFile(null);
                setTenQFile(null);
                if (tenKInputRef.current) tenKInputRef.current.value = "";
                if (tenQInputRef.current) tenQInputRef.current.value = "";
                setTickerInput("");
                setErrorMsg(null);
                setUserAddedSegments([]);
                setAddSegmentInput("");
                setShowAddSegmentForm(false);
              }}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
            >
              <Trash2 size={16} />
              Start Over
            </button>
          </div>

          {state.profile.architectureJson && (
            <details className="group rounded-lg border border-zinc-800 bg-zinc-950">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100">
                Approved architecture JSON (click to expand)
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

function ValidationMatrix({ rows }: { rows: Step1ValidationMatrixRow[] }) {
  if (rows.length === 0) return null;

  return (
    <details className="group rounded-lg border border-zinc-800 bg-zinc-950">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100">
        Validation matrix ({rows.length})
        <span className="ml-2 text-xs font-normal text-zinc-500">source-tier evidence audit</span>
      </summary>
      <div className="border-t border-zinc-800 p-4">
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Segment</th>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950/70 text-zinc-300">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-zinc-400">{row.segment}</td>
                  <td className="px-3 py-2 text-zinc-200">{row.item}</td>
                  <td className="px-3 py-2">{row.validationType}</td>
                  <td className="px-3 py-2">
                    <span className="text-zinc-300">{row.sourceTier}</span>
                    <span className="block max-w-40 truncate text-zinc-500" title={row.sourceReference}>
                      {row.sourceReference}
                    </span>
                  </td>
                  <td className="px-3 py-2">{row.validationStatus}</td>
                  <td className="px-3 py-2">{row.recommendedAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function ReportedViewAudit({
  nodes,
  viewType,
}: {
  nodes: Step1ReportedNodeReviewEntry[];
  viewType: string;
}) {
  const visibleNodes = nodes.slice(0, MAX_VISIBLE_REPORTED_NODES);
  const hiddenNodeCount = nodes.length - visibleNodes.length;

  return (
    <details className="group rounded-lg border border-zinc-800 bg-zinc-950">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100">
        Reported view ({viewType}, {nodes.length} nodes)
        <span className="ml-2 text-xs font-normal text-zinc-500">filing-native source tree</span>
      </summary>
      <div className="space-y-2 border-t border-zinc-800 p-4">
        {visibleNodes.map((node) => (
          <ReportedNodeCard key={node.id} node={node} />
        ))}
        {hiddenNodeCount > 0 && (
          <p className="px-1 text-xs text-zinc-500">
            {hiddenNodeCount} more reported node(s) are available in the structured JSON.
          </p>
        )}
      </div>
    </details>
  );
}

function OmissionReview({ items }: { items: Step1OmissionReviewEntry[] }) {
  const visibleItems = items.slice(0, MAX_VISIBLE_OMISSION_ROWS);
  const hiddenItemCount = items.length - visibleItems.length;

  return (
    <details className="group rounded-lg border border-zinc-800 bg-zinc-950">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-300 hover:text-zinc-100">
        Missing / excluded review ({items.length})
        <span className="ml-2 text-xs font-normal text-zinc-500">conservative holdouts</span>
      </summary>
      <div className="space-y-2 border-t border-zinc-800 p-4">
        {visibleItems.map((item) => (
          <OmissionReviewCard key={`${item.item}-${item.claimId}`} item={item} />
        ))}
        {hiddenItemCount > 0 && (
          <p className="px-1 text-xs text-zinc-500">
            {hiddenItemCount} more excluded item(s) are available in the structured JSON.
          </p>
        )}
      </div>
    </details>
  );
}

function OmissionReviewCard({ item }: { item: Step1OmissionReviewEntry }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm text-zinc-300">
      <p className="font-medium text-zinc-100">{item.item}</p>
      <p className="mt-1 text-xs text-zinc-500">
        Evidence: {item.evidenceLevel} · Claim: {item.claimId} · Source:{" "}
        {item.officialSourceReference}
      </p>
      <p className="mt-2 text-sm text-zinc-400">{item.reason}</p>
      <p className="mt-2 text-xs text-amber-300">{item.recommendedAction}</p>
    </div>
  );
}

const DEPTH_INDENT: Record<number, string> = {
  0: "ml-0",
  1: "ml-4",
  2: "ml-8",
  3: "ml-12",
  4: "ml-16",
};

function ReportedNodeCard({ node }: { node: Step1ReportedNodeReviewEntry }) {
  const visibleProducts = node.products.slice(0, MAX_VISIBLE_PRODUCTS);
  const hiddenProductCount = node.products.length - visibleProducts.length;
  const indentClass = DEPTH_INDENT[Math.min(node.depth, 4)] ?? "ml-16";

  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 ${indentClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-zinc-100">{node.label}</p>
          <p className="mt-1 text-xs text-zinc-500">
            Claim: {node.claimId} · Evidence: {node.evidenceLevel} · Children: {node.childCount}
          </p>
        </div>
        {node.customerType && (
          <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">
            {node.customerType}
          </span>
        )}
      </div>

      {node.rawNameVariants.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          Variants: {node.rawNameVariants.join(", ")}
        </p>
      )}

      {node.products.length > 0 && (
        <p className="mt-2 text-xs text-zinc-400">
          Products: {visibleProducts.join(", ")}
          {hiddenProductCount > 0 ? ` +${hiddenProductCount} more` : ""}
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Data Lineage Note
// =============================================================================

function LineageNote({
  approved,
  companyType,
  ticker,
  architecture,
}: {
  approved: boolean;
  companyType?: CompanyType;
  ticker: string | null;
  architecture: BusinessArchitecture | null;
}) {
  const segments = architecture?.architecture ?? [];

  const pipelineLabel =
    companyType === "financial_bank" || companyType === "financial_insurance" || companyType === "financial_other"
      ? "FCFE / Ke (financial pipeline)"
      : companyType === "hybrid"
      ? "Hybrid — FCFF/WACC + FCFE/Ke (SOTP)"
      : "FCFF / WACC (industrial pipeline)";

  return (
    <section
      className={`rounded-lg border p-4 ${
        approved
          ? "border-emerald-700/40 bg-emerald-950/10"
          : "border-zinc-700/60 bg-zinc-900/40"
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <GitBranch size={15} className={approved ? "text-emerald-400" : "text-zinc-400"} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${approved ? "text-emerald-300" : "text-zinc-300"}`}>
          Data Lineage — What This Step Locks In
        </span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
            approved
              ? "bg-emerald-600/20 text-emerald-300"
              : "bg-zinc-700/50 text-zinc-400"
          }`}
        >
          {approved ? "Locked · flowing to Steps 2–8" : "Pending approval"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Pipeline */}
        <LineageCard
          label="DCF Pipeline"
          sublabel="Determines Steps 5–8 valuation mode"
          approved={approved}
        >
          {companyType ? (
            <span className="font-mono text-xs text-zinc-200">{pipelineLabel}</span>
          ) : (
            <span className="text-xs text-zinc-500">Awaiting analysis</span>
          )}
        </LineageCard>

        {/* Segments */}
        <LineageCard
          label="Canonical Segments"
          sublabel="Row identifiers for Steps 2–6 forecasting"
          approved={approved}
        >
          {segments.length > 0 ? (
            <ul className="space-y-0.5">
              {segments.slice(0, 5).map((a) => (
                <li key={a.segment} className="truncate font-mono text-xs text-zinc-200">
                  {a.segment}
                </li>
              ))}
              {segments.length > 5 && (
                <li className="text-xs text-zinc-500">+{segments.length - 5} more</li>
              )}
            </ul>
          ) : (
            <span className="text-xs text-zinc-500">Awaiting approval</span>
          )}
        </LineageCard>

        {/* Ticker */}
        <LineageCard
          label="Ticker"
          sublabel="Market data seed for Step 7 WACC fetch"
          approved={approved}
        >
          {ticker ? (
            <span className="font-mono text-sm font-semibold text-zinc-100">{ticker}</span>
          ) : (
            <span className="text-xs text-amber-400">Not set — enter above before approving</span>
          )}
        </LineageCard>
      </div>

      {!approved && (
        <p className="mt-3 text-xs text-zinc-500">
          These values are set in stone when you click <span className="text-zinc-300">Approve Step 1</span>. If segment names or the pipeline type are wrong, every downstream step will produce mismatched outputs.
        </p>
      )}
    </section>
  );
}

function LineageCard({
  label,
  sublabel,
  approved,
  children,
}: {
  label: string;
  sublabel: string;
  approved: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        approved ? "border-emerald-800/30 bg-emerald-950/20" : "border-zinc-800 bg-zinc-950/50"
      }`}
    >
      <p className="mb-0.5 text-xs font-medium text-zinc-300">{label}</p>
      <p className="mb-2 text-xs text-zinc-500">{sublabel}</p>
      {children}
    </div>
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
          <span className="text-xs text-zinc-500">Click to upload PDF</span>
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

// =============================================================================
// Finance Mode Indicator badge
// =============================================================================

function FinanceModeIndicator({ companyType }: { companyType?: CompanyType }) {
  if (!companyType || companyType === "industrial") return null;

  const config: Record<
    Exclude<CompanyType, "industrial">,
    { label: string; className: string }
  > = {
    financial_bank: {
      label: "Finance Mode — Bank",
      className: "bg-blue-600/20 text-blue-300 border border-blue-600/30",
    },
    financial_insurance: {
      label: "Finance Mode — Insurance",
      className: "bg-blue-600/20 text-blue-300 border border-blue-600/30",
    },
    financial_other: {
      label: "Finance Mode — Financial",
      className: "bg-blue-600/20 text-blue-300 border border-blue-600/30",
    },
    hybrid: {
      label: "Finance Mode — Hybrid",
      className: "bg-purple-600/20 text-purple-300 border border-purple-600/30",
    },
  };

  const { label, className } = config[companyType];

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}
