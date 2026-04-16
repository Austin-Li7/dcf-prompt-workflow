# Validation Prompt Review Test Plan

## Goal

Review and improve validation prompts without mixing review artifacts into the production pipeline output directory.

## Prompt Families To Test

- Step 1 auto verification prompts
- Step 1 checkpoint prompts
- Step 1 gate summary prompts
- Step 2 validation readiness, where artifacts exist

## Core Questions

- Which prompts reliably catch real issues?
- Which prompts produce operationally expensive false positives?
- Which prompts generate outputs that are not decision-useful for human review?
- Which prompt families should be fixed before expanding to more companies?

## Expected Deliverables

- company-level review notes under `reviews/`
- management-facing summary under `summaries/`
- prompt-improvement backlog under `summaries/`
