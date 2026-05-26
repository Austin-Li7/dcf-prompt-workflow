import test from "node:test";
import assert from "node:assert/strict";

import { buildDcfValuation } from "./dcf-valuation.ts";
import type { ForecastState, Step5StructuredResult } from "../types/cfp.ts";
import type { WACCState } from "../types/wacc.ts";

function artifact(): Step5StructuredResult {
  return {
    schema_version: "v5.5",
    company_name: "Example",
    review_summary: { one_line: "Ready.", highlights: [], warnings: [] },
    machine_artifact: {
      forecast_mode: "SEGMENT_ANNUAL",
      assumptions: [
        {
          id: "A1",
          statement: "Base growth.",
          basis_claim_ids: ["S2-C1"],
          driver_quality: "DISCLOSED",
          driver_eligibility_source: "Step 2.",
          arithmetic_trace: "Annual forecast.",
          management_override_required: false,
        },
      ],
      forecast_table: [1000, 1100, 1210, 1331, 1464.1].map((value, index) => ({
        segment: "Services",
        category: "Segment Forecast",
        product: null,
        fiscal_year: `FY+${index + 1}`,
        quarter: null,
        revenue_low_usd_m: value * 0.95,
        revenue_base_usd_m: value,
        revenue_high_usd_m: value * 1.05,
        yoy_growth_pct: 10,
        assumption_ids: ["A1"],
        driver_quality: "DISCLOSED",
        flags: [],
      })),
      weak_inference_sensitivity: [],
      confidence_summary: {
        total_fy5_revenue_base_usd_m: 1464.1,
        disclosed_driver_revenue_pct: 100,
        strong_driver_revenue_pct: 0,
        weak_driver_revenue_pct: 0,
        high_uncertainty_flags: 0,
      },
      workflow_status: "READY",
      next_action: "PROCEED_STEP7",
    },
  };
}

const forecast: ForecastState = {
  approved: true,
  segments: [],
  structuredResults: [artifact()],
};

const wacc: WACCState = {
    fetchedData: {
      ticker: "AAPL",
      companyName: "AAPL",
      marketCap: 4_000_000_000,
      currentPrice: 40,
      sharesOutstanding: 100_000_000,
      totalDebt: 10_000_000_000,
      totalCash: 5_000_000_000,
    interestExpense: 0,
    riskFreeRate: 0.04,
    companyDescription: "",
  },
  constants: { riskFreeRate: 0.04, impliedERP: 0.045, marginalTaxRate: 0.21 },
  businessType: "single",
  singleBeta: 1,
  segments: [],
  calculation: {
    deRatio: 0.025,
    unleveredBeta: 1,
    releveredBeta: 1.02,
    costOfEquity: 0.086,
    preTaxCostOfDebt: 0.04,
    afterTaxCostOfDebt: 0.032,
    weightEquity: 0.975,
    weightDebt: 0.025,
    wacc: 0.087,
  },
  hybridSegments: [],
  hybridBankBeta: 0.37,
  bankKeCalculation: null,
  industrialWaccCalculation: null,
  saved: true,
};

test("builds DCF valuation from Step 5 annual forecast and WACC", () => {
  const result = buildDcfValuation({
    forecast,
    wacc,
    fcfMargin: 0.25,
    terminalGrowth: 0.025,
  });

  assert.equal(result.hasInputs, true);
  assert.equal(result.forecastRows.length, 5);
  assert.equal(result.forecastRows[0].revenueUsdM, 1000);
  assert.equal(result.forecastRows[0].fcffUsdM, 250);
  assert.equal(result.terminalValueUsdM > result.forecastRows[4].fcffUsdM, true);
  assert.equal(Math.round(result.equityValueUsdM), Math.round(result.enterpriseValueUsdM - 5000));
  assert.equal(result.marketCapUsdM, 4000);
  assert.equal(result.currentPrice, 40);
  assert.notEqual(result.intrinsicValuePerShare, null);
  assert.equal(Math.round(result.intrinsicValuePerShare!), Math.round(result.equityValueUsdM / 100));
  assert.equal((result.impliedUpsidePct ?? 0) < 0, true);
  assert.equal(result.decision.action, "AVOID");
});

test("returns missing-input result when forecast or WACC is unavailable", () => {
  const result = buildDcfValuation({
    forecast: { approved: false, segments: [] },
    wacc: { ...wacc, calculation: null },
    fcfMargin: 0.25,
    terminalGrowth: 0.025,
  });

  assert.equal(result.hasInputs, false);
  assert.equal(result.forecastRows.length, 0);
});

