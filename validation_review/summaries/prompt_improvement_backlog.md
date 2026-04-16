# Prompt Improvement Backlog

| Priority | Prompt family | Current weakness | Example | Proposed change | Expected benefit |
|---|---|---|---|---|---|
| P0 | Step 1 auto verification | Overuses `NOT_FOUND` for inferable child products and descriptive expansions | MSFT `PBP-*`, `IC-*`, `MPC-*`, `EXCL-*` hard-failed in [step1_auto_verified.md](/Users/lichenchangwen/Desktop/Checkit%20Analytics/DCF%20prompt%20coding/validation_review/inputs/MSFT/step1_auto_verified.md) | Split verdicting into `structural assertion` plus optional `detail overreach` flag | Reduces false negatives without hiding real segment-mapping errors |
| P0 | Final gate decisioning | Machine gate and human-readable summary can disagree | MSFT raw gate = `FAIL`, summary = `CONDITIONAL_PASS` | Choose one canonical final decision path and make all artifacts align to it | Prevents contradictory stop/go outcomes |
| P1 | Step 1 checkpoint B | Output is too thin to diagnose why a name failed | AAPL checkpoint B is just repeated `NOT_FOUND` lines | Include tested name plus nearest filing phrase or short reason | Faster debugging of synonym issues versus real mismatches |
| P1 | Step 1 checkpoint C | Snippet verification output lacks enough review context | AAPL checkpoint C is only repeated `NOT_FOUND` | Save sampled claim IDs and require a short reason for `NOT_FOUND` | Makes snippet failures auditable |
| P1 | Gate artifact packaging | Useful reviewer context is not consistently preserved in machine artifacts | AAPL gate blocks correctly, but evidence trail is weak | Store source excerpt, expected value, and tested inputs next to parsed result | Improves review speed and trust |
| P2 | Step 2 validation readiness | Generation artifacts appear without matching validation artifacts in review snapshots | MSFT has Step 2 generation only | Require generation + validation artifact pair before using a step as a test sample | Avoids premature confidence in unreviewed steps |
