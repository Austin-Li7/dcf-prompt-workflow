import { aggregateMasterForecast, aggregateSegmentForecastFy, aggregateSegmentFcfeFy } from "./aggregate-forecast.ts";
import type { AggregatedRow, ForecastState } from "../types/cfp.ts";
import type { WACCState } from "../types/wacc.ts";

// =============================================================================
// Shared types
// =============================================================================

export interface DcfForecastValueRow {
  year: number;
  revenueUsdM: number;
  fcffUsdM: number;         // FCFF for industrial, FCFE for bank
  discountFactor: number;
  presentValueUsdM: number;
}

export type DcfDecisionAction = "BUY" | "WATCH" | "AVOID" | "INSUFFICIENT_DATA";

export interface DcfDecision {
  action: DcfDecisionAction;
  label: string;
  summary: string;
}

/** Stream object for the hybrid (SOTP) UI in Step 8 */
export interface HybridStream {
  label: string;
  discountLabel: string;
  forecastRows: DcfForecastValueRow[];
  terminalValueUsdM: number;
  terminalPresentValueUsdM: number;
  equityValueUsdM: number;
}

export interface DcfValuationResult {
  hasInputs: boolean;
  forecastRows: DcfForecastValueRow[];
  fcfMargin: number;
  terminalGrowth: number;
  revenueScaleFactor: number;
  wacc: number | null;
  terminalValueUsdM: number;
  terminalPresentValueUsdM: number;
  /** Sum of all discounted forecast rows (excl. terminal). */
  sumPvFcffUsdM: number;
  enterpriseValueUsdM: number;
  netDebtUsdM: number;
  totalDebtUsdM: number;
  totalCashUsdM: number;
  preferredStockUsdM: number;
  minorityInterestUsdM: number;
  equityValueUsdM: number;
  sharesOutstandingM: number | null;
  marketCapUsdM: number | null;
  currentPrice: number | null;
  intrinsicValuePerShare: number | null;
  impliedUpsidePct: number | null;
  decision: DcfDecision;
  warnings: string[];
  /** Determines which equity bridge variant Step 8 renders. */
  valuationMode: "FCFF" | "FCFE" | "HYBRID";
  hybridFinancialStream: HybridStream | null;
  hybridIndustrialStream: HybridStream | null;
}

/** Extended result for Hybrid / Sum-of-Parts mode */
export interface SotpValuationResult extends DcfValuationResult {
  isSotp: true;
  // Bank stream
  bankKe: number;
  bankFcfMargin: number;
  bankForecastRows: DcfForecastValueRow[];
  bankTerminalValueUsdM: number;
  bankTerminalPvUsdM: number;
  bankEquityValueUsdM: number;        // bank stream value less its value-weighted share of net debt
  // Industrial stream
  industrialWacc: number;
  industrialForecastRows: DcfForecastValueRow[];
  industrialTerminalValueUsdM: number;
  industrialTerminalPvUsdM: number;
  industrialEnterpriseValueUsdM: number;
  industrialEquityValueUsdM: number;  // EV − its value-weighted share of consolidated net debt
}

// =============================================================================
// Standard single-rate DCF (single / conglomerate / financial modes)
// =============================================================================

