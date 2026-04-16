# MSFT Review Snapshot Manifest

## Source

- Snapshot copied from [dcf_pipeline/outputs/MSFT](/Users/lichenchangwen/Desktop/Checkit%20Analytics/DCF%20prompt%20coding/dcf_pipeline/outputs/MSFT)
- Snapshot created for validation-prompt review only
- This folder should not be treated as the live pipeline output directory

## Included Files

- `step1_generation.md`
- `step1_gate_summary.md`
- `step1_gate.json`
- `step1_auto_verified.md`
- `step2_generation.md`
- `pipeline_state.json`

## Step Coverage Used In This Review

- Step 1 generation: available
- Step 1 validation summary: available
- Step 1 auto verification output: available
- Step 2 generation: available

## Missing Or Not Yet Snapshotted

- Step 2 gate output: missing from source outputs
- Step 2 auto verification output: missing from source outputs
- Step 3 materials: missing
- Step 4 materials: missing

## Coverage Constraint

MSFT can support a meaningful first-pass review of:

- Step 1 auto verification prompts
- Step 1 gate summary usefulness
- Early Step 2 generation-to-validation handoff risk

MSFT cannot yet support a complete review of the full validation stack because downstream validation artifacts are incomplete.
