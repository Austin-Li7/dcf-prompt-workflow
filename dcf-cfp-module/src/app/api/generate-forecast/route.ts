import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
import { guardedCallLLM } from "@/lib/llm-guard";
import {
  GEMINI_STEP5_RESPONSE_SCHEMA,
  STEP5_RESPONSE_SCHEMA,
  buildStep5BaselineContext,
  parseStep5StructuredResult,
  projectStep5StructuredToProducts,
  reanchorStep5ForecastToBaselines,
} from "@/lib/step5-schema";
import type {
  BusinessArchitecture,
  CompetitiveLandscape,
  GenerateForecastResponse,
  HistoricalData,
  LLMProvider,
  ProductForecast,
  SynergiesAndDrivers,
  TrendAnalysisResult,
} from "@/types/cfp";

// =============================================================================
// Legacy parse helpers (kept for fallback path)
// =============================================================================

function parseProducts(raw: string): ProductForecast[] {
  const tryArr = (s: string) => {
    try { const p = JSON.parse(s); if (Array.isArray(p)) return p; } catch { /* skip */ }
    return null;
  };
  let r = tryArr(raw.trim());
  if (r) return r;
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(raw)) !== null) { r = tryArr(m[1].trim()); if (r) return r; }
  const arr = raw.match(/\[[\s\S]*\]/);
  if (arr) { r = tryArr(arr[0]); if (r) return r; }
  return [];
}

function parseJsonObject(raw: string): unknown {
  const tryObj = (s: string) => {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* skip */ }
    return null;
  };
  const direct = tryObj(raw.trim());
  if (direct) return direct;
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(raw)) !== null) {
    const fenced = tryObj(match[1].trim());
    if (fenced) return fenced;
  }
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const extracted = tryObj(objectMatch[0]);
    if (extracted) return extracted;
  }
  throw new Error("No JSON object found in model response.");
}

// =============================================================================
// Context compression — strip metadata/blob fields the LLM doesn't need
// These functions cut token usage by ~80% vs sending raw state objects.
// =============================================================================

/**
 * Strip sources, dataSource, and products arrays from the architecture.
 * The LLM only needs segment names and business line names for Step 5.
 */
function leanArchitecture(arch: BusinessArchitecture | null | undefined) {
  if (!arch) return null;
  return {
    architecture: arch.architecture.map((s) => ({
      segment: s.segment,
      businessLines: s.businessLines.map((bl) => ({
        name: bl.name,
        customerType: bl.customerType || null,
      })),
    })),
  };
}

/**
 * Keep only the last 2 confirmed fiscal years and only the fields the LLM
 * needs to anchor its forecast. Excludes: id, yoyGrowth, notes, review
 * status fields, sourceName/Link/Type, and structuredResults (which are
 * large LLM artifacts from Step 2 and not needed here — baselineContext
 * already extracts the key revenue anchors).
 */
function leanHistory(history: HistoricalData | null | undefined) {
  if (!history) return null;
  const rows = history.rows ?? [];
  const sortedYears = [...new Set(rows.map((r) => r.fiscalYear))].sort((a, b) => b - a);
  const keepYears = new Set(sortedYears.slice(0, 2));
  return {
    confirmedYears: history.confirmedYears ?? [],
    rows: rows
      .filter((r) => keepYears.has(r.fiscalYear))
      .map((r) => ({
        fiscalYear: r.fiscalYear,
        quarter: r.quarter,
        segment: r.segment,
        productCategory: r.productCategory,
        productName: r.productName,
        revenue: r.revenue,
        operatingIncome: r.operatingIncome,
        // Bank fields — include only when populated
        ...(r.nii_usd_m != null ? { nii_usd_m: r.nii_usd_m } : {}),
        ...(r.net_interest_margin_pct != null ? { net_interest_margin_pct: r.net_interest_margin_pct } : {}),
        ...(r.provision_for_credit_losses_usd_m != null ? { provision_for_credit_losses_usd_m: r.provision_for_credit_losses_usd_m } : {}),
        ...(r.net_income_usd_m != null ? { net_income_usd_m: r.net_income_usd_m } : {}),
        ...(r.cet1_ratio_pct != null ? { cet1_ratio_pct: r.cet1_ratio_pct } : {}),
        ...(r.book_value_equity_usd_m != null ? { book_value_equity_usd_m: r.book_value_equity_usd_m } : {}),
        ...(r.goodwill_usd_m != null ? { goodwill_usd_m: r.goodwill_usd_m } : {}),
        ...(r.intangible_assets_usd_m != null ? { intangible_assets_usd_m: r.intangible_assets_usd_m } : {}),
        ...(r.preferred_equity_usd_m != null ? { preferred_equity_usd_m: r.preferred_equity_usd_m } : {}),
        // Industrial fields — include only when populated
        ...(r.capex_usd_m != null ? { capex_usd_m: r.capex_usd_m } : {}),
        ...(r.gross_profit_usd_m != null ? { gross_profit_usd_m: r.gross_profit_usd_m } : {}),
        ...(r.depreciation_amortization_usd_m != null ? { depreciation_amortization_usd_m: r.depreciation_amortization_usd_m } : {}),
      })),
  };
}

