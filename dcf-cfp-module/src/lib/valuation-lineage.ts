import type { CFPState } from "@/types/cfp";
import { getStep5StructuredResults } from "@/lib/aggregate-forecast";
import type { DriverAdjustment } from "@/lib/event-impact-adjustments";

export type ValuationDriverDirection = "increases value" | "decreases value" | "mixed" | "context";
export type ValuationDriverEditability = "direct" | "indirect" | "derived";

export interface ValuationDriver {
  id: string;
  group: string;
  label: string;
  currentValue: string;
  sourceSteps: number[];
  direction: ValuationDriverDirection;
  editability: ValuationDriverEditability;
  affectedBy: string[];
  valuationPath: string;
  explanation: string;
  evidence: ValuationDriverEvidence[];
}

export interface ValuationDriverEvidence {
  step: number;
  result: string;
  effect: string;
}

interface BuildValuationLineageInput {
  state: CFPState;
  valuationMode: "FCFF" | "FCFE" | "HYBRID";
  fcfMargin: number;
  terminalGrowth: number;
  bankFcfMargin: number;
  financialTerminalGrowth: number;
  industrialTerminalGrowth: number;
  preferredStockUsdM: number;
  minorityInterestUsdM: number;
  wacc: number | null;
  intrinsicValuePerShare: number | null;
  eventAdjustments?: DriverAdjustment[];
}

