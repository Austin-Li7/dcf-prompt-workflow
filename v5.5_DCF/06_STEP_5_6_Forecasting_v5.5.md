# ════════════════════════════════════════
# STEP 5 — Segment-Level Forecasting
# STEP 6 — Master Consolidation & Executive View
# ════════════════════════════════════════
#
# Step 5 = segment-by-segment annual forecast
#          produces the granular forecast_table consumed by Step 6
#
# Step 6 = consolidation, sensitivity, revenue mix shift
#          produces the master artifact consumed by the Final Audit
#          and provides the ui_handoff for the executive view
#
# These are two separate generation prompts and two separate gates.
# Do not merge them into one execution block.
# ════════════════════════════════════════


# ══════════════════════════════════════════════════
# STEP 5 — SEGMENT-LEVEL FORECASTING
# ══════════════════════════════════════════════════

# ──────────────────────────
# 🔴 STEP 5 GENERATION (default = Light-first, segment-first)
# ──────────────────────────

"""
# Step 5: Segment-Level Forecasting

## Input (all must have passed their gates)
- Step 1 machine_artifact  → canonical name registry, segment list
- Step 2 machine_artifact  → history_rows, disclosure_inventory, rollup_checks
- Step 3 machine_artifact  → competitor pairings, rivalry signals, LOW_EVIDENCE_COMPETITION flags
- Step 4 machine_artifact  → synergy_registry, driver_eligibility per synergy
- Step 4.5 machine_artifact → step5_revenue_ceiling, asset_light_exemption

## What this step must produce
A segment-level annual forecast for FY+1 through FY+5 with:
- one assumption per material growth driver, each arithmetically traceable
- Low / Base / High range for every segment and consolidated total
- weak-inference exposure explicitly isolated and quantified
- confidence breakdown by evidence quality tier

Step 6 will consume this output directly. Do not skip or abbreviate
any field in the machine_artifact — Step 6 cannot consolidate what
is not here.

## v5.5 Default Mode
Segment-level annual forecast.
Upgrade to quarterly or product-level only if BOTH are true:
1. Step 2 disclosure_inventory supports it (majority of segments have quarterly dollars)
2. business or user explicitly requires it

## Required Machine Artifact
```json
{
  "step5_artifact": {
    "forecast_mode": "SEGMENT_ANNUAL / SEGMENT_QUARTERLY / PRODUCT_QUARTERLY",
    "forecast_anchor": {
      "latest_actual_period": "",
      "fy1_label": "",
      "fy2_label": "",
      "fy3_label": "",
      "fy4_label": "",
      "fy5_label": ""
    },
    "assumptions": [
      {
        "id": "A001",
        "statement": "",
        "basis_claim_ids": [],
        "driver_quality": "DISCLOSED / STRONG / WEAK / ESTIMATED_BASE",
        "driver_eligibility_source": "",
        "arithmetic_trace": "",
        "management_override_required": false
      }
    ],
    "forecast_table": [
      {
        "segment": "",
        "fiscal_year": "FY+1",
        "revenue_low_usd_m": 0,
        "revenue_base_usd_m": 0,
        "revenue_high_usd_m": 0,
        "yoy_growth_base_pct": 0,
        "primary_assumption_id": "A001"
      }
    ],
    "weak_inference_sensitivity": [
      {
        "assumption_id": "A001",
        "segment_affected": "",
        "if_removed_fy5_revenue_delta_usd_m": 0,
        "if_removed_cagr_delta_pp": 0
      }
    ],
    "confidence_summary": {
      "total_fy5_revenue_base_usd_m": 0,
      "disclosed_pct": 0,
      "strong_inference_pct": 0,
      "weak_inference_pct": 0,
      "estimated_base_pct": 0
    },
    "workflow_status": "READY / NEEDS_REVIEW / BLOCKED",
    "next_action": "PROCEED_STEP6 / HUMAN_REVIEW_MAJOR_ASSUMPTION / REGENERATE / REGENERATE_SEGMENT"
  }
}
```

Note: `next_action` now points to PROCEED_STEP6, not PROCEED_STEP7.
Step 5 feeds Step 6. Step 6 feeds the Final Audit.

## Execution Order
1. Set forecast_anchor (actual fiscal year labels) from Step 2 history_rows.
2. Output the full assumption registry before any forecast numbers.
3. Forecast one segment at a time; add a CONSOLIDATED row after all segments.
4. Populate weak_inference_sensitivity for every WEAK or ESTIMATED_BASE assumption.
5. Compute and output confidence_summary last.

## Mode Selection Rules

### Rule 1 — Segment-first default
Use SEGMENT_ANNUAL unless there is a positive reason to go deeper.

### Rule 2 — Product-level upgrade only when:
- majority of forecast-relevant entities have separate disclosure
- Step 2 inventory supports product granularity
- no major name / mapping conflicts remain

### Rule 3 — Weak evidence containment
Any weak-inference driver must be:
- tagged [WEAK_INFERENCE_DEPENDENT]
- isolated in weak_inference_sensitivity with quantified FY+5 impact
- reflected in confidence_summary.weak_inference_pct

### Rule 4 — Arithmetic Trace
Every assumption that directly drives a forecast number must include arithmetic_trace.
Format: "Step 2 [segment] [latest period] = $[X]M × [growth rate] = $[Y]M FY+1"
If arithmetic_trace computed value does not match forecast_table (>1% gap):
→ NUMERICALLY INCONSISTENT — fix before outputting anything else.

### Rule 5 — Data Resolution Constraint
Enforce based on Step 2 disclosure_status for each entity:
- NOT_SEPARATELY_REPORTED: no forecast dollars allowed under any condition
- GROWTH_PCT_ONLY: growth rates permitted; any dollar estimate must be tagged
  [ESTIMATED_BASE], calculation must be shown, and must appear in weak_inference_sensitivity
- Violation of either = HARD STOP

### Rule 6 — Driver Eligibility Cap
For any assumption where driver_eligibility_source references a Step 4 synergy:
- fully_verified_synergy: no cap
- integration_only synergy: max +3pp above Step 2 historical CAGR for that segment
- If Step 3B flagged LOW_EVIDENCE_COMPETITION for that category: cap is +2pp
- context_only / not_allowed synergy: cannot drive forecast numbers at all
- Exceeding cap: tag [DRIVER_CAP_EXCEEDED] and set human_review_required=true

### Rule 7 — Guidance / Capital discipline
If assumption deviates from management guidance or Step 4.5 capital feasibility:
- tag it explicitly
- elevate in reviewer_summary
- do not hide in prose

### Rule 8 — Forecast Anchor
Set forecast_anchor before outputting any forecast numbers.
Use actual fiscal year labels (e.g. "FY2025" through "FY2029"), not relative labels.
This ensures Step 6, the Final Audit, and Step 7 all refer to the same time periods.

### Rule 9 — Range Construction
Low = Base minus the combined FY impact of removing all WEAK and ESTIMATED_BASE drivers.
High = Base plus optimistic scenario on fully_verified_synergy drivers only.
Every segment and the CONSOLIDATED row must have Low / Base / High.

## Reviewer Summary
- forecast mode selected and why
- forecast_anchor (latest actual period and FY labels)
- top 5 assumptions: id, driver_quality, segment, growth rate
- weak-inference exposure: % of FY+5 revenue and dollar amount
- major deviations from Step 2 historical trend or management guidance
- any [DRIVER_CAP_EXCEEDED] or [ESTIMATED_BASE] tags present
- workflow_status and next_action

## UI Handoff
- base case growth path: consolidated FY+1 to FY+5
- top 3 growth drivers (names only, no internals)
- uncertainty level: LOW / MEDIUM / HIGH based on weak_inference_pct
- whether any human override was used

## Human Review Trigger (H3)
Any of the following → workflow_status = NEEDS_REVIEW:
- major segment growth materially above Step 2 history without strong basis
- assumption depends on weak evidence and changes FY+5 consolidated by >5%
- product-level mode chosen despite weak disclosure
- [DRIVER_CAP_EXCEEDED] present on any segment >10% of consolidated FY+5 revenue
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT A — Baseline and Arithmetic Trace
# ──────────────────────────

"""
For each sampled segment:

