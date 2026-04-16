# ════════════════════════════════════════
# STEP 4 — Synergy & Driver Eligibility
# ════════════════════════════════════════

# ──────────────────────────
# 🔴 STEP 4 GENERATION (default = driver-focused)
# ──────────────────────────

"""
# Step 4: Synergy and Driver Eligibility

## Input
- Step 1 machine_artifact
- Step 2 machine_artifact
- Step 3 machine_artifact

## v5.5 Objective
Do not maximize narrative richness.
Maximize downstream usefulness for Step 5.

The question is not:
"Can we tell an interesting ecosystem story?"

The question is:
"Can this relationship legally and logically enter the forecast as a driver?"

## Single-Segment Rule
If company has one reportable segment only:
output no cross-segment synergy artifact
workflow_status=READY
next_action=PROCEED_STEP4_5

## Required Output
```json
{
  "machine_artifact": {
    "synergy_registry": [
      {
        "synergy_id": "",
        "source_business": "",
        "recipient_business": "",
        "integration_verdict": "PROVEN / PARTIAL / NOT_PROVEN",
        "differentiation_verdict": "PROVEN / PARTIAL / NOT_PROVEN / SKIPPED_LIGHT_MODE",
        "causality_verdict": "PROVEN / PARTIAL / NOT_PROVEN",
        "classification": "fully_verified_synergy / integration_only / context_only / unsupported",
        "driver_eligibility": "FULL / CAPPED_3PP / CAPPED_2PP / CONTEXT_ONLY / NOT_ALLOWED",
        "basis_claim_ids": [],
        "financial_metric_link": "",
        "human_review_required": false
      }
    ],
    "workflow_status": "READY / NEEDS_REVIEW / BLOCKED",
    "next_action": "PROCEED_STEP4_5 / HUMAN_REVIEW_SYNERGY_DRIVER / REGENERATE"
  }
}
```

## v5.5 Compression Rules
1. Default output should emphasize:
   - classification
   - driver_eligibility
   - financial_metric_link
2. Flywheel analysis is optional and Full Mode only.
3. If a synergy does not alter Step 5 treatment, keep it brief.

## Reviewer Summary
List only:
- synergies allowed to drive numbers
- synergies capped
- synergies disallowed
- any weak-inference concentration risk

## UI Handoff
Show:
- top 3 approved cross-business drivers
- whether any are weak-inference dependent
- confidence note
"""


# ──────────────────────────
# 🟢 CHECKPOINT A — Citation Specificity
# ──────────────────────────

"""
For each synergy:
source_specificity=SPECIFIC / VAGUE
failure_reason=[NO_PAGE / NO_SECTION / N/A]
"""


# ──────────────────────────
# 🟢 CHECKPOINT B — Verdict Completeness
# ──────────────────────────

"""
For each synergy:
integration=YES / NO
differentiation=YES / NO / SKIPPED
causality=YES / NO
overall=COMPLETE / INCOMPLETE
"""


# ──────────────────────────
# 🟢 CHECKPOINT C — Self-Contradiction
# ──────────────────────────

"""
If note contains caveat language but evidence level is DISCLOSED:
status=CONTRADICTION
recommended_action=DOWNGRADE
Else:
status=OK
"""


# ──────────────────────────
# 🟡 STEP 4 CLAIM-SUPPORT-FIT
# ──────────────────────────

"""
Audit each driver-relevant synergy for:
integration_fit=FULL / PARTIAL / NONE
differentiation_fit=FULL / PARTIAL / NONE / SKIPPED
causality_fit=FULL / PARTIAL / NONE
classification_check=CORRECT / TOO_STRONG / TOO_WEAK
driver_eligibility_check=CORRECT / TOO_PERMISSIVE / TOO_RESTRICTIVE
recommended_action=KEEP / DOWNGRADE / HUMAN_REVIEW
"""


# ──────────────────────────
# ⚫ STEP 4 GATE
# ──────────────────────────

"""
HARD STOP:
- unsupported synergy marked as forecastable
- contradiction unresolved on a driver-relevant synergy

MUST FIX:
- over-labeled causality
- missing claim links for allowed drivers

AUTO-PAUSE:
- a major growth driver depends on weak evidence but materially changes Step 5

PROCEED when:
- Step 5 can safely consume driver_eligibility without narrative ambiguity
"""
