"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Database,
  FileSearch,
  History,
  RefreshCcw,
  RotateCcw,
} from "lucide-react";
import StepShell from "./StepShell";
import { useCFP } from "@/context/CFPContext";
import {
  STEP0_RULES,
  STEP_LABELS,
  analyzeRefreshPlan,
  findCachedRun,
  getCachedRuns,
  type CachedCompanyRun,
  type Step0ChangeType,
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

export default function Step0RefreshGate() {
  const { state, dispatch } = useCFP();
  const [lookup, setLookup] = useState(state.profile.ticker || state.profile.companyName || "");
  const [selectedChanges, setSelectedChanges] = useState<Step0ChangeType[]>([]);
  const [cachedRun, setCachedRun] = useState<CachedCompanyRun | null>(() =>
    findCachedRun(state.profile.ticker || state.profile.companyName),
  );
  const [checked, setChecked] = useState(false);
  const [cachedRuns, setCachedRuns] = useState<CachedCompanyRun[]>(() => getCachedRuns());

  const plan = useMemo(
    () => analyzeRefreshPlan(cachedRun, selectedChanges),
    [cachedRun, selectedChanges],
  );

  const toggleChange = (changeType: Step0ChangeType) => {
    setSelectedChanges((current) =>
      current.includes(changeType)
        ? current.filter((item) => item !== changeType)
        : [...current, changeType],
    );
  };

  const handleCheckDatabase = () => {
    setCachedRun(findCachedRun(lookup));
    setChecked(true);
    setCachedRuns(getCachedRuns());
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
              onClick={handleCheckDatabase}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
            >
              <Database size={16} />
              Check Database
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

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
                Change checklist
              </h3>
              <p className="mt-1 text-sm text-zinc-500">
                Leave all unchecked when there are no new filings, news, market, or macro updates.
              </p>
            </div>
            <button
              onClick={() => setSelectedChanges([])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <RotateCcw size={14} />
              Clear
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {STEP0_RULES.map((rule) => {
              const selected = selectedChanges.includes(rule.changeType);
              return (
                <button
                  key={rule.changeType}
                  onClick={() => toggleChange(rule.changeType)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    selected
                      ? "border-blue-500/60 bg-blue-950/30"
                      : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        selected ? "border-blue-400 bg-blue-500 text-white" : "border-zinc-600"
                      }`}
                    >
                      {selected ? "✓" : ""}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-zinc-100">{rule.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-zinc-500">{rule.description}</span>
                      <span className="mt-2 block text-xs font-mono text-blue-300">
                        Rerun: {stepText(rule.rerunSteps)}
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
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
