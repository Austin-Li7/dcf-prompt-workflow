# Adobe (ADBE) — v5.3 Light Mode Validation
## Step 2 — Historical Financial Data Extraction

基于 Adobe FY2025 / FY2024 / FY2023 10-K 与 Adobe Q1 FY2026 earnings release，下面严格只对 **三个 reportable segments** 做历史数据提取：
- Digital Media
- Digital Experience
- Publishing and Advertising

同时严格执行：
- **先做 disclosure inventory**
- **不对未单独披露实体编美元收入**
- **不把 customer group revenue 误当成 segment revenue**
- **Q1 FY2026 不反推旧三分部收入**

另外，与你给的 FY2024 / FY2023 segment 数字相比，Adobe 官方 10-K 当前披露为：
- FY2024 total revenue = **$21,505M**，不是 $21,546M
- FY2024 Digital Media = **$15,864M**，不是 $15,893M
- FY2024 Digital Experience = **$5,366M**，不是 $5,387M
- FY2024 Publishing and Advertising = **$275M**，不是 $266M
- FY2023 total revenue = **$19,409M**，不是 $19,457M
- FY2023 Digital Media = **$14,216M**，不是 $14,222M
- FY2023 Digital Experience = **$4,893M**，不是 $4,936M
- FY2023 Publishing and Advertising = **$300M**，不是 $299M

本次 validation 以官方 filing 为准。

---

## Phase 1: Disclosure Inventory

```json
{
  "disclosure_inventory": {
    "entities_in_step1": 3,
    "entities_with_quarterly_dollar_data": 0,
    "entities_with_annual_dollar_data_only": 3,
    "entities_with_growth_pct_only": 0,
    "entities_with_qualitative_growth_only": 0,
    "entities_not_separately_reported": 0,
    "entities_given_numbers_without_source": 0
  },
  "scope_notes": {
    "covered_entities": [
      "Digital Media",
      "Digital Experience",
      "Publishing and Advertising"
    ],
    "excluded_from_segment_dollar_tables": [
      "Firefly",
      "Acrobat AI Assistant",
      "Acrobat Studio",
      "GenStudio",
      "GenStudio for Performance Marketing",
      "Customer groups (BPC / CMP)"
    ],
    "reason": "Not separately disclosed as reportable segment revenue lines in the audited 10-K segment tables."
  },
  "q1_fy2026_note": "Adobe disclosed total revenue, ARR and customer-group subscription revenue in Q1 FY2026, but did not disclose revenue for the prior three reportable segments because Adobe combined them into a single operating and reportable segment effective Q1 FY2026."
}
```

---

## Phase 2: Structured Data Claims

### A. Annual segment revenue claims