test("normalizes apparent USD billions forecast rows for mega-cap companies before equity bridge", () => {
  const billionScaleForecast: ForecastState = {
    approved: true,
    segments: [],
    structuredResults: [{
      ...artifact(),
      machine_artifact: {
        ...artifact().machine_artifact,
        forecast_table: [475, 508, 535, 560, 585].map((value, index) => ({
          segment: "Consolidated",
          category: "Segment Forecast",
          product: null,
          fiscal_year: `FY+${index + 1}`,
          quarter: null,
          revenue_low_usd_m: value * 0.95,
          revenue_base_usd_m: value,
          revenue_high_usd_m: value * 1.05,
          yoy_growth_pct: 7,
          assumption_ids: ["A1"],
          driver_quality: "DISCLOSED",
          flags: [],
        })),
      },
    }],
  };

  const appleScaleWacc: WACCState = {
    ...wacc,
    fetchedData: {
      ...wacc.fetchedData!,
      marketCap: 3_980_000_000_000,
      totalDebt: 90_510_000_000,
      totalCash: 55_000_000_000,
    },
  };

  const result = buildDcfValuation({
    forecast: billionScaleForecast,
    wacc: appleScaleWacc,
    fcfMargin: 0.25,
    terminalGrowth: 0.025,
  });

  assert.equal(result.hasInputs, true);
  assert.equal(result.forecastRows[0].revenueUsdM, 475000);
  assert.equal(result.revenueScaleFactor, 1000);
  assert.match(result.warnings.join(" "), /converted to USD millions/);
  assert.equal(result.equityValueUsdM > 0, true);
  assert.match(result.decision.summary, /overvalued|undervalued|market value/);
});

test("classifies valuation decision from implied upside thresholds", () => {
  const attractiveWacc: WACCState = {
    ...wacc,
    fetchedData: {
      ...wacc.fetchedData!,
      marketCap: 1_000_000_000,
      totalDebt: 0,
      totalCash: 0,
    },
  };

  const result = buildDcfValuation({
    forecast,
    wacc: attractiveWacc,
    fcfMargin: 0.25,
    terminalGrowth: 0.025,
  });

  assert.equal(result.decision.action, "BUY");
  assert.match(result.decision.summary, /undervalued/i);
});

// ── Hybrid / SOTP path ───────────────────────────────────────────────────────
// Builds a segment whose rows use the short "FY26".."FY30" fiscal-year labels —
// the format that was previously dropped by parseAbsoluteFiscalYear.
function hybridArtifact(segment: string, baseRevenue: number): Step5StructuredResult {
  const a = artifact();
  return {
    ...a,
    machine_artifact: {
      ...a.machine_artifact,
      forecast_table: [0, 1, 2, 3, 4].map((i) => {
        const value = baseRevenue * (1 + i * 0.05);
        return {
          segment,
          category: "Segment Forecast",
          product: null,
          fiscal_year: `FY${26 + i}`, // "FY26" … "FY30"
          quarter: null,
          revenue_low_usd_m: value * 0.95,
          revenue_base_usd_m: value,
          revenue_high_usd_m: value * 1.05,
          yoy_growth_pct: 5,
          assumption_ids: ["A1"],
          driver_quality: "DISCLOSED",
          flags: [],
        };
      }),
    },
  };
}

const hybridForecast: ForecastState = {
  approved: true,
  segments: [],
  structuredResults: [hybridArtifact("Bank Unit", 1000), hybridArtifact("Tech Unit", 200)],
};

const hybridWacc: WACCState = {
  ...wacc,
  businessType: "hybrid",
  // Sensible leverage: net debt ($1,000M) is well below the firm's enterprise value,
  // so each stream stays solvent after its value-weighted share is subtracted.
  fetchedData: { ...wacc.fetchedData!, totalDebt: 1_500_000_000, totalCash: 500_000_000 },
  hybridSegments: [
    { id: "b", name: "Bank Unit", unleveredBeta: 0.5, estimatedValue: 1000, workflowMode: "bank" },
    { id: "t", name: "Tech Unit", unleveredBeta: 1.0, estimatedValue: 200, workflowMode: "industrial" },
  ],
  bankKeCalculation: { ...wacc.calculation!, wacc: 0.08 },
  industrialWaccCalculation: { ...wacc.calculation!, wacc: 0.10 },
};

test("hybrid: bank segment labeled FY26..FY30 is included, not silently dropped", () => {
  const result = buildDcfValuation({
    forecast: hybridForecast,
    wacc: hybridWacc,
    fcfMargin: 0.25,
    terminalGrowth: 0.025,
    bankFcfMargin: 0.20,
    financialTerminalGrowth: 0.025,
    industrialTerminalGrowth: 0.025,
  });

  assert.equal(result.valuationMode, "HYBRID");
  assert.ok(result.hybridFinancialStream);
  // FY1 of the bank stream must equal the labeled FY26 revenue (1000). Before the
  // fix these rows parsed to null, fell through to a relative regex, and were
  // discarded — leaving a zero bank stream.
  assert.equal(result.hybridFinancialStream!.forecastRows[0].revenueUsdM, 1000);
  assert.equal(result.hybridFinancialStream!.equityValueUsdM > 0, true);
  // This artifact has no modeled FCFE, so the bank stream falls back to revenue × margin
  // (1000 × 0.20 = 200) and surfaces a proxy warning.
  assert.equal(result.hybridFinancialStream!.forecastRows[0].fcffUsdM, 200);
  assert.equal(result.warnings.some((w) => /proxy/.test(w)), true);
});