export function buildDcfValuation({
  forecast,
  wacc,
  fcfMargin,
  terminalGrowth,
  preferredStockUsdM = 0,
  minorityInterestUsdM = 0,
  financialTerminalGrowth,
  industrialTerminalGrowth,
  bankFcfMargin = 0.20,
}: {
  forecast: ForecastState;
  wacc: WACCState;
  fcfMargin: number;
  terminalGrowth: number;
  preferredStockUsdM?: number;
  minorityInterestUsdM?: number;
  financialTerminalGrowth?: number;
  industrialTerminalGrowth?: number;
  bankFcfMargin?: number;
}): DcfValuationResult {
  const totalDebtUsdM = round((wacc.fetchedData?.totalDebt ?? 0) / 1_000_000);
  const totalCashUsdM = round((wacc.fetchedData?.totalCash ?? 0) / 1_000_000);
  const marketCapUsdM = wacc.fetchedData?.marketCap ? round(wacc.fetchedData.marketCap / 1_000_000) : null;
  const sharesOutstandingM = wacc.fetchedData?.sharesOutstanding
    ? round(wacc.fetchedData.sharesOutstanding / 1_000_000)
    : null;
  const currentPrice = wacc.fetchedData?.currentPrice
    ?? (marketCapUsdM && sharesOutstandingM ? round(marketCapUsdM / sharesOutstandingM) : null);

  // ── Hybrid / SOTP mode ───────────────────────────────────────────────────────
  if (wacc.businessType === "hybrid") {
    const bankSegmentNames = wacc.hybridSegments
      .filter((s) => s.workflowMode === "bank")
      .map((s) => s.name);
    const industrialSegmentNames = wacc.hybridSegments
      .filter((s) => s.workflowMode === "industrial")
      .map((s) => s.name);
    const bankRevenueFy = aggregateSegmentForecastFy(bankSegmentNames, forecast);
    const industrialRevenueFy = aggregateSegmentForecastFy(industrialSegmentNames, forecast);
    // Modeled bank FCFE (preferred); falls back to revenue × margin inside the SOTP builder when incomplete.
    const { fcfeFy: bankFcfeFy, hasCompleteFcfe } = aggregateSegmentFcfeFy(bankSegmentNames, forecast);
    const bankKe = wacc.bankKeCalculation?.wacc ?? wacc.hybridBankBeta * wacc.constants.impliedERP + wacc.constants.riskFreeRate;
    const industrialWacc = wacc.industrialWaccCalculation?.wacc ?? 0.10;
    const tg = industrialTerminalGrowth ?? terminalGrowth;
    const bankTg = financialTerminalGrowth ?? terminalGrowth;

    // Single valuation pass with per-stream terminal growth, so both terminal-growth
    // sliders flow into the headline equity and the two stream cards sum to it.
    const sotp = buildSotpValuation({
      bankRevenueFy, industrialRevenueFy, bankKe, industrialWacc,
      bankFcfMargin, industrialFcfMargin: fcfMargin,
      terminalGrowth: tg,
      bankTerminalGrowth: bankTg,
      industrialTerminalGrowth: tg,
      bankFcfeFy: hasCompleteFcfe ? bankFcfeFy : null,
      fetchedData: wacc.fetchedData,
    });

    const adjustedEquity = round(sotp.equityValueUsdM - preferredStockUsdM - minorityInterestUsdM);
    const adjustedIntrinsic = sharesOutstandingM && sharesOutstandingM > 0
      ? round(adjustedEquity / sharesOutstandingM) : null;
    const adjustedUpside = marketCapUsdM && marketCapUsdM > 0
      ? round((adjustedEquity / marketCapUsdM - 1) * 100) : null;

    const financialStream: HybridStream = {
      label: "Bank / Financial Segments",
      discountLabel: `Ke = ${(bankKe * 100).toFixed(1)}%`,
      forecastRows: sotp.bankForecastRows,
      terminalValueUsdM: sotp.bankTerminalValueUsdM,
      terminalPresentValueUsdM: sotp.bankTerminalPvUsdM,
      equityValueUsdM: sotp.bankEquityValueUsdM,
    };
    const industrialStream: HybridStream = {
      label: "Industrial / SaaS Segments",
      discountLabel: `WACC = ${(industrialWacc * 100).toFixed(1)}%`,
      forecastRows: sotp.industrialForecastRows,
      terminalValueUsdM: sotp.industrialTerminalValueUsdM,
      terminalPresentValueUsdM: sotp.industrialTerminalPvUsdM,
      equityValueUsdM: sotp.industrialEquityValueUsdM,
    };

    return {
      ...sotp,
      equityValueUsdM: adjustedEquity,
      intrinsicValuePerShare: adjustedIntrinsic,
      impliedUpsidePct: adjustedUpside,
      decision: buildDecision(adjustedUpside, sotp.warnings),
      totalDebtUsdM,
      totalCashUsdM,
      sharesOutstandingM,
      sumPvFcffUsdM: round(sotp.forecastRows.reduce((s, r) => s + r.presentValueUsdM, 0)),
      preferredStockUsdM,
      minorityInterestUsdM,
      valuationMode: "HYBRID",
      hybridFinancialStream: financialStream,
      hybridIndustrialStream: industrialStream,
    };
  }

  // ── Standard single-rate DCF ─────────────────────────────────────────────────
  const discountRate = wacc.calculation?.wacc ?? null;
  const isFinancial = wacc.businessType === "financial";
  const valuationMode: "FCFF" | "FCFE" = isFinancial ? "FCFE" : "FCFF";
  const totalRow = forecast.approved ? aggregateMasterForecast(forecast).find((row) => row.isTotal) : null;
  const warnings: string[] = [];

  if (!totalRow || !discountRate || discountRate <= terminalGrowth) {
    return emptyResult({
      fcfMargin, terminalGrowth, wacc: discountRate,
      totalDebtUsdM, totalCashUsdM, sharesOutstandingM,
      preferredStockUsdM, minorityInterestUsdM, valuationMode,
      warnings: [
        !totalRow ? "Step 5/6 approved annual forecast is required." : "",
        !discountRate ? "Step 7 WACC / Ke calculation is required." : "",
        discountRate && discountRate <= terminalGrowth
          ? "Discount rate must be greater than terminal growth rate."
          : "",
      ].filter(Boolean),
    });
  }

  const { scaleFactor, warning: scaleWarning } = inferRevenueScale(annualRevenueValues(totalRow), marketCapUsdM);
  if (scaleWarning) warnings.push(scaleWarning);

  const forecastRows = annualRevenueValues(totalRow).map((rawRev, i) => {
    const rev = rawRev * scaleFactor;
    const fcf = rev * fcfMargin;
    const df = 1 / Math.pow(1 + discountRate, i + 1);
    return { year: i + 1, revenueUsdM: round(rev), fcffUsdM: round(fcf), discountFactor: df, presentValueUsdM: round(fcf * df) };
  });

  const sumPvFcffUsdM = round(forecastRows.reduce((s, r) => s + r.presentValueUsdM, 0));
  const terminalFcf = forecastRows[4].fcffUsdM * (1 + terminalGrowth);
  const terminalValueUsdM = terminalFcf / (discountRate - terminalGrowth);
  const terminalPvUsdM = terminalValueUsdM / Math.pow(1 + discountRate, 5);
  const netDebtUsdM = totalDebtUsdM - totalCashUsdM;
  const enterpriseValueUsdM = sumPvFcffUsdM + terminalPvUsdM;
  const equityValueUsdM = round(enterpriseValueUsdM - netDebtUsdM - preferredStockUsdM - minorityInterestUsdM);
  const impliedUpsidePct = marketCapUsdM && marketCapUsdM > 0
    ? round((equityValueUsdM / marketCapUsdM - 1) * 100) : null;
  const intrinsicValuePerShare = sharesOutstandingM && sharesOutstandingM > 0
    ? round(equityValueUsdM / sharesOutstandingM) : null;

  if (!wacc.fetchedData?.totalCash) {
    warnings.push("Cash was unavailable from market data; equity bridge uses debt only.");
  }

  return {
    hasInputs: true,
    forecastRows,
    fcfMargin,
    terminalGrowth,
    revenueScaleFactor: scaleFactor,
    wacc: discountRate,
    terminalValueUsdM: round(terminalValueUsdM),
    terminalPresentValueUsdM: round(terminalPvUsdM),
    sumPvFcffUsdM,
    enterpriseValueUsdM: round(enterpriseValueUsdM),
    netDebtUsdM: round(netDebtUsdM),
    totalDebtUsdM,
    totalCashUsdM,
    preferredStockUsdM,
    minorityInterestUsdM,
    equityValueUsdM,
    sharesOutstandingM,
    marketCapUsdM,
    currentPrice: currentPrice === null ? null : round(currentPrice),
    intrinsicValuePerShare,
    impliedUpsidePct,
    decision: buildDecision(impliedUpsidePct, warnings),
    warnings,
    valuationMode,
    hybridFinancialStream: null,
    hybridIndustrialStream: null,
  };
}

