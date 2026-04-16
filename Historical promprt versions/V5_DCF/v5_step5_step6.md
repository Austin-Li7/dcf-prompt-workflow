# Step 5 & 6: Financial Forecasting + Consolidated Master View (v5 — Validated)

---

# Step 5: High-Granularity Quarterly Financial Forecasting (5-Year Outlook)

## 1. Objective
Project quarterly revenue for every segment (and product where data permits) identified in Step 1, for the next five fiscal years (20 consecutive quarters). This forecast must integrate the historical baseline from Step 2, competitive resistance from Step 3, synergy acceleration from Step 4 (audited version only), and capital feasibility from Step 4.5.

## 2. Input Data
**All inputs must have passed their respective gates.**
* **Business Architecture (Step 1):** [PASTE VALIDATED JSON]
* **Historical Baseline (Step 2):** [PASTE VALIDATED CSV]
* **Competitive Resistance (Step 3):** [PASTE VALIDATED OUTPUT]
* **Synergy Multipliers (Step 4):** [PASTE AUDITED SYNERGY MATRIX — with final evidence levels]
* **Capital Feasibility (Step 4.5):** [PASTE OUTPUT]

---

## 3. CRITICAL RULES

### Rule 1: [FACT] vs [FORECAST] vs [DERIVED] Tagging
Every single number you output MUST be tagged:
- **[FACT]** — from Step 2 actual data (historical reported figure)
- **[FORECAST]** — projected by you (Y1 Q1 onward)
- **[DERIVED]** — calculated from other numbers (CAGR, growth %, margins)

NEVER present a forecast number without the [FORECAST] tag.

### Rule 2: Driver Eligibility from Step 4
Review Step 4's AUDITED synergy classifications:

| Step 4 Classification | Can drive forecast numbers? |
|:---|:---|
| fully_verified_synergy | ✅ Yes |
| integration_proven_only (integration part) | ✅ Yes, conservatively |
| integration_proven_only (causality part) | ⚠️ No — causality was [WEAK_INFERENCE] |
| narrative_synergy | ❌ "Strategic Drivers" narrative column only, cannot drive growth rate numbers |
| unsupported_synergy | ❌ Must not appear anywhere in Step 5 |

Any assumption that relies on a [WEAK_INFERENCE] synergy as its primary basis MUST be tagged **[DRIVER_FROM_WEAK_INFERENCE]** and included in the Weak-Inference Sensitivity table.

### Rule 3: Output as Ranges
Default output is a RANGE, not a single point estimate.

The "Base" estimate is shown alongside Low and High:
- **Low** = Base minus the impact of removing all [WEAK_INFERENCE] drivers
- **High** = Base plus optimistic scenario on verified drivers
- **Base** = your central estimate

A single-point "Base" without range is only permitted when ALL drivers are [DISCLOSED] or [STRONG_INFERENCE] AND cross-model gap (if run) is <10pp.

### Rule 4: No Unannounced Events as Milestones
- Do NOT invent product launches, acquisitions, or market events as "milestones"
- Only use events that are ALREADY publicly announced by the company (cite source)
- For speculative future events → prefix with [SPECULATIVE ASSUMPTION:]

---

## 4. Assumption Registry (REQUIRED — output BEFORE any numbers)

```json
{
  "assumptions": [
    {
      "id": "A001",
      "text": "Intelligent Cloud segment grows 20% Y/Y in Y1",
      "basis": "Step 2 FY2025 IC growth was 21.5%. Discounted 1.5pp for Step 3 High Rivalry in cloud.",
      "basis_evidence_level": "DISCLOSED (historical growth from 10-K)",
      "synergy_driver": "none",
      "driver_quality": "STRONG",
      "sensitivity": "±5pp growth = ±$X B revenue in FY5"
    },
    {
      "id": "A003",
      "text": "AI contributes +3pp incremental growth to Intelligent Cloud from Y2",
      "basis": "Step 4 SYN-001: AI integration into Azure is proven [DISCLOSED], but causality (AI → revenue acceleration) is [WEAK_INFERENCE]",
      "basis_evidence_level": "WEAK_INFERENCE (for causality)",
      "synergy_driver": "SYN-001",
      "driver_quality": "WEAK_INFERENCE_DEPENDENT",
      "sensitivity": "If removed: IC FY5 revenue decreases by $X B",
      "remove_test_impact_pct": "X% of IC FY5 total"
    }
  ]
}
```

