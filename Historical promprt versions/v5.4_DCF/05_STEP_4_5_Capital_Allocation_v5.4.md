# ════════════════════════════════
# STEP 4.5 — Capital Allocation
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 4.5 GENERATION
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 4.5: Capital Allocation & Investment Feasibility

## Input
- Step 1 JSON, Step 2 CSV, Step 4 Synergy Matrix

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## Claims First
Every financial data point as a claim:
```
CLAIM: [D45-001]
TEXT: [data statement]
SOURCE_SNIPPET: [exact number from filing]
SOURCE_LOCATION: [filing, Cash Flow Statement, page]
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / DERIVED]
```

Source line MUST be "Purchases of property and equipment" from Cash Flows.
Do NOT use total investing cash flows.

## Capital Metrics Table
| Metric | Formula | FY-4 | FY-3 | FY-2 | FY-1 | FY0 | Claim ID |
|:---|:---|:---|:---|:---|:---|:---|:---|
| CapEx ($M) | PP&E from CF stmt | | | | | | D45-001 |
| CapEx/Revenue % | CapEx ÷ Revenue | | | | | | D45-002 |
| Revenue per $ CapEx | Rev ÷ CapEx (lag 4-8Q) | | | | | | D45-003 |
| FCF Margin % | (OCF - CapEx) ÷ Rev | | | | | | D45-004 |

## Feasibility Checkpoints
1. CapEx Runway: current ratio vs 5Y average → [ELEVATED_CAPEX] if >1.5x
2. Scale Economics: Rev CAGR vs CapEx CAGR → "achieving" or "capital-intensive"
3. Guidance Alignment: management guidance vs historical → [GUIDANCE_DIVERGENCE] if inconsistent

### ⭐ Asset-Light Threshold (v5.4 — NEW)
If CapEx/Revenue < 8% for ALL 5 historical years:
→ Mark revenue ceiling as [NOT_APPLICABLE — ASSET_LIGHT]
→ Step 5 gate skips ceiling check
→ Pipeline audit notes the skip
→ Skip the revenue ceiling calculation below

### ⭐ Step 5 Revenue Ceiling (v5.3, skip if ASSET_LIGHT)

After computing the Capital Metrics Table, calculate:

  historical_rev_per_capex = 5-year average (Revenue / CapEx with 4-8Q lag)

  If management CapEx guidance exists:
    FY5_implied_capex = guidance-implied CapEx for FY5
  Else:
    FY5_implied_capex = FY0 CapEx × (1 + CapEx CAGR)^5

  max_implied_FY5_revenue = FY5_implied_capex × historical_rev_per_capex × 1.2
  (the 1.2x allows 20% improvement in capital efficiency)

Output:
```json
{
  "step5_revenue_ceiling": {
    "max_implied_FY5_revenue_M": "[number]",
    "basis": "[calculation shown]",
    "note": "Step 5 FY5 base exceeding this requires [CAPEX_CEILING_EXCEEDED] + justification"
  }
}
```
"""


# ──────────────────────────
# 🟢 STEP 4.5 CHECKPOINT — CapEx Verify
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a number verifier. Do NOT analyze.

Claim: "FY20XX Capital Expenditure was $[X]M"
Source line: "Purchases of property and equipment"

Cash Flow Statement: [PASTE]

What is "Purchases of property and equipment"? $___M
Match? → MATCH (within 1%) or MISMATCH
"""


# ──────────────────────────
# ⚫ STEP 4.5 GATE
# ──────────────────────────

"""
  CapEx verify: PASS / FAIL
  CapEx runway: ELEVATED / NORMAL
  Scale economics: ACHIEVING / CAPITAL-INTENSIVE
  Guidance: ALIGNED / DIVERGENT

  GATE: CapEx verify must PASS. Proceed to Step 5 with feasibility context.
"""