/**
 * Reduce Step 3 to force ratings only. Strips structuredResult (LLM artifact),
 * step3Review, sources, claims, and justification text. The ratings are what
 * drive the forecast; prose justifications add noise without signal for Step 5.
 */
function leanCompetition(competition: CompetitiveLandscape | null | undefined) {
  if (!competition?.categories?.length) return null;
  return {
    categories: competition.categories.map((c) => ({
      category: c.category,
      primaryCompetitor: c.primaryCompetitor,
      competitiveStatus: c.competitiveStatus,
      materiality: c.materiality ?? null,
      forces: c.forces ? {
        rivalry: c.forces.rivalry?.rating ?? null,
        newEntrants: c.forces.newEntrants?.rating ?? null,
        suppliers: c.forces.suppliers?.rating ?? null,
        buyers: c.forces.buyers?.rating ?? null,
        substitutes: c.forces.substitutes?.rating ?? null,
      } : null,
    })),
  };
}

/**
 * Reduce Step 4 to synergy paths summary + capital ceiling. Strips
 * structuredResult (LLM artifact with claims/sources), recentNews (raw
 * news text — often several KB), and the capital investment matrix details.
 */
function leanSynergies(synergies: SynergiesAndDrivers | null | undefined) {
  if (!synergies) return null;
  const ceilingEntry = synergies.structuredResult?.capital_allocation?.step5_revenue_ceiling;
  const ceiling = ceilingEntry?.applies ? ceilingEntry.ceiling_revenue_usd_m : null;
  return {
    paths: (synergies.paths ?? []).map((p) => ({
      sourceBusiness: p.sourceBusiness,
      recipientBusiness: p.recipientBusiness,
      mechanism: p.mechanism,
      impactScore: p.impactScore,
      driverEligibility: p.driverEligibility ?? null,
      financialSignalType: p.financialSignal?.type ?? null,
      isFlywheel: p.flywheel?.isFlywheel ?? false,
    })),
    capitalCeilingUsdM: ceiling,
    workflowStatus: synergies.step4Review?.workflowStatus ?? null,
  };
}

/**
 * Format the backend trend ceiling for a specific segment into a compact
 * instruction block to be injected into the Step 5 prompt.
 */