test("hybrid: bank terminal-growth flows into headline equity and streams reconcile", () => {
  const base = buildDcfValuation({
    forecast: hybridForecast, wacc: hybridWacc,
    fcfMargin: 0.25, terminalGrowth: 0.025, bankFcfMargin: 0.20,
    financialTerminalGrowth: 0.025, industrialTerminalGrowth: 0.025,
  });
  const higherBankTg = buildDcfValuation({
    forecast: hybridForecast, wacc: hybridWacc,
    fcfMargin: 0.25, terminalGrowth: 0.025, bankFcfMargin: 0.20,
    financialTerminalGrowth: 0.034, industrialTerminalGrowth: 0.025,
  });

  // Raising ONLY the bank terminal growth must increase the headline equity.
  // (Before the fix the bank stream used the industrial terminal growth, so this
  // slider changed only the display card, not intrinsic value.)
  assert.equal(higherBankTg.equityValueUsdM > base.equityValueUsdM, true);

  // The two displayed streams must sum to the headline equity (within rounding).
  const sum =
    base.hybridFinancialStream!.equityValueUsdM + base.hybridIndustrialStream!.equityValueUsdM;
  assert.equal(Math.abs(sum - base.equityValueUsdM) <= 0.2, true);
});

// Bank artifact that DOES carry modeled FCFE (here 10% of revenue), distinct from the
// 20% fallback margin so tests can tell which path the valuation used.
function hybridArtifactWithFcfe(segment: string, baseRevenue: number): Step5StructuredResult {
  const a = hybridArtifact(segment, baseRevenue);
  return {
    ...a,
    machine_artifact: {
      ...a.machine_artifact,
      forecast_table: a.machine_artifact.forecast_table.map((row) => ({
        ...row,
        net_income_usd_m: row.revenue_base_usd_m * 0.12,
        fcfe_usd_m: row.revenue_base_usd_m * 0.10,
      })),
    },
  };
}

const hybridForecastWithFcfe: ForecastState = {
  approved: true,
  segments: [],
  structuredResults: [hybridArtifactWithFcfe("Bank Unit", 1000), hybridArtifact("Tech Unit", 200)],
};

test("hybrid: bank stream discounts modeled FCFE when present, not revenue × margin", () => {
  const result = buildDcfValuation({
    forecast: hybridForecastWithFcfe, wacc: hybridWacc,
    fcfMargin: 0.25, terminalGrowth: 0.025, bankFcfMargin: 0.20, // proxy would yield 200
    financialTerminalGrowth: 0.025, industrialTerminalGrowth: 0.025,
  });
  // FY1 bank cash flow equals modeled FCFE (1000 × 0.10 = 100), NOT revenue × 0.20 (= 200).
  assert.equal(result.hybridFinancialStream!.forecastRows[0].fcffUsdM, 100);
  // No proxy fallback warning when FCFE is complete.
  assert.equal(result.warnings.some((w) => /proxy/.test(w)), false);
});

test("hybrid: consolidated net debt is shared across both streams, not dumped on industrial", () => {
  const common = {
    fcfMargin: 0.25, terminalGrowth: 0.025, bankFcfMargin: 0.20,
    financialTerminalGrowth: 0.025, industrialTerminalGrowth: 0.025,
  };
  const withDebt = buildDcfValuation({ forecast: hybridForecastWithFcfe, wacc: hybridWacc, ...common });
  const noDebtWacc: WACCState = {
    ...hybridWacc,
    fetchedData: { ...hybridWacc.fetchedData!, totalDebt: 0, totalCash: 0 },
  };
  const noDebt = buildDcfValuation({ forecast: hybridForecastWithFcfe, wacc: noDebtWacc, ...common });

  // Removing net debt raises headline equity by exactly the net debt amount.
  assert.equal(
    Math.abs((noDebt.equityValueUsdM - withDebt.equityValueUsdM) - withDebt.netDebtUsdM) <= 0.5,
    true,
  );
  // BOTH stream equities move when net debt is introduced. Under the old rule (100% to
  // industrial) the bank stream would have been identical in both runs.
  assert.notEqual(
    withDebt.hybridFinancialStream!.equityValueUsdM,
    noDebt.hybridFinancialStream!.equityValueUsdM,
  );
  assert.notEqual(
    withDebt.hybridIndustrialStream!.equityValueUsdM,
    noDebt.hybridIndustrialStream!.equityValueUsdM,
  );
});
