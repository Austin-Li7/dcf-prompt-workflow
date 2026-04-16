# ════════════════════════════════
# STEP 7 — WACC
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 7 — WACC Calculation (v5.2 — PARAMETER CLAIMS FIRST)
# Execute Python script locally, then claim-ify all inputs
# ──────────────────────────

"""
## Step 7: WACC Calculation with Parameter-Level Source-Fit

### Phase 0: Run Python Script
[Execute the validated WACC Python script — includes staleness check,
 data quality warnings, beta range check, cost of debt reasonableness,
 WACC range check, Bull/Base/Bear sensitivity]

### Phase 1: Parameter Claims (v5.2 — MANDATORY, output BEFORE validation)

Every WACC input parameter must be output as a structured claim:

```
CLAIM: W7-001
TEXT: Risk-free rate used is 4.28%, based on the 10-Year U.S. Treasury yield.
SOURCE_SNIPPET: [exact yield value and date from source]
SOURCE_LOCATION: [e.g., "U.S. Treasury yield curve, treasury.gov, as of 2026-03-15"
                  OR "Damodaran data page, updated January 2026"]
EVIDENCE_LEVEL: DISCLOSED
STALENESS: [days since source date]
```

Required parameter claims (ALL must be present):

| Parameter | Claim ID | Required Source |
|:---|:---|:---|
| Risk-free rate | W7-001 | Treasury.gov or Damodaran page, with date |
| Equity Risk Premium | W7-002 | Damodaran implied ERP page, with update month |
| Unlevered beta (per segment) | W7-003a/b/c | Damodaran industry beta page + industry name used |
| Market Cap | W7-004 | yfinance (to be cross-checked in Checkpoint B) |
| Total Debt | W7-005 | yfinance (to be cross-checked in Checkpoint B) |
| Interest Expense | W7-006 | 10-K income statement or notes |
| Marginal Tax Rate | W7-007 | Statutory rate + source |

For conglomerates with weighted beta:
```
CLAIM: W7-003a
TEXT: Intelligent Cloud segment uses "Internet/Online Services" unlevered beta of 1.10
SOURCE_SNIPPET: "Unlevered Beta: 1.10" from "Internet/Online Services" row
SOURCE_LOCATION: Damodaran, betas by industry, US, updated January 2026
EVIDENCE_LEVEL: DISCLOSED
INDUSTRY_MATCH_RATIONALE: "IC segment is primarily Azure cloud services, maps to Internet/Online Services"
SEGMENT_WEIGHT: 37.7% (= $106,265M / $281,724M from Step 2)
WEIGHT_SOURCE: Step 2 FY2025 validated revenue
```

HARD RULE: If any required parameter claim is missing → WACC calculation
is INCOMPLETE and cannot pass gate. Every number must have a trail.
"""


# ──────────────────────────
# 🟢 STEP 7 CHECKPOINT A — WACC Range
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a range checker. Do NOT analyze.

WACC = [X]% for a [industry] company.

Typical ranges:
- Technology: 7-12%
- Consumer Staples: 6-9%
- Healthcare: 8-13%
- Financials: 8-14%
- Industrials: 7-11%
- Energy: 8-12%

WITHIN_RANGE or OUTSIDE_RANGE?
"""


# ──────────────────────────
# 🟢 STEP 7 CHECKPOINT B — Input Cross-Verify
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number verifier. Do NOT analyze.

WACC script used:
  Market Cap: $[X]B (from yfinance)
  Total Debt: $[Y]B (from yfinance)

10-K Balance Sheet says:
[PASTE: balance sheet]

1. Total debt (long-term + current portion) from 10-K = $___B
   vs yfinance $[Y]B → MATCH (within 5%) or MISMATCH?

2. Shares outstanding from 10-K = ___M
   × Stock price $[P] = implied market cap $___B
   vs yfinance $[X]B → MATCH (within 5%) or MISMATCH?
"""


# ──────────────────────────
# 🟢 STEP 7 CHECKPOINT C — Beta Industry Verification (v5.1 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a classification checker. Do NOT analyze or explain.

The WACC calculation used this unlevered beta: [X.XX]
The user states this is the "[Industry Name]" beta from Damodaran.

The company operates in these segments (from Step 1):
[LIST: segment names and brief descriptions]

Question 1: Does the Damodaran industry "[Industry Name]" appear to match
the company's PRIMARY business? → PLAUSIBLE_MATCH or QUESTIONABLE_MATCH

Question 2: For a conglomerate with multiple segments, was a weighted beta used?
→ YES / NO / NOT_APPLICABLE
If YES: Do the segment weights approximately match Step 2 revenue proportions?
  Step 2 revenue shares: [LIST: segment, revenue, % of total]
  Beta weights used: [LIST: segment, weight %]
  → CONSISTENT (within 5pp per segment) or INCONSISTENT

