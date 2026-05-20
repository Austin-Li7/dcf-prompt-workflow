import type { CFPState, ValuationSnapshot } from "@/types/cfp";

// =============================================================================
// Methodology JSON Export
// Produces a structured audit trail: per-step methodology description +
// the actual lineage data values extracted from CFPState at export time.
// =============================================================================

export interface StepLineage {
  receives_from: string[];
  produces_for: string[];
}

export interface StepExport {
  step: number;
  name: string;
  methodology: string;
  lineage: StepLineage;
  data: Record<string, unknown>;
}

export interface MethodologyExport {
  meta: {
    tool: string;
    version: string;
    company: string;
    ticker: string | null;
    generated_at: string;
    valuation_mode: string;
  };
  steps: StepExport[];
  valuation_summary: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Per-step static methodology text
// -----------------------------------------------------------------------------

const STEP_METHODOLOGY: Record<number, { name: string; methodology: string; lineage: StepLineage }> = {
  1: {
    name: "Company Profile",
    methodology:
      "Parses uploaded SEC filings (10-K annual report and/or 10-Q quarterly report) using Claude to extract the company's business architecture. Produces two parallel views: a 'reported view' that mirrors exactly how the company segments its own revenue in the filing, and a 'normalized analysis view' of canonical segments and business lines. Every assertion is backed by a claim with a four-tier evidence level (DISCLOSED → STRONG_INFERENCE → WEAK_INFERENCE → UNSUPPORTED) and a source citation. The user reviews and approves canonical names before any downstream step proceeds. The approved company_type flag (industrial / financial_bank / financial_insurance / hybrid) determines which DCF pipeline—FCFF/WACC or FCFE/Ke—runs in Steps 5–8.",
    lineage: {
      receives_from: ["SEC filing PDFs (user-uploaded)"],
      produces_for: [
        "company_type → selects FCFF vs FCFE pipeline for Steps 5–8",
        "canonical segment names → row identifiers for Steps 2–6",
        "business line names → sub-segment structure for Step 5 forecasting",
        "ticker → market data seed for Step 7 WACC fetch",
      ],
    },
  },
  2: {
    name: "Historical Financial Data",
    methodology:
      "Extracts historical revenue, cost, and cash-flow line items from the same SEC filings, organized by fiscal year and segment. Supports multi-year ingestion (up to 5 confirmed fiscal years). Segment rows are matched to the canonical segment names locked in Step 1 via continuity bridges when the company restructured its reporting segments between periods. The confirmed fiscal-year revenue series sets the growth baseline for Step 5 forecasting, and the most recent two years appear as 'historical anchor rows' in the Step 8 cash-flow projection table.",
    lineage: {
      receives_from: [
        "canonical segment names from Step 1",
        "SEC filing PDFs (same uploads or new filings)",
      ],
      produces_for: [
        "historical revenue baseline → anchor rows in Step 8 DCF table",
        "segment-level revenue history → growth baseline for Step 5 forecast",
        "continuity bridges → segment restructuring audit record",
      ],
    },
  },
  3: {
    name: "Competitive Landscape",
    methodology:
      "Maps each canonical segment or business line to its primary competitor using Porter's Five Forces analysis. For each category, the tool assesses rivalry intensity, threat of new entrants, supplier power, buyer power, and threat of substitutes—each rated Low / Medium / High with a justification. Materiality (HIGH / MEDIUM / LOW) and pairing confidence (VALIDATED / PROVISIONAL / LOW_EVIDENCE) are assigned per category. The approved competitor set appears in the Step 8 'Market Sanity Check' panel as an external cross-check for implied valuation multiples.",
    lineage: {
      receives_from: ["canonical segment names from Step 1"],
      produces_for: [
        "primary competitors → Market Sanity Check in Step 8",
        "competitive status (Leader / Challenger) → qualitative risk context",
        "Porter forces ratings → qualitative risk adjustment inputs",
      ],
    },
  },
  4: {
    name: "Synergies & Capital Allocation",
    methodology:
      "Identifies cross-segment capability penetration paths—cases where a core capability in one business line creates measurable financial benefit in another. Each path is classified as Material Synergy, Adjacent Revenue, or Disputed based on integration, differentiation, and causality verdicts. Driver eligibility (FULL / CAPPED_3PP / CAPPED_2PP / CONTEXT_ONLY / NOT_ALLOWED) determines whether the synergy can be expressed as an additive revenue driver in the Step 5 forecast. A parallel capital allocation analysis produces an investment matrix linking strategic pillars to capital intensity and efficiency scores.",
    lineage: {
      receives_from: ["canonical segment and business line names from Step 1"],
      produces_for: [
        "approved synergy paths → eligible revenue drivers in Step 5 assumptions",
        "driver eligibility flags → caps on forecast growth attribution",
        "capital allocation matrix → qualitative input for forecast conservatism",
      ],
    },
  },
  5: {
    name: "Revenue Forecasting",
    methodology:
      "Generates a 5-year annual (or quarterly) revenue forecast for each canonical segment. Each forecast row is backed by an assumption with a driver quality label (DISCLOSED / STRONG / WEAK / ESTIMATED_BASE), an arithmetic trace, and a management override flag. The confidence summary reports what percentage of FY5 revenue is supported by disclosed vs inferred drivers. For financial companies, each segment additionally carries NIM%, net income, provisions for credit losses, regulatory capital increase, and derived FCFE—enabling the FCFE/Ke valuation path in Steps 7–8. The approved Step 5 forecast is the primary revenue input for the Step 8 DCF model.",
    lineage: {
      receives_from: [
        "canonical segment names from Step 1",
        "historical revenue baseline from Step 2",
        "eligible synergy drivers from Step 4",
      ],
      produces_for: [
        "5-year revenue forecast → discounted cash flow rows in Step 8",
        "FCFE values (financial mode) → FCFE/Ke stream in Step 8",
        "assumption registry → Top Model Drivers panel in Step 8",
        "audit flags → Audit Flags panel in Step 8",
      ],
    },
  },
  6: {
    name: "Consolidated Forecast Summary",
    methodology:
      "Aggregates the per-segment Step 5 forecasts into a master revenue table, computing FY1–FY5 totals and 5-year CAGRs by segment and company-wide. Claude generates qualitative insights identifying the top growth engines and a conclusion on revenue shift and ecosystem resilience. For hybrid companies, separate industrial and bank summaries are produced. The aggregated rows feed the historical-plus-forecast view in the Step 8 cash-flow table.",
    lineage: {
      receives_from: ["approved segment forecasts from Step 5"],
      produces_for: [
        "aggregated FY1–FY5 revenue totals → Step 8 DCF revenue inputs",
        "top growth engines → qualitative context for valuation narrative",
      ],
    },
  },
  7: {
    name: "WACC / Discount Rate",
    methodology:
      "Fetches live market data for the confirmed ticker (current price, shares outstanding, total debt, total cash, beta) and combines it with the user-selected business-type mode to compute the discount rate. Industrial single-business: standard CAPM-to-WACC via Hamada re-levering. Conglomerate: value-weighted blended beta across segments. Financial / bank: Ke-only using the Damodaran unlevered bank beta—no D/E re-levering because debt is an operating input for banks. Hybrid SOTP: two parallel calculations (bank Ke + industrial WACC) that produce two separate equity-value streams in Step 8. The saved WACC and terminal growth rate are the discount rate inputs for the Step 8 DCF.",
    lineage: {
      receives_from: [
        "ticker from Step 1",
        "company_type from Step 1 (determines WACC mode)",
        "live market data (price, shares, debt, cash, beta)",
      ],
      produces_for: [
        "WACC / Ke → discount rate applied to every forecast year in Step 8",
        "terminal growth rate → terminal value calculation in Step 8",
        "total debt, total cash → equity bridge in Step 8",
        "shares outstanding → intrinsic value per share in Step 8",
        "current market price → upside/downside calculation in Step 8",
      ],
    },
  },
  8: {
    name: "DCF Valuation Dashboard",
    methodology:
      "Normalizes the forecast package from Step 5/6, applies the WACC from Step 7, and produces the full DCF model. For FCFF mode: each forecast year's revenue is multiplied by the FCF margin assumption to derive FCFF, discounted at WACC, and summed with a Gordon Growth terminal value → Enterprise Value. The equity bridge then deducts total debt and preferred stock, adds cash, and divides by shares outstanding → Intrinsic Value per Share. For FCFE mode: pre-computed FCFE values from Step 5 are discounted at Ke → Equity Value directly (no EV bridge needed). For Hybrid SOTP: two parallel streams are computed and their equity values summed. Historical revenue rows from Step 2 are shown above the forecast rows as a visual continuity anchor.",
    lineage: {
      receives_from: [
        "5-year revenue forecast from Step 5",
        "FCFE values (financial mode) from Step 5",
        "WACC / Ke from Step 7",
        "total debt, total cash, shares outstanding from Step 7",
        "historical revenue baseline from Step 2",
        "competitor benchmarks from Step 3",
        "assumption registry and audit flags from Step 5",
      ],
      produces_for: ["final intrinsic value per share and investment signal"],
    },
  },
};

// -----------------------------------------------------------------------------
// Data extractors — pull actual values from CFPState per step
// -----------------------------------------------------------------------------

function extractStep1Data(state: CFPState): Record<string, unknown> {
  const p = state.profile;
  const arch = p.architectureJson;
  const s1 = p.step1StructuredResult;

  return {
    company_name: p.companyName || null,
    ticker: p.ticker || null,
    company_type: s1?.company_type ?? null,
    review_approved: p.step1Review?.approved ?? false,
    segments: arch?.architecture.map((a) => a.segment) ?? [],
    business_lines: arch?.architecture.map((a) => ({
      segment: a.segment,
      lines: a.businessLines.map((l) => ({
        name: l.name,
        customer_type: l.customerType,
        products: l.products,
      })),
    })) ?? [],
    sources_count: s1?.sources.length ?? 0,
    claims_count: s1?.claims.length ?? 0,
    evidence_distribution: s1
      ? {
          DISCLOSED: s1.claims.filter((c) => c.evidence_level === "DISCLOSED").length,
          STRONG_INFERENCE: s1.claims.filter((c) => c.evidence_level === "STRONG_INFERENCE").length,
          WEAK_INFERENCE: s1.claims.filter((c) => c.evidence_level === "WEAK_INFERENCE").length,
          UNSUPPORTED: s1.claims.filter((c) => c.evidence_level === "UNSUPPORTED").length,
        }
      : null,
    reported_view_type: s1?.reported_view.view_type ?? null,
    excluded_items_count: s1?.analysis_view.excluded_items.length ?? 0,
  };
}

function extractStep2Data(state: CFPState): Record<string, unknown> {
  const h = state.history;
  const byYear = new Map<number, number>();
  for (const row of h.rows) {
    if (row.revenue != null) {
      byYear.set(row.fiscalYear, (byYear.get(row.fiscalYear) ?? 0) + row.revenue);
    }
  }
  const revenueByYear = Array.from(byYear.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, rev]) => ({ fiscal_year: year, total_revenue_usd_m: rev }));

  const segmentsWithData = [...new Set(h.rows.map((r) => r.segment).filter(Boolean))];

  return {
    confirmed_fiscal_years: h.confirmedYears,
    revenue_by_year: revenueByYear,
    segments_covered: segmentsWithData,
    total_rows: h.rows.length,
    continuity_bridges_count: h.continuity_bridges?.length ?? 0,
    structured_results_count: h.structuredResults?.length ?? 0,
  };
}

