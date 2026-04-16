"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import {
  Loader2, Download, Trash2, AlertTriangle, AlertCircle,
  CheckCircle2, ArrowRight, Save, BarChart3, RotateCcw, SlidersHorizontal,
} from "lucide-react";
import * as XLSX from "xlsx";
import StepShell from "./StepShell";
import { useSettings } from "@/context/SettingsContext";
import { useCFP } from "@/context/CFPContext";
import type {
  ProductForecast, ForecastQuarterPoint, SegmentForecastBundle,
  GenerateForecastResponse,
} from "@/types/cfp";

// =============================================================================
// Helpers
// =============================================================================
function dateSuffix() { const n = new Date(); return `${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}-${n.getFullYear()}`; }
function sName(c: string) { return (c || "company").replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase(); }

/** Deep-clone ProductForecast[] so mutations don't bleed between baseline/active */
function cloneProducts(p: ProductForecast[]): ProductForecast[] {
  return p.map(prod => ({
    ...prod,
    forecast: prod.forecast.map(q => ({ ...q })),
  }));
}

/**
 * Apply a sensitivity % to the AI baseline to produce user-active numbers.
 * For each quarter: adjust yoyGrowth by adding sensitivityPct, then recompute
 * absolute revenueM by chaining from Q1Y1's baseline value.
 */
function applySensitivity(
  baseline: ProductForecast[],
  sensitivityPct: number,
  overrides: Map<string, number>, // key = "productName|year|quarter" → override revenueM
): ProductForecast[] {
  return baseline.map(prod => {
    const adjusted: ForecastQuarterPoint[] = [];
    let prevRevenue = prod.forecast[0]?.revenueM ?? 0;

    for (let i = 0; i < prod.forecast.length; i++) {
      const base = prod.forecast[i];
      const key = `${prod.productName}|${base.year}|${base.quarter}`;
      const overrideVal = overrides.get(key);

      if (overrideVal !== undefined) {
        // Manual override takes precedence
        adjusted.push({ ...base, revenueM: overrideVal, yoyGrowth: base.yoyGrowth + sensitivityPct });
        prevRevenue = overrideVal;
      } else {
        const adjustedGrowth = base.yoyGrowth + sensitivityPct;
        let newRevenue: number;
        if (i === 0) {
          newRevenue = base.revenueM; // anchor Q1Y1 to baseline
        } else {
          // Apply adjusted QoQ growth from baseline ratio
          const baseRatio = base.revenueM / (prod.forecast[i - 1]?.revenueM || 1);
          const sensitivityMult = 1 + (sensitivityPct / 100);
          newRevenue = prevRevenue * baseRatio * sensitivityMult;
        }
        adjusted.push({ ...base, revenueM: Math.round(newRevenue * 10) / 10, yoyGrowth: Math.round(adjustedGrowth * 10) / 10 });
        prevRevenue = newRevenue;
      }
    }
    return { ...prod, forecast: adjusted };
  });
}

/** Check if a cell diverges from baseline */
function hasDiverged(active: number, baseline: number): boolean {
  return Math.abs(active - baseline) > 0.05;
}