function pct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(digits)}%`;
}

function moneyM(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
}

function latestAnnualRevenue(state: CFPState): number | null {
  const annualRows = state.history.rows.filter((row) => row.isAnnualFiling && row.revenue != null);
  const sourceRows = annualRows.length ? annualRows : state.history.rows.filter((row) => row.revenue != null);
  if (!sourceRows.length) return null;
  const latestYear = Math.max(...sourceRows.map((row) => row.fiscalYear));
  return sourceRows
    .filter((row) => row.fiscalYear === latestYear)
    .reduce((total, row) => total + (row.revenue ?? 0), 0);
}

function latestAnnualRevenueDetail(state: CFPState): { year: number; revenue: number; rowCount: number } | null {
  const annualRows = state.history.rows.filter((row) => row.isAnnualFiling && row.revenue != null);
  const sourceRows = annualRows.length ? annualRows : state.history.rows.filter((row) => row.revenue != null);
  if (!sourceRows.length) return null;
  const latestYear = Math.max(...sourceRows.map((row) => row.fiscalYear));
  const rows = sourceRows.filter((row) => row.fiscalYear === latestYear);
  return {
    year: latestYear,
    revenue: rows.reduce((total, row) => total + (row.revenue ?? 0), 0),
    rowCount: rows.length,
  };
}

function latestForecastTotals(state: CFPState): { fy1: number; fy5: number; cagrPct: number; segments: number } | null {
  const total = state.summary.aggregatedRows.find((row) => row.isTotal);
  if (total && total.fy1 > 0 && total.fy5 > 0) {
    return {
      fy1: total.fy1,
      fy5: total.fy5,
      cagrPct: total.cagr,
      segments: state.summary.aggregatedRows.filter((row) => row.isSubtotal).length,
    };
  }

  const structured = getStep5StructuredResults(state.forecast);
  const rows = structured.flatMap((result) => result.machine_artifact.forecast_table);
  if (!rows.length) return null;
  const years = Array.from(new Set(rows.map((row) => row.fiscal_year))).sort();
  const firstYear = years[0];
  const lastYear = years[years.length - 1];
  const fy1 = rows
    .filter((row) => row.fiscal_year === firstYear)
    .reduce((totalRevenue, row) => totalRevenue + row.revenue_base_usd_m, 0);
  const fy5 = rows
    .filter((row) => row.fiscal_year === lastYear)
    .reduce((totalRevenue, row) => totalRevenue + row.revenue_base_usd_m, 0);
  return {
    fy1,
    fy5,
    cagrPct: fy1 > 0 && fy5 > 0 ? (Math.pow(fy5 / fy1, 1 / Math.max(1, years.length - 1)) - 1) * 100 : 0,
    segments: structured.length,
  };
}

function topStep5Assumption(state: CFPState): { id: string; segment: string; statement: string; quality: string } | null {
  const structured = getStep5StructuredResults(state.forecast);
  for (const result of structured) {
    const assumption = result.machine_artifact.assumptions[0];
    const row = result.machine_artifact.forecast_table[0];
    if (assumption) {
      return {
        id: assumption.id,
        segment: row?.segment ?? result.company_name,
        statement: assumption.statement,
        quality: assumption.driver_quality,
      };
    }
  }
  return null;
}

function step4CapitalStatus(state: CFPState): { status: string; metrics: number; ceiling: string } | null {
  const capital = state.synergies.structuredResult?.capital_allocation;
  if (!capital) return null;
  return {
    status: capital.workflow_status,
    metrics: capital.capital_metrics.length,
    ceiling: capital.step5_revenue_ceiling.applies
      ? moneyM(capital.step5_revenue_ceiling.ceiling_revenue_usd_m)
      : "No hard Step 5 ceiling",
  };
}

function waccDetail(input: BuildValuationLineageInput): string {
  const constants = input.state.wacc.constants;
  const beta = input.state.wacc.singleBeta;
  const spread = input.state.wacc.liquidityRiskSpread ?? 0;
  return `risk-free ${pct(constants.riskFreeRate)}, ERP ${pct(constants.impliedERP)}, tax ${pct(constants.marginalTaxRate)}, beta ${beta.toFixed(2)}, liquidity spread ${pct(spread)}`;
}

function sharesDetail(state: CFPState): string {
  const shares = state.wacc.fetchedData?.sharesOutstanding;
  if (!shares) return "shares outstanding unavailable";
  return `${(shares / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M shares outstanding`;
}

function eventEvidence(input: BuildValuationLineageInput, driverId: string): ValuationDriverEvidence[] {
  return (input.eventAdjustments ?? [])
    .filter((adjustment) => adjustment.driverId === driverId)
    .map((adjustment) => ({
      step: 0,
      result: `Step 0 event "${adjustment.sourceEventTitle}" (${adjustment.eventType}) suggested ${formatAdjustmentValue(adjustment.cachedValue, adjustment.unit)} -> ${formatAdjustmentValue(adjustment.suggestedValue, adjustment.unit)} for ${adjustment.driverLabel}. Confidence ${adjustment.confidence}/100.`,
      effect: `${adjustment.applied ? "Selected" : "Not selected"} for refresh review: ${adjustment.reason}`,
    }));
}

function formatAdjustmentValue(value: number | null, unit: DriverAdjustment["unit"]): string {
  if (value == null) return "requires rerun";
  if (unit === "%") return pct(value);
  if (unit === "USD_M") return moneyM(value);
  if (unit === "score") return value.toFixed(0);
  return String(value);
}

function forecastRevenueCagr(state: CFPState): string {
  const rows = state.summary.aggregatedRows;
  if (rows.length >= 2) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const firstRevenue = "revenue" in first ? Number(first.revenue) : NaN;
    const lastRevenue = "revenue" in last ? Number(last.revenue) : NaN;
    if (firstRevenue > 0 && lastRevenue > 0) {
      const years = Math.max(1, rows.length - 1);
      return pct(Math.pow(lastRevenue / firstRevenue, 1 / years) - 1);
    }
  }
  return state.forecast.approved ? "From Step 5 forecast" : "Pending Step 5";
}

export function buildValuationLineageDrivers(input: BuildValuationLineageInput): ValuationDriver[] {
  const { state, valuationMode } = input;
  const latestRevenue = latestAnnualRevenue(state);
  const latestRevenueDetail = latestAnnualRevenueDetail(state);
  const forecastTotals = latestForecastTotals(state);
  const topAssumption = topStep5Assumption(state);
  const capitalStatus = step4CapitalStatus(state);
  const fetched = state.wacc.fetchedData;
  const isHybrid = valuationMode === "HYBRID";
  const isFcfe = valuationMode === "FCFE";

  return [
    {
      id: "business-model",
      group: "Business Structure",
      label: "Valuation Mode",
      currentValue: valuationMode,
      sourceSteps: [1, 7, 8],
      direction: "context",
      editability: "indirect",
      affectedBy: ["Step 1 company type", "Step 2 workflow mode", "Step 7 business type"],
      valuationPath: isHybrid
        ? "Segments split into FCFE/Ke and FCFF/WACC streams"
        : isFcfe
          ? "FCFE -> Equity Value"
          : "FCFF -> Enterprise Value -> Equity Value",
      explanation: "Business architecture decides whether the model values operating assets, equity cash flows, or a hybrid SOTP.",
      evidence: [
        {
          step: 1,
          result: `Step 1 classified company type as ${state.profile.step1StructuredResult?.company_type ?? "not specified"}.`,
          effect: `Step 8 uses ${valuationMode} valuation mode.`,
        },
        {
          step: 7,
          result: `Step 7 saved business type as ${state.wacc.businessType}.`,
          effect: isHybrid ? "Valuation splits bank and industrial streams." : isFcfe ? "Valuation discounts equity cash flow directly." : "Valuation uses enterprise FCFF and an equity bridge.",
        },
        ...eventEvidence(input, "business-model"),
      ],
    },
    {
      id: "revenue-baseline",
      group: "Revenue Base",
      label: "Historical Revenue Baseline",
      currentValue: moneyM(latestRevenue),
      sourceSteps: [2, 5],
      direction: "increases value",
      editability: "indirect",
      affectedBy: ["Uploaded 10-K/10-Q files", "Step 2 extraction", "Step 5 forecast seed"],
      valuationPath: "Historical revenue -> forecast revenue -> FCFF/FCFE",
      explanation: "A higher verified starting revenue base usually raises projected cash flow before margin and discount assumptions are applied.",
      evidence: [
        {
          step: 2,
          result: latestRevenueDetail
            ? `Step 2 extracted ${latestRevenueDetail.rowCount} revenue row(s) for FY${latestRevenueDetail.year}, totaling ${moneyM(latestRevenueDetail.revenue)}.`
            : "Step 2 has no usable revenue baseline yet.",
          effect: `Valuation lineage shows historical revenue baseline as ${moneyM(latestRevenue)}.`,
        },
        {
          step: 5,
          result: forecastTotals
            ? `Step 5 forecast starts at ${moneyM(forecastTotals.fy1)} FY1 revenue.`
            : "Step 5 forecast has not produced consolidated FY1 revenue yet.",
          effect: "That FY1 revenue becomes the first explicit forecast cash-flow base.",
        },
        ...eventEvidence(input, "revenue-baseline"),
      ],
    },
    {
      id: "forecast-growth",
      group: "Growth",
      label: "Forecast Growth",
      currentValue: forecastRevenueCagr(state),
      sourceSteps: [2, 3, 4, 5],
      direction: "increases value",
      editability: "indirect",
      affectedBy: ["Historical trend", "Competitive position", "Synergy eligibility", "Forecast assumptions"],
      valuationPath: "Revenue growth -> annual cash flows -> PV of explicit forecast",
      explanation: "Growth expands the explicit forecast cash flow stream and can also influence the terminal cash flow base.",
      evidence: [
        {
          step: 5,
          result: forecastTotals
            ? `Step 5 forecast moves from ${moneyM(forecastTotals.fy1)} in FY1 to ${moneyM(forecastTotals.fy5)} in FY5, CAGR ${forecastTotals.cagrPct.toFixed(1)}%.`
            : "Step 5 forecast totals are not available yet.",
          effect: `Forecast growth driver displays as ${forecastRevenueCagr(state)}.`,
        },
        {
          step: 5,
          result: topAssumption
            ? `Top Step 5 assumption ${topAssumption.id} (${topAssumption.quality}) for ${topAssumption.segment}: ${topAssumption.statement}`
            : "No Step 5 assumption artifact is available.",
          effect: "This assumption is one reason the forecast growth path is accepted or flagged for review.",
        },
        ...eventEvidence(input, "forecast-growth"),
      ],
    },
    {
      id: "fcf-margin",
      group: "Margin / Cash Flow",
      label: isFcfe ? "FCFE Margin / Bank Conversion" : isHybrid ? "FCF Margins" : "FCF Margin",
      currentValue: isHybrid
        ? `Bank ${pct(input.bankFcfMargin)} / Industrial ${pct(input.fcfMargin)}`
        : pct(input.fcfMargin),
      sourceSteps: [2, 4, 5, 8],
      direction: "increases value",
      editability: "direct",
      affectedBy: ["Operating margin history", "CapEx/D&A", "Capital allocation", "Step 8 assumption slider"],
      valuationPath: "Revenue -> FCF margin -> FCFF/FCFE -> Enterprise or Equity Value",
      explanation: "Margin converts sales or bank earnings power into cash flow. Small changes can materially move intrinsic value.",
      evidence: [
        {
          step: 4,
          result: capitalStatus
            ? `Step 4 capital allocation status is ${capitalStatus.status}; ${capitalStatus.metrics} capital metric(s); ceiling: ${capitalStatus.ceiling}.`
            : "Step 4 capital allocation artifact is not available.",
          effect: "Capital intensity and review status inform whether FCF margin assumptions are reliable.",
        },
        {
          step: 8,
          result: isHybrid
            ? `Step 8 sliders set bank FCFE margin to ${pct(input.bankFcfMargin)} and industrial FCF margin to ${pct(input.fcfMargin)}.`
            : `Step 8 slider sets FCF margin to ${pct(input.fcfMargin)}.`,
          effect: `Valuation uses ${isHybrid ? `bank ${pct(input.bankFcfMargin)} / industrial ${pct(input.fcfMargin)}` : pct(input.fcfMargin)} as the cash-flow conversion input.`,
        },
        ...eventEvidence(input, "fcf-margin"),
      ],
    },
    {
      id: "terminal-growth",
      group: "Terminal Value",
      label: isHybrid ? "Terminal Growth Rates" : "Terminal Growth",
      currentValue: isHybrid
        ? `Financial ${pct(input.financialTerminalGrowth)} / Industrial ${pct(input.industrialTerminalGrowth)}`
        : pct(input.terminalGrowth),
      sourceSteps: [5, 7, 8],
      direction: "increases value",
      editability: "direct",
      affectedBy: ["Long-term growth view", "Macro/rate environment", "Step 8 assumption slider"],
      valuationPath: "Final forecast cash flow x (1 + g) / (discount rate - g) -> terminal value",
      explanation: "Terminal growth controls the continuing value after the explicit forecast period.",
      evidence: [
        {
          step: 5,
          result: forecastTotals
            ? `Step 5 terminal base is anchored off FY5 forecast revenue of ${moneyM(forecastTotals.fy5)}.`
            : "Step 5 FY5 forecast base is not available.",
          effect: "The final forecast cash flow is the base for terminal value.",
        },
        {
          step: 8,
          result: isHybrid
            ? `Step 8 sets terminal growth to ${pct(input.financialTerminalGrowth)} for financial stream and ${pct(input.industrialTerminalGrowth)} for industrial stream.`
            : `Step 8 sets terminal growth to ${pct(input.terminalGrowth)}.`,
          effect: "This growth rate is used in the Gordon Growth terminal value formula.",
        },
        ...eventEvidence(input, "terminal-growth"),
      ],
    },
    {
      id: "discount-rate",
      group: "Discount Rate",
      label: isFcfe ? "Cost of Equity" : isHybrid ? "Ke / WACC" : "WACC",
      currentValue: input.wacc == null ? "N/A" : pct(input.wacc),
      sourceSteps: [7, 8],
      direction: "decreases value",
      editability: "direct",
      affectedBy: ["Risk-free rate", "ERP", "Beta", "Tax rate", "Capital structure", "Liquidity risk spread"],
      valuationPath: "Discount rate -> discount factors -> PV of cash flows and terminal value",
      explanation: "A higher discount rate lowers present value. For financial companies, Ke replaces enterprise WACC.",
      evidence: [
        {
          step: 7,
          result: `Step 7 inputs: ${waccDetail(input)}.`,
          effect: `${isFcfe ? "Cost of equity" : isHybrid ? "Ke/WACC stream rates" : "WACC"} is currently ${input.wacc == null ? "N/A" : pct(input.wacc)}.`,
        },
        {
          step: 8,
          result: "Step 8 applies the saved Step 7 discount rate to each forecast year and terminal value.",
          effect: "Higher discount rate lowers present value of explicit cash flows and terminal value.",
        },
        ...eventEvidence(input, "discount-rate"),
      ],
    },
    {
      id: "market-data",
      group: "Market Data",
      label: "Market Data Inputs",
      currentValue: fetched
        ? `${moneyM(fetched.marketCap / 1_000_000)} market cap / ${moneyM(fetched.totalDebt / 1_000_000)} debt`
        : "N/A",
      sourceSteps: [7],
      direction: "mixed",
      editability: "derived",
      affectedBy: ["Yahoo Finance data", "Ticker selection", "Manual WACC refresh"],
      valuationPath: "Debt/cash/shares -> equity bridge -> intrinsic value per share",
      explanation: "Market data supplies debt, cash, shares, current price, and risk-free rate context for valuation comparisons.",
      evidence: [
        {
          step: 7,
          result: fetched
            ? `Step 7 fetched ${state.profile.ticker || fetched.ticker}: price $${fetched.currentPrice.toFixed(2)}, debt ${moneyM(fetched.totalDebt / 1_000_000)}, cash ${moneyM(fetched.totalCash / 1_000_000)}.`
            : "Step 7 market data has not been fetched.",
          effect: "Debt and cash feed the equity bridge; current price feeds upside/downside comparison.",
        },
        ...eventEvidence(input, "market-data"),
      ],
    },
    {
      id: "equity-bridge",
      group: "Equity Bridge",
      label: "Equity Bridge Adjustments",
      currentValue: `Preferred ${moneyM(input.preferredStockUsdM)} / Minority ${moneyM(input.minorityInterestUsdM)}`,
      sourceSteps: [7, 8],
      direction: "decreases value",
      editability: "direct",
      affectedBy: ["Debt", "Cash", "Preferred stock", "Minority interest"],
      valuationPath: "Enterprise Value - net obligations + cash -> common equity value",
      explanation: "Bridge items convert enterprise value into value attributable to common shareholders.",
      evidence: [
        {
          step: 7,
          result: fetched
            ? `Step 7 market data gives total debt ${moneyM(fetched.totalDebt / 1_000_000)} and cash ${moneyM(fetched.totalCash / 1_000_000)}.`
            : "Step 7 debt and cash data are not available.",
          effect: "Net debt is deducted from enterprise value in FCFF mode.",
        },
        {
          step: 8,
          result: `Step 8 manual bridge inputs: preferred stock ${moneyM(input.preferredStockUsdM)}, minority interest ${moneyM(input.minorityInterestUsdM)}.`,
          effect: "These manual inputs reduce common equity value when non-zero.",
        },
        ...eventEvidence(input, "equity-bridge"),
      ],
    },
    {
      id: "per-share",
      group: "Per Share",
      label: "Per-Share Value",
      currentValue: input.intrinsicValuePerShare == null
        ? "N/A"
        : `$${input.intrinsicValuePerShare.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sourceSteps: [7, 8],
      direction: "mixed",
      editability: "derived",
      affectedBy: ["Equity value", "Diluted shares outstanding", "Current price"],
      valuationPath: "Common equity value / shares outstanding -> intrinsic value per share",
      explanation: "This is the final shareholder-level output after cash flows, discounting, bridge items, and share count are applied.",
      evidence: [
        {
          step: 7,
          result: `Step 7 market data provides ${sharesDetail(state)}.`,
          effect: "Share count divides common equity value into intrinsic value per share.",
        },
        {
          step: 8,
          result: `Step 8 computed intrinsic value per share as ${
            input.intrinsicValuePerShare == null
              ? "N/A"
              : `$${input.intrinsicValuePerShare.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          }.`,
          effect: "This is compared with current market price to produce the valuation signal.",
        },
        ...eventEvidence(input, "per-share"),
      ],
    },
  ];
}
