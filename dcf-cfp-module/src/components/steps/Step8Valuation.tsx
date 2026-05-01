"use client";

import { useMemo, useState, useCallback } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Shield,
  SlidersHorizontal,
  ArrowDown,
  Download,
  X,
  Loader2,
  FolderOpen,
} from "lucide-react";
import StepShell from "./StepShell";
import { useCFP } from "@/context/CFPContext";
import { buildDcfValuation } from "@/lib/dcf-valuation";
import {
  buildStep5AssumptionRows,
  buildStep5ReviewWarningRows,
  getStep5StructuredResults,
} from "@/lib/aggregate-forecast";
import {
  saveCompanyAnalysis,
  downloadSave,
} from "@/lib/company-saves";
import type { CompanySave, ValuationSnapshot } from "@/types/cfp";

// =============================================================================
// Formatters
// =============================================================================

function fmtM(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
}

function fmtMSigned(value: number): string {
  const abs  = Math.abs(value);
  const sign = value >= 0 ? "+" : "−";
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtUpside(value: number | null): string {
  if (value === null) return "N/A";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function fmtPrice(value: number | null): string {
  if (value === null) return "N/A";
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtShares(value: number | null): string {
  if (value === null) return "N/A";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  });
}

// =============================================================================
// Step 8 — DCF Valuation Dashboard
// =============================================================================

export default function Step8Valuation() {
  const { state } = useCFP();

  // ── User-adjustable assumptions ──────────────────────────────────────────────
  const [fcfMargin,             setFcfMargin]             = useState(0.25);
  const [terminalGrowth,        setTerminalGrowth]        = useState(0.025);
  const [preferredStockUsdM,    setPreferredStockUsdM]    = useState(0);
  const [minorityInterestUsdM,  setMinorityInterestUsdM]  = useState(0);

  // ── Completion modal ─────────────────────────────────────────────────────────
  const [isSaving,         setIsSaving]         = useState(false);
  const [savedRecord,      setSavedRecord]      = useState<CompanySave | null>(null);
  const [saveError,        setSaveError]        = useState<string | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);

  const valuation = useMemo(
    () =>
      buildDcfValuation({
        forecast: state.forecast,
        wacc:     state.wacc,
        fcfMargin,
        terminalGrowth,
        preferredStockUsdM,
        minorityInterestUsdM,
      }),
    [fcfMargin, terminalGrowth, preferredStockUsdM, minorityInterestUsdM,
     state.forecast, state.wacc],
  );

  const step5Artifacts  = useMemo(() => getStep5StructuredResults(state.forecast),  [state.forecast]);
  const assumptionRows  = useMemo(() => buildStep5AssumptionRows(state.forecast),    [state.forecast]);
  const reviewWarnings  = useMemo(() => buildStep5ReviewWarningRows(state.forecast), [state.forecast]);

  // ── "Valuation Complete" handler ─────────────────────────────────────────────
  const handleComplete = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    setSavedRecord(null);
    setShowCompleteModal(true);

    const snapshot: ValuationSnapshot = {
      enterpriseValueUsdM:     valuation.enterpriseValueUsdM,
      sumPvFcffUsdM:           valuation.sumPvFcffUsdM,
      terminalPresentValueUsdM: valuation.terminalPresentValueUsdM,
      totalDebtUsdM:           valuation.totalDebtUsdM,
      preferredStockUsdM:      valuation.preferredStockUsdM,
      minorityInterestUsdM:    valuation.minorityInterestUsdM,
      totalCashUsdM:           valuation.totalCashUsdM,
      netDebtUsdM:             valuation.netDebtUsdM,
      equityValueUsdM:         valuation.equityValueUsdM,
      sharesOutstandingM:      valuation.sharesOutstandingM,
      marketCapUsdM:           valuation.marketCapUsdM,
      currentPrice:            valuation.currentPrice,
      intrinsicValuePerShare:  valuation.intrinsicValuePerShare,
      impliedUpsidePct:        valuation.impliedUpsidePct,
      fcfMargin,
      terminalGrowth,
      wacc:                    valuation.wacc,
      decisionAction:          valuation.decision.action,
      decisionLabel:           valuation.decision.label,
      decisionSummary:         valuation.decision.summary,
    };

    try {
      const record = await saveCompanyAnalysis(state, snapshot);
      setSavedRecord(record);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setIsSaving(false);
    }
  }, [valuation, fcfMargin, terminalGrowth, state]);

  return (
    <StepShell
      stepNumber={8}
      title="DCF Valuation Dashboard"
      subtitle="Normalize the forecast package, bridge free cash flow to enterprise value, and expose the audit trail."
      completeLabel="Valuation Complete"
      onComplete={handleComplete}
    >
      <div className="space-y-6">

        {/* ── Completion Modal ─────────────────────────────────────────────── */}
        {showCompleteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="relative mx-4 w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
              <button
                onClick={() => setShowCompleteModal(false)}
                className="absolute right-4 top-4 rounded-lg p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X size={18} />
              </button>

              {isSaving ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <Loader2 size={32} className="animate-spin text-blue-400" />
                  <p className="text-sm text-zinc-400">Saving analysis…</p>
                </div>
              ) : saveError ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <AlertTriangle size={24} className="text-amber-400" />
                    <div>
                      <p className="font-semibold text-zinc-100">Save failed</p>
                      <p className="text-xs text-zinc-500">{saveError}</p>
                    </div>
                  </div>
                  <p className="text-sm text-zinc-400">
                    Browser storage may be unavailable. You can still download a JSON backup.
                  </p>
                  {savedRecord && (
                    <button
                      onClick={() => downloadSave(savedRecord)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20"
                    >
                      <Download size={15} /> Download JSON backup
                    </button>
                  )}
                </div>
              ) : savedRecord ? (
                <div className="space-y-4">
                  {/* Success header */}
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600/20">
                      <FolderOpen size={20} className="text-emerald-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-zinc-100">Analysis saved</p>
                      <p className="text-xs text-zinc-500">
                        {savedRecord.companyName} · Version {savedRecord.version} · {fmtDate(savedRecord.savedAt)}
                      </p>
                    </div>
                  </div>

                  {/* Snapshot summary */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-1 text-xs font-mono">
                    <div className="flex justify-between text-zinc-400">
                      <span>Enterprise Value</span>
                      <span className="text-zinc-200">{fmtM(savedRecord.snapshot.enterpriseValueUsdM)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-400">
                      <span>Equity Value</span>
                      <span className="text-zinc-200">{fmtM(savedRecord.snapshot.equityValueUsdM)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-400">
                      <span>Intrinsic / Share</span>
                      <span className="text-emerald-300 font-semibold">{fmtPrice(savedRecord.snapshot.intrinsicValuePerShare)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-400">
                      <span>Signal</span>
                      <span className={`font-semibold ${
                        savedRecord.snapshot.decisionAction === "BUY"   ? "text-emerald-400" :
                        savedRecord.snapshot.decisionAction === "AVOID" ? "text-red-400" : "text-amber-400"
                      }`}>{savedRecord.snapshot.decisionLabel}</span>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-500">
                    Saved to browser storage. Load it any time via{" "}
                    <span className="text-zinc-300">Settings → Company Analyses</span>.
                    Versions are never deleted unless you remove them manually.
                  </p>

                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => downloadSave(savedRecord)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-600/20"
                    >
                      <Download size={15} /> Download JSON backup
                    </button>
                    <button
                      onClick={() => setShowCompleteModal(false)}
                      className="w-full rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ── Business Decision Banner ────────────────────────────────────── */}
        <section className={`rounded-xl border p-5 ${
          valuation.decision.action === "BUY"
            ? "border-emerald-700/40 bg-emerald-950/15"
            : valuation.decision.action === "AVOID"
              ? "border-red-700/40 bg-red-950/15"
              : "border-amber-700/40 bg-amber-950/15"
        }`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Business Decision</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-2xl font-semibold text-zinc-100">{valuation.decision.label}</h3>
            <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold text-zinc-300">
              {fmtPrice(valuation.intrinsicValuePerShare)} vs {fmtPrice(valuation.currentPrice)}
            </span>
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-300">{valuation.decision.summary}</p>
        </section>

        {/* ── Valuation Output ──────────────────────────────────────────────── */}
        <section className="rounded-xl border border-emerald-700/40 bg-emerald-950/10 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-emerald-300">
                <Shield size={16} /> Valuation Output
              </h3>
              <p className="mt-1 text-sm text-zinc-400">
                FCFF discounted at WACC → Enterprise Value. Equity bridge deducts debt obligations and adds cash.
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
              valuation.impliedUpsidePct !== null && valuation.impliedUpsidePct >= 0
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
            }`}>
              vs Market Cap {fmtUpside(valuation.impliedUpsidePct)}
            </span>
          </div>

          {!valuation.hasInputs ? (
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{valuation.warnings.join(" ")}</span>
            </div>
          ) : (
            <div className="mt-5 space-y-5">

              {/* Key metric cards */}
              <div className="grid gap-3 sm:grid-cols-4">
                <MetricCard label="Intrinsic / Share" value={fmtPrice(valuation.intrinsicValuePerShare)} highlight />
                <MetricCard label="Current Price"     value={fmtPrice(valuation.currentPrice)} />
                <MetricCard label="Equity Value"      value={fmtM(valuation.equityValueUsdM)} />
                <MetricCard label="Enterprise Value"  value={fmtM(valuation.enterpriseValueUsdM)} />
              </div>

              {/* FCFF projection table + key assumptions */}
              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-800 text-zinc-400">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Year</th>
                        <th className="px-3 py-2 text-right font-medium">Revenue</th>
                        <th className="px-3 py-2 text-right font-medium">FCFF</th>
                        <th className="px-3 py-2 text-right font-medium">Discount</th>
                        <th className="px-3 py-2 text-right font-medium">PV(FCFF)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {valuation.forecastRows.map((row) => (
                        <tr key={row.year}>
                          <td className="px-3 py-2 text-zinc-300">FY{row.year}</td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-300">{fmtM(row.revenueUsdM)}</td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-300">{fmtM(row.fcffUsdM)}</td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-400">{row.discountFactor.toFixed(3)}</td>
                          <td className="px-3 py-2 text-right font-mono text-zinc-100">{fmtM(row.presentValueUsdM)}</td>
                        </tr>
                      ))}
                      <tr className="bg-zinc-900/60 text-xs text-zinc-400">
                        <td className="px-3 py-1.5 italic">Σ PV(FCFF)</td>
                        <td /><td /><td />
                        <td className="px-3 py-1.5 text-right font-mono">{fmtM(valuation.sumPvFcffUsdM)}</td>
                      </tr>
                      <tr className="bg-zinc-900/60">
                        <td className="px-3 py-2 font-semibold text-zinc-200">Terminal PV</td>
                        <td /><td />
                        <td className="px-3 py-2 text-right font-mono text-zinc-400">
                          TV {fmtM(valuation.terminalValueUsdM)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-zinc-100">
                          {fmtM(valuation.terminalPresentValueUsdM)}
                        </td>
                      </tr>
                      <tr className="border-t-2 border-zinc-600 bg-zinc-800/50">
                        <td colSpan={4} className="px-3 py-2 text-xs font-semibold text-emerald-300">
                          Enterprise Value (Σ PV + Terminal PV)
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-emerald-300">
                          {fmtM(valuation.enterpriseValueUsdM)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-blue-300">
                    <SlidersHorizontal size={15} /> Key Assumptions
                  </h4>
                  <AssumptionSlider label="FCF Margin"     value={fcfMargin}      min={0.05} max={0.45} step={0.005} onChange={setFcfMargin} />
                  <AssumptionSlider label="Terminal Growth" value={terminalGrowth} min={0.01} max={0.04} step={0.001} onChange={setTerminalGrowth} />
                  <div className="rounded-lg bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
                    <span className="text-zinc-500">WACC: </span>
                    {valuation.wacc ? fmtPct(valuation.wacc) : "—"}
                    {"  ·  "}
                    <span className="text-zinc-500">Scale: </span>
                    {valuation.revenueScaleFactor}×
                  </div>
                </div>
              </div>

              {/* Equity Bridge */}
              <div className="rounded-xl border border-blue-800/40 bg-blue-950/10 p-5">
                <h4 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-blue-300">
                  <ArrowDown size={15} /> Equity Bridge
                </h4>
                <p className="mt-1 text-xs text-zinc-500">
                  Enterprise Value → Equity Value via debt obligations and cash.
                  Preferred stock and minority interest default to zero; enter actuals if available.
                </p>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-zinc-800/50">
                      <BridgeRow label="Enterprise Value"      sublabel="Σ PV(FCFF) + PV(Terminal Value)"          value={valuation.enterpriseValueUsdM}    kind="header" />
                      <BridgeRow label="− Total Debt"          sublabel="From Step 7 market data"                  value={-valuation.totalDebtUsdM}         kind="deduct" />
                      <BridgeRow label="− Preferred Stock"     sublabel="User input (USD millions)"                value={-valuation.preferredStockUsdM}    kind="deduct"
                        editInput={<BridgeInput value={preferredStockUsdM}   onChange={setPreferredStockUsdM}   />}
                      />
                      <BridgeRow label="− Minority Interest"   sublabel="User input (USD millions)"                value={-valuation.minorityInterestUsdM}  kind="deduct"
                        editInput={<BridgeInput value={minorityInterestUsdM} onChange={setMinorityInterestUsdM} />}
                      />
                      <BridgeRow label="+ Cash & Equivalents"  sublabel="From Step 7 market data"                  value={valuation.totalCashUsdM}          kind="add" />
                      <tr className="bg-zinc-800/50">
                        <td colSpan={2} className="px-3 py-1 text-xs italic text-zinc-500">
                          Net adjustment = Total Debt + Preferred + Minority Interest − Cash
                        </td>
                        <td className="px-3 py-1 text-right font-mono text-xs text-zinc-500">
                          {valuation.netDebtUsdM >= 0
                            ? `−${fmtM(valuation.netDebtUsdM)}`
                            : `+${fmtM(Math.abs(valuation.netDebtUsdM))}`}
                        </td>
                        <td />
                      </tr>
                      <BridgeRow label="= Equity Value"              sublabel="Value attributable to common shareholders" value={valuation.equityValueUsdM}        kind="result" />
                      <tr className="bg-zinc-900/40">
                        <td className="px-3 py-2.5 text-xs text-zinc-500">÷ Shares Outstanding</td>
                        <td className="px-3 py-2.5 text-xs text-zinc-500">{fmtShares(valuation.sharesOutstandingM)} diluted shares</td>
                        <td colSpan={2} />
                      </tr>
                      <BridgeRow label="= Intrinsic Value / Share" sublabel="vs. current market price" value={null} kind="result"
                        valueOverride={
                          <span className="font-mono font-bold text-emerald-300">
                            {fmtPrice(valuation.intrinsicValuePerShare)}
                            {valuation.currentPrice && (
                              <span className="ml-2 text-xs font-normal text-zinc-500">
                                vs {fmtPrice(valuation.currentPrice)}
                              </span>
                            )}
                          </span>
                        }
                      />
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}
        </section>

        {/* ── Bottom info panels ───────────────────────────────────────────── */}
        <section className="grid gap-4 lg:grid-cols-3">
          <InfoPanel title="Market Sanity Check" icon={<BarChart3 size={15} />}>
            <p>
              Analyst consensus target prices serve as an external cross-check only.
              They are not an input to this model. Large divergences between model
              output and analyst targets should prompt assumption review.
            </p>
          </InfoPanel>

          <InfoPanel title="Top Model Drivers" icon={<CheckCircle2 size={15} />}>
            {assumptionRows.length > 0 ? (
              <ul className="space-y-1.5">
                {assumptionRows.slice(0, 5).map((row) => (
                  <li key={`${row.segment}-${row.assumption_id}`}>
                    <span className="font-mono text-blue-300">{row.assumption_id}</span>{" "}
                    <span className="text-zinc-500">{row.driver_quality}</span> {row.statement}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No Step 5 assumption registry is available.</p>
            )}
          </InfoPanel>

          <InfoPanel title="Audit Flags" icon={<AlertTriangle size={15} />}>
            {reviewWarnings.length > 0 || valuation.warnings.length > 0 ? (
              <ul className="space-y-1.5">
                {valuation.warnings.map((w, i) => (
                  <li key={i}><span className="font-mono text-amber-300">VALUATION</span> {w}</li>
                ))}
                {reviewWarnings.slice(0, 5).map((row, index) => (
                  <li key={`${row.audit_flag}-${index}`}>
                    <span className="font-mono text-amber-300">{row.audit_flag}</span> {row.warning}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No valuation or Step 5 review warnings.</p>
            )}
          </InfoPanel>
        </section>

        {step5Artifacts.length === 0 && (
          <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-200">
            Step 5 structured machine artifact is missing; rerun and approve Step 5 before relying on this output.
          </div>
        )}
      </div>
    </StepShell>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function MetricCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg px-3 py-2 ${highlight ? "border border-emerald-700/30 bg-emerald-950/30" : "bg-zinc-950"}`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-sm font-mono font-semibold ${highlight ? "text-emerald-300" : "text-zinc-200"}`}>
        {value}
      </p>
    </div>
  );
}

function AssumptionSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-zinc-500">{label}</span>
        <span className="font-mono text-zinc-200">{fmtPct(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
    </label>
  );
}

type BridgeRowKind = "header" | "deduct" | "add" | "result";

function BridgeRow({
  label,
  sublabel,
  value,
  kind,
  editInput,
  valueOverride,
}: {
  label: string;
  sublabel: string;
  value: number | null;
  kind: BridgeRowKind;
  editInput?: ReactNode;
  valueOverride?: ReactNode;
}) {
  const isResult = kind === "result";
  const isHeader = kind === "header";
  const valueColor =
    kind === "deduct" ? "text-red-400" :
    kind === "add"    ? "text-emerald-400" :
    kind === "result" ? "text-blue-300" :
    "text-zinc-200";

  return (
    <tr className={isResult ? "border-t-2 border-blue-800/50 bg-blue-950/20" : isHeader ? "bg-zinc-900/40" : ""}>
      <td className={`px-3 py-2.5 text-sm ${isResult || isHeader ? "font-semibold text-zinc-100" : "text-zinc-300"}`}>
        {label}
      </td>
      <td className="px-3 py-2.5 text-xs text-zinc-500">{sublabel}</td>
      <td className={`px-3 py-2.5 text-right font-mono text-sm font-semibold ${valueColor}`}>
        {valueOverride ?? (value !== null ? fmtMSigned(value) : "—")}
      </td>
      <td className="w-36 px-3 py-2.5">{editInput}</td>
    </tr>
  );
}

function BridgeInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      step={1}
      value={value || ""}
      placeholder="0"
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-right font-mono text-xs text-zinc-200 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
    />
  );
}

function InfoPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-300">
      <h4 className="mb-2 flex items-center gap-2 font-semibold uppercase tracking-wider text-zinc-400">
        {icon} {title}
      </h4>
      {children}
    </div>
  );
}
