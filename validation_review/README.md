# Validation Prompt Review Workspace

This workspace is reserved for reviewing and improving validation prompts.

It is intentionally separated from `dcf_pipeline/outputs/`:

- `inputs/` stores frozen review snapshots per ticker
- `reviews/` stores company-level AI review outputs
- `summaries/` stores cross-company summaries and management-ready writeups
- `tests/` stores the review plan, rubric, sample rationale, and run log

Current default sample set:

- `MSFT`
- `AAPL`
- `CRM`

Notes:

- `dcf_pipeline/outputs/` remains the source of pipeline run artifacts
- `validation_review/` is the source of prompt-review artifacts only
- Missing company materials are documented explicitly instead of being inferred later
