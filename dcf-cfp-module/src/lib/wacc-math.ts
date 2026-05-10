/**
 * Pure mathematical functions for WACC calculation.
 * Damodaran's Re-Levered Beta (Hamada Equation) methodology.
 *
 * All rates stored as decimals internally (e.g., 4.28% → 0.0428).
 */

import type { WACCSegmentRow, WACCCalculation, WACCConstants } from "@/types/wacc";

// =============================================================================
// Individual calculation steps
// =============================================================================

/** D/E Ratio = Total Debt / Market Cap */
export function calcDERatio(totalDebt: number, marketCap: number): number {
  if (marketCap <= 0) return 0;
  return totalDebt / marketCap;
}

/** Hamada Equation: Re-levered Beta = Unlevered Beta × [1 + (1 - Tax Rate) × D/E] */
export function calcReleveredBeta(
  unleveredBeta: number,
  taxRate: number,
  deRatio: number,
): number {
  return unleveredBeta * (1 + (1 - taxRate) * deRatio);
}

/** Cost of Equity = Risk-Free Rate + (Re-levered Beta × ERP) */
export function calcCostOfEquity(
  riskFreeRate: number,
  releveredBeta: number,
  erp: number,
): number {
  return riskFreeRate + releveredBeta * erp;
}

/** Pre-Tax Cost of Debt = Interest Expense / Total Debt (fallback: riskFreeRate) */
export function calcPreTaxCostOfDebt(
  interestExpense: number,
  totalDebt: number,
  riskFreeRate: number,
): number {
  if (totalDebt <= 0) return riskFreeRate;
  return Math.abs(interestExpense) / totalDebt;
}

/** After-Tax Cost of Debt = Pre-Tax Cost of Debt × (1 - Tax Rate) */
export function calcAfterTaxCostOfDebt(
  preTaxCostOfDebt: number,
  taxRate: number,
): number {
  return preTaxCostOfDebt * (1 - taxRate);
}

/** WACC = (We × Ke) + (Wd × Kd_after_tax) */
export function calcWACC(
  weightEquity: number,
  costOfEquity: number,
  weightDebt: number,
  afterTaxCostOfDebt: number,
): number {
  return weightEquity * costOfEquity + weightDebt * afterTaxCostOfDebt;
}

// =============================================================================
// Weighted average beta for conglomerates
// =============================================================================

/** Value-weighted average of unlevered betas across segments. */
export function calcWeightedBeta(segments: WACCSegmentRow[]): number {
  const validSegments = segments.filter((s) => s.estimatedValue > 0);
  if (validSegments.length === 0) return 1.0;

  const totalValue = validSegments.reduce((sum, s) => sum + s.estimatedValue, 0);
  if (totalValue <= 0) return 1.0;

  return validSegments.reduce(
    (sum, s) => sum + s.unleveredBeta * (s.estimatedValue / totalValue),
    0,
  );
}

// =============================================================================
// Conglomerate detection
// =============================================================================

const CONGLOMERATE_KEYWORDS = [
  "segments",
  "conglomerate",
  "diversified",
  "diverse operations",
  "multiple industries",
  "operating segments",
  "business segments",
  "reportable segments",
  "subsidiaries",
];

/** Heuristic: scan company description for conglomerate-like language. */
export function detectConglomerate(description: string): {
  isConglomerate: boolean;
  reason: string;
} {
  if (!description) return { isConglomerate: false, reason: "" };
  const lower = description.toLowerCase();

  for (const kw of CONGLOMERATE_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        isConglomerate: true,
        reason: `Profile mentions "${kw}" — may be a conglomerate.`,
      };
    }
  }

  return { isConglomerate: false, reason: "" };
}

// =============================================================================
// Financial company detection
// =============================================================================

const FINANCIAL_INDUSTRY_KEYWORDS = [
  "bank",
  "banking",
  "insurance",
  "credit services",
  "capital markets",
  "asset management",
  "mortgage",
  "financial conglomerate",
  "financial data",
];

/**
 * Returns true if the company industry/description indicates it is a financial
 * institution for which traditional WACC is inappropriate.
 *
 * Banks and insurers manage leverage as part of their core business model —
 * deposits, policy reserves, and short-term borrowings are all funding tools,
 * not "debt" in the Modigliani-Miller sense. Applying a Hamada re-levering
 * equation to a bank's D/E ratio would overstate its cost of capital.
 * Instead, use Ke-only mode and discount equity cash flows directly.
 */
