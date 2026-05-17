"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Database,
  ExternalLink,
  FileSearch,
  History,
  Loader2,
  RefreshCcw,
  SlidersHorizontal,
} from "lucide-react";
import StepShell from "./StepShell";
import { useCFP } from "@/context/CFPContext";
import {
  STEP0_RULES,
  STEP0_CACHE_KEY,
  STEP_LABELS,
  analyzeRefreshPlan,
  findCachedRun,
  getCachedRuns,
  type Step0DcfImpactDriver,
  type Step0ImpactCertainty,
  type Step0ImpactHorizon,
  type Step0ImpactMateriality,
  type Step0ImpactQuantifiability,
  type Step0ManualOverride,
  type Step0ChangeType,
  type Step0DetectResponse,
  type Step0DetectedEvent,
} from "@/lib/step0-cache";

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stepText(steps: number[]): string {
  if (steps.length === 0) return "None";
  return steps.map((step) => `Step ${step}`).join(", ");
}

function subscribeToStep0Cache(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getStep0CacheSnapshot(): string {
  return window.localStorage.getItem(STEP0_CACHE_KEY) ?? "";
}

function getStep0ServerSnapshot(): string {
  return "";
}

export default function Step0RefreshGate() {
  const { state, dispatch } = useCFP();
  const [lookup, setLookup] = useState(state.profile.ticker || state.profile.companyName || "");
  const [checked, setChecked] = useState(false);
  const [checkedLookup, setCheckedLookup] = useState("");
  const [cacheRefreshKey, setCacheRefreshKey] = useState(0);
  const [selectedChanges, setSelectedChanges] = useState<Step0ChangeType[]>([]);
  const [manualOverrideEnabled, setManualOverrideEnabled] = useState(false);
  const [eventSummary, setEventSummary] = useState("");
  const [impactHorizon, setImpactHorizon] = useState<Step0ImpactHorizon>("unknown");
  const [impactMateriality, setImpactMateriality] = useState<Step0ImpactMateriality>("unknown");
  const [impactCertainty, setImpactCertainty] = useState<Step0ImpactCertainty>("low");
  const [manualSteps, setManualSteps] = useState<number[]>([5, 6, 8]);
  const [manualStepScores, setManualStepScores] = useState<Record<number, number>>(() => buildDefaultStepScores([5, 6, 8]));
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectionNote, setDetectionNote] = useState<string | null>(null);
  const [detectedEvents, setDetectedEvents] = useState<Step0DetectedEvent[]>([]);
  const [acceptedEventIds, setAcceptedEventIds] = useState<string[]>([]);
  const [customTitle, setCustomTitle] = useState("");
  const [customSummary, setCustomSummary] = useState("");
  const [customChangeType, setCustomChangeType] = useState<Step0ChangeType>("new_product_or_technology");
  const [customHorizon, setCustomHorizon] = useState<Step0ImpactHorizon>("unknown");
  const [customMateriality, setCustomMateriality] = useState<Step0ImpactMateriality>("unknown");
  const [customCertainty, setCustomCertainty] = useState<Step0ImpactCertainty>("low");
  const [customQuantifiability, setCustomQuantifiability] = useState<Step0ImpactQuantifiability>("unknown");
  const [cacheReady, setCacheReady] = useState(false);

  const manualOverride: Step0ManualOverride = useMemo(
    () => ({
      enabled: manualOverrideEnabled,
      eventSummary,
      horizon: impactHorizon,
      materiality: impactMateriality,
      certainty: impactCertainty,
      manualSteps,
    }),
    [
      eventSummary,
      impactCertainty,
      impactHorizon,
      impactMateriality,
      manualOverrideEnabled,
      manualSteps,
    ],
  );

  const cacheSnapshot = useSyncExternalStore(
    subscribeToStep0Cache,
    getStep0CacheSnapshot,
    getStep0ServerSnapshot,
  );

  useEffect(() => {
    setCacheReady(true);
  }, []);

  const cachedRuns = useMemo(() => {
    void cacheSnapshot;
    void cacheRefreshKey;
    if (!cacheReady) return [];
    return getCachedRuns();
  }, [cacheReady, cacheRefreshKey, cacheSnapshot]);
  const cachedRun = useMemo(() => {
    void cacheSnapshot;
    void cacheRefreshKey;
    if (!cacheReady) return null;
    return findCachedRun(checked ? checkedLookup : state.profile.ticker || state.profile.companyName);
  }, [
    cacheReady,
    cacheRefreshKey,
    cacheSnapshot,
    checked,
    checkedLookup,
    state.profile.companyName,
    state.profile.ticker,
  ]);

  const plan = useMemo(
    () => analyzeRefreshPlan(cachedRun, selectedChanges, manualOverride),
    [cachedRun, selectedChanges, manualOverride],
  );
  const acceptedEvents = useMemo(
    () => detectedEvents.filter((event) => acceptedEventIds.includes(event.id)),
    [acceptedEventIds, detectedEvents],
  );

  const toggleAcceptedEvent = (eventId: string) => {
    setAcceptedEventIds((current) =>
      current.includes(eventId)
        ? current.filter((item) => item !== eventId)
        : [...current, eventId],
    );
  };

  const detectUpdates = async (tickerInput: string, sinceIso?: string): Promise<Step0DetectedEvent[]> => {
    const ticker = tickerInput.trim();
    if (!ticker) return [];

    setIsDetecting(true);
    setDetectError(null);
    setDetectionNote(null);

    try {
      const response = await fetch(`/api/step0-detect?ticker=${encodeURIComponent(ticker)}`);
      const data = (await response.json()) as Step0DetectResponse;

      if (!response.ok) {
        throw new Error(data.error || `Detection failed (${response.status})`);
      }

      const newEvents = sinceIso ? filterEventsSince(data.events, sinceIso) : data.events;
      setDetectedEvents(newEvents);
      setAcceptedEventIds(
        newEvents
          .filter((event) => event.impactAssessment.action === "auto_rerun")
          .map((event) => event.id),
      );
      if (data.ticker) setLookup(data.ticker);
      if (sinceIso && newEvents.length === 0) {
        setDetectionNote(`No new detected events since the last saved run (${formatDate(sinceIso)}).`);
      }
      return newEvents;
    } catch (err: unknown) {
      setDetectError(err instanceof Error ? err.message : "Detection failed.");
      return [];
    } finally {
      setIsDetecting(false);
    }
  };

  const handleDetectUpdates = async () => {
    const userLookup = lookup.trim() || state.profile.ticker || state.profile.companyName;
    if (!userLookup.trim()) {
      setDetectError("Enter a ticker or company first.");
      return;
    }

    const matchedRun = findCachedRun(userLookup);
    const ticker = matchedRun?.ticker || userLookup;
    await detectUpdates(ticker, matchedRun?.updatedAt);
  };

  const handleCheckDatabaseAndUpdates = async () => {
    const currentLookup = lookup.trim();
    if (!currentLookup) {
      setDetectError("Enter a ticker or company first.");
      return;
    }

    const matchedRun = findCachedRun(currentLookup);
    setCheckedLookup(currentLookup);
    setChecked(true);
    setCacheRefreshKey((value) => value + 1);
    setDetectedEvents([]);
    setAcceptedEventIds([]);
    setSelectedChanges([]);
    setManualOverrideEnabled(false);
    setManualStepScores(buildDefaultStepScores([5, 6, 8]));
    setDetectionNote(null);
    setDetectError(null);

    if (!matchedRun) return;
    await detectUpdates(matchedRun.ticker, matchedRun.updatedAt);
  };

  const acceptSelectedEvents = () => {
    const nextChanges = Array.from(
      new Set([...selectedChanges, ...acceptedEvents.map((event) => event.changeType)]),
    );
    const reviewEvents = acceptedEvents.filter((event) => eventNeedsManualParameters(event));
    setSelectedChanges(nextChanges);

    if (reviewEvents.length > 0) {
      setManualOverrideEnabled(true);
      setEventSummary(
        reviewEvents
          .map((event) => `${event.title}: ${event.impactAssessment.assessmentSummary}`)
          .join("\n"),
      );
      const suggestedSteps = Array.from(new Set(reviewEvents.flatMap((event) => event.suggestedSteps))).sort((a, b) => a - b);
      if (suggestedSteps.length > 0) setManualSteps(suggestedSteps);
      setManualStepScores(mergeStepImpactScores(reviewEvents));
      const firstReviewEvent = reviewEvents[0];
      setImpactHorizon(firstReviewEvent.impactAssessment.horizon);
      setImpactMateriality(firstReviewEvent.impactAssessment.materiality);
      setImpactCertainty(firstReviewEvent.impactAssessment.certainty);
    }
  };

  const addCustomEvent = () => {
    const title = customTitle.trim();
    const summary = customSummary.trim();
    if (!title && !summary) {
      setDetectError("Add a title or event detail before adding your own event.");
      return;
    }

    const event = buildCustomEvent({
      title: title || "User-provided event",
      summary: summary || title,
      fallbackChangeType: customChangeType,
      fallbackHorizon: customHorizon,
      fallbackMateriality: customMateriality,
      fallbackCertainty: customCertainty,
      fallbackQuantifiability: customQuantifiability,
    });

    setDetectedEvents((current) => [event, ...current]);
    setAcceptedEventIds((current) => [...current, event.id]);
    setDetectError(null);

    setManualOverrideEnabled(true);
    setEventSummary(buildManualOverrideSummary(event));
    setManualSteps(event.suggestedSteps);
    setManualStepScores(buildStepImpactScores(event));
    setImpactHorizon(event.impactAssessment.horizon);
    setImpactMateriality(event.impactAssessment.materiality);
    setImpactCertainty(event.impactAssessment.certainty);

    setCustomTitle("");
    setCustomSummary("");
  };

  const toggleManualStep = (step: number) => {
    setManualSteps((current) =>
      current.includes(step)
        ? current.filter((item) => item !== step)
        : [...current, step].sort((a, b) => a - b),
    );
  };

  const updateManualStepScore = (step: number, score: number) => {
    setManualStepScores((current) => ({ ...current, [step]: score }));
  };

  const applyCachedState = () => {
    if (!cachedRun) return;
    dispatch({ type: "APPLY_CACHED_RUN", payload: cachedRun.state });
  };

  const startRecommendedRun = () => {
    if (cachedRun) applyCachedState();
    else {
      const name = lookup.trim();
      if (name) dispatch({ type: "UPDATE_PROFILE", payload: { companyName: name, ticker: name.toUpperCase() } });
    }
    dispatch({ type: "SET_STEP", payload: plan.startStep ?? 8 });
  };

  const forceFullRun = () => {
    const name = lookup.trim();
    if (name) dispatch({ type: "UPDATE_PROFILE", payload: { companyName: name, ticker: name.toUpperCase() } });
    dispatch({ type: "SET_STEP", payload: 1 });
  };

  return (
    <StepShell
      stepNumber={0}
      title="Refresh Gate"
      subtitle="Check the local run database first, then reuse stable outputs or rerun only the steps affected by new filings, news, market data, or macro changes."
      onNext={startRecommendedRun}
    >
      <div className="space-y-6">
        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="step0-lookup" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Ticker or company
              </label>
              <input
                id="step0-lookup"
                value={lookup}
                onChange={(event) => setLookup(event.target.value)}
                placeholder="e.g. AAPL or Apple Inc."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500"
              />
            </div>
            <button
              onClick={handleCheckDatabaseAndUpdates}
              disabled={isDetecting}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
            >
              {isDetecting ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
              Check Database & Updates
            </button>
            <button
              onClick={handleDetectUpdates}
              disabled={isDetecting}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
            >
              {isDetecting ? <Loader2 size={16} className="animate-spin" /> : <FileSearch size={16} />}
              Detect Updates
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <StatusTile
              icon={<Archive size={16} />}
              label="Saved runs"
              value={String(cachedRuns.length)}
            />
            <StatusTile
              icon={<History size={16} />}
              label="Matched run"
              value={cachedRun ? cachedRun.companyName : checked ? "None" : "Not checked"}
            />
            <StatusTile
              icon={<FileSearch size={16} />}
              label="Last updated"
              value={cachedRun ? formatDate(cachedRun.updatedAt) : "Not available"}
            />
          </div>
        </section>

        {checked && !cachedRun && (
          <section className="rounded-lg border border-blue-800/50 bg-blue-950/15 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-blue-300">No historical run found</h3>
                <p className="mt-1 text-sm leading-6 text-zinc-300">
                  This company is not in the local run database yet, so Step 0 recommends a full first-pass analysis starting at Step 1.
                </p>
              </div>
              <button
                onClick={forceFullRun}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
              >
                <ArrowRight size={16} />
                Start Step 1
              </button>
            </div>
          </section>
        )}

        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                Add your own event
              </h3>
              <p className="mt-1 text-sm leading-6 text-zinc-500">
                Add management commentary, private research notes, product rumors, or any event the automatic detector missed.
              </p>
            </div>
            <button
              onClick={addCustomEvent}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              Add Event
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-zinc-300">Event title</span>
              <input
                value={customTitle}
                onChange={(event) => setCustomTitle(event.target.value)}
                placeholder="e.g. Apple announces a new AI device"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500"
              />
            </label>
            <SelectField
              label="Event type"
              value={customChangeType}
              onChange={(value) => setCustomChangeType(value as Step0ChangeType)}
              options={STEP0_RULES.map((rule) => [rule.changeType, rule.label])}
            />
          </div>

          <div className="mt-3">
            <label htmlFor="custom-event-summary" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Event detail
            </label>
            <textarea
              id="custom-event-summary"
              value={customSummary}
              onChange={(event) => setCustomSummary(event.target.value)}
              placeholder="Describe what happened, why it may affect the forecast, and what is still uncertain."
              rows={3}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500"
            />
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <SelectField
              label="Impact horizon"
              value={customHorizon}
              onChange={(value) => setCustomHorizon(value as Step0ImpactHorizon)}
              options={[
                ["unknown", "Unknown"],
                ["next_quarter", "Next quarter"],
                ["one_to_two_years", "1-2 years"],
                ["long_term", "Long-term"],
              ]}
            />
            <SelectField
              label="Materiality"
              value={customMateriality}
              onChange={(value) => setCustomMateriality(value as Step0ImpactMateriality)}
              options={[
                ["unknown", "Unknown"],
                ["low", "Low"],
                ["medium", "Medium"],
                ["high", "High"],
              ]}
            />
            <SelectField
              label="Certainty"
              value={customCertainty}
              onChange={(value) => setCustomCertainty(value as Step0ImpactCertainty)}
              options={[
                ["low", "Low"],
                ["medium", "Medium"],
                ["high", "High"],
              ]}
            />
            <SelectField
              label="Can quantify?"
              value={customQuantifiability}
              onChange={(value) => setCustomQuantifiability(value as Step0ImpactQuantifiability)}
              options={[
                ["unknown", "Unknown"],
                ["estimable", "Estimable"],
                ["known", "Known"],
              ]}
            />
          </div>
        </section>

        {(detectedEvents.length > 0 || detectError) && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                  Detected events
                </h3>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Accept events after reviewing their DCF impact. Known long-term effects route automatically; uncertain or unquantified effects open manual parameters.
                </p>
              </div>
              <button
                onClick={acceptSelectedEvents}
                disabled={acceptedEvents.length === 0}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                Accept Selected
              </button>
            </div>

            {detectError && (
              <div className="mt-4 rounded-lg border border-red-800/50 bg-red-950/20 px-3 py-2 text-sm text-red-200">
                {detectError}
              </div>
            )}

            <div className="mt-4 space-y-3">
              {detectedEvents.map((event) => (
                <DetectedEventCard
                  key={event.id}
                  event={event}
                  accepted={acceptedEventIds.includes(event.id)}
                  onToggle={() => toggleAcceptedEvent(event.id)}
                />
              ))}
            </div>
          </section>
        )}

        {detectionNote && detectedEvents.length === 0 && !detectError && (
          <section className="rounded-lg border border-emerald-800/50 bg-emerald-950/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                  <CheckCircle2 size={16} />
                  No new updates detected
                </h3>
                <p className="mt-1 text-sm leading-6 text-zinc-300">
                  {detectionNote} You can reuse the cached result, or add your own event before deciding.
                </p>
              </div>
              {cachedRun && (
                <button
                  onClick={() => {
                    applyCachedState();
                    dispatch({ type: "SET_STEP", payload: 8 });
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                >
                  <CheckCircle2 size={16} />
                  Use Cached Result
                </button>
              )}
            </div>
          </section>
        )}

        {cachedRun && (
          <section className="rounded-lg border border-emerald-800/50 bg-emerald-950/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                  <CheckCircle2 size={16} />
                  Historical result found
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  {cachedRun.companyName} ({cachedRun.ticker}) has cached outputs through Step {cachedRun.completedThroughStep}.
                </p>
              </div>
              <button
                onClick={() => {
                  applyCachedState();
                  dispatch({ type: "SET_STEP", payload: 8 });
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                <CheckCircle2 size={16} />
                Use Cached Result
              </button>
            </div>
          </section>
        )}

        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <SlidersHorizontal size={16} />
                Manual impact override
              </h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
                Use this when a news event may matter, but the duration or financial impact is uncertain.
                User-added events are summarized here with source verification, impact size, DCF drivers, and selected rerun steps.
              </p>
            </div>
            <button
              onClick={() => setManualOverrideEnabled((value) => !value)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                manualOverrideEnabled
                  ? "bg-blue-600 text-white hover:bg-blue-500"
                  : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {manualOverrideEnabled ? "Override On" : "Override Off"}
            </button>
          </div>

          <div className={`mt-4 space-y-4 ${manualOverrideEnabled ? "" : "opacity-50"}`}>
            <div>
              <label htmlFor="step0-event-summary" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Event note
              </label>
              <textarea
                id="step0-event-summary"
                value={eventSummary}
                onChange={(event) => setEventSummary(event.target.value)}
                disabled={!manualOverrideEnabled}
                placeholder="e.g. Product launch announced for next quarter; long-term adoption and revenue impact are still uncertain."
                rows={3}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500 disabled:cursor-not-allowed"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <SelectField
                label="Impact horizon"
                value={impactHorizon}
                disabled={!manualOverrideEnabled}
                onChange={(value) => setImpactHorizon(value as Step0ImpactHorizon)}
                options={[
                  ["unknown", "Unknown"],
                  ["next_quarter", "Next quarter"],
                  ["one_to_two_years", "1-2 years"],
                  ["long_term", "Long-term"],
                ]}
              />
              <SelectField
                label="Materiality"
                value={impactMateriality}
                disabled={!manualOverrideEnabled}
                onChange={(value) => setImpactMateriality(value as Step0ImpactMateriality)}
                options={[
                  ["unknown", "Unknown"],
                  ["low", "Low"],
                  ["medium", "Medium"],
                  ["high", "High"],
                ]}
              />
              <SelectField
                label="Certainty"
                value={impactCertainty}
                disabled={!manualOverrideEnabled}
                onChange={(value) => setImpactCertainty(value as Step0ImpactCertainty)}
                options={[
                  ["low", "Low"],
                  ["medium", "Medium"],
                  ["high", "High"],
                ]}
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-zinc-300">Step-level impact scores</p>
              <div className="space-y-2">
                {Object.entries(STEP_LABELS).map(([step, label]) => {
                  const stepNumber = Number(step);
                  const selected = manualSteps.includes(stepNumber);
                  const score = manualStepScores[stepNumber] ?? 0;
                  return (
                    <div
                      key={step}
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                        selected
                          ? "border-blue-500/60 bg-blue-950/30 text-blue-200"
                          : "border-zinc-800 bg-zinc-900 text-zinc-400"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="inline-flex min-w-[220px] flex-1 items-center gap-2">
                          <input
                            type="checkbox"
                            disabled={!manualOverrideEnabled}
                            checked={selected}
                            onChange={() => toggleManualStep(stepNumber)}
                            className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-blue-500 disabled:cursor-not-allowed"
                          />
                          <span className="font-medium">
                            Step {step}: {label}
                          </span>
                        </label>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stepImpactTone(score)}`}>
                          Impact {score}/100
                        </span>
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_8rem]">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          disabled={!manualOverrideEnabled}
                          value={score}
                          onChange={(event) => updateManualStepScore(stepNumber, Number(event.target.value))}
                          className="w-full disabled:cursor-not-allowed"
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          disabled={!manualOverrideEnabled}
                          value={score}
                          onChange={(event) => updateManualStepScore(stepNumber, clampScore(Number(event.target.value)))}
                          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-xs text-zinc-100 disabled:cursor-not-allowed"
                        />
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {stepImpactExplanation(stepNumber, score, selected)}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Steps above the impact threshold are pre-selected automatically, but you can uncheck any step or adjust the score when the impact is uncertain.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <RefreshCcw size={16} />
                Recommended routing
              </h3>
              <p className="mt-1 text-sm text-zinc-400">{plan.headline}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={startRecommendedRun}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
              >
                <ArrowRight size={16} />
                Run Recommended
              </button>
              <button
                onClick={forceFullRun}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
              >
                Force Full Rerun
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <PlanBox title="Reuse" steps={plan.reusableSteps} tone="emerald" />
            <PlanBox title="Rerun" steps={plan.rerunSteps} tone="blue" />
          </div>

          <div className="mt-4 space-y-3">
            {plan.reasons.map((reason) => (
              <p key={reason} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm leading-6 text-zinc-300">
                {reason}
              </p>
            ))}
            {plan.conditionalNotes.length > 0 && (
              <div className="rounded-lg border border-amber-800/50 bg-amber-950/15 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Conditional checks</p>
                <ul className="mt-2 space-y-1.5 text-sm leading-6 text-amber-100/90">
                  {plan.conditionalNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </StepShell>
  );
}

function StatusTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-zinc-200">{value}</p>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-zinc-300">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-blue-500 disabled:cursor-not-allowed"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function eventNeedsManualParameters(event: Step0DetectedEvent): boolean {
  return (
    event.impactAssessment.action === "manual_parameters" ||
    event.impactAssessment.quantifiability === "unknown" ||
    event.impactAssessment.horizon === "unknown" ||
    event.impactAssessment.materiality === "unknown" ||
    event.impactAssessment.certainty === "low"
  );
}

function filterEventsSince(events: Step0DetectedEvent[], sinceIso: string): Step0DetectedEvent[] {
  const since = new Date(sinceIso).getTime();
  if (Number.isNaN(since)) return events;

  return events.filter((event) => {
    const timestamp = event.eventDate ? new Date(event.eventDate).getTime() : Number.NaN;
    if (Number.isNaN(timestamp)) return true;
    if (event.source === "earnings" && timestamp > Date.now()) return false;
    return timestamp > since;
  });
}

function buildCustomEvent({
  title,
  summary,
  fallbackChangeType,
  fallbackHorizon,
  fallbackMateriality,
  fallbackCertainty,
  fallbackQuantifiability,
}: {
  title: string;
  summary: string;
  fallbackChangeType: Step0ChangeType;
  fallbackHorizon: Step0ImpactHorizon;
  fallbackMateriality: Step0ImpactMateriality;
  fallbackCertainty: Step0ImpactCertainty;
  fallbackQuantifiability: Step0ImpactQuantifiability;
}): Step0DetectedEvent {
  const inferred = inferCustomEventImpact({
    title,
    summary,
    fallbackChangeType,
    fallbackHorizon,
    fallbackMateriality,
    fallbackCertainty,
    fallbackQuantifiability,
  });
  const { changeType, horizon, materiality, certainty, quantifiability, verification, sourceUrl } = inferred;
  const verificationScore = scoreCustomEventVerification({
    text: `${title} ${summary}`.toLowerCase(),
    sourceUrl,
    certainty,
  });
  const suggestedSteps = getSuggestedStepsForChange(changeType, horizon, materiality, quantifiability);
  const action =
    horizon === "long_term" &&
    materiality !== "unknown" &&
    materiality !== "low" &&
    certainty === "high" &&
    quantifiability !== "unknown"
      ? "auto_rerun"
      : "manual_parameters";

  return {
    id: `user-${Date.now()}`,
    source: "user",
    changeType,
    title,
    summary: `${summary} Verification: ${verification}. Verification score: ${verificationScore}/100.`,
    detectedAt: new Date().toISOString(),
    eventDate: null,
    url: sourceUrl,
    confidence: certainty,
    horizon,
    materiality,
    suggestedSteps,
    requiresReview: action !== "auto_rerun",
    verificationScore,
    rationale: action === "auto_rerun"
      ? `${verification} Verification score: ${verificationScore}/100. The event appears long-term, material, high-certainty, and quantifiable enough to route automatically.`
      : `${verification} Verification score: ${verificationScore}/100. Parameter review is needed because impact horizon, magnitude, certainty, or quantifiability is not fully established.`,
    impactAssessment: {
      horizon,
      materiality,
      certainty,
      quantifiability,
      action,
      dcfDrivers: getDcfDriversForChange(changeType),
      parameterHints: action === "auto_rerun"
        ? ["Use the user-provided evidence as an explicit input when rerunning the affected steps."]
        : [
            "Set a scenario or manual assumption before changing the base-case DCF.",
            "Verify the source and quantify revenue, margin, WACC, or terminal-growth impact before changing the base case.",
          ],
      assessmentSummary: `${verification} Verification score: ${verificationScore}/100. Estimated DCF impact is ${materiality}, ${certainty}-certainty, ${quantifiability}, and ${horizon.replace(/_/g, " ")}.`,
    },
  };
}

function inferCustomEventImpact({
  title,
  summary,
  fallbackChangeType,
  fallbackHorizon,
  fallbackMateriality,
  fallbackCertainty,
  fallbackQuantifiability,
}: {
  title: string;
  summary: string;
  fallbackChangeType: Step0ChangeType;
  fallbackHorizon: Step0ImpactHorizon;
  fallbackMateriality: Step0ImpactMateriality;
  fallbackCertainty: Step0ImpactCertainty;
  fallbackQuantifiability: Step0ImpactQuantifiability;
}): {
  changeType: Step0ChangeType;
  horizon: Step0ImpactHorizon;
  materiality: Step0ImpactMateriality;
  certainty: Step0ImpactCertainty;
  quantifiability: Step0ImpactQuantifiability;
  verification: string;
  sourceUrl: string | null;
} {
  const text = `${title} ${summary}`.toLowerCase();
  const sourceUrl = extractFirstUrl(`${title} ${summary}`);
  const inferredChangeType = inferChangeTypeFromText(text) ?? fallbackChangeType;
  const verification = buildVerificationNote(text, sourceUrl);
  const inferredHorizon = inferHorizonFromText(text, fallbackHorizon);
  const inferredMateriality = inferMaterialityFromText(text, inferredChangeType, fallbackMateriality);
  const inferredCertainty = inferCertaintyFromText(text, sourceUrl, fallbackCertainty);
  const inferredQuantifiability = inferQuantifiabilityFromText(text, fallbackQuantifiability);

  return {
    changeType: inferredChangeType,
    horizon: inferredHorizon,
    materiality: inferredMateriality,
    certainty: inferredCertainty,
    quantifiability: inferredQuantifiability,
    verification,
    sourceUrl,
  };
}

function inferChangeTypeFromText(text: string): Step0ChangeType | null {
  if (matches(text, ["10-k", "annual report"])) return "new_10k";
  if (matches(text, ["10-q", "quarterly report"])) return "new_10q";
  if (matches(text, ["earnings", "guidance", "quarter results", "revenue miss", "revenue beat"])) return "earnings_release";
  if (matches(text, ["acquire", "acquisition", "merger", "divest", "spinoff", "spin off"])) return "mna_or_divestiture";
  if (matches(text, ["launch", "unveil", "release", "product", "ai", "chip", "platform", "technology"])) return "new_product_or_technology";
  if (matches(text, ["rival", "competitor", "market share", "price war", "pricing pressure"])) return "competitive_shift";
  if (matches(text, ["lawsuit", "regulator", "antitrust", "ban", "fine", "settlement", "probe"])) return "regulation_or_litigation";
  if (matches(text, ["ceo", "cfo", "resigns", "appoints", "management", "activist"])) return "management_change";
  if (matches(text, ["stock price", "share price", "beta", "debt yield", "buyback", "interest rate"])) return "market_data_change";
  if (matches(text, ["inflation", "rates", "fx", "tariff", "recession", "consumer demand"])) return "macro_change";
  return null;
}

function inferHorizonFromText(text: string, fallback: Step0ImpactHorizon): Step0ImpactHorizon {
  if (matches(text, ["next quarter", "this quarter", "near term", "short term", "temporary"])) return "next_quarter";
  if (matches(text, ["2026", "2027", "one year", "two year", "1-2", "12 month", "24 month"])) return "one_to_two_years";
  if (matches(text, ["long term", "multi year", "platform", "structural", "permanent", "durable"])) return "long_term";
  return fallback;
}

function inferMaterialityFromText(
  text: string,
  changeType: Step0ChangeType,
  fallback: Step0ImpactMateriality,
): Step0ImpactMateriality {
  if (matches(text, ["material", "major", "significant", "billion", "guidance", "restructure", "acquisition"])) return "high";
  if (matches(text, ["pilot", "small", "minor", "limited", "immaterial"])) return "low";
  if (["new_10k", "mna_or_divestiture"].includes(changeType)) return "high";
  if (fallback !== "unknown") return fallback;
  return ["new_product_or_technology", "competitive_shift", "regulation_or_litigation"].includes(changeType)
    ? "medium"
    : "unknown";
}

function inferCertaintyFromText(
  text: string,
  sourceUrl: string | null,
  fallback: Step0ImpactCertainty,
): Step0ImpactCertainty {
  if (matches(text, ["rumor", "unconfirmed", "could", "may", "might", "speculation"])) return "low";
  if (sourceUrl || matches(text, ["announced", "confirmed", "filed", "reported", "official", "press release"])) return "high";
  return fallback === "low" ? "medium" : fallback;
}

function inferQuantifiabilityFromText(
  text: string,
  fallback: Step0ImpactQuantifiability,
): Step0ImpactQuantifiability {
  if (/\$?\d+(\.\d+)?\s?(billion|million|bn|m|%|percent)/i.test(text)) return "known";
  if (matches(text, ["guidance", "target", "forecast", "expected", "estimate"])) return "estimable";
  return fallback;
}

function buildVerificationNote(text: string, sourceUrl: string | null): string {
  if (sourceUrl || matches(text, ["official", "press release", "filed", "sec", "10-k", "10-q"])) {
    return "Source verification is strong based on an official filing, source link, or official wording";
  }
  if (matches(text, ["reported", "according to", "news", "bloomberg", "reuters", "wsj", "cnbc"])) {
    return "Source verification is medium based on reported news language";
  }
  if (matches(text, ["rumor", "unconfirmed", "speculation"])) {
    return "Source verification is weak; verify the event before treating it as a base-case input";
  }
  return "Source verification is unclear; confirm with an official filing, company release, or reputable news source";
}

function scoreCustomEventVerification({
  text,
  sourceUrl,
  certainty,
}: {
  text: string;
  sourceUrl: string | null;
  certainty: Step0ImpactCertainty;
}): number {
  let score = 55;

  if (sourceUrl) score += 25;
  if (matches(text, ["official", "press release", "filed", "sec", "10-k", "10-q"])) score += 30;
  if (matches(text, ["reuters", "bloomberg", "wsj", "cnbc", "reported", "according to"])) score += 20;
  if (matches(text, ["satirical", "fictional", "parody"])) score -= 45;
  if (matches(text, ["rumor", "unconfirmed", "speculation"])) score -= 12;
  if (matches(text, ["could", "may", "might"])) score -= 5;
  if (certainty === "high") score += 10;
  if (certainty === "low") score -= 5;

  return Math.max(5, Math.min(100, score));
}

function getEventVerificationScore(event: Step0DetectedEvent): number {
  if (typeof event.verificationScore === "number") return event.verificationScore;
  if (event.source === "sec") return 98;
  if (event.url && event.confidence === "high") return 88;
  if (event.url) return 78;
  if (event.confidence === "high") return 75;
  if (event.confidence === "medium") return 60;
  return 40;
}

function verificationTone(score: number): string {
  if (score >= 80) return "bg-emerald-500/15 text-emerald-300";
  if (score >= 55) return "bg-amber-500/15 text-amber-300";
  return "bg-red-500/15 text-red-300";
}

function extractFirstUrl(value: string): string | null {
  return value.match(/https?:\/\/[^\s)]+/i)?.[0] ?? null;
}

function matches(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => {
    if (keyword.includes(" ")) return text.includes(keyword);
    return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(text);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildManualOverrideSummary(event: Step0DetectedEvent): string {
  const assessment = event.impactAssessment;
  const verificationScore = getEventVerificationScore(event);
  const stepScores = buildStepImpactScores(event);
  const stepScoreText = Object.entries(STEP_LABELS)
    .map(([step, label]) => `Step ${step} ${label}: ${stepScores[Number(step)]}/100`)
    .join("; ");
  return [
    `Event: ${event.title}`,
    `Verification score: ${verificationScore}/100.`,
    `Verification: ${event.rationale}`,
    `Impact size: ${assessment.materiality}; certainty: ${assessment.certainty}; quantifiability: ${assessment.quantifiability}; horizon: ${assessment.horizon.replace(/_/g, " ")}.`,
    `Affected steps selected: ${stepText(event.suggestedSteps)}.`,
    `Step impact scores: ${stepScoreText}.`,
    `DCF drivers: ${assessment.dcfDrivers.map((driver) => driver.replace(/_/g, " ")).join(", ")}.`,
    `Suggested handling: ${assessment.assessmentSummary}`,
  ].join("\n");
}

function buildDefaultStepScores(selectedSteps: number[]): Record<number, number> {
  return Object.keys(STEP_LABELS).reduce<Record<number, number>>((scores, step) => {
    const stepNumber = Number(step);
    scores[stepNumber] = selectedSteps.includes(stepNumber) ? 60 : 10;
    return scores;
  }, {});
}

function mergeStepImpactScores(events: Step0DetectedEvent[]): Record<number, number> {
  return events.reduce<Record<number, number>>((merged, event) => {
    const scores = buildStepImpactScores(event);
    Object.entries(scores).forEach(([step, score]) => {
      const stepNumber = Number(step);
      merged[stepNumber] = Math.max(merged[stepNumber] ?? 0, score);
    });
    return merged;
  }, buildDefaultStepScores([]));
}

function buildStepImpactScores(event: Step0DetectedEvent): Record<number, number> {
  const assessment = event.impactAssessment;
  const materialityBase: Record<Step0ImpactMateriality, number> = {
    high: 85,
    medium: 65,
    low: 35,
    unknown: 55,
  };
  const certaintyAdjustment: Record<Step0ImpactCertainty, number> = {
    high: 10,
    medium: 0,
    low: -10,
  };
  const quantifiabilityAdjustment: Record<Step0ImpactQuantifiability, number> = {
    known: 8,
    estimable: 0,
    unknown: -5,
  };
  const base = materialityBase[assessment.materiality] +
    certaintyAdjustment[assessment.certainty] +
    quantifiabilityAdjustment[assessment.quantifiability];

  return Object.keys(STEP_LABELS).reduce<Record<number, number>>((scores, step) => {
    const stepNumber = Number(step);
    if (!event.suggestedSteps.includes(stepNumber)) {
      scores[stepNumber] = getIndirectStepImpact(event, stepNumber);
      return scores;
    }
    scores[stepNumber] = clampScore(base + getStepSpecificImpactAdjustment(event, stepNumber));
    return scores;
  }, {});
}

function getIndirectStepImpact(event: Step0DetectedEvent, step: number): number {
  if (event.changeType === "new_10k") return 55;
  if (event.changeType === "market_data_change" && step < 7) return 10;
  if (event.changeType === "new_product_or_technology" && step === 1) return 20;
  if (event.changeType === "competitive_shift" && step === 7) return 25;
  return 10;
}

function getStepSpecificImpactAdjustment(event: Step0DetectedEvent, step: number): number {
  if (event.changeType === "new_10k" && step <= 2) return 10;
  if (event.changeType === "new_10q" && step === 2) return 12;
  if (event.changeType === "new_product_or_technology" && (step === 3 || step === 4)) return 8;
  if (event.changeType === "competitive_shift" && step === 3) return 12;
  if (event.changeType === "market_data_change" && (step === 7 || step === 8)) return 15;
  if (step === 6) return -5;
  return 0;
}

function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function stepImpactTone(score: number): string {
  if (score >= 75) return "bg-red-500/15 text-red-300";
  if (score >= 50) return "bg-amber-500/15 text-amber-300";
  if (score >= 25) return "bg-blue-500/15 text-blue-300";
  return "bg-zinc-800 text-zinc-400";
}

function stepImpactExplanation(step: number, score: number, selected: boolean): string {
  const action = selected ? "selected for rerun" : "not selected";
  if (score >= 75) return `High impact: this step is ${action} because the event can materially change its inputs.`;
  if (score >= 50) return `Medium impact: this step is ${action}; review before deciding whether to rerun.`;
  if (score >= 25) return `Low to moderate impact: this step is ${action}, usually optional unless your evidence is stronger.`;
  return `Minimal impact: this step is ${action} unless you manually decide the event changes this area.`;
}

function getSuggestedStepsForChange(
  changeType: Step0ChangeType,
  horizon: Step0ImpactHorizon,
  materiality: Step0ImpactMateriality,
  quantifiability: Step0ImpactQuantifiability,
): number[] {
  const ruleSteps = STEP0_RULES.find((rule) => rule.changeType === changeType)?.rerunSteps ?? [5, 6, 8];
  if (horizon === "unknown" || materiality === "unknown" || quantifiability === "unknown") {
    return Array.from(new Set([5, 6, 8, ...ruleSteps.filter((step) => step === 3 || step === 4 || step === 7)])).sort((a, b) => a - b);
  }
  return ruleSteps;
}

function getDcfDriversForChange(changeType: Step0ChangeType): Step0DcfImpactDriver[] {
  switch (changeType) {
    case "new_10k":
      return ["revenue_growth", "operating_margin", "business_mix", "net_debt", "wacc", "terminal_growth"];
    case "new_10q":
    case "earnings_release":
      return ["revenue_growth", "operating_margin", "net_debt"];
    case "mna_or_divestiture":
      return ["business_mix", "revenue_growth", "operating_margin", "net_debt", "wacc", "terminal_growth"];
    case "new_product_or_technology":
      return ["revenue_growth", "gross_margin", "operating_margin", "terminal_growth"];
    case "competitive_shift":
      return ["revenue_growth", "operating_margin", "moat_duration", "terminal_growth"];
    case "regulation_or_litigation":
      return ["revenue_growth", "operating_margin", "wacc", "terminal_growth"];
    case "management_change":
      return ["business_mix", "capex", "share_count", "net_debt", "terminal_growth"];
    case "market_data_change":
      return ["wacc", "share_count", "net_debt"];
    case "macro_change":
      return ["revenue_growth", "operating_margin", "wacc", "terminal_growth"];
    default:
      return ["revenue_growth", "operating_margin"];
  }
}

function DetectedEventCard({
  event,
  accepted,
  onToggle,
}: {
  event: Step0DetectedEvent;
  accepted: boolean;
  onToggle: () => void;
}) {
  const assessment = event.impactAssessment;
  const verificationScore = getEventVerificationScore(event);
  const actionTone =
    assessment.action === "auto_rerun"
      ? "bg-emerald-500/15 text-emerald-300"
      : assessment.action === "manual_parameters"
        ? "bg-amber-500/15 text-amber-300"
        : "bg-zinc-800 text-zinc-300";

  return (
    <button
      onClick={onToggle}
      className={`w-full rounded-lg border p-4 text-left transition-colors ${
        accepted
          ? "border-blue-500/60 bg-blue-950/25"
          : "border-zinc-800 bg-zinc-900/70 hover:border-zinc-700"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
            accepted ? "border-blue-400 bg-blue-500 text-white" : "border-zinc-600"
          }`}
        >
          {accepted ? "✓" : ""}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">{event.title}</span>
            <span className="rounded-full bg-zinc-950 px-2 py-0.5 text-xs font-medium uppercase text-zinc-400">
              {event.source}
            </span>
            {event.requiresReview && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                Review
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${actionTone}`}>
              {assessment.action === "auto_rerun"
                ? "Auto route"
                : assessment.action === "manual_parameters"
                  ? "Manual parameters"
                  : "Monitor"}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${verificationTone(verificationScore)}`}>
              Truth score {verificationScore}/100
            </span>
          </span>
          <span className="mt-1 block text-xs leading-5 text-zinc-500">{event.summary}</span>
          <span className="mt-2 block text-xs leading-5 text-zinc-400">{assessment.assessmentSummary}</span>
          <span className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-zinc-300">
              {event.changeType.replace(/_/g, " ")}
            </span>
            <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-zinc-300">
              Horizon: {assessment.horizon.replace(/_/g, " ")}
            </span>
            <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-zinc-300">
              Materiality: {assessment.materiality}
            </span>
            <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-zinc-300">
              Certainty: {assessment.certainty}
            </span>
            <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-zinc-300">
              Quantifiability: {assessment.quantifiability}
            </span>
            <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-blue-300">
              Rerun: {stepText(event.suggestedSteps)}
            </span>
          </span>
          <span className="mt-3 block text-xs font-semibold uppercase tracking-wider text-zinc-500">
            DCF drivers
          </span>
          <span className="mt-2 flex flex-wrap gap-2 text-xs">
            {assessment.dcfDrivers.map((driver) => (
              <span key={driver} className="rounded-full bg-zinc-950 px-2.5 py-1 text-zinc-300">
                {driver.replace(/_/g, " ")}
              </span>
            ))}
          </span>
          {assessment.parameterHints.length > 0 && (
            <span className="mt-3 block space-y-1.5">
              {assessment.parameterHints.slice(0, 2).map((hint) => (
                <span key={hint} className="block rounded-lg bg-zinc-950 px-3 py-2 text-xs leading-5 text-zinc-400">
                  {hint}
                </span>
              ))}
            </span>
          )}
          {event.url && (
            <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-300">
              Source <ExternalLink size={12} />
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

function PlanBox({ title, steps, tone }: { title: string; steps: number[]; tone: "emerald" | "blue" }) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-800/50 bg-emerald-950/10 text-emerald-300"
      : "border-blue-800/50 bg-blue-950/10 text-blue-300";

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase tracking-wider">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {steps.length === 0 ? (
          <span className="text-sm text-zinc-500">None</span>
        ) : (
          steps.map((step) => (
            <span key={step} className="rounded-full bg-zinc-950 px-2.5 py-1 text-xs font-medium text-zinc-200">
              Step {step}: {STEP_LABELS[step]}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