function formatSegmentTrendCeiling(
  trendAnalysis: TrendAnalysisResult | null | undefined,
  targetSegment: string,
): string {
  if (!trendAnalysis) return "";
  const r = trendAnalysis.segments[targetSegment];
  if (!r) return "";

  const parts: string[] = [
    "",
    `BACKEND TREND ANALYSIS for "${targetSegment}" (logistic S-curve regression — deterministic, no LLM):`,
  ];

  // Branch on what kind of trend signal we actually have. Three cases:
  //   1. Logistic fit succeeded → real plateau ceiling, behaves as a forward
  //      growth limit (the original intent).
  //   2. Fit failed but series is monotone increasing → informational
  //      historical CAGR only; the prompt must NOT treat it as a ceiling.
  //   3. Fit failed and series is declining / non-monotone / too short →
  //      no number at all; tell the model to derive growth from other inputs.
  if (r.fit_ok && r.calculated_plateau_ceiling_usd_m != null) {
    parts.push(`  Plateau ceiling: $${r.calculated_plateau_ceiling_usd_m.toFixed(0)}M`);
    parts.push(`  Next-year algorithmic growth limit: ${r.modeled_next_year_growth_limit_pct?.toFixed(1) ?? "n/a"}%`);
    parts.push(`  Saturation detected: ${r.is_plateau_detected ? "YES — segment is ≥80% of plateau" : "No"}`);
    parts.push(`  Fit quality (R²): ${r.fit_quality_r2?.toFixed(3) ?? "n/a"}`);
    parts.push(
      "STRATEGIC OVERRIDE RULE: If your modeled yoy_growth_pct exceeds the algorithmic growth limit above,",
      "  you MUST populate growth_justification with the specific named catalyst breaking the mathematical curve",
      "  (e.g. 'Competitor X filed for bankruptcy, releasing Y% of TAM' or 'New product launch expands addressable market by $ZM').",
      "  Vague optimism ('strong demand', 'market tailwinds') is not a valid override.",
      "  If growth_justification is null and yoy_growth_pct > algorithmic limit, set workflow_status to NEEDS_REVIEW.",
    );
  } else if (r.historical_cagr_pct != null) {
    // Informational only — never frame as a ceiling. Sanity floor (C1) still
    // applies: a positive log-linear CAGR is a fine *context* signal even
    // when modest; we don't gate it. Negative CAGRs are blocked upstream by
    // the shape classifier (they'd surface only via fit_ok=true plateau).
    parts.push(`  No plateau fit. Series shape: ${r.series_shape ?? "unknown"}.`);
    parts.push(`  Historical CAGR (log-linear, INFORMATIONAL — do not use as a forward ceiling): ${r.historical_cagr_pct.toFixed(1)}%`);
    parts.push(`  Review note: ${r.review_note}`);
    parts.push(
      "FORECAST GUIDANCE: derive yoy_growth_pct from Step 3 (competitive position) and Step 4",
      "  (synergies, capital allocation, management guidance). Do not anchor your forecast to the historical CAGR above.",
      "  If you choose to project growth above the historical CAGR, document the specific catalyst in growth_justification.",
    );
  } else {
    // Declining, non-monotone, or insufficient — no number is safe to emit.
    parts.push(`  No plateau fit. Series shape: ${r.series_shape ?? "unknown"}.`);
    parts.push(`  ${r.review_note}`);
    parts.push(
      "FORECAST GUIDANCE: the historical revenue series is not a reliable trend anchor for this segment.",
      "  Derive yoy_growth_pct from Step 3 (competitive position), Step 4 (synergies, capital allocation),",
      "  and any management guidance in Step 1. Document the specific drivers in growth_justification.",
      "  Set workflow_status to NEEDS_REVIEW so an analyst confirms the chosen growth rate.",
    );
  }

  return parts.join("\n");
}

/**
 * Detect whether the target segment uses bank/NII-driven revenue.
 * Checks history row workflow_mode and presence of NII data.
 */
