/**
 * liquidity-assessment.ts
 *
 * Deterministic liquidity risk engine for bank / financial-mode companies.
 * No LLM involved — pure arithmetic on balance-sheet inputs.
 *
 * Three outputs consumed by Step 7:
 *   1. LiquidityMetrics   — baseline health indicators (LDR, uninsured %, LCR proxy)
 *   2. StressTestResult   — sequential drain logic at a given flight severity
 *   3. LiquidityRiskRating — LOW | MODERATE | HIGH | CRITICAL
 *
 * The rating translates to a Ke spread added on top of Rf + β×ERP in Step 7.
 */

// =============================================================================
// Input / Output types
// =============================================================================

export interface LiquidityInputs {
  // Balance-sheet items (USD millions, all required — use 0 if truly absent)
  cash_and_hqla_usd_m: number;
  total_loans_usd_m: number;
  htm_bonds_usd_m: number;
  unrealized_losses_htm_usd_m: number;
  retail_insured_deposits_usd_m: number;
  wholesale_uninsured_deposits_usd_m: number;
  total_equity_usd_m: number;

  // Early-warning signal toggles (qualitative)
  flag_cds_spreads_spiking: boolean;
  flag_fhlb_borrowing_elevated: boolean;
  flag_credit_rating_downgrade: boolean;
}

export type RagStatus = "green" | "yellow" | "red";

export interface MetricResult {
  value: number | null;
  label: string;
  status: RagStatus;
  note: string;
}

export interface LiquidityMetrics {
  totalDeposits: number;
  ldr: MetricResult;
  uninsuredConcentration: MetricResult;
  lcrProxy: MetricResult;
}

export interface StressTestResult {
  flightPct: number;
  fleeingDeposits: number;
  hqlaRemaining: number;
  htmSold: number;
  realizedLosses: number;
  equityRemaining: number;
  insolvent: boolean;
  shortfall: number;
}

export type LiquidityRiskRating = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface LiquidityAssessment {
  inputs: LiquidityInputs;
  metrics: LiquidityMetrics;
  stressAt30Pct: StressTestResult;
  rating: LiquidityRiskRating;
  keSpread: number;        // decimal — 0 | 0.005 | 0.010 | 0.020
  earlyWarnings: string[];
}

// =============================================================================
// Baseline metric calculators
// =============================================================================

function ragLdr(ldr: number): RagStatus {
  if (ldr > 0.95) return "red";
  if (ldr > 0.80) return "yellow";
  return "green";
}

function ragUninsured(pct: number): RagStatus {
  if (pct > 0.40) return "red";
  if (pct > 0.30) return "yellow";
  return "green";
}

function ragLcr(lcr: number): RagStatus {
  if (lcr < 1.00) return "red";
  if (lcr < 1.30) return "yellow";
  return "green";
}