export function detectFinancialCompany(
  industry?: string,
  companyDescription?: string,
): { isFinancial: boolean; reason: string } {
  const text = ((industry ?? "") + " " + (companyDescription ?? "")).toLowerCase();

  for (const kw of FINANCIAL_INDUSTRY_KEYWORDS) {
    if (text.includes(kw)) {
      return {
        isFinancial: true,
        reason:
          `Industry profile matches "${kw}" — traditional WACC overstates the ` +
          `cost of capital because deposits/reserves ≠ conventional debt. ` +
          `Ke-only mode (equity DCF) is recommended.`,
      };
    }
  }

  return { isFinancial: false, reason: "" };
}

// =============================================================================
// Full orchestration — standard WACC (single / conglomerate)
// =============================================================================

export interface FullWACCInputs {
  marketCap: number;
  totalDebt: number;
  interestExpense: number;
  unleveredBeta: number; // already weighted if conglomerate
  constants: WACCConstants;
}

/** Run the complete WACC calculation pipeline. Returns null if inputs invalid. */
export function fullWACCCalculation(inputs: FullWACCInputs): WACCCalculation | null {
  const { marketCap, totalDebt, interestExpense, unleveredBeta, constants } = inputs;
  const { riskFreeRate, impliedERP, marginalTaxRate } = constants;

  if (marketCap <= 0) return null;

  const totalCapital = marketCap + totalDebt;
  const deRatio = calcDERatio(totalDebt, marketCap);
  const releveredBeta = calcReleveredBeta(unleveredBeta, marginalTaxRate, deRatio);
  const costOfEquity = calcCostOfEquity(riskFreeRate, releveredBeta, impliedERP);
  const preTaxCostOfDebt = calcPreTaxCostOfDebt(interestExpense, totalDebt, riskFreeRate);
  const afterTaxCostOfDebt = calcAfterTaxCostOfDebt(preTaxCostOfDebt, marginalTaxRate);
  const weightEquity = marketCap / totalCapital;
  const weightDebt = totalDebt / totalCapital;
  const wacc = calcWACC(weightEquity, costOfEquity, weightDebt, afterTaxCostOfDebt);

  return {
    deRatio,
    unleveredBeta,
    releveredBeta,
    costOfEquity,
    preTaxCostOfDebt,
    afterTaxCostOfDebt,
    weightEquity,
    weightDebt,
    wacc,
  };
}

// =============================================================================
// Financial / Bank — Ke-only (equity DCF discount rate)
// =============================================================================

export interface FullBankKeInputs {
  /** Damodaran unlevered beta for the financial-industry category.
   *  Used directly as the equity beta — no Hamada re-levering applied. */
  equityBeta: number;
  constants: WACCConstants;
}

/**
 * Bank / Financial institution Ke-only calculation.
 *
 * Why no re-levering:
 *   For banks, deposits and short-term borrowings are intertwined with
 *   operations and priced at market rates. Separating "debt" from "equity" the
 *   way Hamada requires is not meaningful — financial firms leverage is their
 *   business model, not a financing choice. Damodaran's own published bank betas
 *   already reflect this: they are the equity beta, not the asset beta.
 *
 * The result populates WACCCalculation with:
 *   wacc = costOfEquity, weightEquity = 1, weightDebt = 0
 * so the rest of the DCF pipeline (Step 8) can consume it unchanged.
 */
export function fullBankKeCalculation(inputs: FullBankKeInputs): WACCCalculation {
  const { equityBeta, constants } = inputs;
  const { riskFreeRate, impliedERP } = constants;

  const costOfEquity = riskFreeRate + equityBeta * impliedERP;

  return {
    deRatio: 0,
    unleveredBeta: equityBeta,
    releveredBeta: equityBeta,  // no re-levering
    costOfEquity,
    preTaxCostOfDebt: 0,
    afterTaxCostOfDebt: 0,
    weightEquity: 1,
    weightDebt: 0,
    wacc: costOfEquity,         // discount rate = Ke for equity DCF
  };
}