function extractStep3Data(state: CFPState): Record<string, unknown> {
  const c = state.competition;
  const cats = c.structuredResult?.categories ?? [];

  return {
    approved: c.approved,
    categories_total: c.categories.length,
    materiality_distribution: {
      HIGH: cats.filter((x) => x.materiality === "HIGH").length,
      MEDIUM: cats.filter((x) => x.materiality === "MEDIUM").length,
      LOW: cats.filter((x) => x.materiality === "LOW").length,
    },
    primary_competitors: cats
      .filter((x) => x.materiality !== "LOW")
      .map((x) => ({
        category: x.category,
        competitor: x.primary_competitor,
        status: x.competitive_status,
        confidence: x.confidence,
      })),
    review_status: c.step3Review?.workflowStatus ?? null,
  };
}

function extractStep4Data(state: CFPState): Record<string, unknown> {
  const s = state.synergies;
  const materialPaths = s.paths.filter(
    (p) => p.synergyClassification === "Material Synergy",
  );
  const eligibleDrivers = s.paths.filter(
    (p) => p.driverEligibility === "FULL" || p.driverEligibility?.startsWith("CAPPED"),
  );

  return {
    synergies_approved: s.synergiesApproved,
    capital_approved: s.capitalApproved,
    total_paths: s.paths.length,
    material_synergies: materialPaths.length,
    eligible_drivers: eligibleDrivers.length,
    capital_pillars:
      s.capital?.investmentMatrix.map((m) => ({
        pillar: m.pillar,
        capital_intensity: m.capitalIntensity,
        efficiency_score: m.efficiencyScore,
      })) ?? [],
    top_synergies: materialPaths.slice(0, 5).map((p) => ({
      source: p.sourceBusiness,
      recipient: p.recipientBusiness,
      capability: p.coreCapability,
      driver_eligibility: p.driverEligibility,
      impact_score: p.impactScore,
    })),
  };
}

