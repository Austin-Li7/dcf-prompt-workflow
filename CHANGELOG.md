# Changelog

All notable changes to the DCF CFP Workflow are documented here.

---

## Version BL.05202026 — 2026-05-20

### Summary
Full-stack improvements across the 8-step DCF pipeline: liquidity risk assessment for bank/financial mode, deterministic CapEx benchmarking, trend-ceiling enforcement, data lineage panels, and wide-ranging schema, UX, and accuracy fixes across Steps 1–8.

---

### New Features

#### Bank Liquidity Assessment (Steps 2, 7 → 5, 6, 8)
- **New `lib/liquidity-assessment.ts`**: pure Basel III liquidity engine — LDR, uninsured deposit concentration, LCR proxy, sequential bank-run stress test (deposit flight → HQLA drain → forced HTM sales → realized losses → equity erosion), RAG rating (LOW / MODERATE / HIGH / CRITICAL), and Ke risk spread (0 / 50 / 100 / 200 bps).
- **Step 2 extraction**: 7 new balance-sheet fields extracted from filings — `total_loans`, `total_deposits`, `retail_insured_deposits`, `wholesale_uninsured_deposits`, `cash_and_hqla`, `htm_bonds`, `unrealized_losses_htm`. Schema updated in `BankChunkRowSchema`, `BankRowSchema`, `HistoricalExtractionRow`, and `Step2BankHistoricalRow`.
- **Step 7 UI**: `LiquidityAssessmentPanel` component with editable balance-sheet inputs, RAG metric chips, interactive stress-test slider (0–100% deposit flight), arithmetic trace, and insolvency alert. Liquidity spread wired into `fullBankKeCalculation` — raises Ke for financial and hybrid modes. Assessment persisted to `CFPContext` on save.
- **Step 5 forecast**: `liquidityRiskRating` passed to `generate-forecast` API; HIGH/CRITICAL ratings inject NIM compression (+10–25 bps) and PCL uplift (+10–20%) constraints into the LLM prompt.
- **Step 6 summary**: `liquidityRiskRating` passed to `generate-summary` API; bank `BANK_SCHEMA` gains a `liquidityRisk` conclusion field; prompt gains Task 4 requesting a funding-risk narrative.
- **Methodology export**: Step 7 snapshot now exports LDR/uninsured/LCR values and RAG statuses, stress-test results, and Ke spread in bps.

#### Deterministic CapEx Benchmarking (Step 4)
- **New `lib/damodaran-capex.ts`**: 50-industry benchmark table (CapEx/Sales, CapEx/D&A ratios) with industry resolver from Step 1 `company_type` and segment keywords.
- **New `lib/capex-efficiency.ts`**: `computeCapExEfficiency()` aggregates Step 2 rows, computes CapEx/D&A zone (Growth / Steady State / Underinvestment) and Damodaran variance flag (High Intensity / In-line / Asset-Light), and emits a deterministic `efficiency_score` baseline (−5 to +5). LLM may adjust ±1 with project evidence.
- **`step2-industrial-schema.ts`**: adds `capex_mda_split` (maintenance vs growth CapEx from MD&A).
- **`analyze-capital/route.ts`**: wires `computeCapExEfficiency()` into the Step 4.5 prompt; `asset_light_exemption` now requires backend confirmation.

#### Step 6 Margin & CAGR Outputs
- **`computeHistoricalMargins()`**: deterministic company-level `gross_margin_pct` and `opex_pct` per fiscal year from Step 2 rows (max-revenue-per-segment-year aggregation to avoid annual/quarterly double-counting).
- **`INDUSTRIAL_SCHEMA`**: new required fields `segmentCagrs[]` and `marginProjections[]`.
- Prompt updated with Task 2 (CAGR for every segment) and Task 3 (FY+1–FY+5 margin projections anchored to historical baseline).
- Historical margins injected as `HISTORICAL MARGIN DATA` block into prompt.

#### Trend Analysis & Ceilings (Step 2 → Step 5)
- **New `api/trend-analysis/route.ts`**: logistic-regression trend engine that computes segment-level growth ceilings from historical data.
- **Continuity bridge**: carries the last confirmed fiscal year forward as an anchor for FY+1 revenue in Step 5 forecasts.
- **Trend ceiling enforcement**: ceiling values wired into Step 5 prompt as hard constraints; lineage panels in Steps 2–7 surface the data provenance.

