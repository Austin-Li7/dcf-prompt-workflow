# ════════════════════════════════
# STEP 2 — Historical Financial Data
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 2 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 2: Historical Financial Data Extraction
# Company: [INSERT TICKER]

## Input
[PASTE: Validated Step 1 JSON]

## Objective
Extract financial data for segments and products in Step 1 JSON.
Provide continuous breakdown covering most recent 5 fiscal years.

## CRITICAL: Disclosure-Bounded Extraction

Before extracting data for ANY entity, classify disclosure level:

| Disclosure Status | Rule |
|:---|:---|
| Quarterly $ revenue separately reported | ✅ EXTRACT with full citation |
| Only annual $ reported | Extract annual only. Mark quarterly as [ANNUAL_ONLY] |
| Only growth % reported (not $ amount) | Extract growth % only. Mark $ as [GROWTH_PCT_ONLY] |
| Only qualitative (e.g., "increased"/"declined", no %) | Mark [QUALITATIVE_GROWTH_ONLY] — do NOT assign a specific percentage |
| Not separately reported at all | Mark [NOT_SEPARATELY_REPORTED] — provide NO numbers |

**Rule: "entities_given_numbers_without_source" MUST be zero.**

## Data Sourcing Rules
- Official Sources Only: SEC filings (10-K, 10-Q) and Earnings Press Releases
- If company restated structure → use RESTATED figures from latest filings
- All monetary values in USD Millions
- If restated quarterly figures unavailable → [QUARTERLY_RESTATEMENT_NOT_AVAILABLE]

### ⭐ Name Consistency (v5.4 — applies to ALL generation steps 2-7)
VERIFY before output: every segment/product name matches Step 1 canonical_names
or its listed abbreviation. No other variants. Violation = STRUCTURAL ERROR.

### ⭐ Restatement History Depth (v5.4 — NEW)
If restated data covers fewer than 5 fiscal years:
→ Set HISTORY_DEPTH = [number of restated years available]
→ Tag [SHORT_HISTORY: N years] in self-check output
→ This value propagates to Step 5: CAGR lookback must use HISTORY_DEPTH, not 5
→ If computed Q4 as residual (FY - Q1 - Q2 - Q3) yields negative or > 2× average of Q1-Q3:
  tag [IMPLAUSIBLE_RESIDUAL] and mark as [UNVERIFIED]

## Output Method: CLAIMS FIRST, THEN TABLES

### Phase 1: Disclosure Inventory
```json
{
  "disclosure_inventory": {
    "entities_in_step1": "[total]",
    "entities_with_quarterly_dollar_data": "[count]",
    "entities_with_annual_dollar_data_only": "[count]",
    "entities_with_growth_pct_only": "[count]",
    "entities_with_qualitative_growth_only": "[count]",
    "entities_not_separately_reported": "[count]",
    "entities_given_numbers_without_source": 0
  }
}
```

### Phase 2: Structured Data Claims
For each data point:
```
CLAIM: [claim_id]
TEXT: [the factual data statement]
SOURCE_SNIPPET: [exact number from filing table — e.g., "$26,707"]
SOURCE_LOCATION: [filing type, period, table/exhibit name, page]
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / DERIVED]
BASIS: [as-reported / restated]
```

Evidence levels for data:
- DISCLOSED: Number appears directly in a filing table or text
- STRONG_INFERENCE: Calculated from disclosed numbers in one step (show calculation)
- DERIVED: Growth rates, margins, ratios from disclosed values

**Rule: Never mark a calculated number as [DISCLOSED].**

### Phase 3: Markdown Tables
For entities with quarterly $ data: full table with Claim ID + Evidence Level + Source
For entities with growth % only: growth rate table (NO dollar estimates)
For entities with qualitative growth only: note "increased"/"declined" verbatim — NO % assigned
For [NOT_SEPARATELY_REPORTED]: list only, NO table

### Phase 4: Rollup Validation
For each fiscal year:
```json
{
  "rollup_check": {
    "fiscal_year": "FY20XX",
    "segment_sum": "[sum]",
    "reported_consolidated": "[from filing]",
    "gap": "[difference]",
    "gap_pct": "[X.XX%]",
    "status": "PASS (<0.5%) or FAIL"
  }
}
```

### Phase 5: Anomaly Flags
- Revenue drops >20% Q/Q without known cause → [ANOMALY]
- Growth rate swings >30pp Y/Y → [VOLATILITY]
- Operating margin changes >500bp Q/Q → [MARGIN_SHIFT]

### Phase 6: CSV Output
```
Fiscal_Year,Quarter,Segment,Product,Revenue_USD_M,Claim_ID,Evidence_Level,Source,Basis,Flags
```