Part 1 — Baseline anchor:
  Step 2 latest actual: [Segment] = $[A]M ([period])
  Step 5 FY+1 Base = $[B]M
  Change = (B-A)/A × 100 = ?%
  WITHIN_RANGE (-15% to +15%) or OUTSIDE_RANGE?

Part 2 — Growth rate consistency:
  Stated Y/Y growth in assumption registry = [G]%
  Implied Y/Y from forecast_table FY+1 / Step 2 latest - 1 = [calc]%
  MATCH (within ±1pp) or MISMATCH?

Part 3 — Arithmetic trace verification:
  From assumption arithmetic_trace:
    anchor = $[X]M, growth = [Y]%
    computed FY+1 = $[W]M
  From forecast_table FY+1 Base = $[V]M
  Gap = |W - V| / W × 100 = ?%
  MATCH (within 1%) or TRACE_MISMATCH?

baseline_check=MATCH / OUTSIDE_RANGE
growth_check=MATCH / MISMATCH
trace_check=MATCH / TRACE_MISMATCH
failure_reason=[BAD_BASELINE / BAD_GROWTH_MATH / BAD_TRACE / N/A]
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT B — Segment Summation
# ──────────────────────────

"""
Add FY+3 Base revenues for all segments:
[LIST: segment name = $value M]

Sum = $?M
Step 5 CONSOLIDATED FY+3 Base = $[Z]M
Gap = |Sum - Z| = $?M

sum_check=MATCH (within $1M) / MISMATCH
failure_reason=[ROLLUP_ERROR / MISSING_SEGMENT / N/A]
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT C — Growth Sanity
# ──────────────────────────

"""
Flag any segment where:
- 5Y CAGR > 40% AND FY+1 revenue > $5,000M → FLAG [AGGRESSIVE_GROWTH]
- 5Y CAGR < -10% with no explicit catalyst in assumptions → FLAG [AGGRESSIVE_DECLINE]
- 5Y CAGR exceeds Step 2 implied TAM growth by >2x → FLAG [TAM_CONFLICT]
- Otherwise → OK

