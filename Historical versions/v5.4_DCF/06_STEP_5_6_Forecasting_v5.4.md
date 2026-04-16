# ════════════════════════════════
# STEP 5/6 — Forecasting
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 5 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 5: High-Granularity Quarterly Financial Forecasting (5-Year)

## Input (ALL must have passed gates)
- Business Architecture (Step 1): [PASTE JSON]
- Historical Baseline (Step 2): [PASTE CSV]
- Competitive Resistance (Step 3A, and 3B if Full Mode): [PASTE]
- Synergy Multipliers (Step 4): [PASTE AUDITED matrix with final evidence levels]
- Capital Feasibility (Step 4.5): [PASTE]

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## ⭐ Segment-Only Fallback (v5.4 — NEW)
Review Step 2 disclosure inventory:
If the majority (>50%) of Step 1 products are marked [NOT_SEPARATELY_REPORTED]:
→ Switch to SEGMENT-ONLY FORECAST MODE
→ Forecast at segment level only (skip product → category → segment summation)
→ Step 6 master table shows segment-level rows only
→ Tag: [SEGMENT_ONLY_FORECAST — insufficient product-level disclosure]

## ⭐ Restatement History Depth (v5.4)
If Step 2 flagged [SHORT_HISTORY: N years]:
→ CAGR lookback = N years (not 5)
→ Widen Low-High range spread by 50% for affected segments
→ Tag: [SHORT_HISTORY_ADJUSTED]

## CRITICAL RULES

### Rule 1: [FACT] vs [FORECAST] vs [DERIVED] Tagging
Every number tagged:
- [FACT] — from Step 2 actual data
- [FORECAST] — projected by you
- [DERIVED] — calculated from other numbers

NEVER present forecast without [FORECAST] tag.

### Rule 2: Driver Eligibility from Step 4 (v5.1 — QUANTIFIED)

| Step 4 Classification | Step 5 Treatment |
|:---|:---|
| fully_verified_synergy / verified_synergy | ✅ Can drive growth — no cap |
| integration_proven_only / integration_only | ⚠️ Can support growth, but:
|   | (a) Cannot add more than +3pp above Step 2 historical CAGR
|   | (b) Must be tagged [INTEGRATION_ONLY_DRIVER]
|   | (c) If >20% of segment FY5 growth → [HIGH_CONCENTRATION] flag |
| integration_proven_only (causality) | ❌ Cannot drive numbers |
| narrative_synergy | ❌ Context column only, cannot drive growth rates |
| unsupported_synergy | ❌ Must not appear anywhere |

⭐ (v5.4) If Step 3B flagged category as [LOW_EVIDENCE_COMPETITION]:
→ Driver eligibility cap is +2pp (not +3pp) for that category's synergies.

Any assumption relying on [WEAK_INFERENCE] synergy as primary basis
→ tagged [DRIVER_FROM_WEAK_INFERENCE] + in sensitivity table.

### Rule 3: Output as Ranges
Default = RANGE (Low / Base / High), not single point.
- Low = Base minus impact of removing all [WEAK_INFERENCE] drivers
- High = Base plus optimistic scenario on verified drivers

### Rule 4: No Unannounced Events as Milestones
Only ALREADY publicly announced events (cite source).
Speculative → prefix [SPECULATIVE ASSUMPTION:]

### ⭐ Rule 5: Data Resolution Constraint (v5.1 — HARD RULE)

For any entity marked [GROWTH_PCT_ONLY] in Step 2:
- You MAY forecast growth RATES (percentages)
- You MUST NOT output specific dollar revenue unless you:
  1. State it explicitly as [ESTIMATED_BASE]
  2. Show calculation: segment_revenue × estimated_share = $X
  3. Tag share assumption as [WEAK_INFERENCE]
  4. Include in weak-inference sensitivity table

For any entity marked [NOT_SEPARATELY_REPORTED] in Step 2:
- You MUST NOT forecast this entity at all
- Narrative context only. Any dollar number = VIOLATION