// =============================================================================
// Hybrid / Sum-of-Parts DCF
//
// Bank segments  → modeled FCFE discounted at Ke (equity cash flow)
//                  (falls back to revenue × bankFcfMargin when FCFE is unmodeled)
// Industrial     → FCFF discounted at WACC → EV
//
// Equity bridge:
//   Consolidated balance-sheet net debt/cash is allocated across the two streams
//   by their pre-debt value weight, then subtracted from each. This is an
//   attribution choice for the per-segment cards only — the TOTAL equity is
//   identical to subtracting net debt once from the combined value.
// =============================================================================

export interface BuildSotpParams {
  bankRevenueFy: [number, number, number, number, number];       // $M FY1-FY5
  industrialRevenueFy: [number, number, number, number, number]; // $M FY1-FY5
  bankKe: number;
  industrialWacc: number;
  bankFcfMargin: number;      // FCFE margin on NII/revenue — fallback proxy only (default ~0.20)
  industrialFcfMargin: number; // FCFF margin on revenue (default ~0.25)
  terminalGrowth: number;      // fallback when a per-stream rate is not supplied
  bankTerminalGrowth?: number;       // Ke-stream terminal growth; defaults to terminalGrowth
  industrialTerminalGrowth?: number; // WACC-stream terminal growth; defaults to terminalGrowth
  /**
   * Modeled bank FCFE per FY1–FY5 ($M). When supplied, the bank stream discounts
   * these values directly; when omitted, it falls back to revenue × bankFcfMargin.
   */
  bankFcfeFy?: [number, number, number, number, number] | null;
  fetchedData: WACCState["fetchedData"];
}