CLAIM: D2-001  
TEXT: Digital Media revenue in FY2025 was $17,649M.  
SOURCE_SNIPPET: `Digital Media $ 17,649`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-002  
TEXT: Digital Experience revenue in FY2025 was $5,864M.  
SOURCE_SNIPPET: `Digital Experience 5,864`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-003  
TEXT: Publishing and Advertising revenue in FY2025 was $256M.  
SOURCE_SNIPPET: `Publishing and Advertising 256`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-004  
TEXT: Total revenue in FY2025 was $23,769M.  
SOURCE_SNIPPET: `Total revenue $ 23,769`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-005  
TEXT: Digital Media revenue in FY2024 was $15,864M.  
SOURCE_SNIPPET: `Digital Media $ 15,864`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-006  
TEXT: Digital Experience revenue in FY2024 was $5,366M.  
SOURCE_SNIPPET: `Digital Experience 5,366`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-007  
TEXT: Publishing and Advertising revenue in FY2024 was $275M.  
SOURCE_SNIPPET: `Publishing and Advertising 275`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-008  
TEXT: Total revenue in FY2024 was $21,505M.  
SOURCE_SNIPPET: `Total revenue $ 21,505`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-009  
TEXT: Digital Media revenue in FY2023 was $14,216M.  
SOURCE_SNIPPET: `Digital Media $ 14,216`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-010  
TEXT: Digital Experience revenue in FY2023 was $4,893M.  
SOURCE_SNIPPET: `Digital Experience 4,893`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-011  
TEXT: Publishing and Advertising revenue in FY2023 was $300M.  
SOURCE_SNIPPET: `Publishing and Advertising 300`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-012  
TEXT: Total revenue in FY2023 was $19,409M.  
SOURCE_SNIPPET: `Total revenue $ 19,409`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Segment Information, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-013  
TEXT: Digital Media revenue in FY2022 was $12,842M.  
SOURCE_SNIPPET: `Digital Media $ 12,842`  
SOURCE_LOCATION: Adobe FY2024 10-K, Item 7 MD&A — Segment Information, p.42  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-014  
TEXT: Digital Experience revenue in FY2022 was $4,422M.  
SOURCE_SNIPPET: `Digital Experience 5,366 4,893 4,422`  
SOURCE_LOCATION: Adobe FY2024 10-K, Item 7 MD&A — Segment Information, p.42  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-015  
TEXT: Publishing and Advertising revenue in FY2022 was $342M.  
SOURCE_SNIPPET: `Publishing and Advertising 275 300 342`  
SOURCE_LOCATION: Adobe FY2024 10-K, Item 7 MD&A — Segment Information, p.42  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-016  
TEXT: Total revenue in FY2022 was $17,606M.  
SOURCE_SNIPPET: `Total revenue $ 21,505 $ 19,409 $ 17,606`  
SOURCE_LOCATION: Adobe FY2024 10-K, Item 7 MD&A — Segment Information, p.42  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-017  
TEXT: Digital Media revenue in FY2021 was $11,520M.  
SOURCE_SNIPPET: `Digital Media $ 14,216 $ 12,842 $ 11,520`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A — Segment Information, p.40  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-018  
TEXT: Digital Experience revenue in FY2021 was $3,867M.  
SOURCE_SNIPPET: `Digital Experience 4,893 4,422 3,867`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A — Segment Information, p.40  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-019  
TEXT: Publishing and Advertising revenue in FY2021 was $398M.  
SOURCE_SNIPPET: `Publishing and Advertising 300 342 398`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A — Segment Information, p.40  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-020  
TEXT: Total revenue in FY2021 was $15,785M.  
SOURCE_SNIPPET: `Total revenue $ 19,409 $ 17,606 $ 15,785`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A — Segment Information, p.40  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

### B. Subscription revenue by reportable segment claims