entity=[segment name]
status=OK / FLAG
failure_reason=[AGGRESSIVE_GROWTH / AGGRESSIVE_DECLINE / TAM_CONFLICT / N/A]
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT D — Driver Eligibility and Data Resolution
# ──────────────────────────

"""
For each assumption that references a Step 4 synergy or Step 2 entity:

Q1: Is any weak-inference driver not tagged [WEAK_INFERENCE_DEPENDENT]?
→ YES (list violations) or NO

Q2: Does any integration_only synergy add more than +3pp above Step 2
historical CAGR for that segment? (or +2pp if LOW_EVIDENCE_COMPETITION flagged for that category)
→ YES (list violations with: assumption_id, segment, actual increment, cap) or NO

Q3: Does any assumption have missing or null basis_claim_ids?
→ YES (list violations) or NO

Q4: Does any assumption assign dollar revenue to an entity marked
NOT_SEPARATELY_REPORTED in Step 2?
→ YES (HARD STOP) or NO

Q5: Does any assumption assign dollar revenue to a GROWTH_PCT_ONLY entity
without an [ESTIMATED_BASE] tag and the full calculation shown?
→ YES (list violations) or NO

assumption=[id]
eligibility_check=CORRECT / TOO_PERMISSIVE
failure_reason=[WEAK_DRIVER_UNTAGGED / INTEGRATION_CAP_BROKEN / UNSUPPORTED_DRIVER / DATA_RESOLUTION_VIOLATION / N/A]
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT E — Mid-Horizon Growth Consistency
# ──────────────────────────

"""
Pick the largest segment by FY+1 base revenue.

  FY+3 Base / FY+2 Base - 1 = [calculated]%
  Assumption registry stated Y3 growth rate for that segment = [stated]%
  Difference = |calculated - stated| = ?pp
  MATCH (within ±2pp) or MISMATCH?

If MISMATCH: stated assumption and actual forecast numbers diverge
at mid-horizon. Align before proceeding to Step 6.

mid_horizon_check=MATCH / MISMATCH
failure_reason=[MID_HORIZON_DRIFT / N/A]
"""


# ──────────────────────────
# 🟢 STEP 5 CHECKPOINT F — CapEx Ceiling Cross-Check
# ──────────────────────────

"""
From Step 4.5:
  asset_light_exemption = [true / false]
  ceiling_revenue_usd_m = [X] (only if step5_revenue_ceiling.applies = true)

Step 5 CONSOLIDATED FY+5 Base = $[Y]M

If asset_light_exemption = true → ceiling_check = N/A
If step5_revenue_ceiling.applies = false → ceiling_check = N/A
Otherwise:
  Is Y ≤ X? → WITHIN_CEILING or EXCEEDED
  If EXCEEDED: is [CAPEX_CEILING_EXCEEDED] tag present with written justification?
  → JUSTIFIED / NOT_JUSTIFIED / NO_FLAG

