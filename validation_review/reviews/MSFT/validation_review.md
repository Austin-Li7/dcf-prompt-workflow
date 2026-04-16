# MSFT Validation Review

## Overall Assessment

MSFT is the strongest current sample and is good enough to review the usefulness of Step 1 validation prompts. The key pattern is mixed: the validation layer is directionally useful, but the current prompt set is not yet stable enough to trust as a fully automated gate.

## What Worked Well

### Step 1 gate summary is operationally useful

The gate summary is the strongest artifact in the current stack. It does three valuable things well:

- separates high-signal issues from noise
- explains likely false negatives instead of blindly failing
- gives a human reviewer explicit next actions before Step 2

This is much closer to a real approval briefing than the raw auto-verify output.

### Checkpoint framing identifies the right classes of risk

The Step 1 validation logic is looking at the right things:

- segment count
- segment name match
- source snippet verification
- claim-support-fit issues

For Step 1 business architecture, these are the right failure modes to inspect first.

## What Did Not Work Well

### Step 1 auto verification is materially over-triggering `NOT_FOUND`

The `step1_auto_verify` prompt explicitly says sub-products and implied items should often be labeled `INFERRED`, not `NOT_FOUND`. The actual MSFT output does not follow that rule consistently.

Examples:

- `PBP-014` and `PBP-015` style sub-component cases are treated as missing because the filing lists the parent category but not every child item
- `IC-012`, `IC-014`, `MPC-012`, `MPC-014`, `MPC-015` are penalized for not naming downstream product variants even when the top-level category exists
- `EXCL-*` and some `REV-*` items are mixed together with structurally important failures, creating a noisy final fail decision

Result: the prompt is too brittle for a business-architecture step that intentionally includes a mix of direct disclosure and structured inference.

### The automated gate conflicts with the human-readable gate summary

The raw gate file says:

- `FAIL` in [step1_gate.json](/Users/lichenchangwen/Desktop/Checkit%20Analytics/DCF%20prompt%20coding/validation_review/inputs/MSFT/step1_gate.json)

But the human-readable review says:

- `CONDITIONAL_PASS` in [step1_gate_summary.md](/Users/lichenchangwen/Desktop/Checkit%20Analytics/DCF%20prompt%20coding/validation_review/inputs/MSFT/step1_gate_summary.md)

This is not just cosmetic. It means the current validation stack can produce two incompatible approval signals from the same underlying material. For rollout, that is dangerous because the pipeline can stop even when the human-readable review is saying "mostly fine, but check these few things."

### Coverage is too shallow for downstream confidence

The gate summary itself admits that:

- only 20 of 66 claims were CSF-audited
- only 5 snippets were tested in Checkpoint C
- Step 2 validation artifacts are not yet available in this snapshot

So while MSFT is enough to review prompt behavior, it is not enough to claim the Step 1 validation design is already robust.

## Prompt-Level Findings

### `step1_auto_verify.txt`

Verdict: `usable with fixes`

Main issue:

- The policy is sensible, but the output behavior is harsher than the policy text.

Recommended change:

- Split the prompt into two explicit buckets: `STRUCTURAL_ASSERTION` and `DETAIL_EXPANSION`.
- Tell the model to score only the structural assertion for the main verdict.
- Add a second optional flag like `DETAIL_OVERREACH` for claims that are directionally right but over-descriptive.

Expected benefit:

- Preserve true structural failures while reducing false-negative spam on child products and descriptive elaborations.

### `step1_gate_summary` behavior

Verdict: `works well`

Main issue:

- Good human-facing synthesis, but currently disconnected from the machine gate.

Recommended change:

- Define one canonical final decision source.
- If the gate summary is the reviewer-facing decision artifact, its recommendation should either write the final gate state or explicitly say it is advisory only.

Expected benefit:

- Prevent contradictory `FAIL` versus `CONDITIONAL_PASS` outcomes.

### Step 2 validation readiness

Verdict: `not enough evidence yet`

Main issue:

- We have [step2_generation.md](/Users/lichenchangwen/Desktop/Checkit%20Analytics/DCF%20prompt%20coding/validation_review/inputs/MSFT/step2_generation.md), but no matching validation output in this review snapshot.

Recommended change:

- Do not scale Step 2 testing until the same review package includes the Step 2 auto-verify output and gate artifact.

## Bottom Line

MSFT suggests the current validation design is promising but not automation-safe. The most valuable part is the reviewer-oriented gate summary. The weakest part is the auto-verify prompt, which currently collapses too many inferable or partially supported claims into `NOT_FOUND`, creating noisy stop conditions.