For any growth rate marked "incr."/"decl."/"flat" (no specific %) in Step 2:
- You MUST NOT use a specific percentage as if disclosed
- State your assumed % and tag [ESTIMATED_GROWTH_RATE]

### ⭐ Rule 6: Capital Feasibility Constraint (v5.1)

If Step 4.5 flagged [ELEVATED_CAPEX]:
→ Any assumption requiring CapEx/Revenue to increase further
  must be tagged [CAPEX_STRETCH] and justified.

If Step 4.5 found "capital-intensive" (CapEx CAGR ≥ Revenue CAGR):
→ Revenue growth cannot exceed CapEx growth by >5pp without
  explicit scale economics evidence.

If Step 4.5 found [GUIDANCE_DIVERGENCE]:
→ Assumptions deviating from guidance tagged [DEVIATES_FROM_GUIDANCE].

If Step 4.5 ceiling is [NOT_APPLICABLE — ASSET_LIGHT]:
→ Skip ceiling check.

## Assumption Registry (REQUIRED — output BEFORE any numbers)

⭐ (v5.4) Each assumption MUST include an ARITHMETIC TRACE showing how the
stated growth rate produces the actual forecast number. This is the primary
mechanism for preventing numerical non-closure.

```json
{
  "assumptions": [
    {
      "id": "A001",
      "text": "IC segment grows 20% Y/Y in Y1",
      "basis": "Step 2 claim D2-XXX: FY2025 IC growth 21.5%. Discounted 1.5pp for Step 3 High Rivalry.",
      "basis_claim_id": "D2-XXX",
      "basis_evidence_level": "DISCLOSED",
      "synergy_driver": "none",
      "driver_quality": "STRONG",
      "arithmetic_trace": {
        "anchor": "$[Step 2 latest actual Q]M",
        "growth_rate": "20% Y/Y",
        "seasonal_factor": "[Q1 historical share of FY = XX%]",
        "Y1Q1_computed": "$[anchor × 1.20 × seasonal]M",
        "Y1Q1_in_forecast_table": "$[must match computed]M"
      },
      "sensitivity": "±5pp growth = ±$X B revenue in FY5"
    }
  ]
}
```

⭐ (v5.4) ARITHMETIC TRACE RULE: If Y1Q1_computed ≠ Y1Q1_in_forecast_table (>1% gap),
the assumption is NUMERICALLY INCONSISTENT. Fix before outputting forecast tables.

⭐ (v5.1) Each assumption MUST include "basis_claim_id" pointing to a specific
claim_id from Steps 2/3/4. Narrative-only basis without claim_id = VIOLATION.

## Forecasting Logic
- Baseline: Y1Q1 = Step 2 latest actual × (1 + growth rate from registry)
- Seasonality: reference historical Q/Q patterns from Step 2
- Competitive resistance: discount growth where Step 3 = "High" Rivalry
- Synergy acceleration: only verified synergies can accelerate
- Capital feasibility: growth must be supportable by Step 4.5 trajectory
- ⭐ (v5.4) If SEGMENT_ONLY_FORECAST mode: summation = Segments → Consolidated only
- Otherwise: Products → Categories → Segments → Consolidated (±$1M)

## Reasonableness Flags (auto-trigger)
- Y/Y growth >50% for product >$5B revenue → [AGGRESSIVE_GROWTH]
- 5Y CAGR exceeds TAM growth by >2x → [TAM_CONSTRAINT]
- CAGR <-10% without explicit catalyst → [AGGRESSIVE_DECLINE]
- [SPECULATIVE ASSUMPTION] driving >10% of FY5 → [HIGH_UNCERTAINTY]
- ⭐ (v5.1) [INTEGRATION_ONLY_DRIVER] adding >3pp above historical CAGR → [DRIVER_CAP_EXCEEDED]

## Output Per Segment
| Quarter | Rev Low | Rev Base | Rev High | Tag | Y/Y% | Driver (Assumption ID) | Driver Quality | Flags |

## Batch: one segment, then STOP.

---

# Step 6: Consolidated Master Forecast

| Segment | Category | FY+1 | FY+2 | FY+3 | FY+4 | FY+5 | CAGR | Range | Key Drivers | Weak? |

