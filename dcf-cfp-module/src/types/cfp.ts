// =============================================================================
// CFP Module — Master Type Definitions
// =============================================================================

// ---------------------------------------------------------------------------
// Global Settings (LLM Provider & API Keys)
// ---------------------------------------------------------------------------
export type LLMProvider = "claude" | "gemini";

export interface SettingsState {
  llmProvider: LLMProvider;
  claudeApiKey: string;
  geminiApiKey: string;
}

/** Identifies one fiscal quarter (e.g. Q1 2025). */
export interface FiscalQuarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
}

// ---------------------------------------------------------------------------
// Step 1 – Company Profile & Business Architecture Analysis
// ---------------------------------------------------------------------------
export interface CompanyProfile {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  currency: string;
  fiscalYearEnd: string; // e.g. "December"
  lastUpdated: string | null; // ISO date

  // Step 1 analysis output (populated after Anthropic call)
  rawAnalysisMarkdown: string; // full markdown from the LLM
  architectureJson: BusinessArchitecture | null; // parsed JSON block
}

/** Parsed from Part 3 of the LLM response. */
export interface BusinessArchitecture {
  architecture: SegmentArchitectureEntry[];
  sources: ArchitectureSource[];
}

export interface SegmentArchitectureEntry {
  segment: string;
  businessLines: BusinessLine[];
}

export interface BusinessLine {
  name: string;
  products: string[];
  customerType: string;
  dataSource: string;
}

export interface ArchitectureSource {
  document: string;
  section: string;
  page?: string;
}

/** Shape returned by POST /api/analyze-company */
export interface AnalyzeCompanyResponse {
  rawMarkdown: string;
  architectureJson: BusinessArchitecture | null;
  error?: string;
  requiresApiKey?: boolean;
}

// ---------------------------------------------------------------------------
// Step 2 – Historical Financials (Extracted & Human-Edited)
// ---------------------------------------------------------------------------

/** A single row extracted by the LLM from SEC filings. */
export interface HistoricalExtractionRow {
  id: string; // client-generated UUID for React keys & editing
  fiscalYear: number;
  quarter: string; // "Q1" | "Q2" | "Q3" | "Q4"
  segment: string;
  productCategory: string;
  productName: string;
  revenue: number; // USD millions
  yoyGrowth: number; // percentage — computed client-side
  operatingIncome: number; // USD millions
  notes: string;
}

/** Shape returned by POST /api/extract-history */
export interface ExtractHistoryResponse {
  rows: Omit<HistoricalExtractionRow, "id" | "yoyGrowth">[];
  error?: string;
  requiresApiKey?: boolean;
}

/** The master history kept in global context (confirmed rows across years). */
export interface HistoricalData {
  rows: HistoricalExtractionRow[];
  confirmedYears: number[]; // distinct years already appended (max 5)
}

// Kept for backward-compat — used by the export API
export interface QuarterlyFinancials {
  quarter: FiscalQuarter;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingIncome: number;
  netIncome: number;
  depreciation: number;
  capex: number;
  freeCashFlow: number;
  sharesOutstanding: number;
}

export interface AnnualSummary {
  year: number;
  revenue: number;
  freeCashFlow: number;
  fcfMargin: number; // percentage
}

// ---------------------------------------------------------------------------
// Step 3 – Competitive Landscape (Porter's Five Forces per Category)
// ---------------------------------------------------------------------------

export type ForceRating = "Low" | "Medium" | "High";

export interface ForceDetail {
  rating: ForceRating;
  justification: string;
}

export interface PorterForces {
  rivalry: ForceDetail;
  newEntrants: ForceDetail;
  suppliers: ForceDetail;
  buyers: ForceDetail;
  substitutes: ForceDetail;
}

export interface CategoryCompetitionEntry {
  category: string;
  primaryCompetitor: string;
  competitiveStatus: string;
  basisForPairing: string;
  forces: PorterForces;
}

/** Shape returned by POST /api/analyze-competition */
export interface AnalyzeCompetitionResponse {
  categories: CategoryCompetitionEntry[];
  error?: string;
  requiresApiKey?: boolean;
}

/** Shape returned by POST /api/revise-competition */
export interface ReviseCompetitionResponse {
  category: CategoryCompetitionEntry;
  error?: string;
  requiresApiKey?: boolean;
}