CLAIM: D2-021  
TEXT: Digital Media subscription revenue in FY2025 was $17,389M.  
SOURCE_SNIPPET: `Digital Media $ 17,389`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Subscription revenue by reportable segment, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-022  
TEXT: Digital Experience subscription revenue in FY2025 was $5,409M.  
SOURCE_SNIPPET: `Digital Experience 5,409`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Subscription revenue by reportable segment, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-023  
TEXT: Publishing and Advertising subscription revenue in FY2025 was $106M.  
SOURCE_SNIPPET: `Publishing and Advertising 106`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Subscription revenue by reportable segment, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-024  
TEXT: Total subscription revenue in FY2025 was $22,904M.  
SOURCE_SNIPPET: `Total subscription revenue $ 22,904`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Subscription revenue by reportable segment, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-025  
TEXT: Digital Media subscription revenue in FY2024 was $15,547M.  
SOURCE_SNIPPET: `Digital Media $ 15,547`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Subscription revenue by reportable segment, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-026  
TEXT: Digital Experience subscription revenue in FY2024 was $4,864M.  
SOURCE_SNIPPET: `Digital Experience 4,864`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Subscription revenue by reportable segment, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-027  
TEXT: Publishing and Advertising subscription revenue in FY2024 was $110M.  
SOURCE_SNIPPET: `Publishing and Advertising 110`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Subscription revenue by reportable segment, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-028  
TEXT: Total subscription revenue in FY2024 was $20,521M.  
SOURCE_SNIPPET: `Total subscription revenue $ 20,521`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Subscription revenue by reportable segment, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-029  
TEXT: Digital Media subscription revenue in FY2023 was $13,838M.  
SOURCE_SNIPPET: `Digital Media $ 13,838`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Subscription revenue by reportable segment, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-030  
TEXT: Digital Experience subscription revenue in FY2023 was $4,331M.  
SOURCE_SNIPPET: `Digital Experience 4,331`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A / Note — Subscription revenue by segment, p.39 / p.63  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-031  
TEXT: Publishing and Advertising subscription revenue in FY2023 was $115M.  
SOURCE_SNIPPET: `Publishing and Advertising 115`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A / Note — Subscription revenue by segment, p.39 / p.63  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-032  
TEXT: Total subscription revenue in FY2023 was $18,284M.  
SOURCE_SNIPPET: `Total subscription revenue $ 18,284`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 7 MD&A — Subscription revenue by reportable segment, p.36  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-033  
TEXT: Digital Media subscription revenue in FY2022 was $12,385M.  
SOURCE_SNIPPET: `Digital Media $ 15,547 $ 13,838 $ 12,385`  
SOURCE_LOCATION: Adobe FY2024 10-K, Note 2 — Subscription revenue by segment, p.65  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-034  
TEXT: Digital Experience subscription revenue in FY2022 was $3,880M.  
SOURCE_SNIPPET: `Digital Experience 4,331 3,880 3,379`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A / Note — Subscription revenue by segment, p.39 / p.63  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-035  
TEXT: Publishing and Advertising subscription revenue in FY2022 was $123M.  
SOURCE_SNIPPET: `Publishing and Advertising 115 123 146`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A / Note — Subscription revenue by segment, p.39 / p.63  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-036  
TEXT: Total subscription revenue in FY2022 was $16,388M.  
SOURCE_SNIPPET: `Total subscription revenue $ 18,284 $ 16,388 $ 14,573`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A / Note — Subscription revenue by segment, p.39 / p.63  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-037  
TEXT: Digital Media subscription revenue in FY2021 was $11,048M.  
SOURCE_SNIPPET: `Digital Media $ 13,838 $ 12,385 $ 11,048`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A / Note — Subscription revenue by segment, p.39 / p.63  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-038  
TEXT: Digital Experience subscription revenue in FY2021 was $3,379M.  
SOURCE_SNIPPET: `Digital Experience 4,331 3,880 3,379`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A / Note — Subscription revenue by segment, p.39 / p.63  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-039  
TEXT: Publishing and Advertising subscription revenue in FY2021 was $146M.  
SOURCE_SNIPPET: `Publishing and Advertising 115 123 146`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A / Note — Subscription revenue by segment, p.39 / p.63  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-040  
TEXT: Total subscription revenue in FY2021 was $14,573M.  
SOURCE_SNIPPET: `Total subscription revenue $ 18,284 $ 16,388 $ 14,573`  
SOURCE_LOCATION: Adobe FY2023 10-K, Item 7 MD&A / Note — Subscription revenue by segment, p.39 / p.63  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

### C. Q1 FY2026 disclosure-bound context claims

CLAIM: D2-041  
TEXT: Adobe total revenue in Q1 FY2026 was $6,398M.  
SOURCE_SNIPPET: `Total revenue 6,398`  
SOURCE_LOCATION: Adobe Q1 FY2026 earnings release, Condensed Consolidated Statements of Income, p.3  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-042  
TEXT: Total Adobe ARR exiting Q1 FY2026 was $26.06B.  
SOURCE_SNIPPET: `Total Adobe Annualized Recurring Revenue ("ARR") exiting the quarter was $26.06 billion.`  
SOURCE_LOCATION: Adobe Q1 FY2026 earnings release, highlights, p.1  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-043  
TEXT: Business Professionals & Consumers subscription revenue in Q1 FY2026 was $1.78B, and Creative & Marketing Professionals subscription revenue was $4.39B.  
SOURCE_SNIPPET: `Business Professionals & Consumers subscription revenue was $1.78 billion... Creative & Marketing Professionals subscription revenue was $4.39 billion...`  
SOURCE_LOCATION: Adobe Q1 FY2026 earnings release, Financial Targets section, p.1  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-044  
TEXT: Adobe’s Q2 FY2026 targets were total revenue of $6.43B to $6.48B, BPC subscription revenue of $1.80B to $1.82B, and CMP subscription revenue of $4.41B to $4.44B.  
SOURCE_SNIPPET: `Total revenue $6.43 billion to $6.48 billion ... Business Professionals & Consumers subscription revenue $1.80 billion to $1.82 billion ... Creative & Marketing Professionals subscription revenue $4.41 billion to $4.44 billion`  
SOURCE_LOCATION: Adobe Q1 FY2026 earnings release, Financial Targets section, p.1  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

