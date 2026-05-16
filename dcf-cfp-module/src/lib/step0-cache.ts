import type { CFPState } from "@/types/cfp";

export const STEP0_CACHE_KEY = "dcf-step0-run-cache-v1";

export type Step0ChangeType =
  | "new_10k"
  | "new_10q"
  | "earnings_release"
  | "mna_or_divestiture"
  | "new_product_or_technology"
  | "competitive_shift"
  | "regulation_or_litigation"
  | "management_change"
  | "market_data_change"
  | "macro_change";

export interface CachedRunSourceSnapshot {
  latest10KDate: string | null;
  latest10QDate: string | null;
  latestEarningsDate: string | null;
  latestNewsDate: string | null;
  marketDataAsOf: string | null;
  promptVersion: string;
}

export interface CachedCompanyRun {
  id: string;
  ticker: string;
  companyName: string;
  createdAt: string;
  updatedAt: string;
  completedThroughStep: number;
  sourceSnapshot: CachedRunSourceSnapshot;
  state: Partial<Omit<CFPState, "currentStep" | "isLoading" | "error">>;
}

export interface Step0Rule {
  changeType: Step0ChangeType;
  label: string;
  description: string;
  rerunSteps: number[];
  reason: string;
  conditionalNotes: string[];
}

export interface RefreshPlan {
  status: "no_history" | "reuse_cached" | "partial_rerun" | "full_rerun";
  cachedRun: CachedCompanyRun | null;
  selectedChanges: Step0ChangeType[];
  rerunSteps: number[];
  reusableSteps: number[];
  startStep: number | null;
  headline: string;
  reasons: string[];
  conditionalNotes: string[];
}

export type Step0ImpactHorizon = "next_quarter" | "one_to_two_years" | "long_term" | "unknown";
export type Step0ImpactMateriality = "low" | "medium" | "high" | "unknown";
export type Step0ImpactCertainty = "low" | "medium" | "high";

export interface Step0ManualOverride {
  enabled: boolean;
  eventSummary: string;
  horizon: Step0ImpactHorizon;
  materiality: Step0ImpactMateriality;
  certainty: Step0ImpactCertainty;
  manualSteps: number[];
}

export interface Step0DetectedEvent {
  id: string;
  source: "sec" | "earnings" | "news" | "market";
  changeType: Step0ChangeType;
  title: string;
  summary: string;
  detectedAt: string;
  eventDate: string | null;
  url: string | null;
  confidence: Step0ImpactCertainty;
  horizon: Step0ImpactHorizon;
  materiality: Step0ImpactMateriality;
  suggestedSteps: number[];
  requiresReview: boolean;
  rationale: string;
}

export interface Step0DetectResponse {
  ticker: string;
  companyName: string | null;
  detectedAt: string;
  events: Step0DetectedEvent[];
  warnings: string[];
  error?: string;
}

export const STEP_LABELS: Record<number, string> = {
  1: "Business Architecture",
  2: "Historical Financial Data",
  3: "Competitive Landscape",
  4: "Synergies, Flywheel & Capital Allocation",
  5: "Forecasting",
  6: "Executive Summary",
  7: "WACC",
  8: "DCF Valuation",
};

