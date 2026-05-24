"use client";

import type { CompanySave } from "@/types/cfp";

export type RefreshEventType =
  | "new 10-K"
  | "new 10-Q"
  | "earnings/call"
  | "M&A/divestiture"
  | "new product/technology"
  | "competitive shift"
  | "regulation/litigation"
  | "management change"
  | "market data change"
  | "macro change";

export type ImpactHorizon = "next quarter" | "1-2 years" | "long-term" | "unknown";
export type Materiality = "low" | "medium" | "high" | "unknown";
export type Quantifiability = "known" | "estimable" | "unknown";
export type Certainty = "official" | "reported" | "rumor" | "unconfirmed" | "satirical" | "fictional" | "unknown";
export type ManualEventTypeSelection = RefreshEventType | "auto";

export interface RefreshEvent {
  id: string;
  title: string;
  detail: string;
  eventType: RefreshEventType;
  source: string;
  eventDate: string | null;
  confidence: number;
  impactHorizon: ImpactHorizon;
  materiality: Materiality;
  quantifiability: Quantifiability;
  dcfDriversAffected: string[];
  suggestedRerunSteps: number[];
  manualReviewRequired: boolean;
  truthScore: number;
  impactSize: number;
  certainty: Certainty;
  stepImpacts: StepImpact[];
}

export interface StepImpact {
  step: number;
  selected: boolean;
  score: number;
  explanation: string;
}

export interface ManualEventInput {
  title: string;
  detail: string;
  eventType: ManualEventTypeSelection;
  impactHorizon: ImpactHorizon;
  materiality: Materiality;
  certainty: Certainty;
  quantifiability: Quantifiability;
}

const COMPANY_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "plc",
  "holdings",
  "holding",
  "group",
  "class",
  "common",
  "stock",
]);

export const WORKFLOW_STEPS = [
  "Business Architecture",
  "Historical Financial Data",
  "Competitive Landscape",
  "Synergies & Drivers",
  "Forecast",
  "Executive Summary",
  "WACC",
  "DCF Valuation",
];

export function normalizeCompanyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((part) => part && !COMPANY_SUFFIXES.has(part))
    .join(" ")
    .trim();
}

export function findLatestMatchingSave(query: string, saves: CompanySave[]): CompanySave | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const tickerQuery = trimmed.toUpperCase();
  const normalizedQuery = normalizeCompanyName(trimmed);

  const matches = saves.filter((save) => {
    const ticker = save.ticker.toUpperCase();
    const company = normalizeCompanyName(save.companyName);
    const savedStateName = normalizeCompanyName(save.cfpState.profile.companyName);
    const structuredName = normalizeCompanyName(save.cfpState.profile.step1StructuredResult?.company_name ?? "");
    return (
      ticker === tickerQuery ||
      company === normalizedQuery ||
      savedStateName === normalizedQuery ||
      structuredName === normalizedQuery
    );
  });

  return matches.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())[0] ?? null;
}

export function completedThroughStep(save: CompanySave): number {
  const state = save.cfpState;
  if (save.snapshot) return 8;
  if (state.wacc.saved || state.wacc.calculation) return 7;
  if (state.summary.aggregatedRows.length || state.summary.insights) return 6;
  if (state.forecast.approved || (state.forecast.structuredResults?.length ?? 0) > 0) return 5;
  if (state.synergies.synergiesApproved || state.synergies.capitalApproved) return 4;
  if (state.competition.approved || state.competition.structuredResult) return 3;
  if (state.history.rows.length || (state.history.structuredResults?.length ?? 0) > 0) return 2;
  if (state.profile.step1StructuredResult || state.profile.companyName || state.profile.ticker) return 1;
  return 0;
}

export function filterEventsAfterSavedAt(events: RefreshEvent[], savedAt: string): RefreshEvent[] {
  const savedTime = new Date(savedAt).getTime();
  return events.filter((event) => {
    if (!event.eventDate) return false;
    return new Date(event.eventDate).getTime() > savedTime;
  });
}

