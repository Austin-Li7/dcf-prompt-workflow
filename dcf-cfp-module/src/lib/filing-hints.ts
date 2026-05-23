/**
 * filing-hints.ts
 *
 * Manages "filing hints" — a lightweight filing-structure map generated after
 * the first 10-K and first 10-Q are processed.
 *
 * Hints are injected into extract-chunk and reduce prompts for subsequent
 * filings to speed up extraction and improve accuracy, since the same company's
 * 10-Ks and 10-Qs follow a consistent internal structure year-over-year.
 *
 * Hints survive as session state and are embedded in the JSON save file
 * (via HistoricalData.filingHints) so future years can benefit from them.
 */

import type { FilingType } from "./filing-detector";
import type { HistoricalExtractionRow } from "@/types/cfp";

// =============================================================================
// Metric classification
// =============================================================================

/**
 * All 12 bank metrics extracted by the pipeline.
 * Used as keys in metric-location hint maps.
 */
export type BankMetricKey =
  | "nii_usd_m"
  | "non_interest_income_usd_m"
  | "provision_for_credit_losses_usd_m"
  | "net_income_usd_m"
  // Balance-sheet stocks (year-end snapshots)
  | "book_value_equity_usd_m"
  | "goodwill_usd_m"
  | "intangible_assets_usd_m"
  | "preferred_equity_usd_m"
  | "total_rwa_usd_m"
  | "total_assets_usd_m"
  // Liquidity balance-sheet stocks (primarily in annual footnotes)
  | "total_loans_usd_m"
  | "total_deposits_usd_m"
  | "retail_insured_deposits_usd_m"
  | "wholesale_uninsured_deposits_usd_m"
  | "cash_and_hqla_usd_m"
  | "htm_bonds_usd_m"
  | "unrealized_losses_htm_usd_m"
  // Annualised / point-in-time ratios
  | "tier1_capital_ratio_pct"
  | "cet1_ratio_pct"
  | "net_interest_margin_pct"
  | "efficiency_ratio_pct"
  | "return_on_avg_equity_pct";

/**
 * How each metric accumulates over time — determines Q4 derivation behaviour.
 *
 * - flow  : income-statement item (YTD sum). Q4 = Annual − Q1 − Q2 − Q3.
 * - stock : balance-sheet snapshot at period end. Q4 = 10-K year-end value.
 * - ratio : annualised / point-in-time percentage. Q4 = 10-K full-year value.
 */
export type MetricFlowType = "flow" | "stock" | "ratio";

export const BANK_METRIC_FLOW_TYPE: Record<BankMetricKey, MetricFlowType> = {
  // Income-statement flows (add up to annual)
  nii_usd_m: "flow",
  non_interest_income_usd_m: "flow",
  provision_for_credit_losses_usd_m: "flow",
  net_income_usd_m: "flow",
  // Balance-sheet stocks (year-end snapshot)
  book_value_equity_usd_m: "stock",
  goodwill_usd_m: "stock",
  intangible_assets_usd_m: "stock",
  preferred_equity_usd_m: "stock",
  total_rwa_usd_m: "stock",
  total_assets_usd_m: "stock",
  // Liquidity balance-sheet stocks (year-end snapshots; primarily in 10-K footnotes)
  total_loans_usd_m: "stock",
  total_deposits_usd_m: "stock",
  retail_insured_deposits_usd_m: "stock",
  wholesale_uninsured_deposits_usd_m: "stock",
  cash_and_hqla_usd_m: "stock",
  htm_bonds_usd_m: "stock",
  unrealized_losses_htm_usd_m: "stock",
  // Annualised / point-in-time ratios
  tier1_capital_ratio_pct: "ratio",
  cet1_ratio_pct: "ratio",
  net_interest_margin_pct: "ratio",
  efficiency_ratio_pct: "ratio",
  return_on_avg_equity_pct: "ratio",
};

export const ALL_BANK_METRICS = Object.keys(BANK_METRIC_FLOW_TYPE) as BankMetricKey[];

// =============================================================================
// Hints types
// =============================================================================

/** Location description for one metric inside a specific filing type. */
export interface MetricLocationHint {
  /** Primary section name, e.g. "Consolidated Statements of Income" */
  section: string;
  /** One or more label strings the filing uses for this metric */
  labelVariants: string[];
  /** Optional clarifying note, e.g. "reported in thousands — divide by 1000" */
  notes?: string;
}