## Standard Sensitivity
| Scenario | Change | FY5 Revenue | CAGR |
|:---|:---|:---|:---|
| Bull | +3pp all | | |
| Base | as forecast | | |
| Bear | -3pp all | | |

## ⭐ Weak-Inference Sensitivity (v5)
| Assumption | Evidence | If REMOVED | FY5 Impact | CAGR Impact | Flag |

## ⭐ Forecast Confidence Summary
```json
{
  "total_FY5_revenue_base": "$XXX B",
  "revenue_from_DISCLOSED_drivers": "$XXX B (XX%)",
  "revenue_from_STRONG_INFERENCE_drivers": "$XX B (XX%)",
  "revenue_from_WEAK_INFERENCE_drivers": "$XX B (XX%)",
  "revenue_from_ESTIMATED_BASE": "$XX B (XX%)",
  "high_uncertainty_flags": N
}
```
"""


# ──────────────────────────
# 🔴 STEP 5/6 GENERATION — LIGHT MODE VARIANT (v5.4)
# Model: Claude Opus / GPT-4o
# Use INSTEAD of Full Mode Step 5/6 when running Light Mode
# ──────────────────────────

"""
# Step 5/6 (Light): Segment-Level Annual Forecast (5-Year)

## Input (ALL must have passed gates)
- Step 1 JSON, Step 2 CSV, Step 3A output, Step 4 (Light) matrix, Step 4.5

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## LIGHT MODE SIMPLIFICATIONS:
- Forecast at SEGMENT LEVEL only (no product-level breakdown)
- ANNUAL granularity (not quarterly) — output FY+1 through FY+5
- Simplified assumption registry (5 fields per assumption)
- Wider default ranges than Full Mode

## Rules: Same as Full Mode Rules 1-6 (tagging, driver eligibility,
ranges, no milestones, data resolution, capital feasibility).

## Segment-Only Fallback: Always active in Light Mode.

## Assumption Registry (SIMPLIFIED — 5 fields)
```json
{
  "assumptions": [
    {
      "id": "A001",
      "text": "IC segment grows 20% Y/Y in Y1",
      "basis_claim_id": "D2-XXX",
      "driver_quality": "STRONG",
      "arithmetic_trace": "Step 2 FY latest = $[X]M × 1.20 = $[Y]M FY+1"
    }
  ]
}
```

## Output — Combined Step 5/6:

| Segment | FY+1 Low | FY+1 Base | FY+1 High | FY+2 | FY+3 | FY+4 | FY+5 | CAGR | Key Driver | Weak? |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| [Seg A] | | | | | | | | | A001 | No |
| **CONSOLIDATED** | | | | | | | | | | |

## Weak-Inference Sensitivity + Forecast Confidence Summary: same format as Full Mode.
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT A — Baseline + Growth + Arithmetic Trace (v5.4 — ENHANCED)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze.

For each segment:

Part 1 — Baseline anchor:
  Step 2 latest actual: [Segment] [QX] = $[A]M
  Step 5 first forecast: Y1 Q1 Base = $[B]M
  Q/Q change = (B-A)/A × 100 = ?%
  WITHIN_RANGE (-15% to +15%) or OUTSIDE_RANGE?

Part 2 — Growth rate consistency (v5.1):
  Step 2 same quarter prior year: [Segment] [QX-4] = $[C]M
  Step 5 Y1 same quarter: Y1 [QX] Base = $[D]M
  Implied Y/Y = (D-C)/C × 100 = [calculated]%
  Stated Y/Y growth in assumption registry = [G]%
  MATCH (within ±1pp) or MISMATCH?

Part 3 — Arithmetic trace verification (v5.4 — NEW):
  From assumption A001 arithmetic_trace:
    anchor = $[X]M, growth = [Y]%, seasonal = [Z]
    Y1Q1_computed = $[W]M
  From forecast table:
    Y1 Q1 Base = $[V]M
  Gap = |W - V| / W × 100 = ?%
  MATCH (within 1%) or TRACE_MISMATCH?
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT B — Summation
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze.