export function routeStepsForEventType(eventType: RefreshEventType, detail = ""): number[] {
  const hasSegmentSignal = /(segment|business structure|business line|reporting structure|new business line)/i.test(detail);
  const hasCapitalSignal = /(debt|cash|buyback|repurchase|leverage|rate|capital structure|shareholder return)/i.test(detail);
  const hasFinancialDisclosure = /(revenue|sales|unit sales|bookings|arr|margin|gross margin|operating margin|eps|profit|cash flow|capex|guidance|financial results|financials disclosed|disclosed financials|10-q|10-k|earnings)/i.test(detail);

  switch (eventType) {
    case "new 10-K":
    case "M&A/divestiture":
      return [1, 2, 3, 4, 5, 6, 7, 8];
    case "new 10-Q":
      return hasSegmentSignal ? [1, 2, 5, 6, 7, 8] : [2, 5, 6, 7, 8];
    case "earnings/call":
      return hasCapitalSignal ? [2, 5, 6, 7, 8] : [2, 5, 6, 8];
    case "new product/technology":
      return [
        ...(hasSegmentSignal ? [1] : []),
        ...(hasFinancialDisclosure ? [2] : []),
        3,
        4,
        5,
        6,
        8,
      ];
    case "competitive shift":
      return [3, 4, 5, 6, 8];
    case "regulation/litigation":
      return hasSegmentSignal ? [1, 3, 5, 6, 7, 8] : [3, 5, 6, 7, 8];
    case "management change":
      return hasCapitalSignal ? [4, 5, 6, 7, 8] : [4, 5, 6, 8];
    case "market data change":
      return [7, 8];
    case "macro change":
      return [5, 6, 7, 8];
    default:
      return [];
  }
}

export function inferEventType(title: string, detail: string, fallback: RefreshEventType): RefreshEventType {
  const text = `${title} ${detail}`.toLowerCase();
  if (/(10-k|annual report|form 10k)/.test(text)) return "new 10-K";
  if (/(10-q|quarterly report|form 10q)/.test(text)) return "new 10-Q";

  const candidates: Array<{ type: RefreshEventType; score: number }> = [
    {
      type: "new product/technology",
      score:
        (/\b(new product|product launch|launches|launched|will launch|to launch|unveils|introduced|introduces|announces .*product|new model|new device|new service|new feature|smart device|new accessory)\b/.test(text) ? 5 : 0) +
        (/\b(product|technology|platform|patent|chip|semiconductor|device|software|hardware|service|feature|model|app|ai|artificial intelligence|sensor|subscription|ecosystem|accessory)\b/.test(text) ? 2 : 0),
    },
    {
      type: "earnings/call",
      score:
        (/(earnings call|earnings release|quarterly results|quarterly earnings|results call)/.test(text) ? 4 : 0) +
        (/(eps|revenue beat|revenue miss|guidance|raised outlook|lowered outlook)/.test(text) ? 2 : 0),
    },
    {
      type: "M&A/divestiture",
      score: (/(acquisition|merger|divest|spin[-\s]?off|deal|m&a|takeover|asset sale)/.test(text) ? 4 : 0),
    },
    {
      type: "competitive shift",
      score: (/(competitor|competition|market share|pricing pressure|rival|share loss|share gain)/.test(text) ? 3 : 0),
    },
    {
      type: "regulation/litigation",
      score: (/(regulation|regulator|lawsuit|litigation|antitrust|court|fine|ban|investigation)/.test(text) ? 3 : 0),
    },
    {
      type: "management change",
      score: (/(ceo|cfo|management|capital allocation|buyback|dividend|repurchase|leadership)/.test(text) ? 3 : 0),
    },
    {
      type: "market data change",
      score: (/\b(stock price|share price|yield|beta|wacc|market cap|rates|treasury)\b/.test(text) ? 3 : 0),
    },
    {
      type: "macro change",
      score: (/(inflation|fed|macro|recession|tariff|fx|interest rate|gdp)/.test(text) ? 3 : 0),
    },
  ];

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return best.score > 0 ? best.type : fallback;
}

export function estimateTruthScore(title: string, detail: string, certainty: Certainty): number {
  const text = `${title} ${detail}`.toLowerCase();
  if (certainty === "satirical" || certainty === "fictional") return 5;
  if (/(satire|parody|fictional|fiction|joke|not real|fake news|hoax)/.test(text)) return 5;
  if (/(allegedly|reportedly|rumor|speculation|unconfirmed|sources say|social media)/.test(text)) return 35;
  if (/(dreamsync|priority naps|personalized dreams|safari history|mutes snoring complaints|technology can decide for them|deserve another 15 minutes)/.test(text)) return 12;
  if (/(sec\.gov|10-k|10-q|8-k|official|press release|investor relations|company release)/.test(text)) return 92;
  if (/(reuters|bloomberg|wall street journal|wsj|cnbc|financial times|ft\.com|ap news)/.test(text)) return 70;
  if (certainty === "official") return 88;
  if (certainty === "reported") return 64;
  if (certainty === "rumor" || certainty === "unconfirmed") return 30;
  return 50;
}

function truthAdjustmentFactor(truthScore: number): number {
  if (truthScore >= 85) return 1;
  if (truthScore >= 55) return 0.85;
  if (truthScore >= 30) return 0.55;
  return 0.25;
}