export const STEP0_RULES: Step0Rule[] = [
  {
    changeType: "new_10k",
    label: "New 10-K",
    description: "Annual filing updates segments, risks, history, capital structure, and long-term assumptions.",
    rerunSteps: [1, 2, 3, 4, 5, 6, 7, 8],
    reason: "A new 10-K can change the company architecture, reported financials, risk factors, competitive framing, capital allocation, WACC inputs, and valuation.",
    conditionalNotes: [],
  },
  {
    changeType: "new_10q",
    label: "New 10-Q",
    description: "Quarterly filing updates recent financials and may disclose structural changes.",
    rerunSteps: [2, 5, 6, 7, 8],
    reason: "A new 10-Q usually changes the historical data window and forecast base, while WACC and valuation may need fresh balance-sheet and market inputs.",
    conditionalNotes: [
      "Add Step 1 if the 10-Q discloses a new segment, material acquisition, divestiture, or business-line reclassification.",
      "Add Step 3 or Step 4 if management discusses a material competitive, product, or ecosystem shift.",
    ],
  },
  {
    changeType: "earnings_release",
    label: "Earnings / Call",
    description: "Latest quarter, guidance, and management commentary changed.",
    rerunSteps: [2, 5, 6, 8],
    reason: "Earnings updates refresh the recent operating base and forward assumptions without always changing the business architecture.",
    conditionalNotes: [
      "Add Step 1 if management announces a restructuring or new reporting architecture.",
      "Add Step 7 if debt, cash, buyback, rate exposure, or beta assumptions changed materially.",
    ],
  },
  {
    changeType: "mna_or_divestiture",
    label: "M&A / Divestiture",
    description: "Acquisition, divestiture, spin-off, or major asset sale.",
    rerunSteps: [1, 2, 3, 4, 5, 6, 7, 8],
    reason: "Major corporate actions can rewrite the business architecture, pro forma financials, strategic flywheel, capital allocation, and valuation base.",
    conditionalNotes: [],
  },
  {
    changeType: "new_product_or_technology",
    label: "New Product / Technology",
    description: "Important product launch, AI capability, platform shift, or technology disruption.",
    rerunSteps: [3, 4, 5, 6, 8],
    reason: "Product and technology changes primarily affect competition, synergy paths, growth curves, and valuation.",
    conditionalNotes: [
      "Add Step 1 if the new product becomes a separately analyzed business line.",
      "Add Step 2 only after financial contribution is disclosed.",
    ],
  },
  {
    changeType: "competitive_shift",
    label: "Competitive Shift",
    description: "New competitor, pricing pressure, market-share change, or industry structure change.",
    rerunSteps: [3, 4, 5, 6, 8],
    reason: "Competitive changes alter Porter forces, moat durability, forecast assumptions, and valuation.",
    conditionalNotes: [
      "Add Step 7 if the competitive risk is large enough to change the company risk premium.",
    ],
  },
  {
    changeType: "regulation_or_litigation",
    label: "Regulation / Litigation",
    description: "Material legal, antitrust, compliance, or regulatory development.",
    rerunSteps: [3, 5, 6, 7, 8],
    reason: "Regulatory and litigation events can reshape industry structure, margins, cash-flow risk, discount rate, and valuation.",
    conditionalNotes: [
      "Add Step 1 if regulation forces a business exit, separation, or reporting change.",
      "Add Step 4 if penalties, settlements, or restrictions affect capital allocation.",
    ],
  },
  {
    changeType: "management_change",
    label: "Management Change",
    description: "CEO, CFO, board, strategy, or capital-return policy changed.",
    rerunSteps: [4, 5, 6, 8],
    reason: "Leadership changes usually affect capital allocation, strategic priorities, forecast credibility, and valuation.",
    conditionalNotes: [
      "Add Step 1 if new leadership announces a restructuring.",
      "Add Step 7 if leverage, cash use, or shareholder-return policy materially changes.",
    ],
  },
  {
    changeType: "market_data_change",
    label: "Market Data",
    description: "Stock price, beta, debt yield, shares, cash, debt, or risk-free rate moved.",
    rerunSteps: [7, 8],
    reason: "Market-input changes do not require the LLM-heavy company analysis; WACC and valuation can be refreshed directly.",
    conditionalNotes: [],
  },
  {
    changeType: "macro_change",
    label: "Macro Change",
    description: "Rates, inflation, FX, consumer demand, or cycle assumptions changed.",
    rerunSteps: [5, 6, 7, 8],
    reason: "Macro changes typically affect forecast assumptions, discount rate, and valuation.",
    conditionalNotes: [
      "Add Step 3 if the macro shock changes industry structure or competitive intensity.",
    ],
  },
];