/** All location hints for one filing type (either 10-K or 10-Q). */
export interface FilingTypeHints {
  /** Metric → location mapping; may be partial if AI couldn't locate all metrics. */
  metricLocations: Partial<Record<BankMetricKey, MetricLocationHint>>;
  /** General filing notes, e.g. "fiscal year ends December 31" */
  generalNotes: string;
  /** Key section/table header strings that anchor the main financial tables */
  keyTableKeywords: string[];
  /** Increment each time these hints are updated by a later file. */
  version: number;
  /** Filename of the most recent file that updated these hints. */
  lastUpdatedByFile: string;
}

/** Root hints object stored in HistoricalData.filingHints and the JSON save. */
export interface FilingHints {
  companyName: string;
  /** Bank-mode hints (NII-driven metrics). */
  tenK: FilingTypeHints | null;
  tenQ: FilingTypeHints | null;
  /** Industrial-mode hints (revenue/opIncome/grossProfit/capex/d&a/headcount). */
  industrialTenK: FilingTypeHints | null;
  industrialTenQ: FilingTypeHints | null;
}

// =============================================================================
// Prompt-injection helper
// =============================================================================

/**
 * Build the hint block that is prepended to extraction prompts.
 * Returns an empty string when hints are null (first file of that type).
 */
export function buildHintPromptSection(
  hints: FilingTypeHints | null,
  filingType: FilingType,
): string {
  if (!hints || Object.keys(hints.metricLocations).length === 0) return "";

  const lines: string[] = [];
  lines.push(`=== FILING STRUCTURE HINTS (v${hints.version} — from prior ${filingType} filing) ===`);

  if (hints.keyTableKeywords.length > 0) {
    lines.push(`Key tables: ${hints.keyTableKeywords.join(" | ")}`);
  }

  lines.push(`Metric locations:`);
  for (const [metric, hint] of Object.entries(hints.metricLocations)) {
    if (!hint) continue;
    const variants = hint.labelVariants.map((v) => `"${v}"`).join(" or ");
    const noteStr = hint.notes ? ` — ${hint.notes}` : "";
    lines.push(`  • ${metric}: section="${hint.section}", look for ${variants}${noteStr}`);
  }

  if (hints.generalNotes) {
    lines.push(`General: ${hints.generalNotes}`);
  }

  lines.push(`=== END HINTS ===`);
  return lines.join("\n");
}

// =============================================================================
// Q4 derivation
// =============================================================================

type MetricRecord = Partial<Record<BankMetricKey, number | null>>;

/**
 * Derive Q4 bank metrics from annual and quarterly values.
 *
 * - Flow metrics : Q4 = Annual − Q1 − Q2 − Q3  (null if any operand is null)
 * - Stock metrics: Q4 = Annual year-end value (the 10-K balance sheet snapshot)
 * - Ratio metrics: Q4 = Annual full-year value (already annualised)
 */
export function deriveQ4Metrics(
  annual: MetricRecord,
  q1: MetricRecord,
  q2: MetricRecord,
  q3: MetricRecord,
): { metrics: MetricRecord; derivedFields: BankMetricKey[]; missingFields: BankMetricKey[] } {
  const metrics: MetricRecord = {};
  const derivedFields: BankMetricKey[] = [];
  const missingFields: BankMetricKey[] = [];

  for (const key of ALL_BANK_METRICS) {
    const flowType = BANK_METRIC_FLOW_TYPE[key];
    const annualVal = annual[key] ?? null;

    if (flowType === "flow") {
      const q1v = q1[key] ?? null;
      const q2v = q2[key] ?? null;
      const q3v = q3[key] ?? null;

      if (annualVal !== null && q1v !== null && q2v !== null && q3v !== null) {
        // Round to 2 decimal places to avoid floating-point noise
        metrics[key] = Math.round((annualVal - q1v - q2v - q3v) * 100) / 100;
        derivedFields.push(key);
      } else {
        metrics[key] = null;
        missingFields.push(key);
      }
    } else {
      // stock / ratio: copy annual value
      metrics[key] = annualVal;
      if (annualVal !== null) {
        derivedFields.push(key);
      } else {
        missingFields.push(key);
      }
    }
  }

  return { metrics, derivedFields, missingFields };
}

/**
 * Build a synthetic Q4 HistoricalExtractionRow derived from annual and
 * quarterly source rows for the same segment.
 *
 * Returns null if both annualRow and the quarterly set have insufficient data
 * to produce any non-null Q4 value.
 */