/** Global state for Step 3 */
export interface CompetitiveLandscape {
  categories: CategoryCompetitionEntry[];
  approved: boolean;
}

// ---------------------------------------------------------------------------
// Step 4 – Cross-Business Capability Penetration & Synergies
// ---------------------------------------------------------------------------

export type FinancialSignalType =
  | "Revenue Enablement"
  | "Margin Expansion"
  | "CAC Reduction"
  | "Cost Displacement"
  | "product-only";

export interface FinancialSignal {
  type: FinancialSignalType;
  evidence: string;
  status: "financially-material" | "product-only";
}

export interface FlywheelInfo {
  isFlywheel: boolean;
  loopDescription: string;
}

export interface CapabilityPenetrationPath {
  sourceBusiness: string;
  coreCapability: string;
  recipientBusiness: string;
  mechanism: string;
  productImpact: string;
  competitorConstraint: string;
  financialSignal: FinancialSignal;
  flywheel: FlywheelInfo;
  impactScore: number; // -5 to +5
}

/** Shape returned by POST /api/analyze-synergies */
export interface AnalyzeSynergiesResponse {
  paths: CapabilityPenetrationPath[];
  error?: string;
  requiresApiKey?: boolean;
}

/** Shape returned by POST /api/revise-synergies */
export interface ReviseSynergiesResponse {
  path: CapabilityPenetrationPath;
  error?: string;
  requiresApiKey?: boolean;
}

// ---------------------------------------------------------------------------
// Step 4B – Capital Allocation (sub-step inside Step 4)
// ---------------------------------------------------------------------------

export interface InvestmentMatrixEntry {
  pillar: string;
  objective: string;
  capitalIntensity: string;
  strategicLeverage: string;
  synergyLink: string;
  efficiencyScore: number; // -5 to +5
}

export interface CapitalCheckpoints {
  capexRunway: string;
  subsidiaryMargin: string;
  investmentEfficiency: string;
}

export interface CapitalAllocationData {
  investmentMatrix: InvestmentMatrixEntry[];
  checkpoints: CapitalCheckpoints;
}

/** Shape returned by POST /api/analyze-capital */
export interface AnalyzeCapitalResponse {
  data: CapitalAllocationData;
  error?: string;
  requiresApiKey?: boolean;
}

/** Shape returned by POST /api/revise-capital */
export interface ReviseCapitalResponse {
  entry: InvestmentMatrixEntry;
  error?: string;
  requiresApiKey?: boolean;
}

/** Global state for Step 4 (combined synergies + capital) */
export interface SynergiesAndDrivers {
  paths: CapabilityPenetrationPath[];
  synergiesApproved: boolean;
  capital: CapitalAllocationData | null;
  capitalApproved: boolean;
  recentNews: string;
}

// ---------------------------------------------------------------------------
// Step 5 – 20-Quarter Revenue Forecast (Quant Engine)
// ---------------------------------------------------------------------------

export interface ForecastQuarterPoint {
  year: number; // 1–5
  quarter: string; // "Q1"–"Q4"
  revenueM: number; // USD millions
  yoyGrowth: number; // percentage
  strategicDriver: string;
}

export interface ProductForecast {
  productName: string;
  categoryName: string;
  forecast: ForecastQuarterPoint[]; // exactly 20
}

export interface SegmentForecastBundle {
  segment: string;
  products: ProductForecast[];
}

/** Shape returned by POST /api/generate-forecast */
export interface GenerateForecastResponse {
  products: ProductForecast[];
  error?: string;
  requiresApiKey?: boolean;
}

/** Global state for Step 5 */
export interface ForecastState {
  segments: SegmentForecastBundle[];
  approved: boolean;
}

// Legacy — kept for Step 5 old placeholder compatibility
export interface CapitalAndMoats {
  debtToEquity: number | null;
  interestCoverageRatio: number | null;
  moatType: ("brand" | "network" | "cost" | "switching" | "intangible" | "none")[];
  moatDurability: "narrow" | "wide" | "none" | null;
  capitalAllocationSummary: string;
}

// ---------------------------------------------------------------------------
// Step 6 – Executive Summary & Consolidated Forecast
// ---------------------------------------------------------------------------