#### Step 7 & 8 WACC / Valuation Improvements
- Add `validatePreTaxCostOfDebt` (flags implausible 1.5%–15% bounds) and `validateDERatio` (flags D/E > 5).
- WACC sensitivity 3×3 grid (beta ±0.1 × ERP ±0.5%) in `StandardDashboard`.
- Intrinsic value per share + BUY/WATCH/AVOID signal added to `StandardDashboard`.
- Persist `fcfMargin`, `terminalGrowth`, `bankFcfMargin`, `industrialFcfMargin`, `fetchedAt` in `WACCState`; Step 8 seeds from these values.
- Tighten conglomerate detection (require 2 keywords or 1 strong signal; remove false-positive "subsidiaries").
- Expand financial industry keyword list (savings bank, thrift, broker-dealer, wealth management, etc.).
- Add 8 new Damodaran beta entries: metals, precious metals, steel, shipping, agriculture, cybersecurity, data center.
- Step 8: Pipeline Context Header (company name, ticker, business type badge, WACC/Ke, fetch date, missing-step warnings); historical rows shown above FY1–5 forecast table; live competitor data in Market Sanity Check.

---

### Improvements & Fixes

#### Steps 3 & 4 — Schema Gates and Structured Revisions
- Add `Step3WorkflowStatus` / `Step4WorkflowStatus` with `blocked` gate driven by `HARD_STOP_CODES`.
- Rewrite `revise-competition`, `revise-synergies`, `revise-capital` routes: add system prompts, response schemas, and sync `step3Review` / `step4Review` after each revision.
- Add `pairing_status` (VALIDATED / PROVISIONAL / LOW_EVIDENCE) to Step 3 schema and UI; materiality badges, evidence collapsible.
- Rename `CapitalCheckpoints` fields for clarity (`subsidiaryMargin → scaleEconomics`, `investmentEfficiency → guidanceAlignment`).
- Surface `driverEligibility` (color-coded) and `step5RevenueCeiling` card in Step 4 dashboard.
- Fix single-segment 422: empty `synergy_registry` + READY status now returns 200.

#### Step 5 — Schema and Forecasting Rules
- Schema v5.5: define `forecast_table` row schema, `confidence_summary`, `weak_inference_sensitivity`.
- Add quantitative driver eligibility caps (+3pp `integration_only`, +2pp `LOW_EVIDENCE`).
- Add data resolution constraint (`NOT_SEPARATELY_REPORTED` / `GROWTH_PCT_ONLY`).
- Add Checkpoint E (mid-horizon growth consistency) and Checkpoint F (CapEx ceiling cross-check).
- Fix Step 5 context overload; `REGENERATE_SEGMENT` added to `next_action` options.
- Fix schema normalization: `driver_quality` default and `assumption_id` cleanup.

#### Step 1 & 2 — Extraction and Filing Support
- Q4 10-Q support: pipeline now handles Q4 10-Q filings alongside annual 10-K.
- Industrial extraction pipeline with targeted field extraction.
- Fix Step 2 `BinbinMSG` import paths; add `updateChunkStatus` to extraction state.
- Add `deepseek: 50_000` to `PROVIDER_TOKEN_TARGETS` in extraction chunker.

#### TypeScript and Test Quality
- Fix all TypeScript errors in `BinbinMSG` draft files.
- `methodology-export.test.mts`: add missing `liquidityAssessment` and `liquidityRiskSpread` fields to `WACCState` mock.
- All 74 tests pass.

---

### Files Added
| File | Purpose |
|------|---------|
| `src/lib/liquidity-assessment.ts` | Basel III liquidity engine (LDR, LCR proxy, stress test, Ke spread) |
| `src/lib/damodaran-capex.ts` | 50-industry CapEx benchmark table |
| `src/lib/capex-efficiency.ts` | Deterministic CapEx efficiency scorer |

### Files Changed (selected)
`Step7WACC.tsx`, `Step8Valuation.tsx`, `Step5Forecast.tsx`, `Step6Summary.tsx`, `Step3Competition.tsx`, `Step4Synergies.tsx`, `generate-forecast/route.ts`, `generate-summary/route.ts`, `extract-history/route.ts`, `analyze-capital/route.ts`, `wacc-math.ts`, `methodology-export.ts`, `chunk-schema.ts`, `step2-bank-schema.ts`, `step2-industrial-schema.ts`, `types/cfp.ts`, `types/wacc.ts`, `CFPContext.tsx`

---

*Previous versions pre-date this changelog. See git log for full history.*