export function calcLiquidityMetrics(inputs: LiquidityInputs): LiquidityMetrics {
  const { cash_and_hqla_usd_m, total_loans_usd_m, retail_insured_deposits_usd_m,
          wholesale_uninsured_deposits_usd_m } = inputs;

  const totalDeposits = retail_insured_deposits_usd_m + wholesale_uninsured_deposits_usd_m;

  // Loan-to-Deposit Ratio
  const ldrValue = totalDeposits > 0 ? total_loans_usd_m / totalDeposits : null;
  const ldr: MetricResult = ldrValue === null
    ? { value: null, label: "LDR", status: "yellow", note: "No deposit data — cannot compute." }
    : {
        value: ldrValue,
        label: "Loan-to-Deposit Ratio",
        status: ragLdr(ldrValue),
        note: ldrValue > 0.95
          ? "Above 95% — funding gap risk; bank is lending more than it holds in deposits."
          : ldrValue > 0.80
          ? "Elevated — approaching the threshold where wholesale funding becomes necessary."
          : "Healthy — deposit base comfortably covers the loan book.",
      };

  // Uninsured deposit concentration
  const uninsuredPct = totalDeposits > 0
    ? wholesale_uninsured_deposits_usd_m / totalDeposits
    : null;
  const uninsuredConcentration: MetricResult = uninsuredPct === null
    ? { value: null, label: "Uninsured Deposit %", status: "yellow", note: "No deposit data." }
    : {
        value: uninsuredPct,
        label: "Uninsured Deposit Concentration",
        status: ragUninsured(uninsuredPct),
        note: uninsuredPct > 0.40
          ? "Above 40% — high run risk. Institutional depositors can withdraw at short notice."
          : uninsuredPct > 0.30
          ? "Moderate — above 30% uninsured; monitor for deposit flight triggers."
          : "Low concentration — retail-dominated, FDIC backstop covers most deposits.",
      };

  // LCR proxy: HQLA / 30-day stress outflow
  // Basel III assumes 5% retail run-off + 20% wholesale run-off over 30 days
  const stressOutflow30d =
    retail_insured_deposits_usd_m * 0.05 + wholesale_uninsured_deposits_usd_m * 0.20;
  const lcrValue = stressOutflow30d > 0 ? cash_and_hqla_usd_m / stressOutflow30d : null;
  const lcrProxy: MetricResult = lcrValue === null
    ? { value: null, label: "LCR Proxy", status: "yellow", note: "Insufficient deposit data." }
    : {
        value: lcrValue,
        label: "LCR Proxy (HQLA / 30-day Stress Outflow)",
        status: ragLcr(lcrValue),
        note: lcrValue < 1.0
          ? "Below 100% — HQLA insufficient to cover 30-day stress outflows. Immediate liquidity risk."
          : lcrValue < 1.30
          ? "Adequate but thin — above minimum but limited buffer for unexpected outflows."
          : "Robust — HQLA covers stress outflows with meaningful headroom.",
      };

  return { totalDeposits, ldr, uninsuredConcentration, lcrProxy };
}

// =============================================================================
// Stress test (sequential drain logic)
// =============================================================================

export function runStressTest(inputs: LiquidityInputs, flightPct: number): StressTestResult {
  const { cash_and_hqla_usd_m, htm_bonds_usd_m, unrealized_losses_htm_usd_m,
          wholesale_uninsured_deposits_usd_m, total_equity_usd_m } = inputs;
  const clampedFlight = Math.max(0, Math.min(1, flightPct));

  // Step 1: Calculate fleeing deposits
  const fleeingDeposits = wholesale_uninsured_deposits_usd_m * clampedFlight;

  // Step 2: Drain HQLA first
  const hqlaRemaining = Math.max(0, cash_and_hqla_usd_m - fleeingDeposits);

  // Step 3: If HQLA exhausted, forced HTM sales required
  const shortfall = Math.max(0, fleeingDeposits - cash_and_hqla_usd_m);
  const htmSold = Math.min(htm_bonds_usd_m, shortfall);

  // Step 4: Proportionally realize HTM unrealized losses
  const lossRate = htm_bonds_usd_m > 0 ? unrealized_losses_htm_usd_m / htm_bonds_usd_m : 0;
  const realizedLosses = htmSold * lossRate;

  // Step 5: Capital destruction
  const equityRemaining = total_equity_usd_m - realizedLosses;

  return {
    flightPct: clampedFlight,
    fleeingDeposits: round2(fleeingDeposits),
    hqlaRemaining: round2(hqlaRemaining),
    htmSold: round2(htmSold),
    realizedLosses: round2(realizedLosses),
    equityRemaining: round2(equityRemaining),
    insolvent: equityRemaining < 0,
    shortfall: round2(shortfall),
  };
}

// =============================================================================
// Risk rating
// =============================================================================