ceiling_check=WITHIN_CEILING / EXCEEDED / N/A
failure_reason=[CEILING_BREACH_UNJUSTIFIED / N/A]
"""


# ──────────────────────────
# 🟡 STEP 5 AUDIT
# ──────────────────────────

"""
Audit only material assumptions and material segments.

For each sampled assumption:
claim_link_check=VALID / MISSING
trace_check=VALID / INVALID
driver_quality_check=CORRECT / OVERSTATED
driver_cap_check=WITHIN_CAP / EXCEEDED
data_resolution_check=COMPLIANT / VIOLATION
consumption_check=STEP6_SAFE / NOT_SAFE
recommended_action=KEEP / FIX / HUMAN_REVIEW
"""


# ──────────────────────────
# ⚫ STEP 5 GATE
# ──────────────────────────

"""
HARD STOP (block Step 6):
- arithmetic trace mismatch on any material assumption (Checkpoint A Part 3)
- unsupported entity receives forecast dollars
- disallowed synergy used as a driver
- dollar revenue assigned to NOT_SEPARATELY_REPORTED entity (Checkpoint D Q4)
- missing basis_claim_ids on any material assumption (Checkpoint D Q3)

MUST FIX before proceeding to Step 6:
- weak driver not tagged [WEAK_INFERENCE_DEPENDENT] (Checkpoint D Q1)
- guidance deviation not surfaced in reviewer_summary
- mode too granular for disclosure quality
- integration_only cap exceeded without [DRIVER_CAP_EXCEEDED] tag (Checkpoint D Q2)
- GROWTH_PCT_ONLY dollar estimate missing [ESTIMATED_BASE] tag (Checkpoint D Q5)
- CapEx ceiling exceeded without justification (Checkpoint F)
- mid-horizon growth drift (Checkpoint E MISMATCH)
- forecast_anchor missing fiscal year labels
- weak_inference_sensitivity or confidence_summary unpopulated

AUTO-PAUSE (H3):
- [DRIVER_CAP_EXCEEDED] present on segment >10% of consolidated FY+5
- weak_inference_pct > 30% of FY+5 revenue

REGENERATE_SEGMENT:
- Checkpoint A trace or baseline mismatch isolated to one segment
- all other segments are MATCH

PROCEED to Step 6 when:
- all HARD STOP conditions clear
- all MUST FIX resolved
- forecast_anchor has actual FY labels (not relative)
- confidence_summary.total_fy5_revenue_base_usd_m matches CONSOLIDATED FY+5 Base row
- weak_inference_sensitivity has one row per WEAK / ESTIMATED_BASE assumption
- Step 6 can consume every segment row without recalculating internals
"""


# ══════════════════════════════════════════════════
# STEP 6 — MASTER CONSOLIDATION & EXECUTIVE VIEW
# ══════════════════════════════════════════════════

# ──────────────────────────
# 🔴 STEP 6 GENERATION
# ──────────────────────────

"""
# Step 6: Master Consolidation and Executive View

## Input
- Step 5 step5_artifact (must have passed Step 5 Gate)
- Step 1 machine_artifact → canonical segment names for consistency check
- Step 3 machine_artifact → rivalry signals for growth engine rationale
- Step 4 machine_artifact → synergy classification for growth engine rationale

## Purpose
Step 6 is not a re-forecast. It is a consolidation and synthesis layer.

Do NOT recompute assumptions or growth rates here.
Pull numbers directly from Step 5 forecast_table.
Any mismatch between Step 6 and Step 5 numbers is a Step 6 error,
not a Step 5 refinement.

Step 6 produces the artifact that the Final Audit and the human reviewer
use to make a go / no-go decision on the whole forecast. It must be
self-contained, scannable, and free of internal contradictions.

