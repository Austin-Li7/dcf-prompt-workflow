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
import { LineagePanel, LineageCard } from "@/components/ui/LineagePanel";
import type { SotpValuationResult } from "@/lib/dcf-valuation";
import {
  buildLiquidityAssessment,
  seedLiquidityInputsFromRow,
  calcLiquidityMetrics,
  runStressTest,
  buildEarlyWarnings,
  type LiquidityInputs,
  type LiquidityAssessment,
  type LiquidityRiskRating,
  type MetricResult,
  type StressTestResult,
} from "@/lib/liquidity-assessment";

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
  const [waccSaved, setWaccSaved] = useState(state.wacc.saved);
  const [terminalGrowth, setTerminalGrowth] = useState(state.wacc.terminalGrowth ?? 0.025);
  const [fcfMargin, setFcfMargin] = useState(state.wacc.fcfMargin ?? 0.25);
  const [fetchedAt, setFetchedAt] = useState<string | null>(state.wacc.fetchedAt ?? null);

  // ── Liquidity assessment (financial / hybrid modes) ─────────────────────────
  const latestBankRow = useMemo(() => {
    const rows = state.history.rows.filter((r) => r.workflow_mode === "bank" && r.isAnnualFiling);
    if (rows.length === 0) return null;
    return rows.reduce((best, r) => (r.fiscalYear > best.fiscalYear ? r : best), rows[0]);
  }, [state.history.rows]);

  const [liquidityInputs, setLiquidityInputs] = useState<LiquidityInputs>(() =>
    state.wacc.liquidityAssessment?.inputs ??
    (latestBankRow ? seedLiquidityInputsFromRow(latestBankRow) : {
      cash_and_hqla_usd_m: 0,
      total_loans_usd_m: 0,
      htm_bonds_usd_m: 0,
      unrealized_losses_htm_usd_m: 0,
      retail_insured_deposits_usd_m: 0,
      wholesale_uninsured_deposits_usd_m: 0,
      total_equity_usd_m: 0,
      flag_cds_spreads_spiking: false,
      flag_fhlb_borrowing_elevated: false,
      flag_credit_rating_downgrade: false,
    })
  );
  const [stressFlightPct, setStressFlightPct] = useState(0.30);

  const liquidityAssessment = useMemo(
    () => buildLiquidityAssessment(liquidityInputs),
    [liquidityInputs],
  );
  const liveStressResult = useMemo(
    () => runStressTest(liquidityInputs, stressFlightPct),
    [liquidityInputs, stressFlightPct],
  );

  const isFinancialMode = businessType === "financial" || businessType === "hybrid";
  const liquidityRiskSpread = isFinancialMode ? liquidityAssessment.keSpread : 0;

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
    if (businessType === "financial") return { calculation: fullBankKeCalculation({ equityBeta: singleBeta, constants, liquidityRiskSpread }), warnings: [] };
    return fullWACCCalculation({
      marketCap: fetchedData.marketCap, totalDebt: fetchedData.totalDebt,
      interestExpense: fetchedData.interestExpense, unleveredBeta: effectiveBeta, constants,
    });
  }, [fetchedData, businessType, singleBeta, effectiveBeta, constants]);
  const calculation: WACCCalculation | null = waccResult?.calculation ?? null;
  const waccWarnings: string[] = waccResult?.warnings ?? [];

  // Hybrid: bank Ke (includes liquidity spread for hybrid mode)
  const bankKeCalc: WACCCalculation | null = useMemo(() => {
    if (businessType !== "hybrid") return null;
    return fullBankKeCalculation({ equityBeta: hybridBankBeta, constants, liquidityRiskSpread });
  }, [businessType, hybridBankBeta, constants, liquidityRiskSpread]);

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
  // In hybrid mode bank interest costs are deposit interest (not corporate debt), so Yahoo Finance
  // returns $0 interestExpense for banks. Suppress the Kd plausibility warning — it's not actionable.
  const industrialWaccWarnings: string[] = (industrialWaccResult?.warnings ?? [])
    .filter((w) => businessType !== "hybrid" || !w.includes("cost of debt"));

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
        liquidityAssessment: isFinancialMode ? liquidityAssessment : null,
        liquidityRiskSpread: isFinancialMode ? liquidityRiskSpread : 0,
      },
    });
    setWaccSaved(true);
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

        {/* ── Lineage panel ────────────────────────────────────────────────── */}
        <Step7LineageNote
          approved={state.wacc.saved}
          ticker={state.profile.ticker || null}
          companyType={state.profile.step1StructuredResult?.company_type}
          businessType={businessType}
          fetchedData={fetchedData}
          calculation={calculation}
          terminalGrowth={terminalGrowth}
        />

        {/* ── Liquidity Assessment (financial / hybrid modes only) ─────────── */}
        {isFinancialMode && (
          <LiquidityAssessmentPanel
            inputs={liquidityInputs}
            onInputsChange={setLiquidityInputs}
            assessment={liquidityAssessment}
            stressFlightPct={stressFlightPct}
            onStressFlightPctChange={setStressFlightPct}
            liveStress={liveStressResult}
            wasSeeded={latestBankRow !== null}
          />
        )}

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
                        <th className="px-3 py-2 text-right font-medium" title="Used to weight betas across segments. Pre-filled with FY5 revenue as a size proxy — replace with segment equity estimates for accuracy.">Est. Value ($M) <Info size={11} className="inline mb-0.5 text-zinc-500" /></th>
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

        {/* ── Section E: Save / Preview ───────────────────────────────────── */}
        {hasCalculation && (
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={handleSave}
              className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors ${waccSaved ? "bg-emerald-600 hover:bg-emerald-500" : "bg-blue-600 hover:bg-blue-500"}`}>
              <Save size={16} /> {waccSaved ? "Saved ✓" : "Save to Master Framework"}
            </button>
            <button onClick={handleComplete}
              className="flex items-center gap-2 rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-5 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20">
              <BarChart3 size={16} /> {showValuationDashboard ? "Refresh Dashboard" : "Preview Valuation"}
            </button>
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

// =============================================================================
// Step 7 Lineage Panel
// =============================================================================
function Step7LineageNote({
  approved, ticker, companyType, businessType, fetchedData, calculation, terminalGrowth,
}: {
  approved: boolean;
  ticker: string | null;
  companyType?: string | null;
  businessType: BusinessType;
  fetchedData: WACCDataResponse | null;
  calculation: WACCCalculation | null;
  terminalGrowth: number;
}) {
  const pipeline =
    companyType === "financial_bank" || companyType === "financial_insurance" || companyType === "financial_other"
      ? "FCFE / Ke"
      : companyType === "hybrid"
      ? "Hybrid SOTP"
      : "FCFF / WACC";
  const waccVal = calculation?.wacc;
  const debtM = fetchedData ? fetchedData.totalDebt / 1e6 : null;
  const cashM = fetchedData && fetchedData.totalCash != null ? fetchedData.totalCash / 1e6 : null;
  const sharesM = fetchedData?.sharesOutstanding != null ? fetchedData.sharesOutstanding / 1e6 : null;

  return (
    <LineagePanel approved={approved} flowsTo="WACC / Ke flows to Step 8 discount rate">
      <LineageCard label="From Step 1" sublabel="Ticker + pipeline type → market data fetch" approved={approved}>
        {ticker ? (
          <>
            <span className="font-mono text-sm font-semibold text-zinc-100">{ticker}</span>
            <br />
            <span className="text-xs text-zinc-400">{pipeline}</span>
          </>
        ) : (
          <span className="text-xs text-amber-400">Ticker not set — enter above</span>
        )}
      </LineageCard>
      <LineageCard label="Discount Rate" sublabel={businessType === "financial" ? "Ke (bank mode)" : "WACC → Step 8 denominator"} approved={approved}>
        {waccVal != null ? (
          <>
            <span className="font-mono text-sm font-semibold text-zinc-100">{(waccVal * 100).toFixed(2)}%</span>
            <br />
            <span className="text-xs text-zinc-400">Terminal growth {(terminalGrowth * 100).toFixed(1)}%</span>
          </>
        ) : (
          <span className="text-xs text-zinc-500">Fetch market data to compute</span>
        )}
      </LineageCard>
      <LineageCard label="Equity Bridge" sublabel="Debt, cash, shares → Step 8 value bridge" approved={approved}>
        {debtM != null ? (
          <ul className="space-y-0.5">
            <li className="text-xs text-zinc-400">Debt <span className="font-mono text-zinc-200">${debtM.toFixed(0)}M</span></li>
            {cashM != null && <li className="text-xs text-zinc-400">Cash <span className="font-mono text-zinc-200">${cashM.toFixed(0)}M</span></li>}
            {sharesM != null && <li className="text-xs text-zinc-400">Shares <span className="font-mono text-zinc-200">{sharesM.toFixed(0)}M</span></li>}
          </ul>
        ) : (
          <span className="text-xs text-zinc-500">Market data not yet fetched</span>
        )}
      </LineageCard>
    </LineagePanel>
  );
}

// =============================================================================
// Liquidity Assessment Panel
// =============================================================================

const RAG_COLORS: Record<string, string> = {
  green:  "bg-emerald-500/15 text-emerald-300 border-emerald-600/30",
  yellow: "bg-amber-500/15 text-amber-300 border-amber-600/30",
  red:    "bg-red-500/15 text-red-300 border-red-600/30",
};

const RATING_COLORS: Record<LiquidityRiskRating, string> = {
  LOW:      "bg-emerald-500/15 text-emerald-300",
  MODERATE: "bg-amber-500/15 text-amber-300",
  HIGH:     "bg-red-500/15 text-red-300",
  CRITICAL: "bg-red-600/30 text-red-200 animate-pulse",
};

const SPREAD_LABELS: Record<LiquidityRiskRating, string> = {
  LOW:      "+0 bps",
  MODERATE: "+50 bps",
  HIGH:     "+100 bps",
  CRITICAL: "+200 bps",
};

function MetricChip({ metric }: { metric: MetricResult }) {
  const cls = RAG_COLORS[metric.status] ?? RAG_COLORS.yellow;
  const valStr = metric.value === null
    ? "N/A"
    : metric.label.includes("Ratio") && metric.value < 5
      ? `${(metric.value * 100).toFixed(1)}%`
      : metric.value >= 10
        ? metric.value.toFixed(1) + "×"
        : `${(metric.value * 100).toFixed(1)}%`;
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <p className="text-xs font-medium opacity-80">{metric.label}</p>
      <p className="mt-1 text-xl font-bold font-mono">{valStr}</p>
      <p className="mt-1 text-xs opacity-70">{metric.note}</p>
    </div>
  );
}

function LiquidityInputField({
  label, value, onChange, unit = "$M",
}: { label: string; value: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-400">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-xs text-zinc-500">{unit}</span>
        <input
          type="number" min={0} step={100}
          value={value === 0 ? "" : value}
          placeholder="0"
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-right text-sm font-mono text-zinc-200 focus:border-blue-500 focus:outline-none"
        />
      </div>
    </label>
  );
}

function StressBar({ label, current, max, color }: {
  label: string; current: number; max: number; color: "emerald" | "amber" | "red";
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const barColor = {
    emerald: "bg-emerald-500",
    amber:   "bg-amber-500",
    red:     "bg-red-500",
  }[color];
  const textColor = {
    emerald: "text-emerald-300",
    amber:   "text-amber-300",
    red:     "text-red-300",
  }[color];
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className={`font-mono font-semibold ${textColor}`}>
          ${current.toFixed(0)}M <span className="text-zinc-500">/ ${max.toFixed(0)}M</span>
        </span>
      </div>
      <div className="h-3 w-full rounded-full bg-zinc-800">
        <div
          className={`h-3 rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}

function LiquidityAssessmentPanel({
  inputs, onInputsChange, assessment, stressFlightPct, onStressFlightPctChange, liveStress, wasSeeded,
}: {
  inputs: LiquidityInputs;
  onInputsChange: (v: LiquidityInputs) => void;
  assessment: LiquidityAssessment;
  stressFlightPct: number;
  onStressFlightPctChange: (v: number) => void;
  liveStress: StressTestResult;
  wasSeeded?: boolean;
}) {
  const set = (field: keyof LiquidityInputs) => (v: number | boolean) =>
    onInputsChange({ ...inputs, [field]: v });

  const { metrics, rating, keSpread, earlyWarnings } = assessment;
  const ratingCls = RATING_COLORS[rating];
  const totalDeposits = metrics.totalDeposits;

  return (
    <section className="space-y-5 rounded-xl border border-blue-800/40 bg-blue-950/10 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-blue-300">
            <Shield size={16} />
            Liquidity Assessment
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Bank-run stress test · feeds Ke as a liquidity risk spread
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${ratingCls}`}>
            {rating}
          </span>
          <span className="rounded-full bg-blue-900/30 px-3 py-1 text-xs font-mono text-blue-200">
            Ke +{(keSpread * 100).toFixed(0)} bps
          </span>
        </div>
      </div>

      {/* Early-warning toggles */}
      <div className="rounded-lg border border-zinc-700/40 bg-zinc-900/40 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Early Warning Signals
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              { field: "flag_cds_spreads_spiking",      label: "CDS Spreads Spiking" },
              { field: "flag_fhlb_borrowing_elevated",  label: "FHLB Borrowing Elevated" },
              { field: "flag_credit_rating_downgrade",  label: "Credit Rating Downgrade" },
            ] as const
          ).map(({ field, label }) => (
            <label key={field} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={inputs[field] as boolean}
                onChange={(e) => set(field)(e.target.checked)}
                className="h-4 w-4 accent-amber-500"
              />
              <span className="text-xs text-zinc-300">{label}</span>
            </label>
          ))}
        </div>
        {earlyWarnings.length > 0 && (
          <ul className="mt-3 space-y-1">
            {earlyWarnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-amber-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Balance-sheet inputs */}
      <div className="rounded-lg border border-zinc-700/40 bg-zinc-900/40 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Balance-Sheet Inputs{wasSeeded
            ? <span className="ml-1 font-normal text-zinc-600">(USD Millions — pre-filled from Step 2)</span>
            : <span className="ml-1 font-normal text-amber-700/70">(USD Millions — enter manually; Step 2 bank data not found)</span>
          }
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <LiquidityInputField label="Cash & HQLA"            value={inputs.cash_and_hqla_usd_m}                  onChange={set("cash_and_hqla_usd_m")} />
          <LiquidityInputField label="Total Loans"            value={inputs.total_loans_usd_m}                     onChange={set("total_loans_usd_m")} />
          <LiquidityInputField label="HTM Bonds"              value={inputs.htm_bonds_usd_m}                       onChange={set("htm_bonds_usd_m")} />
          <LiquidityInputField label="Unrealized HTM Losses"  value={inputs.unrealized_losses_htm_usd_m}           onChange={set("unrealized_losses_htm_usd_m")} />
          <LiquidityInputField label="Retail Insured Deposits" value={inputs.retail_insured_deposits_usd_m}        onChange={set("retail_insured_deposits_usd_m")} />
          <LiquidityInputField label="Wholesale / Uninsured"  value={inputs.wholesale_uninsured_deposits_usd_m}    onChange={set("wholesale_uninsured_deposits_usd_m")} />
          <LiquidityInputField label="Total Common Equity"    value={inputs.total_equity_usd_m}                    onChange={set("total_equity_usd_m")} />
        </div>
      </div>

      {/* Baseline metrics */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Baseline Liquidity Metrics
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricChip metric={metrics.ldr} />
          <MetricChip metric={metrics.uninsuredConcentration} />
          <MetricChip metric={metrics.lcrProxy} />
        </div>
      </div>

      {/* Stress test */}
      <div className="rounded-lg border border-zinc-700/40 bg-zinc-900/40 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Bank-Run Stress Test
        </p>

        {/* Slider */}
        <label className="block">
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-zinc-400">Uninsured Deposit Flight Severity</span>
            <span className="font-mono font-semibold text-zinc-200">
              {(stressFlightPct * 100).toFixed(0)}% — ${liveStress.fleeingDeposits.toFixed(0)}M fleeing
            </span>
          </div>
          <input
            type="range" min={0} max={1} step={0.01} value={stressFlightPct}
            onChange={(e) => onStressFlightPctChange(Number(e.target.value))}
            className="w-full accent-red-500"
          />
          <div className="mt-0.5 flex justify-between text-xs text-zinc-600">
            <span>0% (no stress)</span><span>50%</span><span>100% (full run)</span>
          </div>
        </label>

        {/* Visual bars */}
        <div className="mt-4 space-y-3">
          <StressBar
            label="HQLA Buffer Remaining"
            current={liveStress.hqlaRemaining}
            max={inputs.cash_and_hqla_usd_m || 1}
            color={liveStress.hqlaRemaining > inputs.cash_and_hqla_usd_m * 0.3 ? "emerald" : "amber"}
          />
          <StressBar
            label="Equity Remaining"
            current={Math.max(0, liveStress.equityRemaining)}
            max={inputs.total_equity_usd_m || 1}
            color={liveStress.equityRemaining > 0 ? (liveStress.equityRemaining > inputs.total_equity_usd_m * 0.5 ? "emerald" : "amber") : "red"}
          />
        </div>

        {/* Arithmetic trace */}
        <div className="mt-4 space-y-1 rounded border border-zinc-700/30 bg-zinc-950/50 p-3 text-xs font-mono">
          <div className="text-zinc-500">Stress trace:</div>
          <div className="text-zinc-300">Fleeing deposits: <span className="text-white">${liveStress.fleeingDeposits.toFixed(0)}M</span></div>
          <div className="text-zinc-300">HQLA drained: <span className="text-white">${Math.min(inputs.cash_and_hqla_usd_m, liveStress.fleeingDeposits).toFixed(0)}M</span> → remaining: <span className="text-white">${liveStress.hqlaRemaining.toFixed(0)}M</span></div>
          {liveStress.shortfall > 0 && (
            <>
              <div className="text-amber-300">Shortfall after HQLA: <span className="text-white">${liveStress.shortfall.toFixed(0)}M</span> → forced HTM sales</div>
              <div className="text-amber-300">HTM bonds sold: <span className="text-white">${liveStress.htmSold.toFixed(0)}M</span></div>
              <div className="text-red-300">Realized losses: <span className="text-white">${liveStress.realizedLosses.toFixed(0)}M</span></div>
            </>
          )}
          <div className={liveStress.equityRemaining < 0 ? "text-red-300" : "text-zinc-300"}>
            Equity: <span className={liveStress.equityRemaining < 0 ? "text-red-200 font-bold" : "text-white"}>
              ${liveStress.equityRemaining.toFixed(0)}M
            </span>
          </div>
        </div>

        {/* Insolvency alert */}
        {liveStress.insolvent && (
          <div className="mt-3 rounded-lg border border-red-500 bg-red-950/40 p-3 text-center">
            <p className="text-sm font-bold uppercase tracking-widest text-red-300">
              ⚠ Insolvent / Regulatory Takeover Risk
            </p>
            <p className="mt-1 text-xs text-red-400">
              At {(stressFlightPct * 100).toFixed(0)}% flight, realized losses exceed total equity.
              Bank cannot absorb forced asset-sale losses.
            </p>
          </div>
        )}
      </div>

      {/* Ke spread explanation */}
      <div className="rounded-lg border border-blue-800/30 bg-blue-950/20 p-3">
        <p className="text-xs text-blue-200">
          <span className="font-semibold">Ke impact:</span>{" "}
          {rating === "LOW"
            ? "No spread applied — liquidity profile is healthy."
            : `A ${SPREAD_LABELS[rating]} liquidity risk premium is added to Ke above the base CAPM rate. This raises the discount rate and reduces the FCFE present value — reflecting the additional equity return required to compensate for funding fragility.`
          }
        </p>
        <p className="mt-1 text-xs font-mono text-blue-300">
          Ke = Rf + β × ERP{keSpread > 0 ? ` + ${(keSpread * 100).toFixed(0)}bps (liquidity)` : ""}
        </p>
      </div>
    </section>
  );
}