function extractStep5Data(state: CFPState): Record<string, unknown> {
  const f = state.forecast;
  const structuredResults = f.structuredResults ?? [];

  const allForecastRows = structuredResults.flatMap(
    (r) => r.machine_artifact.forecast_table,
  );

  const byFY: Record<string, number> = {};
  for (const row of allForecastRows) {
    byFY[row.fiscal_year] = (byFY[row.fiscal_year] ?? 0) + row.revenue_base_usd_m;
  }

  const confidenceSummary =
    structuredResults.length > 0
      ? structuredResults[structuredResults.length - 1].machine_artifact.confidence_summary
      : null;

  const topAssumptions = structuredResults
    .flatMap((r) => r.machine_artifact.assumptions)
    .filter((a) => a.driver_quality === "DISCLOSED" || a.driver_quality === "STRONG")
    .slice(0, 5)
    .map((a) => ({
      id: a.id,
      statement: a.statement,
      driver_quality: a.driver_quality,
    }));

  return {
    approved: f.approved,
    segments_forecasted: f.segments.map((s) => s.segment),
    forecast_revenue_by_fy: byFY,
    confidence_summary: confidenceSummary,
    top_assumptions: topAssumptions,
    structured_results_count: structuredResults.length,
    valuation_method: structuredResults[0]?.valuation_method ?? null,
  };
}