## Required Machine Artifact
```json
{
  "step6_artifact": {
    "step5_forecast_anchor": {
      "latest_actual_period": "",
      "fy1_label": "",
      "fy5_label": ""
    },
    "master_table": [
      {
        "segment": "",
        "fy1_base_usd_m": 0,
        "fy2_base_usd_m": 0,
        "fy3_base_usd_m": 0,
        "fy4_base_usd_m": 0,
        "fy5_base_usd_m": 0,
        "five_year_cagr_pct": 0,
        "fy1_share_of_total_pct": 0,
        "fy5_share_of_total_pct": 0,
        "primary_assumption_ids": [],
        "weak_inference_dependent": false
      }
    ],
    "consolidated_totals": {
      "fy1_low_usd_m": 0,
      "fy1_base_usd_m": 0,
      "fy1_high_usd_m": 0,
      "fy5_low_usd_m": 0,
      "fy5_base_usd_m": 0,
      "fy5_high_usd_m": 0,
      "five_year_cagr_base_pct": 0
    },
    "sensitivity_scenarios": {
      "bull": {
        "description": "+3pp uniform growth across all segments",
        "fy5_revenue_usd_m": 0,
        "five_year_cagr_pct": 0,
        "key_upside_driver": ""
      },
      "base": {
        "description": "as-forecast assumptions",
        "fy5_revenue_usd_m": 0,
        "five_year_cagr_pct": 0
      },
      "bear": {
        "description": "-3pp uniform growth across all segments",
        "fy5_revenue_usd_m": 0,
        "five_year_cagr_pct": 0,
        "key_downside_risk": ""
      }
    },
    "top_growth_engines": [
      {
        "rank": 1,
        "segment": "",
        "five_year_cagr_pct": 0,
        "rationale": "",
        "step3_rivalry_signal": "",
        "step4_synergy_ids": [],
        "weak_inference_dependent": false
      }
    ],
    "revenue_mix_shift": {
      "fy1_mix_description": "",
      "fy5_mix_description": "",
      "notable_shifts": [
        {
          "segment": "",
          "fy1_share_pct": 0,
          "fy5_share_pct": 0,
          "direction": "GROWING / SHRINKING / STABLE"
        }
      ]
    },
    "step5_summation_verified": true,
    "step5_match_check": "MATCH / MISMATCH",
    "weak_inference_exposure_pct": 0,
    "workflow_status": "READY / NEEDS_REVIEW / BLOCKED",
    "next_action": "PROCEED_STEP7 / HUMAN_REVIEW_MAJOR_ASSUMPTION / REGENERATE"
  }
}
```

## Construction Rules

### Rule 1 — Numbers come from Step 5 only
All revenue figures in master_table and consolidated_totals must be
copied directly from Step 5 forecast_table.
Do not recompute, re-estimate, or round differently.

### Rule 2 — Summation verification
After copying, recompute consolidated_totals from master_table rows.
If there is a gap >$1M versus Step 5 CONSOLIDATED row:
→ step5_match_check = MISMATCH
→ workflow_status = BLOCKED
→ Stop and report the discrepancy.

### Rule 3 — Sensitivity scenarios
Bull = each segment's base CAGR + 3pp, applied uniformly.
Bear = each segment's base CAGR - 3pp, applied uniformly.
This is a simple arithmetic shift, not a new forecast.
Show the math: FY+5 Base × (1 + adjusted CAGR) ^ 5 / FY+1 Base.

### Rule 4 — Top growth engines
Rank the top 3 segments by 5Y CAGR.
For each, cite the Step 3 rivalry signal and Step 4 synergy that supports the growth.
If a top engine is weak_inference_dependent=true, flag it explicitly.

### Rule 5 — Revenue mix shift
Compute FY+1 and FY+5 share for each segment.
Identify any segment where fy5_share_pct differs from fy1_share_pct by >5pp.
Describe the structural shift in plain language for the reviewer.

### Rule 6 — Name consistency
All segment names must match Step 1 canonical_names exactly.
Any deviation = HARD STOP.

### Rule 7 — Weak-inference exposure carry-forward
Set weak_inference_exposure_pct = Step 5 confidence_summary.weak_inference_pct.
Do not recalculate. This must be visible in both the reviewer_summary and ui_handoff.

## What the Final Audit consumes from Step 6
The Final Audit uses:
1. consolidated_totals (to verify "Step 6 totals close?")
2. sensitivity_scenarios (to assess whether material uncertainty is hidden)
3. revenue_mix_shift (to assess structural plausibility)
4. weak_inference_exposure_pct (to verify no laundering has occurred)
5. step5_match_check (to verify Step 6 did not introduce errors)

All five of these fields must be populated and non-null before Step 6 Gate can PASS.

## Reviewer Summary
- step5_forecast_anchor (FY labels)
- consolidated FY+1 and FY+5 Base (with Low / High range)
- five_year_cagr_base_pct
- bull / base / bear FY+5 revenue and CAGR
- top 3 growth engines with weakness flags
- key revenue mix shift (which segment grows / shrinks most)
- weak_inference_exposure_pct and dollar amount
- step5_match_check result
- workflow_status and next_action

