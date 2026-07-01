"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Database,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import StepShell from "./StepShell";
import { useCFP } from "@/context/CFPContext";
import { getAllSaves } from "@/lib/company-saves";
import type { CompanySave } from "@/types/cfp";
import {
  WORKFLOW_STEPS,
  analyzeManualEvent,
  buildRoutingSummary,
  buildStepImpacts,
  completedThroughStep,
  filterEventsAfterSavedAt,
  findLatestMatchingSave,
  type Certainty,
  type ImpactHorizon,
  type ManualEventInput,
  type ManualEventTypeSelection,
  type Materiality,
  type Quantifiability,
  type RefreshEvent,
  type RefreshEventType,
} from "@/lib/refresh-gate";
import {
  buildEventImpactAdjustments,
  clearEventImpactAdjustments,
  saveEventImpactAdjustments,
} from "@/lib/event-impact-adjustments";

const EVENT_TYPES: RefreshEventType[] = [
  "new 10-K",
  "new 10-Q",
  "earnings/call",
  "M&A/divestiture",
  "new product/technology",
  "competitive shift",
  "regulation/litigation",
  "management change",
  "market data change",
  "macro change",
];
const MANUAL_EVENT_TYPE_OPTIONS: ManualEventTypeSelection[] = ["auto", ...EVENT_TYPES];

const HORIZONS: ImpactHorizon[] = ["next quarter", "1-2 years", "long-term", "unknown"];
const MATERIALITIES: Materiality[] = ["low", "medium", "high", "unknown"];
const CERTAINTIES: Certainty[] = ["official", "reported", "rumor", "unconfirmed", "satirical", "fictional", "unknown"];
const QUANTIFIABILITIES: Quantifiability[] = ["known", "estimable", "unknown"];
const MARKET_DATA_MIN_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
const MARKET_PRICE_MOVE_THRESHOLD = 0.10;
const MARKET_RISK_FREE_MOVE_THRESHOLD = 0.005;

interface WaccDataPreview {
  currentPrice?: number;
  riskFreeRate?: number;
  marketCap?: number;
  error?: string;
}

const emptyManualEvent: ManualEventInput = {
  title: "",
  detail: "",
  eventType: "auto",
  impactHorizon: "unknown",
  materiality: "unknown",
  certainty: "unknown",
  quantifiability: "unknown",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stepLabel(step: number): string {
  return `Step ${step}: ${WORKFLOW_STEPS[step - 1]}`;
}

function scoreTone(score: number): string {
  if (score >= 75) return "text-emerald-300";
  if (score >= 45) return "text-amber-300";
  return "text-red-300";
}

function verificationLabel(score: number): string {
  if (score >= 85) return "High verification";
  if (score >= 55) return "Reported / medium";
  if (score >= 30) return "Unverified";
  return "Likely fictional / satirical";
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-blue-500"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option === "auto" ? "Auto infer from text" : option}</option>
        ))}
      </select>
    </label>
  );
}

function EventCard({ event, onReview }: { event: RefreshEvent; onReview: (event: RefreshEvent) => void }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-100">{event.title}</p>
          <p className="mt-1 text-xs text-zinc-500">{event.source} · {fmtDate(event.eventDate)}</p>
        </div>
        <button
          onClick={() => onReview(event)}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-300 hover:bg-blue-500/20"
        >
          <SlidersHorizontal size={14} /> Review impact
        </button>
      </div>
      <p className="mt-3 text-sm text-zinc-400">{event.detail || "No additional detail provided."}</p>
      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md bg-zinc-900 p-2"><span className="text-zinc-500">Type</span><p className="text-zinc-200">{event.eventType}</p></div>
        <div className="rounded-md bg-zinc-900 p-2"><span className="text-zinc-500">Materiality</span><p className="text-zinc-200">{event.materiality}</p></div>
        <div className="rounded-md bg-zinc-900 p-2"><span className="text-zinc-500">Horizon</span><p className="text-zinc-200">{event.impactHorizon}</p></div>
        <div className="rounded-md bg-zinc-900 p-2">
          <span className="text-zinc-500">Truth / verification</span>
          <p className={scoreTone(event.truthScore)}>{event.truthScore}/100</p>
          <p className="mt-1 text-zinc-500">{verificationLabel(event.truthScore)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {event.suggestedRerunSteps.map((step) => (
          <span key={step} className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
            {stepLabel(step)}
          </span>
        ))}
      </div>
      {event.manualReviewRequired && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertCircle size={14} /> Manual review required before routing.
        </p>
      )}
    </div>
  );
}