Add these FY+3 Base product revenues for [Segment]:
[LIST: product values]

Sum = ?
Master table says [Segment] FY+3 = $[Z]M

MATCH (±$1M) or MISMATCH?
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT C — Growth Sanity
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a range checker. Do NOT analyze.

Flag any product where:
- CAGR > 40% AND current revenue > $5,000M → FLAG
- CAGR < -10% with no flag in data → FLAG
- Otherwise → OK

[LIST: products with CAGRs]
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT D — Driver Eligibility
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a list comparator. Do NOT analyze.

List A — assumptions with synergy_driver in Step 5:
[LIST: assumption_id, synergy_id, driver_quality]

Question 1: Any assumption where driver_quality = "WEAK_INFERENCE_DEPENDENT"
but NOT tagged [DRIVER_FROM_WEAK_INFERENCE]?
→ YES (list violations) or NO

Question 2 (v5.1): Any assumption where synergy classification is
"integration_proven_only" and the growth increment added exceeds +3pp
above the Step 2 historical CAGR for that segment?
→ YES (list violations) or NO

Question 3 (v5.1): Any assumption with basis_claim_id = "none" or missing?
→ YES (list violations) or NO
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT E — Mid-Horizon Growth Spot-Check (v5.3 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze.

Pick the largest segment by revenue. Check its Y3 growth:

  Step 5 Y3 Q2 Base revenue for [Segment] = $[A]M
  Step 5 Y2 Q2 Base revenue for [Segment] = $[B]M

  Implied Y/Y growth = (A-B)/B × 100 = ?%

  Assumption registry says Y3 growth should be approximately [G]%
  (accounting for stated deceleration/acceleration schedule if any)

  MATCH (within ±2pp) or MISMATCH?

If MISMATCH: the stated assumption and actual forecast numbers diverge
at mid-horizon. Must align before proceeding.
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT F — Seasonality Pattern Check (v5.3 — NEW, Full Mode only)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a pattern checker. Do NOT analyze.

From Step 2, identify the historically strongest quarter (highest Q/Q share
of full-year revenue) for [Segment] over the last 3 fiscal years.

Historical strongest quarter: Q[X] (average share of FY revenue: [Y]%)

Now check Step 5 FY+3 forecast:
  Q1 share = Q1_rev / FY3_total × 100 = ?%
  Q2 share = Q2_rev / FY3_total × 100 = ?%
  Q3 share = Q3_rev / FY3_total × 100 = ?%
  Q4 share = Q4_rev / FY3_total × 100 = ?%

1. Is the historically strongest quarter still the strongest in FY+3?
   → YES (pattern preserved) or NO (flag [SEASONALITY_SHIFT])

2. Is any quarter's share deviating from historical average by >5pp?
   → YES (list which) or NO
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT G — CapEx Ceiling Check (v5.3 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number comparator. Do NOT analyze.

Step 4.5 revenue ceiling: max_implied_FY5_revenue = $[X]M
Step 5/6 FY5 consolidated Base revenue = $[Y]M

Is $[Y]M ≤ $[X]M?
→ WITHIN_CEILING or EXCEEDED

If EXCEEDED: Does Step 5 include a [CAPEX_CEILING_EXCEEDED] flag
with written justification?
→ JUSTIFIED / NOT_JUSTIFIED / NO_FLAG
"""


# ──────────────────────────
# 🟡 STEP 5 CLAIM-SUPPORT-FIT
# Model: Different advanced model
# ──────────────────────────

"""
You are a forecast auditor.

## Task
Check whether forecast assumptions are properly grounded.

For each assumption in the registry:

1. Is the "basis" actually from a [DISCLOSED] or [STRONG_INFERENCE]
   claim in Steps 2/3/4?
   → Trace back: does the cited claim_id exist?
   → Does that claim's AUDITED evidence level match what's stated?
   ⭐ (v5.1) If basis_claim_id is missing or says "none" → VIOLATION

2. If basis references a Step 4 synergy:
   → What was the AUDITED classification after Step 4 CSF?
   → If causality was downgraded to [WEAK_INFERENCE] but this
     assumption treats it as growth driver → VIOLATION
   ⭐ (v5.1) If synergy is "integration_proven_only" and growth
     increment >3pp above historical CAGR → DRIVER_CAP_VIOLATION

3. Are any "milestones" in the forecast based on unannounced events?

4. ⭐ (v5.1) Data resolution check:
   → Does any assumption assign specific dollar revenue to an entity
     that Step 2 marked [GROWTH_PCT_ONLY] or [NOT_SEPARATELY_REPORTED]?
   → If yes → VIOLATION unless tagged [ESTIMATED_BASE]

## Assumptions to audit:
[PASTE: full assumption registry]

## Output per assumption:
```
A-[id]: basis traces to [step/claim_id] — audited evidence level [X]
  Stated level: [Y] → MATCH or MISMATCH
  basis_claim_id present: YES / NO
  If synergy-based: classification = [Z], growth increment = [N]pp
  Driver eligibility: ELIGIBLE / VIOLATION / DRIVER_CAP_VIOLATION
  Data resolution: COMPLIANT / VIOLATION
```
"""


# ──────────────────────────
# 🔵 STEP 5/6 CROSS-MODEL
# Model: Different advanced model, same prompt
# ──────────────────────────

"""
[Run same Step 5 prompt with different model]

Compare — do NOT average:

| Product | Model A CAGR | Model B CAGR | Gap | Status |
|:---|:---|:---|:---|:---|
| X | 22% | 25% | 3pp | CONSENSUS → range [22-25%] |
| Y | 45% | 18% | 27pp | CONFLICT → ⚫ human decides |

⚫ CONFLICT: human must choose. Record reasoning. No auto-merge.
"""


# ──────────────────────────
# ⚫ STEP 5/6 GATE (v5.4 — AUTO-BLOCK + ARITHMETIC TRACE + CAPEX CEILING)
# ──────────────────────────

"""
  Checkpoint A (baseline + growth + trace): X/N range, growth X/N, trace X/N (v5.4)
  Checkpoint B (summation):          X/N match
  Checkpoint C (growth sanity):      X flagged (Full Mode only)
  Checkpoint D (driver):             violations? YES/NO
  Checkpoint E (mid-horizon):        MATCH/MISMATCH
  Checkpoint F (seasonality):        pattern? YES/NO (Full Mode only)
  Checkpoint G (capex ceiling):      WITHIN/EXCEEDED
  Claim-Support-Fit:                 X/N eligible (Full Mode only)
  Cross-model:                       X consensus / Y conflicts (Full Mode only)

GATE RULES (v5.4 — AUTO-BLOCK):

  ⛔ HARD STOP:
    - Any Summation MISMATCH (Checkpoint B)
    - Any missing basis_claim_id (Checkpoint D Q3 = YES)
    - Any Data Resolution VIOLATION (dollar number for [NOT_SEPARATELY_REPORTED] entity)
    - Any untagged WEAK_INFERENCE driver (Checkpoint D Q1 = YES)
    - ⭐ (v5.4) Any TRACE_MISMATCH (Checkpoint A Part 3) — arithmetic trace
      does not produce the forecast number. Must fix computation before proceeding.

  🔧 MUST FIX:
    - Baseline OUTSIDE_RANGE → justify with seasonality evidence or fix
    - Growth rate MISMATCH → align stated % with implied %
    - DRIVER_CAP_VIOLATION → reduce increment to ≤+3pp or upgrade to fully_verified
    - Data resolution issue for [GROWTH_PCT_ONLY] → add [ESTIMATED_BASE] tag
    - Mid-horizon MISMATCH (Checkpoint E) → align Y3 numbers with stated assumptions
    - CapEx ceiling EXCEEDED without justification (Checkpoint G)
      → reduce forecast OR add [CAPEX_CEILING_EXCEEDED] with justification
    - Cross-model CONFLICT → human resolves

  ✅ PROCEED when all HARD STOP clear and MUST FIX resolved.
"""