## UI Handoff
- consolidated base case: FY+1 to FY+5 revenue (chart-ready values)
- range: Low / Base / High at FY+5
- top 3 growth drivers (plain language)
- revenue mix shift (1-2 sentences)
- uncertainty flag if weak_inference_exposure_pct > 20%
- whether human review is pending

## Human Review Trigger
Any of the following → NEEDS_REVIEW:
- top growth engine is weak_inference_dependent=true AND its CAGR > 15%
- bull/bear spread > 25% of base FY+5 revenue (high uncertainty)
- revenue mix shift: any segment moves by >15pp share (structural disruption)
- step5_match_check = MISMATCH
"""


# ──────────────────────────
# 🟢 STEP 6 CHECKPOINT G — Step 5 Summation Cross-Check
# ──────────────────────────

"""
Step 5 CONSOLIDATED FY+5 Base = $[A]M  (from Step 5 forecast_table)
Step 6 consolidated_totals.fy5_base_usd_m = $[B]M  (from master_table sum)
Gap = |A - B| = $?M

step5_match_check=MATCH (within $1M) / MISMATCH
failure_reason=[COPY_ERROR / ROUNDING_DRIFT / N/A]

Also verify FY+1 and FY+3:
fy1_check=MATCH / MISMATCH
fy3_check=MATCH / MISMATCH
"""


# ──────────────────────────
# 🟢 STEP 6 CHECKPOINT H — Revenue Mix Plausibility
# ──────────────────────────

"""
For each segment:
  fy1_share_pct = fy1_base / consolidated_fy1_base × 100 = ?%
  fy5_share_pct = fy5_base / consolidated_fy5_base × 100 = ?%
  shift = fy5_share_pct - fy1_share_pct = ?pp

Flag if:
  |shift| > 15pp → FLAG [LARGE_MIX_SHIFT] — requires rationale in revenue_mix_shift
  A segment drops to <2% of FY+5 revenue → FLAG [NEAR_ZERO_SEGMENT]
  A new segment exceeds 50% of FY+5 revenue → FLAG [CONCENTRATION_RISK]
  Otherwise → OK

segment=[...]
mix_check=OK / FLAG
failure_reason=[LARGE_MIX_SHIFT / NEAR_ZERO_SEGMENT / CONCENTRATION_RISK / N/A]
"""


# ──────────────────────────
# 🟢 STEP 6 CHECKPOINT I — Sensitivity Math Verification
# ──────────────────────────

"""
Bull scenario:
  Apply +3pp to the five_year_cagr_base_pct for each segment.
  Recompute FY+5 for one segment: FY+1 Base × (1 + bull_cagr) ^ 4
  Compare to sensitivity_scenarios.bull.fy5_revenue_usd_m
  MATCH (within 2%) or MISMATCH?

Bear scenario:
  Same check with -3pp.

bull_math_check=MATCH / MISMATCH
bear_math_check=MATCH / MISMATCH
failure_reason=[SENSITIVITY_MATH_ERROR / N/A]
"""


# ──────────────────────────
# ⚫ STEP 6 GATE
# ──────────────────────────

"""
HARD STOP (block Final Audit):
- step5_match_check = MISMATCH (Step 6 numbers don't match Step 5)
- any segment name deviates from Step 1 canonical_names
- consolidated_totals has any null field
- sensitivity_scenarios.bull or .bear is missing or has null fy5_revenue_usd_m

MUST FIX before Final Audit:
- revenue_mix_shift.notable_shifts not populated
- top_growth_engines missing step3_rivalry_signal or step4_synergy_ids
- weak_inference_exposure_pct not carried forward from Step 5
- bull/bear math check fails (Checkpoint I)
- [LARGE_MIX_SHIFT] segment missing rationale

AUTO-PAUSE:
- top growth engine is weak_inference_dependent=true AND CAGR > 15%
- bull/bear spread > 25% of base FY+5

PROCEED to Step 7 and Final Audit when:
- step5_match_check = MATCH
- consolidated_totals fully populated (Low / Base / High for FY+1 and FY+5)
- sensitivity_scenarios bull / base / bear all populated with valid math
- top_growth_engines has 1-3 entries with rationale and claim support
- revenue_mix_shift.notable_shifts populated for all segments with shift >5pp
- weak_inference_exposure_pct matches Step 5 confidence_summary
- Final Audit can consume all five required fields without recalculating internals
"""
