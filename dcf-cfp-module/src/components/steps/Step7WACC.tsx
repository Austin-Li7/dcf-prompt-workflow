"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, AlertTriangle, AlertCircle, CheckCircle2,
  RefreshCw, Save, Percent, Building2, Plus, Trash2,
  Download as ImportIcon, BarChart3, TrendingUp, Shield,
  SlidersHorizontal, Landmark, Info, GitMerge,
} from "lucide-react";
import StepShell from "./StepShell";
import StepModeIndicator from "@/components/ui/StepModeIndicator";
import { useCFP } from "@/context/CFPContext";
import {
  fullWACCCalculation, fullBankKeCalculation, calcWeightedBeta,
  detectConglomerate, detectFinancialCompany,
} from "@/lib/wacc-math";
import { inferTickerFromCompanyName, normalizeTickerInput } from "@/lib/ticker-lookup";
import { damodaranBetaForWorkflowMode } from "@/lib/damodaran-betas";
import { buildWaccSegmentsFromCFP } from "@/lib/wacc-handoff";
import { buildDcfValuation, buildSotpValuation } from "@/lib/dcf-valuation";
import { aggregateSegmentForecastFy, buildStep5AssumptionRows, buildStep5ReviewWarningRows, getStep5StructuredResults } from "@/lib/aggregate-forecast";
import type {
  WACCDataResponse, WACCSegmentRow, WACCConstants, BusinessType, WACCCalculation,
} from "@/types/wacc";
import type { SotpValuationResult } from "@/lib/dcf-valuation";