## Batch 1: All operating segments. Batch 2: Product-level growth rates.
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT A — Rollup Math
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze or explain.

Add these numbers:
[PASTE: all segment revenue values for a given fiscal year]

Total = ?

Reported consolidated revenue: $[X]M (source: [filing])

Difference = ?
Percentage difference = ?

Reply: MATCH (if <0.5%) or MISMATCH
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT B — Spot-Check 3 Numbers
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number verifier. Do NOT analyze or explain.

Claim 1: "[Segment X] revenue in [Quarter] was $[Y]M"
Here is the revenue table from [filing]:
[PASTE: relevant table]
What number does the table show? $___M → MATCH or MISMATCH?

Claim 2: "[Segment Y] revenue in [Quarter] was $[Z]M"
Source table: [PASTE] → MATCH or MISMATCH?

Claim 3: "[Segment Z] annual revenue in [FY] was $[W]M"
Source table: [PASTE] → MATCH or MISMATCH?
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT C — Zero Fabrication
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a list comparator. Do NOT analyze or explain.

List A — entities with specific dollar revenue numbers in Step 2:
[LIST: entity names with $ numbers]

List B — entities marked [NOT_SEPARATELY_REPORTED] in Step 2:
[LIST: entity names marked not reported]

List C — entities marked [GROWTH_PCT_ONLY] in Step 2:
[LIST: entity names with growth % only]

Question 1: Any entity in BOTH List A and List B? → YES (list them) or NO
Question 2: Any entity in BOTH List A and List C? → YES (list them) or NO
(An entity with growth % only should NOT also have dollar revenue numbers)

→ Any YES = fabrication detected. Must fix.
"""


# ──────────────────────────
# 🟢 STEP 2 CHECKPOINT D — Y/Y Growth Arithmetic (v5.3 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a calculator. Do NOT analyze.

Verify 3 Y/Y growth calculations from Step 2:

1. [Segment] [Quarter]: Prior year = $[A]M, Current = $[B]M
   Claimed Y/Y = [X]%
   Calculated: ([B]-[A])/[A] × 100 = ?%
   → MATCH (within 0.1pp) or MISMATCH?

2. [Segment] [Quarter]: Prior year = $[C]M, Current = $[D]M
   Claimed Y/Y = [Y]%
   Calculated: ([D]-[C])/[C] × 100 = ?%
   → MATCH or MISMATCH?

3. [Segment] [Quarter]: Prior year = $[E]M, Current = $[F]M
   Claimed Y/Y = [Z]%
   Calculated: ([F]-[E])/[E] × 100 = ?%
   → MATCH or MISMATCH?
"""


# ──────────────────────────
# 🟡 STEP 2 CLAIM-SUPPORT-FIT
# Model: Different advanced model
# ──────────────────────────

"""
You are a financial data auditor. You did NOT generate this data.

## Task: Audit 5 randomly selected numerical claims from Step 2.

For each:
1. Does the source snippet contain the exact number claimed?
2. Is the evidence level correct?
   - Directly in table → [DISCLOSED]
   - Calculated from others → [STRONG_INFERENCE] (calculation must be shown)
   - Growth rate/ratio → [DERIVED]

## Claims to audit:
[PASTE: 5 randomly selected data claims]

## Filing tables for reference:
[PASTE: relevant financial tables]

## Output per claim:
CLAIM: [id]
Claimed value: $[X]M
Snippet says: $[Y]M
Number match: EXACT / CLOSE (within 0.5%) / MISMATCH
Level check: CORRECT / OVERLABELED → should be [X]
Calculation shown (if STRONG_INFERENCE): YES / NO / N/A
"""


# ──────────────────────────
# ⚫ STEP 2 GATE (v5.2 — AUTO-BLOCK)
# ──────────────────────────

"""
  Checkpoint A (rollup):        PASS/FAIL for each FY
  Checkpoint B (spot-check):    X/3 match
  Checkpoint C (fabrication):   YES/NO fabrication found
  Checkpoint D (Y/Y growth):    X/3 match (v5.3)
  Claim-Support-Fit:            X/5 correct

GATE RULES (v5.3 — AUTO-BLOCK):

  ⛔ HARD STOP:
    - Any rollup FAIL
    - Fabrication found (Checkpoint C = YES)
    - Any spot-check MISMATCH on a [DISCLOSED] claim

  🔧 MUST FIX:
    - Spot-check MISMATCH on [DERIVED] claim → re-derive and show calculation
    - Any OVERLABELED → downgrade evidence level
    - ⭐ (v5.3) Any Y/Y growth MISMATCH → correct growth rate before Step 5 uses it

  ✅ PROCEED when all HARD STOP clear and MUST FIX resolved.
"""