export function rateLiquidity(
  metrics: LiquidityMetrics,
  stressAt30: StressTestResult,
  earlyWarnings: string[],
): LiquidityRiskRating {
  // CRITICAL: insolvent at 30% flight OR all three metrics Red
  if (stressAt30.insolvent) return "CRITICAL";
  const redCount = [metrics.ldr, metrics.uninsuredConcentration, metrics.lcrProxy]
    .filter((m) => m.status === "red").length;
  if (redCount >= 3) return "CRITICAL";

  // HIGH: LCR proxy red OR uninsured concentration red OR solvency wiped at 40%
  if (metrics.lcrProxy.status === "red") return "HIGH";
  if (metrics.uninsuredConcentration.status === "red") return "HIGH";
  if (earlyWarnings.length >= 2) return "HIGH";

  // MODERATE: any yellow metric OR a single early-warning flag
  const yellowCount = [metrics.ldr, metrics.uninsuredConcentration, metrics.lcrProxy]
    .filter((m) => m.status === "yellow").length;
  if (yellowCount >= 1 || earlyWarnings.length >= 1) return "MODERATE";

  return "LOW";
}

// =============================================================================
// Ke spread lookup
// =============================================================================

const KE_SPREADS: Record<LiquidityRiskRating, number> = {
  LOW:      0.000,
  MODERATE: 0.005,
  HIGH:     0.010,
  CRITICAL: 0.020,
};

export function calcLiquidityRiskSpread(rating: LiquidityRiskRating): number {
  return KE_SPREADS[rating];
}

// =============================================================================
// Early-warning builder
// =============================================================================

export function buildEarlyWarnings(inputs: LiquidityInputs): string[] {
  const warnings: string[] = [];
  if (inputs.flag_fhlb_borrowing_elevated) {
    warnings.push(
      "Warning: High reliance on FHLB / lender-of-last-resort borrowing indicates the core deposit franchise is deteriorating.",
    );
  }
  if (inputs.flag_cds_spreads_spiking) {
    warnings.push(
      "Warning: Spiking CDS spreads signal that institutional counterparties are pricing in severe default risk — interbank lending freeze risk.",
    );
  }
  if (inputs.flag_credit_rating_downgrade) {
    warnings.push(
      "Warning: A credit rating downgrade triggers collateral calls on derivative positions and may accelerate wholesale deposit outflows.",
    );
  }
  return warnings;
}

// =============================================================================
// Full assessment builder (combines all above)
// =============================================================================

export function buildLiquidityAssessment(inputs: LiquidityInputs): LiquidityAssessment {
  const metrics = calcLiquidityMetrics(inputs);
  const stressAt30Pct = runStressTest(inputs, 0.30);
  const earlyWarnings = buildEarlyWarnings(inputs);
  const rating = rateLiquidity(metrics, stressAt30Pct, earlyWarnings);
  const keSpread = calcLiquidityRiskSpread(rating);

  return { inputs, metrics, stressAt30Pct, rating, keSpread, earlyWarnings };
}

// =============================================================================
// Helpers
// =============================================================================

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Seed LiquidityInputs from the most recent annual bank extraction row.
 *  Falls back gracefully to 0 for any missing field. */
export function seedLiquidityInputsFromRow(row: {
  book_value_equity_usd_m?: number | null;
  total_loans_usd_m?: number | null;
  total_deposits_usd_m?: number | null;
  retail_insured_deposits_usd_m?: number | null;
  wholesale_uninsured_deposits_usd_m?: number | null;
  cash_and_hqla_usd_m?: number | null;
  htm_bonds_usd_m?: number | null;
  unrealized_losses_htm_usd_m?: number | null;
}): LiquidityInputs {
  return {
    cash_and_hqla_usd_m: row.cash_and_hqla_usd_m ?? 0,
    total_loans_usd_m: row.total_loans_usd_m ?? 0,
    htm_bonds_usd_m: row.htm_bonds_usd_m ?? 0,
    unrealized_losses_htm_usd_m: row.unrealized_losses_htm_usd_m ?? 0,
    retail_insured_deposits_usd_m: row.retail_insured_deposits_usd_m ?? 0,
    wholesale_uninsured_deposits_usd_m:
      row.wholesale_uninsured_deposits_usd_m ??
      (row.total_deposits_usd_m
        ? row.total_deposits_usd_m * 0.35  // default 35% wholesale if split not disclosed
        : 0),
    total_equity_usd_m: row.book_value_equity_usd_m ?? 0,
    flag_cds_spreads_spiking: false,
    flag_fhlb_borrowing_elevated: false,
    flag_credit_rating_downgrade: false,
  };
}
