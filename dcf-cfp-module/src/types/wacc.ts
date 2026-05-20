// =============================================================================
// Module 2: Discount Rate (WACC) — Type Definitions
// =============================================================================

import type { LiquidityAssessment } from "@/lib/liquidity-assessment";
export type { LiquidityAssessment };

/** Raw data returned by GET /api/wacc-data */
export interface WACCDataResponse {
  ticker: string;
  companyName: string;
  marketCap: number;               // USD
  currentPrice?: number;           // USD per share
  sharesOutstanding?: number;      // shares
  totalCash?: number;              // USD
  totalDebt: number;               // USD
  interestExpense: number;         // USD (annual)
  riskFreeRate: number;            // decimal (e.g., 0.0428 for 4.28%)
  companyDescription: string;      // For conglomerate detection
  industry?: string;               // Yahoo Finance industry string
  sector?: string;                 // Yahoo Finance sector string
  damodaranBeta?: number | null;   // Matched Damodaran unlevered beta
  damodaranIndustry?: string | null; // Matched Damodaran category name
  error?: string;
}

/** A single segment row for conglomerate / hybrid beta calculation */
export interface WACCSegmentRow {
  id: string;
  name: string;
  unleveredBeta: number;
  estimatedValue: number;          // USD millions
  workflowMode?: "bank" | "industrial"; // present in hybrid mode
}

/** Editable constants with defaults */
export interface WACCConstants {
  riskFreeRate: number;     // decimal (default from ^TNX or 0.0428)
  impliedERP: number;       // decimal (default 0.0451)
  marginalTaxRate: number;  // decimal (default 0.21)
}

/** Full WACC calculation breakdown (also used for Ke-only mode: wacc = Ke) */
export interface WACCCalculation {
  deRatio: number;            // D/E ratio (0 in financial/bank mode)
  unleveredBeta: number;
  releveredBeta: number;      // equals unleveredBeta when no re-levering
  costOfEquity: number;       // decimal
  preTaxCostOfDebt: number;   // decimal (0 in bank mode)
  afterTaxCostOfDebt: number; // decimal (0 in bank mode)
  weightEquity: number;       // 0–1 (1.0 in bank mode)
  weightDebt: number;         // 0–1 (0.0 in bank mode)
  wacc: number;               // decimal — equals costOfEquity in bank mode
}

/**
 * Business type toggle.
 *
 * "single"       → one unlevered beta → Hamada re-lever → WACC
 * "conglomerate" → value-weighted blended beta → Hamada re-lever → WACC
 * "financial"    → Ke-only (Damodaran bank beta used directly, no D/E re-levering)
 * "hybrid"       → Sum-of-Parts: bank segments discounted at Ke, industrial at WACC
 */
export type BusinessType = "single" | "conglomerate" | "financial" | "hybrid";

/** Global state for Step 7 */
export interface WACCState {
  fetchedData: WACCDataResponse | null;
  constants: WACCConstants;
  businessType: BusinessType;

  // ── Single / Financial modes ───────────────────────────────────────────────
  singleBeta: number;                     // unlevered beta (or equity beta in financial mode)

  // ── Conglomerate mode ──────────────────────────────────────────────────────
  segments: WACCSegmentRow[];             // per-segment betas + values (no workflowMode needed)

  // ── Hybrid / SOTP mode ────────────────────────────────────────────────────
  hybridSegments: WACCSegmentRow[];       // segments with workflowMode tags
  hybridBankBeta: number;                 // equity beta for ALL bank segments (Damodaran)
  bankKeCalculation: WACCCalculation | null;       // Ke result for bank group
  industrialWaccCalculation: WACCCalculation | null; // WACC result for industrial group

  // ── Shared ────────────────────────────────────────────────────────────────
  /** Primary calculation used by single/conglomerate/financial modes. */
  calculation: WACCCalculation | null;
  saved: boolean;

  // ── Valuation assumptions (persisted so dashboard survives reload) ─────────
  fcfMargin: number;               // single/conglomerate/financial FCF margin
  terminalGrowth: number;          // terminal growth rate (all modes)
  bankFcfMargin: number;           // SOTP bank FCFE margin
  industrialFcfMargin: number;     // SOTP industrial FCF margin

  // ── Data freshness ────────────────────────────────────────────────────────
  fetchedAt: string | null;        // ISO timestamp of last market data fetch

  // ── Liquidity assessment (financial / hybrid modes only) ─────────────────
  liquidityAssessment: LiquidityAssessment | null;
  liquidityRiskSpread: number;     // decimal added to Ke: 0 | 0.005 | 0.010 | 0.020
}