const ALL_ANALYSIS_STEPS = [1, 2, 3, 4, 5, 6, 7, 8];
const FILING_CHANGE_TYPES: Step0ChangeType[] = ["new_10k", "new_10q", "earnings_release"];
const FULL_RERUN_CHANGE_TYPES: Step0ChangeType[] = ["new_10k", "mna_or_divestiture"];

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

function hasStepOutput(state: CFPState): boolean {
  return Boolean(
    state.profile.rawAnalysisMarkdown ||
      state.profile.step1StructuredResult ||
      state.history.rows.length > 0 ||
      state.competition.categories.length > 0 ||
      state.synergies.paths.length > 0 ||
      state.forecast.segments.length > 0 ||
      state.summary.aggregatedRows.length > 0 ||
      state.wacc.saved ||
      state.wacc.calculation,
  );
}

function completedThroughStep(state: CFPState): number {
  if (state.wacc.calculation || state.wacc.saved) return 8;
  if (state.summary.aggregatedRows.length > 0 || state.summary.insights) return 6;
  if (state.forecast.segments.length > 0) return 5;
  if (state.synergies.paths.length > 0 || state.synergies.capital) return 4;
  if (state.competition.categories.length > 0) return 3;
  if (state.history.rows.length > 0) return 2;
  if (state.profile.rawAnalysisMarkdown || state.profile.step1StructuredResult) return 1;
  return 0;
}

function readRuns(): CachedCompanyRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STEP0_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRuns(runs: CachedCompanyRun[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STEP0_CACHE_KEY, JSON.stringify(runs));
}

