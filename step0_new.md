Task: Determine whether an existing DCF workflow should be reused or partially refreshed.

Input:
- Company name / ticker
- Saved DCF state, including completed steps and saved timestamp
- New event(s), filing(s), news, market-data change, or manual analyst note

Goal:
Decide which workflow steps must be rerun and which prior outputs can be reused.

Workflow steps:
1. Business Architecture
2. Historical Financial Data
3. Competitive Landscape
4. Synergies & Drivers
5. Forecast
6. Executive Summary
7. WACC
8. DCF Valuation

Event classification:
Classify each event as one of:
- new 10-K
- new 10-Q
- earnings/call
- M&A/divestiture
- new product/technology
- competitive shift
- regulation/litigation
- management change
- market data change
- macro change

For each event, assess:
- truthScore: official / reported / rumor / fictional
- materiality: low / medium / high
- quantifiability: known / estimable / unknown
- impact horizon: next quarter / 1-2 years / long-term / unknown
- DCF drivers affected: revenue baseline, margins, capex, market share, WACC, terminal growth, etc.

Routing rules:
- New 10-K or M&A/divestiture: rerun Steps 1–8.
- New 10-Q: rerun Step 2, Step 5, Step 6, Step 7, Step 8. Also rerun Step 1 if segment/reporting structure changed.
- Earnings/call: rerun Step 2, Step 5, Step 6, Step 8. Add Step 7 if capital structure or rates changed.
- New product/technology: rerun Step 3, Step 4, Step 5, Step 6, Step 8. Add Step 1 if it creates a new business line. Add Step 2 if disclosed financial data exists.
- Competitive shift: rerun Step 3, Step 4, Step 5, Step 6, Step 8.
- Regulation/litigation: rerun Step 3, Step 5, Step 6, Step 7, Step 8. Add Step 1 if segment structure is affected.
- Management change: rerun Step 4, Step 5, Step 6, Step 8. Add Step 7 if capital allocation changed.
- Market data change: rerun Step 7 and Step 8 only.
- Macro change: rerun Step 5, Step 6, Step 7, Step 8.

Output:
Return:
{
  "matchedSave": "existing save id or null",
  "completedThroughStep": number,
  "events": [
    {
      "title": "...",
      "eventType": "...",
      "truthScore": 0-100,
      "materiality": "low|medium|high|unknown",
      "quantifiability": "known|estimable|unknown",
      "suggestedRerunSteps": [1,2,5,8],
      "manualReviewRequired": true/false
    }
  ],
  "routingSummary": {
    "rerun": [step numbers],
    "reuse": [step numbers],
    "reasons": ["..."],
    "conditionalChecks": ["..."]
  }
}