export function buildSotpValuation(params: BuildSotpParams): SotpValuationResult {
  const {
    bankRevenueFy, industrialRevenueFy,
    bankKe, industrialWacc,
    bankFcfMargin, industrialFcfMargin,
    terminalGrowth, fetchedData,
  } = params;
  const bankTg = params.bankTerminalGrowth ?? terminalGrowth;
  const indTg = params.industrialTerminalGrowth ?? terminalGrowth;

  const warnings: string[] = [];
  const marketCapUsdM = fetchedData?.marketCap ? fetchedData.marketCap / 1_000_000 : null;
  const sharesOutstandingM = fetchedData?.sharesOutstanding ? fetchedData.sharesOutstanding / 1_000_000 : null;
  const currentPrice = fetchedData?.currentPrice
    ?? (marketCapUsdM && sharesOutstandingM ? marketCapUsdM / sharesOutstandingM : null);
  const netDebtUsdM = round(((fetchedData?.totalDebt ?? 0) - (fetchedData?.totalCash ?? 0)) / 1_000_000);

  const hasBankRevenue = bankRevenueFy.some((v) => v > 0);
  const hasIndustrialRevenue = industrialRevenueFy.some((v) => v > 0);

  if (!hasBankRevenue && !hasIndustrialRevenue) {
    return emptySotpResult({ bankKe, industrialWacc, bankFcfMargin, industrialFcfMargin, terminalGrowth, marketCapUsdM,
      warnings: ["Step 5 approved forecast is required. Run Step 5 before completing WACC."] });
  }
  if (bankKe <= bankTg) {
    warnings.push("Bank Ke must be greater than terminal growth rate.");
  }
  if (industrialWacc <= indTg) {
    warnings.push("Industrial WACC must be greater than terminal growth rate.");
  }
  if (!fetchedData?.totalCash) {
    warnings.push("Cash was unavailable; equity bridge uses debt only.");
  }

  // ── Bank FCFE stream ──────────────────────────────────────────────────────
  // Prefer the modeled per-segment FCFE (net income − regulatory capital). Fall
  // back to a revenue × margin proxy only when the forecast lacks complete FCFE.
  const bankFcfeFy = params.bankFcfeFy ?? null;
  const usingModeledFcfe = bankFcfeFy !== null;
  if (!usingModeledFcfe && hasBankRevenue) {
    warnings.push("Bank FCFE not modeled in Step 5; bank stream uses a revenue × margin proxy.");
  }
  const bankKeSafe = Math.max(bankKe, bankTg + 0.001); // guard
  const bankRows = bankRevenueFy.map((rev, i): DcfForecastValueRow => {
    const fcfe = usingModeledFcfe ? bankFcfeFy![i] : rev * bankFcfMargin;
    const df = 1 / Math.pow(1 + bankKeSafe, i + 1);
    return { year: i + 1, revenueUsdM: round(rev), fcffUsdM: round(fcfe), discountFactor: df, presentValueUsdM: round(fcfe * df) };
  });
  const bankTerminalFcfeBase = bankRows[4]?.fcffUsdM ?? 0;
  if (hasBankRevenue && bankTerminalFcfeBase <= 0) {
    warnings.push("Bank terminal-year FCFE is non-positive; bank terminal value set to zero.");
  }
  const bankTerminalFcfe = bankTerminalFcfeBase * (1 + bankTg);
  const bankTerminalValueUsdM = hasBankRevenue && bankTerminalFcfe > 0 ? bankTerminalFcfe / (bankKeSafe - bankTg) : 0;
  const bankTerminalPvUsdM = bankTerminalValueUsdM / Math.pow(1 + bankKeSafe, 5);
  // Gross equity value of the bank stream, before any allocation of consolidated net debt.
  const bankStreamValueUsdM = round(
    bankRows.reduce((s, r) => s + r.presentValueUsdM, 0) + bankTerminalPvUsdM,
  );

  // ── Industrial FCFF stream ────────────────────────────────────────────────
  const indWaccSafe = Math.max(industrialWacc, indTg + 0.001);
  const indRows = industrialRevenueFy.map((rev, i): DcfForecastValueRow => {
    const fcff = rev * industrialFcfMargin;
    const df = 1 / Math.pow(1 + indWaccSafe, i + 1);
    return { year: i + 1, revenueUsdM: round(rev), fcffUsdM: round(fcff), discountFactor: df, presentValueUsdM: round(fcff * df) };
  });
  const indTerminalFcff = (indRows[4]?.fcffUsdM ?? 0) * (1 + indTg);
  const industrialTerminalValueUsdM = hasIndustrialRevenue ? indTerminalFcff / (indWaccSafe - indTg) : 0;
  const industrialTerminalPvUsdM = industrialTerminalValueUsdM / Math.pow(1 + indWaccSafe, 5);
  const industrialEnterpriseValueUsdM = round(
    indRows.reduce((s, r) => s + r.presentValueUsdM, 0) + industrialTerminalPvUsdM,
  );

  // ── Sum-of-Parts equity bridge ────────────────────────────────────────────
  // Allocate consolidated net debt/cash across the two streams by their pre-debt
  // value weight, so each segment's reported equity is sensible. This is purely an
  // attribution choice: the TOTAL equity is identical to subtracting net debt once.
  const grossTotalUsdM = bankStreamValueUsdM + industrialEnterpriseValueUsdM;
  const bankWeight = grossTotalUsdM > 0 ? bankStreamValueUsdM / grossTotalUsdM : 0;
  const bankEquityValueUsdM = round(bankStreamValueUsdM - netDebtUsdM * bankWeight);
  const industrialEquityValueUsdM = round(industrialEnterpriseValueUsdM - netDebtUsdM * (1 - bankWeight));

  const equityValueUsdM = round(bankEquityValueUsdM + industrialEquityValueUsdM);
  const enterpriseValueUsdM = round(bankStreamValueUsdM + industrialEnterpriseValueUsdM);
  const impliedUpsidePct = marketCapUsdM && marketCapUsdM > 0
    ? round((equityValueUsdM / marketCapUsdM - 1) * 100) : null;
  const intrinsicValuePerShare = sharesOutstandingM && sharesOutstandingM > 0
    ? round(equityValueUsdM / sharesOutstandingM) : null;

  // Combined "forecastRows" for the shared dashboard table — show totals
  const combinedRows: DcfForecastValueRow[] = bankRevenueFy.map((bankRev, i) => {
    const indRev = industrialRevenueFy[i];
    const totalRev = bankRev + indRev;
    const totalFcf = bankRows[i].fcffUsdM + indRows[i].fcffUsdM;
    const totalPv = bankRows[i].presentValueUsdM + indRows[i].presentValueUsdM;
    return { year: i + 1, revenueUsdM: round(totalRev), fcffUsdM: round(totalFcf), discountFactor: 0, presentValueUsdM: round(totalPv) };
  });

  const totalDebtUsdM = round((fetchedData?.totalDebt ?? 0) / 1_000_000);
  const totalCashUsdM = round((fetchedData?.totalCash ?? 0) / 1_000_000);
  const sumPvFcffUsdM = round(combinedRows.reduce((s, r) => s + r.presentValueUsdM, 0));

  return {
    hasInputs: true,
    isSotp: true,
    forecastRows: combinedRows,
    fcfMargin: industrialFcfMargin,
    terminalGrowth,
    revenueScaleFactor: 1,
    wacc: null, // SOTP has two rates, not one
    terminalValueUsdM: round(bankTerminalValueUsdM + industrialTerminalValueUsdM),
    terminalPresentValueUsdM: round(bankTerminalPvUsdM + industrialTerminalPvUsdM),
    sumPvFcffUsdM,
    enterpriseValueUsdM,
    netDebtUsdM,
    totalDebtUsdM,
    totalCashUsdM,
    preferredStockUsdM: 0,
    minorityInterestUsdM: 0,
    equityValueUsdM,
    sharesOutstandingM: sharesOutstandingM === null ? null : round(sharesOutstandingM),
    marketCapUsdM: marketCapUsdM === null ? null : round(marketCapUsdM),
    currentPrice: currentPrice === null ? null : round(currentPrice),
    intrinsicValuePerShare,
    impliedUpsidePct,
    decision: buildDecision(impliedUpsidePct, warnings),
    warnings,
    valuationMode: "HYBRID",
    hybridFinancialStream: null, // filled by buildDcfValuation wrapper
    hybridIndustrialStream: null,
    // SOTP-specific
    bankKe,
    bankFcfMargin,
    bankForecastRows: bankRows,
    bankTerminalValueUsdM: round(bankTerminalValueUsdM),
    bankTerminalPvUsdM: round(bankTerminalPvUsdM),
    bankEquityValueUsdM,
    industrialWacc,
    industrialForecastRows: indRows,
    industrialTerminalValueUsdM: round(industrialTerminalValueUsdM),
    industrialTerminalPvUsdM: round(industrialTerminalPvUsdM),
    industrialEnterpriseValueUsdM,
    industrialEquityValueUsdM,
  };
}