---

## 5. Forecasting Logic
* **Baseline Anchoring:** Y1 Q1 forecast = Step 2 latest actual quarter × (1 + assumed growth rate from registry)
* **Seasonality:** Reference historical Q/Q patterns from Step 2
* **Competitive Resistance:** Discount growth in categories where Step 3 = "High" Rivalry
* **Synergy Acceleration:** Only verified synergies ([DISCLOSED] / [STRONG_INFERENCE]) can accelerate growth rates. [WEAK_INFERENCE] synergies can appear in narrative but NOT drive numbers.
* **Capital Feasibility:** Growth must be supportable by Step 4.5 CapEx trajectory
* **Summation Integrity:** Products → Categories → Segments → Consolidated (tolerance ±$1M)

---

## 6. Reasonableness Flags (auto-trigger)
- Y/Y growth >50% for a product/segment with revenue >$5B → [AGGRESSIVE_GROWTH]
- 5-Year CAGR exceeds TAM growth by >2x → [TAM_CONSTRAINT]
- Any CAGR <-10% without explicit catalyst → [AGGRESSIVE_DECLINE]
- Any [SPECULATIVE ASSUMPTION] driving >10% of FY5 revenue → [HIGH_UNCERTAINTY]

---

## 7. Output Format: Per Segment

### Segment: [Name]

**Key Assumptions:** A001, A003

| Quarter | Rev Low ($M) | Rev Base ($M) | Rev High ($M) | Tag | Y/Y % | Driver (Assumption ID) | Driver Quality | Flags |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Y1 Q1** | | | | [FORECAST] | | A001 | STRONG | |
| **Y1 Q2** | | | | [FORECAST] | | A001, seasonality | STRONG | |
| ... | | | | | | | | |
| **Y5 Q4** | | | | [FORECAST] | | A001, A003 | WEAK_DEP | |
| **FY5 Total** | **[sum]** | **[sum]** | **[sum]** | | | | | |

---

## 8. Execution: Process one segment at a time. STOP after each segment.

---
---

# Step 6: Consolidated 5-Year Master Forecast (Executive View)

## 1. Objective
Synthesize all segment forecasts into one master table.

## 2. Master Forecast Table

| Segment | Category | FY+1 | FY+2 | FY+3 | FY+4 | FY+5 | 5Y CAGR | Range | Key Drivers | Weak-Dep? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **[Segment A]** | [Cat 1] | | | | | | | [Low-High] | A001 | No |
| | [Cat 2] | | | | | | | | A003 | Yes |
| *Subtotal* | | | | | | | | | | |
| **CONSOLIDATED** | | | | | | | | | | |

## 3. Standard Sensitivity Table

| Scenario | Change | FY5 Revenue | CAGR |
| :--- | :--- | :--- | :--- |
| Bull | +3pp all segments | | |
| Base | as forecast | | |
| Bear | -3pp all segments | | |

## 4. ⭐ Weak-Inference Driver Sensitivity (v5 — MANDATORY)

| Assumption | Evidence Level | If REMOVED | FY5 Revenue Impact | CAGR Impact | Flag |
| :--- | :--- | :--- | :--- | :--- | :--- |
| A003: AI synergy → IC growth | WEAK_INFERENCE | IC growth drops Xpp | -$X B | -Xpp | [HIGH_UNCERTAINTY] if >10% |

## 5. Forecast Confidence Summary

```json
{
  "total_FY5_revenue_base": "$XXX B",
  "revenue_from_DISCLOSED_drivers": "$XXX B (XX%)",
  "revenue_from_STRONG_INFERENCE_drivers": "$XX B (XX%)",
  "revenue_from_WEAK_INFERENCE_drivers": "$XX B (XX%)",
  "high_uncertainty_flags": "[count]"
}
```

## 6. Top 3 Growth Engines (cite Step 3 + Step 4)
## 7. Revenue Mix Shift (FY1 → FY5)
## 8. Ecosystem Resilience Statement

---

## ════════════════════════════════════════
## VALIDATION LAYER
## ════════════════════════════════════════

### 🟢 Checkpoint A — Baseline Anchor Verification
**Model: Basic model**

