# DCF Pipeline Automation — Design Spec
_Date: 2026-04-08_

## Overview

A Python automation system that orchestrates the v5 7-step AI valuation pipeline. The system calls three LLM providers (Claude for generation, Gemini Flash for checkpoints, GPT-4o for CSF audits), manages SEC filing fetching, evaluates gates, and produces per-company output folders. Target: run `python pipeline.py --ticker MSFT` and get all step outputs with gate decisions.

## Goals

- Automate the full v5 pipeline: Steps 1–7 + pipeline audit
- Validate against MSFT golden set (V5 test/) as first milestone
- Support batch runs across multiple tickers (CRWD, CRM, GOOGL, AMZN)
- Detect evidence laundering across steps (claim_tracker)
- Gate failures halt execution and require human intervention

## Non-Goals (Phase 1)

- Cross-model steps (🔵 Step 3 and Step 5/6 cross-model) — deferred
- Step 7 WACC (Python-local calc) — stubbed, implemented after Steps 1–6 validated
- Async/parallel execution across tickers — sequential only in Phase 1

---

## Directory Layout

```
dcf_pipeline/
├── pipeline.py              # Entry point
├── config.yaml              # API keys, model assignments, csf_review_mode per step
├── providers/
│   ├── base.py
│   ├── anthropic.py
│   ├── google.py
│   └── openai.py
├── steps/
│   ├── base_step.py
│   ├── step1.py through step7.py
│   ├── step4_5.py
│   ├── step5_6.py
│   └── pipeline_audit.py
├── prompts/
│   ├── parse_prompts.py     # One-time parser: v5_RUNNABLE_PROMPT_SET.md → .txt files
│   └── *.txt                # One file per prompt block
├── utils/
│   ├── filing_fetcher.py
│   ├── gate_evaluator.py
│   └── claim_tracker.py
└── outputs/
    └── {TICKER}/
        ├── filings/
        └── step{N}_*.md / step{N}_gate.json
```

---

## Component Responsibilities

### `BaseStep`

Standard interface all step classes implement:

```python
class BaseStep:
    def run(self, context: StepContext) -> StepOutput
    def _generation_prompt(self, context) -> str      # override per step
    def _checkpoint_prompts(self, context, gen_output) -> list[CheckpointSpec]
    def _csf_prompt(self, context, gen_output) -> str
    def _parse_gate(self, checkpoint_results, csf_result) -> GateResult
```

### `PipelineRunner` (pipeline.py)

Instantiates steps in order. Passes `StepContext` forward. Stops on `GateResult.decision == FAIL`.

### `StepContext`

Accumulates validated outputs from all prior steps:

```python
@dataclass
class StepContext:
    ticker: str
    step1: StepOutput | None
    step2: StepOutput | None
    step3: StepOutput | None
    step4: StepOutput | None
    step4_5: StepOutput | None
    step5_6: StepOutput | None
    step7: StepOutput | None
```

### `StepOutput`

```python
@dataclass
class StepOutput:
    step_num: str           # "1", "4_5", etc.
    ticker: str
    raw_text: str           # Full generation markdown
    claims_json: dict       # Parsed claims/architecture/etc.
    gate: GateResult
    filing_refs: list[str]  # Which filing sections were used
```

### `GateResult`

```python
@dataclass
class GateResult:
    decision: Literal["PASS", "FAIL", "CONDITIONAL_PASS"]
    checkpoint_verdicts: dict[str, str]   # {"A": "PASS", "B": "3/3 FOUND", ...}
    csf_status: Literal["reviewed", "pending", "auto"]
    blocking_reason: str | None
    timestamp: str
```

---

## Data Flow

Each step follows the same sequence:

```
step.run(context)
  1. Format prompt       — inject ticker + prior step outputs into template
  2. Generate            — 🔴 Claude → raw markdown
  3. Checkpoints (N)     — 🟢 Gemini Flash, one call per checkpoint
                           Filing text injected from outputs/{TICKER}/filings/ cache
  4. CSF Audit           — 🟡 GPT-4o
                           If csf_review_mode == "interactive": pause for human
  5. Evaluate gate       — gate_evaluator.py parses checkpoint strings
  6. Save outputs        — .md and .json written to outputs/{TICKER}/
  7. Return StepOutput
```

---

## Prompt Management