// =============================================================================
// Shared helpers
// =============================================================================

function annualRevenueValues(row: AggregatedRow): number[] {
  return [row.fy1, row.fy2, row.fy3, row.fy4, row.fy5];
}

function emptyResult({
  fcfMargin, terminalGrowth, wacc, warnings,
  totalDebtUsdM = 0, totalCashUsdM = 0, sharesOutstandingM = null,
  preferredStockUsdM = 0, minorityInterestUsdM = 0,
  valuationMode = "FCFF" as const,
}: {
  fcfMargin: number; terminalGrowth: number; wacc: number | null; warnings: string[];
  totalDebtUsdM?: number; totalCashUsdM?: number; sharesOutstandingM?: number | null;
  preferredStockUsdM?: number; minorityInterestUsdM?: number;
  valuationMode?: "FCFF" | "FCFE" | "HYBRID";
}): DcfValuationResult {
  return {
    hasInputs: false, forecastRows: [], fcfMargin, terminalGrowth,
    revenueScaleFactor: 1, wacc, terminalValueUsdM: 0, terminalPresentValueUsdM: 0,
    sumPvFcffUsdM: 0, enterpriseValueUsdM: 0, netDebtUsdM: 0,
    totalDebtUsdM, totalCashUsdM, preferredStockUsdM, minorityInterestUsdM,
    equityValueUsdM: 0, sharesOutstandingM,
    marketCapUsdM: null, currentPrice: null, intrinsicValuePerShare: null,
    impliedUpsidePct: null,
    decision: { action: "INSUFFICIENT_DATA", label: "Insufficient Data",
      summary: "Complete Step 5 (forecast) and Step 7 (discount rate) before viewing valuation." },
    warnings,
    valuationMode,
    hybridFinancialStream: null,
    hybridIndustrialStream: null,
  };
}

