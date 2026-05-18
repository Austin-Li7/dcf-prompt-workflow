import { NextRequest, NextResponse } from "next/server";
import { callLLM, resolveApiKey } from "@/lib/llm-service";
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
      forces: {
        rivalry: c.forces.rivalry.rating,
        newEntrants: c.forces.newEntrants.rating,
        suppliers: c.forces.suppliers.rating,
        buyers: c.forces.buyers.rating,
        substitutes: c.forces.substitutes.rating,
      },
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
      targetSegment,
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

    // DeepSeek V3 hard-caps output at 8 192 tokens.
    // Instruct it to produce a minimal-but-valid artifact that fits within that budget.
    const isDeepSeek = llmProvider === "deepseek";
    const outputConstraint = isDeepSeek
      ? `\nOutput size constraint (provider cap = 8 192 output tokens): Use SEGMENT_ANNUAL forecast_mode. Write at most 4 assumptions; keep each arithmetic_trace ≤ 80 characters. Omit weak_inference_sensitivity rows unless the driver contributes > 15 % of FY5 revenue. Keep all string fields as short as possible.\n`
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
- No prose outside the structured response.

${modeRules}`;

    const result = await callLLM({
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
