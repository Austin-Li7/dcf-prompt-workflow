# Step 4.5: Capital Allocation, Subsidiary Leverage & Investment Moats (v5 — Validated)

---

## 1. Objective
Quantify the Capital Expenditure (CapEx) and subsidiary performance required to fuel the growth trajectories identified in Steps 1–4. This step ensures the revenue projections in Step 5 are grounded in financial reality.

---

## 2. Input Data
* **Historical CapEx:** From "Cash Flows from Investing Activities" in the 10-K/10-Q
* **Subsidiary Asset Base:** Key business units from Step 1
* **Investment Guidance:** Management forward-looking statements from earnings calls

---

## 3. Required Calculations

### Claims First
Every financial data point must be output as a claim:

```
CLAIM: [claim_id, e.g. D45-001]
TEXT: [the data statement]
SOURCE_SNIPPET: [exact number from the filing]
SOURCE_LOCATION: [filing, Statement of Cash Flows, page]
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / DERIVED]
```

**Source line MUST be "Purchases of property and equipment" from the Statement of Cash Flows. Do NOT use total investing cash flows (which includes acquisitions, investments, etc.).**

If the company reports "Capital expenditure including finance leases" as a separate line, note which definition you are using.

### Capital Metrics Table

| Metric | Formula | FY-4 | FY-3 | FY-2 | FY-1 | FY0 | Claim ID | Source |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| CapEx ($M) | PP&E from CF stmt | | | | | | D45-001 | 10-K p.XX |
| CapEx/Revenue % | CapEx ÷ Revenue | | | | | | D45-002 | [DERIVED] |
| Revenue per $ CapEx | Rev ÷ CapEx (lag 4-8Q) | | | | | | D45-003 | [DERIVED] |
| FCF Margin % | (OCF - CapEx) ÷ Rev | | | | | | D45-004 | [DERIVED] |

### Subsidiary Analysis
For each key subsidiary identified in Step 1:
- Technical moat evidence (from Step 3 competitor gaps)
- "Internal supplier" evidence (intercompany/elimination lines in filings)
- Contribution margin: [DISCLOSED] if in filings, [NOT_DISCLOSED] if not — do NOT estimate

### Feasibility Checkpoints (quantified)
1. **CapEx Runway:** Current CapEx/Rev ratio vs 5-year average → if current >1.5x average → [ELEVATED_CAPEX]
2. **Scale Economics:** Revenue CAGR vs CapEx CAGR → "achieving scale economies" (Rev > CapEx) or "capital-intensive" (CapEx ≥ Rev)
3. **Guidance Alignment:** Management CapEx guidance vs historical ratio → [GUIDANCE_DIVERGENCE] if inconsistent

---

## ════════════════════════════════════════
## VALIDATION LAYER
## ════════════════════════════════════════

### 🟢 Checkpoint — CapEx Number Verification
**Model: Basic model**

```
You are a number verifier. Do NOT analyze or explain.

Claim: "FY20XX Capital Expenditure was $[X]M"
Source line item: "Purchases of property and equipment"

Here is the Statement of Cash Flows from the 10-K:
[PASTE: cash flow statement]

What is the "Purchases of property and equipment" number? $___M
Does it match the claim? MATCH (within 1%) or MISMATCH?
```

---

### ⚫ Gate Decision

```
Checkpoint (CapEx verify): PASS / FAIL
CapEx runway: ELEVATED / NORMAL
Scale economics: ACHIEVING / CAPITAL-INTENSIVE
Guidance alignment: ALIGNED / DIVERGENT

GATE: CapEx verify must PASS. Proceed to Step 5 with feasibility context.
```