function verificationLabel(truthScore: number): string {
  if (truthScore >= 85) return "high verification";
  if (truthScore >= 55) return "reported but not official";
  if (truthScore >= 30) return "unverified";
  return "likely fictional / satirical";
}

function materialityScore(materiality: Materiality): number {
  if (materiality === "high") return 85;
  if (materiality === "medium") return 55;
  if (materiality === "low") return 25;
  return 45;
}

function quantScore(quantifiability: Quantifiability): number {
  if (quantifiability === "known") return 85;
  if (quantifiability === "estimable") return 60;
  return 35;
}

function estimateMateriality(
  title: string,
  detail: string,
  eventType: RefreshEventType,
  certainty: Certainty,
): Materiality {
  const text = `${title} ${detail}`.toLowerCase();
  if (certainty === "satirical" || certainty === "fictional" || /(satire|parody|fictional|joke|not real)/.test(text)) return "low";
  if (/(bankruptcy|default|delisting|major acquisition|merger|antitrust|ban|sec investigation|ceo resigns)/.test(text)) return "high";
  if (/(revenue|sales|margin|eps|guidance|profit|cash flow|unit sales|market share|billion|million|%)/.test(text)) return "high";

  switch (eventType) {
    case "new 10-K":
    case "new 10-Q":
    case "M&A/divestiture":
    case "regulation/litigation":
      return "high";
    case "earnings/call":
    case "competitive shift":
    case "macro change":
    case "market data change":
      return "medium";
    case "new product/technology":
      if (/(new product|product launch|will launch|introduced|ecosystem|subscription|platform|ai|chip|device)/.test(text)) return "medium";
      return "low";
    case "management change":
      return /(capital allocation|buyback|dividend|leverage|debt|cash)/.test(text) ? "medium" : "low";
    default:
      return "unknown";
  }
}

function estimateQuantifiability(title: string, detail: string, eventType: RefreshEventType): Quantifiability {
  const text = `${title} ${detail}`.toLowerCase();
  if (/(10-k|10-q|earnings release|financial results|sec\.gov|revenue|sales|margin|eps|cash flow|capex|debt|cash|unit sales|guidance)/.test(text)) return "known";
  if (/(\$|usd|billion|million|%|bps|basis points|\d+\s?(units|users|subscribers|stores|countries|months|years))/.test(text)) return "estimable";

  switch (eventType) {
    case "market data change":
    case "macro change":
      return "known";
    case "new product/technology":
    case "competitive shift":
    case "regulation/litigation":
    case "management change":
      return "estimable";
    default:
      return "unknown";
  }
}

function driversForEventType(eventType: RefreshEventType): string[] {
  switch (eventType) {
    case "new 10-K":
    case "new 10-Q":
    case "earnings/call":
      return ["Revenue baseline", "Margins", "Working capital", "Capex", "FCF conversion"];
    case "M&A/divestiture":
      return ["Segment mix", "Revenue growth", "Margins", "Capex", "Debt/cash", "Terminal assumptions"];
    case "new product/technology":
      return ["TAM", "Revenue growth", "Margins", "Competitive advantage", "Reinvestment"];
    case "competitive shift":
      return ["Market share", "Pricing power", "Revenue growth", "Moat durability"];
    case "regulation/litigation":
      return ["Operating risk", "Margins", "Tax/legal costs", "Discount rate"];
    case "management change":
      return ["Capital allocation", "Reinvestment", "Buybacks/dividends", "Execution risk"];
    case "market data change":
      return ["Risk-free rate", "Beta", "Cost of equity", "Market cap"];
    case "macro change":
      return ["Demand growth", "Margins", "Risk-free rate", "ERP", "Terminal growth"];
    default:
      return ["Unknown"];
  }
}

function routeRelevanceScore(eventType: RefreshEventType, step: number): number {
  const productScores: Record<number, number> = { 1: 55, 2: 60, 3: 75, 4: 70, 5: 60, 6: 55, 7: 25, 8: 55 };
  const filingScores: Record<number, number> = { 1: 85, 2: 90, 3: 70, 4: 70, 5: 85, 6: 75, 7: 70, 8: 90 };
  const marketScores: Record<number, number> = { 7: 85, 8: 75 };
  const macroScores: Record<number, number> = { 5: 65, 6: 55, 7: 75, 8: 70 };
  const competitiveScores: Record<number, number> = { 3: 85, 4: 75, 5: 65, 6: 55, 8: 60 };
  const managementScores: Record<number, number> = { 4: 70, 5: 60, 6: 55, 7: 60, 8: 60 };

  switch (eventType) {
    case "new product/technology":
      return productScores[step] ?? 10;
    case "new 10-K":
    case "new 10-Q":
    case "earnings/call":
    case "M&A/divestiture":
      return filingScores[step] ?? 10;
    case "competitive shift":
    case "regulation/litigation":
      return competitiveScores[step] ?? 10;
    case "management change":
      return managementScores[step] ?? 10;
    case "market data change":
      return marketScores[step] ?? 10;
    case "macro change":
      return macroScores[step] ?? 10;
    default:
      return 10;
  }
}

