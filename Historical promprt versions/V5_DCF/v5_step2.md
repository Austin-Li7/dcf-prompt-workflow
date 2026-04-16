# Step 2: Longitudinal Financial Data Extraction — Past 5 Years (v5 — Validated)

---

## 1. Business Architecture Input (Step 1 JSON)
**Only use this step after Step 1 has passed its gate.**

Please use the following validated JSON architecture as the basis for data extraction:

[PASTE YOUR VALIDATED STEP 1 JSON HERE]

---

## 2. Objective
Extract and organize financial data for segments and products identified in the Step 1 JSON. You must provide a continuous breakdown covering the most recent 5 fiscal years up to the latest available reporting period.

---

## 3. CRITICAL: Disclosure-Bounded Extraction

Before extracting data for ANY entity, you must first determine what the company actually discloses at quarterly granularity:

| Disclosure Status | Rule |
|:---|:---|
| Quarterly $ revenue separately reported in 10-K/10-Q | ✅ EXTRACT with full source citation |
| Only annual $ revenue reported | Extract annual only. Mark quarterly as [ANNUAL_ONLY] |
| Only growth % reported (not $ amount) | Extract growth % only. Mark $ as [GROWTH_PCT_ONLY] |
| Not separately reported at all | Mark [NOT_SEPARATELY_REPORTED] — provide NO numbers |

**Your output table WILL have fewer rows than Step 1's product list. That is correct behavior. Do NOT fill gaps with estimates, interpolations, or calculations that are not explicitly derivable from disclosed numbers.**

---

## 4. Data Sourcing & Consistency Rules
* **Official Sources Only:** SEC filings (10-K, 10-Q) and Earnings Press Releases
* **The "Restatement" Rule:** If the company has updated its reporting structure, use the RESTATED historical figures provided in the latest filings for consistency. If restated quarterly figures are not available, note [QUARTERLY_RESTATEMENT_NOT_AVAILABLE] and provide what exists with clear basis labeling.
* **Granularity:** Provide a strict chronological list. Do not skip any quarters for which data is available.
* **Currency:** All monetary values in USD Millions.

---

## 5. Output Method: CLAIMS FIRST, THEN TABLES

### Phase 1: Disclosure Inventory
Before extracting any numbers, output this inventory:

```json
{
  "disclosure_inventory": {
    "entities_in_step1": "[total segments + products from Step 1]",
    "entities_with_quarterly_dollar_data": "[count]",
    "entities_with_annual_dollar_data_only": "[count]",
    "entities_with_growth_pct_only": "[count]",
    "entities_not_separately_reported": "[count]",
    "entities_given_numbers_without_source": 0
  }
}
```

The last field MUST be zero. If it is not zero, you are fabricating data.

### Phase 2: Structured Data Claims
For each numerical data point, output as a claim:

```
CLAIM: [claim_id, e.g. D2-001]
TEXT: [the factual data statement]
SOURCE_SNIPPET: [exact number as it appears in the filing table or text — e.g., "$26,707" from a revenue table row]
SOURCE_LOCATION: [filing type, period, table/exhibit name, page number]
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / DERIVED]
BASIS: [as-reported / restated]
```

Evidence levels for data:
- **DISCLOSED**: The number appears directly in a filing table or text
- **STRONG_INFERENCE**: Calculated from disclosed numbers in one step (e.g., Q4 = FY total - Q1 - Q2 - Q3). You must show the calculation.
- **DERIVED**: Growth rates, margins, ratios calculated from disclosed values

**Rule: Never mark a calculated number as [DISCLOSED]. If you computed it, it is [STRONG_INFERENCE] or [DERIVED].**

### Phase 3: Markdown Tables
Assemble verified claims into tables.

**For each entity with quarterly $ data:**

| Fiscal Quarter | Revenue (USD M) | Claim ID | Evidence Level | Source | Y/Y Growth % | Flags |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| (Earliest available) | | | | | | |
| ... | | | | | | |
| (Most recent) | | | | | | |

**For entities with growth % only (no $ revenue):**

| Fiscal Period | Y/Y Growth % | Claim ID | Source | Notes |
| :--- | :--- | :--- | :--- | :--- |
| FY25 Q4 | +34% | D2-050 | Q4 Earnings Release | Azure and other cloud services |
| ... | | | | |

**For entities marked [NOT_SEPARATELY_REPORTED]:**
Do NOT create a table. Instead, list them:
- [Product Name] — [NOT_SEPARATELY_REPORTED] — no quarterly or annual $ disclosed

### Phase 4: Rollup Validation
For each fiscal year where you have segment-level data, compute:

```json
{
  "rollup_check": {
    "fiscal_year": "FY20XX",
    "segment_sum": "[sum of all segment revenues]",
    "reported_consolidated": "[total revenue from filing]",
    "gap": "[difference]",
    "gap_pct": "[X.XX%]",
    "status": "PASS (if <0.5%) or FAIL"
  }
}
```

### Phase 5: Anomaly Flags
Flag any quarter where:
- Revenue drops >20% Q/Q without known cause → [ANOMALY]
- Growth rate swings >30 percentage points Y/Y → [VOLATILITY]
- Operating margin changes >500 basis points Q/Q → [MARGIN_SHIFT]

### Phase 6: CSV Output

```
Fiscal_Year,Quarter,Segment,Product,Revenue_USD_M,Claim_ID,Evidence_Level,Source,Basis,Flags
```

---

## 6. Execution Instruction (Batching)
* **Batch 1 (Respond first):** All operating segments ($ revenue, quarterly where available, annual where not). Include rollup checks and the starting CSV block.
* **Batch 2 (After "Continue" command):** Product-level growth rates, any additional granular data available. Append to CSV.

---

## ════════════════════════════════════════
## VALIDATION LAYER (run AFTER generation)
## ════════════════════════════════════════

### 🟢 Checkpoint A — Rollup Math Verification
**Model: Basic model (Gemini Flash / Haiku / GPT-4o-mini)**

```
You are a calculator. Do NOT analyze or explain.

Add these numbers:
[PASTE: all segment revenue values for a given fiscal year from Step 2 output]

Total = ?

The company's reported consolidated revenue for that year is: $[X]M
(source: [filing])

Difference = ?
Difference as percentage = ?

Reply: MATCH (if difference < 0.5%) or MISMATCH
```

→ Run for each fiscal year. All must PASS.

---

### 🟢 Checkpoint B — Spot-Check 3 Random Numbers
**Model: Basic model**

```
You are a number verifier. Do NOT analyze or explain.

Claim 1: "[Segment X] revenue in [Quarter] was $[Y]M"
Here is the revenue table from the [10-Q / Earnings Release]:
[PASTE: the relevant filing table]
What number does the table show for this segment/quarter? $___M
→ MATCH or MISMATCH? If mismatch, source says: $___M

Claim 2: "[Segment Y] revenue in [Quarter] was $[Z]M"
Source table: [PASTE]
→ MATCH or MISMATCH?

Claim 3: "[Segment Z] annual revenue in [FY] was $[W]M"
Source table: [PASTE]
→ MATCH or MISMATCH?
```

→ Any MISMATCH = investigate the claim and its source.

---

### 🟢 Checkpoint C — Zero Fabrication Check
**Model: Basic model**

```
You are a list comparator. Do NOT analyze or explain.

List A — all entities that have specific dollar revenue numbers in the Step 2 output:
[LIST: entity names that have $ numbers]

List B — all entities marked [NOT_SEPARATELY_REPORTED] in Step 2:
[LIST: entity names marked as not reported]

Question: Is there ANY entity that appears in BOTH lists?
(meaning: it was marked as not reported, but still has dollar numbers)

→ YES (list them) or NO
```

→ YES = fabrication detected. Must fix before proceeding.

---

### 🟡 Claim-Support-Fit Audit
**Model: Different advanced model from the generator**

```
You are a financial data auditor. You did NOT generate this data.

## Task
Audit 5 randomly selected numerical claims from Step 2.

For each:
1. Read the source snippet provided with the claim
2. Does the snippet contain the exact number claimed?
3. Is the evidence level correct?
   - Number directly in a table → should be [DISCLOSED]
   - Calculated from other numbers → should be [STRONG_INFERENCE], and the calculation must be shown
   - Growth rate or ratio → should be [DERIVED]

## Claims to audit:
[PASTE: 5 randomly selected data claims from Step 2]

## Filing tables for reference:
[PASTE: relevant financial tables from filings]

## Output per claim:
CLAIM: [id]
Claimed value: $[X]M
Snippet says: $[Y]M
Number match: EXACT / CLOSE (within 0.5%) / MISMATCH
Level check: CORRECT / OVERLABELED → should be [X]
Calculation shown (if STRONG_INFERENCE): YES / NO / N/A
```

→ Any MISMATCH or OVERLABELED → fix before proceeding to Step 3.

---

### ⚫ Gate Decision

```
Review results:
  Checkpoint A (rollup):        PASS/FAIL for each FY
  Checkpoint B (spot-check):    X/3 match
  Checkpoint C (fabrication):   YES/NO fabrication found
  Claim-Support-Fit:            X/5 correct

GATE RULES:
  Any rollup FAIL → STOP. Fix segment data.
  Any spot-check MISMATCH → investigate and correct.
  Fabrication found → STOP. Remove fabricated numbers.
  Any OVERLABELED → downgrade evidence level.

  ALL pass → Proceed to Step 3 with validated data.
```