function extractStep6Data(state: CFPState): Record<string, unknown> {
  const s = state.summary;
  const totalRows = s.aggregatedRows.filter((r) => r.isTotal);
  const totalRow = totalRows[0];

  return {
    aggregated_segments: s.aggregatedRows.filter((r) => !r.isSubtotal && !r.isTotal).map((r) => ({
      segment: r.segment,
      fy1_usd_m: r.fy1,
      fy5_usd_m: r.fy5,
      cagr_pct: r.cagr,
    })),
    company_total: totalRow
      ? {
          fy1_usd_m: totalRow.fy1,
          fy2_usd_m: totalRow.fy2,
          fy3_usd_m: totalRow.fy3,
          fy4_usd_m: totalRow.fy4,
          fy5_usd_m: totalRow.fy5,
          cagr_pct: totalRow.cagr,
        }
      : null,
    insights_available: s.insights !== null,
  };
}

function extractStep7Data(state: CFPState): Record<string, unknown> {
  const w = state.wacc;
  const calc = w.calculation;
  const fetchedData = w.fetchedData;

  return {
    saved: w.saved,
    business_type: w.businessType,
    wacc_or_ke: calc?.wacc ?? null,
    terminal_growth_rate: w.terminalGrowth,
    fcf_margin: w.fcfMargin,
    bank_fcf_margin: w.bankFcfMargin,
    market_data_fetched_at: w.fetchedAt,
    market_data: fetchedData
      ? {
          ticker: fetchedData.ticker,
          current_price: fetchedData.currentPrice ?? null,
          shares_outstanding_m: fetchedData.sharesOutstanding
            ? fetchedData.sharesOutstanding / 1e6
            : null,
          total_debt_usd_m: fetchedData.totalDebt / 1e6,
          total_cash_usd_m: fetchedData.totalCash ? fetchedData.totalCash / 1e6 : null,
          damodaran_beta: fetchedData.damodaranBeta ?? null,
          risk_free_rate: fetchedData.riskFreeRate,
        }
      : null,
    wacc_components: calc
      ? {
          cost_of_equity: calc.costOfEquity,
          after_tax_cost_of_debt: calc.afterTaxCostOfDebt,
          weight_equity: calc.weightEquity,
          weight_debt: calc.weightDebt,
          relevered_beta: calc.releveredBeta,
          unlevered_beta: calc.unleveredBeta,
        }
      : null,
    bank_ke: w.bankKeCalculation?.wacc ?? null,
    industrial_wacc: w.industrialWaccCalculation?.wacc ?? null,
  };
}