export function buildStepImpacts(
  eventType: RefreshEventType,
  steps: number[],
  impactSize: number,
  truthScore = 100,
): StepImpact[] {
  return WORKFLOW_STEPS.map((name, index) => {
    const step = index + 1;
    const affectedByRouting = steps.includes(step);
    const routingScore = affectedByRouting ? routeRelevanceScore(eventType, step) : 10;
    const baseScore = affectedByRouting ? Math.max(impactSize, routingScore) : 10;
    const truthFactor = truthAdjustmentFactor(truthScore);
    const score = Math.round(baseScore * truthFactor);
    const selected = affectedByRouting && score >= 50;
    const thresholdNote = score >= 75
      ? "Score is 75+, so this is a strong rerun recommendation."
      : score >= 50
        ? "Score is 50+, so this step is selected for rerun by default."
        : "Score is below 50, so this step is not selected by default unless the analyst chooses to rerun it.";
    const scoreBasis = affectedByRouting
      ? `Score uses the higher of event impact (${impactSize}/100) and step relevance (${routingScore}/100), then applies truth/verification (${truthScore}/100, ${verificationLabel(truthScore)}).`
      : `Score is low because the refresh routing rules do not map this ${eventType} event to this step.`;
    return {
      step,
      selected,
      score,
      explanation: affectedByRouting
        ? `${name} is affected by this ${eventType} event under the refresh routing rules. ${scoreBasis} ${thresholdNote}`
        : `${name} is not directly required by the default routing for this event. ${scoreBasis} ${thresholdNote}`,
    };
  });
}

export function analyzeManualEvent(input: ManualEventInput): RefreshEvent {
  const inferredType = input.eventType === "auto"
    ? inferEventType(input.title, input.detail, "earnings/call")
    : input.eventType;
  const materiality = input.materiality === "unknown"
    ? estimateMateriality(input.title, input.detail, inferredType, input.certainty)
    : input.materiality;
  const quantifiability = input.quantifiability === "unknown"
    ? estimateQuantifiability(input.title, input.detail, inferredType)
    : input.quantifiability;
  const truthScore = estimateTruthScore(input.title, input.detail, input.certainty);
  const suggestedRerunSteps = routeStepsForEventType(inferredType, input.detail);
  const impactSize = Math.round((materialityScore(materiality) * 0.7) + (quantScore(quantifiability) * 0.3));
  const confidence = Math.round((truthScore * 0.7) + (impactSize * 0.3));

  return {
    id: `manual-${Date.now()}`,
    title: input.title.trim() || "Manual event",
    detail: input.detail.trim(),
    eventType: inferredType,
    source: "User-entered event",
    eventDate: new Date().toISOString(),
    confidence,
    impactHorizon: input.impactHorizon,
    materiality,
    quantifiability,
    dcfDriversAffected: driversForEventType(inferredType),
    suggestedRerunSteps,
    manualReviewRequired: truthScore < 85 || input.certainty !== "official",
    truthScore,
    impactSize,
    certainty: input.certainty,
    stepImpacts: buildStepImpacts(inferredType, suggestedRerunSteps, impactSize, truthScore),
  };
}

export function buildRoutingSummary(events: RefreshEvent[]) {
  const rerun = Array.from(
    new Set(events.flatMap((event) => event.stepImpacts.filter((impact) => impact.selected).map((impact) => impact.step))),
  ).sort((a, b) => a - b);

  const reuse = WORKFLOW_STEPS.map((_, index) => index + 1).filter((step) => !rerun.includes(step));
  const reasons = events
    .filter((event) => event.stepImpacts.some((impact) => impact.selected))
    .map((event) => `${event.title}: Steps ${event.stepImpacts.filter((impact) => impact.selected).map((impact) => impact.step).join(", ")}`);
  const conditionalChecks = events
    .filter((event) => event.manualReviewRequired || event.quantifiability === "unknown" || event.materiality === "unknown")
    .map((event) => `${event.title}: manual review needed for truth, materiality, or quantifiability.`);

  return { rerun, reuse, reasons, conditionalChecks };
}
