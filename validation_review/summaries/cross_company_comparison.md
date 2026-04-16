# Cross-Company Comparison

## Current Snapshot

| Ticker | What it tells us | Main limitation |
|---|---|---|
| MSFT | Step 1 auto verification is too noisy, but gate summary is strong | Downstream validation coverage incomplete |
| AAPL | Validation can catch a real Step 1 structural mistake | Checkpoint artifacts are too opaque |
| CRM | Planned coverage only | No source materials yet |

## Cross-Sample Pattern

Across the two usable samples, the core pattern is consistent:

- the validation system is directionally checking the right risks
- the current artifact quality is not yet good enough for low-friction scaling

MSFT mostly teaches us about false positives and noisy automation. AAPL mostly teaches us about true-positive detection and poor failure explainability.

## Implication

The system should not be judged as "failing." It is better described as:

- good at identifying where to look
- not yet clean enough to fully automate approval decisions
