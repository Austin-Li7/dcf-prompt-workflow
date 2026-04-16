# Adobe (ADBE) — Step 5 Compressed Validation
## v5.3 Light Mode — Assumption Governance Test

## Scope
This is **not** a full forecast build.  
This is a compressed validation focused on whether **v5.3 assumption governance** is working.

Included only:
1. Assumption Registry  
2. basis_claim_id for each assumption  
3. synergy_driver  
4. driver_quality  
5. capital feasibility reference  
6. Y1 and Y3 key segment revenue base forecast  
7. FY5 consolidated base revenue  
8. Weak-inference exposure summary  

---

## Governance notes

- No assumption below uses **narrative-only basis**.
- Each assumption has at least one explicit **basis_claim_id** from validated Step 2 or Step 4.
- No assumption uses a **WEAK_INFERENCE synergy** as its primary numeric driver.
- No **integration_proven_only** synergy is used to add more than **+3pp above historical CAGR**.
- **Step 4.5 revenue ceiling was not available in the current validation run**, so FY5 ceiling enforcement cannot be tested here.
- Accordingly, no `[CAPEX_CEILING_EXCEEDED]` flag is applied in this compressed run.

---

## Historical reference used for guardrails

Using validated Step 2 annual segment revenue series:

- **Digital Media FY2021 → FY2025 CAGR ≈ 11.25%**
- **Digital Experience FY2021 → FY2025 CAGR ≈ 10.97%**
- **Publishing and Advertising FY2021 → FY2025 CAGR ≈ -10.45%**

These historical CAGRs are used only as governance anchors, not as disclosed management guidance.

---

## Assumption Registry

```json
{
  "assumptions": [
    {
      "id": "A001",
      "text": "Digital Media base revenue grows 10.0% in Y1.",
      "basis_claim_id": ["D2-001", "D2-005", "D2-017"],
      "basis": "Anchored to validated Digital Media annual revenue history; Y1 growth is set below the FY2021-FY2025 historical CAGR of about 11.25%.",
      "synergy_driver": "none",
      "driver_quality": "STRONG",
      "capital_feasibility_reference": "Step 4.5 unavailable in current run — ceiling not testable",
      "flags": []
    },
    {
      "id": "A002",
      "text": "Digital Experience base revenue grows 10.5% in Y1.",
      "basis_claim_id": ["D2-002", "D2-006", "D2-018", "S4-012"],
      "basis": "Anchored to validated Digital Experience annual revenue history plus Step 4 SYN-003 causality support that DX subscription revenue growth was driven by strength in GenStudio solutions and Adobe Experience Platform and related apps.",
      "synergy_driver": "SYN-003",
      "driver_quality": "STRONG",
      "capital_feasibility_reference": "Step 4.5 unavailable in current run — ceiling not testable",
      "flags": []
    },
    {
      "id": "A003",
      "text": "Publishing and Advertising base revenue declines 8.0% in Y1.",
      "basis_claim_id": ["D2-003", "D2-007", "D2-019"],
      "basis": "Anchored to validated multi-year decline in Publishing and Advertising revenue; decline is slightly less negative than the FY2021-FY2025 historical CAGR of about -10.45%.",
      "synergy_driver": "none",
      "driver_quality": "STRONG",
      "capital_feasibility_reference": "Step 4.5 unavailable in current run — ceiling not testable",
      "flags": []
    },
    {
      "id": "A004",
      "text": "Digital Media annual growth moderates to 9.0% by Y3.",
      "basis_claim_id": ["D2-001", "D2-005", "D2-017"],
      "basis": "Anchored to validated Digital Media history and assumes mild deceleration from Y1 while staying within historical range.",
      "synergy_driver": "none",
      "driver_quality": "STRONG",
      "capital_feasibility_reference": "Step 4.5 unavailable in current run — ceiling not testable",
      "flags": []
    },
    {
      "id": "A005",
      "text": "Digital Experience annual growth moderates to 9.5% by Y3.",
      "basis_claim_id": ["D2-002", "D2-006", "D2-018", "S4-011", "S4-012"],
      "basis": "Anchored to validated Digital Experience history plus fully_verified_synergy SYN-003, while still remaining below a materially aggressive acceleration path.",
      "synergy_driver": "SYN-003",
      "driver_quality": "STRONG",
      "capital_feasibility_reference": "Step 4.5 unavailable in current run — ceiling not testable",
      "flags": []
    },
    {
      "id": "A006",
      "text": "Publishing and Advertising annual decline remains 8.0% through Y3.",
      "basis_claim_id": ["D2-003", "D2-007", "D2-019"],
      "basis": "Anchored to validated declining segment history; no recovery catalyst was validated strongly enough to reverse the trend.",
      "synergy_driver": "none",
      "driver_quality": "STRONG",
      "capital_feasibility_reference": "Step 4.5 unavailable in current run — ceiling not testable",
      "flags": []
    }
  ]
}
```