// =============================================================================
// Helpers
// =============================================================================
function uid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function pct(v: number, d = 2): string { return (v * 100).toFixed(d) + "%"; }
function fmtB(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString()}`;
}
function fmtM(v: number): string { return `$${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}M`; }
function fmtPct(v: number): string { return `${(v * 100).toFixed(1)}%`; }
function fmtUpside(v: number | null): string {
  if (v === null) return "N/A";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

// =============================================================================
// Component
// =============================================================================
export default function Step7WACC() {
  const { state, dispatch } = useCFP();
  const companyName = state.profile.companyName || "";
  const step1CompanyType = state.profile.step1StructuredResult?.company_type;

  const initialTicker = useMemo(
    () => normalizeTickerInput(state.profile.ticker) || inferTickerFromCompanyName(companyName),
    [companyName, state.profile.ticker],
  );
  const [tickerInput, setTickerInput] = useState(initialTicker);
  const activeTicker = normalizeTickerInput(tickerInput);
  const hasTicker = activeTicker.length > 0;

  // ── Fetched data ────────────────────────────────────────────────────────────
  const [fetchedData, setFetchedData] = useState<WACCDataResponse | null>(state.wacc.fetchedData);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Constants ───────────────────────────────────────────────────────────────
  const [constants, setConstants] = useState<WACCConstants>(state.wacc.constants);

  // ── Business type — auto-infer from Step 1 company_type on first visit ─────
  const inferredBusinessType = useMemo((): BusinessType => {
    if (state.wacc.businessType !== "single") return state.wacc.businessType;
    if (step1CompanyType === "hybrid") return "hybrid";
    if (step1CompanyType === "financial_bank" || step1CompanyType === "financial_insurance" || step1CompanyType === "financial_other") return "financial";
    return "single";
  }, [step1CompanyType, state.wacc.businessType]);

  const [businessType, setBusinessType] = useState<BusinessType>(inferredBusinessType);

  // ── Single / financial mode ─────────────────────────────────────────────────
  const [singleBeta, setSingleBeta] = useState(state.wacc.singleBeta);

  // ── Conglomerate mode ───────────────────────────────────────────────────────
  const [segments, setSegments] = useState<WACCSegmentRow[]>(state.wacc.segments);

  // ── Hybrid SOTP mode ────────────────────────────────────────────────────────
  const [hybridSegments, setHybridSegments] = useState<WACCSegmentRow[]>(state.wacc.hybridSegments);
  const [hybridBankBeta, setHybridBankBeta] = useState(state.wacc.hybridBankBeta);
  const [bankFcfMargin, setBankFcfMargin] = useState(state.wacc.bankFcfMargin ?? 0.20);
  const [industrialFcfMargin, setIndustrialFcfMargin] = useState(state.wacc.industrialFcfMargin ?? 0.25);

  // ── Shared dashboard ────────────────────────────────────────────────────────
  const [showValuationDashboard, setShowValuationDashboard] = useState(false);
  const [terminalGrowth, setTerminalGrowth] = useState(state.wacc.terminalGrowth ?? 0.025);
  const [fcfMargin, setFcfMargin] = useState(state.wacc.fcfMargin ?? 0.25);
  const [fetchedAt, setFetchedAt] = useState<string | null>(state.wacc.fetchedAt ?? null);

  // ── Detect hints from fetched data ─────────────────────────────────────────
  const conglomerateHint = useMemo(() => {
    if (!fetchedData?.companyDescription) return null;
    const r = detectConglomerate(fetchedData.companyDescription);
    return r.isConglomerate ? r.reason : null;
  }, [fetchedData?.companyDescription]);

  const financialHint = useMemo(() => {
    if (!fetchedData) return null;
    const r = detectFinancialCompany(fetchedData.industry, fetchedData.companyDescription);
    return r.isFinancial ? r.reason : null;
  }, [fetchedData]);

  // ── When data arrives: auto-suggest mode and beta ──────────────────────────
  useEffect(() => {
    if (!fetchedData) return;
    if (fetchedData.industry && businessType === "single") {
      const { isFinancial } = detectFinancialCompany(fetchedData.industry);
      if (isFinancial) setBusinessType("financial");
    }
    if (fetchedData.damodaranBeta != null) {
      setSingleBeta(fetchedData.damodaranBeta);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedData]);

  // ── Fetch market data ───────────────────────────────────────────────────────
  const fetchData = useCallback(async (tickerOverride?: string) => {
    const t = normalizeTickerInput(tickerOverride || tickerInput);
    if (!t) return;
    setIsFetching(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/wacc-data?ticker=${encodeURIComponent(t)}`);
      const data: WACCDataResponse = await res.json();
      if (data.error) setFetchError(data.error);
      setFetchedData(data);
      setFetchedAt(new Date().toISOString());
      if (data.ticker) {
        setTickerInput(data.ticker);
        dispatch({ type: "UPDATE_PROFILE", payload: { ticker: data.ticker } });
      }
      if (data.riskFreeRate > 0) setConstants((p) => ({ ...p, riskFreeRate: data.riskFreeRate }));
    } catch {
      setFetchError("Failed to fetch market data.");
    } finally {
      setIsFetching(false);
    }
  }, [dispatch, tickerInput]);

  useEffect(() => {
    if (hasTicker && !fetchedData) fetchData(activeTicker);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tickerInput && initialTicker) {
      setTickerInput(initialTicker);
      dispatch({ type: "UPDATE_PROFILE", payload: { ticker: initialTicker } });
    }
  }, [dispatch, initialTicker, tickerInput]);

  // ── Segment management (conglomerate mode) ─────────────────────────────────
  const addSegment = () =>
    setSegments((p) => [...p, { id: uid(), name: "", unleveredBeta: 1.0, estimatedValue: 0 }]);
  const removeSegment = (id: string) =>
    setSegments((p) => p.filter((s) => s.id !== id));
  const updateSegment = (id: string, field: keyof WACCSegmentRow, value: string | number) =>
    setSegments((p) => p.map((s) => (s.id === id ? { ...s, [field]: value } : s)));

  const importFromCFP = () => {
    if (!state.profile.architectureJson?.architecture.length) return;
    const workflowModes: Record<string, "bank" | "industrial"> = {};
    for (const seg of state.profile.step1StructuredResult?.analysis_view.segments ?? []) {
      if (seg.workflow_mode) workflowModes[seg.canonical_name] = seg.workflow_mode;
    }
    setSegments(buildWaccSegmentsFromCFP(state.profile.architectureJson, state.forecast, uid, workflowModes));
  };

  // ── Hybrid segment import ─────────────────────────────────────────────────
  const importHybridFromCFP = () => {
    if (!state.profile.architectureJson?.architecture.length) return;
    const workflowModes: Record<string, "bank" | "industrial"> = {};
    for (const seg of state.profile.step1StructuredResult?.analysis_view.segments ?? []) {
      if (seg.workflow_mode) workflowModes[seg.canonical_name] = seg.workflow_mode;
    }
    const rows = buildWaccSegmentsFromCFP(state.profile.architectureJson, state.forecast, uid, workflowModes);
    // Annotate with workflowMode from the map
    const annotated = rows.map((r) => ({
      ...r,
      workflowMode: (workflowModes[r.name] ?? "industrial") as "bank" | "industrial",
    }));
    setHybridSegments(annotated);
    // Use the Damodaran bank beta (0.37) — the whole-company damodaranBeta
    // reflects the dominant industry (e.g. Software 0.96) and is wrong here.
    setHybridBankBeta(damodaranBetaForWorkflowMode("bank"));
  };

  const addHybridSegment = () =>
    setHybridSegments((p) => [...p, { id: uid(), name: "", unleveredBeta: 0.96, estimatedValue: 0, workflowMode: "industrial" }]);
  const removeHybridSegment = (id: string) =>
    setHybridSegments((p) => p.filter((s) => s.id !== id));
  const updateHybridSegment = (id: string, field: keyof WACCSegmentRow, value: string | number) =>
    setHybridSegments((p) => p.map((s) => (s.id === id ? { ...s, [field]: value } : s)));

  const hasArchitecture = !!state.profile.architectureJson?.architecture?.length;

  // ── Live calculations ──────────────────────────────────────────────────────
  const weightedBeta = useMemo(() => calcWeightedBeta(segments), [segments]);

  // Industrial weighted beta from hybrid segments
  const hybridIndustrialSegments = useMemo(
    () => hybridSegments.filter((s) => s.workflowMode === "industrial"),
    [hybridSegments],
  );
  const hybridIndustrialWeightedBeta = useMemo(
    () => calcWeightedBeta(hybridIndustrialSegments),
    [hybridIndustrialSegments],
  );

  const effectiveBeta = businessType === "conglomerate" ? weightedBeta : singleBeta;

  // Primary calculation (used for single / conglomerate / financial)
  const waccResult = useMemo(() => {
    if (businessType === "hybrid") return null;
    if (!fetchedData || fetchedData.marketCap <= 0) return null;
    if (businessType === "financial") return { calculation: fullBankKeCalculation({ equityBeta: singleBeta, constants }), warnings: [] };
    return fullWACCCalculation({
      marketCap: fetchedData.marketCap, totalDebt: fetchedData.totalDebt,
      interestExpense: fetchedData.interestExpense, unleveredBeta: effectiveBeta, constants,
    });
  }, [fetchedData, businessType, singleBeta, effectiveBeta, constants]);
  const calculation: WACCCalculation | null = waccResult?.calculation ?? null;
  const waccWarnings: string[] = waccResult?.warnings ?? [];

  // Hybrid: bank Ke
  const bankKeCalc: WACCCalculation | null = useMemo(() => {
    if (businessType !== "hybrid") return null;
    return fullBankKeCalculation({ equityBeta: hybridBankBeta, constants });
  }, [businessType, hybridBankBeta, constants]);

  // Hybrid: industrial WACC
  const industrialWaccResult = useMemo(() => {
    if (businessType !== "hybrid") return null;
    if (!fetchedData || fetchedData.marketCap <= 0) return null;
    return fullWACCCalculation({
      marketCap: fetchedData.marketCap, totalDebt: fetchedData.totalDebt,
      interestExpense: fetchedData.interestExpense,
      unleveredBeta: hybridIndustrialWeightedBeta, constants,
    });
  }, [businessType, fetchedData, hybridIndustrialWeightedBeta, constants]);
  const industrialWaccCalc: WACCCalculation | null = industrialWaccResult?.calculation ?? null;
  const industrialWaccWarnings: string[] = industrialWaccResult?.warnings ?? [];

  const hasCalculation = businessType === "hybrid"
    ? (bankKeCalc !== null && industrialWaccCalc !== null)
    : calculation !== null;

  // ── Hybrid segment names for forecast extraction ──────────────────────────
  const bankSegmentNames = useMemo(
    () => hybridSegments.filter((s) => s.workflowMode === "bank").map((s) => s.name),
    [hybridSegments],
  );
  const industrialSegmentNames = useMemo(
    () => hybridSegments.filter((s) => s.workflowMode === "industrial").map((s) => s.name),
    [hybridSegments],
  );

  // ── Valuations ─────────────────────────────────────────────────────────────
  const standardValuation = useMemo(() => {
    if (businessType === "hybrid") return null;
    return buildDcfValuation({ forecast: state.forecast, wacc: { ...state.wacc, fetchedData, constants, businessType, singleBeta, segments, calculation, saved: state.wacc.saved }, fcfMargin, terminalGrowth });
  }, [businessType, state.forecast, state.wacc, fetchedData, constants, singleBeta, segments, calculation, fcfMargin, terminalGrowth]);

  const sotpValuation = useMemo((): SotpValuationResult | null => {
    if (businessType !== "hybrid" || !bankKeCalc || !industrialWaccCalc) return null;
    const bankRev = aggregateSegmentForecastFy(bankSegmentNames, state.forecast);
    const indRev = aggregateSegmentForecastFy(industrialSegmentNames, state.forecast);
    return buildSotpValuation({
      bankRevenueFy: bankRev, industrialRevenueFy: indRev,
      bankKe: bankKeCalc.wacc, industrialWacc: industrialWaccCalc.wacc,
      bankFcfMargin, industrialFcfMargin, terminalGrowth, fetchedData,
    });
  }, [businessType, bankKeCalc, industrialWaccCalc, bankSegmentNames, industrialSegmentNames, state.forecast, bankFcfMargin, industrialFcfMargin, terminalGrowth, fetchedData]);

  const step5Artifacts = useMemo(() => getStep5StructuredResults(state.forecast), [state.forecast]);
  const assumptionRows = useMemo(() => buildStep5AssumptionRows(state.forecast), [state.forecast]);
  const reviewWarnings = useMemo(() => buildStep5ReviewWarningRows(state.forecast), [state.forecast]);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (activeTicker) dispatch({ type: "UPDATE_PROFILE", payload: { ticker: activeTicker } });
    dispatch({
      type: "SET_WACC",
      payload: {
        fetchedData, constants, businessType, singleBeta, segments,
        calculation: businessType === "hybrid" ? (bankKeCalc ?? null) : calculation,
        hybridSegments, hybridBankBeta,
        bankKeCalculation: bankKeCalc, industrialWaccCalculation: industrialWaccCalc,
        saved: true,
        fcfMargin, terminalGrowth, bankFcfMargin, industrialFcfMargin,
        fetchedAt,
      },
    });
  };
  const handleComplete = () => {
    if (!hasCalculation) return;
    if (!state.wacc.saved) handleSave();
    setShowValuationDashboard(true);
  };
  const handleNext = () => {
    if (!hasCalculation) return;
    handleSave();
    dispatch({ type: "NEXT_STEP" });
  };

  const activeValuation = businessType === "hybrid" ? sotpValuation : standardValuation;
  const upside = activeValuation?.impliedUpsidePct ?? null;

  // ── WACC sensitivity grid (beta ±0.1 × ERP ±0.5%) ──────────────────────────
  const waccSensitivity = useMemo(() => {
    if (!calculation || businessType === "financial" || businessType === "hybrid") return null;
    if (!fetchedData || fetchedData.marketCap <= 0) return null;
    const betaDeltas = [-0.1, 0, 0.1];
    const erpDeltas = [-0.005, 0, 0.005];
    return betaDeltas.map((db) =>
      erpDeltas.map((de) => {
        const r = fullWACCCalculation({
          marketCap: fetchedData.marketCap,
          totalDebt: fetchedData.totalDebt,
          interestExpense: fetchedData.interestExpense,
          unleveredBeta: effectiveBeta + db,
          constants: { ...constants, impliedERP: constants.impliedERP + de },
        });
        return r?.calculation.wacc ?? null;
      }),
    );
  }, [calculation, businessType, fetchedData, effectiveBeta, constants]);

  // ==========================================================================
  // Render
  // ==========================================================================
  return (
    <StepShell
      stepNumber={7}
      title="Discount Rate (WACC)"
      subtitle="Calculate the cost of capital using Damodaran's industry beta methodology."
      onNext={handleNext}
      nextDisabled={!hasCalculation}
      onComplete={handleComplete}
      completeDisabled={!hasCalculation}
      completeLabel={showValuationDashboard ? "Refresh Dashboard" : "Complete"}
    >
      <div className="space-y-6">

        {/* ── Mode indicator ───────────────────────────────────────────────── */}
        <StepModeIndicator
          businessType={businessType}
          context={
            businessType === "hybrid"
              ? `${bankSegmentNames.length} bank · ${industrialSegmentNames.length} industrial segment${industrialSegmentNames.length !== 1 ? "s" : ""}`
              : fetchedData?.damodaranIndustry
              ? `Damodaran: ${fetchedData.damodaranIndustry} · β ${fetchedData.damodaranBeta?.toFixed(3)}`
              : undefined
          }
        />

        {/* ── Valuation Dashboard ─────────────────────────────────────────── */}
        {showValuationDashboard && activeValuation && (
          <section className="space-y-5 rounded-xl border border-emerald-700/40 bg-emerald-950/10 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-emerald-300">
                  <Shield size={16} />
                  {businessType === "hybrid" ? "Sum-of-Parts Valuation Dashboard" : "Final Valuation Dashboard"}
                </h3>
                <p className="mt-1 text-xs text-zinc-400">
                  {businessType === "hybrid"
                    ? "Bank segments discounted at Ke · Industrial segments discounted at WACC · Equity values summed."
                    : "Illustrative DCF using Step 5 forecast and Step 7 discount rate."}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                upside !== null && upside >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
              }`}>
                vs Market Cap {fmtUpside(upside)}
              </span>
            </div>

            {!activeValuation.hasInputs ? (
              <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-200">
                {activeValuation.warnings.join(" ")}
              </div>
            ) : (
              <>
                {businessType === "hybrid" && sotpValuation ? (
                  <SotpDashboard val={sotpValuation} bankFcfMargin={bankFcfMargin} setBankFcfMargin={setBankFcfMargin}
                    industrialFcfMargin={industrialFcfMargin} setIndustrialFcfMargin={setIndustrialFcfMargin}
                    terminalGrowth={terminalGrowth} setTerminalGrowth={setTerminalGrowth} />
                ) : (
                  <StandardDashboard val={activeValuation} businessType={businessType}
                    fcfMargin={fcfMargin} setFcfMargin={setFcfMargin}
                    terminalGrowth={terminalGrowth} setTerminalGrowth={setTerminalGrowth} />
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Top Model Drivers</h4>
                    <ul className="mt-2 space-y-1.5 text-xs text-zinc-300">
                      {assumptionRows.slice(0, 4).map((row) => (
                        <li key={`${row.segment}-${row.assumption_id}`}>
                          <span className="font-mono text-blue-300">{row.assumption_id}</span>{" "}
                          <span className="text-zinc-500">{row.driver_quality}</span> {row.statement}
                        </li>
                      ))}
                      {assumptionRows.length === 0 && <li className="text-zinc-600">No Step 5 structured assumptions found.</li>}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-300">Audit Flags</h4>
                    {reviewWarnings.length > 0 ? (
                      <ul className="mt-2 space-y-1.5 text-xs text-amber-100">
                        {reviewWarnings.slice(0, 4).map((row, i) => (
                          <li key={`${row.audit_flag}-${i}`}>
                            <span className="font-mono text-amber-300">{row.audit_flag}</span> {row.warning}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-zinc-500">No Step 5 review warnings.</p>
                    )}
                  </div>
                </div>

                {activeValuation.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
                    {activeValuation.warnings.join(" ")}
                  </div>
                )}
                {step5Artifacts.length === 0 && (
                  <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
                    Step 5 structured artifact missing — dashboard quality is limited.
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ── Section A: Market Data ──────────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              <BarChart3 size={16} /> Market Data
            </h3>
            <div className="flex items-center gap-3">
              {fetchedData && <span className="text-xs text-zinc-400 font-medium">{fetchedData.companyName}</span>}
              {fetchedAt && (
                <span className="text-xs text-zinc-600" title={fetchedAt}>
                  Fetched {new Date(fetchedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          {!hasTicker && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/30 p-3 text-sm text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              No ticker saved yet. Enter one below then save to persist.
            </div>
          )}

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-zinc-500">Ticker Symbol</label>
              <input type="text" value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                placeholder={companyName ? `Ticker for ${companyName}` : "SOFI"}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500"
              />
            </div>
            <button onClick={() => fetchData(activeTicker)} disabled={isFetching || !hasTicker}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500">
              {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {fetchedData ? "Refetch" : "Fetch Data"}
            </button>
          </div>

          {fetchError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-950/30 p-3 text-xs text-red-300">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> {fetchError}
            </div>
          )}

          {fetchedData && !fetchError && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <DataCard label="Market Cap" value={fmtB(fetchedData.marketCap)} />
                <DataCard label="Total Debt" value={fmtB(fetchedData.totalDebt)} />
                <DataCard label="Interest Expense" value={fmtB(fetchedData.interestExpense)} />
              </div>
              {fetchedData.industry && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                  <Info size={12} className="shrink-0" />
                  Yahoo Finance industry: <span className="text-zinc-300 font-medium">{fetchedData.industry}</span>
                  {fetchedData.damodaranIndustry && (
                    <>
                      <span className="text-zinc-700">→</span>
                      Damodaran: <span className="text-blue-400 font-medium">{fetchedData.damodaranIndustry}</span>
                      <span className="text-zinc-600">(β = {fetchedData.damodaranBeta?.toFixed(3)})</span>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* ── Section B: Model Constants ──────────────────────────────────── */}
        <section className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-5 space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            <Percent size={16} /> Model Constants
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <ConstantInput label="Risk-Free Rate (%)" value={constants.riskFreeRate * 100}
              onChange={(v) => setConstants((p) => ({ ...p, riskFreeRate: v / 100 }))} hint="10Y Treasury (^TNX, live)" />
            <ConstantInput label="Implied ERP (%)" value={constants.impliedERP * 100}
              onChange={(v) => setConstants((p) => ({ ...p, impliedERP: v / 100 }))} hint="Damodaran implied ERP" />
            <ConstantInput label="Marginal Tax Rate (%)" value={constants.marginalTaxRate * 100}
              onChange={(v) => setConstants((p) => ({ ...p, marginalTaxRate: v / 100 }))} hint="US statutory corporate rate" />
          </div>
        </section>

        {/* ── Section C: Beta & Discount Rate Configuration ───────────────── */}
        <section className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-5 space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            <Building2 size={16} /> Beta & Discount Rate Configuration
          </h3>

          {/* Mode buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {(["single", "conglomerate", "financial", "hybrid"] as BusinessType[]).map((mode) => {
              const active = businessType === mode;
              const colors: Record<BusinessType, string> = {
                single: "bg-blue-600 text-white",
                conglomerate: "bg-purple-600 text-white",
                financial: "bg-amber-600 text-white",
                hybrid: "bg-teal-600 text-white",
              };
              const labels: Record<BusinessType, React.ReactNode> = {
                single: "Single Business",
                conglomerate: "Conglomerate",
                financial: <><Landmark size={13} className="inline mr-1" />Financial / Bank</>,
                hybrid: <><GitMerge size={13} className="inline mr-1" />Hybrid · SOTP</>,
              };
              return (
                <button key={mode} onClick={() => setBusinessType(mode)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    active ? colors[mode] : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}>
                  {labels[mode]}
                </button>
              );
            })}
          </div>

          {/* Mode explanations */}
          {businessType === "single" && (
            <p className="text-xs text-zinc-500">
              One industry unlevered beta → Hamada re-lever (D/E, tax rate) → CAPM Ke → WACC blend.
            </p>
          )}
          {businessType === "conglomerate" && (
            <p className="text-xs text-zinc-500">
              Value-weighted blend of per-segment unlevered betas → single β → Hamada → WACC.
            </p>
          )}
          {businessType === "financial" && (
            <div className="rounded-lg border border-amber-700/30 bg-amber-950/20 p-3 text-xs text-amber-200 space-y-1">
              <p className="font-semibold text-amber-300">Bank / Financial — Ke-Only Mode</p>
              <p>Deposits and policy reserves are operational funding, not Modigliani-Miller debt. Applying Hamada
                re-levering to a bank's balance sheet overstates its cost of capital. Use Damodaran's published
                bank-industry beta directly as the equity beta: Ke = Rf + β × ERP.
                Discount <strong>equity</strong> cash flows (FCFE / dividends) at Ke.</p>
            </div>
          )}
          {businessType === "hybrid" && (
            <div className="rounded-lg border border-teal-700/30 bg-teal-950/20 p-3 text-xs text-teal-200 space-y-1">
              <p className="font-semibold text-teal-300">Hybrid — Sum-of-Parts Mode</p>
              <p>
                <strong>Bank segments</strong> (e.g. Lending, Financial Services): FCFE discounted at Ke — no D/E
                re-levering; deposits are operational. Equity value is calculated directly.
              </p>
              <p>
                <strong>Industrial segments</strong> (e.g. Technology Platform / Galileo): FCFF discounted at full
                WACC (Hamada re-lever + Ke + Kd blend). Consolidated net debt is subtracted from industrial EV.
              </p>
              <p>Total equity value = Bank equity value + Industrial equity value (Sum-of-Parts).</p>
            </div>
          )}

          {/* Auto-detect hints */}
          {businessType !== "financial" && businessType !== "hybrid" && financialHint && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/30 p-3 text-xs text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span><strong>Suggestion:</strong> {financialHint}{" "}
                <button type="button" onClick={() => setBusinessType("financial")} className="ml-1 underline underline-offset-2 hover:text-amber-200">Switch to Financial mode</button>
              </span>
            </div>
          )}
          {businessType === "single" && conglomerateHint && !financialHint && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/30 p-3 text-xs text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span><strong>Suggestion:</strong> {conglomerateHint}{" "}
                <button type="button" onClick={() => setBusinessType("conglomerate")} className="ml-1 underline underline-offset-2 hover:text-amber-200">Switch to Conglomerate</button>
              </span>
            </div>
          )}

          {/* ── Single / Financial beta input ─────────────────────────────── */}
          {(businessType === "single" || businessType === "financial") && (
            <div className="space-y-2">
              <div className="max-w-xs">
                <label className="mb-1 block text-xs text-zinc-500">
                  {businessType === "financial" ? "Industry Equity Beta (no re-levering)" : "Industry Unlevered Beta (Damodaran)"}
                </label>
                <input type="number" step="0.01" value={singleBeta}
                  onChange={(e) => setSingleBeta(Number(e.target.value))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500" />
              </div>
              {fetchedData?.damodaranBeta != null ? (
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                  Damodaran 2025: <span className="font-medium text-zinc-300">{fetchedData.damodaranIndustry}</span>
                  {" "}= <span className="font-mono text-blue-400">{fetchedData.damodaranBeta.toFixed(3)}</span>
                  {singleBeta !== fetchedData.damodaranBeta && (
                    <button type="button" onClick={() => setSingleBeta(fetchedData.damodaranBeta!)}
                      className="ml-1 rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-800 text-zinc-300">Apply</button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">Fetch market data to auto-suggest a Damodaran beta.</p>
              )}
            </div>
          )}

          {/* ── Conglomerate segments table ───────────────────────────────── */}
          {businessType === "conglomerate" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {hasArchitecture && (
                  <button onClick={importFromCFP}
                    className="flex items-center gap-1.5 rounded-lg border border-blue-600/50 bg-blue-600/10 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-600/20">
                    <ImportIcon size={12} /> Import Segments from CFP
                  </button>
                )}
                <button onClick={addSegment}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
                  <Plus size={12} /> Add Segment
                </button>
                <span className="text-xs text-zinc-600">Import assigns Damodaran betas: bank ≈ 0.37 · industrial ≈ 0.96</span>
              </div>
              {segments.length > 0 && <SegmentTable segments={segments} weighted={weightedBeta}
                onUpdate={updateSegment} onRemove={removeSegment} />}
            </div>
          )}

          {/* ── Hybrid SOTP segment configuration ────────────────────────── */}
          {businessType === "hybrid" && (
            <div className="space-y-4">
              {/* Bank group beta */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">
                    Bank Segments — Equity Beta (Damodaran, no re-levering)
                  </label>
                  <input type="number" step="0.01" value={hybridBankBeta}
                    onChange={(e) => setHybridBankBeta(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500" />
                  <p className="mt-1 text-xs text-zinc-600">
                    Applied to all bank-mode segments. Damodaran Banks (Regional) ≈ 0.37 · Fintech ≈ 0.73
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-zinc-400 space-y-1">
                  <p className="font-semibold text-zinc-300">Industrial segments use per-segment betas below.</p>
                  <p>Value-weighted → Hamada re-lever → WACC (same as Conglomerate mode).</p>
                  {hybridIndustrialWeightedBeta > 0 && (
                    <p>Current weighted β: <span className="font-mono text-blue-400">{hybridIndustrialWeightedBeta.toFixed(3)}</span></p>
                  )}
                </div>
              </div>

              {/* Segment import + table */}
              <div className="flex flex-wrap items-center gap-2">
                {hasArchitecture && (
                  <button onClick={importHybridFromCFP}
                    className="flex items-center gap-1.5 rounded-lg border border-teal-600/50 bg-teal-600/10 px-3 py-1.5 text-xs font-medium text-teal-400 hover:bg-teal-600/20">
                    <ImportIcon size={12} /> Import Segments from CFP
                  </button>
                )}
                <button onClick={addHybridSegment}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
                  <Plus size={12} /> Add Segment
                </button>
              </div>

              {hybridSegments.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-800 text-zinc-400">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Segment</th>
                        <th className="px-3 py-2 text-center font-medium">Mode</th>
                        <th className="px-3 py-2 text-right font-medium">Beta</th>
                        <th className="px-3 py-2 text-right font-medium">Est. Value ($M)</th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {hybridSegments.map((seg) => (
                        <tr key={seg.id} className="hover:bg-zinc-900/30">
                          <td className="px-2 py-1">
                            <input type="text" value={seg.name}
                              onChange={(e) => updateHybridSegment(seg.id, "name", e.target.value)}
                              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-blue-500" />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <button
                              onClick={() => updateHybridSegment(seg.id, "workflowMode", seg.workflowMode === "bank" ? "industrial" : "bank")}
                              className={`rounded px-2 py-0.5 text-xs font-medium ${
                                seg.workflowMode === "bank"
                                  ? "bg-amber-900/40 text-amber-300 border border-amber-700/30"
                                  : "bg-blue-900/40 text-blue-300 border border-blue-700/30"
                              }`}>
                              {seg.workflowMode === "bank" ? "Bank" : "Industrial"}
                            </button>
                          </td>
                          <td className="px-2 py-1">
                            {seg.workflowMode === "bank" ? (
                              <span className="block w-24 text-right font-mono text-zinc-500 pr-2">{hybridBankBeta.toFixed(3)}</span>
                            ) : (
                              <input type="number" step="0.01" value={seg.unleveredBeta}
                                onChange={(e) => updateHybridSegment(seg.id, "unleveredBeta", Number(e.target.value))}
                                className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-xs text-zinc-100 outline-none focus:border-blue-500" />
                            )}
                          </td>
                          <td className="px-2 py-1">
                            <input type="number" step="1" value={seg.estimatedValue}
                              onChange={(e) => updateHybridSegment(seg.id, "estimatedValue", Number(e.target.value))}
                              className="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-xs text-zinc-100 outline-none focus:border-blue-500" />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <button onClick={() => removeHybridSegment(seg.id)} className="text-zinc-600 hover:text-red-400">
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Section D: Calculation Results ──────────────────────────────── */}
        {businessType !== "hybrid" && calculation && (
          <section className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-5 space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              <TrendingUp size={16} />
              {businessType === "financial" ? "Cost of Equity (Ke) — Bank / Financial Mode" : "WACC Calculation"}
            </h3>

            {businessType === "financial" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <CalcCard label="Equity Beta (Damodaran)" value={calculation.unleveredBeta.toFixed(3)} />
                <CalcCard label="Risk-Free Rate" value={pct(constants.riskFreeRate)} />
                <CalcCard label="Implied ERP" value={pct(constants.impliedERP)} />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <CalcCard label="D/E Ratio" value={calculation.deRatio.toFixed(3)} />
                <CalcCard label="Unlevered Beta" value={calculation.unleveredBeta.toFixed(3)} />
                <CalcCard label="Re-levered Beta" value={calculation.releveredBeta.toFixed(3)} highlight />
                <CalcCard label="Cost of Equity" value={pct(calculation.costOfEquity)} />
                <CalcCard label="Pre-Tax Cost of Debt" value={pct(calculation.preTaxCostOfDebt)} />
                <CalcCard label="After-Tax Cost of Debt" value={pct(calculation.afterTaxCostOfDebt)} />
                <CalcCard label="Weight of Equity" value={pct(calculation.weightEquity, 1)} />
                <CalcCard label="Weight of Debt" value={pct(calculation.weightDebt, 1)} />
              </div>
            )}

            <div className={`rounded-xl p-6 text-center border-2 ${
              businessType === "financial" ? "border-amber-500/30 bg-amber-950/20" : "border-emerald-500/30 bg-emerald-950/20"
            }`}>
              <p className={`text-xs font-semibold uppercase tracking-wider ${businessType === "financial" ? "text-amber-400" : "text-emerald-400"}`}>
                {businessType === "financial" ? "Cost of Equity (Ke)" : "Final WACC"}
              </p>
              <p className={`mt-2 text-4xl font-bold tabular-nums ${businessType === "financial" ? "text-amber-400" : "text-emerald-400"}`}>
                {pct(calculation.wacc)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {businessType === "financial"
                  ? `Ke = ${pct(constants.riskFreeRate)} Rf + ${calculation.unleveredBeta.toFixed(3)} β × ${pct(constants.impliedERP)} ERP`
                  : `= (${pct(calculation.weightEquity, 1)} × ${pct(calculation.costOfEquity)} Ke) + (${pct(calculation.weightDebt, 1)} × ${pct(calculation.afterTaxCostOfDebt)} Kd)`
                }
              </p>
            </div>

            {/* Validation warnings from sanity checks */}
            {waccWarnings.length > 0 && (
              <div className="space-y-1.5">
                {waccWarnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
                  </div>
                ))}
              </div>
            )}

            {/* WACC Sensitivity: unlevered beta ±0.1 × ERP ±0.5% */}
            {waccSensitivity && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  WACC Sensitivity — Beta ±0.1 × ERP ±0.5%
                </h4>
                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-800 text-zinc-400">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">β \ ERP</th>
                        <th className="px-3 py-2 text-center font-medium">{pct(constants.impliedERP - 0.005, 1)} ERP</th>
                        <th className="px-3 py-2 text-center font-medium">{pct(constants.impliedERP, 1)} ERP (base)</th>
                        <th className="px-3 py-2 text-center font-medium">{pct(constants.impliedERP + 0.005, 1)} ERP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {waccSensitivity.map((row, ri) => {
                        const betaLabel = ri === 0 ? `β ${(effectiveBeta - 0.1).toFixed(2)} (−0.1)` : ri === 1 ? `β ${effectiveBeta.toFixed(2)} (base)` : `β ${(effectiveBeta + 0.1).toFixed(2)} (+0.1)`;
                        return (
                          <tr key={ri} className={ri === 1 ? "bg-zinc-800/30" : ""}>
                            <td className="px-3 py-2 font-medium text-zinc-300">{betaLabel}</td>
                            {row.map((val, ci) => (
                              <td key={ci} className={`px-3 py-2 text-center font-mono ${ri === 1 && ci === 1 ? "font-bold text-emerald-400" : "text-zinc-300"}`}>
                                {val !== null ? pct(val) : "—"}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Hybrid dual-rate results */}
        {businessType === "hybrid" && (bankKeCalc || industrialWaccCalc) && (
          <section className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-5 space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              <TrendingUp size={16} /> Hybrid Discount Rates
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Bank Ke */}
              <div className="rounded-xl border-2 border-amber-500/30 bg-amber-950/20 p-5 text-center space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">Bank Segments — Ke</p>
                <p className="text-3xl font-bold tabular-nums text-amber-400">{bankKeCalc ? pct(bankKeCalc.wacc) : "—"}</p>
                <p className="text-xs text-zinc-500">
                  {bankKeCalc ? `${pct(constants.riskFreeRate)} + ${hybridBankBeta.toFixed(3)} β × ${pct(constants.impliedERP)} ERP` : "Set bank beta above"}
                </p>
              </div>
              {/* Industrial WACC */}
              <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-950/20 p-5 text-center space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Industrial Segments — WACC</p>
                <p className="text-3xl font-bold tabular-nums text-emerald-400">{industrialWaccCalc ? pct(industrialWaccCalc.wacc) : "—"}</p>
                {industrialWaccCalc && (
                  <p className="text-xs text-zinc-500">
                    Re-levered β {industrialWaccCalc.releveredBeta.toFixed(3)} · Ke {pct(industrialWaccCalc.costOfEquity)} · Kd {pct(industrialWaccCalc.afterTaxCostOfDebt)}
                  </p>
                )}
                {!industrialWaccCalc && <p className="text-xs text-zinc-500">Add industrial segments with estimated values above</p>}
              </div>
            </div>
            {industrialWaccWarnings.length > 0 && (
              <div className="space-y-1.5">
                {industrialWaccWarnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Section E: Save / Complete ──────────────────────────────────── */}
        {hasCalculation && (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={handleSave}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500">
              <Save size={16} /> Save to Master Framework
            </button>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <CheckCircle2 size={14} className="text-emerald-500" />
              {businessType === "hybrid"
                ? `Bank Ke ${bankKeCalc ? pct(bankKeCalc.wacc) : "—"} · Industrial WACC ${industrialWaccCalc ? pct(industrialWaccCalc.wacc) : "—"}`
                : `${businessType === "financial" ? "Ke" : "WACC"}: ${calculation ? pct(calculation.wacc) : "—"}`
              } — ready for DCF valuation
            </div>
          </div>
        )}
      </div>
    </StepShell>
  );
}

// =============================================================================
// Valuation dashboard sub-components
// =============================================================================

function StandardDashboard({ val, businessType, fcfMargin, setFcfMargin, terminalGrowth, setTerminalGrowth }: {
  val: NonNullable<ReturnType<typeof buildDcfValuation>>;
  businessType: BusinessType;
  fcfMargin: number; setFcfMargin: (v: number) => void;
  terminalGrowth: number; setTerminalGrowth: (v: number) => void;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardCard label="DCF Equity Value" value={fmtM(val.equityValueUsdM)} highlight />
        <DashboardCard label="Enterprise Value" value={fmtM(val.enterpriseValueUsdM)} />
        <DashboardCard label="Market Cap" value={val.marketCapUsdM ? fmtM(val.marketCapUsdM) : "N/A"} />
        <DashboardCard label={businessType === "financial" ? "Ke" : "WACC"} value={val.wacc ? fmtPct(val.wacc) : "N/A"} />
      </div>

      {/* Per-share intrinsic value + decision signal */}
      {val.intrinsicValuePerShare !== null && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
          <div>
            <p className="text-xs text-zinc-500">Intrinsic Value / Share</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-zinc-100">
              ${val.intrinsicValuePerShare.toFixed(2)}
            </p>
          </div>
          {val.currentPrice !== null && (
            <div>
              <p className="text-xs text-zinc-500">Current Price</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-300">
                ${val.currentPrice.toFixed(2)}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-zinc-500">Implied Upside</p>
            <p className={`mt-0.5 text-lg font-bold tabular-nums ${val.impliedUpsidePct !== null && val.impliedUpsidePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {fmtUpside(val.impliedUpsidePct)}
            </p>
          </div>
          <div className="ml-auto">
            <span className={`rounded-full border px-3 py-1 text-sm font-bold ${
              val.decision.action === "BUY" ? "border-emerald-600/50 bg-emerald-950/40 text-emerald-300"
              : val.decision.action === "WATCH" ? "border-amber-600/50 bg-amber-950/40 text-amber-300"
              : val.decision.action === "AVOID" ? "border-red-600/50 bg-red-950/40 text-red-300"
              : "border-zinc-700 bg-zinc-900 text-zinc-500"
            }`}>
              {val.decision.action}
            </span>
            <p className="mt-1 text-xs text-zinc-500">{val.decision.summary}</p>
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <ForecastTable rows={val.forecastRows} terminalValueUsdM={val.terminalValueUsdM} terminalPvUsdM={val.terminalPresentValueUsdM} />
        <AssumptionsPanel fcfMargin={fcfMargin} setFcfMargin={setFcfMargin} terminalGrowth={terminalGrowth} setTerminalGrowth={setTerminalGrowth}
          netDebtNote={`Net debt: ${fmtM(val.netDebtUsdM)}. Positive = debt exceeds cash.`} />
      </div>
    </>
  );
}

function SotpDashboard({ val, bankFcfMargin, setBankFcfMargin, industrialFcfMargin, setIndustrialFcfMargin, terminalGrowth, setTerminalGrowth }: {
  val: SotpValuationResult;
  bankFcfMargin: number; setBankFcfMargin: (v: number) => void;
  industrialFcfMargin: number; setIndustrialFcfMargin: (v: number) => void;
  terminalGrowth: number; setTerminalGrowth: (v: number) => void;
}) {
  return (
    <>
      {/* SOTP equity bridge */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardCard label="Total Equity Value" value={fmtM(val.equityValueUsdM)} highlight />
        <DashboardCard label="Bank Equity (Ke)" value={fmtM(val.bankEquityValueUsdM)} highlightAmber />
        <DashboardCard label="Industrial Equity (WACC)" value={fmtM(val.industrialEquityValueUsdM)} />
        <DashboardCard label="Market Cap" value={val.marketCapUsdM ? fmtM(val.marketCapUsdM) : "N/A"} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-zinc-950 px-3 py-2 text-xs">
          <p className="text-zinc-500">Bank Ke</p>
          <p className="font-mono font-semibold text-amber-400">{fmtPct(val.bankKe)}</p>
        </div>
        <div className="rounded-lg bg-zinc-950 px-3 py-2 text-xs">
          <p className="text-zinc-500">Industrial WACC</p>
          <p className="font-mono font-semibold text-emerald-400">{fmtPct(val.industrialWacc)}</p>
        </div>
        <div className="rounded-lg bg-zinc-950 px-3 py-2 text-xs">
          <p className="text-zinc-500">Net Debt (Industrial)</p>
          <p className="font-mono font-semibold text-zinc-200">{fmtM(val.netDebtUsdM)}</p>
        </div>
      </div>

      {/* Dual stream forecast tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">Bank Segment FCFE Stream</h4>
          <ForecastTable rows={val.bankForecastRows} terminalValueUsdM={val.bankTerminalValueUsdM} terminalPvUsdM={val.bankTerminalPvUsdM} colorClass="text-amber-300" />
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">Industrial Segment FCFF Stream</h4>
          <ForecastTable rows={val.industrialForecastRows} terminalValueUsdM={val.industrialTerminalValueUsdM} terminalPvUsdM={val.industrialTerminalPvUsdM} colorClass="text-emerald-300" />
        </div>
      </div>

      {/* Sliders */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-amber-300">
            <SlidersHorizontal size={14} /> Bank Assumptions
          </h4>
          <AssumptionSlider label="Bank FCFE Margin" value={bankFcfMargin} min={0.05} max={0.35} step={0.005} onChange={setBankFcfMargin} />
          <p className="text-xs text-zinc-600">FCFE / NII (net income proxy). Banks typically 15–25%.</p>
        </div>
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-emerald-300">
            <SlidersHorizontal size={14} /> Industrial Assumptions
          </h4>
          <AssumptionSlider label="Industrial FCF Margin" value={industrialFcfMargin} min={0.05} max={0.50} step={0.005} onChange={setIndustrialFcfMargin} />
          <AssumptionSlider label="Terminal Growth (both)" value={terminalGrowth} min={0.01} max={0.04} step={0.001} onChange={setTerminalGrowth} />
        </div>
      </div>
    </>
  );
}

// =============================================================================
// Shared table / UI sub-components
// =============================================================================

function SegmentTable({ segments, weighted, onUpdate, onRemove }: {
  segments: WACCSegmentRow[];
  weighted: number;
  onUpdate: (id: string, field: keyof WACCSegmentRow, value: string | number) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-xs">
        <thead className="bg-zinc-800 text-zinc-400">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Segment Name</th>
            <th className="px-3 py-2 text-right font-medium">Unlevered Beta</th>
            <th className="px-3 py-2 text-right font-medium">Est. Value ($M)</th>
            <th className="px-3 py-2 w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {segments.map((seg) => (
            <tr key={seg.id} className="hover:bg-zinc-900/30">
              <td className="px-2 py-1">
                <input type="text" value={seg.name} onChange={(e) => onUpdate(seg.id, "name", e.target.value)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-blue-500" />
              </td>
              <td className="px-2 py-1">
                <input type="number" step="0.01" value={seg.unleveredBeta} onChange={(e) => onUpdate(seg.id, "unleveredBeta", Number(e.target.value))}
                  className="w-24 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-xs text-zinc-100 outline-none focus:border-blue-500" />
              </td>
              <td className="px-2 py-1">
                <input type="number" step="1" value={seg.estimatedValue} onChange={(e) => onUpdate(seg.id, "estimatedValue", Number(e.target.value))}
                  className="w-28 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-xs text-zinc-100 outline-none focus:border-blue-500" />
              </td>
              <td className="px-2 py-1 text-center">
                <button onClick={() => onRemove(seg.id)} className="text-zinc-600 hover:text-red-400"><Trash2 size={12} /></button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-zinc-900/60">
          <tr>
            <td className="px-3 py-2 text-xs font-semibold text-zinc-300">Weighted Average</td>
            <td className="px-3 py-2 text-right font-mono text-xs font-bold text-blue-400">{weighted.toFixed(3)}</td>
            <td className="px-3 py-2 text-right font-mono text-xs text-zinc-500">
              {segments.reduce((s, seg) => s + seg.estimatedValue, 0).toLocaleString()}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ForecastTable({ rows, terminalValueUsdM, terminalPvUsdM, colorClass = "text-zinc-100" }: {
  rows: { year: number; revenueUsdM: number; fcffUsdM: number; discountFactor: number; presentValueUsdM: number }[];
  terminalValueUsdM: number; terminalPvUsdM: number; colorClass?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-xs">
        <thead className="bg-zinc-800 text-zinc-400">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Year</th>
            <th className="px-3 py-2 text-right font-medium">Revenue</th>
            <th className="px-3 py-2 text-right font-medium">FCF</th>
            <th className="px-3 py-2 text-right font-medium">PV</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {rows.map((row) => (
            <tr key={row.year}>
              <td className="px-3 py-2 text-zinc-300">FY{row.year}</td>
              <td className="px-3 py-2 text-right font-mono text-zinc-300">{fmtM(row.revenueUsdM)}</td>
              <td className="px-3 py-2 text-right font-mono text-zinc-300">{fmtM(row.fcffUsdM)}</td>
              <td className={`px-3 py-2 text-right font-mono ${colorClass}`}>{fmtM(row.presentValueUsdM)}</td>
            </tr>
          ))}
          <tr className="bg-zinc-900/60">
            <td className="px-3 py-2 font-semibold text-zinc-200">Terminal</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right font-mono text-zinc-400">TV {fmtM(terminalValueUsdM)}</td>
            <td className={`px-3 py-2 text-right font-mono font-semibold ${colorClass}`}>{fmtM(terminalPvUsdM)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AssumptionsPanel({ fcfMargin, setFcfMargin, terminalGrowth, setTerminalGrowth, netDebtNote }: {
  fcfMargin: number; setFcfMargin: (v: number) => void;
  terminalGrowth: number; setTerminalGrowth: (v: number) => void;
  netDebtNote: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-blue-300">
        <SlidersHorizontal size={15} /> Assumptions
      </h4>
      <AssumptionSlider label="FCF Margin" value={fcfMargin} min={0.05} max={0.50} step={0.005} onChange={setFcfMargin} />
      <AssumptionSlider label="Terminal Growth" value={terminalGrowth} min={0.01} max={0.04} step={0.001} onChange={setTerminalGrowth} />
      <div className="rounded-lg bg-zinc-900 px-3 py-2 text-xs text-zinc-400">{netDebtNote}</div>
    </div>
  );
}

function DataCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-950 px-3 py-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-zinc-200">{value}</p>
    </div>
  );
}

function ConstantInput({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-zinc-500">{label}</label>
      <input type="number" step="0.01" value={Math.round(value * 100) / 100}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500" />
      <p className="mt-1 text-xs text-zinc-600">{hint}</p>
    </div>
  );
}

function CalcCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${highlight ? "bg-blue-950/30 border border-blue-700/30" : "bg-zinc-950"}`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-sm font-mono font-semibold ${highlight ? "text-blue-400" : "text-zinc-200"}`}>{value}</p>
    </div>
  );
}

function DashboardCard({ label, value, highlight, highlightAmber }: { label: string; value: string; highlight?: boolean; highlightAmber?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${
      highlight ? "border border-emerald-700/30 bg-emerald-950/30"
      : highlightAmber ? "border border-amber-700/30 bg-amber-950/30"
      : "bg-zinc-950"
    }`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-sm font-mono font-semibold ${
        highlight ? "text-emerald-300" : highlightAmber ? "text-amber-300" : "text-zinc-200"
      }`}>{value}</p>
    </div>
  );
}

function AssumptionSlider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-zinc-500">{label}</span>
        <span className="font-mono text-zinc-200">{fmtPct(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-blue-500" />
    </label>
  );
}
