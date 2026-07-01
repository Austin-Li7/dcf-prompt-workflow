Task: Build a comprehensive business architecture breakdown of the company for a DCF workflow.

Company: {companyName}

Mandatory sources:
1. Most recent Form 10-K or annual report equivalent
2. Most recent 10-Q or quarterly earnings release, if available
3. Official company materials only when included or cited

Scope:
Map:
- Reported operating segments
- Revenue categories, if different from reported segments
- Business lines inside each segment
- Product families
- Specific commercial offerings
- Revenue generation mechanics

Rules:
- Base segmentation strictly on how the company reports it.
- Preserve the filing-native structure in reported_view.
- Create a normalized downstream mapping in analysis_view.
- Clearly distinguish:
  - reported operating segments
  - revenue categories
  - commercial/product groupings
- Do not estimate revenue contribution.
- Do not analyze margin, growth, performance, valuation, or stock attractiveness.
- Every segment, offering, and excluded item must cite a claim_id.
- If mapping is uncertain, put it in excluded_items or mark evidence as weak.
- Do not leave offerings empty when filings disclose products, platforms, services, or brands.
- Keep product lists representative, not exhaustive.

Finance mode:
Detect company_type:
- industrial: product/service revenue
- financial_bank: NII, deposits, lending, capital ratios
- financial_insurance: premiums, float, investment income
- financial_other: fintech, asset manager, REIT, non-NII financial model
- hybrid: mix of financial and industrial/tech segments

For each segment:
- workflow_mode = bank if NII/lending/deposit/capital-regulated
- workflow_mode = industrial otherwise

Required output:
{
  "schema_version": "v5.5",
  "company_name": "...",
  "ticker": "... or null",
  "company_type": "industrial|financial_bank|financial_insurance|financial_other|hybrid",
  "reported_view": {
    "view_type": "operating_segment|revenue_category|geography|mixed",
    "nodes": [
      {
        "id": "reported_node_1",
        "label": "Filing-native name",
        "raw_name_variants": ["..."],
        "products": ["optional disclosed product names"],
        "claim_id": "claim_1",
        "evidence_level": "DISCLOSED",
        "children": []
      }
    ]
  },
  "analysis_view": {
    "segments": [
      {
        "id": "analysis_segment_1",
        "canonical_name": "Segment Name",
        "mapped_from_reported_node_ids": ["reported_node_1"],
        "workflow_mode": "industrial",
        "claim_id": "claim_1",
        "evidence_level": "DISCLOSED",
        "offerings": [
          {
            "id": "offering_1",
            "canonical_name": "Product / business line",
            "category": "Major product category",
            "products": ["Model 3", "Model Y", "Cybertruck"],
            "customer_type": "Consumer|Enterprise|Government|Mixed|unspecified",
            "revenue_mechanics": "How revenue is generated",
            "mapped_from_reported_node_ids": ["reported_node_1"],
            "claim_id": "claim_2",
            "evidence_level": "DISCLOSED"
          }
        ]
      }
    ],
    "excluded_items": [],
    "canonical_name_registry": {}
  },
  "claims": [
    {
      "claim_id": "claim_1",
      "text": "Supported claim",
      "source_snippet": "Exact short snippet",
      "source_location": "10-K Item 1 Business / Segment note",
      "evidence_level": "DISCLOSED"
    }
  ],
  "sources": [
    {
      "document": "Form 10-K 2024",
      "section": "Item 1 Business"
    }
  ]
}