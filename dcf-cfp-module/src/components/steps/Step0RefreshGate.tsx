"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
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
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectedEvents, setDetectedEvents] = useState<Step0DetectedEvent[]>([]);
  const [acceptedEventIds, setAcceptedEventIds] = useState<string[]>([]);
  const [customTitle, setCustomTitle] = useState("");
  const [customSummary, setCustomSummary] = useState("");
  const [customChangeType, setCustomChangeType] = useState<Step0ChangeType>("new_product_or_technology");
  const [customHorizon, setCustomHorizon] = useState<Step0ImpactHorizon>("unknown");
  const [customMateriality, setCustomMateriality] = useState<Step0ImpactMateriality>("unknown");
  const [customCertainty, setCustomCertainty] = useState<Step0ImpactCertainty>("low");
  const [customQuantifiability, setCustomQuantifiability] = useState<Step0ImpactQuantifiability>("unknown");

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
  const cachedRuns = useMemo(() => {
    void cacheSnapshot;
    void cacheRefreshKey;
    return getCachedRuns();
  }, [cacheRefreshKey, cacheSnapshot]);
  const cachedRun = useMemo(() => {
    void cacheSnapshot;
    void cacheRefreshKey;
    return findCachedRun(checked ? checkedLookup : state.profile.ticker || state.profile.companyName);
  }, [
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

  const detectUpdates = async (tickerInput: string) => {
    const ticker = tickerInput.trim();
    if (!ticker) return;

    setIsDetecting(true);
    setDetectError(null);

    try {
      const response = await fetch(`/api/step0-detect?ticker=${encodeURIComponent(ticker)}`);
      const data = (await response.json()) as Step0DetectResponse;

      if (!response.ok) {
        throw new Error(data.error || `Detection failed (${response.status})`);
      }

      setDetectedEvents(data.events);
      setAcceptedEventIds(
        data.events
          .filter((event) => event.impactAssessment.action === "auto_rerun")
          .map((event) => event.id),
      );
      if (data.ticker) setLookup(data.ticker);
    } catch (err: unknown) {
      setDetectError(err instanceof Error ? err.message : "Detection failed.");
    } finally {
      setIsDetecting(false);
    }
  };

  const handleDetectUpdates = async () => {
    const ticker = lookup.trim() || state.profile.ticker || state.profile.companyName;
    if (!ticker.trim()) {
      setDetectError("Enter a ticker or company first.");
      return;
    }

    await detectUpdates(ticker);
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
    setDetectError(null);

    if (!matchedRun) return;
    await detectUpdates(currentLookup);
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
      changeType: customChangeType,
      horizon: customHorizon,
      materiality: customMateriality,
      certainty: customCertainty,
      quantifiability: customQuantifiability,
    });

    setDetectedEvents((current) => [event, ...current]);
    setAcceptedEventIds((current) => [...current, event.id]);
    setDetectError(null);

    if (eventNeedsManualParameters(event)) {
      setManualOverrideEnabled(true);
      setEventSummary(event.impactAssessment.assessmentSummary);
      setManualSteps(event.suggestedSteps);
      setImpactHorizon(event.impactAssessment.horizon);
      setImpactMateriality(event.impactAssessment.materiality);
      setImpactCertainty(event.impactAssessment.certainty);
    }

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
                Filing-driven events still keep their mandatory rerun steps.
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
              <p className="mb-2 text-sm font-medium text-zinc-300">Manual rerun steps</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(STEP_LABELS).map(([step, label]) => {
                  const stepNumber = Number(step);
                  const selected = manualSteps.includes(stepNumber);
                  return (
                    <button
                      key={step}
                      disabled={!manualOverrideEnabled}
                      onClick={() => toggleManualStep(stepNumber)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed ${
                        selected
                          ? "border-blue-500/60 bg-blue-950/30 text-blue-200"
                          : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      Step {step}: {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Default for uncertain product/news events is Step 5, Step 6, and Step 8: update assumptions,
                summarize uncertainty, and refresh valuation without rewriting the company architecture.
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

function buildCustomEvent({
  title,
  summary,
  changeType,
  horizon,
  materiality,
  certainty,
  quantifiability,
}: {
  title: string;
  summary: string;
  changeType: Step0ChangeType;
  horizon: Step0ImpactHorizon;
  materiality: Step0ImpactMateriality;
  certainty: Step0ImpactCertainty;
  quantifiability: Step0ImpactQuantifiability;
}): Step0DetectedEvent {
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
    summary,
    detectedAt: new Date().toISOString(),
    eventDate: null,
    url: null,
    confidence: certainty,
    horizon,
    materiality,
    suggestedSteps,
    requiresReview: action !== "auto_rerun",
    rationale: action === "auto_rerun"
      ? "User-provided event is marked as long-term, material, high-certainty, and quantifiable enough to route automatically."
      : "User-provided event needs parameter review because impact horizon, magnitude, certainty, or quantifiability is not fully established.",
    impactAssessment: {
      horizon,
      materiality,
      certainty,
      quantifiability,
      action,
      dcfDrivers: getDcfDriversForChange(changeType),
      parameterHints: action === "auto_rerun"
        ? ["Use the user-provided evidence as an explicit input when rerunning the affected steps."]
        : ["Set a scenario or manual assumption before changing the base-case DCF.", "If the event later becomes quantifiable, update Step 0 and rerun the affected steps."],
      assessmentSummary: `${summary} Impact is ${quantifiability}, ${certainty}-certainty, and ${horizon.replace(/_/g, " ")} with ${materiality} materiality.`,
    },
  };
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