export function buildQ4DerivedRow(
  annualRow: HistoricalExtractionRow,
  q1Row: HistoricalExtractionRow | null,
  q2Row: HistoricalExtractionRow | null,
  q3Row: HistoricalExtractionRow | null,
  idGenerator: () => string,
): HistoricalExtractionRow | null {
  const toMetricRecord = (row: HistoricalExtractionRow | null): MetricRecord => {
    if (!row) return {};
    return {
      nii_usd_m: row.nii_usd_m ?? null,
      non_interest_income_usd_m: row.non_interest_income_usd_m ?? null,
      provision_for_credit_losses_usd_m: row.provision_for_credit_losses_usd_m ?? null,
      net_income_usd_m: row.net_income_usd_m ?? null,
      book_value_equity_usd_m: row.book_value_equity_usd_m ?? null,
      goodwill_usd_m: row.goodwill_usd_m ?? null,
      intangible_assets_usd_m: row.intangible_assets_usd_m ?? null,
      preferred_equity_usd_m: row.preferred_equity_usd_m ?? null,
      total_rwa_usd_m: row.total_rwa_usd_m ?? null,
      total_assets_usd_m: row.total_assets_usd_m ?? null,
      total_loans_usd_m: row.total_loans_usd_m ?? null,
      total_deposits_usd_m: row.total_deposits_usd_m ?? null,
      retail_insured_deposits_usd_m: row.retail_insured_deposits_usd_m ?? null,
      wholesale_uninsured_deposits_usd_m: row.wholesale_uninsured_deposits_usd_m ?? null,
      cash_and_hqla_usd_m: row.cash_and_hqla_usd_m ?? null,
      htm_bonds_usd_m: row.htm_bonds_usd_m ?? null,
      unrealized_losses_htm_usd_m: row.unrealized_losses_htm_usd_m ?? null,
      tier1_capital_ratio_pct: row.tier1_capital_ratio_pct ?? null,
      cet1_ratio_pct: row.cet1_ratio_pct ?? null,
      net_interest_margin_pct: row.net_interest_margin_pct ?? null,
      efficiency_ratio_pct: row.efficiency_ratio_pct ?? null,
      return_on_avg_equity_pct: row.return_on_avg_equity_pct ?? null,
    };
  };

  const { metrics: q4Metrics, derivedFields: df } = deriveQ4Metrics(
    toMetricRecord(annualRow),
    toMetricRecord(q1Row),
    toMetricRecord(q2Row),
    toMetricRecord(q3Row),
  );

  // Skip row entirely if no metric was derivable
  if (df.length === 0) return null;

  const hasQ1 = q1Row !== null;
  const hasQ2 = q2Row !== null;
  const hasQ3 = q3Row !== null;
  const reviewNote = [
    hasQ1 && hasQ2 && hasQ3
      ? "Q4 derived: Annual − Q1 − Q2 − Q3 for flow metrics; year-end snapshot for balance-sheet/ratio metrics."
      : `Q4 partially derived (${[!hasQ1 && "Q1", !hasQ2 && "Q2", !hasQ3 && "Q3"].filter(Boolean).join(", ")} missing).`,
  ].join(" ");

  return {
    id: idGenerator(),
    fiscalYear: annualRow.fiscalYear,
    quarter: "Q4",
    segment: annualRow.segment,
    productCategory: annualRow.productCategory,
    productName: annualRow.productName,
    revenue: q4Metrics.nii_usd_m ?? null, // revenue ← NII for bank rows
    yoyGrowth: 0,
    operatingIncome: q4Metrics.net_income_usd_m ?? null,
    notes: reviewNote,
    reviewStatus: "Review Access Data",
    internalVerify: "No",
    sourceType: "Internal",
    sourceName: "Derived",
    reviewNote,
    workflow_mode: "bank",
    // Bank metrics
    nii_usd_m: q4Metrics.nii_usd_m ?? null,
    non_interest_income_usd_m: q4Metrics.non_interest_income_usd_m ?? null,
    provision_for_credit_losses_usd_m: q4Metrics.provision_for_credit_losses_usd_m ?? null,
    net_income_usd_m: q4Metrics.net_income_usd_m ?? null,
    book_value_equity_usd_m: q4Metrics.book_value_equity_usd_m ?? null,
    goodwill_usd_m: q4Metrics.goodwill_usd_m ?? null,
    intangible_assets_usd_m: q4Metrics.intangible_assets_usd_m ?? null,
    preferred_equity_usd_m: q4Metrics.preferred_equity_usd_m ?? null,
    total_rwa_usd_m: q4Metrics.total_rwa_usd_m ?? null,
    tier1_capital_ratio_pct: q4Metrics.tier1_capital_ratio_pct ?? null,
    cet1_ratio_pct: q4Metrics.cet1_ratio_pct ?? null,
    net_interest_margin_pct: q4Metrics.net_interest_margin_pct ?? null,
    efficiency_ratio_pct: q4Metrics.efficiency_ratio_pct ?? null,
    return_on_avg_equity_pct: q4Metrics.return_on_avg_equity_pct ?? null,
    total_assets_usd_m: q4Metrics.total_assets_usd_m ?? null,
    // Liquidity fields (stock — Q4 = 10-K year-end value)
    total_loans_usd_m: q4Metrics.total_loans_usd_m ?? null,
    total_deposits_usd_m: q4Metrics.total_deposits_usd_m ?? null,
    retail_insured_deposits_usd_m: q4Metrics.retail_insured_deposits_usd_m ?? null,
    wholesale_uninsured_deposits_usd_m: q4Metrics.wholesale_uninsured_deposits_usd_m ?? null,
    cash_and_hqla_usd_m: q4Metrics.cash_and_hqla_usd_m ?? null,
    htm_bonds_usd_m: q4Metrics.htm_bonds_usd_m ?? null,
    unrealized_losses_htm_usd_m: q4Metrics.unrealized_losses_htm_usd_m ?? null,
  };
}