CLAIM: D2-045  
TEXT: Q1 FY2026 did not separately disclose revenue for Digital Media, Digital Experience, and Publishing and Advertising under the prior segment structure.  
SOURCE_SNIPPET: `Effective in the first quarter of fiscal 2026, we will combine our prior segments—Digital Media, Digital Experience and Publishing and Advertising—into a single operating and reportable segment...`  
SOURCE_LOCATION: Adobe FY2025 10-K, Item 1 Business — Segments, p.10  
EVIDENCE_LEVEL: DISCLOSED  
BASIS: as-reported

---

## Phase 3: 5-Year Segment History Table

### Revenue by reportable segment (USD millions)

| Fiscal Year | Digital Media | Digital Experience | Publishing and Advertising | Total Revenue | Claim IDs |
|---|---:|---:|---:|---:|---|
| FY2021 | 11,520 | 3,867 | 398 | 15,785 | D2-017, D2-018, D2-019, D2-020 |
| FY2022 | 12,842 | 4,422 | 342 | 17,606 | D2-013, D2-014, D2-015, D2-016 |
| FY2023 | 14,216 | 4,893 | 300 | 19,409 | D2-009, D2-010, D2-011, D2-012 |
| FY2024 | 15,864 | 5,366 | 275 | 21,505 | D2-005, D2-006, D2-007, D2-008 |
| FY2025 | 17,649 | 5,864 | 256 | 23,769 | D2-001, D2-002, D2-003, D2-004 |

### Subscription revenue by reportable segment (USD millions)

| Fiscal Year | Digital Media | Digital Experience | Publishing and Advertising | Total Subscription Revenue | Claim IDs |
|---|---:|---:|---:|---:|---|
| FY2021 | 11,048 | 3,379 | 146 | 14,573 | D2-037, D2-038, D2-039, D2-040 |
| FY2022 | 12,385 | 3,880 | 123 | 16,388 | D2-033, D2-034, D2-035, D2-036 |
| FY2023 | 13,838 | 4,331 | 115 | 18,284 | D2-029, D2-030, D2-031, D2-032 |
| FY2024 | 15,547 | 4,864 | 110 | 20,521 | D2-025, D2-026, D2-027, D2-028 |
| FY2025 | 17,389 | 5,409 | 106 | 22,904 | D2-021, D2-022, D2-023, D2-024 |

### Q1 FY2026 disclosure-bound note

| Period | Disclosed | Not Disclosed |
|---|---|---|
| Q1 FY2026 | Total revenue = $6,398M; Total ARR = $26.06B; BPC subscription revenue = $1.78B; CMP subscription revenue = $4.39B | Digital Media revenue; Digital Experience revenue; Publishing and Advertising revenue |

---

## Phase 4: Rollup Validation

```json
[
  {
    "fiscal_year": "FY2021",
    "segment_sum_usd_m": 15785,
    "reported_consolidated_usd_m": 15785,
    "gap_usd_m": 0,
    "gap_pct": "0.00%",
    "status": "PASS"
  },
  {
    "fiscal_year": "FY2022",
    "segment_sum_usd_m": 17606,
    "reported_consolidated_usd_m": 17606,
    "gap_usd_m": 0,
    "gap_pct": "0.00%",
    "status": "PASS"
  },
  {
    "fiscal_year": "FY2023",
    "segment_sum_usd_m": 19409,
    "reported_consolidated_usd_m": 19409,
    "gap_usd_m": 0,
    "gap_pct": "0.00%",
    "status": "PASS"
  },
  {
    "fiscal_year": "FY2024",
    "segment_sum_usd_m": 21505,
    "reported_consolidated_usd_m": 21505,
    "gap_usd_m": 0,
    "gap_pct": "0.00%",
    "status": "PASS"
  },
  {
    "fiscal_year": "FY2025",
    "segment_sum_usd_m": 23769,
    "reported_consolidated_usd_m": 23769,
    "gap_usd_m": 0,
    "gap_pct": "0.00%",
    "status": "PASS"
  }
]
```

---

## Step 2 validation notes

- **No fabrication detected**: 本次只对三个 reportable segments 填了美元收入。
- **未单独披露实体未赋值**: Firefly、Acrobat AI Assistant、GenStudio 等都没有被填入 segment-dollar tables。
- **FY2026 quarterly old-segment dollars 未反推**: 因为官方披露已改为单一 segment。
- **Customer groups 保留为 supplementary disclosure**，但不进入三分部历史表。
