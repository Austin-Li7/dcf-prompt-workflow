# Task: Build a comprehensive business architecture breakdown of the company.

**Company:** [Insert Name or Ticker]

# Scope:
Provide a complete mapping of:
- Reported operating segments
- Business lines within each segment
- Product families
- Specific commercial offerings
- Revenue generation mechanics

# Mandatory Sources:
1. Most recent Form 10-K (or annual report equivalent)
2. Most recent quarterly earnings release or 10-Q

# Rules:
- Base segmentation strictly on how the company reports it
- Clearly distinguish between:
  • Reported operating segments
  • Revenue categories (if different from segments)
  • Product groupings (commercial view)
- Do not estimate revenue contribution
- Do not analyze margins, growth, or performance
- Do not provide valuation commentary

# Required Output Format:

## I. Segment-Level Product Architecture
For each reported segment, provide the following details:
1. **Major Product Categories**
2. **Sub-products / Brands / Platforms**
3. **Customer Type** (Consumer / Enterprise / Government / Mixed)
4. **Data Source** (Reference the specific filing/section)

---

## II. Source References
- Filing name + year
- Earnings release quarter
- Website sections reference (with URLs)

---

## III. Structured JSON List
At the very end, summarize the entire architecture into a JSON code block with two distinct sections: **architecture** (for product mapping) and **sources** (for document links):
{
  "architecture": [
    {
      "segment": "Segment Name",
      "offerings": [
        { 
          "category": "Product Category", 
          "products": ["Product A", "Product B"]
        }
      ]
    }
  ],
  "sources": [
    {
      "segment": "Segment Name",
      "source": "Filing/Section Name",
      "link": "https://www.example.com/filing-link"
    }
  ]
}