// =============================================================================
// Industrial metric classification
// =============================================================================

export type IndustrialMetricKey =
  | "revenue_usd_m"
  | "operating_income_usd_m"
  | "gross_profit_usd_m"
  | "capex_usd_m"
  | "depreciation_amortization_usd_m"
  | "headcount";

export const INDUSTRIAL_METRIC_FLOW_TYPE: Record<IndustrialMetricKey, MetricFlowType> = {
  // Income-statement flows (sum to annual)
  revenue_usd_m: "flow",
  operating_income_usd_m: "flow",
  gross_profit_usd_m: "flow",
  capex_usd_m: "flow",
  depreciation_amortization_usd_m: "flow",
  // Operational KPI — year-end stock
  headcount: "stock",
};

export const ALL_INDUSTRIAL_METRICS = Object.keys(
  INDUSTRIAL_METRIC_FLOW_TYPE,
) as IndustrialMetricKey[];

type IndustrialMetricRecord = Partial<Record<IndustrialMetricKey, number | null>>;

/**
 * Derive Q4 industrial metrics from annual and quarterly values.
 *
 * - Flow (revenue/opIncome/grossProfit/capex/d&a): Q4 = Annual − Q1 − Q2 − Q3
 * - Stock (headcount): Q4 = Annual year-end value
 */
export function deriveIndustrialQ4Metrics(
  annual: IndustrialMetricRecord,
  q1: IndustrialMetricRecord,
  q2: IndustrialMetricRecord,
  q3: IndustrialMetricRecord,
): { metrics: IndustrialMetricRecord; derivedFields: IndustrialMetricKey[]; missingFields: IndustrialMetricKey[] } {
  const metrics: IndustrialMetricRecord = {};
  const derivedFields: IndustrialMetricKey[] = [];
  const missingFields: IndustrialMetricKey[] = [];

  for (const key of ALL_INDUSTRIAL_METRICS) {
    const flowType = INDUSTRIAL_METRIC_FLOW_TYPE[key];
    const annualVal = annual[key] ?? null;

    if (flowType === "flow") {
      const q1v = q1[key] ?? null;
      const q2v = q2[key] ?? null;
      const q3v = q3[key] ?? null;

      if (annualVal !== null && q1v !== null && q2v !== null && q3v !== null) {
        metrics[key] = Math.round((annualVal - q1v - q2v - q3v) * 100) / 100;
        derivedFields.push(key);
      } else {
        metrics[key] = null;
        missingFields.push(key);
      }
    } else {
      // stock: copy annual year-end value
      metrics[key] = annualVal;
      if (annualVal !== null) {
        derivedFields.push(key);
      } else {
        missingFields.push(key);
      }
    }
  }

  return { metrics, derivedFields, missingFields };
}

/**
 * Build a synthetic Q4 HistoricalExtractionRow for industrial mode.
 */
