# AAPL Validation Review

## Overall Assessment

AAPL is a useful contrast sample because it shows the validation layer catching a real structural error, but it also exposes that the current checkpoint outputs are too opaque for efficient human review.

## What Worked Well

### Step 1 checkpoints did catch a serious generation problem

The AAPL generation incorrectly claims that Apple has two operating segments, `Products` and `Services`, while the cited filing text itself says the formal reportable segments are geographic.

That means the validation layer is not merely being picky. It is capable of catching a genuinely important Step 1 business-architecture mistake.

### Checkpoint A is conceptually the right sanity check

The prompt in [step1_checkpoint_a.txt](/Users/lichenchangwen/Desktop/Checkit%20Analytics/DCF%20prompt%20coding/dcf_pipeline/prompts/step1_checkpoint_a.txt) is simple and high-value: count the reportable operating segments from the filing and compare with the report.

This kind of narrow prompt is exactly the right shape for early structural validation.

## What Did Not Work Well

### The checkpoint outputs are too lossy

The actual AAPL checkpoint outputs are:

- `0` for checkpoint A
- repeated `NOT_FOUND` lines for checkpoints B and C

Those outputs are technically parseable, but not review-friendly. A human cannot quickly tell:

- what the model thought the filing said
- which segment names were tested
- whether the failure came from bad extraction, bad prompt substitution, or a real content mismatch

### The gate result is correct, but the explanation quality is weak

The final gate in [step1_gate.json](/Users/lichenchangwen/Desktop/Checkit%20Analytics/DCF%20prompt%20coding/validation_review/inputs/AAPL/step1_gate.json) says `FAIL`, which is directionally right. But the evidence trail is poor because checkpoint outputs are minimal and context-free.

This makes the prompt system harder to debug. It is good at saying "stop," but not yet good at saying "here is exactly why this failed and what to fix."

## Prompt-Level Findings

### `step1_checkpoint_a.txt`

Verdict: `works well`

Main issue:

- The prompt itself is fine, but the surrounding system should preserve more context when the answer is unexpected.

Recommended change:

- Keep the output machine-readable, but store the exact filing excerpt and expected count alongside the parsed result in the gate artifact.

Expected benefit:

- Easier debugging without weakening the checkpoint prompt.

### `step1_checkpoint_b.txt`

Verdict: `usable with fixes`

Main issue:

- The output format is too thin to explain why names failed.

Recommended change:

- Extend the output line format to include the tested term and, for failures, the closest matching phrase from the filing when available.

Expected benefit:

- Faster distinction between true mismatch, synonym problem, and prompt-substitution bug.

### `step1_checkpoint_c.txt`

Verdict: `usable with fixes`

Main issue:

- `FOUND_VERBATIM / FOUND_PARAPHRASED / NOT_FOUND` is a good schema, but the artifact does not include the snippet or a short reason, so repeated `NOT_FOUND` lines are low-value.

Recommended change:

- Require a short reason for `NOT_FOUND` and save the sampled claim IDs with the checkpoint output.

Expected benefit:

- Makes snippet verification failures auditable instead of opaque.

## Bottom Line

AAPL increases confidence that the validation layer can catch major Step 1 structural mistakes. At the same time, it shows that the current checkpoint artifacts are too compressed to support efficient prompt debugging or leadership-ready explanation.