`prompts/parse_prompts.py` is a one-time script. It reads `V5_DCF/v5_RUNNABLE_PROMPT_SET.md`, splits on the `# ──────────────────────────` section headers, and writes one `.txt` file per block:

- `step1_generation.txt`
- `step1_checkpoint_a.txt`
- `step1_checkpoint_b.txt`
- `step1_checkpoint_c.txt`
- `step1_csf_audit.txt`
- ... (same pattern for Steps 2–7 and pipeline audit)

Template placeholders (`[INSERT TICKER]`, `[PASTE: ...]`) are replaced at runtime using Python `.format()` or simple string substitution.

---

## SEC Filing Fetcher

`filing_fetcher.py` pre-fetches once per ticker. Output cached in `outputs/{TICKER}/filings/`:

- `10k_latest.txt` — most recent 10-K full text
- `10q_latest.txt` — most recent 10-Q
- `8k_latest.txt`  — most recent earnings press release
- `filing_index.json` — metadata (filing date, URL, sections index)

EDGAR XBRL API used for structured segment data. Full-text search API used for 8-K. Section extraction uses header name lookup (e.g., "Note 19", "Segment Information", "Cash Flow Statement").

---

## Gate Evaluator

`gate_evaluator.py` contains one parser per step per checkpoint. Each parser returns `GateVerdict(passed: bool, detail: str)`.

Examples:
- Step 1 Checkpoint A: expects a single integer, compares to segment count from 10-K
- Step 1 Checkpoint B: counts `NOT_FOUND` lines; any → flag for review
- Step 2 Checkpoint A: looks for `MATCH` or `MISMATCH`
- Step 4 Checkpoint B: looks for `INCOMPLETE` → blocks gate

Overall gate logic per step encoded in `_parse_gate()` of each step class (since gate rules differ: some are hard stops, some are conditional).

---

## CSF Review Modes

Configurable per step in `config.yaml`:

```yaml
csf_review_mode:
  step1: auto
  step2: auto
  step3: interactive
  step4: interactive
  step4_5: auto
  step5_6: interactive
  step7: auto
```

In `interactive` mode, the pipeline prints the CSF output path, shows a summary, and waits for `[Enter] to continue` or `FAIL` to stop.

---

## Claim Tracker (Evidence Laundering Detection)

`claim_tracker.py` maintains a global registry `{claim_id: {step, evidence_level}}` per ticker run. After each step:

1. All new claims are registered with their evidence level
2. If a claim_id seen in a prior step appears again with a **higher** evidence level and no new source snippet → flag `LAUNDERING_CANDIDATE`
3. Pipeline audit step queries the registry and includes laundering candidates in its audit prompt

Evidence level ordering: `UNSUPPORTED < WEAK_INFERENCE < STRONG_INFERENCE < DISCLOSED`

---

## Config Schema

```yaml
api_keys:
  anthropic: "..."
  google: "..."
  openai: "..."

models:
  generation: "claude-sonnet-4-6"        # or claude-opus-4-6
  checkpoint: "gemini-2.0-flash"
  csf_audit: "gpt-4o"
  pipeline_audit: "gpt-4o"

csf_review_mode:
  step1: auto
  step2: auto
  step3: interactive
  step4: interactive
  step4_5: auto
  step5_6: interactive
  step7: auto

tickers:
  - MSFT
  - CRWD
  - CRM
  - GOOGL
  - AMZN
```

---

## Output Structure

```
outputs/MSFT/
├── filings/
│   ├── 10k_latest.txt
│   ├── 10q_latest.txt
│   ├── 8k_latest.txt
│   └── filing_index.json
├── step1_generation.md
├── step1_checkpoint_a.md
├── step1_checkpoint_b.md
├── step1_checkpoint_c.md
├── step1_csf_audit.md
├── step1_gate.json
├── step2_generation.md
├── ...
└── pipeline_audit.md
```

---

## Phase 1 Milestone

Build Step 1 complete (generation → 3 checkpoints → CSF → gate) and run it for MSFT. Compare output against `V5 test/MSFT_step1_output.md`:
- Segment names match
- Claim evidence levels match
- Gate decision matches

After Step 1 validation passes, implement Steps 2–4 iteratively, each with the same pattern.

---

## Out of Scope (Phase 1)

- Cross-model 🔵 runs (Steps 3 and 5/6)
- Step 7 WACC Python calculation (stub only)
- Async parallel multi-ticker execution
- Web UI or dashboard