function extractStep8Data(snapshot: ValuationSnapshot): Record<string, unknown> {
  return {
    valuation_mode: snapshot.valuationMode,
    enterprise_value_usd_m: snapshot.enterpriseValueUsdM,
    sum_pv_fcff_usd_m: snapshot.sumPvFcffUsdM,
    terminal_present_value_usd_m: snapshot.terminalPresentValueUsdM,
    total_debt_usd_m: snapshot.totalDebtUsdM,
    preferred_stock_usd_m: snapshot.preferredStockUsdM,
    minority_interest_usd_m: snapshot.minorityInterestUsdM,
    total_cash_usd_m: snapshot.totalCashUsdM,
    net_debt_usd_m: snapshot.netDebtUsdM,
    equity_value_usd_m: snapshot.equityValueUsdM,
    shares_outstanding_m: snapshot.sharesOutstandingM,
    market_cap_usd_m: snapshot.marketCapUsdM,
    current_price: snapshot.currentPrice,
    intrinsic_value_per_share: snapshot.intrinsicValuePerShare,
    implied_upside_pct: snapshot.impliedUpsidePct,
    fcf_margin_used: snapshot.fcfMargin,
    terminal_growth_used: snapshot.terminalGrowth,
    wacc_used: snapshot.wacc,
    decision_action: snapshot.decisionAction,
    decision_label: snapshot.decisionLabel,
    decision_summary: snapshot.decisionSummary,
    hybrid_bank_ke: snapshot.bankKe ?? null,
    hybrid_industrial_wacc: snapshot.industrialWacc ?? null,
    hybrid_bank_fcf_margin: snapshot.bankFcfMargin ?? null,
    hybrid_industrial_fcf_margin: snapshot.industrialFcfMargin ?? null,
  };
}

// -----------------------------------------------------------------------------
// Main export builder
// -----------------------------------------------------------------------------

export function buildMethodologyExport(
  state: CFPState,
  snapshot: ValuationSnapshot,
): MethodologyExport {
  const extractors: Record<number, (s: CFPState) => Record<string, unknown>> = {
    1: extractStep1Data,
    2: extractStep2Data,
    3: extractStep3Data,
    4: extractStep4Data,
    5: extractStep5Data,
    6: extractStep6Data,
    7: extractStep7Data,
  };

  const steps: StepExport[] = Object.entries(STEP_METHODOLOGY).map(([numStr, meta]) => {
    const num = Number(numStr);
    const data =
      num === 8 ? extractStep8Data(snapshot) : (extractors[num]?.(state) ?? {});
    return {
      step: num,
      name: meta.name,
      methodology: meta.methodology,
      lineage: meta.lineage,
      data,
    };
  });

  return {
    meta: {
      tool: "DCF Prompt Workflow",
      version: "v5.5",
      company: state.profile.companyName || "Unknown",
      ticker: state.profile.ticker || null,
      generated_at: new Date().toISOString(),
      valuation_mode: snapshot.valuationMode,
    },
    steps,
    valuation_summary: extractStep8Data(snapshot),
  };
}

export function downloadMethodologyExport(
  state: CFPState,
  snapshot: ValuationSnapshot,
): void {
  const payload = buildMethodologyExport(state, snapshot);
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yyyy = now.getFullYear();
  const safeName = (state.profile.companyName || "company")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .toLowerCase();

  a.href = url;
  a.download = `${safeName}-methodology-${mm}-${dd}-${yyyy}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