function detectBankMode(
  history: HistoricalData | null | undefined,
  targetSegment: string,
): boolean {
  const rows = history?.rows ?? [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const tgt = norm(targetSegment);
  const segRows = rows.filter((r) => {
    const src = norm(r.segment);
    return src === tgt || (tgt.length >= 5 && (src.includes(tgt) || tgt.includes(src)));
  });
  return segRows.some((r) => r.workflow_mode === "bank" || r.nii_usd_m != null);
}

// =============================================================================
// POST /api/generate-forecast
// =============================================================================

export async function POST(req: NextRequest): Promise<NextResponse<GenerateForecastResponse>> {
  try {
    const body = await req.json();
    const {
      step1Architecture,
      step2History,
      step3Competition,
      step4Complete,
      trendAnalysis,
      targetSegment,
      liquidityRiskRating,
      apiKey: runtimeKey,
      llmProvider = "claude" as LLMProvider,
    } = body;

    if (!step1Architecture || !targetSegment) {
      return NextResponse.json(
        { products: [], error: "Architecture and target segment are required." },
        { status: 400 },
      );
    }

    const { apiKey, needsKey } = resolveApiKey(llmProvider, runtimeKey);
    if (needsKey) {
      return NextResponse.json(
        { products: [], error: "No API key found for the selected provider.", requiresApiKey: true },
        { status: 401 },
      );
    }

    // Baseline anchors — compact, already segment-targeted
    const baselineContext = buildStep5BaselineContext(step2History, [targetSegment]);

    // Lean context objects — strip blobs/metadata not needed by Step 5
    const archLean = leanArchitecture(step1Architecture as BusinessArchitecture);
    const historyLean = leanHistory(step2History as HistoricalData);
    const competitionLean = leanCompetition(step3Competition as CompetitiveLandscape);
    const synergiesLean = leanSynergies(step4Complete as SynergiesAndDrivers);

    const isBankMode = detectBankMode(step2History as HistoricalData, targetSegment);
    const trendCeilingBlock = formatSegmentTrendCeiling(trendAnalysis as TrendAnalysisResult | null, targetSegment);

    // DeepSeek V3 hard-caps output at 8 192 tokens.
    // Instruct it to produce a minimal-but-valid artifact that fits within that budget.
    const isDeepSeek = llmProvider === "deepseek";
    const outputConstraint = isDeepSeek
      ? `\nOutput size constraint (provider cap = 8 192 output tokens): Use SEGMENT_ANNUAL forecast_mode. Write at most 4 assumptions; keep each arithmetic_trace ≤ 80 characters. Omit weak_inference_sensitivity rows unless the driver contributes > 15 % of FY5 revenue. Keep all string fields as short as possible.\n`
      : "";

    // Liquidity risk injection — add constraint text for HIGH/CRITICAL ratings
    const liquidityConstraint = isBankMode && (liquidityRiskRating === "HIGH" || liquidityRiskRating === "CRITICAL")
      ? `\nLIQUIDITY RISK CONSTRAINT (Step 7 rating: ${liquidityRiskRating}):
- NIM projections may understate funding cost pressure: elevated wholesale funding reliance means deposit repricing compresses NIM faster than historical trends imply. Apply additional NIM compression of 10–25 bps vs. the historical trend.
- PCL trajectory may be understated: deposit-flight stress and credit deterioration are correlated. Apply a 10–20% uplift to projected provision_for_credit_losses_usd_m vs. baseline loss rates.
- Flag these constraints in review_summary.warnings with code "LIQUIDITY_RISK_CONSTRAINT".`
      : "";

    // Finance rules — only included when the segment is bank/NII-driven
    const modeRules = isBankMode
      ? `Finance & Banking FCFE rules (this segment is NII-driven):
- valuation_method: "FCFE".
- revenue_base_usd_m = NII (Net Interest Income = Earning Assets × NIM). Set nim_pct.
- net_income_usd_m = NII − OpEx − Provision for Credit Losses (efficiency ratio and loss rate from Step 2).
- regulatory_capital_increase_usd_m = Loan Growth × Target CET1 (use disclosed ratio or default 11 %).
- fcfe_usd_m = net_income_usd_m − regulatory_capital_increase_usd_m (can be negative in high-growth years).
- arithmetic_trace format: "NIM (x%) × Earning Assets ($M) → NII ($M) → NII − OpEx − PCL → Net Income ($M) − Reg. Capital ($M) = FCFE ($M)".`
      : `Industrial/non-financial segment: valuation_method = "FCFF". Do not populate nim_pct, net_income_usd_m, provision_for_credit_losses_usd_m, regulatory_capital_increase_usd_m, or fcfe_usd_m.`;

    const prompt = `Task: Produce the Step 5/6 v5.5 forecasting machine artifact for targetSegment: ${targetSegment}.
${outputConstraint}
Step 1 architecture:
${JSON.stringify(archLean)}

Step 2 historical baseline (last 2 fiscal years):
${JSON.stringify(historyLean)}

Step 3 competition — Porter's Five Forces ratings per category:
${JSON.stringify(competitionLean)}

Step 4 synergies — paths and capital ceiling:
${JSON.stringify(synergiesLean)}

Authoritative Step 2 baseline anchors (FY+1 must start from baselineRevenueUsdM):
${JSON.stringify(baselineContext)}
${trendCeilingBlock}

Rules:
- schema_version must be exactly "v5.5".
- Default forecast_mode to SEGMENT_ANNUAL.
- CRITICAL: Every forecast_table row MUST have the segment field set to exactly "${targetSegment}".
- FY+1 revenue must be baselineRevenueUsdM (from anchors above) × (1 + selected growth rate). Do not estimate from total-company revenue.
- Upgrade to SEGMENT_QUARTERLY or PRODUCT_QUARTERLY only when Step 2 has sufficient quarterly disclosure.
- Every forecast row must cite at least one assumption_id that is declared in the assumptions array. Never reference an assumption_id that does not appear in assumptions[].id.
- Every revenue-driving assumption must include arithmetic_trace.
- Do not use CONTEXT_ONLY or NOT_ALLOWED synergies as numeric growth drivers.
- WEAK or capped Step 4 drivers must use driver_quality "WEAK", appear in weak_inference_sensitivity, and set workflow_status to NEEDS_REVIEW when material.
- If capitalCeilingUsdM is set, keep FY5 base revenue below that value or set workflow_status to NEEDS_REVIEW with a warning.
- NEVER set workflow_status to BLOCKED. For segments with no standalone disclosed revenue, set NEEDS_REVIEW, generate a best-effort proxy estimate, and document the proxy in review_summary.warnings.
- Keep review_summary concise: one_line ≤ 260 chars; each highlight/warning ≤ 220 chars.
- yoy_growth_pct MUST be a whole-number percentage (e.g. 8.5 for 8.5% growth, 52.0 for 52% growth). Never use decimal fraction form (e.g. 0.085 is wrong; 8.5 is correct).
- No prose outside the structured response.

${modeRules}
${liquidityConstraint}`;

    const result = await guardedCallLLM({
      provider: llmProvider,
      apiKey,
      prompt,
      maxTokens: 16384,
      responseSchema:
        llmProvider === "gemini"
          ? GEMINI_STEP5_RESPONSE_SCHEMA
          : (STEP5_RESPONSE_SCHEMA as Record<string, unknown>),
      responseToolName: "submit_step5_structured_result",
      responseToolDescription: "Return the Step 5 v5.5 forecasting machine artifact.",
    });

    // Detect token-limit truncation before attempting parse — gives a clear,
    // actionable error instead of the cryptic "No JSON object found" message.
    const truncated =
      (llmProvider === "gemini" && result.finishReason === "MAX_TOKENS") ||
      (llmProvider === "deepseek" && result.finishReason === "length") ||
      (llmProvider === "claude" && result.finishReason === "max_tokens");
    if (truncated) {
      return NextResponse.json(
        {
          products: [],
          error:
            `The model hit its output token limit and returned an incomplete artifact (finish_reason: ${result.finishReason}). ` +
            `Retry once — if the error persists, switch to Claude which supports larger output.`,
        },
        { status: 422 },
      );
    }

    const rawText = result.text;

    let structuredResult;
    try {
      structuredResult = reanchorStep5ForecastToBaselines(
        parseStep5StructuredResult(result.structuredData ?? JSON.parse(rawText)),
        baselineContext,
      );
    } catch (error) {
      const legacyProducts = parseProducts(rawText);
      if (legacyProducts.length > 0) {
        return NextResponse.json({
          products: legacyProducts,
          error:
            "Model returned a legacy Step 5 array instead of the v5.5 machine artifact. Displaying legacy output — regenerate before proceeding.",
        });
      }

      try {
        structuredResult = reanchorStep5ForecastToBaselines(
          parseStep5StructuredResult(parseJsonObject(rawText)),
          baselineContext,
        );
      } catch (fallbackError) {
        const detail = fallbackError instanceof Error ? fallbackError.message : "Unknown parse error.";
        const primary = error instanceof Error ? error.message : "";
        console.error("[generate-forecast] parse failure. rawText[:500]:", rawText.slice(0, 500));
        return NextResponse.json(
          {
            products: [],
            error: `Model did not return a valid Step 5 v5.5 machine artifact. ${detail || primary}`,
          },
          { status: 422 },
        );
      }
    }

    if (!structuredResult) {
      return NextResponse.json(
        { products: [], error: "Model did not return a valid Step 5 v5.5 machine artifact." },
        { status: 422 },
      );
    }

    const products = projectStep5StructuredToProducts(structuredResult, targetSegment);

    if (products.length === 0) {
      return NextResponse.json(
        {
          products: [],
          structuredResult,
          reviewSummary: structuredResult.review_summary,
          workflowStatus: structuredResult.machine_artifact.workflow_status,
          nextAction: structuredResult.machine_artifact.next_action,
          error: "Step 5 artifact did not include forecast rows for the requested segment.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      products,
      structuredResult,
      reviewSummary: structuredResult.review_summary,
      workflowStatus: structuredResult.machine_artifact.workflow_status,
      nextAction: structuredResult.machine_artifact.next_action,
    });
  } catch (err: unknown) {
    console.error("[generate-forecast] Error:", err);
    const msg = err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ products: [], error: msg }, { status: 500 });
  }
}