/** One row in the master aggregation table */
export interface AggregatedRow {
  segment: string;
  category: string;
  fy1: number;
  fy2: number;
  fy3: number;
  fy4: number;
  fy5: number;
  cagr: number; // percentage, ((FY5/FY1)^(1/4) - 1) * 100
  isSubtotal?: boolean;
  isTotal?: boolean;
}

/** Returned by the AI summary API */
export interface TopEngine {
  name: string;
  cagr: string;
  explanation: string;
}

export interface SummaryConclusion {
  revenueShift: string;
  ecosystemResilience: string;
}

export interface SummaryInsights {
  topEngines: TopEngine[];
  conclusion: SummaryConclusion;
}

/** Shape returned by POST /api/generate-summary */
export interface GenerateSummaryResponse {
  insights: SummaryInsights;
  error?: string;
  requiresApiKey?: boolean;
}

/** Global state for Step 6 */
export interface SummaryState {
  aggregatedRows: AggregatedRow[];
  insights: SummaryInsights | null;
}

// Legacy types kept for backward compatibility
export interface ProjectedQuarter {
  quarter: FiscalQuarter;
  projectedRevenue: number;
  projectedFCF: number;
  revenueGrowthYoY: number;
  fcfMargin: number;
  confidenceLevel: "low" | "medium" | "high";
}

export interface FiveYearOutlook {
  projectedQuarters: ProjectedQuarter[];
  annualFCFCurve: AnnualFCFPoint[];
  assumptions: string[];
  modelVersion: string;
}

export interface AnnualFCFPoint {
  year: number;
  projectedFCF: number;
  yoyGrowthRate: number;
}

// ---------------------------------------------------------------------------
// Aggregated CFP State
// ---------------------------------------------------------------------------
import type { WACCState } from "./wacc";

export interface CFPState {
  currentStep: number; // 1–7
  isLoading: boolean;
  error: string | null;

  // Module 1: Cash Flow Projector (Steps 1–6)
  profile: CompanyProfile;
  history: HistoricalData;
  competition: CompetitiveLandscape;
  synergies: SynergiesAndDrivers;
  forecast: ForecastState;
  summary: SummaryState;
  capitalAndMoats: CapitalAndMoats;
  outlook: FiveYearOutlook;

  // Module 2: Discount Rate (Step 7)
  wacc: WACCState;
}

// ---------------------------------------------------------------------------
// Context Action Types
// ---------------------------------------------------------------------------
export type CFPAction =
  | { type: "SET_STEP"; payload: number }
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "UPDATE_PROFILE"; payload: Partial<CompanyProfile> }
  | { type: "SET_PROFILE_ANALYSIS"; payload: { rawMarkdown: string; architectureJson: BusinessArchitecture | null } }
  | { type: "SET_HISTORY"; payload: HistoricalData }
  | { type: "APPEND_HISTORY_ROWS"; payload: { year: number; rows: HistoricalExtractionRow[] } }
  | { type: "CLEAR_HISTORY" }
  | { type: "SET_COMPETITION"; payload: CompetitiveLandscape }
  | { type: "CLEAR_COMPETITION" }
  | { type: "SET_SYNERGIES"; payload: SynergiesAndDrivers }
  | { type: "SET_SYNERGIES_PATHS"; payload: { paths: CapabilityPenetrationPath[] } }
  | { type: "SET_CAPITAL_DATA"; payload: { capital: CapitalAllocationData; recentNews: string } }
  | { type: "CLEAR_SYNERGIES" }
  | { type: "SET_FORECAST"; payload: ForecastState }
  | { type: "CLEAR_FORECAST" }
  | { type: "SET_SUMMARY"; payload: SummaryState }
  | { type: "SET_CAPITAL_MOATS"; payload: CapitalAndMoats }
  | { type: "SET_OUTLOOK"; payload: FiveYearOutlook }
  | { type: "SET_WACC"; payload: WACCState }
  | { type: "CLEAR_WACC" }
  | { type: "RESET" };

// ---------------------------------------------------------------------------
// API Export Contract (consumed by the Core DCF Tool)
// ---------------------------------------------------------------------------
export interface CFPExportPayload {
  ticker: string;
  companyName: string;
  currency: string;
  generatedAt: string; // ISO timestamp
  annualFCFCurve: AnnualFCFPoint[];
  projectedQuarters: ProjectedQuarter[];
  modelVersion: string;
}
