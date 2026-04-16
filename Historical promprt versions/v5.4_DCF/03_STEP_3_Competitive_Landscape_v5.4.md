# ════════════════════════════════
# STEP 3 — Competitive Landscape (v5.4: SPLIT INTO 3A + 3B)
# ════════════════════════════════

# ──────────────────────────
# 🔴 STEP 3A GENERATION — Competitor Pairing (BOTH MODES)
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 3A: Competitor Pairing
# Company: [INSERT TICKER]

## Input
[PASTE: Validated Step 1 JSON]

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## Objective
For each Product Category in Step 1 JSON, identify the primary competitor.

## Competitor Identification Logic
- Subject is Market Leader → identify #2 (Primary Challenger)
- Subject is NOT leader → identify Market Leader (Gold Standard)

## Evidence Requirements
Pairing MUST be backed by at least ONE of:
- Market share data with named source
- Analyst report with report name + year
- Revenue comparison from competitor's SEC filing

### Source Tier Classification (v5.1)
TIER 1: IDC, Gartner, Forrester, Canalys, Synergy Research, SEC filings, investor presentations → [DISCLOSED]
TIER 2: StatCounter, SimilarWeb, Sensor Tower (ORIGINAL, not via article) → max [STRONG_INFERENCE]
TIER 3: Wikipedia, aggregators, blogs, press summaries → max [WEAK_INFERENCE]

HARD RULE: TIER 3 only → cannot exceed [WEAK_INFERENCE].

### Source Provenance (v5.2 — FULL MODE ONLY, skip in Light Mode)
SOURCE_ACCESS: [DIRECT / SECONDARY]
SECONDARY → cap at TIER 2 max. PROVENANCE_UNKNOWN → cap at [WEAK_INFERENCE].

### Market Share Scope (only when comparing two numbers in same category)
SCOPE: [exact market definition]. Different scopes → [SCOPE_MISMATCH].

## Output: Claims First
For each category:
```
CLAIM: [C3-001]
TEXT: [competitive positioning statement]
SOURCE_SNIPPET: [exact quote or data point]
SOURCE_LOCATION: [source name, year]
SOURCE_TIER: [1 / 2 / 3]
SOURCE_ACCESS: [DIRECT / SECONDARY] ← Full Mode only
EVIDENCE_LEVEL: [DISCLOSED / STRONG_INFERENCE / WEAK_INFERENCE / QUALITATIVE_BASIS]
```

Then assemble per category:
- Primary Competitor: [name]
- Competitive Status: [Leader / Challenger]
- Rivalry intensity: [H / M / L] with one-line justification
- Basis: [claim_id + evidence level]

## Causal Discipline: Apply rules from pipeline header.
"""


# ──────────────────────────
# 🔴 STEP 3B GENERATION — Porter's Five Forces (FULL MODE ONLY)
# Model: Claude Opus / GPT-4o
# ──────────────────────────

"""
# Step 3B: Porter's Five Forces Analysis
# Company: [INSERT TICKER]

## Input
[PASTE: Step 3A output — validated competitor pairings]

## Name Consistency (v5.4): Use canonical names from Step 1 registry only.

## Objective
For each category with a validated competitor pairing, analyze Porter's Five Forces.

## Output: Claims First
For each force in each category:
```
CLAIM: [C3-020]
TEXT: [force rating and justification]
SOURCE_SNIPPET: [specific data point — a number, not vague words]
SOURCE_LOCATION: [source]
SOURCE_TIER: [1 / 2 / 3]
DATA_EVIDENCE_LEVEL: [level of the underlying data]
RATING_EVIDENCE_LEVEL: [level of the H/M/L conclusion — always ≤ DATA level]
```

A data point being [DISCLOSED] does NOT make the rating [DISCLOSED].
"AWS spent $50B on CapEx" → data is [DISCLOSED], rating "HIGH barrier" is [STRONG_INFERENCE].

## Assembled Output per category:
| Force | Rating | Quantitative Anchor | Data Level | Rating Level | Source | Tier | Justification |

"Quantitative Anchor" = specific number. If none → [NO_QUANTITATIVE_DATA].
Do NOT fabricate percentages.

## ⭐ Qualitative Competition Fallback (v5.4 — NEW)
If ≥3 out of 5 forces for a category have [NO_QUANTITATIVE_DATA]:
→ Mark category as [LOW_EVIDENCE_COMPETITION]
→ All downstream driver eligibility for this category capped at +2pp (not +3pp)
→ Note: this is acceptable, not a gate failure. Some industries lack quantitative data.

## Causal Discipline: Apply rules from pipeline header.
"""


# ──────────────────────────
# 🟢 STEP 3 CHECKPOINT A — Competitor Existence
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a fact checker. Do NOT analyze or explain.

For each pair: does the named competitor operate in the same category?

1. Category: "[Cat 1]" — Competitor: "[Comp X]" → YES / NO / UNSURE
2. Category: "[Cat 2]" — Competitor: "[Comp Y]" → YES / NO / UNSURE
...
"""


# ──────────────────────────
# 🟢 STEP 3 CHECKPOINT B — Evidence Has Data
# Model: Gemini Flash / Haiku
# ──────────────────────────