export function buildIndustrialQ4DerivedRow(
  annualRow: HistoricalExtractionRow,
  q1Row: HistoricalExtractionRow | null,
  q2Row: HistoricalExtractionRow | null,
  q3Row: HistoricalExtractionRow | null,
  idGenerator: () => string,
): HistoricalExtractionRow | null {
  const toRecord = (row: HistoricalExtractionRow | null): IndustrialMetricRecord => {
    if (!row) return {};
    return {
      revenue_usd_m: row.revenue ?? null,
      operating_income_usd_m: row.operatingIncome ?? null,
      gross_profit_usd_m: row.gross_profit_usd_m ?? null,
      capex_usd_m: row.capex_usd_m ?? null,
      depreciation_amortization_usd_m: row.depreciation_amortization_usd_m ?? null,
      headcount: row.headcount ?? null,
    };
  };

  const { metrics, derivedFields: df } = deriveIndustrialQ4Metrics(
    toRecord(annualRow),
    toRecord(q1Row),
    toRecord(q2Row),
    toRecord(q3Row),
  );

  if (df.length === 0) return null;

  const hasQ1 = q1Row !== null;
  const hasQ2 = q2Row !== null;
  const hasQ3 = q3Row !== null;
  const reviewNote =
    hasQ1 && hasQ2 && hasQ3
      ? "Q4 derived: Annual − Q1 − Q2 − Q3 for flow metrics; year-end snapshot for headcount."
      : `Q4 partially derived (${[!hasQ1 && "Q1", !hasQ2 && "Q2", !hasQ3 && "Q3"].filter(Boolean).join(", ")} missing).`;

  return {
    id: idGenerator(),
    fiscalYear: annualRow.fiscalYear,
    quarter: "Q4",
    segment: annualRow.segment,
    productCategory: annualRow.productCategory,
    productName: annualRow.productName,
    revenue: metrics.revenue_usd_m ?? null,
    yoyGrowth: 0,
    operatingIncome: metrics.operating_income_usd_m ?? null,
    notes: reviewNote,
    reviewStatus: "Review Access Data",
    internalVerify: "No",
    sourceType: "Internal",
    sourceName: "Derived",
    reviewNote,
    workflow_mode: "industrial",
    gross_profit_usd_m: metrics.gross_profit_usd_m ?? null,
    capex_usd_m: metrics.capex_usd_m ?? null,
    depreciation_amortization_usd_m: metrics.depreciation_amortization_usd_m ?? null,
    headcount: metrics.headcount ?? null,
  };
}

/**
 * Given all industrial rows in staging, resolve Q4 data and return a clean row set.
 *
 * Priority rule: 10-K annual row beats Q4 10-Q row for the same year+segment.
 * - If both exist → keep the 10-K row, drop the Q4 10-Q row (no derivation needed).
 * - If only 10-K annual row exists → derive Q4 = Annual − Q1 − Q2 − Q3.
 * - If only Q4 10-Q row exists → use it directly (no derivation).
 */
export function injectIndustrialDerivedQ4Rows(
  rows: HistoricalExtractionRow[],
  idGenerator: () => string,
): HistoricalExtractionRow[] {
  // Separate index for 10-K annual rows and all other quarterly rows
  const annualIdx = new Map<string, HistoricalExtractionRow>(); // key: year|segment
  const quarterIdx = new Map<string, HistoricalExtractionRow>(); // key: year|segment|quarter

  for (const row of rows) {
    if (row.workflow_mode !== "industrial") continue;
    if (row.quarter === "Q4" && row.isAnnualFiling) {
      annualIdx.set(`${row.fiscalYear}|${row.segment}`, row);
    } else {
      quarterIdx.set(`${row.fiscalYear}|${row.segment}|${row.quarter}`, row);
    }
  }

  // Year+segment pairs where the 10-K annual Q4 row supersedes the Q4 10-Q row
  const annualSupersedes = new Set<string>();
  for (const [annualKey] of annualIdx) {
    const [yearStr, segment] = annualKey.split("|");
    const year = Number(yearStr);
    if (quarterIdx.has(`${year}|${segment}|Q4`)) {
      annualSupersedes.add(`${year}|${segment}`);
    }
  }

  const extra: HistoricalExtractionRow[] = [];

  for (const [annualKey, annualRow] of annualIdx) {
    const [yearStr, segment] = annualKey.split("|");
    const year = Number(yearStr);

    // If 10-K supersedes Q4 10-Q, skip derivation (10-K row is already in the output)
    if (annualSupersedes.has(`${year}|${segment}`)) continue;
    if (annualRow.sourceName === "Derived") continue;

    const hasQ1 = quarterIdx.has(`${year}|${segment}|Q1`);
    const hasQ2 = quarterIdx.has(`${year}|${segment}|Q2`);
    const hasQ3 = quarterIdx.has(`${year}|${segment}|Q3`);
    if (!hasQ1 && !hasQ2 && !hasQ3) continue;

    const q1Row = quarterIdx.get(`${year}|${segment}|Q1`) ?? null;
    const q2Row = quarterIdx.get(`${year}|${segment}|Q2`) ?? null;
    const q3Row = quarterIdx.get(`${year}|${segment}|Q3`) ?? null;

    const q4 = buildIndustrialQ4DerivedRow(annualRow, q1Row, q2Row, q3Row, idGenerator);
    if (q4) extra.push(q4);
  }

  // Drop Q4 10-Q rows that are superseded by a 10-K annual row
  const filteredRows = rows.filter((row) => {
    if (row.workflow_mode !== "industrial") return true;
    if (row.quarter === "Q4" && !row.isAnnualFiling) {
      return !annualSupersedes.has(`${row.fiscalYear}|${row.segment}`);
    }
    return true;
  });

  return [...filteredRows, ...extra];
}