function ManualImpactOverride({
  event,
  onChange,
}: {
  event: RefreshEvent | null;
  onChange: (event: RefreshEvent) => void;
}) {
  if (!event) return null;

  const updateStep = (step: number, patch: Partial<(typeof event.stepImpacts)[number]>) => {
    const next = {
      ...event,
      stepImpacts: event.stepImpacts.map((impact) =>
        impact.step === step ? { ...impact, ...patch } : impact,
      ),
    };
    next.suggestedRerunSteps = next.stepImpacts
      .filter((impact) => impact.selected)
      .map((impact) => impact.step);
    onChange(next);
  };

  const scoreBand = (score: number) => {
    if (score >= 75) return {
      label: "Strong rerun",
      className: "bg-red-500/10 text-red-300",
      recommendation: "Strongly rerun",
    };
    if (score >= 50) return {
      label: "Rerun suggested",
      className: "bg-amber-500/10 text-amber-300",
      recommendation: "Rerun by default",
    };
    if (score >= 25) return {
      label: "Review optional",
      className: "bg-blue-500/10 text-blue-300",
      recommendation: "Reuse unless analyst overrides",
    };
    return {
      label: "Reuse likely",
      className: "bg-zinc-800 text-zinc-300",
      recommendation: "Reuse by default",
    };
  };

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
      <div className="flex items-center gap-2">
        <SlidersHorizontal size={18} className="text-blue-300" />
        <h3 className="text-sm font-semibold text-zinc-100">Manual impact override</h3>
      </div>
      <p className="mt-2 text-sm text-zinc-400">{event.title}: {event.detail || "No detail provided."}</p>
      <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-400">
        Impact score means how much this event could change that step&apos;s output, not whether the event is true.
        Use <span className="font-semibold text-zinc-200">50+</span> as the rerun threshold and{" "}
        <span className="font-semibold text-zinc-200">75+</span> as strong rerun. Scores are model-generated; use the checkbox to make the final rerun decision.
      </div>

      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg bg-zinc-950/70 p-3"><span className="text-zinc-500">Truth / verification</span><p className={scoreTone(event.truthScore)}>{event.truthScore}/100</p><p className="mt-1 text-zinc-500">{verificationLabel(event.truthScore)}</p></div>
        <div className="rounded-lg bg-zinc-950/70 p-3"><span className="text-zinc-500">Impact size</span><p className={scoreTone(event.impactSize)}>{event.impactSize}/100</p></div>
        <div className="rounded-lg bg-zinc-950/70 p-3"><span className="text-zinc-500">Certainty</span><p className="text-zinc-200">{event.certainty}</p></div>
        <div className="rounded-lg bg-zinc-950/70 p-3"><span className="text-zinc-500">Quantifiability</span><p className="text-zinc-200">{event.quantifiability}</p></div>
        <div className="rounded-lg bg-zinc-950/70 p-3"><span className="text-zinc-500">Horizon</span><p className="text-zinc-200">{event.impactHorizon}</p></div>
        <div className="rounded-lg bg-zinc-950/70 p-3"><span className="text-zinc-500">Drivers</span><p className="text-zinc-200">{event.dcfDriversAffected.join(", ")}</p></div>
      </div>

      <div className="mt-4 space-y-3">
        {event.stepImpacts.map((impact) => (
          <div key={impact.step} className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-3 text-sm font-medium text-zinc-100">
                <input
                  type="checkbox"
                  checked={impact.selected}
                  onChange={(changeEvent) => updateStep(impact.step, { selected: changeEvent.target.checked })}
                  className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-blue-500"
                />
                {stepLabel(impact.step)}
              </label>
              <div className="flex min-w-[260px] flex-1 items-center justify-end gap-3">
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${scoreBand(impact.score).className}`}>
                  {scoreBand(impact.score).label}
                </span>
                <div className="w-32">
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${
                        impact.score >= 75 ? "bg-red-400" :
                        impact.score >= 50 ? "bg-amber-400" :
                        impact.score >= 25 ? "bg-blue-400" :
                        "bg-zinc-500"
                      }`}
                      style={{ width: `${impact.score}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
                    <span>0</span>
                    <span>50 rerun</span>
                    <span>100</span>
                  </div>
                </div>
                <span className="w-14 text-right font-mono text-sm font-semibold text-zinc-100">
                  {impact.score}/100
                </span>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs md:grid-cols-[160px_1fr]">
              <div className="rounded-md bg-zinc-900 p-2">
                <span className="text-zinc-500">Recommendation</span>
                <p className="mt-1 font-medium text-zinc-200">{scoreBand(impact.score).recommendation}</p>
              </div>
              <div className="rounded-md bg-zinc-900 p-2">
                <span className="text-zinc-500">Why</span>
                <p className="mt-1 leading-5 text-zinc-300">{impact.explanation}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Step0RefreshGate() {
  const { dispatch } = useCFP();
  const [query, setQuery] = useState("");
  const [matchedSave, setMatchedSave] = useState<CompanySave | null>(null);
  const [detectedEvents, setDetectedEvents] = useState<RefreshEvent[]>([]);
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [manualEvent, setManualEvent] = useState<ManualEventInput>(emptyManualEvent);
  const [reviewEventId, setReviewEventId] = useState<string | null>(null);
  const [cacheApplied, setCacheApplied] = useState(false);
  const [previewSave, setPreviewSave] = useState<CompanySave | null>(null);
  const [previewChecked, setPreviewChecked] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const allEvents = detectedEvents;
  const reviewEvent = allEvents.find((event) => event.id === reviewEventId) ?? null;
  const routingSummary = useMemo(() => buildRoutingSummary(allEvents), [allEvents]);
  const completedStep = matchedSave ? completedThroughStep(matchedSave) : 0;

  useEffect(() => {
    const trimmed = query.trim();
    setPreviewSave(null);
    setPreviewChecked(false);
    if (!trimmed) {
      setPreviewing(false);
      return;
    }

    let cancelled = false;
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      getAllSaves()
        .then((saves) => {
          if (cancelled) return;
          setPreviewSave(findLatestMatchingSave(trimmed, saves));
          setPreviewChecked(true);
        })
        .catch(() => {
          if (cancelled) return;
          setPreviewSave(null);
          setPreviewChecked(true);
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const refreshDriverAdjustments = (save: CompanySave | null, events: RefreshEvent[]) => {
    if (!save || events.length === 0) {
      clearEventImpactAdjustments();
      return;
    }
    const pkg = buildEventImpactAdjustments(save, events);
    saveEventImpactAdjustments(pkg);
  };

  const replaceEvent = (nextEvent: RefreshEvent) => {
    setDetectedEvents((events) => {
      const nextEvents = events.map((event) => (event.id === nextEvent.id ? nextEvent : event));
      refreshDriverAdjustments(matchedSave, nextEvents);
      return nextEvents;
    });
  };

  const detectMarketDataChange = async (save: CompanySave): Promise<RefreshEvent[]> => {
    if (!save.ticker) return [];

    const savedTime = new Date(save.savedAt).getTime();
    const cacheAgeMs = Date.now() - savedTime;
    if (!Number.isFinite(cacheAgeMs) || cacheAgeMs < MARKET_DATA_MIN_CACHE_AGE_MS) {
      return [];
    }

    try {
      const response = await fetch(`/api/wacc-data?ticker=${encodeURIComponent(save.ticker)}`);
      const data = (await response.json()) as WaccDataPreview;
      if (data.error) return [];

      const priceMove = data.currentPrice && save.snapshot.currentPrice
        ? Math.abs(data.currentPrice - save.snapshot.currentPrice) / save.snapshot.currentPrice
        : 0;
      const savedRiskFreeRate = save.cfpState.wacc.fetchedData?.riskFreeRate ?? save.cfpState.wacc.constants.riskFreeRate;
      const riskFreeMove = data.riskFreeRate && savedRiskFreeRate
        ? Math.abs(data.riskFreeRate - savedRiskFreeRate)
        : 0;

      if (priceMove < MARKET_PRICE_MOVE_THRESHOLD && riskFreeMove < MARKET_RISK_FREE_MOVE_THRESHOLD) return [];

      const impactSize = Math.min(95, Math.round(Math.max(priceMove * 500, riskFreeMove * 3000, 35)));
      const changeParts = [
        priceMove >= MARKET_PRICE_MOVE_THRESHOLD ? `price move ${(priceMove * 100).toFixed(1)}%` : null,
        riskFreeMove >= MARKET_RISK_FREE_MOVE_THRESHOLD ? `risk-free rate move ${(riskFreeMove * 100).toFixed(2)}pp` : null,
      ].filter(Boolean);
      const event: RefreshEvent = {
        id: `auto-market-${Date.now()}`,
        title: "Market data changed since cached run",
        detail: `Current market data differs materially from the saved valuation snapshot (${changeParts.join(", ")}). Future earnings calendar items are ignored until actual results are released.`,
        eventType: "market data change",
        source: "Yahoo Finance market data",
        eventDate: new Date().toISOString(),
        confidence: 78,
        impactHorizon: "next quarter",
        materiality: priceMove >= 0.15 ? "high" : "medium",
        quantifiability: "known",
        dcfDriversAffected: ["Market cap", "Current price", "Cost of equity", "WACC sensitivity"],
        suggestedRerunSteps: [7, 8],
        manualReviewRequired: false,
        truthScore: 76,
        impactSize,
        certainty: "reported",
        stepImpacts: buildStepImpacts("market data change", [7, 8], impactSize, 76),
      };

      return filterEventsAfterSavedAt([event], save.savedAt);
    } catch {
      return [];
    }
  };

  const handleCheck = async () => {
    setChecking(true);
    setChecked(false);
    setStatus(null);
    setMatchedSave(null);
    setDetectedEvents([]);
    setReviewEventId(null);
    setCacheApplied(false);
    clearEventImpactAdjustments();

    try {
      const saves = await getAllSaves();
      const match = findLatestMatchingSave(query, saves);
      if (!match) {
        setStatus("No historical run found. Start from Step 1 to create a full DCF run.");
        setChecked(true);
        return;
      }

      setMatchedSave(match);
      const events = await detectMarketDataChange(match);
      setDetectedEvents(events);
      refreshDriverAdjustments(match, events);
      setStatus(events.length ? "New update candidates detected after the saved timestamp." : "No new updates detected.");
      setChecked(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not check saved runs.");
      setChecked(true);
    } finally {
      setChecking(false);
    }
  };

  const handleUseCached = () => {
    if (!matchedSave) return;
    dispatch({ type: "RESTORE_STATE", payload: matchedSave.cfpState });
    dispatch({ type: "SET_STEP", payload: 0 });
    setCacheApplied(true);
  };

  const handleAddManualEvent = () => {
    const analyzed = analyzeManualEvent(manualEvent);
    setDetectedEvents((events) => {
      const nextEvents = [...events, analyzed];
      refreshDriverAdjustments(matchedSave, nextEvents);
      return nextEvents;
    });
    setReviewEventId(analyzed.id);
    setManualEvent(emptyManualEvent);
    setStatus("Manual event analyzed. Review or override the step impact before routing.");
  };

  const handleRunRecommended = () => {
    if (matchedSave) {
      dispatch({ type: "RESTORE_STATE", payload: matchedSave.cfpState });
    }

    const earliest = routingSummary.rerun[0];
    if (earliest) {
      dispatch({ type: "SET_STEP", payload: earliest });
    } else if (matchedSave) {
      dispatch({ type: "SET_STEP", payload: 8 });
    } else {
      dispatch({ type: "SET_STEP", payload: 1 });
    }
  };

  return (
    <StepShell
      stepNumber={0}
      title="Refresh Gate"
      subtitle="Check whether a saved company run can be reused before rerunning the full DCF workflow."
      onNext={() => dispatch({ type: "SET_STEP", payload: 1 })}
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <label className="block">
            <span className="text-sm font-medium text-zinc-300">Ticker or company name</span>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-600" size={17} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && query.trim() && !checking) void handleCheck();
                  }}
                  placeholder="AAPL, Apple, or Apple Inc."
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500"
                />
              </div>
              <button
                onClick={handleCheck}
                disabled={!query.trim() || checking}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                {checking ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                Check updates
              </button>
            </div>
          </label>
          {query.trim() && !checked && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
              previewSave
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border-zinc-800 bg-zinc-900/60 text-zinc-400"
            }`}>
              {previewing ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Looking for cached runs...
                </span>
              ) : previewSave ? (
                <span>
                  Cached run found: <span className="font-medium text-emerald-100">{previewSave.companyName}</span>{" "}
                  ({previewSave.ticker}), saved {fmtDate(previewSave.savedAt)}. Click Check updates to scan for new events.
                </span>
              ) : previewChecked ? (
                <span>No cached run found for this ticker/company yet. Click Check updates to confirm or start Step 1.</span>
              ) : (
                <span>Enter a ticker or company name to look for cached runs.</span>
              )}
            </div>
          )}
        </div>

        {checked && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            {!matchedSave ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <AlertCircle size={17} className="text-amber-300" /> No historical run found
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">{status}</p>
                </div>
                <button
                  onClick={() => dispatch({ type: "SET_STEP", payload: 1 })}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  Start Step 1 <ArrowRight size={15} />
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                      <Database size={17} className="text-emerald-300" />
                      Matched cached run
                    </p>
                    <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg bg-zinc-900 p-3"><span className="text-zinc-500">Company</span><p className="text-zinc-100">{matchedSave.companyName}</p></div>
                      <div className="rounded-lg bg-zinc-900 p-3"><span className="text-zinc-500">Ticker</span><p className="text-zinc-100">{matchedSave.ticker}</p></div>
                      <div className="rounded-lg bg-zinc-900 p-3"><span className="text-zinc-500">Last updated</span><p className="text-zinc-100">{fmtDate(matchedSave.savedAt)}</p></div>
                      <div className="rounded-lg bg-zinc-900 p-3"><span className="text-zinc-500">Completed through</span><p className="text-zinc-100">{completedStep ? stepLabel(completedStep) : "Step 0"}</p></div>
                    </div>
                  </div>
                  <button
                    onClick={handleUseCached}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20"
                  >
                    <CheckCircle2 size={16} /> Use Cached Result
                  </button>
                </div>
                <div className={`rounded-lg px-3 py-2 text-sm ${detectedEvents.length ? "bg-amber-500/10 text-amber-200" : "bg-emerald-500/10 text-emerald-200"}`}>
                  {status}
                  {!detectedEvents.length && " You can reuse cached output or add your own event before deciding."}
                  {cacheApplied && " Cached state has been applied; you are still on Step 0 for review."}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-100">Detected events</h3>
          {!checked ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-500">
              Enter a ticker or company name, then click Check updates to compare the latest cached run against new updates.
            </div>
          ) : detectedEvents.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-500">
              No update events are being treated as new. Old filings/news and future earnings dates are ignored unless actual data was released after the cached timestamp.
            </div>
          ) : (
            detectedEvents.map((event) => (
              <EventCard key={event.id} event={event} onReview={(selectedEvent) => setReviewEventId(selectedEvent.id)} />
            ))
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="flex items-center gap-2">
            <Plus size={17} className="text-blue-300" />
            <h3 className="text-sm font-semibold text-zinc-100">Add your own event</h3>
          </div>
          <div className="mt-4 grid gap-3">
            <input
              value={manualEvent.title}
              onChange={(event) => setManualEvent((current) => ({ ...current, title: event.target.value }))}
              placeholder="Event title"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-blue-500"
            />
            <textarea
              value={manualEvent.detail}
              onChange={(event) => setManualEvent((current) => ({ ...current, detail: event.target.value }))}
              placeholder="Event detail, source, link, or uncertainty notes"
              rows={3}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-blue-500"
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <SelectField label="Initial event type" value={manualEvent.eventType} options={MANUAL_EVENT_TYPE_OPTIONS} onChange={(value) => setManualEvent((current) => ({ ...current, eventType: value }))} />
              <SelectField label="Impact horizon" value={manualEvent.impactHorizon} options={HORIZONS} onChange={(value) => setManualEvent((current) => ({ ...current, impactHorizon: value }))} />
              <SelectField label="Materiality (unknown = auto)" value={manualEvent.materiality} options={MATERIALITIES} onChange={(value) => setManualEvent((current) => ({ ...current, materiality: value }))} />
              <SelectField label="Certainty" value={manualEvent.certainty} options={CERTAINTIES} onChange={(value) => setManualEvent((current) => ({ ...current, certainty: value }))} />
              <SelectField label="Quantifiability (unknown = auto)" value={manualEvent.quantifiability} options={QUANTIFIABILITIES} onChange={(value) => setManualEvent((current) => ({ ...current, quantifiability: value }))} />
            </div>
            <button
              onClick={handleAddManualEvent}
              disabled={!manualEvent.title.trim() && !manualEvent.detail.trim()}
              className="inline-flex w-fit items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              <Plus size={15} /> Analyze event
            </button>
          </div>
        </div>

        <ManualImpactOverride event={reviewEvent} onChange={replaceEvent} />

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <h3 className="text-sm font-semibold text-zinc-100">Recommended routing</h3>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg bg-zinc-900 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Reuse steps</p>
              <p className="mt-2 text-sm text-zinc-300">{routingSummary.reuse.length ? routingSummary.reuse.map(stepLabel).join(", ") : "None"}</p>
            </div>
            <div className="rounded-lg bg-zinc-900 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Rerun steps</p>
              <p className="mt-2 text-sm text-zinc-300">{routingSummary.rerun.length ? routingSummary.rerun.map(stepLabel).join(", ") : "None"}</p>
            </div>
          </div>
          <div className="mt-3 rounded-lg bg-zinc-900 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Reasons</p>
            <p className="mt-2 text-sm text-zinc-300">{routingSummary.reasons.length ? routingSummary.reasons.join(" ") : "No rerun trigger selected."}</p>
          </div>
          <div className="mt-3 rounded-lg bg-zinc-900 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Conditional checks</p>
            <p className="mt-2 text-sm text-zinc-300">{routingSummary.conditionalChecks.length ? routingSummary.conditionalChecks.join(" ") : "No conditional checks required."}</p>
          </div>
          <button
            onClick={handleRunRecommended}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Run Recommended <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </StepShell>
  );
}
