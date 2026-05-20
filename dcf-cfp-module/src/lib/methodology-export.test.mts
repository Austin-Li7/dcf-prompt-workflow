import test from "node:test";
import assert from "node:assert/strict";

import { buildMethodologyExport } from "./methodology-export.ts";
import type { CFPState, ValuationSnapshot } from "../types/cfp.ts";
import type { WACCState } from "../types/wacc.ts";

// ── Minimal mock state ────────────────────────────────────────────────────────

const wacc: WACCState = {
  fetchedData: {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    marketCap: 3_000_000_000_000,
    currentPrice: 195,
    sharesOutstanding: 15_400_000_000,
    totalDebt: 110_000_000_000,
    totalCash: 65_000_000_000,
    interestExpense: 3_900_000_000,
    riskFreeRate: 0.0428,
    companyDescription: "Consumer electronics and software.",
    damodaranBeta: 0.93,
  },
  constants: { riskFreeRate: 0.0428, impliedERP: 0.0451, marginalTaxRate: 0.21 },
  businessType: "single",
  singleBeta: 1.18,
  segments: [],
  hybridSegments: [],
  hybridBankBeta: 0.37,
  bankKeCalculation: null,
  industrialWaccCalculation: null,
  calculation: {
    deRatio: 0.15,
    unleveredBeta: 1.05,
    releveredBeta: 1.18,
    costOfEquity: 0.097,
    preTaxCostOfDebt: 0.035,
    afterTaxCostOfDebt: 0.028,
    weightEquity: 0.87,
    weightDebt: 0.13,
    wacc: 0.088,
  },
  saved: true,
  fcfMargin: 0.25,
  terminalGrowth: 0.03,
  bankFcfMargin: 0.20,
  industrialFcfMargin: 0.25,
  fetchedAt: "2026-05-01T12:00:00.000Z",
  liquidityAssessment: null,
  liquidityRiskSpread: 0,
};

const state: CFPState = {
  currentStep: 8,
  isLoading: false,
  error: null,

  profile: {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    marketCap: null,
    currency: "USD",
    fiscalYearEnd: "September",
    lastUpdated: null,
    rawAnalysisMarkdown: "",
    step1StructuredResult: null,
    architectureJson: null,
    step1Review: null,
  },

  history: {
    rows: [],
    confirmedYears: [2022, 2023, 2024],
    structuredResults: [],
    continuity_bridges: [],
  },

  competition: {
    categories: [],
    structuredResult: null,
    step3Review: null,
    approved: true,
  },

  synergies: {
    paths: [],
    synergiesApproved: true,
    capital: null,
    capitalApproved: false,
    recentNews: "",
    structuredResult: null,
    step4Review: null,
  },

  forecast: {
    segments: [],
    structuredResults: [],
    approved: true,
  },

  summary: {
    aggregatedRows: [],
    insights: null,
  },

  capitalAndMoats: {
    debtToEquity: null,
    interestCoverageRatio: null,
    moatType: [],
    moatDurability: null,
    capitalAllocationSummary: "",
  },

  outlook: {
    projectedQuarters: [],
    annualFCFCurve: [],
    assumptions: [],
    modelVersion: "0.1.0-alpha",
  },

  wacc,
};