---

## Assumption governance check

| Assumption ID | basis_claim_id present? | Narrative-only basis? | synergy_driver | driver_quality | Weak-inference dependency? | Governance status |
|---|---|---|---|---|---|---|
| A001 | YES | NO | none | STRONG | NO | PASS |
| A002 | YES | NO | SYN-003 | STRONG | NO | PASS |
| A003 | YES | NO | none | STRONG | NO | PASS |
| A004 | YES | NO | none | STRONG | NO | PASS |
| A005 | YES | NO | SYN-003 | STRONG | NO | PASS |
| A006 | YES | NO | none | STRONG | NO | PASS |

### Cap check for integration_proven_only drivers
No assumption uses **integration_proven_only** synergy as a numeric driver.  
Therefore the **+3pp above historical CAGR cap** is not triggered in this compressed run.

### Weak-inference driver check
No assumption uses a **WEAK_INFERENCE** synergy as a primary growth driver.  
Therefore no assumption is tagged `[DRIVER_FROM_WEAK_INFERENCE]`.

---

## Segment-level base forecast

### Forecast schedule used
- **Digital Media:** Y1 +10.0%, Y2 +9.5%, Y3 +9.0%, Y4 +8.5%, Y5 +8.0%
- **Digital Experience:** Y1 +10.5%, Y2 +10.0%, Y3 +9.5%, Y4 +9.0%, Y5 +8.5%
- **Publishing and Advertising:** Y1 -8.0%, Y2 -8.0%, Y3 -8.0%, Y4 -8.0%, Y5 -8.0%

Base year = FY2025 validated segment revenue:
- Digital Media = **17,649**
- Digital Experience = **5,864**
- Publishing and Advertising = **256**

All values below are in **USD millions**.

### Y1 key segment revenue base forecast

| Segment | FY2025 Actual | Y1 Growth Assumption | Y1 Base Revenue | Assumption ID |
|---|---:|---:|---:|---|
| Digital Media | 17,649 | 10.0% | 19,414 | A001 |
| Digital Experience | 5,864 | 10.5% | 6,480 | A002 |
| Publishing and Advertising | 256 | -8.0% | 236 | A003 |
| **Consolidated** | **23,769** | — | **26,100** | — |

### Y3 key segment revenue base forecast

| Segment | Y3 Annual Growth Assumption | Y3 Base Revenue | Assumption ID |
|---|---:|---:|---|
| Digital Media | 9.0% | 23,171 | A004 |
| Digital Experience | 9.5% | 7,805 | A005 |
| Publishing and Advertising | -8.0% | 199 | A006 |
| **Consolidated** | — | **31,176** | — |

---

## FY5 consolidated base revenue

### FY5 segment path

| Segment | FY5 Base Revenue |
|---|---:|
| Digital Media | 27,152 |
| Digital Experience | 9,230 |
| Publishing and Advertising | 169 |
| **FY5 Consolidated Base Revenue** | **36,551** |

### Ceiling check
- **Step 4.5 revenue ceiling:** not available
- **FY5 base vs ceiling test:** not testable in this run
- **[CAPEX_CEILING_EXCEEDED]:** not applied

---

## Weak-inference exposure summary

```json
{
  "total_FY5_revenue_base_usd_m": 36551,
  "revenue_from_DISCLOSED_or_historical_base_drivers_usd_m": 36551,
  "revenue_from_STRONG_INFERENCE_synergy_drivers_usd_m": 9230,
  "revenue_from_WEAK_INFERENCE_synergy_drivers_usd_m": 0,
  "revenue_from_ESTIMATED_BASE_usd_m": 0,
  "assumptions_tagged_DRIVER_FROM_WEAK_INFERENCE": 0,
  "high_uncertainty_flags": 0,
  "summary": "This compressed validation run shows low weak-inference exposure because no base-case segment forecast is driven primarily by WEAK_INFERENCE synergies."
}
```

### Interpretation
- **Weak-inference exposure is 0% of FY5 base revenue** in this compressed run.
- The only explicit synergy-backed growth driver used numerically is **SYN-003** for Digital Experience, and it was treated as **STRONG**, not WEAK.
- Because Step 4.5 was not available, this run validates **assumption governance** better than it validates full capital-feasibility enforcement.

---

## Bottom-line validation result

This compressed Step 5 run suggests that **v5.3 assumption governance is functioning reasonably well** under a conservative setup:

- every assumption has a **basis_claim_id**
- no assumption is **narrative-only**
- no assumption relies on **WEAK_INFERENCE** synergy
- no **integration_proven_only** cap violation appears
- the only missing governance layer in this run is **Step 4.5 ceiling enforcement**
