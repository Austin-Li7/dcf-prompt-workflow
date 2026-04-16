# DCF Prompt Workflow

This repository is the shared working space for our DCF prompt system, validation assets, and workflow module.

## What This Repo Is For

We are building a workflow-driven DCF valuation system with two main layers:

1. `v5.5_DCF`
   The current prompt-system source of truth.
   This defines the step-by-step workflow logic, validation discipline, machine-readable artifacts, human review checkpoints, and final audit rules.

2. `dcf-cfp-module`
   The app/module layer.
   This is the UI and workflow runner that will eventually consume the `v5.5` contracts and turn them into a usable interactive system.

The goal is no longer just to write stronger prompts.
The goal is to turn the prompt system into a stable, reviewable, automatable workflow.

## Current Status

We have completed the first full draft of `v5.5`, which is intended to be the final prompt architecture baseline for workflow implementation.

Key direction changes from earlier versions:

- `Light-first` instead of `Full-first`
- structured outputs for every step
- three output layers per step:
  - `machine_artifact`
  - `reviewer_summary`
  - `ui_handoff`
- fixed human-in-the-loop checkpoints
- `workflow_status` and `next_action` fields for orchestration
- more focus on workflow usability, auditability, and future automation

This means the main next step is not writing a completely new prompt version.
The main next step is upgrading the module to run against the `v5.5` workflow contract.

## Repository Structure

- `v5.5_DCF/`
  Current prompt and workflow specification.

- `dcf-cfp-module/`
  Current app/module implementation for the DCF workflow.

- `validation_review/`
  Validation artifacts, review outputs, sample findings, and testing notes.

- `docs/`
  Design notes, implementation planning, and workflow-related documentation.

- `DCF Coding Reference/`
  Reference material and prior drafting support files.

- `Historical promprt versions/`
  Archived prompt versions and historical test outputs.

## What Is Not the Main Collaboration Path

- `dcf_pipeline/`
  This was an earlier separate web/pipeline experiment and currently remains outside the main shared repo flow.
  For now, the main collaboration path is centered on:
  - `v5.5_DCF`
  - `dcf-cfp-module`
  - `validation_review`
  - `docs`

## Immediate Project Priorities

1. Align the module with the `v5.5` step contract.
2. Implement a workflow MVP using:
   - `Light-first`
   - `segment-first`
   - human review checkpoints
   - resumable step state
3. Keep validation assets organized so prompt changes can be regression-tested.
4. Avoid expanding prompt complexity unless it directly improves workflow reliability.

## Suggested Team Split

Recommended collaboration split:

- Prompt / validation owner
  Maintains `v5.5_DCF`, prompt discipline, and validation logic.

- Workflow / backend owner
  Refactors `dcf-cfp-module` routes, state, and artifact handling.

- Frontend / review UX owner
  Builds the reviewer flow, approval UI, and user-facing step handoffs.

- Eval / QA owner
  Tracks sample companies, failure cases, and regression comparisons.

## Collaboration Rules

- Do not work directly on `main`.
- Create a branch for each task.
- Use pull requests for merges.
- Keep prompt changes and module changes in separate PRs when possible.
- If a change affects workflow behavior, update both:
  - the implementation
  - the relevant `v5.5_DCF` documentation

## Recommended Next Actions

Short term:

1. Finalize team ownership.
2. Map `v5.5` artifacts into `dcf-cfp-module` state and API responses.
3. Build the workflow MVP around:
   - Step 1
   - Step 2
   - Step 3A
   - Step 4
   - Step 4.5
   - Step 5/6 Light
   - Step 7
   - Final audit

Medium term:

1. Add regression testing / eval harness.
2. Add artifact persistence and resume support.
3. Expand to deeper full-mode behavior only where necessary.

## Notes

This repo is actively evolving.
If folder names, flow design, or responsibilities change, update this README so new collaborators can onboard quickly.
