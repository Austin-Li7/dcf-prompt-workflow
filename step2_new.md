Task: Build a historical financial baseline for the DCF workflow.

Input:
- Step 1 business architecture
- Company ticker / company name
- SEC XBRL data when available
- Uploaded 10-K / 10-Q filing text when XBRL is incomplete
- Target years, usually latest five fiscal years

Primary rule:
Use XBRL structured facts first when available. Use filing/PDF extraction as fallback or supplement.

XBRL extraction rules:
- Pull recent 10-K and 10-Q inline XBRL filings.
- Match Step 1 reported segments to XBRL dimension members.
- Preserve parent segment from Step 1.
- Discover XBRL revenue/product lines from explicitMember values.
- Q1–Q3: use direct 10-Q three-month XBRL facts.
- Q4: derive as annual 10-K value minus Q1–Q3.
- If Q4 is negative, do not import that row; create warning.
- Prefer RevenueFromContractWithCustomerExcludingAssessedTax over generic Revenues when both exist.
- Do not invent missing segment data.

Industrial filing extraction rules:
Extract per segment / product line / quarter:
- revenue_usd_m
- operating_income_usd_m
- gross_profit_usd_m
- capex_usd_m
- depreciation_amortization_usd_m
- headcount

Bank extraction rules:
Extract per segment / quarter:
- nii_usd_m
- non_interest_income_usd_m
- provision_for_credit_losses_usd_m
- net_income_usd_m
- book_value_equity_usd_m
- goodwill_usd_m
- intangible_assets_usd_m
- preferred_equity_usd_m
- total_rwa_usd_m
- tier1_capital_ratio_pct
- cet1_ratio_pct
- net_interest_margin_pct
- efficiency_ratio_pct
- return_on_avg_equity_pct
- total_assets_usd_m
- liquidity fields when disclosed

Chunk prompt:
Extract all financial rows from this filing chunk.
Use Step 1 canonical names.
Return all fiscal years and quarters found.
Use null when a metric is not explicitly disclosed.
All monetary values must be USD millions.
Return JSON only.

Reduce prompt:
Synthesize chunk summaries into one Step 2 historical baseline for target fiscal year.
Merge duplicates by quarter, segment, and product line.
Prefer higher-confidence disclosed figures.
Map rows only to Step 1 canonical segments and offerings.
Add validation_warnings for conflicts, missing quarters, implausible values, or name mismatches.
Return JSON only.

Sanity review prompt:
Review the Step 2 structured result.
Flag:
- negative revenue
- gross margin > 100%
- missing quarters
- segment names not matching Step 1
- unsupported or hallucinated values
Do not remove rows unless impossible; add warnings instead.

Required output:
{
  "schema_version": "v5.5",
  "workflow": "industrial|bank",
  "company_name": "...",
  "target_year": 2024,
  "rows": [
    {
      "row_id": "...",
      "fiscal_year": 2024,
      "quarter": "Q1|Q2|Q3|Q4",
      "segment": "Parent Segment",
      "product_category": "XBRL/product category or Segment total",
      "product_name": "XBRL/product line or Segment total",
      "revenue_usd_m": 12345,
      "operating_income_usd_m": 1234,
      "gross_profit_usd_m": null,
      "capex_usd_m": null,
      "depreciation_amortization_usd_m": null,
      "headcount": null,
      "mapped_from_step1_ids": ["analysis_segment_1"],
      "source_id": "sec-inline-xbrl-2024-Q1",
      "evidence_level": "DISCLOSED",
      "validation_status": "verified_source",
      "review_note": "Short provenance note"
    }
  ],
  "sources": [
    {
      "source_id": "sec-inline-xbrl-2024-Q1",
      "source_type": "derived|uploaded_file|official_filing",
      "name": "SEC inline XBRL 10-Q 2024 Q1",
      "locator": "URL or filing section",
      "excerpt": "Short source excerpt"
    }
  ],
  "excluded_items": [
    {
      "label": "Missing segment/product line",
      "reason": "No matching XBRL fact or filing disclosure",
      "source_id": null,
      "evidence_level": "UNSUPPORTED"
    }
  ],
  "validation_warnings": [
    {
      "code": "MISSING_QUARTERS|NEGATIVE_DERIVED_Q4|SEGMENT_NAME_MISMATCH|IMPLAUSIBLE_MARGIN",
      "severity": "info|warn|high",
      "message": "...",
      "row_ids": []
    }
  ],
  "review_summary": {
    "one_line": "...",
    "highlights": ["..."],
    "warnings": ["..."]
  }
}