/**
 * Given all the bank rows in staging (one per year-period-segment),
 * add synthetic Q4 rows for every year+segment that has an annual row
 * but no explicit Q4 row.
 */
/**
 * Priority rule: 10-K annual row beats Q4 10-Q row for the same year+segment.
 * - If both exist → keep 10-K row, drop Q4 10-Q row (no derivation needed).
 * - If only 10-K annual row exists → derive Q4 = Annual − Q1 − Q2 − Q3.
 * - If only Q4 10-Q row exists → use it directly.
 */
export function injectDerivedQ4Rows(
  rows: HistoricalExtractionRow[],
  idGenerator: () => string,
): HistoricalExtractionRow[] {
  const annualIdx = new Map<string, HistoricalExtractionRow>(); // key: year|segment
  const quarterIdx = new Map<string, HistoricalExtractionRow>(); // key: year|segment|quarter

  for (const row of rows) {
    if (row.workflow_mode !== "bank") continue;
    if (row.quarter === "Q4" && row.isAnnualFiling) {
      annualIdx.set(`${row.fiscalYear}|${row.segment}`, row);
    } else {
      quarterIdx.set(`${row.fiscalYear}|${row.segment}|${row.quarter}`, row);
    }
  }

  // Year+segment pairs where the 10-K annual Q4 row supersedes the Q4 10-Q row
  const annualSupersedes = new Set<string>();
  for (const [annualKey] of annualIdx) {
    const [yearStr, segment] = annualKey.split("|");
    const year = Number(yearStr);
    if (quarterIdx.has(`${year}|${segment}|Q4`)) {
      annualSupersedes.add(`${year}|${segment}`);
    }
  }

  const extra: HistoricalExtractionRow[] = [];

  for (const [annualKey, annualRow] of annualIdx) {
    const [yearStr, segment] = annualKey.split("|");
    const year = Number(yearStr);

    if (annualSupersedes.has(`${year}|${segment}`)) continue;
    if (annualRow.sourceName === "Derived") continue;

    const hasQ1 = quarterIdx.has(`${year}|${segment}|Q1`);
    const hasQ2 = quarterIdx.has(`${year}|${segment}|Q2`);
    const hasQ3 = quarterIdx.has(`${year}|${segment}|Q3`);
    if (!hasQ1 && !hasQ2 && !hasQ3) continue;

    const q1Row = quarterIdx.get(`${year}|${segment}|Q1`) ?? null;
    const q2Row = quarterIdx.get(`${year}|${segment}|Q2`) ?? null;
    const q3Row = quarterIdx.get(`${year}|${segment}|Q3`) ?? null;

    const q4 = buildQ4DerivedRow(annualRow, q1Row, q2Row, q3Row, idGenerator);
    if (q4) extra.push(q4);
  }

  // Drop Q4 10-Q rows superseded by the 10-K annual row
  const filteredRows = rows.filter((row) => {
    if (row.workflow_mode !== "bank") return true;
    if (row.quarter === "Q4" && !row.isAnnualFiling) {
      return !annualSupersedes.has(`${row.fiscalYear}|${row.segment}`);
    }
    return true;
  });

  return [...filteredRows, ...extra];
}