```
You are a calculator. Do NOT analyze or explain.

Step 2 latest actual quarter for [Segment]:
  [FY20XX QX] Revenue = $[X]M [FACT]

Step 5 first forecast quarter for [Segment]:
  Y1 Q1 Base Revenue = $[Y]M [FORECAST]

Implied Q/Q change = (Y - X) / X × 100 = ?%

Is this between -15% and +15%?
→ WITHIN_RANGE or OUTSIDE_RANGE
```

→ OUTSIDE_RANGE = the forecast has a discontinuity from actual data. Must justify or fix.

---

### 🟢 Checkpoint B — Summation Integrity
**Model: Basic model**

```
You are a calculator. Do NOT analyze or explain.

Add these FY+3 Base product/category revenues for [Segment]:
  [list all values]

Sum = ?

Step 6 Master Table says [Segment] FY+3 = $[Z]M

MATCH (within $1M) or MISMATCH?
```

→ Run for each segment, each forecast year. All must MATCH.

---

### 🟢 Checkpoint C — Growth Rate Sanity
**Model: Basic model**

```
You are a range checker. Do NOT analyze or explain.

For each segment/product below, check:
- Flag if 5Y CAGR > 40% AND current revenue > $5,000M
- Flag if 5Y CAGR < -10% with no flag/note in the data
- Otherwise → OK

[LIST: segments/products with their Base 5Y CAGR]
```

---

### 🟢 Checkpoint D — Driver Eligibility Enforcement
**Model: Basic model**

```
You are a list comparator. Do NOT analyze or explain.

List A — assumptions in Step 5 that use synergy drivers:
[LIST: assumption_id, synergy_id, driver_quality]

Question: Are there any assumptions where driver_quality contains
"WEAK" but the assumption is NOT tagged [DRIVER_FROM_WEAK_INFERENCE]?

→ YES (list violations) or NO
```

→ YES = violation. Must tag properly or remove driver before finalizing.

---

### 🟡 Claim-Support-Fit Audit
**Model: Different advanced model**

```
You are a forecast auditor.

## Task: Check that forecast assumptions are properly grounded.

For each assumption in the registry:

1. Trace the "basis" back to a specific claim in Steps 2/3/4.
   Does that claim exist? What is its audited evidence level?

2. If the basis references a Step 4 synergy:
   What was the AUDITED classification after the Step 4 gate?
   If causality was downgraded to [WEAK_INFERENCE] but this assumption
   treats it as a primary growth driver without the WEAK tag → VIOLATION

3. Are any milestones in the forecast based on unannounced events?
   If yes → must be tagged [SPECULATIVE ASSUMPTION:]

## Assumptions to audit:
[PASTE: full assumption registry from Step 5]

## Output per assumption:
A-[id]:
  Basis traces to: [step/claim_id] — audited evidence level [X]
  Stated driver_quality: [Y]
  Match: YES / MISMATCH
  If synergy-based: audited classification = [Z]
  Driver eligibility: ELIGIBLE / VIOLATION
```

---

### 🔵 Cross-Model Generation (STRONGLY RECOMMENDED)
**Model: Different advanced model, same full Step 5 prompt**

Run the same forecast prompt with a different model. Then compare:

| Segment | Model A CAGR | Model B CAGR | Gap | Status |
|:---|:---|:---|:---|:---|
| IC | 22% | 25% | 3pp | CONSENSUS → range [22-25%] |
| MPC | 8% | -2% | 10pp | CONFLICT → human decides |

**Rules (v5):**
→ CONSENSUS (gap <10pp, same direction) = keep as RANGE [lower%-higher%]. Do NOT average.
→ CONFLICT (gap >10pp OR different direction) = human must decide. Record reasoning. No auto-merge.

---

### ⚫ Gate Decision

```
Checkpoint A (baseline):     X/N within range
Checkpoint B (summation):    X/N match
Checkpoint C (growth):       X flagged
Checkpoint D (driver):       violations found? YES/NO
Claim-Support-Fit:           X/N eligible
Cross-model:                 X consensus / Y conflicts

GATE RULES:
  Baseline OUTSIDE_RANGE → justify or fix
  Summation MISMATCH → fix
  Driver violation → tag or remove
  Cross-model CONFLICT → human resolves

  ALL pass → Proceed to Step 7.
```