// =============================================================================
// Component
// =============================================================================
export default function Step5Forecast() {
  const { state, dispatch } = useCFP();
  const hasArch = !!state.profile.architectureJson;
  const isAlreadySaved = state.forecast.approved && state.forecast.segments.length > 0;

  // Unique segments from architecture
  const segments = useMemo(() => {
    if (!state.profile.architectureJson) return [];
    return state.profile.architectureJson.architecture.map(s => s.segment);
  }, [state.profile.architectureJson]);

  // ---- Settings (centralized API key) ----
  const { settings, activeApiKey } = useSettings();

  // ---- Phase ----
  const [phase, setPhase] = useState<"setup" | "forecast" | "dashboard">(isAlreadySaved ? "dashboard" : "setup");
  const [segIdx, setSegIdx] = useState(0);

  // ---- Dual state architecture ----
  const [aiBaseline, setAiBaseline] = useState<ProductForecast[]>([]);
  const [userActive, setUserActive] = useState<ProductForecast[]>([]);
  const [sensitivity, setSensitivity] = useState(0);
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());

  // ---- Approved segments accumulator ----
  const [approvedSegments, setApprovedSegments] = useState<SegmentForecastBundle[]>(
    isAlreadySaved ? state.forecast.segments : [],
  );

  // ---- Loading / error ----
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentSegment = segments[segIdx] ?? "";

  // ================================================================
  // Generate forecast for current segment
  // ================================================================
  const handleGenerate = useCallback(async () => {
    setErrorMsg(null); setIsLoading(true);
    try {
      const res = await fetch("/api/generate-forecast", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step1Architecture: state.profile.architectureJson,
          step2History: state.history,
          step3Competition: state.competition,
          step4Complete: state.synergies,
          targetSegment: currentSegment,
          apiKey: activeApiKey,
          llmProvider: settings.llmProvider,
        }),
      });
      const d: GenerateForecastResponse = await res.json();
      if (!res.ok) { if (d.requiresApiKey) throw new Error("No API key configured. Open Settings (gear icon) to add your key."); throw new Error(d.error); }

      setAiBaseline(d.products);
      setUserActive(cloneProducts(d.products));
      setSensitivity(0);
      setOverrides(new Map());
      setPhase("forecast");
    } catch (e: unknown) { setErrorMsg(e instanceof Error ? e.message : "Failed."); }
    finally { setIsLoading(false); }
  }, [state.profile.architectureJson, state.history, state.competition, state.synergies, currentSegment, activeApiKey, settings.llmProvider]);

  // ================================================================
  // Sensitivity slider change
  // ================================================================
  const handleSensitivityChange = (val: number) => {
    setSensitivity(val);
    setUserActive(applySensitivity(aiBaseline, val, overrides));
  };

  // ================================================================
  // Manual cell override
  // ================================================================
  const handleCellEdit = (productName: string, year: number, quarter: string, value: number) => {
    const key = `${productName}|${year}|${quarter}`;
    const newOverrides = new Map(overrides);
    newOverrides.set(key, value);
    setOverrides(newOverrides);
    setUserActive(applySensitivity(aiBaseline, sensitivity, newOverrides));
  };

  // ================================================================
  // Reset to baseline
  // ================================================================
  const handleReset = () => {
    setSensitivity(0);
    setOverrides(new Map());
    setUserActive(cloneProducts(aiBaseline));
  };

  // ================================================================
  // Approve & advance
  // ================================================================
  const handleApprove = () => {
    const bundle: SegmentForecastBundle = { segment: currentSegment, products: cloneProducts(userActive) };
    const updated = [...approvedSegments, bundle];
    setApprovedSegments(updated);

    if (segIdx < segments.length - 1) {
      setSegIdx(segIdx + 1);
      setAiBaseline([]);
      setUserActive([]);
      setSensitivity(0);
      setOverrides(new Map());
      setPhase("setup");
    } else {
      setPhase("dashboard");
    }
  };

  // ================================================================
  // Save & Export
  // ================================================================
  const handleSave = () => {
    dispatch({ type: "SET_FORECAST", payload: { segments: approvedSegments, approved: true } });
  };

  const dlXlsx = () => {
    const wb = XLSX.utils.book_new();
    for (const seg of approvedSegments) {
      const rows: Record<string, unknown>[] = [];
      for (const prod of seg.products) {
        for (const q of prod.forecast) {
          rows.push({
            Product: prod.productName,
            Category: prod.categoryName,
            Year: q.year,
            Quarter: q.quarter,
            "Revenue ($M)": q.revenueM,
            "YoY Growth (%)": q.yoyGrowth,
            "Strategic Driver": q.strategicDriver,
          });
        }
      }
      const name = seg.segment.slice(0, 31); // Excel sheet name limit
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    }
    XLSX.writeFile(wb, `${sName(state.profile.companyName)}-step5-forecast-${dateSuffix()}.xlsx`);
  };

  const startOver = () => {
    dispatch({ type: "CLEAR_FORECAST" });
    setApprovedSegments([]); setSegIdx(0);
    setAiBaseline([]); setUserActive([]);
    setSensitivity(0); setOverrides(new Map());
    setPhase("setup"); setErrorMsg(null);
  };

  // ==========================================================================
  return (
    <StepShell stepNumber={5} title="20-Quarter Forecast" subtitle="AI-driven revenue projections per segment with sensitivity controls and manual overrides.">
      {!hasArch && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/30 p-4 text-sm text-amber-300">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div><p className="font-medium">Step 1 architecture not found</p><p className="mt-1 text-xs text-amber-400/70">Complete Step 1 first.</p></div>
        </div>
      )}

      {hasArch && (
        <div className="space-y-6">

          {/* Segment progress */}
          {phase !== "dashboard" && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono">{segIdx + 1}/{segments.length}</span>
              <span>segments</span>
              <div className="ml-auto flex gap-1">
                {segments.map((_, i) => (
                  <div key={i} className={`h-2 w-6 rounded-full ${i < segIdx ? "bg-emerald-500" : i === segIdx ? "bg-blue-500" : "bg-zinc-700"}`} />
                ))}
              </div>
            </div>
          )}

          {/* ===== SETUP / GENERATE ===== */}
          {phase === "setup" && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <BarChart3 size={40} className="text-blue-400" />
              <h3 className="text-lg font-semibold text-zinc-200">Forecasting: {currentSegment}</h3>
              <p className="text-sm text-zinc-400">Generate the AI baseline, then adjust with sensitivity controls.</p>
              {errorMsg && <div className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-950/30 p-3 text-sm text-red-300"><AlertCircle size={16} className="mt-0.5 shrink-0" /> {errorMsg}</div>}
              <button onClick={handleGenerate} disabled={isLoading}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500">
                {isLoading ? <><Loader2 size={18} className="animate-spin" /> Generating...</> : "Generate AI Baseline Forecast"}
              </button>
            </div>
          )}

          {/* ===== FORECAST GRID ===== */}
          {phase === "forecast" && userActive.length > 0 && (
            <div className="space-y-5">
              <h3 className="text-lg font-semibold text-zinc-200">Segment: {currentSegment}</h3>

              {/* Sensitivity slider */}
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal size={16} className="text-blue-400" />
                  <span className="text-sm font-medium text-zinc-300">Scenario Sensitivity</span>
                  <span className={`ml-auto text-sm font-bold tabular-nums ${sensitivity === 0 ? "text-zinc-400" : sensitivity > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {sensitivity > 0 ? "+" : ""}{sensitivity}%
                  </span>
                </div>
                <input type="range" min={-10} max={10} step={0.5} value={sensitivity}
                  onChange={(e) => handleSensitivityChange(Number(e.target.value))}
                  className="w-full accent-blue-500" />
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>-10% Bear</span><span>0% Base</span><span>+10% Bull</span>
                </div>
              </div>

              {/* Reset button */}
              <button onClick={handleReset} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300">
                <RotateCcw size={12} /> Reset to AI Baseline
              </button>

              {/* Product grids */}
              {userActive.map((prod, pIdx) => (
                <div key={prod.productName} className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
                  <div className="bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-200">
                    {prod.productName} <span className="text-zinc-500 font-normal">({prod.categoryName})</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-900/50 text-zinc-500">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium">Qtr</th>
                          <th className="px-2 py-1.5 text-right font-medium">Revenue ($M)</th>
                          <th className="px-2 py-1.5 text-right font-medium">YoY %</th>
                          <th className="px-2 py-1.5 text-left font-medium">Driver</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50">
                        {prod.forecast.map((q, qIdx) => {
                          const baseQ = aiBaseline[pIdx]?.forecast[qIdx];
                          const diverged = baseQ ? hasDiverged(q.revenueM, baseQ.revenueM) : false;
                          return (
                            <tr key={`${q.year}-${q.quarter}`} className={diverged ? "bg-blue-950/20" : "hover:bg-zinc-900/30"}>
                              <td className="px-2 py-1 text-zinc-400">Y{q.year} {q.quarter}</td>
                              <td className="px-1 py-1">
                                <input type="number" step="any"
                                  value={q.revenueM}
                                  onChange={(e) => handleCellEdit(prod.productName, q.year, q.quarter, Number(e.target.value))}
                                  className={`w-20 rounded border px-1.5 py-0.5 text-right text-xs outline-none focus:border-blue-500 ${diverged ? "border-blue-600/50 bg-blue-950/30 text-blue-300" : "border-zinc-700 bg-zinc-800 text-zinc-100"}`} />
                              </td>
                              <td className={`px-2 py-1 text-right tabular-nums ${q.yoyGrowth >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {q.yoyGrowth > 0 ? "+" : ""}{q.yoyGrowth.toFixed(1)}%
                              </td>
                              <td className="px-2 py-1 text-zinc-500 max-w-[180px] truncate" title={q.strategicDriver}>{q.strategicDriver}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {errorMsg && <div className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-950/30 p-3 text-sm text-red-300"><AlertCircle size={16} className="mt-0.5 shrink-0" /> {errorMsg}</div>}

              <button onClick={handleApprove}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-500">
                <CheckCircle2 size={16} />
                Approve {currentSegment} Forecast {segIdx < segments.length - 1 ? "& Next" : "& Finalize"}
                {segIdx < segments.length - 1 && <ArrowRight size={14} />}
              </button>
            </div>
          )}

          {/* ===== DASHBOARD ===== */}
          {phase === "dashboard" && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 size={20} />
                <span className="text-sm font-medium">Master Forecast Complete — {approvedSegments.length} segment(s)</span>
              </div>

              {/* Summary stats */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-center">
                  <p className="text-xs text-zinc-500">Segments</p>
                  <p className="text-2xl font-bold text-blue-400">{approvedSegments.length}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-center">
                  <p className="text-xs text-zinc-500">Products</p>
                  <p className="text-2xl font-bold text-purple-400">{approvedSegments.reduce((s, seg) => s + seg.products.length, 0)}</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-center">
                  <p className="text-xs text-zinc-500">Quarter Points</p>
                  <p className="text-2xl font-bold text-emerald-400">{approvedSegments.reduce((s, seg) => s + seg.products.reduce((ss, p) => ss + p.forecast.length, 0), 0)}</p>
                </div>
              </div>

              {/* Segment summaries */}
              {approvedSegments.map((seg, i) => (
                <details key={i} className="group rounded-lg border border-zinc-800 bg-zinc-950">
                  <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-900">
                    <BarChart3 size={14} className="text-blue-400" />
                    <span className="flex-1">{seg.segment}</span>
                    <span className="text-xs text-zinc-500">{seg.products.length} product(s)</span>
                  </summary>
                  <div className="border-t border-zinc-800 px-4 py-3 space-y-2">
                    {seg.products.map((prod, j) => {
                      const last = prod.forecast[prod.forecast.length - 1];
                      const first = prod.forecast[0];
                      return (
                        <div key={j} className="flex items-center justify-between text-xs">
                          <span className="text-zinc-300">{prod.productName}</span>
                          <span className="text-zinc-500">
                            ${first?.revenueM?.toFixed(0)}M → ${last?.revenueM?.toFixed(0)}M
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={handleSave} className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500">
                  <Save size={16} /> Save to Master Framework
                </button>
                <button onClick={dlXlsx} className="flex items-center gap-2 rounded-lg border border-blue-600/50 bg-blue-600/10 px-5 py-2.5 text-sm font-medium text-blue-400 hover:bg-blue-600/20">
                  <Download size={16} /> Download Master Financial Model (Excel)
                </button>
                <button onClick={startOver} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm text-zinc-400 hover:border-red-700/50 hover:text-red-400">
                  <Trash2 size={16} /> Start Over
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </StepShell>
  );
}