export function getCachedRuns(): CachedCompanyRun[] {
  return readRuns().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function findCachedRun(tickerOrCompany: string): CachedCompanyRun | null {
  const lookup = normalizeTicker(tickerOrCompany);
  if (!lookup) return null;
  return (
    getCachedRuns().find(
      (run) => normalizeTicker(run.ticker) === lookup || normalizeTicker(run.companyName) === lookup,
    ) ?? null
  );
}

export function buildCachedRunFromState(state: CFPState): CachedCompanyRun | null {
  const ticker = normalizeTicker(state.profile.ticker || state.profile.companyName);
  const companyName = state.profile.companyName.trim();
  if (!ticker || !companyName || !hasStepOutput(state)) return null;

  const now = new Date().toISOString();
  const existing = findCachedRun(ticker);
  return {
    id: existing?.id ?? `${ticker}-${now}`,
    ticker,
    companyName,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    completedThroughStep: completedThroughStep(state),
    sourceSnapshot: existing?.sourceSnapshot ?? {
      latest10KDate: null,
      latest10QDate: null,
      latestEarningsDate: null,
      latestNewsDate: null,
      marketDataAsOf: state.profile.lastUpdated,
      promptVersion: "v5.5",
    },
    state: {
      profile: state.profile,
      history: state.history,
      competition: state.competition,
      synergies: state.synergies,
      forecast: state.forecast,
      summary: state.summary,
      capitalAndMoats: state.capitalAndMoats,
      outlook: state.outlook,
      wacc: state.wacc,
    },
  };
}

export function saveCachedRun(run: CachedCompanyRun): void {
  const runs = readRuns();
  const nextRuns = [run, ...runs.filter((item) => item.id !== run.id && normalizeTicker(item.ticker) !== normalizeTicker(run.ticker))];
  writeRuns(nextRuns.slice(0, 50));
}

export function analyzeRefreshPlan(
  cachedRun: CachedCompanyRun | null,
  selectedChanges: Step0ChangeType[],
  manualOverride?: Step0ManualOverride,
): RefreshPlan {
  if (!cachedRun) {
    return {
      status: "no_history",
      cachedRun: null,
      selectedChanges,
      rerunSteps: ALL_ANALYSIS_STEPS,
      reusableSteps: [],
      startStep: 1,
      headline: "No prior run found. Start a full run from Step 1.",
      reasons: ["This company does not yet have a saved database record in the local run cache."],
      conditionalNotes: [],
    };
  }

  if (selectedChanges.length === 0) {
    return {
      status: "reuse_cached",
      cachedRun,
      selectedChanges,
      rerunSteps: [],
      reusableSteps: ALL_ANALYSIS_STEPS,
      startStep: null,
      headline: "No meaningful change selected. Reuse the cached result.",
      reasons: ["No new filings, earnings, news, market, or macro changes were marked, so every previous step can be reused."],
      conditionalNotes: ["Optionally refresh only the current share price outside the LLM workflow if you want a quick market mark."],
    };
  }

  const matchedRules = STEP0_RULES.filter((rule) => selectedChanges.includes(rule.changeType));
  const ruleSteps = matchedRules.flatMap((rule) => rule.rerunSteps);
  const mandatorySteps = matchedRules
    .filter((rule) => FILING_CHANGE_TYPES.includes(rule.changeType) || FULL_RERUN_CHANGE_TYPES.includes(rule.changeType))
    .flatMap((rule) => rule.rerunSteps);
  const usesManualOverride = Boolean(manualOverride?.enabled && manualOverride.manualSteps.length > 0);
  const rerunSteps = Array.from(
    new Set(usesManualOverride ? [...mandatorySteps, ...(manualOverride?.manualSteps ?? [])] : ruleSteps),
  ).sort((a, b) => a - b);
  const reusableSteps = ALL_ANALYSIS_STEPS.filter((step) => !rerunSteps.includes(step));
  const status = rerunSteps.length === ALL_ANALYSIS_STEPS.length ? "full_rerun" : "partial_rerun";
  const manualNotes = buildManualOverrideNotes(manualOverride, mandatorySteps.length > 0);

  return {
    status,
    cachedRun,
    selectedChanges,
    rerunSteps,
    reusableSteps,
    startStep: rerunSteps[0] ?? null,
    headline:
      status === "full_rerun"
        ? "Material structural change detected. Run the full workflow."
        : `Reuse stable outputs and restart from Step ${rerunSteps[0]}.`,
    reasons: [
      ...matchedRules.map((rule) => rule.reason),
      ...manualNotes.reasons,
    ],
    conditionalNotes: [
      ...matchedRules.flatMap((rule) => rule.conditionalNotes),
      ...manualNotes.conditionalNotes,
    ],
  };
}

function buildManualOverrideNotes(
  manualOverride: Step0ManualOverride | undefined,
  hasMandatorySteps: boolean,
): { reasons: string[]; conditionalNotes: string[] } {
  if (!manualOverride?.enabled) return { reasons: [], conditionalNotes: [] };

  const horizonText: Record<Step0ImpactHorizon, string> = {
    next_quarter: "next-quarter only",
    one_to_two_years: "one to two years",
    long_term: "long-term",
    unknown: "unknown horizon",
  };
  const materialityText: Record<Step0ImpactMateriality, string> = {
    low: "low materiality",
    medium: "medium materiality",
    high: "high materiality",
    unknown: "unknown materiality",
  };

  const reasons = [
    `Manual impact override applied: ${horizonText[manualOverride.horizon]}, ${materialityText[manualOverride.materiality]}, ${manualOverride.certainty} certainty.`,
  ];

  if (manualOverride.eventSummary.trim()) {
    reasons.push(`Event note: ${manualOverride.eventSummary.trim()}`);
  }

  const conditionalNotes = [
    "If the event later proves durable or financially material, revisit Step 0 and expand the rerun steps.",
  ];

  if (hasMandatorySteps) {
    conditionalNotes.push("Mandatory filing-driven steps were kept even with manual override enabled.");
  }

  if (manualOverride.horizon === "unknown" || manualOverride.materiality === "unknown") {
    conditionalNotes.push("Unknown horizon or materiality should be treated as a monitoring item unless evidence supports a long-term forecast change.");
  }

  if (manualOverride.certainty === "low") {
    conditionalNotes.push("Low-certainty events should usually update scenarios or sensitivities before changing the base-case DCF.");
  }

  return { reasons, conditionalNotes };
}