const snapshot: ValuationSnapshot = {
  valuationMode: "FCFF",
  enterpriseValueUsdM: 3_200_000,
  sumPvFcffUsdM: 1_800_000,
  terminalPresentValueUsdM: 1_400_000,
  totalDebtUsdM: 110_000,
  preferredStockUsdM: 0,
  minorityInterestUsdM: 0,
  totalCashUsdM: 65_000,
  netDebtUsdM: 45_000,
  equityValueUsdM: 3_155_000,
  sharesOutstandingM: 15_400,
  marketCapUsdM: 3_003_000,
  currentPrice: 195,
  intrinsicValuePerShare: 204.87,
  impliedUpsidePct: 5.06,
  fcfMargin: 0.25,
  terminalGrowth: 0.03,
  wacc: 0.088,
  decisionAction: "BUY",
  decisionLabel: "Undervalued",
  decisionSummary: "Intrinsic value above market price.",
  bankKe: null,
  industrialWacc: null,
  bankFcfMargin: null,
  industrialFcfMargin: null,
  financialTerminalGrowth: null,
  industrialTerminalGrowth: null,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

test("buildMethodologyExport: produces all 8 steps", () => {
  const result = buildMethodologyExport(state, snapshot);

  assert.equal(result.steps.length, 8);
  const stepNumbers = result.steps.map((s) => s.step);
  for (let i = 1; i <= 8; i++) {
    assert.ok(stepNumbers.includes(i), `step ${i} missing`);
  }
});

test("buildMethodologyExport: meta fields are populated", () => {
  const result = buildMethodologyExport(state, snapshot);

  assert.equal(result.meta.company, "Apple Inc.");
  assert.equal(result.meta.ticker, "AAPL");
  assert.equal(result.meta.valuation_mode, "FCFF");
  assert.equal(result.meta.version, "v5.5");
  assert.equal(result.meta.tool, "DCF Prompt Workflow");
  assert.ok(result.meta.generated_at.startsWith("20"), "generated_at should be an ISO timestamp");
});

test("buildMethodologyExport: Step 7 WACC field names map correctly", () => {
  const result = buildMethodologyExport(state, snapshot);
  const step7 = result.steps.find((s) => s.step === 7)!;

  assert.ok(step7, "Step 7 must be present");

  // Market data block — damodaran_beta must come from fetchedData.damodaranBeta
  const mkt = step7.data.market_data as Record<string, unknown>;
  assert.ok(mkt, "market_data must be present");
  assert.equal(mkt.damodaran_beta, 0.93, "damodaran_beta");
  assert.equal(mkt.current_price, 195);
  assert.equal(mkt.ticker, "AAPL");

  // WACC components block — field names must match the camelCase→snake_case mapping
  const comp = step7.data.wacc_components as Record<string, unknown>;
  assert.ok(comp, "wacc_components must be present");
  assert.equal(comp.after_tax_cost_of_debt, 0.028, "after_tax_cost_of_debt");
  assert.equal(comp.weight_equity, 0.87, "weight_equity");
  assert.equal(comp.weight_debt, 0.13, "weight_debt");
  assert.equal(comp.relevered_beta, 1.18, "relevered_beta");
  assert.equal(comp.cost_of_equity, 0.097, "cost_of_equity");

  // Top-level WACC/Ke
  assert.equal(step7.data.wacc_or_ke, 0.088);
  assert.equal(step7.data.terminal_growth_rate, 0.03);
  assert.equal(step7.data.saved, true);
});

test("buildMethodologyExport: Step 8 data matches snapshot", () => {
  const result = buildMethodologyExport(state, snapshot);
  const step8 = result.steps.find((s) => s.step === 8)!;

  assert.equal(step8.data.enterprise_value_usd_m, 3_200_000);
  assert.equal(step8.data.equity_value_usd_m, 3_155_000);
  assert.equal(step8.data.intrinsic_value_per_share, 204.87);
  assert.equal(step8.data.wacc_used, 0.088);
  assert.equal(step8.data.decision_action, "BUY");
  assert.equal(step8.data.valuation_mode, "FCFF");
});

test("buildMethodologyExport: valuation_summary duplicates Step 8 data", () => {
  const result = buildMethodologyExport(state, snapshot);
  const step8 = result.steps.find((s) => s.step === 8)!;

  assert.deepEqual(result.valuation_summary, step8.data);
});

test("buildMethodologyExport: each step has required shape", () => {
  const result = buildMethodologyExport(state, snapshot);

  for (const step of result.steps) {
    assert.ok(typeof step.step === "number", `step ${step.step}: step must be number`);
    assert.ok(typeof step.name === "string" && step.name.length > 0, `step ${step.step}: name must be non-empty string`);
    assert.ok(typeof step.methodology === "string" && step.methodology.length > 0, `step ${step.step}: methodology must be non-empty string`);
    assert.ok(Array.isArray(step.lineage.receives_from), `step ${step.step}: lineage.receives_from must be array`);
    assert.ok(Array.isArray(step.lineage.produces_for), `step ${step.step}: lineage.produces_for must be array`);
    assert.ok(typeof step.data === "object" && step.data !== null, `step ${step.step}: data must be object`);
  }
});