function emptySotpResult(p: {
  bankKe: number; industrialWacc: number; bankFcfMargin: number;
  industrialFcfMargin: number; terminalGrowth: number;
  marketCapUsdM: number | null; warnings: string[];
}): SotpValuationResult {
  const zero5 = [0, 0, 0, 0, 0] as const;
  const emptyRows = zero5.map((_, i) => ({ year: i + 1, revenueUsdM: 0, fcffUsdM: 0, discountFactor: 0, presentValueUsdM: 0 }));
  return {
    ...emptyResult({ fcfMargin: p.industrialFcfMargin, terminalGrowth: p.terminalGrowth, wacc: null, warnings: p.warnings, valuationMode: "HYBRID" }),
    isSotp: true,
    bankKe: p.bankKe, bankFcfMargin: p.bankFcfMargin,
    bankForecastRows: emptyRows, bankTerminalValueUsdM: 0, bankTerminalPvUsdM: 0, bankEquityValueUsdM: 0,
    industrialWacc: p.industrialWacc, industrialForecastRows: emptyRows,
    industrialTerminalValueUsdM: 0, industrialTerminalPvUsdM: 0,
    industrialEnterpriseValueUsdM: 0, industrialEquityValueUsdM: 0,
  };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

function inferRevenueScale(
  annualRevenueUsdM: number[],
  marketCapUsdM: number | null,
): { scaleFactor: number; warning: string | null } {
  const firstRevenue = annualRevenueUsdM.find((v) => v > 0) ?? 0;
  if (!marketCapUsdM || marketCapUsdM <= 0 || firstRevenue <= 0) return { scaleFactor: 1, warning: null };
  const impliedSalesMultiple = marketCapUsdM / firstRevenue;
  if (marketCapUsdM >= 100_000 && firstRevenue < 10_000 && impliedSalesMultiple > 50) {
    return { scaleFactor: 1000,
      warning: "Forecast revenue appears in USD billions; converted to USD millions. Review before relying on output." };
  }
  return { scaleFactor: 1, warning: null };
}

function buildDecision(impliedUpsidePct: number | null, warnings: string[]): DcfDecision {
  if (impliedUpsidePct === null) {
    return { action: "INSUFFICIENT_DATA", label: "Insufficient Market Data",
      summary: "Market capitalisation is unavailable; the model cannot compare intrinsic value to current market price." };
  }
  const reviewText = warnings.length > 0 ? " Review the audit warnings before acting." : "";
  if (impliedUpsidePct >= 15) {
    return { action: "BUY", label: "Model Signal: Buy / Accumulate",
      summary: `DCF equity value is ${impliedUpsidePct.toFixed(1)}% above current market value — stock appears undervalued under these assumptions.${reviewText}` };
  }
  if (impliedUpsidePct <= -10) {
    return { action: "AVOID", label: "Model Signal: Avoid / Do Not Buy",
      summary: `DCF equity value is ${Math.abs(impliedUpsidePct).toFixed(1)}% below current market value — stock appears overvalued under these assumptions.${reviewText}` };
  }
  return { action: "WATCH", label: "Model Signal: Watch / Hold",
    summary: `DCF equity value is within ${Math.abs(impliedUpsidePct).toFixed(1)}% of current market value — decision is not compelling without a stronger margin of safety.${reviewText}` };
}