"""
You are a format checker. Do NOT analyze content quality.

For each Porter force row, does "Quantitative Anchor" contain
a SPECIFIC NUMBER (%, $, count, ratio)?
Or only vague words ("significant", "generally", "many")?

[PASTE: Porter table rows]

Reply per row: HAS_NUMBER or NO_NUMBER
"""


# ──────────────────────────
# 🟡 STEP 3 CLAIM-SUPPORT-FIT
# Model: Different advanced model
# ──────────────────────────

"""
You are a skeptical competitive analyst auditor.

## Task
For each competitive claim, evaluate:

1. Does the source snippet ACTUALLY support the claim?
   - Market share number: is it in the snippet?
   - Analyst report: does the report name + year look real?
     If you cannot verify the report exists → mark [CITATION_UNVERIFIABLE]

2. ⭐ Source Tier Verification (v5.1):
   - Is the claimed SOURCE_TIER correct?
   - If source is Wikipedia citing StatCounter → TIER 3, not TIER 2
   - If source is a blog/aggregator citing IDC → TIER 3, not TIER 1
   - Does the evidence level comply with the tier maximum?
     TIER 3 source with [DISCLOSED] label → OVERLABELED

3. ⭐ Source Provenance Check (v5.2):
   - Is SOURCE_ACCESS correctly classified?
   - If the claim cites "Statista, citing Synergy Research" → ACCESS should be SECONDARY
   - If the claim cites "synergy research group quarterly report" directly → DIRECT
   - Is evidence level compatible with access type?
     SECONDARY access on TIER 1 source → max [STRONG_INFERENCE]

4. For Porter force ratings:
   Does the evidence prove the RATING or just describe a related fact?
   → The data is one evidence level. The rating conclusion is usually lower.

5. For any causal claim:
   Does the source snippet contain causal language?
   → NO → must be [WEAK_INFERENCE] regardless of current label

## Claims to audit:
[PASTE: all Step 3 claims]

## Output per claim:
```
CLAIM: [id]
Snippet supports claim: FULLY / PARTIALLY / NOT_AT_ALL
Source verifiable: YES / UNVERIFIABLE
Source tier check: CORRECT / WRONG_TIER (should be [X])
Source access check: CORRECT / WRONG_ACCESS (should be [X])
Evidence level check: CORRECT / OVERLABELED → should be [X]
Fit: FULL_SUPPORT / PARTIAL_SUPPORT / SNIPPET_MISMATCH
```
"""


# ──────────────────────────
# 🔵 STEP 3 CROSS-MODEL (v5.3: PENALTY IF SKIPPED)
# Model: Different advanced model, same prompt
# ──────────────────────────

"""
[Run same Step 3 prompt with different model]

Compare — DO NOT auto-merge:

| Dimension | Model A | Model B | Status |
|:---|:---|:---|:---|
| Competitor for Cat 1 | [name] | [name] | CONSENSUS or CONFLICT |
| Market share % | [X]% | [Y]% | CONSENSUS (<5pp) or DIVERGENCE |
| Market share SCOPE | [def A] | [def B] | SAME_SCOPE or SCOPE_MISMATCH |
| Rivalry rating | [H/M/L] | [H/M/L] | CONSENSUS or CONFLICT |

⚫ CONFLICT or DIVERGENCE → human decides. No auto-selection.
⚫ SCOPE_MISMATCH → note that numbers are not directly comparable.

⭐ (v5.3) PENALTY IF SKIPPED:
If cross-model is NOT run:
→ All Step 3 competitive claims used in Step 4/5 must be tagged [SINGLE_MODEL_UNVERIFIED]
→ Pipeline Audit must spot-check at least 3 additional Step 3 claims (11 total instead of 8)
"""


# ──────────────────────────
# ⚫ STEP 3 GATE (v5.2 — AUTO-BLOCK + PROVENANCE)
# ──────────────────────────

"""
  Checkpoint A (competitors):    X/N confirmed
  Checkpoint B (evidence data):  X/N have numbers
  Claim-Support-Fit:             X FULL / Y PARTIAL / Z issues
  Source tier violations:        [count]
  Source provenance violations:  [count]
  Citations unverifiable:        [count]
  Cross-Model (if run):          X consensus / Y conflicts

GATE RULES (v5.2 — AUTO-BLOCK):

  ⛔ HARD STOP:
    - Any competitor NOT confirmed by Checkpoint A
    - >50% of forces lack quantitative anchor → MUST re-generate
    - Any SNIPPET_MISMATCH in CSF audit

  🔧 MUST FIX BEFORE PROCEEDING:
    - Any OVERLABELED → downgrade evidence level
    - Any WRONG_TIER → correct tier and enforce tier maximum
    - ⭐ (v5.2) Any SECONDARY access on TIER 1 source → cap at STRONG_INFERENCE
    - ⭐ (v5.2) Any PROVENANCE_UNKNOWN → cap at WEAK_INFERENCE
    - Any [CITATION_UNVERIFIABLE] on a claim feeding Step 4 synergy →
      DOWNGRADE to [WEAK_INFERENCE]
    - If >3 claims are [CITATION_UNVERIFIABLE] → re-generate with different sources
    - Cross-model CONFLICT → human resolves

  ✅ PROCEED when all HARD STOP clear and MUST FIX resolved.
"""