Question 3: The unlevered beta of [X.XX] — is this plausible for this type of business?
  Pure software/SaaS: typically 0.9-1.3
  Cloud infrastructure: typically 1.0-1.4
  Consumer hardware: typically 0.8-1.2
  Gaming/entertainment: typically 0.9-1.3
  → PLAUSIBLE or IMPLAUSIBLE
"""


# ──────────────────────────
# 🟡 STEP 7 CHECKPOINT D — Peer WACC Comparison (v5.1 — NEW)
# Model: Advanced model
# ──────────────────────────

"""
You are a WACC reasonableness checker.

The calculated WACC for [COMPANY] is [X]%.

Peers from Step 3's competitive landscape:
[LIST: 3-5 peer companies from Step 3]

For each peer, estimate their approximate WACC based on:
- Their market cap and debt levels (publicly available)
- Their industry classification
- Standard Damodaran methodology

| Peer | Est. WACC | Reasoning |
|:---|:---|:---|

Is [COMPANY]'s WACC of [X]% within ±2 percentage points of the peer median?
→ CONSISTENT or FLAG_FOR_REVIEW (explain gap)

Note: This is a reasonableness check, not a precision calculation.
The goal is to catch gross input errors (e.g., wrong industry beta,
wrong debt figure) that would make the WACC wildly different from peers.
"""


# ──────────────────────────
# 🟢 STEP 7 CHECKPOINT E — Cost of Debt Cross-Check (v5.2 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number verifier. Do NOT analyze.

The WACC script calculated pre-tax cost of debt = [X]%
This was derived from: Interest Expense $[A]M ÷ Total Debt $[B]M

Cross-check against 10-K:

1. Find "Interest expense" in the Income Statement:
   10-K says: $___M → MATCH (within 10%) with $[A]M or MISMATCH?

2. Find weighted average interest rate (often in debt footnote):
   If disclosed: ___% → vs calculated [X]%
   → MATCH (within 100bp) or MISMATCH?
   If not disclosed: [NOT_DISCLOSED] — rely on calculated rate.

3. Sanity: Is [X]% between 2% and 10% for an investment-grade company?
   → PLAUSIBLE or IMPLAUSIBLE
"""


# ──────────────────────────
# 🟢 STEP 7 CHECKPOINT F — Parameter Claims Completeness (v5.2 — NEW)
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a completeness checker. Do NOT analyze.

Check: Are ALL required parameter claims present?

W7-001 (Risk-free rate):        PRESENT / MISSING
W7-002 (Equity Risk Premium):   PRESENT / MISSING
W7-003 (Unlevered beta):        PRESENT / MISSING
W7-004 (Market Cap):            PRESENT / MISSING
W7-005 (Total Debt):            PRESENT / MISSING
W7-006 (Interest Expense):      PRESENT / MISSING
W7-007 (Marginal Tax Rate):     PRESENT / MISSING

For each PRESENT claim:
- Does it have a SOURCE_LOCATION? YES / NO
- Does it have a date? YES / NO

Any MISSING or missing source → INCOMPLETE
"""


# ──────────────────────────
# ⚫ STEP 7 GATE (v5.4 — MODE-AWARE)
# ──────────────────────────

"""
  FULL MODE checkpoints:
    Checkpoint A (WACC range):     WITHIN_RANGE / OUTSIDE_RANGE
    Checkpoint B (input verify):   Debt MATCH/MISMATCH, Market Cap MATCH/MISMATCH
    Checkpoint C (beta verify):    PLAUSIBLE_MATCH / QUESTIONABLE_MATCH, weights CONSISTENT / INCONSISTENT
    Checkpoint D (peer WACC):      CONSISTENT / FLAG_FOR_REVIEW
    Checkpoint E (cost of debt):   Interest MATCH/MISMATCH, rate PLAUSIBLE/IMPLAUSIBLE
    Checkpoint F (param claims):   X/7 complete

  LIGHT MODE checkpoints (v5.4):
    Checkpoint A/C merged (WACC range + beta reasonableness): run as one call
    Checkpoint B (input verify): same as Full
    Checkpoint F (param claims): same as Full
    Skip: D (peer WACC), E (cost of debt)

GATE RULES (v5.4 — AUTO-BLOCK):

  ⛔ HARD STOP (both modes):
    - Any parameter claim MISSING (Checkpoint F < 7/7)
    - Input MISMATCH on market cap or debt (Checkpoint B)
    - Constants stale >60 days

  ⛔ HARD STOP (Full Mode only):
    - Cost of debt IMPLAUSIBLE (Checkpoint E)

  🔧 MUST FIX:
    - Constants stale 30-60 days → update before finalizing
    - WACC OUTSIDE_RANGE → review inputs, document reasoning
    - QUESTIONABLE_MATCH on beta industry → review selection, document reasoning
    - INCONSISTENT beta weights → realign with Step 2 revenue proportions
    - FLAG_FOR_REVIEW on peer comparison → investigate gap (Full Mode only)
    - Interest expense MISMATCH → re-check 10-K (Full Mode only)

  ✅ PROCEED when all HARD STOP clear and MUST FIX resolved.
"""
