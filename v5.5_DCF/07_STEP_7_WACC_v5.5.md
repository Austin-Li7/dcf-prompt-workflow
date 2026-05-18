# ════════════════════════════════════════
# STEP 7 — WACC
# ════════════════════════════════════════

# ──────────────────────────
# 🔴 STEP 7 GENERATION
# ──────────────────────────

"""
# Step 7: WACC with Parameter Claims

## Objective
Convert discount rate inputs from opaque constants into a source-traceable parameter bundle.

## MODE SELECTION (read Step 1 company_type before calculating)

| company_type from Step 1             | Calculation mode      | Key rule                              |
|:-------------------------------------|:----------------------|:--------------------------------------|
| single / conglomerate / unclassified | Standard WACC         | Hamada re-lever → CAPM Ke → WACC      |
| financial_bank / financial_insurance | Ke-only (no WACC)     | Deposits ≠ M-M debt; discount FCFE at Ke |
| hybrid                               | Sum-of-Parts (SOTP)   | Bank segs @ Ke + Industrial segs @ WACC |

For **financial / bank mode**: use Damodaran's published bank equity beta directly.
Do NOT apply the Hamada D/E re-levering equation.
Output: `wacc = Ke`, `weight_equity = 1.0`, `weight_debt = 0.0`.

For **hybrid SOTP mode**: output two discount rates —
  `bank_ke` (equity beta, Ke-only) and `industrial_wacc` (full WACC).

## Required Output
```json
{
  "machine_artifact": {
    "calculation_mode": "STANDARD / KE_ONLY / SOTP",
    "parameter_claims": [],
    "wacc_inputs": {},
    "calculation_output": {},
    "staleness_flags": [],
    "workflow_status": "READY / NEEDS_REVIEW / BLOCKED",
    "next_action": "PROCEED_FINAL_AUDIT / HUMAN_REVIEW_WACC_INPUT / REGENERATE"
  }
}
```

## Required Parameter Claims (structured — all must be present)
Output each claim in this format:
```
CLAIM: W7-001
TEXT: Risk-free rate used is 4.28%, based on the 10-Year U.S. Treasury yield.
SOURCE_LOCATION: U.S. Treasury / ^TNX, as of YYYY-MM-DD
EVIDENCE_LEVEL: DISCLOSED
STALENESS_DAYS: [days since source date]
```

| Claim ID | Parameter         | Required source                           |
|:---------|:------------------|:------------------------------------------|
| W7-001   | risk_free_rate    | 10-Year Treasury yield, with date         |
| W7-002   | equity_risk_premium | Damodaran implied ERP page, with month  |
| W7-003   | unlevered_beta    | Damodaran industry beta page + industry   |
| W7-004   | market_cap        | Yahoo Finance / filing cross-check        |
| W7-005   | total_debt        | 10-K balance sheet (long-term + current)  |
| W7-006   | interest_expense  | 10-K income statement (annual or TTM)     |
| W7-007   | marginal_tax_rate | Statutory rate + source                   |

## v5.5 Compression Rule
Keep reviewer focus on only three things:
1. Are all 7 parameter claims present with dates?
2. Are market cap and debt plausible vs the 10-K filing?
3. Is the beta mapping sensible for this business?

Peer WACC comparison is optional Full Mode, not default output.

## Reviewer Summary
Show:
- Calculation mode (STANDARD / KE_ONLY / SOTP)
- WACC (or Ke, or both rates for SOTP)
- Stale inputs if any (flag if >30 days)
- Any mismatches against 10-K
- Whether beta mapping needs review
- Cost of debt sanity (should be 1.5%–15% for investment-grade; flag if outside)

## UI Handoff
Show:
- WACC base case (and Ke for financial mode)
- Sensitivity range (beta ±0.1, ERP ±0.5%)
- Intrinsic value per share vs current price
- Implied upside / downside
"""


# ──────────────────────────
# 🟢 CHECKPOINT A — Range / Beta Reasonableness
# ──────────────────────────

"""
wacc_range_check=WITHIN_RANGE / OUTSIDE_RANGE
beta_mapping_check=PLAUSIBLE / QUESTIONABLE

Typical WACC ranges by sector:
- Technology: 7–12%
- Consumer Staples: 6–9%
- Healthcare: 8–13%
- Financials (Ke only): 8–14%
- Industrials: 7–11%
- Energy: 8–12%
- Utilities: 5–8%
"""


# ──────────────────────────
# 🟢 CHECKPOINT B — Input Cross-Verify
# ──────────────────────────

"""
debt_check=MATCH / MISMATCH
market_cap_check=MATCH / MISMATCH
failure_reason=[DATA_VENDOR_GAP / SHARE_COUNT_GAP / N/A]

Note: market cap = price × shares outstanding (NOT enterprise value).
"""


# ──────────────────────────
# 🟢 CHECKPOINT C — Parameter Claim Completeness
# ──────────────────────────

"""
claims_complete=YES / NO   (7/7 required)
missing_claims=[...]
missing_dates=[...]
"""


# ──────────────────────────
# 🟢 CHECKPOINT D — Cost of Debt Sanity
# ──────────────────────────

"""
pre_tax_cost_of_debt=[X]%   (= interest expense / total debt)
cost_of_debt_check=PLAUSIBLE / IMPLAUSIBLE

Plausible range: 1.5%–15% for corporate borrowers.
If IMPLAUSIBLE: check for operating lease interest in numerator,
near-zero debt balance causing division noise, or one-time charges.
Skip for financial / Ke-only mode (no conventional debt in model).
"""


# ──────────────────────────
# 🟡 STEP 7 AUDIT
# ──────────────────────────

"""
For each required parameter:
source_present=YES / NO
date_present=YES / NO
fit=FULL / PARTIAL / MISMATCH
recommended_action=KEEP / FIX / HUMAN_REVIEW
"""


# ──────────────────────────
# ⚫ STEP 7 GATE
# ──────────────────────────

"""
HARD STOP:
- any required parameter claim (W7-001 to W7-007) missing
- debt or market cap mismatch unresolved (Checkpoint B)
- critical constants stale >60 days
- cost of debt IMPLAUSIBLE and unresolved (Checkpoint D)

MUST FIX:
- questionable beta mapping
- stale constants 30–60 days
- missing date metadata on any claim

PROCEED when:
- all 7 claims present with dates and sources
- no unresolved HARD STOP conditions
- final audit can consume a clean parameter bundle
"""
